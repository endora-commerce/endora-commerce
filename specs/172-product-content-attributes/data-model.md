# Data model: Product content attributes

**Feature**: `specs/172-product-content-attributes/` | **Research**: [research.md](./research.md)

One new table, owned by `catalog`. No column is added to an existing table; no other module's
schema changes (`custom_field_definitions.value_type` is `varchar(16)` with no CHECK, so the new
value needs no `custom_fields` migration — research R-4).

## 1. Content attribute (no new storage — a value of existing rows)

A content attribute is an ordinary product attribute whose definition has
`value_type = 'page_builder'`. Its two halves live where every attribute's do (feature 061):

| Half | Table (owner) | Fields that matter here |
| --- | --- | --- |
| Definition | `custom_field_definitions` (`custom_fields`) | `entity_type = 'product'`, `key` (immutable), `label`, `label_default`, `value_type = 'page_builder'`, `required = false` |
| Extension | `product_attributes` (`catalog`) | every capability flag `false`; `language_scoped = true`; `select_display = null`; `numeric_kind = null` |
| Set membership | `attribute_set_attributes` (`catalog`) | `custom_field_definition_id`, `position` — unchanged semantics (OR-2, FR-006) |

### Invariants (enforced by `content-attribute-rules.ts`, research R-6)

| Field | Required value | On violation |
| --- | --- | --- |
| `isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`, `isComparable`, `quickSearchable`, `isPromoRule`, `isPriceRule`, `massEditable`, `isVisibleOnProductPage`, `channelScoped`, `isRequired` | `false` | `400 VALIDATION_FAILED`, `details[].path` = the flag, `issue` = `not available for Page Builder content` |
| `languageScoped` | `true` (written `true` when omitted on create) | same, path `languageScoped` |
| `valueType` | immutable to and from `page_builder` | `409 VALIDATION_FAILED` (catalogue); `value_type_locked` (apply seam, defence in depth) |
| Definition `entityType` | must carry the registry marker `pageBuilderValues` (only `product`) | `value_type_unsupported` definition failure → `400` on the generic route, `400 VALIDATION_FAILED` through the catalogue |

### Type vocabularies (research R-4)

| Vocabulary | Schema | New member |
| --- | --- | --- |
| Custom-field value type | `customFieldValueTypeSchema` (`contracts/src/custom-fields.ts`) | `page_builder` |
| Legacy/DB attribute type (`CatalogAttributeView.valueType`) | `attributeValueTypeSchema` (`contracts/src/catalog.ts`) | `page_builder` |
| Admin API attribute type (`type`) | `apiAttributeTypeSchema` (`contracts/src/catalog.ts`) | `page_builder` |

Mapping: `page_builder` ⇄ `{ cfValueType: 'page_builder', selectDisplay: null, numericKind: null }`
⇄ `page_builder` (API). `CUSTOM_FIELD_FILTER_OPERATORS.page_builder = []`.

## 2. `ProductContentValue` — table `product_content_values` (new, `catalog`)

Entity: `packages/modules/catalog/src/backend/entities/product-content-value.entity.ts`,
`@GlobalEntity()` (products and attributes are platform-global catalogue data; Principle XI is
satisfied by the product read path, not by this row — research R-11).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | PK, `randomUUID()` |
| `product_id` | `uuid` | no | — | FK → `products(id)` **on delete cascade** |
| `product_attribute_id` | `uuid` | no | — | FK → `product_attributes(id)` **on delete cascade** |
| `content` | `jsonb` | no | — | `{ "languages": { "<code>": <Page Builder document> } }`, ≥ 1 language, every language has ≥ 1 block (normalised on write, R-2); ≤ `PAGE_BUILDER_CONTENT_MAX_BYTES` (1 048 576) UTF-8 bytes of its JSON |
| `summary` | `jsonb` | no | `'{}'` | `{ "<code>": { "blocks": int ≥ 1, "excerpt": string ≤ 120 \| null } }` — derived from `content` on every write (R-3); never written by anyone else |
| `created_at` | `timestamptz` | no | — | `onCreate` |
| `updated_at` | `timestamptz` | no | — | `onUpdate` |

**Constraints and indexes**

- `unique (product_id, product_attribute_id)` — FR-010, at most one value per product × attribute.
  It also serves every per-product read (leading column).
- `index (product_attribute_id)` — the FR-007 count, the attribute-delete removal and the cascade.
- No index on `content`: the only query that looks inside it is the asset-reference lookup, which
  walks the batch once per delete attempt (as `categories.content` has none,
  `20261008T092714_catalog_category_content.ts`).

**Lifecycle / state**

```text
 (no row) ──PUT with ≥1 non-empty language──▶ row(content, summary)
 row ──PUT with ≥1 non-empty language──▶ row (replaced; last save wins, per attribute)
 row ──PUT null, or every language empty──▶ (no row)                       [FR-013]
 row ──attribute leaves product's set / product moves set──▶ row (kept, invisible) [FR-061]
 row ──attribute rejoins set──▶ row (visible again)
 row ──product duplicated──▶ row + copy on the new product                  [FR-060]
 row ──product soft-deleted──▶ row (unreachable: every read requires p.deleted_at is null) [FR-062, OR-6]
 row ──product row purged──▶ (no row, FK cascade)     [no purge exists in the tree today]
 row ──attribute deleted (delete Command)──▶ (no row, explicit delete + cascade) [FR-007]
 row ──CMS switched off / on──▶ row (byte-identical)                        [FR-050, FR-052]
```

**Migration** (planned by ownership, not by number — `module-migrations.md`): one `catalog`
migration scaffolded with
`pnpm --filter backend run migration:new -- --module catalog --name product_content_values`,
class name `Migration<STAMP>CatalogProductContentValues`. `up`: `create table` with both FKs, the
unique constraint and the index; `down`: `drop table`. Both FK targets are `catalog`'s own tables,
so no manifest `dependencies` change and no cross-module SQL. Add the class to
`packages/modules/catalog/src/migrations/index.ts` (array **and** named export — the scaffolder
prints the reminder, `backend/scripts/new-migration.ts:459-461`), then `composer:generate` writes
`backend/src/db/migrations-registry.generated.ts` and `entities-registry.generated.ts`.

## 3. Contract shapes (Zod, `packages/contracts/src/catalog.ts`)

All additive. Names are proposals the implementation may tighten, not widen.

```ts
/** One home for the Page Builder ceiling; the category constant aliases it. */
export const PAGE_BUILDER_CONTENT_MAX_BYTES = 1_048_576;
export const CATEGORY_CONTENT_MAX_BYTES = PAGE_BUILDER_CONTENT_MAX_BYTES; // unchanged export

/** Same envelope as categories; message names the limit. Nullable = "no value". */
export const productContentEnvelopeSchema; // { languages: Record<lang(2..35), PB tree> }, strict, ≤ max, nullable
export type ProductContentEnvelope;

export const putProductContentRequestSchema;      // { content: productContentEnvelopeSchema }, strict
export const adminProductContentSchema;           // { productId, attributeKey, content }
export const adminProductContentLanguageStatusSchema; // { language, filled: boolean, blocks: int, excerpt: string|null }
export const adminProductContentAttributeSchema;  // { attributeId, key, label, labelDefault, position, languages: [...status] }
export const adminProductContentListSchema;       // { productId, attributeSetId: uuid|null, attributes: [...] }
export const adminAttributeUsageSchema;           // { attributeSetCount, productValueCount, productContentCount }

/** Storefront: what the PDP renders, already resolved to one language per attribute. */
export const productPageContentAttributeSchema;   // { key, language: string, content: PB tree }
export const productDetailQuerySchema;            // { include?: 'content' }
// productDetailSchema gains:  contentAttributes: z.array(productPageContentAttributeSchema).optional()
```

`productDetailSchema.contentAttributes` is **optional**: absent unless `include=content` was asked
(FR-036); `[]` when asked and nothing renders, or when the CMS is not present (FR-051).

Other contract additions:

| File | Addition |
| --- | --- |
| `custom-fields.ts` | `page_builder` in `customFieldValueTypeSchema`; `page_builder: []` in `CUSTOM_FIELD_FILTER_OPERATORS`; `'value_type_unsupported'` in `CUSTOM_FIELD_DEFINITION_ERROR_CODES` |
| `catalog.ts` | `page_builder` in `attributeValueTypeSchema` and `apiAttributeTypeSchema`; `apiAttributeTypeOf` case; `CatalogBulkImportPort.contentAttributeKeys(): Promise<string[]>` |
| `assets-library.ts` | `'product_content'` in `assetReferenceKindSchema` |
| `admin-contributions.ts` | `'product.content.editor'` in `AdminZoneNameSchema`; `ProductContentEditorZoneProps`; map entry |

## 4. Zone props — `ProductContentEditorZoneProps`

```ts
export interface ProductContentEditorZoneProps {
  readonly productId: string;
  /** The content attribute being edited (immutable key). */
  readonly attributeKey: string;
  /** The content language being edited — a key of the stored envelope. */
  readonly language: string;
  /** That language's Page Builder document, or `null` when none is stored. */
  readonly data: unknown;
  /** Reports the edited document. The host saves; the contributor never does. */
  readonly onChange: (data: unknown) => void;
}
```

## 5. Audit and events

| Write | Command `action` | `objectType` / `objectId` | `before` / `after` | Event |
| --- | --- | --- | --- | --- |
| Save content | `product.content.update` | `product` / product id | `{ attributeKey, languages: string[] }` (sorted; `[]` = no value) — never documents | `product.content.updated.v1` `{ eventId, occurredAt, productId, attributeKey }` |
| Duplicate product | `product.duplicate` (existing) | unchanged | `after.contentAttributeCount` added | unchanged |
| Delete attribute (every type, OR-5) | `catalog.attribute.delete` (existing) | unchanged | `before.productContentCount` added | **new**: `attribute.updated.v1` `{ attributeKey, isSearchable: false, isFilterable: false }` (research R-21) |

Subscriber: `catalog` → `catalogProductPageRevalidation.productChanged(productId)`. No other
module subscribes; `product.updated.v1` is **not** emitted (FR-035).

## 6. Asset reference

| Kind | Descriptor | `entityId` | Label |
| --- | --- | --- | --- |
| `product_content` | `productContentDescriptor` in `catalog/src/backend/services/asset-references.ts` | product id | `Product "<name>" — content "<attribute key>"` |

Skips rows whose product is soft-deleted (`p.deleted_at is not null`).
