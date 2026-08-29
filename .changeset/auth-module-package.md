---
'@endora-commerce/mod-auth': minor
---

`auth` is now a package: `@endora-commerce/mod-auth`.

Its `./backend` subpath publishes `registerModule`, the `AuthCradle` shape and
the `entities` array, plus four things a consumer must not reach through a
filesystem path into this package's source: `promoteAdminActor`,
`SessionService`, `AuthSessionReadService` / `createAuthSessionPort`, and the
`createRequireAdmin` / `createRequireAdminAny` / `createRequireCustomer` guard
factories.

`promoteAdminActor` is the one the composition root calls. It was reached at
`backend/src/modules/auth/plugin.js`; that spelling is gone and the bare
specifier replaces it, so a host that already imports `./backend` holds one copy
of this module rather than two.

The `services/password-hasher.js` re-export is **removed**. `hashPassword` and
`verifyPassword` have lived in `@endora-commerce/platform/kernel` since feature
075's Phase P; import them from there.
