---
'@endora-commerce/contracts': minor
---

`ModuleDemoManifest` gains an optional `package` field — the demo-data escape hatch of
`specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §6.

It is a package **name as a string** and must never be written as an `import` specifier
anywhere in the module's sources. That is measured rather than stylistic: a module
package's `package.json` is generated, and `peerNamesOf` records every specifier
`namedSpecifiers` yields with **no filter on kind** — a walk that recognises
`dynamic-import` — so a literal `await import('@endora-commerce/mod-<id>-demo')` becomes a
*required* peer and pnpm installs the demo package for every client, which is the opposite
of what the field is for.

```diff
 const demo: ModuleDemoManifest<ModuleContext> = {
   summary: 'A demo catalogue of 200 products.',
+  package: '@endora-commerce/mod-catalog-demo',
   seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
   reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
 };
```

**The runner half is not built yet.** `@endora-commerce/platform`'s demo runner does not
resolve the name — §6.3's three answers (loads / not installed / fails to load) and §6.4's
probe-before-import are a separate change — so declaring it today records an intent and
changes no behaviour. Do not take the hatch until the runner answers all three ways.
