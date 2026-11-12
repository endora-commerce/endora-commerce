---
'@endora-commerce/mod-mfa': patch
---

`mfa` no longer declares `ADMIN_BASE_URL` in its manifest's `env` (issue #185): the platform owns
the input now, and `mfa` reads it through `configuredAdminBaseUrl()` from
`@endora-commerce/platform/kernel`. A well-formed value behaves as before, with any trailing slash
ignored. A malformed value no longer reaches `mfa`: the platform refuses to boot on it. With the
value unset, the admin-surface sign-in redirects fall back to `http://localhost:3002` only when
`NODE_ENV` is not `production`; in production they carry no absolute admin address (a path on the
host that served the callback) and never name `localhost`. `adminRedirectBase()` in the plugin is
that rule.
