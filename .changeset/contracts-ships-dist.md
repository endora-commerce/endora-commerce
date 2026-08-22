---
'@b2b/contracts': major
---

`@b2b/contracts` now ships compiled JavaScript and declarations. `main`, `types` and
every `exports` subpath resolve under `./dist`; `files` is `["dist"]`.

**What changes for you.** The package no longer hands you TypeScript. Before, resolving
`@b2b/contracts` gave you `src/index.ts` and you compiled it yourself — which is why a
consumer needed `transpilePackages`, a `ts-node`/`tsx` loader, or a bundler plugin to use
it at all. Now it gives you `dist/index.js` with `dist/index.d.ts` beside it, so remove
that configuration. Nothing about the exported symbols moved: `productTypeSchema`,
`PERMISSION_CATALOGUE` and every other export keeps its name, its shape and its
`z.infer` type aliases, which are emitted as written rather than expanded.

**One specifier stops resolving.** A subpath written with a `.js` extension —

```ts
import type { CmsFieldDescriptor } from '@b2b/contracts/cms.js'; // was: src/cms.ts
```

— went through the old `"./*": "./src/*.ts"` map, where `tsc` substituted the extension.
The new map is `"./*": "./dist/*.js"`, under which the same specifier asks for
`dist/cms.js.js` and fails at **runtime only** — a type-check cannot see it. Drop the
extension:

```ts
import type { CmsFieldDescriptor } from '@b2b/contracts/cms';
```

Every extensionless subpath is unaffected.

**Every subpath carries a `types` condition.** Without one a consumer on
`moduleResolution: "Bundler"` falls back to `main` for types while resolving `dist` for
the runtime — it compiles, it runs, and the two answers come from different files.
