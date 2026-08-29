---
---

No package changes anything it publishes in this branch, so nothing is released by it.

What it adds is the specification and the guard for a subpath a module package **may** declare
from now on — `./ports`, type-only (D-169; owner approval of 2026-08-24). When a package first
declares one, its own changeset is a `minor` and reads, for the consumer:

> `@endora-commerce/mod-<id>` now publishes `./ports`, carrying the port **interfaces** this
> module provides and nothing else. Import them with `import type { XPort } from
> '@endora-commerce/mod-<id>/ports'`; resolve the implementation through the container under
> the name the interface's doc block gives. The subpath exports no value, no entity class and
> no runtime binding — the emitted module is empty by construction, so nothing crosses it into
> a consumer's bundle.

That subpath exists because a port whose signature carries the caller's MikroORM
`EntityManager` cannot live in `@endora-commerce/contracts`: `admin` and `storefront` compile
that package too, and it holds zero `@mikro-orm` imports on purpose. A port with no ORM type in
its signature is unaffected and stays in `@endora-commerce/contracts`.

The rule is `specs/084-small-f4-package-layout/contracts/module-package-layout.md` §2.1 R8; the
guard is `backend/test/unit/packages/module-package-ports-surface.test.ts`.
