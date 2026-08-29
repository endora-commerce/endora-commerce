---
'@endora-commerce/platform': minor
---

The package's sources are now its own: `kernel`, `http`, `tenancy`, `commands` and `events`
live in `packages/platform/src/`, and `tsconfig.build.json` compiles them with
`rootDir: "./src"`.

**No exported symbol, subpath or type changes.** The five enumerated subpaths and their
contents are byte-identical, and a consumer's imports need no edit:

```ts
import { lazyPort, SalesChannel } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
```

**What changes is identity.** The package used to emit `dist/` from
`rootDir: ../../backend/src`, so its artefact was the application's own five directories
*compiled a second time*. The application ran the originals; anything resolving the bare
specifier ran the copy. Measured across the two: **59 identity-bearing exports, none of them
shared** — `new HttpError(…) instanceof HttpError` was `false` across the boundary, so a
packaged module's every 404 and 409 rendered as a 500; `effectiveState` and
`getResolvedChannel` were module-scoped singletons the host never populated; and
`MikroORM.init` over both copies of `SalesChannel` threw
`MetadataError: Duplicate entity names are not allowed`.

Everything the acceptance fixture took from the host was a **type**, and types are erased —
which is why nothing had noticed, and why the criterion could be 9/9 throughout. There is now
exactly one copy of every one of those 59 values, and
`backend/test/unit/kernel/platform-single-copy.test.ts` fails if a second one returns.

The package also declares `"endora": { "type": "platform" }`, the block the host's own tooling
reads to find it — the same shape a module package uses for `{ "type": "module", "id" }`.
