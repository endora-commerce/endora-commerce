---
'@endora-commerce/cli': minor
---

`@endora-commerce/cli` now owns the shared library the static-check estate is built on, and
publishes it on a `./lib/*.js` subpath.

Fifteen modules moved out of the application's `backend/scripts/lib/` into this package's
`src/lib/`, unchanged: `admin-surfaces`, `emitted-exports`, `module-package-subpaths`,
`module-packages`, `module-population`, `module-roots`, `nested-checkouts`, `platform-root`,
`platform-surface`, `read-size`, `repeating-timers`, `source-text`, `specifiers`,
`switchable-modules` and `workspace-packages`. Every exported symbol keeps its name and its
signature; a consumer writes

```ts
import { requireModuleLayout } from '@endora-commerce/cli/lib/module-roots.js';
```

`typescript` moves from `devDependencies` to `dependencies`: the relocated analyses read
literal AST nodes, the specifier survives into the emitted declarations, and a devDependency
is not installed for a consumer (D-181).

Four modules stay in the application, each because it reads something the application owns and
this package cannot: `sql-tables` and `package-declarations` reach `backend/src`'s naming
strategy, installed-package enumerator and tenant-scope registry; `runtime-assets` and
`module-package-manifest` reach the repository root's `scripts/lib/runtime-assets.mjs`, which
is plain JavaScript at the root because 66 module package builds run it under bare `node`.
They move when the host facts descriptor lands.
