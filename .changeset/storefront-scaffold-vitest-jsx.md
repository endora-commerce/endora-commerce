---
'@endora-commerce/cli': patch
---

A storefront written by `endora new storefront` or `endora install` runs its own `.tsx` tests again.
The scaffold has no lockfile and declares `vitest ^4.1.11`, so a fresh install resolves Vite 8, which
transforms with oxc and ignores the `esbuild` JSX option the storefront's `vitest.config.mts`
carried: `pnpm test` failed on every test that renders JSX with *"Failed to parse source for import
analysis … make sure to not set jsx to preserve"*. The packaged reference now declares the automatic
JSX runtime for both transformers, so the tests run under Vite 7 and Vite 8 alike.

An existing scaffolded storefront is repaired by adding
`oxc: { jsx: { runtime: 'automatic', importSource: 'react' } }` beside the `esbuild` block in its
`vitest.config.mts`.
