---
---

No release: test and test-configuration changes only. `@endora-commerce/mod-invoices` swaps one
co-located test's wall-clock budget for a render count, and `@endora-commerce/mod-i18n` gains its
first co-located test — with the `vitest.config.ts`, `test` script and `vitest` devDependency that
carries; tests are excluded from both builds. The rest is under `backend/test/` plus the deletion
of the unreferenced `backend/vitest.pure.config.ts`. Nothing a package publishes changes.
