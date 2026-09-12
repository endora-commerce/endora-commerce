---
'@endora-commerce/platform': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-cms': minor
---

Each sales-channel bridge table is now created by the module that owns its far side.

Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
`cms` no longer carries a migration corpus naming `cms_pages`.

**Nothing is re-offered to a database you have already migrated, and no reset is required.**
`mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
`@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
`executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
anywhere.

**`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
`Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
`Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
channel identity columns, the backfills, the one-system-default partial unique index and the
`quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
byte-identical, so no position in the frozen prefix moves.

**Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
`sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
`create index if not exists`, and each drops its own table in `down()`. On a database that has
applied the frozen migrations every one of them is a no-op: measured on a throwaway database
migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
so no table is recreated and no row is touched. On a fresh database they are the creation, later in
the computed order than before — which is where they have to be for an instance that omits one of
these modules to migrate at all.

**One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
`module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
module's schema. That is the ownership rule doing what it says, and it is what an operator would
expect of a table whose far side has just been removed.

The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.
