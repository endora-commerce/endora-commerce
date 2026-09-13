---
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-email': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-search': minor
---

Nine modules now declare the environment inputs they own, in `manifest.env`, so a
client who installs them can be told what to put in their `.env`. Each declaration
carries an English and a Polish sentence, a requirement, and — for an `optional`
one — what is lost without it.

`health_checks` was the tenth until D-229 dissolved it into the platform; its two
declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
because the platform now declares that name and a module may not describe a
platform input a second time.

Nothing changes at runtime: no module reads a new variable and none changes how it
reads an existing one. What changes is that the requirement is now on the wire, in
the manifest the platform already carries, and reaches a consumer through the
package's own `exports` map.

Every module here declares only what it **owns**. The seven platform-owned names
these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
`PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
`SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
are deliberately not repeated here.
