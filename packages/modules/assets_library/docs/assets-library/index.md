---
title: Assets library
description: Central digital-asset library with pluggable storage adapters, stable file URLs and permalinks, in-place file replacement, soft-delete with a retention sweep, and reference-protection guards
---

# Assets library

The Assets Library is the platform's digital-asset substrate. It owns:

- A central catalogue of files (images, video, PDFs, documents) reusable
  across Product media, Product attachments, Category main images, and CMS
  pages.
- A folder tree for organising assets.
- Pluggable storage backends — Local filesystem, Amazon S3, GCP Cloud
  Storage — configured from Settings, exactly one active at a time.
- Public/private visibility per asset.
- Stable file URLs and operator-chosen permalinks that keep working when the
  file behind them is replaced.
- In-place file replacement, with the previous version kept and restorable.
- Reference protection: assets in use by Catalog or CMS cannot be deleted
  until every reference is detached.
- Reader-aware visibility: a file used only by records a reader may not see
  — a private Task, a Project they are not a member of, an Opportunity
  outside their reach — is hidden from that reader. See
  [Who sees which files](#who-sees-which-files).
- A retention sweep that hard-deletes soft-deleted assets and replaced files
  once their retention period has passed.

## Quick start

1. **Active adapter** — open Settings → Storage and pick one of `local`, `s3`,
   or `gcs`. Defaults to `local`.
2. **Local FS** — set `assets.local.base_dir` (default `var/assets`). The
   admin server creates the directory tree at upload time. Set
   `assets.local.public_url_base` if the backend is fronted by a different
   public hostname (e.g. a CDN or a reverse proxy); leave it blank and every
   URL is built on this deployment's public API origin instead.
3. **Amazon S3** — set `assets.s3.bucket`, `assets.s3.region`,
   `assets.s3.access_key_id`, `assets.s3.secret_access_key`. Optional:
   `assets.s3.endpoint` (for S3-compatible providers like MinIO),
   `assets.s3.prefix`, `assets.s3.public_base_url` (CDN base URL prefix).
4. **GCP Cloud Storage** — set `assets.gcs.bucket` and either
   `assets.gcs.service_account_json` (paste the full JSON) or rely on
   ambient credentials. Optional: `assets.gcs.prefix`,
   `assets.gcs.public_base_url`.
5. **Test the connection** — `POST /api/v1/admin/assets/storage/self-check`.
   Returns `{ ok: true }` on success or `{ ok: false, reason: ... }` on
   misconfiguration. The dashboard is at `GET /api/v1/admin/assets/storage/state`.

The admin opens the library from the sidebar or from the command palette
(⌘K / CTRL+K → "Assets library", for anyone holding `assets.read`). The asset
detail drawer holds the shareable link, the permalink, **Replace file**, the
previous version with **Restore**, and the delete action. Every write control
needs `assets.write`.

## Upload constraints

Two settings gate uploads, both checked before any byte reaches the active
adapter:

- `assets.allowed_file_types` — list of file extensions or MIME types
  (e.g. `["jpg", "png", "image/jpeg", "application/pdf"]`). The sentinel
  `["*"]` (default) disables the gate. Wildcards like `image/*` match any
  MIME under that prefix. The check considers both the declared MIME and
  the magic-number-sniffed MIME (file-type) and rejects when either fails.
- `assets.max_file_size_mb` — integer cap in MB. `0` (default) disables
  the cap. The cap is read on every request and applies to the bytes
  actually received, so a tightened limit takes effect without a restart.

Independently of `assets.allowed_file_types`, documents a browser would run
— HTML, XHTML, XML (including XSL stylesheets) and JavaScript — are refused
with `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`, judged by the declared MIME type and
by the file extension. SVG is accepted (logos, icons) and is always stored as
`image/svg+xml`. Any other file is stored under the type sniffed from its
content when the content is recognised, and under its declared type otherwise.
An upload takes one `file` part; a second one is ignored.

## Which URLs are stable

| URL | Stable? |
| --- | --- |
| File URL (`fileUrl`, and `GET /api/v1/admin/assets/:id/url` for a public asset): `/assets/file/<asset id>` on local storage; on S3 and GCS the object's stable bucket URL (on `public_base_url` when one is set) | Yes — across every replace, for as long as the asset exists. `/assets/file/<asset id>` also answers on every backend, redirecting a cloud asset to its bucket URL. |
| Permalink `/assets/file/<permalink>` (`permalinkUrl`) | Yes — across every replace, until the permalink is changed or removed. |
| Embed URL `…?v=<contentVersion>` (what the catalogue, CMS, feeds and e-mails embed) | Points at one version of the file. After a replace it redirects to the current version, so it keeps working, but it is not the URL to hand out. |
| Signed private URL (`token`, `exp`) | No — valid for `assets.private_url_ttl_sec` (default 300 s) and re-issued on every read. |

The shareable link the admin drawer offers is the permalink URL when the asset
has one, and the stable file URL otherwise — never the versioned embed URL.
`contentVersion` is a short marker on each asset that changes whenever its file
changes; `AssetsLibraryService.resolveEmbedUrl(id)` returns the embed form for
code that renders an asset.

## How files are served

`GET /assets/file/:assetId` and `GET /assets/file/<permalink>` send
`X-Content-Type-Options: nosniff` on every response. A served file carries a
`Content-Security-Policy` of `default-src 'none'; style-src 'unsafe-inline'; sandbox`
(PDFs get the same policy without `sandbox`, which the browsers' built-in PDF
viewers do not run under). Only displayable media — raster images, SVG, video,
audio, PDF and plain text — is served `Content-Disposition: inline`; every
other stored type is served as an `attachment`, whatever the request asks for;
`?download=1` asks for an attachment. An SVG opened directly therefore runs no
script, and embedding it through `<img>` is unaffected.

Redirects and error answers (`302`, `403`, `404`, `410`) carry `no-store` and
the fixed sandbox policy above, whatever the stored type.

The route decides in this order:

1. An unknown id or name answers `404 ASSET_NOT_FOUND`.
2. A **private** asset is checked for a valid signature first. Without one it
   answers `403 ASSET_ACCESS_DENIED` by id — also when it is soft-deleted —
   and `404` by permalink, byte-for-byte the answer an unused name gets.
3. A soft-deleted asset answers `410 ASSET_GONE`.
4. A private asset with a valid signature is streamed (local) or redirected to
   a time-limited bucket URL (S3, GCS), always `no-store`.
5. A public cloud asset is redirected (`302`, `no-store`) to its stable bucket
   URL — with `?v=<current>` when the request carried a `v`.
6. A public local asset is streamed; see [Caching](#caching).

The `ETag` is `"<asset id>-<contentVersion>"`: it changes when the file changes
and not when only the label or folder does. `If-None-Match` is compared weakly
and accepts a list or `*`.

## Visibility & private URLs

Each asset has `visibility ∈ {public, private}`. Private URLs are short-lived
(TTL = `assets.private_url_ttl_sec`, default 300s) and re-issued by the admin
or storefront on every read.

Making an asset private stops the platform serving it without a signature from
the next request, but it does not purge copies that browsers, CDNs or other
external caches already hold.

For the **local FS** adapter, private URLs are HMAC-signed by the backend.
The signing key is sourced from the `ASSETS_LIBRARY_HMAC_KEY` env var
(generate with `openssl rand -hex 32`); rotate to invalidate every
outstanding private URL.

For **S3** and **GCS**, private URLs are V4-signed through the vendor SDK;
nothing in the backend needs to be configured beyond the credentials.
`GET /assets/file/:assetId` redirects a cloud asset to its resolved URL, but
for a `private` asset only after the same HMAC token check a local asset
gets; without a valid token it answers `403 ASSET_ACCESS_DENIED`. Admin
screens obtain private URLs from `GET /api/v1/admin/assets/:id/url` and are
unaffected.

## Who sees which files {#who-sees-which-files}

Some of the records that use library files are not visible to everybody: a
private or draft Task, a Task of a record you may not see, a Project you are not
a member of, an Opportunity of an Organization outside your reach. The library
follows those records, so their files do not reach readers who may not see
them.

**You see a file when** nothing that hides files uses it — an upload nobody
uses yet, or a file used only by products, categories, CMS pages, blog posts or
menus — **or when you may see at least one of the records that use it.** A file
used by a private Task *and* a product is visible to everybody who may open the
library; so is a file used by two Tasks of which you may see one. Which records
you may see is decided by the module that owns them, by the rule its own
screens use: Tasks by private and draft Tasks and the record a Task belongs to,
Projects by membership, CRM by `crm:read` and your Organization reach.

**A file you may not see is not there for you.**

- It is missing from the library's list, its search, its folders and the file
  picker other screens open.
- Opening it by its id — the detail, the download link, the preview — and every
  action on it — rename, move, replace, restoring the previous version,
  changing its visibility, setting or removing its permalink, delete and
  restore — answers exactly as for a file that does not exist. Moving several
  files at once skips it, as it skips a missing one.
- Attaching it to a Task, a Project or an Opportunity is refused as for a
  missing file.
- A permalink refusal (`409 ASSET_PERMALINK_TAKEN`) does not name the file that
  holds the name when you may not see it.

**_Referenced by_ lists only the records you may see.** The others are neither
named nor counted, so two readers can see a different list for the same file.

**Delete is still refused while anything uses the file**, including records you
may not see: the library counts every use, whoever asks. The refusal names only
the records you may see, and its message is the same for everybody.

**Folders.**

- The number of files with a permalink that the folder-delete confirmation
  names counts only files you see.
- A folder whose only files are ones you may not see is empty for you. Deleting
  it moves those files to the parent folder — to *Unsorted (root)* when there is
  none — and deletes the folder. They are never moved to the trash on your
  behalf.
- This holds for every way of deleting a folder. Moving the contents to the
  parent works as before. Deleting everything (`deleteRecursively`) moves the
  files you see to the trash and the others to the parent folder, and it is
  **refused when any file you see in the folder, at any depth, is still in use**
  — the refusal lists those files' ids, and nothing is deleted or moved.
- The folder's audit entry lists the files moved to the parent folder this way
  (`rehomedAssetIds`).

**The Platform administrator** — a role holding `*` — sees every file, whoever
uses it. Delete is still refused for them while a file is in use.

**When a module is switched off.** Its records stay, and so do their uses of
library files. The files used only by records of a switched-off module are
hidden from every library reader except the Platform administrator, and nobody
can delete them — the Platform administrator included. Switching the module back
on shows them again to everybody who saw them before; nothing is moved or
written while it is off.

**Removing such files for good.** There are two ways:

- switch the module back on and remove the records or the attachments that use
  the files; they are then ordinary unused files;
- remove the module from the deployment — uninstall it and remove its package,
  or build the instance without it. A module that is not part of the deployment
  reports no uses, so its former files are treated as unused: visible and
  deletable. A module only made unavailable on the platform, or soft-uninstalled,
  is still part of the deployment, and its files stay hidden and protected as
  while it is switched off.

**What does not change.**

- A file's own address (`/assets/file/…`) and its permalink serve the file
  exactly as before: public and private delivery is decided by the file's
  visibility, not by who may see it in the library.
- Background work — the retention sweep, storage checks — sees every file.
- The storage page's counts of deleted files and of files awaiting clean-up
  stay the library's totals.

## Replacing a file

`POST /api/v1/admin/assets/:id/replace` (multipart: an optional
`expectedContentVersion` field, then one `file` part; a second file part is
ignored) swaps an asset's file and keeps everything else — the id, folder,
label, alternate text, visibility, every reference to the asset, its storage
key and therefore every URL already handed out. The answer is the updated
asset, with a new `contentVersion`. In the admin it is **Replace file** in the
asset drawer, which confirms naming both files and how long the current one
stays restorable.

- **Same kind only.** The new file must be of the asset's stored kind — image,
  video, PDF or other — judged by its recognised content, not its declared
  type: an image or a PDF counts only when its bytes are recognised as one, and
  an SVG counts as an image. A mismatch answers
  `415 ASSET_REPLACE_KIND_MISMATCH` with `details.currentKind` and
  `details.newKind`. A video or PDF in a format the content sniffer does not
  recognise answers `newKind: other`, so it cannot replace a `video` or `pdf`
  asset; upload it as a new asset instead. A certificate stays a certificate.
- **The filename follows the file.** The asset takes the new file's name, type
  and size; an admin's MIME override is cleared.
- **The same upload rules apply** — allowed types, the browser-executable
  refusal and the size cap.
- **Legacy rows** (see [Legacy escape hatch](#legacy-escape-hatch)) are refused
  with `409 ASSET_LEGACY_CANNOT_REPLACE`; re-upload them instead. A soft-deleted
  asset answers `410`.
- **Concurrent replaces.** Two replaces of the same version race to one winner;
  the other answers `409 ASSET_REPLACE_CONFLICT`. Sending
  `expectedContentVersion` makes a replace fail the same way when the asset
  changed since it was read. The field must come before the file part; sent
  after it, the request answers `400 VALIDATION_FAILED` and nothing is replaced.
- **The 5 GiB ceiling on S3.** A replacement of an S3 asset above 5 GiB is
  refused with `413` naming 5120 MB, the largest object S3 copies in one step.
- The asset's own backend is used, whatever backend is active now.

Every replace is the audited Command `asset.replace`.

## Permalinks

A permalink is an operator-chosen path that serves the asset at
`/assets/file/<permalink>`, for example `/assets/file/brand/logo.svg` or
`/assets/file/datasheets/pump-2000.pdf`. Set it with
`PUT /api/v1/admin/assets/:id/permalink` (`{ permalink, confirmReuse? }`) and
remove it with `DELETE /api/v1/admin/assets/:id/permalink`, or from the asset
drawer, which validates it as it is typed and confirms before a set permalink
is changed or removed.

- **Rules.** At most 200 characters of `A–Z`, `a–z`, `0–9`, `.`, `_`, `-` and
  `/`; no empty, `.` or `..` segment; not shaped like an asset id. A refusal is
  `400 ASSET_PERMALINK_INVALID` with `details.code` naming the rule.
- **Unique case-insensitively**, and matched case-insensitively when served.
  A name another asset holds answers `409 ASSET_PERMALINK_TAKEN`.
- **Private assets.** A private asset's permalink answers `404` without a valid
  signature, exactly as an unused name does, while its id URL answers `403`,
  live or soft-deleted. A soft-deleted private asset answers `410` only to a
  valid signature.
- **Change or removal** takes effect at once: the old name answers `404` from
  the next request.
- **Reusing a name.** A name that was changed, removed or released by a purge
  can be taken at once. When the asset that held it last was a **different**
  one, the request answers `409 ASSET_PERMALINK_PREVIOUSLY_USED` until it is
  repeated with `confirmReuse: true` — links already printed with that name
  will open the new asset — and the audit entry records which asset held it.
  An asset taking back its own former permalink needs no confirmation.
- **Delete and purge.** A soft-deleted asset keeps its permalink, which answers
  `410`; the drawer warns before deleting an asset that has one. The hard
  delete releases it. Setting or removing the permalink of a soft-deleted asset
  answers `410`; restore the asset first.
- **Deleting a folder.** Deleting a folder in the library moves its files to
  the parent folder, so their permalinks keep working; the confirmation names
  how many files in the folder, at any depth, have one
  (`GET /api/v1/admin/assets/folders/:folderId/permalink-count`). The API
  option `deleteRecursively` of `DELETE /api/v1/admin/assets/folders/:folderId`
  instead moves the folder's assets to the trash without confirmation, so their
  permalinks answer `410` until the assets are restored. It is refused while
  any of those assets is in use, and files the reader may not see are moved to
  the parent folder instead (see [Who sees which files](#who-sees-which-files)).

Setting and removing a permalink are the audited Commands
`asset.permalink_set` and `asset.permalink_remove`. The list search also
matches permalinks.

## Previous version and restore

A replace keeps the file it replaced as the asset's **previous version**; one
is kept, and a further replace discards the one before it. The asset detail
reports it as `previousVersion` — name, type, size, content version, when and
by whom it was replaced, and `restorableUntil` (replaced at plus the retention
period) — or `null`. The detail also answers `retentionDays`, the effective
retention period in whole days, which the replace confirmation names.

`POST /api/v1/admin/assets/:id/previous-version/restore` (**Restore** in the
drawer) swaps the two: the previous file becomes current and the current one
becomes the previous version, with a fresh retention period. The body names
both versions — `expectedContentVersion` and `expectedPreviousContentVersion` —
so a restore brings back exactly the file the admin saw; either being out of
date answers `409 ASSET_REPLACE_CONFLICT`. Without a previous version, or past
`restorableUntil`, the answer is `409 ASSET_NO_PREVIOUS_VERSION` (with
`details.restorableUntil` in the second case). The restored file keeps its own
content version, so its earlier ETag and cached copies are valid again. A
restore is the audited Command `asset.restore_previous_version`.

## Caching

What the file route answers, by request:

| Request | Answer | `Cache-Control` |
| --- | --- | --- |
| Public local, no `v` (file URL or permalink) | `200` / `304` | `public, no-cache` |
| Public local, `v` = current version | `200` / `304` | `public, max-age=31536000, immutable` |
| Public local, `v` ≠ current version | `302` to the same URL with the current `v` | `no-store` |
| Public S3 / GCS | `302` to the stable bucket URL | `no-store` |
| Private, valid signature, local | `200` / `304` | `private, no-store, max-age=0` |
| Private, valid signature, S3 / GCS | `302` to a time-limited URL | `no-store` |
| Refusals (`403`, `404`, `410`) | — | `no-store` |

- **Freshness.** A replace is visible on the next request to the file URL or
  the permalink: both are revalidated every time, and the embed URLs the
  platform hands out carry the new `v`.
- An unsigned conditional request on a private asset never receives `304`.
- The one-year `immutable` answer on `?v=<current>` is best effort while a
  replace is running: a request that arrives in the brief window before the
  replace commits can be cached with the new bytes under the old marker.
- **Upgrading.** Before this version the bare file URL was served
  `immutable` for a year. A client that cached it then can keep its copy until
  that year runs out; the embed URLs are versioned from this version on.

### CMS pages after a replace

The CMS page cache holds a resolved page, embed URLs included, for up to five
minutes and is not cleared when an asset changes. A CMS page cached before a
replace therefore keeps serving the previous `?v=` for up to five minutes; that
URL redirects to the current file when it is requested. A browser that already
holds the old `?v=` URL in its cache — it was served as immutable — can keep
showing the previous image until the CMS page cache has turned over and the
page is reloaded. Clearing the CMS page cache when an asset changes is tracked
in [issue #363](https://github.com/endora-commerce/endora-commerce/issues/363).

## Cloud storage

- **The stable key.** An asset's object key never changes; a replace copies the
  new file over it on the server, so the bucket URL is stable too.
- **Object headers.** Objects written by this version carry
  `Cache-Control: no-cache` and a `Content-Disposition` chosen by the serving
  policy — SVG and every non-displayable type as `attachment`. Objects stored
  earlier keep their headers until their first replace. To set them in bulk,
  update each object's metadata with your provider's tooling (for S3 a copy of
  the object onto itself with the metadata directive set to replace; for GCS a
  metadata update), re-stating its content type — and on S3 its ACL, which a
  self-copy otherwise resets.
- **A stale `v`** on a bucket URL serves the current file; the bucket does not
  version by query string.
- **Private assets** are served through the API only with a valid platform
  signature, which redirects to a time-limited bucket URL.
- **Previous and staging objects** have random names and private ACLs. **A
  bucket policy must not grant public read beyond the objects the module makes
  public.**
- **Size.** A file on S3 is limited to 5 GiB; a larger replacement is refused
  with the size message.

## Operating a CDN

**In front of the API** (`assets.local.public_url_base`, or the API origin):
forward `/assets/file/` with nested paths and the query string, and honour the
origin's `Cache-Control`. A CDN that overrides the origin's freshness must
purge the bare file URL and the permalink after a replace.

**In front of the bucket** (`assets.s3.public_base_url`,
`assets.gcs.public_base_url`): include `v` (and `download`) in the cache key and
nothing else; cache for a long time when `v` is present and revalidate
otherwise; never strip `v`. Add `X-Content-Type-Options: nosniff` and a
restrictive `Content-Security-Policy` to bucket responses, which the bucket
does not send itself. A CDN that overrides freshness must purge the bare URL
after a replace.

## Soft-delete & hard-delete

Deletes go through a two-step lifecycle:

1. `DELETE /api/v1/admin/assets/:id` → soft-delete. Sets `deletedAt`; the asset
   disappears from listings and pickers but remains recoverable via
   `POST /api/v1/admin/assets/:id/restore`, which also takes it out of the
   sweep. Recursive folder deletion works the same way, and is refused as a
   whole while any file in the folder is in use. The reported
   `purgeAfterAt` is `deletedAt` plus the current retention period.
2. The [retention sweep](#retention-and-purge) hard-deletes the asset once the
   period has passed: it removes the row and asks the adapter to delete the
   underlying file.

## Retention and purge

`assets.soft_delete_retention_days` (default 30) is the retention period for
both soft-deleted assets and replaced files. Settings accepts a whole number of
days from 1 to 3650 and refuses anything else with a `422 VALIDATION_FAILED`. A
value stored before that rule existed is read as follows: `0`, or anything
between zero and one, is one day; anything above 3650 is 3650 days; an empty,
non-numeric or negative value applies the default of 30.

- **Hourly sweep.** A scheduled job runs every hour and handles at most 500
  assets per run, oldest deletion first. Each run writes one
  `assets_library.retention.sweep` log line saying what it did, also when
  nothing was due.
- **What it purges.** Soft-deleted assets, once the period has passed since
  their deletion, and previous versions, once it has passed since they were
  replaced.
- **Read when the sweep runs.** The period is read at sweep time, so a changed
  setting applies to assets already deleted, and the purge date the API
  reports follows it.
- **Referenced assets are skipped** and stay soft-deleted.
- **Failed deletes are retried.** When the backend cannot remove a file
  (read-only mount, revoked credentials, network partition), the row stays
  with `pendingCleanup` set and the next run retries; a file already gone
  counts as deleted. Storage objects the module stopped needing — the
  leftovers of a failed or interrupted replace — are cleaned after 24 hours.
- **Restore** removes an asset from the sweep.
- **Upgrading.** Before this version soft-deleted assets were not purged. **The
  first runs after upgrading purge every asset soft-deleted longer ago than the
  period**; to keep them, lengthen the setting before upgrading.

**Rolling back** this version's migration leaves previous-version and staging
objects in storage with nothing referencing them; remove them from the bucket
or directory by hand if they matter. Every asset keeps being served, because
the stored file key does not change.

## Reference protection {#asset-reference-registry}

Soft-delete is rejected with `409 ASSET_REFERENCED` when any of the
following points at the asset:

- `gallery_items.asset_id` (Product gallery)
- `product_attachments.asset_id` (Product attachments)
- `products.download_asset_id` (virtual-download products)
- `categories.main_image_asset_id` (Category main image)
- `cms_pages.body` containing a `{ type: "asset_ref", assetId }` node

Every module that uses library files contributes its own kinds of reference
in the same way — Tasks, Projects, CRM, blog posts and menus among them. The
check counts **every** reference, whoever asks and whatever their permissions,
and also while the module that owns the reference is switched off. The
reference list in the error envelope's `details` array — what the admin UI
shows as "in use by" — names only the records the requesting reader may see;
the Platform administrator's lists them all. A recursive folder delete asks the
same question for every file in the folder at once and refuses when any is in
use.

### For developers: reader-restricted references

A contributor pushes an `AssetReferenceDescriptor` (from
`@endora-commerce/contracts`) into the library's reference registry from a
contribution-only boot hook. Two things in it decide visibility.

**Attribution.** `findReferences(assetIds)` returns `AssetReferenceHit[]`:
each reference carries the `assetId` it points at, and the descriptor answers a
batch of ids in **one** statement. A descriptor that still returns plain
`AssetReference`s compiles and is answered correctly — the registry asks it
again one asset at a time wherever it must attribute a batch — but it costs a
statement per asset. The library strips `assetId` before a reference reaches
the wire.

**`readerRestriction`.** An optional, readonly data property. Absent, the
descriptor's references never hide an asset (catalog, CMS, blog, menus).
Present, they are reader-restricted, and the owner answers for the **ambient
caller**:

```ts
interface AssetReferenceReaderRestriction {
  /** Of these record ids, the ones the caller may see. */
  visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Every asset id a record the caller may NOT see points at — the exact complement. */
  assetIdsWithHiddenReferences(): Promise<readonly string[]>;
  /** Every asset id any record of this kind points at; asked while the owner is off. */
  allReferencedAssetIds(): Promise<readonly string[]>;
}
```

- Use the rule the owner's own screens use, and write the hidden set NULL-safe
  (`(<visible>) is not true`), so a row the predicate cannot decide is hidden.
- Take the services it needs as getters resolved per call, never at boot, and
  do not probe the module's own presence: the library decides presence. While
  the owner is switched off, only `allReferencedAssetIds` is called, so it must
  be plain SQL over the owner's own tables that resolves no port.
- The library classifies the caller first. The system actor and a holder of `*`
  see every asset and no owner is asked; a customer, an API key or a request
  with no administrator sees no restricted record and no owner is asked either.
- Cost per request, not per asset: a list page asks each restricted descriptor
  `assetIdsWithHiddenReferences` once; the library keeps the candidates its own
  filters (folder, search) would list, then asks each descriptor's
  `findReferences` and each owner's `visibleEntityIds` once for all of them
  together, because another reference may still make a candidate visible.

**`assetReadPort.visibleToCaller(assetIds)`** answers which of the ids the
ambient caller may see in the library — a missing id, a hidden one and a
non-uuid are all absent. A module that lets a caller attach an existing library
file asks it **before** any other refusal that describes the file (its
visibility, its type), so a hidden file and a missing one get one answer. The
port's other methods are unfiltered: they serve modules that decide by their
own record's rules. `assetsLibraryPort.getAsset` answers the detail with the
references the caller may see.

## Pluggable storage adapters

Each backend implements the `StorageAdapter` SPI in
`packages/modules/assets_library/src/backend/services/storage/`. Adding a fourth
backend (Azure Blob, Backblaze B2, …) is a matter of dropping in a new
class that implements:

```ts
selfCheck(): Promise<{ ok: boolean; reason?: string }>;
newLocator({ assetId, originalFilename }): string;
put({ locator, mimeType, visibility, stream, sizeBytes, cacheControl?, contentDisposition? }): Promise<void>;
resolveUrl({ locator, visibility, ttlSec? }): Promise<{ url; expiresAt }>;
open({ locator }): Promise<NodeJS.ReadableStream>;
delete({ locator }): Promise<void>;
copy({ from, to, visibility, mimeType, cacheControl?, contentDisposition? }): Promise<void>;
setVisibility?({ locator, visibility }): Promise<void>;
```

`copy` is a server-side copy that a reader of `to` sees whole or not at all,
and it sets the destination's ACL explicitly. Register the class in
`AdapterRegistry.build`. See the existing `LocalFsStorageAdapter`,
`S3StorageAdapter`, and `GcsStorageAdapter` for templates.

## Legacy escape hatch

Pre-existing `assets` rows whose `storage_url` was a URL this platform did not
issue are tagged `storage_backend = 'legacy'` at migration time. The legacy
resolver returns the URL verbatim for `public` assets — rebasing it onto the
public API origin when the stored value is host-relative — and refuses to flip
them to `private` (we cannot sign URLs we didn't issue), which surfaces as
`409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN` to the admin. The file route redirects
a legacy asset to its stored URL when that is an `http(s)` URL and answers
`404 ASSET_FILE_MISSING` otherwise; a legacy asset cannot be replaced
(`409 ASSET_LEGACY_CANNOT_REPLACE`). Re-upload through the active adapter to
upgrade.

A row with no storage key — a file inserted directly into the database, such
as the demo data's inline `data:` images — is treated the same way: replace and
restore answer `409 ASSET_LEGACY_CANNOT_REPLACE`, and the asset detail answers
`replaceable: false`, so the drawer offers no **Replace file**. The legacy rows
above answer `replaceable: false` too.
