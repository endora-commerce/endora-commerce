---
'@endora-commerce/cli': patch
'@endora-commerce/mod-assets-library': patch
---

The command-coverage rule (`@endora-commerce/cli/rules/command-coverage.js`, run by
`endora check` and by `check:command-coverage`) counts `upsert` and `upsertMany` as writes
(issue #352). Like `create` and `remove`, they count only when called on an EntityManager
(`em`, `tx`, `this.em()`, …), because `upsert` is also an ordinary service method name.
A method whose only write is `em.upsert(…)` or `em.upsertMany(…)` outside `CommandBus.run`
is now reported as an unaudited write, and a `command-coverage-ignore:` comment on it is no
longer reported as stale. A module package that upserts outside a Command now has to run the
write through a Command, record an audit entry, or add a `command-coverage-ignore: <reason>`
comment.

`mod-assets-library`: the two upserts this found, the cleanup-ledger `record` and the
hard-delete job's permalink release, carry a `command-coverage-ignore` comment (storage and
retention bookkeeping with no operator behind it and nothing to undo). No behaviour change.
