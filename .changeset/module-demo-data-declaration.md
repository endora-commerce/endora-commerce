---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
---

A module can declare its demo data in `manifest.ts`, and the platform can run it.

**`@endora-commerce/contracts`** gains one optional field on `ModuleManifest`,
`demo`, plus `ModuleDemoManifest`, `ModuleDemoContext`, `DemoSeedResult`,
`DemoResetResult`, `DemoEntityCount`, `DemoCredential`,
`ModuleDemoManifestSchema` and `ModuleDemoDeclarationSchema`. Three states, and
they are `docs`': an object — this module ships demo rows for its own tables;
`false` — it has nothing to demonstrate, deliberately; **absent** — nobody has
decided. Write the body behind a relative `await import()`, in `cliCommands`'
shape, so a manifest every composing process loads does not pull a service graph
with it:

```ts
const demo: ModuleDemoManifest<ModuleContext> = {
  summary: 'A demo warehouse and stock for the seeded products.',
  seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
  reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
};
```

`defineModuleManifest` refuses a malformed one, and the two `demo.after` entries
that cannot mean anything: the declaring module itself, and the same id twice.
`after` is **advisory** — `permissions[].requires`' shape under D-175. It puts no
module in `dependencies`, creates no lifecycle edge and changes no migration
order, which is what lets `megamenu`'s demo order itself after `catalog`'s
without declaring a dependency it does not have.

**`@endora-commerce/platform`** gains `src/demo/` — the production guard
(relocated from `backend/src/seeds/dev-seed-guard.ts`, which is now a re-export
shim), the scope reasons, the plan, the runner and the report. It is reached by
the host CLI and by nothing else; it is deliberately **not** on the
`./composition` subpath, whose 27 symbols are D-160.14's ruled set.
`sortComponentsTopologically` and `orderModulesByDependencies` join
`stronglyConnectedComponents` on `lifecycle/services/dep-graph.ts`, so the demo
order and the migration order are one walk rather than two that can disagree.

Nothing else changes: no module declares demo data yet, `seed:dev` still runs,
and no package gains a dependency.
