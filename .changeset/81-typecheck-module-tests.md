---
'@endora-commerce/cli': patch
'@endora-commerce/page-builder-core': patch
---

`endora new module` scaffolds a package whose co-located tests are type-checked: the test patterns are excluded in `tsconfig.build.json` (the emit) rather than in `tsconfig.json` (the type-check), and a package with an admin layer gets a `tsconfig.ui.build.json` that extends `tsconfig.ui.json` and adds only the test exclusion. A package scaffolded earlier keeps working; to have its `src/**/*.test.ts` files type-checked, make the same move by hand and point the `build` script's UI compile at `tsconfig.ui.build.json`.

`contextAdmits` is also exported from `@endora-commerce/page-builder-core/context-admits`, a module that imports nothing but a type, so a Node program can use the rule without compiling the editor. The export from the package root is unchanged.
