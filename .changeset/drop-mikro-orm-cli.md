---
'@endora-commerce/cli': patch
---

The MikroORM CLI is not a supported entry point (issue #1865). The platform no longer installs
`@mikro-orm/cli` or carries a `mikro-orm` configuration block, and `endora new instance` is now held
by a test to never write either into an instance's manifests — it never did. An instance that added
`@mikro-orm/cli` itself loses `mikro-orm debug`, `mikro-orm migration:*` and `mikro-orm schema:*`:
remove it and use `pnpm run migrate`, `pnpm run setup` and `pnpm run module:status`. See
*The MikroORM CLI is not supported* in *Upgrading an instance*.
