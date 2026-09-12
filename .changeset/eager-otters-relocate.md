---
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-price-lists': minor
---

Two tables are created by the packages that own them: `api_keys` and `customer_groups`
(`specs/120-migration-closure-bridge-ownership/` Phase 3, FR-014 and the owner's ruling of
2026-09-12).

Both were created by whichever module needed them first rather than by the one that owns them. That
is normally harmless — 27 such creations stay where they are, because a consumer who omits the
creating module gets an empty table and nothing worse — and these two were not, because each also
produced a reference from outside the referencing module's dependency closure: a fresh database
could not be migrated by a member set that omitted the creator.

**They move between two already-applied migration bodies, and that is the whole design.** The
ordinary repair — take the statement out and re-add it in a new migration — is right for a
*reference*, which can only move later in the computed order. It is wrong for a *creation*: a new
migration runs after the entire frozen historical prefix, and both tables are referenced by
migrations inside it, so the creation would have landed after its own consumers and broken a fresh
database. Each creation therefore moves into the frozen body that carries the **earliest** reference
to it, so no position in between is affected.

**No class is renamed.** `mikro_orm_migrations` persists the class name and holds no checksum
(measured on `@mikro-orm/migrations@6.6.13`), so neither edited body is re-offered to a database
that has applied it, and nothing is pending anywhere from this change.

**`create table if not exists`, and it is load-bearing rather than defensive.** A database that
applied the *donating* migration and has not yet reached the *receiving* one — anything a release or
more behind — already has the table while the receiving migration is pending. A verbatim creation
fails there; the guarded one is a no-op. Both spellings were measured against a fully migrated
database: guarded skips, unguarded raises `relation already exists`.

**`@endora-commerce/mod-api-keys`** — `Migration20260724T173916ApiKeysDistributorBinding` now creates
`api_keys` and its `key_hash` index, above its own `alter table`, and drops the table in `down()`.
Its position already preceded both frozen references — its own `alter`, and `orders`' foreign key.

**`@endora-commerce/mod-webhooks`** — `Migration20260425T091359WebhooksUs7Init` no longer creates
`api_keys`. The two modules were one surface until the US7 split and the creation stayed behind;
this package names `api_keys` in no statement of its own. A consumer installing `mod-webhooks`
without `mod-api-keys` no longer receives the table, which is the point: it is not this package's.

**`@endora-commerce/mod-customer-accounts`** — `Migration20260611T140403CustomerAccountsLifecycle`
now creates `customer_groups`, above the foreign key it already had to it, and drops the table in
`down()`. This package's `CustomerGroup` entity has always owned the table.

**`@endora-commerce/mod-price-lists`** — `Migration20260426T075235PriceListsPricingInit` no longer
creates `customer_groups`. Tiered pricing needed customer groups first and created them where it
needed them; nothing in this package references the table — `price_list_assignments.customer_group_id`
is a nullable column with an index and no foreign key.
