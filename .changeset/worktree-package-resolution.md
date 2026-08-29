---
---

No release meaning. Issue #255 touched two files under `packages/`:
`cms-components/tsconfig.json` and `email-components/tsconfig.json` both drop
`rootDir: "./src"`, which they needed only because `@endora-commerce/page-builder-core` used
to reach them through `node_modules` rather than through a `tsconfig.base.json`
`paths` entry. Neither package emits with `tsc` — `cms-components` builds CSS
with tailwind, `email-components` has no build — so `rootDir` constrained
nothing but the `--noEmit` program, and no exported symbol, type or runtime
behaviour moves for a consumer.
