---
'@endora-commerce/cli': minor
---

New rule `check:extensible-tables` (`specs/178-extensible-columns/` FR-072), at `@endora-commerce/cli/rules/extensible-tables.js` and hosted by `endora check` for a module package that owns an extensible table: in an `up()` of such a module's migration, `drop table`, `alter table … rename to`, `create table … as select … from`, `insert into … select * from` or `select * into … from` on an extensible table (`extensible-table-rebuild`), and — in the repository host — a custom-field binding whose owner is not the table's (`binding-owner-mismatch`). `sqlTableAccesses` now records a table a statement reads before it writes as a write, and reads the writes inside `do $$ … $$` blocks and `create function|procedure` bodies, which `check:module-boundary`'s R2 did not see before; one previously hidden R2 write in this repository is now ledgered.
