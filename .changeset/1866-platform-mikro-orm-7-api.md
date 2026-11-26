---
'@endora-commerce/platform': minor
---

MikroORM 7 changes in `@endora-commerce/platform`'s own exports (issue #1866):

- `migrateUpVerified(orm, …)` (`./db`) resolves to MikroORM 7's `MigrationInfo[]` (`{ name, path? }`)
  instead of 6's `UmzugMigration[]`; `runMigrationCommand` drives `orm.migrator`.
- A guarded package migration is offered no query builder: MikroORM 6's connection-less
  `this.getKnex()` is gone with knex, and `getKysely()` is refused on its entity manager.
- `queryText(query, platform?)` (`./db`) renders a `raw()` fragment and a native query builder with
  their own parameters, and throws on a statement of a shape it cannot render instead of judging
  `[object …]` text.
- The excluded-set tenant predicate is a `raw()` subquery instead of a connection-less knex builder;
  the rows it lets through are unchanged.
- The demo reset's "no second connection" guard now holds the `pg` pool
  (`getConnection().getNativeClient()`), and refuses to start a reset when the connection offers no
  pool, rather than running unguarded.
- The schema-extension accessor queries the projection's entity rather than its name, which
  MikroORM 7 refuses on the entity manager.
