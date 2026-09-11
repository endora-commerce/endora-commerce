---
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/platform': minor
---

Every URL `assets_library` produces is absolute, and the module resolves the public API
origin itself (owner ruling **D-223**).

**What an upgrader sees.** `AssetDetail.url`, `AssetSummary.url`,
`getAssetUrlResponse.url`, a CMS embed's `url` and a product feed's image URL all carry an
origin now. On a deployment that never set `assets.local.public_url_base` — the shipped
default, blank — the same asset used to answer `/assets/file/<id>`:

```diff
-{ "url": "/assets/file/2b1c…" }
+{ "url": "https://api.example.com/assets/file/2b1c…" }
```

Nothing breaks on the day this lands: both frontend helpers (`toAbsoluteAssetUrl` in the
storefront and in `@endora-commerce/admin-kit`) pass an absolute URL through untouched, and
`absolutizeMediaUrl` in `@endora-commerce/cms-components` does the same. What does change is
any consumer that **compares** or **stores** the string — a test asserting
`'/assets/file/…'`, a cache key, a stored HTML body diffed against a fresh render. It is a
`major` for that reason and not because a signature moved.

**The precedence, which an operator may rely on.** A configured base still wins:
`assets.local.public_url_base`, `assets.s3.public_base_url` and `assets.gcs.public_base_url`
are unchanged in meaning. Blank now means *this deployment's public API origin* for
local-FS, and still means *the bucket's own origin* for S3 and GCS — pointing a bucket
object at the API host would name a host that does not serve those bytes. A configured base
written as a path (`/media`) is rebased onto the API origin rather than left relative.

**Two required options** — a module composed by the kernel gets them from
`registerModule`, so this is only a break for a caller constructing the module by hand:
`assetsLibraryModule({ publicApiBaseUrl })` and `new AdapterRegistry({ publicApiBaseUrl })`,
plus `publicApiBaseUrl` on each adapter's own options. Required rather than optional
deliberately: an omitted origin is not a failure, it is a host-relative URL inside an
e-mail, a push payload and a partner's feed.

`legacyAssetResolver` (the `storage_backend='legacy'` resolver) is now the factory
`createLegacyAssetResolver(publicApiBaseUrl)`. It still serves a stored absolute URL
verbatim; a stored host-relative one is rebased.

**`@endora-commerce/platform`**: `absolutizePublicUrl` is no longer exported from
`@endora-commerce/platform/composition`. It existed for the two composition-root sites that
rebased an asset URL, and those are gone — a consumer that rebases a URL the module already
made absolute is a consumer that can disagree with it. The declaration is untouched in
`kernel/public-api-base-url.ts` and returns to the barrel the day an application needs one.
`./composition` is a host-internal subpath, so no module could name it.
