---
---

No release: one integration test changes (`backend/test/integration/demo/demo-shop.test.ts`). It
now counts `audit_log_entries` without the `tenant.escape_hatch` rows every composing process
appends, and asserts those as what a `demo seed` run owes instead. Nothing a package publishes
changes.
