---
'@endora-commerce/mod-blog': minor
---

New package: the Blog module, the first to leave `backend/src/modules/` (feature 080, T040b).

It publishes three subpaths and no root wildcard, and every one of them serves compiled
output (D-164):

- `@endora-commerce/mod-blog` — the manifest. Isomorphic, `@endora-commerce/contracts` its
  only import, and the file the generated manifest index reads the module's identity,
  permissions, palette actions and activation control from.
- `@endora-commerce/mod-blog/backend` — `registerModule(ctx)` plus the `entities` array the
  host's ORM registry spreads (see `blog-entities-array-d168.md`; this file described the
  eleven `@Entity()` classes as named exports, which they no longer are).
- `@endora-commerce/mod-blog/migrations` — the `migrations` array the platform's package loader
  reads, and `Migration20260506T081055BlogInit` by name for the host's migration registry.

`@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
`fastify`, `ioredis` and `zod`. The package holds one copy of nothing: it resolves the host
through the same `exports` map the application does, which is what keeps `HttpError`,
`SalesChannel` and `effectiveState` single in the process.

The manifest id stays `blog` — it is identity of record for the lifecycle registry, the
settings store, the permission codes, the i18n bundle paths and the migration ownership
(D-142). The npm name is only how npm keeps names unique.
