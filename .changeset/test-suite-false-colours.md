---
---

No release: test and test-configuration changes only. `@endora-commerce/mod-invoices` swaps one
co-located test's wall-clock budget for a render count (tests are excluded from its build), and
the rest is under `backend/test/` plus the deletion of the unreferenced
`backend/vitest.pure.config.ts`; nothing a package publishes changes.
