# Contract: `catalogProductCommandPort` and `catalogAttributeCommandPort` (Product, #1825)

Owner `catalog` (non-deactivatable). Declared in `packages/contracts/src/catalog.ts` (the scoped-values
input types stay in `packages/contracts/src/product-scopes.ts`).

Every Product write of the catalog already runs through the Command Bus (`#auditedWrite` /
`runCommand` in `packages/modules/catalog/src/backend/services/catalog-admin.service.ts`, which calls
`commandBus.run`); this story is port and delegation work, plus the side-effect parity of FR-013
(search reindex, cache invalidation, URL keys) for each operation.

## `catalogProductCommandPort`

| Method | Command action (kept) | Admin route | Readiness |
| --- | --- | --- | --- |
| `create(req, options?)` | `product.create` | `POST /api/v1/admin/catalog/products` | C |
| `update(id, req, options?)` | `product.update` | `PATCH …/products/:id` | C |
| `archive(id, options?)` | `product.archive` | `POST …/:id/archive` | C |
| `restore(id, options?)` | `product.restore` | `POST …/:id/restore` | C |
| `delete(id, options?)` | `product.delete` | `DELETE …/:id` | C |
| `createVariant(productId, req, options?)` | `product_variant.create` | `POST …/:productId/variants` | C |
| `updateVariant(productId, variantId, req, options?)` | `product_variant.update` | `PATCH …/variants/:variantId` | C |
| `deleteVariant(productId, variantId, options?)` | `product_variant.delete` | `DELETE …/variants/:variantId` | C |
| `setCustomFieldValues(id, merge, options?)` | `product.update` (attribute-values-only change; T005 confirms whether the route uses `product.content.update` for content attributes) | `PATCH …/:id` | C |
| `applyScopedValues(id, input, options?)` | `product.scoped_values.save` | `PUT …/:id/scoped-values` (T005 confirms verb) | C |

`setCustomFieldValues` writes `attribute_values` — the Product binding's `valueColumn` — and its
`merge` validates through the attribute set (`CustomFieldValuePort` does not own product attributes;
the contract says which validator the caller uses, T005). `applyScopedValues` replaces
`catalogProductScopeWritePort.applyScopes(productId, input, { source })`: `source` moves into
`AggregateCommandOptions.source`, unchanged in meaning.

**Not offered**: bundle slots, grouped items, product links, gallery, attachments, packaging units, URL
keys and redirects — sub-entities with their own Commands and admin screens; a later additive method
each when a server-side caller needs one. Duplicate (`product.duplicate`) — an editor convenience.
Bulk update and bulk import — `catalogBulkImportPort` stays the capability port for report-shaped bulk
work.

## `catalogAttributeCommandPort`

Attribute definitions are not part of the Product aggregate (#1825), and are not a custom-field host,
so this is a second, non-aggregate port of `catalog`, named in the same family.

| Method | Command action (kept) | Admin route |
| --- | --- | --- |
| `create(req, options?)` | `catalog.attribute.create` | `POST …/catalog/attributes` |
| `update(idOrKey, req, options?)` | `catalog.attribute.update` | `PATCH …/attributes/:idOrKey` |
| `delete(idOrKey, options?)` | `catalog.attribute.delete` | `DELETE …/attributes/:idOrKey` |
| `addOption(idOrKey, input, options?)` | `catalog.attribute_option.create` | `POST …/attributes/:attributeId/options` |
| `updateOption(optionId, input, options?)` | `catalog.attribute_option.update` | `PATCH …/options/:optionId` |
| `deleteOption(optionId, options?)` | `catalog.attribute_option.delete` | `DELETE …/options/:optionId` |

Reads stay on `catalogAttributeReadPort` (`listAll`, `listByFlag`, `getByIdOrKey`).

## Owner off

`catalog` is non-deactivatable; sentence as on `catalogProductReadPort`.

## Deprecated by these ports

`catalogProductWritePort` (all methods; `listAttributes*` → `catalogAttributeReadPort`),
`catalogProductScopeWritePort.applyScopes`. Integrations outside this repository use both (plan
§ Risks); they migrate during 0.113.x.

## Tests

`backend/test/contract/catalog/catalog-product-command-port.test.ts` and
`catalog-attribute-command-port.test.ts` (parity incl. reindex/cache side effects),
`backend/test/integration/catalog/catalog-product-command-port.worker.test.ts` (PIM-style scoped apply
from a worker), delegation tests for both deprecated ports.
