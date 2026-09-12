---
'@endora-commerce/platform': patch
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-organizations': patch
---

Eight migration statements move to the module whose dependency closure guarantees the table they
name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

A migration may name a table only if its own module creates it, a module in its transitive manifest
`dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
that omitted the creating module could not migrate a fresh database at all — the failure this rule
was ruled from was `relation "cms_pages" does not exist`.

**No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
five new migrations below, each written idempotently, each a no-op against a database that already
has the object and the real change against a fresh one. Measured on a database migrated at the
previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
them, and the resulting schema byte-identical to the previous revision's fresh schema.

**`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
ordered for, the platform declaring no dependencies and so never being orderable after a module's
table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
all three of its indexes were on module-owned tables — and the class stays, because its name is on
`BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

**`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

**`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

**`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

**`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
only direction in which the closure holds.

**`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
creates that index. An instance installing this package without `cms` no longer carries a migration
that indexes a table nothing builds.

**`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
(`organizations`) and a switchable far side — and it has a visible consequence:
`module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
module id.

**`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
neither owns nor declares, and could not declare: `inventory` already declares `organizations`.
