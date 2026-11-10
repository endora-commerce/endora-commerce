# Contract: the public file route, URL forms, caching and response headers

Owner: `packages/modules/assets_library/src/backend/routes.public.ts`. Research R-8 – R-12a.
Extends master's content policy (`services/content-policy.ts`) and its private-signature check;
weakens neither.

## 1. Registrations

```text
GET /assets/file/:assetId     one segment  — an asset id or a one-segment permalink
GET /assets/file/*            two or more segments — a permalink only
Querystring (both): token?, exp?, download?, v?
```

Both call one handler. Resolution of the identifier `x` gives `{ row, form }`:

1. `isAssetIdShaped(x)` → `findOne(Asset, { id: x })`, `form = 'id'`;
2. otherwise → the row whose `lower(permalink) = lower(x)`, `form = 'permalink'`;
3. none → `row = null`.

The OpenAPI baseline gains the wildcard path (`UPDATE_OPENAPI_BASELINE=1`, tasks.md T060).

## 2. Decision order (one pure function, `decideFileResponse`, tested without HTTP)

Input: `{ row, form, query: { token, exp, download, v }, ifNoneMatch, signatureValid, now }`.
Output: `{ status, headers, body: 'stream' | 'none' | { code, message }, location? }`.

```text
1. row = null                               → 404 ASSET_NOT_FOUND
2. row.visibility = private and the HMAC signature (token, exp) for row.id is missing or invalid:
     form = id                              → 404 ASSET_NOT_FOUND, identical to rule 1  (issue #542; was 403)
     form = permalink                       → 404 ASSET_NOT_FOUND, identical to rule 1  (owner ruling P2)
3. row.deletedAt                            → 410 ASSET_GONE                            (any form, any v)
4. row.visibility = private (signature valid):
     backend = local                        → 200 / 304, `private, no-store, max-age=0`, v ignored
     backend ∈ {s3, gcs}                    → 302 Location: time-limited URL from resolveUrl, `no-store`;
                                              the URL is signed with the row's type and its cloud
                                              disposition, attachment when download=1 (issue #815)
5. public, backend ∈ {s3, gcs}              → 302 Location: stable URL (+ `?v=<current>` when the request
                                              carried v), `no-store`
   public, backend = legacy                 → 302 Location: stored URL when it is http(s); otherwise
                                              404 ASSET_FILE_MISSING
6. public, backend = local:
     v absent                               → 200 / 304, `public, no-cache`, ETag "<id>-<cv>"
     v = current                            → 200 / 304, `public, max-age=31536000, immutable`, same ETag
     v ≠ current                            → 302 Location: canonical path ?v=<current>[&download=1], `no-store`
```

An identifier that is not id-shaped and fails `validateAssetPermalink` (a NUL byte, a character outside the rule, more than 200 characters) resolves to `row = null` without a query, so it answers rule 1 like an unused name (security review 2026-10-19).

A `304` is decided only after rules 1–3, so a private asset without a valid signature never answers
`304`, whatever `If-None-Match` carries.

**Canonical `Location` (rule 6)** — path-absolute and built from the row: `/assets/file/<row.id>`
when `form = id`, `/assets/file/<row.permalink>` (stored value, each segment percent-encoded) when
`form = permalink`; then `?v=<row.contentVersion>`; then `&download=1` only if the request's
`download` was exactly `1`. Nothing else from the request is copied — never `token` or `exp`.

**Headers**

| Status | `X-Content-Type-Options` | `Content-Security-Policy` | `Cache-Control` | Other |
| --- | --- | --- | --- | --- |
| 200 | `nosniff` | `servingPolicyFor(row.mimeType)` | per rule 4 / 6 | `Content-Type` = row MIME; `Content-Length` when > 0; `ETag`; `Cross-Origin-Resource-Policy: cross-origin` when public; `Content-Disposition` = `contentDispositionHeader(mode, row.filename)` with `mode = attachment` when `download=1` or `!policy.inline` |
| 304 | `nosniff` | `servingPolicyFor(row.mimeType)` | same as the 200 it stands for | `ETag` |
| 302, 404, 410 | `nosniff` | `SANDBOX_CSP` (fixed) | `no-store` | `Location` on 302 only |

The route sets the decided headers on the reply before throwing the error envelope, so the error
handler's response carries them. The `404` of rule 2 and the `404` of rule 1 are byte-identical.

*Amended 2026-11-09 (issue #542).* Rule 2 by id answered `403 ASSET_ACCESS_DENIED`, which let a
caller without a signature confirm that a private asset exists. It now answers rule 1's `404`, as
the permalink form already did. Nothing raised `ASSET_ACCESS_DENIED` any more, so the code was dropped
from the error catalogue (`check-error-translations`' unraised-code rule).

## 3. URL forms the module hands out

| Form | Local | S3 / GCS | Legacy |
| --- | --- | --- | --- |
| stable file URL (`fileUrl`, `GET …/:id/url`) | `<localBase>/assets/file/<id>` | `<bucketBase>/<stableKey>` | stored URL |
| embed URL (`url`, `AssetRecord.storageUrl`, `resolvePublicUrls`, e-mail logo) | `<localBase>/assets/file/<id>?v=<cv>` | `<bucketBase>/<stableKey>?v=<cv>` | stored URL, unchanged |
| private (`url` when private) | signed `?token=&exp=`, no `v` | time-limited URL from `resolveUrl`, no `v` | — (cannot be private) |
| permalink URL (`permalinkUrl`) | `<localBase>/assets/file/<permalink>` | same (served by the API, then rule 4/5) | same |

`<localBase>` is `resolvePublicUrlBase(assets.local.public_url_base, publicApiBaseUrl)` — the base
`/assets/file/<id>` already uses (`services/storage/local-fs-adapter.ts:81`) — computed from the
settings view directly, never by building the local adapter.

`versionedAssetUrl(url, contentVersion, backend)`: returns `url` unchanged when `backend` is `legacy`,
when `url` starts with `data:`, or when `url` already has a query (a signed URL); otherwise
`url + '?v=' + contentVersion`.

## 4. Object metadata on cloud (R-10, R-12a)

| Object | ACL (explicit on every write) | `Cache-Control` | `Content-Type` | `Content-Disposition` |
| --- | --- | --- | --- | --- |
| stable key (upload, replace, restore, compensation) | the locked row's visibility | `no-cache` | current MIME | `cloudContentDisposition(mime, filename)` |
| previous key `<id>.prev-<32 hex>.<ext>` | private | `no-cache` | its MIME | `cloudContentDisposition(its mime, its filename)` |
| staging key `<id>.stage-<32 hex>.<ext>` | private | — | stored MIME | — |

`cloudContentDisposition(mime, filename)` = `contentDispositionHeader(servingPolicyFor(mime).inline &&
!isSvg ? 'inline' : 'attachment', filename)` (owner ruling P4). `contentDispositionHeader` and the
sibling-key extension rule are research R-12a.

Objects written before this feature carry no `Cache-Control` and no disposition until their first
replace; the documentation says so and how to set them in bulk with the vendor's tools.

## 5. What each consumer sees after a replace (the table SC-002 is tested against)

| Consumer | Reads | After a replace |
| --- | --- | --- |
| Product detail / list, gallery, attachments, OG image | `AssetRecord.storageUrl` via `assetReadPort.findByIds` | new `?v=` |
| CMS bodies, page-builder backgrounds, megamenu, blog, PWA, CRM attachment links, invoice attachment route | `assetsLibraryPort.getAsset().url` | new `?v=` |
| Page-builder / `cms-components` fallback for an unresolved asset | builds bare `/assets/file/<id>` | current file, revalidated |
| Product feeds (`image_link`, `additional_image_link`) | `assetReadPort.resolvePublicUrls` | new `?v=` at the next generation |
| Transactional e-mail logo | `transactionalEmailAssetUrl` → `resolveEmbedUrl` | new `?v=` in e-mails sent after |
| E-mail / feed / cached page holding an old `?v=` | the route | local: `302` to current; cloud bucket: current bytes (manual check, R-19) |
| External bare URL or permalink | the route / the bucket | current file on the next request (`no-cache`) |
| Invoice logo bytes | `assetReadPort.openAssetBytes` (stable key) | new bytes |
