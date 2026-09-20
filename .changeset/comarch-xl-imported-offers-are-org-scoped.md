---
'@endora-commerce/mod-comarch-xl': minor
---

`XlImportedOffer` is `@OrgScoped()` and its lines follow it — an untenanted read of `xl_imported_offers` now throws

**If you query `XlImportedOffer` outside a tenant context, this release makes that call fail.**
The entity declared `organization_id uuid NOT NULL`, foreign-keyed to `organizations` `on delete
restrict` and indexed, while classifying itself `@GlobalEntity()` — so no tenant filter was
attached and every read returned every organization's rows. It is `@OrgScoped()` now, and
`XlImportedOfferLine` is `@TransitivelyScoped('XlImportedOffer', 'offer')`.

What changes for a consumer, in the order you will meet it:

- **Reads narrow.** A query under a `single-org` context returns that organization's offers; one
  under an `allowed-set` context (a scoped admin) returns the assignment's. Previously both
  returned everything. `all` and `system` contexts are unaffected — the filter returns no
  predicate for either — so the module's own workers, which run inside `enterSystemScope`, read
  and upsert across organizations exactly as before.
- **A read with no ambient tenant context throws `MissingTenantContextError`** instead of
  succeeding. The guard is fail-closed by design. If you call into this entity from outside a
  request — a script, a job of your own, a fixture — wrap it in `withSystemScope('<reason>', …)`,
  which is what the platform's escape hatch is for.
- **No migration, and no schema change.** The column, the foreign key and the index already
  existed and were already correct; only the classification moved. `@Index()` is now declared on
  the property so the entity metadata agrees with the index the migration creates — it emits no
  new DDL against a database this module has already migrated.

`minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
series a minor already takes every caret dependent out of range, which is the consumer-facing
meaning of the break.

No route, service or DTO changed. `ImportedOfferReadService` keeps its own `organizationId`
predicate: a service may narrow the guard and may never stand in for it.
