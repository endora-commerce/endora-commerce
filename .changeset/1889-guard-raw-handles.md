---
'@endora-commerce/platform': patch
---

The foreign-schema guard now covers the raw database handles a package migration can reach
(issue #1889). These are the migration's own `this.driver`, `this.ctx` and `this.getKnex()`,
the entity manager's `getDriver()` and `getConnection()`, the connection's client, `begin()`,
and the transaction a `getConnection().transactional(cb)` callback receives. Each of these
handles answers only the members it lists. Any other member is refused with
`ForeignSchemaWriteError`.

- The members that run SQL (`execute`) judge the statement first.
- A transaction is handed out sealed. It works only as the transaction context passed back to
  `execute(…, trx)`, `commit`, `rollback`, `begin({ ctx })` or the entity manager.
- `this.getKnex()` is a connectionless builder. It can still build SQL for `addSql`, but running
  a statement on it is refused.

What a migration may no longer do:

- run SQL directly through `getKnex().raw(…)`, a transaction object, the connection's `client`
  or `loadFile()`;
- call a driver's `native*`, `find*` or `createQueryBuilder` members (use the entity manager,
  which is guarded).

A migration that ran its own statements this way must move them to `this.execute(sql, params)`
or `addSql`. `dryRunStatements` seals the driver it offers in the same way.
