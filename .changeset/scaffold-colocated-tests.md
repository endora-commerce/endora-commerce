---
'@endora-commerce/cli': patch
---

`endora new module` writes its tests beside their subjects instead of under `test/unit/`: `src/backend/manifest.test.ts` (was `test/unit/manifest.test.ts`; not `src/manifest.test.ts`, which the manifest generator refuses as a sibling of the root manifest) and, with `--admin`, `src/admin/index.test.ts` (was `test/unit/admin-contributions.test.ts`), which carries `/// <reference types="node" />` because the admin layer is compiled without Node types. The emitted `vitest.config.ts` collects `src/**/*.test.ts` only. A module package has no `test/` directory, and a test there is in no type-check program — `tsconfig.json` includes `src/**/*` alone. A package scaffolded earlier is unaffected; to have its `test/unit/` files type-checked, move each under `src/` beside its subject (never as a sibling of `src/manifest.ts`), re-point its relative imports, and drop `test/**/*.test.ts` from the `include` list in its `vitest.config.ts`.
