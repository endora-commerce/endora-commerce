# Contract: `catalogProductCommandPort` and `catalogAttributeCommandPort` (Product, #1825)

Owner `catalog` (non-deactivatable). Declared in `packages/contracts/src/catalog.ts` (the scoped-values
input types stay in `packages/contracts/src/product-scopes.ts`).

Readiness codes: research R-2, **as measured by the T005 inventory** (2026-11-26, `origin/master` at
`d936722d5`). "Route" is the admin route for the operation; "Side effects" is everything the route, or
the service method it calls, does outside the Command, which the port call must reach too (FR-013).
File references are relative to `packages/modules/catalog/src/backend/` unless they say otherwise.

Every Product and attribute write of the catalog already runs through the Command Bus — the service's
`#runCommand` / `#auditedWrite` call `commandBus.run` — so this story converts nothing; it is port,
delegation and side-effect work. The Commands are private factories of `CatalogAdminService`
(`services/catalog-admin.service.ts`), not files in `commands/`; the routes and the ports share the
**service method** that builds and runs each one, and the method's new trailing `caller` argument
carries the port's `source` and `extensions` into `withCallerOptions` (research R-19.4).

## `catalogProductCommandPort`

| Method | Command action (kept) | Admin route | Readiness | Side effects outside the Command | Work |
| --- | --- | --- | --- | --- | --- |
| `create(req, options?)` → `CatalogProductRecord` | `product.create` | `POST /api/v1/admin/catalog/products` | C (`createProduct`) | after the commit, in the service: `bindToDefaultIfEmpty('product', id)` (the default sales channel, FR-011 of feature 005); `product.created.v1` is the Command's event (search index, page revalidation, webhooks subscribe) | port only |
| `update(id, req, options?)` → record | `product.update` | `PATCH …/products/:id` | C (`updateProductAudited`) | the route, not the service, reads the completeness-gate mode and passes it in; `product.updated.v1` is the Command's event | port only, **without the gate** (finding 2) |
| `archive(id, options?)` → record | `product.archive` | `POST …/:id/archive` | C (`archiveProduct`) | `product.archived.v1`, emitted by the service after the Command, inside the event scope it opens | port only |
| `restore(id, options?)` → record | `product.restore` | `POST …/:id/restore` | C (`restoreProduct`) | none beyond the Command's `product.updated.v1` `['archivedAt']` | port only |
| `delete(id, options?)` | `product.delete` | `DELETE …/products/:id` | C (`deleteProduct`) | none; `product.deleted.v1` carries the former URL keys | port only |
| `createVariant(productId, req, options?)` → `CatalogProductVariantRecord` | `product_variant.create` | `POST …/products/:productId/variants` | C (`createVariant`, `#auditedWrite`) | `product.updated.v1` `['variants']`, emitted by the service after the Command | port only |
| `updateVariant(productId, variantId, req, options?)` → variant record | `product_variant.update` | `PATCH …/variants/:variantId` | C (`updateVariant`) | the same event | port only |
| `deleteVariant(productId, variantId, options?)` | `product_variant.delete` | `DELETE …/variants/:variantId` | C (`deleteVariant`) | the same event | port only |
| `setCustomFieldValues(id, merge, options?)` → record | `product.update` | `PATCH …/products/:id` with `attributeValues` only | C — a new mode of the `product.update` factory (`setAttributeValues`) | as `update` | **new service method** over the same factory (finding 3, R-19.2) |
| `applyScopedValues(id, input, options?)` → `ProductScopedWriteResult` | `product.scoped_values.import` | — the products import (`catalogBulkImportPort`) and the deprecated `catalogProductScopeWritePort.applyScopes` run it | C (`services/scoped-values-import.ts` `runScopedImport`) | none outside the Command: the version bump, the URL keys and `product.updated.v1` are inside it | port only; parity against the deprecated port (finding 1, R-19.1) |

**Not offered**: bundle slots, grouped items, product links, gallery, attachments, packaging units, URL
keys and redirects — sub-entities with their own Commands and admin screens; a later additive method
each when a server-side caller needs one. Duplicate (`product.duplicate`) — an editor convenience. Bulk
update (`product.bulk_update`) and bulk import — `catalogBulkImportPort` stays the capability port for
report-shaped bulk work. The scoped editor's save of one scope (`PUT …/scoped-values`,
`product.scoped_values.save`) and copy (`…/scoped-values/copy`) — the operator's atomic, gated save,
which `applyScopedValues` is not (finding 1). The scope settings (`PATCH …/scopes`,
`product.scopes.update`) — status, window, audience and order rules reach an integration as cells of
`applyScopedValues`.

## `catalogAttributeCommandPort`

Attribute definitions are not part of the Product aggregate (#1825), and are not a custom-field host,
so this is a second, non-aggregate port of `catalog`, named in the same family.

| Method | Command action (kept) | Admin route | Readiness | Side effects outside the Command |
| --- | --- | --- | --- | --- |
| `create(req, options?)` | `catalog.attribute.create` | `POST …/catalog/attributes` | C (`createAttribute`) | `publishInvalidate('product')` (the definitions cache) after the commit |
| `update(idOrKey, req, options?)` | `catalog.attribute.update` | `PATCH …/attributes/:idOrKey` | C (`updateAttributeByIdOrKey`) | the cache drop; a flip of `isSearchable` queues a `search_reindex` bulk operation, best effort — **only on the routes' service instance** (finding 4) |
| `delete(idOrKey, options?)` | `catalog.attribute.delete` | `DELETE …/attributes/:idOrKey` | C (`deleteAttribute`) | the cache drop |
| `addOption(idOrKey, input, options?)` | `catalog.attribute_option.create` | `POST …/attributes/:attributeId/options` | C (`addAttributeOption`) | the cache drop |
| `updateOption(optionId, input, options?)` | `catalog.attribute_option.update` | `PATCH …/attributes/:attributeId/options/:optionId` | C (`patchAttributeOption`) | the cache drop |
| `deleteOption(optionId, options?)` | `catalog.attribute_option.delete` | `DELETE …/attributes/:attributeId/options/:optionId` | C (`removeAttributeOption`) | the cache drop |

Reads stay on `catalogAttributeReadPort` (`listAll`, `listByFlag`, `getByIdOrKey`).

## Options

`expectedVersion` is the product's editor version (`products.scope_version`, the `PATCH` body's
`version` token): honoured by `update` and `setCustomFieldValues`, a stale one refused
`409 VERSION_CONFLICT`; a value that is not a non-negative safe integer is `422 VALIDATION_FAILED`.
Every other method, and every attribute method, ignores it. `source` is recorded on the entry
(`withCallerOptions`; the import Command records it in both states, as it always has). `extensions`:
`catalog` declares no hookable action, so the bus refuses any key `422 COMMAND_EXTENSION_UNCLAIMED`.

## Owner off

`catalog` is non-deactivatable; sentence as on `catalogProductReadPort`.

## Deprecated by these ports

`catalogProductWritePort` (all methods; `listAttributes*` → `catalogAttributeReadPort`),
`catalogProductScopeWritePort.applyScopes`. Integrations outside this repository use both (plan
§ Risks); they migrate during 0.113.x.

## Inventory findings (T005)

1. **The scoped-values route is not the scoped write.** The admin `PUT …/products/:id/scoped-values`
   runs `product.scoped_values.save` (`services/scoped-values-save.service.ts`): one scope, all of its
   fields, atomic, the completeness gate, the editor's version required. A PIM writes cells across
   scopes, per-cell tolerant, ungated, with URL keys never forced — the
   `product.scoped_values.import` Command the deprecated `applyScopes` and the products import already
   run. The contract sketch's "`applyScopedValues` replaces `applyScopes`" and its
   `product.scoped_values.save` row cannot both hold; the port runs the import (R-19.1). Parity is
   measured against the deprecated port, as R-16.2 measured Organization's `update`.
2. **The completeness gate is the routes' alone** (feature 163, A-6): the plugin composes it into the
   admin routes' `CatalogAdminService`; the container's instance — the one the published ports run —
   has none. `update` through the port is therefore never refused `SCOPE_INCOMPLETE` and answers no
   warnings, as the deprecated port never was. Kept: an integration is not an operator.
3. **There is no attribute-values-only Command and the `PATCH` cannot remove a key.** The route
   merges `attributeValues` over the stored bag (`{ ...current, ...patch }`). The `CustomFieldMerge`
   shape answers the whole bag, so a key it drops must be removed. `setAttributeValues` runs the
   `product.update` factory with the merge applied inside the transaction (R-19.2). The validator is
   the owner's, not `CustomFieldValuePort.validateAndMerge`: product attributes are required per
   attribute set, and that port's `required` rule spans every product-attribute definition.
4. **A searchable flip through the published port queued no reindex.** `setSearchReindexEnqueuer` was
   called on the plugin's instance only, so `catalogProductWritePort.updateAttributeByIdOrKey` already
   lacked it. The plugin now hands the same enqueuer to the container's instance
   (`shareSearchReindexEnqueuer`), so the port and the route queue the same operation (FR-013).
5. **Variant writes announce outside their Command.** `product.updated.v1` `['variants']` is emitted by
   the service after `#auditedWrite` returns, not as the Command's event. Unchanged — the port calls the
   same method, so the port call announces it exactly as the route does — and noted for a later
   clean-up (it could be the Command's own `event`).
6. **`source` on `applyScopes` is stricter.** The deprecated port requires a module id present in the
   registry (feature 174, R21); the aggregate ports take any code of `aggregateCommandSourceSchema`,
   absent allowed. The deprecated port keeps its rule before delegating; the new method takes the
   aggregate rule (R-19.3).
7. **Consumers.** No module of this repository resolves `catalogProductWritePort` or
   `catalogProductScopeWritePort` (only tests); the manifest edges owed are therefore none here. In
   `../paid-modules` (read only, 2026-11-26) `pim_akeneo`, `pim_unopim`, `pim_ergonode`, `pim_pimcore`
   and `comarch_xl` call both; they move during 0.113.x.

## Tests

`packages/modules/catalog/src/backend/services/catalog-command-ports.test.ts` (source, version, the
caller's options, delegation of both deprecated ports, no database),
`backend/test/contract/catalog/catalog-product-command-port.test.ts` and
`catalog-attribute-command-port.test.ts` (parity per method, `source`, refusals),
`backend/test/integration/catalog/catalog-product-command-port.worker.test.ts` (PIM-style scoped apply
from a worker under `withSystemScope`, `source` beside the `system` actor).
