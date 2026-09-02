---
'@endora-commerce/cli': minor
---

`endora new module` emits a module's admin layer, behind a new `--admin <navSection>` flag.

Feature 091 Phase 2 made a module's admin screens arrive by the module existing: the generated
registry `admin/src/modules.generated.ts` imports every module package's `./admin` layer, and
`App.tsx` and `AppShell.tsx` render `[...host, ...registry]`. The mechanism landed with one
converted module and no way to author a second without hand-writing the layer. This is that way.

With `--admin catalog` (or any member of `AdminNavSectionNameSchema`) the command additionally
writes:

* `src/admin/index.ts` — the `AdminContributions` object and **nothing else**, so a consumer
  reaching into another module's `./admin` stays a counted boundary reach. One route whose
  `component` is a `() => import('./pages/…')` factory, and one sidebar entry, both carrying the
  permission code the module's own admin route enforces.
* `src/admin/pages/<Pascal>Page.tsx` — a screen that reads the module's own
  `GET /api/v1/admin/<route>` through `@endora-commerce/admin-kit/lib`'s `apiClient` and renders
  it with `@endora-commerce/admin-kit/ui`. Every specifier is bare: `@/…` resolves for nothing an
  installed package runs under, and the environment is never read — a screen that has to build a
  URL itself takes the published `apiBaseUrl` instead of acquiring `vite/client` types.
* `tsconfig.ui.json` — the layer's own emit configuration, sharing `rootDir`/`outDir` with the
  backend build and **replacing** the inherited `exclude` rather than extending it, which is
  otherwise `TS18003` over the one directory it compiles.
* `test/unit/admin-contributions.test.ts`, and the `nav.*` / `admin.*` keys in both bundles.

The flag is opt-in and takes the sidebar section as its value: a module with no admin surface is
a real case, and where a screen belongs in an operator's sidebar is the one judgement the tool
cannot default. It refuses a section outside the published set, and refuses without a
`--permission` — there would be no code to gate the emitted screen with.

`package.json` is still written by the platform's manifest generator and by nothing else: the
`"./admin"` subpath, the second `tsc` invocation and the React peer set are all derived from the
sources the command wrote.
