---
---

Test-only: the backend test files that topped up every stock level in the database (`update "stock_levels" set "on_hand" = …` with no `where`) now top up only the products they place orders for, through `topUpStock` in `backend/test/helpers/seed-commerce.ts`, and their `check:shared-table-wipes` baseline entries are removed (issue #607). No package publishes anything new.
