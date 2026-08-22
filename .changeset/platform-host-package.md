---
'@endora-commerce/platform': minor
---

New package: `@endora-commerce/platform`, the host an extension package compiles against
(feature 080, T042a; contract `specs/080-f4-real-scope/contracts/host-package.md`, rulings
D-160.1 and D-160.7).

**Five enumerated subpaths, no root export and no wildcard.**

```ts
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
```

`@endora-commerce/platform` itself, `/db`, `/overlay`, `/packages` and any deep file path are
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and that is the contract rather than an omission: a wildcard
map would publish all fourteen accidental-reach platform files as supported API — `db/index`
among them, which cannot be published at all, because it reaches the ORM configuration and
through it 219 module-owned entity references, making the host import every module. The five
subpaths are also the boundaries a five-package split would take, so that option stays open at
the price of one release.

**`@mikro-orm/core`, `@mikro-orm/postgresql`, `fastify` and `zod` are peer dependencies, and
the host is a non-optional peer of every module package** — never a `dependencies` entry.
Measured: two copies of `@mikro-orm/core` share one metadata registry (`globalThis`, no
version in the key) and the package's entity is registered and then **silently dropped from
discovery** — no throw, no warning, exit 0, and a table nobody creates. Two copies of the
*host* are the loud case, `MetadataError: Duplicate entity names are not allowed`.

The package emits from `backend/src`'s five platform directories, so nothing in the
application tree moved and every existing relative specifier is untouched.
