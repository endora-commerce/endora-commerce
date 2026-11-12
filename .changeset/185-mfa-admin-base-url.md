---
'@endora-commerce/mod-mfa': patch
---

`mfa` no longer declares `ADMIN_BASE_URL` in its manifest's `env` (issue #185): the platform owns
the input now, and `mfa` reads it through `configuredAdminBaseUrl()` from
`@endora-commerce/platform/kernel`. A well-formed value behaves as before, with any trailing slash
ignored. A value that is not an absolute `http`/`https` URL (`admin.example.com`, `/admin`) is now
treated as unset, so the post-sign-in redirect to the admin falls back to the development address
`http://localhost:3002` instead of being built on the malformed value.
