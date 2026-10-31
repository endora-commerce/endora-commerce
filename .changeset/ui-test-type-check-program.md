---
---

Type-check configuration only: `crm`, `invoice_ledger`, `price_lists`, `projects` and `tasks` type-check their admin-layer tests in a third program, `tsconfig.ui.test.json`, which carries the Node types those tests need, and their `typecheck` script builds it. The tests no longer start with `/// <reference types="node" />`, which had made `tsconfig.ui.json` accept Node globals in every screen of those packages. Nothing a package emits changes.
