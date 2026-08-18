import { z } from 'zod';
import {
  isoDateTimeSchema,
  moneySchema,
  multilingualStringSchema,
  productVisibilitySchema,
  uuidSchema,
  type ProductVisibility,
} from './common.js';
import type { FulfilmentStrategy } from './inventory.js';
import type { BulkImportReport } from './import-export.js';
import type { AttributeScope } from './product-value-resolver.js';

/**
 * Catalog module contracts — Source of truth per Principle V.
 * See specs/001-b2b-platform-foundation/contracts/catalog.contract.md.
 */

// --- Primitives --------------------------------------------------------------

/**
 * Product types. Foundation 001 used `simple | variant | grouped |
 * virtual`; feature 002 (data-model.md §1.1) renames `variant` →
 * `configurable` and adds `bundle`. The application enum is the only
 * source of truth — the DB column is `varchar(16)` with no CHECK
 * constraint (research.md R-1).
 */
export const productTypeSchema = z.enum([
  'simple',
  'configurable',
  'grouped',
  'bundle',
  'virtual',
]);
export type ProductType = z.infer<typeof productTypeSchema>;

export const productStatusSchema = z.enum(['draft', 'active', 'inactive']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** Maps legacy `archived` writes to `inactive` (feature 032). */
export function coerceProductStatusWrite(
  value: unknown,
): 'draft' | 'active' | 'inactive' | unknown {
  return value === 'archived' ? 'inactive' : value;
}

export const productStatusWriteSchema = z.preprocess(
  coerceProductStatusWrite,
  productStatusSchema,
);

export const stockModeSchema = z.enum(['categorical', 'numeric']);
export type StockMode = z.infer<typeof stockModeSchema>;

export const stockIndicatorSchema = z.enum(['available', 'to_order', 'out_of_stock']);
export type StockIndicator = z.infer<typeof stockIndicatorSchema>;

/**
 * DB-level attribute value types. Foundation 001 introduced the original
 * 5-element enum (`string | number | boolean | enum | date`). Feature 002
 * adds `multiselect` and `price` per data-model.md §1.2.
 *
 * The API-facing presentation form (`apiAttributeTypeSchema` below)
 * surfaces additional affordances (`input`, `select`, `slider`) that
 * map to this DB enum + the sibling `displayAsSlider` flag — see
 * research.md R-4 / R-7.
 */
export const attributeValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'date',
  'multiselect',
  'price',
  'select',
]);
export type AttributeValueType = z.infer<typeof attributeValueTypeSchema>;

/**
 * API-facing attribute type form for feature 002 contracts. Maps onto
 * `attributeValueTypeSchema` + `displayAsSlider` in the service layer.
 */
export const apiAttributeTypeSchema = z.enum([
  'input',
  'number',
  'select',
  'multiselect',
  'price',
  'slider',
]);
export type ApiAttributeType = z.infer<typeof apiAttributeTypeSchema>;

export const assetKindSchema = z.enum(['image', 'video', 'pdf', 'certificate', 'other']);
export type AssetKind = z.infer<typeof assetKindSchema>;

// --- Feature 012 — Attribute options (rich per-option metadata) -------------

const attributeOptionValueRegex = /^[a-z0-9_-]{1,200}$/;

export const attributeOptionSchema = z.object({
  id: uuidSchema,
  attributeId: uuidSchema,
  value: z.string().regex(attributeOptionValueRegex),
  label: z.record(z.string().min(2), z.string().min(1).max(200)),
  labelDefault: z.string().min(1).max(200),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AttributeOption = z.infer<typeof attributeOptionSchema>;

export const createAttributeOptionRequestSchema = z.object({
  value: z.string().regex(attributeOptionValueRegex),
  label: z.record(z.string().min(2), z.string().min(1).max(200)).optional(),
  labelDefault: z.string().min(1).max(200),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateAttributeOptionRequest = z.infer<typeof createAttributeOptionRequestSchema>;

export const replaceAttributeOptionsRequestSchema = z.object({
  options: z.array(createAttributeOptionRequestSchema),
});
export type ReplaceAttributeOptionsRequest = z.infer<typeof replaceAttributeOptionsRequestSchema>;

export const patchAttributeOptionRequestSchema = z
  .object({
    label: z.record(z.string().min(2), z.string().min(1).max(200)).optional(),
    labelDefault: z.string().min(1).max(200).optional(),
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export type PatchAttributeOptionRequest = z.infer<typeof patchAttributeOptionRequestSchema>;

// --- Assets (linked from catalog) -------------------------------------------

export const productAssetSchema = z.object({
  id: uuidSchema,
  kind: assetKindSchema,
  url: z.string().url(),
  altText: z.string().nullable(),
});
export type ProductAsset = z.infer<typeof productAssetSchema>;

// --- Feature 062 — external (api-key) catalog read decorations ---------------

/**
 * Availability indication mirrored from the inventory display bands the
 * storefront shows (`available` = stock not managed for the product).
 */
export const productAvailabilityBandSchema = z.enum([
  'high',
  'medium',
  'low',
  'out_of_stock',
  'available',
]);
export type ProductAvailabilityBand = z.infer<typeof productAvailabilityBandSchema>;

export const productAvailabilitySchema = z.object({
  band: productAvailabilityBandSchema,
  inStock: z.boolean(),
});
export type ProductAvailability = z.infer<typeof productAvailabilitySchema>;

/**
 * One rung of the bound Organization's resolved quantity-bracket price
 * ladder (external product detail only).
 */
export const productPriceTierSchema = z.object({
  minQuantity: z.number().int().min(1),
  amount: z.number().finite(),
  currency: z.string().length(3),
  isSale: z.boolean(),
});
export type ProductPriceTier = z.infer<typeof productPriceTierSchema>;

// --- Product summary (list response) ----------------------------------------

export const productSummarySchema = z.object({
  id: uuidSchema,
  sku: z.string().min(1).max(255),
  type: productTypeSchema,
  name: z.string(),
  slug: z.string(),
  categorySlugs: z.array(z.string()),
  primaryAssetUrl: z.string().url().nullable(),
  price: moneySchema.nullable(),
  stockIndicator: stockIndicatorSchema.nullable(),
  stockLevel: z.number().int().nullable(),
  /**
   * Feature 062 — external namespace only (`/api/v1/external/catalog/*`):
   * set to `true` for bound api-key callers when the Organization-effective
   * price resolved to `null`. Never present on the public surface.
   */
  priceUnavailable: z.boolean().optional(),
  /**
   * Feature 062 — external namespace only: channel-public availability
   * indication (band + in-stock flag), present for bound and unbound keys.
   */
  availability: productAvailabilitySchema.optional(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

// --- Product variant --------------------------------------------------------

export const productVariantSchema = z.object({
  id: uuidSchema,
  sku: z.string().min(1).max(255),
  variantAttributeValues: z.record(z.string(), z.unknown()),
  priceOverride: z.number().finite().nullable(),
  stockLevel: z.number().int().nullable(),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

// --- Product detail (PDP response) ------------------------------------------

export const seoMetaSchema = z.object({
  metaTitle: z.string(),
  metaDescription: z.string(),
  openGraph: z.object({
    title: z.string(),
    description: z.string(),
    imageUrl: z.string().url().nullable(),
  }),
});
export type SeoMeta = z.infer<typeof seoMetaSchema>;

/**
 * Forward declaration so productDetailSchema can reference link summaries.
 * The exported `productLinkSummarySchema` below is the canonical name —
 * this `*Inline` alias exists only to avoid a circular import.
 */
const productLinkSummarySchemaInline = z.object({
  id: uuidSchema,
  kind: z.enum(['related', 'up_sell', 'cross_sell']),
  position: z.number().int().nonnegative(),
  product: z.object({
    id: uuidSchema,
    sku: z.string(),
    slug: z.string(),
    name: z.string(),
    primaryAssetUrl: z.string().nullable(),
    price: moneySchema.nullable(),
  }),
});

export const productDetailSchema = productSummarySchema.extend({
  description: z.string(),
  attributeValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  assets: z.array(productAssetSchema),
  variants: z.array(productVariantSchema),
  categories: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      slug: z.string(),
    }),
  ),
  seo: seoMetaSchema,
  structuredDataJsonLd: z.record(z.string(), z.unknown()),
  /**
   * Feature 002 — the AttributeSet wired to this Product. Optional so
   * foundation-era clients (and any storefront cache that hasn't been
   * refreshed yet) keep parsing the response. Once admin UI + storefront
   * consume this field everywhere, it can be tightened to required.
   */
  attributeSet: z
    .object({
      id: uuidSchema,
      code: z.string(),
      name: multilingualStringSchema,
    })
    .optional(),
  /**
   * Feature 002 US3 — gallery items with their assigned labels. Each
   * item carries the Asset's resolved url + kind so storefront PDP
   * doesn't need a follow-up fetch. Optional for the same backwards-
   * compat reason as attributeSet.
   */
  gallery: z
    .array(
      z.object({
        id: uuidSchema,
        position: z.number().int().nonnegative(),
        labels: z.array(z.enum(['base_image', 'small_image', 'thumbnail'])),
        asset: z.object({
          id: uuidSchema,
          kind: z.string(),
          url: z.string(),
        }),
      }),
    )
    .optional(),
  /**
   * Feature 002 US5 — composite product payloads. Discriminated by
   * `type`: only one of these is populated at a time. Optional so
   * foundation-era simple/configurable products keep parsing.
   *   - `groupedItems`: when type='grouped', children with quantities
   *   - `bundleSlots`:  when type='bundle', slots with their options
   *   - `virtual`:      when type='virtual', download asset/url
   */
  groupedItems: z
    .array(
      z.object({
        id: uuidSchema,
        position: z.number().int().nonnegative(),
        quantity: z.number().int().positive(),
        product: z.object({
          id: uuidSchema,
          sku: z.string(),
          slug: z.string(),
          name: z.string(),
          primaryAssetUrl: z.string().nullable(),
          price: moneySchema.nullable(),
        }),
      }),
    )
    .optional(),
  bundleSlots: z
    .array(
      z.object({
        id: uuidSchema,
        name: multilingualStringSchema,
        minQuantity: z.number().int().nonnegative(),
        maxQuantity: z.number().int().positive(),
        position: z.number().int().nonnegative(),
        options: z.array(
          z.object({
            id: uuidSchema,
            defaultQuantity: z.number().int().positive(),
            position: z.number().int().nonnegative(),
            product: z.object({
              id: uuidSchema,
              sku: z.string(),
              slug: z.string(),
              name: z.string(),
              primaryAssetUrl: z.string().nullable(),
              price: moneySchema.nullable(),
            }),
          }),
        ),
      }),
    )
    .optional(),
  virtual: z
    .object({
      downloadAssetId: uuidSchema.nullable(),
      downloadUrl: z.string().nullable(),
    })
    .optional(),
  /**
   * Feature 002 US4 — pre-grouped Product Links surfaced on the PDP.
   * Optional for the same backwards-compat reason as the other US3/US4
   * fields. Inactive targets and channel-restricted ones are pre-filtered
   * by `ProductLinkService.listForStorefront`.
   */
  links: z
    .object({
      related: z.array(productLinkSummarySchemaInline),
      upSell: z.array(productLinkSummarySchemaInline),
      crossSell: z.array(productLinkSummarySchemaInline),
    })
    .optional(),
  /**
   * Feature 002 US3 — product attachments with their type + Asset.
   * Optional like the rest.
   */
  attachments: z
    .array(
      z.object({
        id: uuidSchema,
        position: z.number().int().nonnegative(),
        name: z.string(),
        description: z.string().nullable(),
        type: z.object({
          id: uuidSchema,
          code: z.string(),
          name: multilingualStringSchema,
        }),
        asset: z.object({
          id: uuidSchema,
          kind: z.string(),
          url: z.string(),
          filename: z.string(),
          sizeBytes: z.number(),
          mimeType: z.string(),
        }),
      }),
    )
    .optional(),
  /**
   * Feature 012 / FR-030 — every attribute that meets BOTH conditions:
   *   1. attribute.isVisibleOnProductPage === true
   *   2. product.attributeValues[attribute.key] is non-null + non-empty
   * For select / enum / multiselect types, `valueRendered` is the
   * resolved per-locale option label (with fallback to labelDefault).
   * For other types it's a formatted string ('123.45', 'Yes', etc.).
   * Optional for backwards-compat with foundation-era cached responses.
   */
  visibleAttributes: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        valueType: attributeValueTypeSchema,
        valueRendered: z.string(),
      }),
    )
    .optional(),
  /**
   * Feature 043 — named packaging units (e.g. "Paleta" = 480 pieces) the
   * buyer can order by. Present only for eligible product types
   * (simple / configurable); omitted or empty otherwise.
   */
  packagingUnits: z
    .array(
      z.object({
        id: uuidSchema,
        name: z.string(),
        baseQuantity: z.number().int().positive(),
        position: z.number().int().nonnegative(),
        isDefault: z.boolean(),
      }),
    )
    .optional(),
  /**
   * Feature 062 — external namespace only: the bound Organization's resolved
   * quantity-bracket price ladder. Never present on the public surface nor
   * for unbound api-key callers.
   */
  priceTiers: z.array(productPriceTierSchema).optional(),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

// --- Feature 062 — external bulk pricing (`POST /api/v1/external/catalog/prices`) ---

export const catalogBulkPriceRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(200),
});
export type CatalogBulkPriceRequest = z.infer<typeof catalogBulkPriceRequestSchema>;

export const catalogBulkPriceMissReasonSchema = z.enum([
  'sku_not_in_assortment',
  'price_unavailable',
]);
export type CatalogBulkPriceMissReason = z.infer<typeof catalogBulkPriceMissReasonSchema>;

/**
 * Per-line result, order-preserving. Misses are data, not errors — the
 * partner needs a total answer for a basket. `amount` is the exact decimal
 * string the pricing resolver charges the bound org on the bound channel at
 * that quantity (SC-001 parity with cart pricing).
 */
export const catalogBulkPriceLineSchema = z.union([
  z.object({
    sku: z.string(),
    quantity: z.number().int(),
    price: z.object({
      amount: z.string(),
      currency: z.string().length(3),
      isSale: z.boolean(),
      bracketStartQuantity: z.number().int(),
      priceListId: uuidSchema,
    }),
  }),
  z.object({
    sku: z.string(),
    quantity: z.number().int(),
    price: z.null(),
    reason: catalogBulkPriceMissReasonSchema,
  }),
]);
export type CatalogBulkPriceLine = z.infer<typeof catalogBulkPriceLineSchema>;

export const catalogBulkPriceResponseSchema = z.object({
  data: z.array(catalogBulkPriceLineSchema),
});
export type CatalogBulkPriceResponse = z.infer<typeof catalogBulkPriceResponseSchema>;

// --- Category tree ----------------------------------------------------------

// Self-referential recursive type: CategoryNode has children: CategoryNode[]
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
  children: CategoryNode[];
}

export const categoryNodeSchema: z.ZodType<CategoryNode> = z.lazy(() =>
  z.object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    sortOrder: z.number().int(),
    productCount: z.number().int().nonnegative(),
    children: z.array(categoryNodeSchema),
  }),
);

// --- Filter definitions (for storefront filter panel) -----------------------

export const filterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type FilterOption = z.infer<typeof filterOptionSchema>;

export const filterRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});
export type FilterRange = z.infer<typeof filterRangeSchema>;

export const filterDefinitionSchema = z.object({
  attributeKey: z.string(),
  label: z.string(),
  valueType: attributeValueTypeSchema,
  options: z.array(filterOptionSchema).optional(),
  range: filterRangeSchema.optional(),
  /**
   * Feature 012 / FR-027 — ascending sort order on the storefront
   * filter sidebar. Ties are broken alphabetically by `label`. The
   * service pre-sorts the response so consumers don't need to.
   */
  filterPosition: z.number().int().min(0).default(0),
});
export type FilterDefinition = z.infer<typeof filterDefinitionSchema>;

// --- Admin write-surface requests -------------------------------------------

// Base shape (no cross-field refine) so updateProductRequestSchema can
// `.partial()` it. The cross-field rule for virtual download fields is
// applied as a separate refine on the create variant below.
const baseProductRequestObject = z.object({
  sku: z.string().min(1).max(255),
  type: productTypeSchema,
  name: multilingualStringSchema,
  description: multilingualStringSchema,
  categoryIds: z.array(uuidSchema),
  attributeValues: z.record(z.string(), z.unknown()),
  stockMode: stockModeSchema.optional(),
  visibility: productVisibilitySchema,
  // Feature 022 — accepted by the single-product PATCH and the bulk
  // update endpoint. Cross-field rule on `archivedAt` is enforced in
  // the service layer (CatalogAdminService.updateProduct).
  // Feature 032 — `archived` write alias → `inactive`.
  status: productStatusWriteSchema.optional(),
  allowedOrganizationIds: z.array(uuidSchema).optional(),
  assetIds: z.array(uuidSchema).optional(),
  initialStock: z.number().int().nonnegative().optional(),
  /**
   * Feature 002 — Attribute Set the Product is wired to. Optional in the
   * request: when omitted, the system Default Set is used.
   */
  attributeSetId: uuidSchema.optional(),
  /**
   * Feature 002 — virtual product download fields (data-model.md §1.1).
   * Exactly one MUST be set when type='virtual'; both MUST be null on
   * any other type. Refine below enforces the cross-field rule on the
   * create-side; updates land it via service-layer guard (T047).
   */
  downloadAssetId: uuidSchema.nullable().optional(),
  downloadUrl: z.string().url().max(2048).nullable().optional(),
  /**
   * Feature 010 — per-product stock-management flags.
   * `manageStock=false` ⇒ storefront treats the product as always available.
   * `backorderEnabled=true` ⇒ zero-stock checkout is accepted with the
   * resulting allocation flagged `is_backorder = true`.
   * `lowStockThreshold` is the cumulative on-hand at-or-below which an
   * email alert fires. `fulfilmentStrategy` overrides the global strategy
   * for this product; `fulfilmentStrategyWarehouseOrder` carries the walk
   * order used when the strategy is `defined_order`.
   */
  manageStock: z.boolean().optional(),
  backorderEnabled: z.boolean().optional(),
  lowStockThreshold: z.number().int().nonnegative().nullable().optional(),
  /**
   * Determines how `lowStockThreshold` is interpreted.
   *  - `'cumulative'`: one threshold against the cumulative on-hand.
   *  - `'per_warehouse'`: per-(product, warehouse) thresholds maintained
   *    via the inventory admin surface; the value of `lowStockThreshold`
   *    is then unused.
   */
  lowStockThresholdMode: z.enum(['cumulative', 'per_warehouse']).optional(),
  fulfilmentStrategy: z
    .enum(['any', 'default_first', 'lowest_stock_first', 'highest_stock_first', 'defined_order'])
    .nullable()
    .optional(),
  fulfilmentStrategyWarehouseOrder: z.array(uuidSchema).nullable().optional(),
});

export const createProductRequestSchema = baseProductRequestObject.refine(
  (v) => {
    const hasAsset = v.downloadAssetId != null;
    const hasUrl = v.downloadUrl != null;
    if (v.type === 'virtual') return hasAsset !== hasUrl; // exactly one of
    return !hasAsset && !hasUrl; // non-virtual must have neither
  },
  {
    message:
      'virtual products require exactly one of `downloadAssetId` or `downloadUrl`; non-virtual products MUST have neither.',
    path: ['downloadUrl'],
  },
);
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

// `type` is immutable after creation (409 FIELD_IMMUTABLE if sent).
// Feature 012 / FR-016 — `sku` is now editable. Collision with another
// product's SKU is refused with 400 sku_in_use; snapshot tables on
// orders / quote-requests / invoices keep displaying the SKU value
// frozen at snapshot time.
export const updateProductRequestSchema = baseProductRequestObject
  .partial()
  .omit({ type: true });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

// Admin batch-by-id lookup. The body carries the id set (deduped server-
// side) plus optional pagination so callers can stream large lookups
// across multiple requests. Hard cap of 500 ids per call mirrors the
// service-layer `pageSize` ceiling and keeps a single request bounded.
export const batchByIdProductsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).max(500),
  page: z.number().int().min(0).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
});
export type BatchByIdProductsRequest = z.infer<typeof batchByIdProductsRequestSchema>;

// ---------------------------------------------------------------------------
// Feature 033 — Resolve product IDs by list filters (collection selection)
// ---------------------------------------------------------------------------

export const MAX_RESOLVE_SELECTION_SIZE = 10_000;

export const resolveProductIdsRequestSchema = z.object({
  status: productStatusSchema.optional(),
  type: productTypeSchema.optional(),
  q: z.string().trim().min(1).optional(),
  includeArchived: z.boolean().optional(),
});
export type ResolveProductIdsRequest = z.infer<typeof resolveProductIdsRequestSchema>;

export const resolveProductIdsResponseSchema = z.object({
  data: z.object({
    productIds: z.array(uuidSchema),
    total: z.number().int().nonnegative(),
  }),
});
export type ResolveProductIdsResponse = z.infer<typeof resolveProductIdsResponseSchema>;

// ---------------------------------------------------------------------------
// Feature 022 — Products Bulk Edit
// ---------------------------------------------------------------------------

const bulkEditModeSchema = z.enum(['add', 'replace']);
// Categories also support `remove` (subtract the given categories from each
// product's current memberships); sales channels keep the two-mode enum.
const bulkEditCategoryModeSchema = z.enum(['add', 'replace', 'remove']);

const bulkUpdateFieldsObject = z.object({
  status: productStatusWriteSchema.optional(),
  visibility: productVisibilitySchema.optional(),
  salesChannels: z
    .object({
      mode: bulkEditModeSchema,
      channelIds: z.array(uuidSchema),
    })
    .optional(),
  categories: z
    .object({
      mode: bulkEditCategoryModeSchema,
      categoryIds: z.array(uuidSchema),
    })
    .optional(),
  // Feature 022 — assign (or clear, with null) the Attribute Set on every
  // selected product.
  attributeSetId: uuidSchema.nullable().optional(),
  attributeValues: z.record(z.string(), z.unknown()).optional(),
});

export const bulkUpdateProductsRequestSchema = z.object({
  // The non-empty constraint is part of the schema (a Zod-level
  // validation failure). The 200-item soft cap is enforced inside the
  // handler so the response carries the dedicated `BULK_TOO_LARGE`
  // code along with `details.maxBatchSize` / `details.recommendedSplitInto`.
  // An upper hard limit at 10_000 prevents pathological payloads from
  // ever reaching the cap check.
  productIds: z.array(uuidSchema).min(1).max(10_000),
  fields: bulkUpdateFieldsObject.refine(
    (f) =>
      f.status !== undefined ||
      f.visibility !== undefined ||
      f.salesChannels !== undefined ||
      f.categories !== undefined ||
      f.attributeSetId !== undefined ||
      (f.attributeValues !== undefined && Object.keys(f.attributeValues).length > 0),
    { message: 'at least one field must be present' },
  ),
});
export type BulkUpdateProductsRequest = z.infer<typeof bulkUpdateProductsRequestSchema>;

export const bulkUpdateProductResultSchema = z.object({
  productId: z.string().uuid(),
  status: z.enum(['succeeded', 'skipped', 'failed']),
  reason: z
    .enum([
      'attribute_not_in_set',
      'validation_failed',
      'permission_denied',
      'concurrent_modification',
      'product_not_found',
    ])
    .optional(),
  details: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      attribute: z.string().optional(),
    })
    .optional(),
  changedFields: z.array(z.string()).optional(),
});
export type BulkUpdateProductResult = z.infer<typeof bulkUpdateProductResultSchema>;

export const bulkUpdateProductsResponseSchema = z.object({
  data: z.object({
    bulkOperationId: z.string().uuid(),
    summary: z.object({
      succeeded: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    results: z.array(bulkUpdateProductResultSchema),
  }),
});
export type BulkUpdateProductsResponse = z.infer<typeof bulkUpdateProductsResponseSchema>;

// ---------------------------------------------------------------------------
// Queued bulk operations
//
// Selections above the synchronous threshold are not applied inline.
// Instead the handler enqueues a `BulkOperation` and returns the ack
// below; the work is finished off-thread by the in-process sweeper, and
// progress is observable through the bulk-operations list endpoints.
// ---------------------------------------------------------------------------

export const bulkUpdateQueuedResponseSchema = z.object({
  data: z.object({
    queued: z.literal(true),
    bulkOperationId: z.string().uuid(),
    total: z.number().int().nonnegative(),
  }),
});
export type BulkUpdateQueuedResponse = z.infer<typeof bulkUpdateQueuedResponseSchema>;

export const bulkOperationStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);
export type BulkOperationStatus = z.infer<typeof bulkOperationStatusSchema>;

/**
 * One timestamped lifecycle event in a bulk operation's log trail, surfaced
 * in the bulk-operations detail view next to the per-element results.
 */
export const bulkOperationLogEntrySchema = z.object({
  ts: z.string(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});
export type BulkOperationLogEntry = z.infer<typeof bulkOperationLogEntrySchema>;

/**
 * Known bulk-operation kinds. `type` on the record is an open string (the
 * queue is generic), but these are the kinds the platform ships:
 *   - `product_bulk_update` — the queued large product bulk-edit (feature 022).
 *   - `search_reindex`       — a full Meilisearch reindex (the `search:reindex`
 *      CLI equivalent), enqueued when an attribute's `searchable` flag changes.
 */
export const BULK_OPERATION_TYPES = {
  PRODUCT_BULK_UPDATE: 'product_bulk_update',
  SEARCH_REINDEX: 'search_reindex',
} as const;
export type BulkOperationType =
  (typeof BULK_OPERATION_TYPES)[keyof typeof BULK_OPERATION_TYPES];

export const bulkOperationSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: bulkOperationStatusSchema,
  requestedByAdminUserId: z.string().uuid(),
  total: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  touchedFields: z.array(z.string()),
  results: z.array(bulkUpdateProductResultSchema).nullable(),
  logs: z.array(bulkOperationLogEntrySchema).nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  // Feature 054 — undo affordance.
  reversible: z.boolean(),
  undoStatus: z.enum(['none', 'reverted', 'partially_reverted']),
  undoneAt: z.string().nullable(),
});
export type BulkOperation = z.infer<typeof bulkOperationSchema>;

/** Response of POST /admin/catalog/bulk-operations/:id/undo. */
export const bulkOperationUndoResponseSchema = z.object({
  data: z.object({
    undoStatus: z.enum(['none', 'reverted', 'partially_reverted']),
    reverted: z.number().int().nonnegative(),
    conflicts: z.array(
      z.object({ recordId: z.string(), reason: z.string() }),
    ),
  }),
});
export type BulkOperationUndoResponse = z.infer<typeof bulkOperationUndoResponseSchema>;

export const bulkOperationsListResponseSchema = z.object({
  data: z.array(bulkOperationSchema),
  pagination: z.object({
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  }),
});
export type BulkOperationsListResponse = z.infer<typeof bulkOperationsListResponseSchema>;

export const bulkOperationResponseSchema = z.object({ data: bulkOperationSchema });
export type BulkOperationResponse = z.infer<typeof bulkOperationResponseSchema>;

export const createVariantRequestSchema = z.object({
  sku: z.string().min(1).max(255),
  variantAttributeValues: z.record(z.string(), z.unknown()),
  priceOverride: z.number().finite().optional(),
  stockLevel: z.number().int().nonnegative().optional(),
});
export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

export const updateVariantRequestSchema = createVariantRequestSchema
  .partial()
  .omit({ sku: true });
export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;

/**
 * Slider-numeric-kind discriminant (feature 002 T013/T021/T022). The API
 * `type=slider` form needs an extra hint so the service knows whether the
 * underlying DB `valueType` is `number` or `price`.
 */
export const numericKindSchema = z.enum(['number', 'price']);
export type NumericKind = z.infer<typeof numericKindSchema>;

const baseCreateAttributeObject = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case, start with a letter'),
  label: multilingualStringSchema,
  /**
   * Feature 002 — preferred API form. When `type` is present it wins over
   * `valueType` (legacy form, kept for backward-compat). Service maps it
   * onto the DB enum + `displayAsSlider` flag (research R-7):
   *   input      → valueType=string
   *   number     → valueType=number
   *   select     → valueType=enum
   *   multiselect→ valueType=multiselect (requires enumValues)
   *   price      → valueType=price
   *   slider     → valueType=number|price (per numericKind) + displayAsSlider=true
   */
  type: apiAttributeTypeSchema.optional(),
  numericKind: numericKindSchema.optional(),
  /** Legacy form. At least one of `type` or `valueType` MUST be set. */
  valueType: attributeValueTypeSchema.optional(),
  enumValues: z.array(z.string()).optional(),
  isSearchable: z.boolean(),
  isFilterable: z.boolean(),
  isVariantAxis: z.boolean(),
  /**
   * Feature 002 — presentation hint. Honored only when the resolved
   * underlying type is `number`/`price`. Implicitly `true` when
   * `type=slider`. Service rejects with INVALID_DISPLAY_AS_SLIDER if
   * supplied for an incompatible underlying type.
   */
  displayAsSlider: z.boolean().optional(),
  /**
   * Feature 007 — selects whether the attribute appears as a body row on
   * the Compare module's comparison page. Independent of isSearchable /
   * isFilterable. Defaults to false on create when omitted.
   */
  isComparable: z.boolean().optional(),
  /**
   * Feature 012 — fallback label used when the active locale is missing
   * from `label`. Defaults server-side to the en-US label (or the first
   * available label, or the attribute key) when omitted on create.
   */
  labelDefault: z.string().min(1).max(200).optional(),
  /** Feature 012 — enforced at product save time when the attribute is in the assigned set. */
  isRequired: z.boolean().optional(),
  /** Feature 012 — surfaces the attribute in the Promotion Rule criterion picker. */
  isPromoRule: z.boolean().optional(),
  /** Feature 012 — ascending sort order on the storefront filter sidebar. Defaults 0. */
  filterPosition: z.number().int().min(0).max(10000).optional(),
  /** Feature 012 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
  isVisibleOnProductPage: z.boolean().optional(),
  /**
   * Feature 023 — when `true` the attribute may carry per-Sales-Channel
   * overrides. Default `false` (global-only). Independent of
   * `languageScoped`; the two flags compose into one of four effective
   * scopes (`global` / `language` / `channel` / `channel+language`).
   */
  channelScoped: z.boolean().optional(),
  /**
   * Feature 023 — when `true` the attribute's value is keyed by
   * language at every slot. For user-defined attributes the baseline
   * is stored as `Record<lang, value>` in `products.attribute_values`;
   * for the system Name / Description attributes this flag is pinned
   * `true` by SYSTEM_ATTRIBUTE_SCOPES.
   */
  languageScoped: z.boolean().optional(),
  /**
   * Feature 022 (products bulk edit) — makes the attribute available in
   * the Products Bulk Edit dialog's attribute field list. Default false;
   * operators opt each attribute in explicitly.
   */
  massEditable: z.boolean().optional(),
  /** Feature 039 — values participate in Quick Order search. Default false. */
  quickSearchable: z.boolean().optional(),
  /**
   * Feature 012 — rich option list for select / enum / multiselect types.
   * When supplied alongside the legacy `enumValues`, this wins. The
   * service layer creates corresponding `custom_field_options` rows
   * (feature 061; formerly the catalog-owned `attribute_options` table).
   */
  options: z.array(createAttributeOptionRequestSchema).optional(),
});

export const createAttributeRequestSchema = baseCreateAttributeObject
  .refine((v) => v.type !== undefined || v.valueType !== undefined, {
    message: 'either `type` (preferred) or `valueType` (legacy) is required',
    path: ['type'],
  })
  .refine(
    (v) => {
      // Select-style attributes need either the legacy `enumValues: string[]`
      // shape OR the new feature-012 `options: AttributeOption[]` shape.
      // The service maps either to `custom_field_options` rows (feature 061).
      const wantsEnum =
        v.type === 'multiselect' ||
        v.type === 'select' ||
        v.valueType === 'enum' ||
        v.valueType === 'multiselect' ||
        v.valueType === 'select';
      if (!wantsEnum) return true;
      const hasLegacy = Array.isArray(v.enumValues) && v.enumValues.length > 0;
      const hasOptions = Array.isArray(v.options) && v.options.length > 0;
      return hasLegacy || hasOptions;
    },
    {
      message:
        'either enumValues (legacy) or options (feature 012) is required for select-style attributes',
      path: ['options'],
    },
  )
  .refine(
    (v) => (v.type === 'slider' ? v.numericKind !== undefined : true),
    {
      message: 'numericKind is required when type=slider',
      path: ['numericKind'],
    },
  );
export type CreateAttributeRequest = z.infer<typeof createAttributeRequestSchema>;

export const updateAttributeRequestSchema = z
  .object({
    label: multilingualStringSchema.optional(),
    /** Feature 002 — same API form as create. */
    type: apiAttributeTypeSchema.optional(),
    numericKind: numericKindSchema.optional(),
    enumValues: z.array(z.string()).optional(),
    isSearchable: z.boolean().optional(),
    isFilterable: z.boolean().optional(),
    isVariantAxis: z.boolean().optional(),
    displayAsSlider: z.boolean().optional(),
    /** Feature 007 — toggles the Compare-page row for this attribute. */
    isComparable: z.boolean().optional(),
    /** Feature 012 — fallback label used when the active locale is missing from `label`. */
    labelDefault: z.string().min(1).max(200).optional(),
    /** Feature 012 — enforced at product save time when the attribute is in the assigned set. */
    isRequired: z.boolean().optional(),
    /** Feature 012 — surfaces the attribute in the Promotion Rule criterion picker. */
    isPromoRule: z.boolean().optional(),
    /** Feature 012 — ascending sort order on the storefront filter sidebar. */
    filterPosition: z.number().int().min(0).max(10000).optional(),
    /** Feature 012 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
    isVisibleOnProductPage: z.boolean().optional(),
    /** Feature 023 — see `baseCreateAttributeObject.channelScoped`. */
    channelScoped: z.boolean().optional(),
    /** Feature 023 — see `baseCreateAttributeObject.languageScoped`. */
    languageScoped: z.boolean().optional(),
    /** Feature 022 (products bulk edit) — toggles bulk-editability. */
    massEditable: z.boolean().optional(),
    /** Feature 039 — values participate in Quick Order search. */
    quickSearchable: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => (v.type === 'slider' ? v.numericKind !== undefined : true),
    {
      message: 'numericKind is required when type=slider',
      path: ['numericKind'],
    },
  );
export type UpdateAttributeRequest = z.infer<typeof updateAttributeRequestSchema>;

/**
 * Feature 061 — admin attribute payload returned by
 * `GET/POST/PATCH /api/v1/admin/catalog/attributes*`. Formalizes the shape
 * `serializeAdminAttribute` has emitted since features 002/012/022/023/039 and
 * adds the single additive field `customFieldDefinitionId` — the backing
 * product-host Custom Field definition (contracts/attribute-admin-api.md).
 * All request schemas above are byte-compatible and unchanged (FR-007, SC-003).
 */
export const adminAttributeResponseSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  label: multilingualStringSchema,
  labelDefault: z.string(),
  /** API-form type (feature 002) — emitted alongside the legacy `valueType`. */
  type: apiAttributeTypeSchema,
  /** Present only when `type === 'slider'`. */
  numericKind: numericKindSchema.optional(),
  valueType: attributeValueTypeSchema,
  /** Legacy projection of the option values; `null` when not fetched or absent. */
  enumValues: z.array(z.string()).nullable(),
  isSearchable: z.boolean(),
  isFilterable: z.boolean(),
  isVariantAxis: z.boolean(),
  displayAsSlider: z.boolean(),
  isComparable: z.boolean(),
  isRequired: z.boolean(),
  isPromoRule: z.boolean(),
  filterPosition: z.number().int(),
  isVisibleOnProductPage: z.boolean(),
  massEditable: z.boolean(),
  quickSearchable: z.boolean(),
  /** Feature 061 (additive) — id of the backing product-host Custom Field definition. */
  customFieldDefinitionId: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminAttributeResponse = z.infer<typeof adminAttributeResponseSchema>;

export const createCategoryRequestSchema = z.object({
  parentCategoryId: uuidSchema.nullable().optional(),
  name: multilingualStringSchema,
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  sortOrder: z.number().int().optional(),
  /**
   * Feature 068 — activation switch. Omitted means active: a category created
   * by an administrator is visible unless they say otherwise. Integrations
   * that discover categories (e.g. the Ergonode importer) pass `false` so a
   * first import never exposes a source hierarchy to customers.
   */
  isActive: z.boolean().optional(),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .object({
    parentCategoryId: uuidSchema.nullable().optional(),
    name: multilingualStringSchema.optional(),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case')
      .optional(),
    sortOrder: z.number().int().optional(),
    /**
     * Feature 068 — activation switch. `false` hides the category from every
     * customer-facing read; the admin tree keeps listing it so it can be
     * re-enabled.
     */
    isActive: z.boolean().optional(),
    /** Feature 013 / US5 — Library Asset rendered as the category's main image. */
    mainImageAssetId: uuidSchema.nullable().optional(),
    /** Feature 055 — custom-field values for this category (validated on write). */
    customFieldValues: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// --- Storefront list/query ---------------------------------------------------

export const productListQuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
  sort: z.enum(['relevance', '-createdAt', 'name', '-name']).optional(),
  changedSince: isoDateTimeSchema.optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// --- Notify-when-available --------------------------------------------------

export const notifyWhenAvailableRequestSchema = z.object({
  variantId: uuidSchema.optional(),
});
export type NotifyWhenAvailableRequest = z.infer<typeof notifyWhenAvailableRequestSchema>;

export const notifyWhenAvailableResponseSchema = z.object({
  subscriptionId: uuidSchema,
  requestedAt: isoDateTimeSchema,
});
export type NotifyWhenAvailableResponse = z.infer<typeof notifyWhenAvailableResponseSchema>;

// --- Feature 002 — Attribute Sets -------------------------------------------
// See specs/002-catalog-module/contracts/catalog-002.contract.md.

const attributeSetCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'must be snake_case');

export const attributeSetSchema = z.object({
  id: uuidSchema,
  code: attributeSetCodeSchema,
  name: multilingualStringSchema,
  description: multilingualStringSchema.nullable(),
  isSystem: z.boolean(),
  attributeCount: z.number().int().nonnegative(),
  productCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AttributeSet = z.infer<typeof attributeSetSchema>;

export const attributeSetAssignedAttributeSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  label: multilingualStringSchema,
  valueType: attributeValueTypeSchema,
  position: z.number().int().nonnegative(),
  /**
   * Feature 023 — the attribute's value is keyed by language, so the product
   * editor renders it (and anything scoped to it, such as feature 068's
   * overwrite protection) per language rather than once for the attribute.
   */
  languageScoped: z.boolean(),
});
export type AttributeSetAssignedAttribute = z.infer<typeof attributeSetAssignedAttributeSchema>;

export const attributeSetDetailSchema = attributeSetSchema.extend({
  attributes: z.array(attributeSetAssignedAttributeSchema),
});
export type AttributeSetDetail = z.infer<typeof attributeSetDetailSchema>;

export const createAttributeSetRequestSchema = z
  .object({
    code: attributeSetCodeSchema,
    name: multilingualStringSchema,
    description: multilingualStringSchema.optional(),
    attributeIds: z.array(uuidSchema).optional(),
  })
  .strict();
export type CreateAttributeSetRequest = z.infer<typeof createAttributeSetRequestSchema>;

export const updateAttributeSetRequestSchema = z
  .object({
    code: attributeSetCodeSchema.optional(),
    name: multilingualStringSchema.optional(),
    description: multilingualStringSchema.nullable().optional(),
  })
  .strict();
export type UpdateAttributeSetRequest = z.infer<typeof updateAttributeSetRequestSchema>;

export const assignAttributesRequestSchema = z
  .object({
    assignments: z
      .array(
        z.object({
          attributeId: uuidSchema,
          position: z.number().int().nonnegative().optional(),
        }),
      )
      .min(1),
  })
  .strict();
export type AssignAttributesRequest = z.infer<typeof assignAttributesRequestSchema>;

// --- Feature 002 — Gallery (US3) --------------------------------------------

export const galleryLabelSchema = z.enum(['base_image', 'small_image', 'thumbnail']);
export type GalleryLabel = z.infer<typeof galleryLabelSchema>;

export const galleryItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  assetId: uuidSchema,
  position: z.number().int().nonnegative(),
  labels: z.array(galleryLabelSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

export const createGalleryItemRequestSchema = z
  .object({
    assetId: uuidSchema,
    position: z.number().int().nonnegative().optional(),
    labels: z.array(galleryLabelSchema).optional(),
  })
  .strict();
export type CreateGalleryItemRequest = z.infer<typeof createGalleryItemRequestSchema>;

export const updateGalleryItemRequestSchema = z
  .object({
    position: z.number().int().nonnegative().optional(),
    labels: z.array(galleryLabelSchema).optional(),
  })
  .strict();
export type UpdateGalleryItemRequest = z.infer<typeof updateGalleryItemRequestSchema>;

export const reorderGalleryRequestSchema = z
  .object({
    orderedGalleryItemIds: z.array(uuidSchema).min(1),
  })
  .strict();
export type ReorderGalleryRequest = z.infer<typeof reorderGalleryRequestSchema>;

// --- Feature 002 — Attachments (US3) ----------------------------------------

export const attachmentTypeSchema = z.object({
  id: uuidSchema,
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'must be snake_case'),
  name: multilingualStringSchema,
  position: z.number().int().nonnegative(),
  usageCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

export const createAttachmentTypeRequestSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'must be snake_case'),
    name: multilingualStringSchema,
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateAttachmentTypeRequest = z.infer<typeof createAttachmentTypeRequestSchema>;

export const updateAttachmentTypeRequestSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'must be snake_case')
      .optional(),
    name: multilingualStringSchema.optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdateAttachmentTypeRequest = z.infer<typeof updateAttachmentTypeRequestSchema>;

export const productAttachmentSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  assetId: uuidSchema,
  attachmentTypeId: uuidSchema,
  name: z.string().min(1).max(160),
  description: z.string().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ProductAttachment = z.infer<typeof productAttachmentSchema>;

export const createAttachmentRequestSchema = z
  .object({
    assetId: uuidSchema,
    attachmentTypeId: uuidSchema,
    name: z.string().min(1).max(160),
    description: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateAttachmentRequest = z.infer<typeof createAttachmentRequestSchema>;

export const updateAttachmentRequestSchema = z
  .object({
    attachmentTypeId: uuidSchema.optional(),
    name: z.string().min(1).max(160).optional(),
    description: z.string().nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdateAttachmentRequest = z.infer<typeof updateAttachmentRequestSchema>;

// --- Packaging Units (Feature 043) ------------------------------------------

/**
 * A named ordering unit attached to a product (e.g. "Paleta" = 480 pieces).
 * Managed in the Inventory section of the admin product card; surfaced on the
 * storefront product page so buyers can order by the unit.
 */
export const packagingUnitSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  name: z.string().min(1).max(160),
  baseQuantity: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PackagingUnitDto = z.infer<typeof packagingUnitSchema>;

export const createPackagingUnitRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    baseQuantity: z.number().int().positive(),
    isDefault: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreatePackagingUnitRequest = z.infer<typeof createPackagingUnitRequestSchema>;

export const updatePackagingUnitRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    baseQuantity: z.number().int().positive().optional(),
    isDefault: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdatePackagingUnitRequest = z.infer<typeof updatePackagingUnitRequestSchema>;

export const reorderPackagingUnitsRequestSchema = z
  .object({
    orderedIds: z.array(uuidSchema).min(1),
  })
  .strict();
export type ReorderPackagingUnitsRequest = z.infer<typeof reorderPackagingUnitsRequestSchema>;

// --- Product Links (Feature 002 US4) ----------------------------------------

export const productLinkKindSchema = z.enum(['related', 'up_sell', 'cross_sell']);
export type ProductLinkKind = z.infer<typeof productLinkKindSchema>;

export const productLinkSchema = z.object({
  id: uuidSchema,
  sourceProductId: uuidSchema,
  targetProductId: uuidSchema,
  kind: productLinkKindSchema,
  position: z.number().int().nonnegative(),
});
export type ProductLink = z.infer<typeof productLinkSchema>;

/**
 * Bulk-create payload (T104). One transaction, all-or-nothing —
 * partial inserts on a duplicate or self-link MUST roll back the
 * entire batch (FR + research). Each entry pins its kind so admins
 * can submit a mixed batch in a single round trip.
 */
export const bulkCreateLinksRequestSchema = z.object({
  links: z
    .array(
      z.object({
        targetProductId: uuidSchema,
        kind: productLinkKindSchema,
        position: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
});
export type BulkCreateLinksRequest = z.infer<typeof bulkCreateLinksRequestSchema>;

export const reorderLinksRequestSchema = z.object({
  /** Ordered list of link ids — index becomes `position` per (source, kind). */
  linkIds: z.array(uuidSchema).min(1),
});
export type ReorderLinksRequest = z.infer<typeof reorderLinksRequestSchema>;

/**
 * Storefront-shape link entry (T107) — the listing carries enough Product
 * fields for a card render without a follow-up fetch. Inactive targets
 * are filtered out by `listForStorefront` so the storefront never sees
 * `status='archived'` rows.
 */
// --- Composite products (Feature 002 US5) -----------------------------------

export const groupedItemSchema = z.object({
  id: uuidSchema,
  parentProductId: uuidSchema,
  childProductId: uuidSchema,
  quantity: z.number().int().positive(),
  position: z.number().int().nonnegative(),
});
export type GroupedItem = z.infer<typeof groupedItemSchema>;

export const createGroupedItemRequestSchema = z
  .object({
    childProductId: uuidSchema,
    quantity: z.number().int().positive(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateGroupedItemRequest = z.infer<typeof createGroupedItemRequestSchema>;

export const updateGroupedItemRequestSchema = z
  .object({
    quantity: z.number().int().positive().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdateGroupedItemRequest = z.infer<typeof updateGroupedItemRequestSchema>;

export const bundleSlotOptionSchema = z.object({
  id: uuidSchema,
  slotId: uuidSchema,
  optionProductId: uuidSchema,
  defaultQuantity: z.number().int().positive(),
  position: z.number().int().nonnegative(),
});
export type BundleSlotOption = z.infer<typeof bundleSlotOptionSchema>;

export const bundleSlotSchema = z.object({
  id: uuidSchema,
  parentProductId: uuidSchema,
  name: multilingualStringSchema,
  minQuantity: z.number().int().nonnegative(),
  maxQuantity: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  options: z.array(bundleSlotOptionSchema),
});
export type BundleSlot = z.infer<typeof bundleSlotSchema>;

export const createBundleSlotRequestSchema = z
  .object({
    name: multilingualStringSchema,
    minQuantity: z.number().int().nonnegative().optional(),
    maxQuantity: z.number().int().positive(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((v) => (v.minQuantity ?? 0) <= v.maxQuantity, {
    message: 'minQuantity must be <= maxQuantity',
    path: ['minQuantity'],
  });
export type CreateBundleSlotRequest = z.infer<typeof createBundleSlotRequestSchema>;

export const updateBundleSlotRequestSchema = z
  .object({
    name: multilingualStringSchema.optional(),
    minQuantity: z.number().int().nonnegative().optional(),
    maxQuantity: z.number().int().positive().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type UpdateBundleSlotRequest = z.infer<typeof updateBundleSlotRequestSchema>;

export const createBundleSlotOptionRequestSchema = z
  .object({
    optionProductId: uuidSchema,
    defaultQuantity: z.number().int().positive().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CreateBundleSlotOptionRequest = z.infer<
  typeof createBundleSlotOptionRequestSchema
>;

/**
 * Buyer's bundle configuration — what the storefront posts to the
 * `/bundle-configuration/validate` endpoint. One selection per slot,
 * referencing the chosen option's id and the buyer-picked quantity.
 */
export const bundleConfigurationSelectionSchema = z.object({
  slotId: uuidSchema,
  optionId: uuidSchema,
  quantity: z.number().int().positive(),
});
export type BundleConfigurationSelection = z.infer<
  typeof bundleConfigurationSelectionSchema
>;

export const validateBundleConfigurationRequestSchema = z
  .object({
    selections: z.array(bundleConfigurationSelectionSchema),
  })
  .strict();
export type ValidateBundleConfigurationRequest = z.infer<
  typeof validateBundleConfigurationRequestSchema
>;

export const bundleValidationErrorSchema = z.object({
  code: z.enum(['MIN_NOT_MET', 'MAX_EXCEEDED', 'UNKNOWN_OPTION']),
  slotId: uuidSchema.optional(),
  message: z.string(),
});
export type BundleValidationError = z.infer<typeof bundleValidationErrorSchema>;

export const bundleValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(bundleValidationErrorSchema),
  resolvedSelections: z.array(
    z.object({
      slotId: uuidSchema,
      optionId: uuidSchema,
      optionProductId: uuidSchema,
      quantity: z.number().int().positive(),
    }),
  ),
});
export type BundleValidationResult = z.infer<typeof bundleValidationResultSchema>;

export const productLinkSummarySchema = z.object({
  id: uuidSchema,
  kind: productLinkKindSchema,
  position: z.number().int().nonnegative(),
  product: z.object({
    id: uuidSchema,
    sku: z.string(),
    slug: z.string(),
    name: z.string(),
    primaryAssetUrl: z.string().nullable(),
    price: moneySchema.nullable(),
  }),
});
export type ProductLinkSummary = z.infer<typeof productLinkSummarySchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `catalog` publishes to the fourteen modules that read
// it (feature 075, Phase P). It is the heaviest provider in the tree — 107
// inbound import sites, 60 of them on the `Product` and `Category` entity
// classes — so this section is correspondingly the largest, and every entry in
// it is a shape somebody measurably asks for rather than a projection of the
// two classes.
//
// **One demand is deliberately unmet.** `product_feeds` compiles its own
// selection DSL into a MikroORM `where` object and hands it to
// `em.find(Product, where as never)`. A port cannot take that argument — a
// query object is the ORM, not a contract — and inverting it means either
// publishing the DSL or teaching `catalog` about feeds. That is a design
// question rather than a naming one, so it is escalated and left for the
// `product_feeds` cut to resolve, not guessed at here.
// ---------------------------------------------------------------------------

/**
 * A product as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011). Twenty modules read this row; between them they touch
 * nearly every column, which is why the record mirrors the table rather than
 * narrowing it. What it is not is the *class*: a consumer cannot call a method
 * on it, cannot persist it, and cannot pull a relation off it.
 */
export interface CatalogProductRecord {
  id: string;
  sku: string;
  slug: string;
  type: ProductType;
  status: ProductStatus;
  /** Per-locale JSONB. Resolve with the caller's language chain. */
  name: Record<string, string>;
  description: Record<string, string>;
  /** Per-product override of the global stock mode; `null` ⇒ inherit. */
  stockMode: StockMode | null;
  visibility: ProductVisibility;
  /** JSONB `{ attributeKey: value }`, validated against the attribute set. */
  attributeValues: Record<string, unknown>;
  allowedOrganizationIds: string[];
  attributeSetId: string;
  downloadAssetId: string | null;
  downloadUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  deletedAt: Date | null;
  manageStock: boolean;
  backorderEnabled: boolean;
  lowStockThreshold: number | null;
  lowStockThresholdMode: 'cumulative' | 'per_warehouse';
  fulfilmentStrategy: FulfilmentStrategy | null;
  fulfilmentStrategyWarehouseOrder: string[] | null;
}

/** A category row, as the eight modules that read one see it. */
export interface CatalogCategoryRecord {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
  metaTitleOverride: Record<string, string> | null;
  metaDescriptionOverride: Record<string, string> | null;
  customFieldValues: Record<string, unknown>;
  isActive: boolean;
  inventoryThresholdHigh: number | null;
  inventoryThresholdMedium: number | null;
  inventoryThresholdLow: number | null;
  mainImageAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** A configurable product's variant row. */
export interface CatalogProductVariantRecord {
  id: string;
  parentProductId: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
  /** Decimal string, or `null` when the variant inherits the parent's price. */
  priceOverride: string | null;
  stockLevel: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A packaging unit — "box of 12" — a cart line may be placed in. */
export interface CatalogPackagingUnitRecord {
  id: string;
  productId: string;
  name: string;
  baseQuantity: number;
  position: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A directed product↔product relation (cross-sell, up-sell, related). */
export interface CatalogProductLinkRow {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  kind: ProductLinkKind;
  position: number;
}

/** A per-channel / per-language override of one attribute value (feature 022). */
export interface CatalogProductValueOverrideRecord {
  id: string;
  productId: string;
  attributeKey: string;
  channelId: string;
  languageCode: string | null;
  /** The stored value, wrapped so `null` and "absent" stay distinguishable. */
  value: { v: unknown };
}

/**
 * Which products a lookup should consider.
 *
 * `liveOnly` excludes soft-deleted rows and `activeOnly` narrows further to
 * `status === 'active'`. Both default to `false`, which is the wider read —
 * and the correct default, because an inactive or soft-deleted product still
 * has to resolve from a historical order, invoice, RFQ or shopping list.
 */
export interface CatalogProductLookupOptions {
  liveOnly?: boolean;
  activeOnly?: boolean;
}

/**
 * Container name: `catalogProductReadPort`. Owner: `catalog`.
 *
 * Forty-six of `catalog`'s inbound sites are a read of the `Product` entity,
 * and they reduce to four questions: by id, by ids, by sku, by skus. The rest
 * of this port is the three neighbouring tables the same callers reach for in
 * the same breath — variants, packaging units and links — plus the value
 * overrides the search indexer reads.
 *
 * When `catalog` is off every method fails closed, and that is the answer a
 * cart or an order line should get: pricing a line for a product the platform
 * will not read is worse than refusing the line.
 */
export interface CatalogProductReadPort {
  findById(
    id: string,
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord | null>;
  findByIds(
    ids: readonly string[],
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord[]>;
  findBySku(
    sku: string,
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord | null>;
  findBySkus(
    skus: readonly string[],
    options?: CatalogProductLookupOptions,
  ): Promise<CatalogProductRecord[]>;
  /** `count === ids.length` existence check, without loading the rows. */
  countByIds(ids: readonly string[]): Promise<number>;
  /** Every product, ordered by sku — the bulk export and the price-list backfill. */
  listAll(options?: CatalogProductLookupOptions): Promise<CatalogProductRecord[]>;

  /** Variants of the given parent products, ordered by sku. */
  listVariantsByProductIds(productIds: readonly string[]): Promise<CatalogProductVariantRecord[]>;
  findVariantsBySkus(skus: readonly string[]): Promise<CatalogProductVariantRecord[]>;
  /** A variant, but only if it belongs to that parent. */
  findVariantInProduct(
    parentProductId: string,
    variantId: string,
  ): Promise<CatalogProductVariantRecord | null>;

  /** A packaging unit, but only if it belongs to that product. */
  findPackagingUnitInProduct(
    productId: string,
    packagingUnitId: string,
  ): Promise<CatalogPackagingUnitRecord | null>;

  /** Links out of the given products, optionally narrowed to one kind. */
  listLinksBySourceIds(
    sourceProductIds: readonly string[],
    kind?: ProductLinkKind,
  ): Promise<CatalogProductLinkRow[]>;

  /** Attribute-value overrides for the given products. */
  listValueOverridesByProductIds(
    productIds: readonly string[],
  ): Promise<CatalogProductValueOverrideRecord[]>;
}

/**
 * Container name: `catalogCategoryReadPort`. Owner: `catalog`.
 *
 * Fourteen inbound sites read the `Category` entity: the inventory threshold
 * resolver walks it, `price_lists` walks the ancestor chain to resolve a
 * category rule, `product_feeds` maps the whole tree onto an external
 * taxonomy, `seo` renders a category page's meta tags.
 *
 * `ancestorsOf` is here rather than in `price_lists` because that module walks
 * the chain with a `findOne` per level today — a loop over the parent pointer
 * whose depth is data, in a module that does not own the table.
 */
export interface CatalogCategoryReadPort {
  findById(id: string, options?: { liveOnly?: boolean }): Promise<CatalogCategoryRecord | null>;
  findByIds(
    ids: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<CatalogCategoryRecord[]>;
  findBySlug(slug: string): Promise<CatalogCategoryRecord | null>;
  /** `count === ids.length` existence check. */
  countByIds(ids: readonly string[]): Promise<number>;
  /** The whole tree, ordered by sort order then slug. */
  listAll(options?: { liveOnly?: boolean }): Promise<CatalogCategoryRecord[]>;
  /** Categories carrying at least one inventory threshold override. */
  listWithInventoryThresholds(): Promise<CatalogCategoryRecord[]>;
  /**
   * The category and its ancestors, nearest-first. Empty when the id does not
   * resolve. A cycle is impossible — the write path enforces it — but the walk
   * is bounded anyway, because a corrupt `parent_id` should not hang a request.
   */
  ancestorsOf(categoryId: string): Promise<CatalogCategoryRecord[]>;
}

// --- the bulk import surface -------------------------------------------------
//
// D-74. `import_export` used to apply a spreadsheet by holding this module's
// entity classes and writing them inside its own transaction — no Command, no
// audit row, and a within-run parent lookup that worked only because MikroORM
// flushes before a query its pending insert would change.
//
// The transaction never had to cross the boundary; it had to be on the other
// side of it. One POST is one entity and one owner, so the owner takes the
// whole operation — validation, within-run resolution, the transaction and the
// audit row — and the caller passes rows.

/**
 * One row of a categories import.
 *
 * Absent fields are left unchanged on an existing row; `parentSlug: null` means
 * root. `slug` addresses the row: a slug that exists is updated, one that does
 * not is created, and a slug introduced earlier in the same call resolves as a
 * parent for a later one.
 */
export interface CategoryImportRow {
  slug: string;
  parentSlug?: string | null;
  sortOrder?: number;
  /** Per-locale, merged into the stored JSONB rather than replacing it. */
  name?: Record<string, string>;
  isActive?: boolean;
}

/**
 * One row of a products import.
 *
 * `sku` addresses an existing product; the import creates none, because a
 * product needs an attribute set, a type and a slug that a flat sheet does not
 * carry.
 */
export interface ProductImportRow {
  sku: string;
  status?: ProductStatus;
  visibility?: ProductVisibility;
  /** Per-locale, merged into the stored JSONB rather than replacing it. */
  name?: Record<string, string>;
  description?: Record<string, string>;
}

/**
 * Container name: `catalogBulkImportPort`. Owner: `catalog`.
 *
 * All-or-nothing per call: one transaction, one audit row, no partial commits.
 * A rejected row leaves the whole call applying nothing, which is what makes a
 * corrected re-upload safe — see {@link BulkImportReport}.
 *
 * With `catalog` off the call answers 503 `MODULE_DISABLED`; the caller is
 * expected to decide presence before offering the surface at all.
 */
export interface CatalogBulkImportPort {
  importCategories(rows: readonly CategoryImportRow[]): Promise<BulkImportReport>;
  importProducts(rows: readonly ProductImportRow[]): Promise<BulkImportReport>;
}

// --- the attribute read model ------------------------------------------------

export interface CatalogAttributeOptionView {
  /** `custom_field_options` id. */
  id: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The composed attribute view (feature 061,
 * `contracts/catalog-attribute-view.md`): the `custom_fields` definition and
 * the `product_attributes` extension row, joined, shaped like the pre-061
 * `ProductAttribute` so consumer rewires stay mechanical.
 */
export interface CatalogAttributeView {
  /** Extension row id — the id the admin API has always exposed. */
  id: string;
  /** Backing `custom_field_definitions` id (host `product`). */
  customFieldDefinitionId: string;

  key: string;
  label: Record<string, string>;
  labelDefault: string;
  /** Legacy 8-value form, derived bijectively (feature 061 research §R7). */
  valueType: AttributeValueType;
  isRequired: boolean;
  options: CatalogAttributeOptionView[];

  isSearchable: boolean;
  isFilterable: boolean;
  isVariantAxis: boolean;
  displayAsSlider: boolean;
  isComparable: boolean;
  quickSearchable: boolean;
  isPromoRule: boolean;
  filterPosition: number;
  isVisibleOnProductPage: boolean;
  channelScoped: boolean;
  languageScoped: boolean;
  massEditable: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type CatalogAttributeFlag =
  | 'isSearchable'
  | 'isFilterable'
  | 'isVariantAxis'
  | 'isComparable'
  | 'quickSearchable'
  | 'isPromoRule'
  | 'massEditable'
  | 'isVisibleOnProductPage';

/**
 * Container name: `catalogAttributeReadPort`. Owner: `catalog`.
 *
 * The **only** sanctioned way any module — including `catalog`'s own route
 * serializers — reads product-attribute definitions (Principle I). `search`,
 * `comparisons`, `quick_order` and `pim_ergonode` all read it today by
 * importing the class.
 *
 * Freshness: the definitions half rides the custom-fields cache (invalidated
 * by every committed attribute Command, 5 s TTL fallback); the extension half
 * is a live query, so flag reads are always fresh.
 */
export interface CatalogAttributeReadPort {
  listAll(): Promise<CatalogAttributeView[]>;
  getByIdOrKey(idOrKey: string): Promise<CatalogAttributeView | null>;
  listByFlag(flag: CatalogAttributeFlag): Promise<CatalogAttributeView[]>;
  /** `attributeKey → optionValue → labels`, for label resolution on read. */
  optionLabelIndex(): Promise<Map<string, Map<string, CatalogAttributeOptionLabels>>>;
}

/** The two label forms an option carries: per-locale, and the fallback. */
export interface CatalogAttributeOptionLabels {
  label: Record<string, string>;
  labelDefault: string;
}

/** Which of the three quick-search predicates a hit satisfied. */
export type CatalogQuickSearchField = 'sku' | 'name' | 'attribute';

export interface CatalogQuickSearchParams {
  /** The raw needle. Matched case-insensitively, as a substring. */
  q: string;
  limit: number;
  /**
   * The channel the caller resolved for this request. Required, and there is
   * no "all channels" spelling: a channel is always resolved (feature 053), so
   * an optional parameter here could only mean "the caller forgot", and the
   * answer to that must not be the cross-channel catalogue.
   */
  salesChannelId: string;
}

export interface CatalogQuickSearchHit {
  productId: string;
  sku: string;
  slug: string;
  /** Per-locale JSONB as stored — the caller picks its own language. */
  name: Record<string, string>;
  status: ProductStatus;
  matchedOn: CatalogQuickSearchField[];
}

/**
 * Container name: `catalogQuickSearchPort`. Owner: `catalog`.
 *
 * The buyer-facing type-ahead behind `quick_order`'s CSV-free entry path
 * (feature 039 FR-011/FR-013), published here because the predicate is a
 * catalogue question in every part: which products are active, which are
 * visible on the channel being shopped, and which attribute values are
 * searchable at all — the last decided by the `quickSearchable` flag this
 * module owns, over the `attribute_values` JSONB layout this module owns.
 *
 * It exists because `quick_order` was answering it with a hand-written knex
 * `select` against `products`, which filtered `status = 'active'` and nothing
 * else (issue #174). No import specifier, so `check:module-boundary` read
 * clean; and no channel predicate, so a signed-in buyer's type-ahead returned
 * every active product on the platform whatever channel they were shopping —
 * Constitution XII, in the one place no static check was looking.
 *
 * Scoping is the same `sales_channel_products` membership filter this module's
 * own public listing applies, and it fails closed to the empty set.
 *
 * When `catalog` is off the call fails closed: `quick_order` declares `catalog`
 * in `dependencies`, and a type-ahead that cannot ask the catalogue has nothing
 * true to answer.
 */
export interface CatalogQuickSearchPort {
  quickSearch(params: CatalogQuickSearchParams): Promise<CatalogQuickSearchHit[]>;
}

/**
 * Scope flags for the **system** product attributes — the ones that are not
 * rows in `product_attributes` and therefore carry no DB-stored scope flags.
 *
 * Published as a **constant, not a port** (FR-013): `name` and `description`
 * are channel- and language-scoped because the product table stores them as
 * per-locale JSONB, which is a fact about the schema rather than about whether
 * a module is switched on. `search`'s indexer reads it to decide which
 * overrides to resolve.
 *
 * Adding another system attribute is a one-line change here plus a resolver
 * consumer. The reserved keys MUST NOT collide with `product_attributes.key`
 * — enforced at write time by the override-service validator.
 */
export const SYSTEM_ATTRIBUTE_SCOPES: Readonly<Record<string, AttributeScope>> = {
  name: { channelScoped: true, languageScoped: true },
  description: { channelScoped: true, languageScoped: true },
};

export type SystemAttributeKey = keyof typeof SYSTEM_ATTRIBUTE_SCOPES;

export function isSystemAttributeKey(key: string): key is SystemAttributeKey {
  return Object.prototype.hasOwnProperty.call(SYSTEM_ATTRIBUTE_SCOPES, key);
}

/**
 * Resolve the effective scope of an attribute given its key and (for
 * user-defined attributes) its scope flags. Returns the system-pinned scope
 * when the key is reserved; falls back to the row's flags otherwise; returns
 * `{ false, false }` when neither applies (the caller should treat that as
 * global-only).
 */
export function getAttributeScope(
  attributeKey: string,
  productAttributeRow?: { channelScoped: boolean; languageScoped: boolean } | null,
): AttributeScope {
  if (isSystemAttributeKey(attributeKey)) {
    // Keyed by `SystemAttributeKey`, so the lookup is non-undefined here; TS'
    // index signature still widens under `noUncheckedIndexedAccess`.
    return SYSTEM_ATTRIBUTE_SCOPES[attributeKey]!;
  }
  if (productAttributeRow) {
    return {
      channelScoped: productAttributeRow.channelScoped,
      languageScoped: productAttributeRow.languageScoped,
    };
  }
  return { channelScoped: false, languageScoped: false };
}

// --- the write surface -------------------------------------------------------

/** Optional metadata attaching an audit entry to an admin mutation. */
export interface CatalogAdminAuditContext {
  actorAdminUserId: string;
  impersonatedCustomerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * An attribute option as the write path returns it.
 *
 * Distinct from `AttributeOption`, the API DTO above, on one axis: the two
 * timestamps are `Date`, not an ISO string. That is what an in-process call
 * hands back, and serialising them here would mean every consumer parsing them
 * again.
 */
export interface CatalogAttributeOptionResult {
  id: string;
  attributeId: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The eight flags `listAttributesByFlag` accepts — a superset of the read model's. */
export type CatalogAdminAttributeFlag =
  | 'isSearchable'
  | 'isFilterable'
  | 'isComparable'
  | 'isVariantAxis'
  | 'isPromoRule'
  | 'isVisibleOnProductPage'
  | 'isRequired'
  | 'isMassEditable';

/**
 * Container name: `catalogProductWritePort`. Owner: `catalog`.
 *
 * `pim_ergonode` is the only consumer, and it is the whole reason this port is
 * narrow: an import run creates and updates products, attributes and variants,
 * and touches nothing else on `CatalogAdminService`'s considerable surface.
 *
 * `createProduct` and the two variant writes return **records**, where the
 * service returns entities. That substitution is the point of the port.
 */
export interface CatalogProductWritePort {
  createProduct(
    req: CreateProductRequest,
    auditCtx?: CatalogAdminAuditContext,
  ): Promise<CatalogProductRecord>;
  updateProduct(id: string, req: UpdateProductRequest): Promise<CatalogProductRecord>;

  listAttributes(): Promise<CatalogAttributeView[]>;
  listAttributesByFlag(flag: CatalogAdminAttributeFlag): Promise<CatalogAttributeView[]>;
  createAttribute(req: CreateAttributeRequest): Promise<CatalogAttributeView>;
  updateAttributeByIdOrKey(
    idOrKey: string,
    req: UpdateAttributeRequest,
    auditCtx?: CatalogAdminAuditContext,
  ): Promise<CatalogAttributeView>;
  addAttributeOption(
    attributeIdOrKey: string,
    input: {
      value: string;
      label?: Record<string, string>;
      labelDefault: string;
      isDefault?: boolean;
      sortOrder?: number;
    },
  ): Promise<CatalogAttributeOptionResult>;

  createVariant(
    parentProductId: string,
    req: CreateVariantRequest,
  ): Promise<CatalogProductVariantRecord>;
  updateVariant(
    parentProductId: string,
    variantId: string,
    req: UpdateVariantRequest,
  ): Promise<CatalogProductVariantRecord>;
  deleteVariant(parentProductId: string, variantId: string): Promise<void>;
}

/** The patch `updateCategory` accepts. Absent keys are left alone. */
export interface UpdateCategoryInput {
  parentCategoryId?: string | null;
  name?: Record<string, string>;
  slug?: string;
  sortOrder?: number;
  /** Feature 013 / US5 — library asset rendered as the storefront main image. */
  mainImageAssetId?: string | null;
  /** Feature 055 — validated and merged against the definitions on write. */
  customFieldValues?: Record<string, unknown>;
  /**
   * Feature 068 — activation switch. `false` hides the category from every
   * customer-facing read while the admin tree keeps listing it.
   */
  isActive?: boolean;
}

/**
 * The three display-band thresholds a category may override. Absent keys are
 * left alone; an explicit `null` clears the override.
 */
export interface CategoryInventoryThresholdPatch {
  high?: number | null;
  medium?: number | null;
  low?: number | null;
}

/**
 * Container name: `catalogCategoryWritePort`. Owner: `catalog`.
 *
 * `pim_ergonode` again, and again narrow: an import run lists the tree,
 * creates the categories it is missing and updates the ones that moved.
 *
 * `setInventoryThresholds` is the fourth method and belongs to a different
 * consumer: `inventory` stores the per-category half of its display-band
 * thresholds in three columns on this module's `categories` table, and wrote
 * them by holding the entity. It is deliberately **not** a key on
 * {@link UpdateCategoryInput}: `update` runs the `category.update` Command,
 * emits the search-reindex event and writes an audit row, none of which a
 * threshold patch did or should — `inventory` records one
 * `low_stock_threshold.update` summary row for the whole patch, and an
 * operator reading a category's history should not find a rename-shaped entry
 * for it. The columns' owner is still the question underneath, and the answer
 * that retires this method is moving them into `inventory_thresholds` with
 * `scopeKind = 'category'`, which is a data migration and not a cut.
 */
export interface CatalogCategoryWritePort {
  listAll(): Promise<CatalogCategoryRecord[]>;
  create(input: CreateCategoryRequest): Promise<CatalogCategoryRecord>;
  update(id: string, input: UpdateCategoryInput): Promise<CatalogCategoryRecord>;
  /** Rejects an unknown or soft-deleted category with 404 `NOT_FOUND`. */
  setInventoryThresholds(id: string, patch: CategoryInventoryThresholdPatch): Promise<void>;
}

/**
 * Container name: `attributeSetService`. Owner: `catalog`.
 *
 * Already returns contract DTOs, so the port is the four methods
 * `pim_ergonode` calls and nothing else.
 */
export interface CatalogAttributeSetPort {
  listSets(): Promise<AttributeSet[]>;
  getSetDetail(id: string): Promise<AttributeSetDetail>;
  createSet(input: CreateAttributeSetRequest): Promise<AttributeSetDetail>;
  assignAttributes(id: string, input: AssignAttributesRequest): Promise<AttributeSetDetail>;
}

/** Container name: `attachmentService`. Owner: `catalog`. */
export interface CatalogAttachmentPort {
  listTypes(): Promise<AttachmentType[]>;
  createType(req: CreateAttachmentTypeRequest): Promise<AttachmentType>;
  listAttachments(productId: string): Promise<ProductAttachment[]>;
  createAttachment(productId: string, req: CreateAttachmentRequest): Promise<ProductAttachment>;
  updateAttachment(
    productId: string,
    attachmentId: string,
    req: UpdateAttachmentRequest,
  ): Promise<ProductAttachment>;
  deleteAttachment(productId: string, attachmentId: string): Promise<void>;
}

/** Whether a gallery write may silently move a conflicting label off another item. */
export interface CatalogGalleryWriteOptions {
  replaceConflictingLabels: boolean;
}

/** Container name: `galleryService`. Owner: `catalog`. */
export interface CatalogGalleryPort {
  list(productId: string): Promise<GalleryItem[]>;
  create(
    productId: string,
    req: CreateGalleryItemRequest,
    options: CatalogGalleryWriteOptions,
  ): Promise<GalleryItem>;
  delete(productId: string, itemId: string): Promise<void>;
  reorder(productId: string, orderedIds: string[]): Promise<void>;
}

/** One child line of a grouped product. */
export interface CatalogGroupedItemRow {
  id: string;
  parentProductId: string;
  childProductId: string;
  quantity: number;
  position: number;
}

/** Container name: `groupedService`. Owner: `catalog`. */
export interface CatalogGroupedPort {
  list(parentProductId: string): Promise<CatalogGroupedItemRow[]>;
  addItem(
    parentProductId: string,
    input: { childProductId: string; quantity: number; position?: number | undefined },
  ): Promise<CatalogGroupedItemRow>;
  updateItem(
    parentProductId: string,
    itemId: string,
    input: { quantity?: number | undefined; position?: number | undefined },
  ): Promise<CatalogGroupedItemRow>;
  removeItem(parentProductId: string, itemId: string): Promise<void>;
}

/** A link to create, as the bulk writer takes it. */
export interface CatalogCreateProductLinkInput {
  targetProductId: string;
  kind: ProductLinkKind;
  position?: number | undefined;
}

/** Container name: `productLinkService`. Owner: `catalog`. */
export interface CatalogProductLinkPort {
  listForAdmin(sourceProductId: string, kind?: ProductLinkKind): Promise<CatalogProductLinkRow[]>;
  bulkCreate(
    sourceProductId: string,
    inputs: CatalogCreateProductLinkInput[],
  ): Promise<CatalogProductLinkRow[]>;
  removeLink(sourceProductId: string, linkId: string): Promise<void>;
}

/** One attribute with its options, as the promotion rule builder renders it. */
export interface CatalogAttributeWithOptions {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: AttributeValueType;
  isPromoRule: boolean;
  options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
}

/**
 * Container name: `catalogPromoAttributePort`. Owner: `catalog`.
 *
 * `promotions` builds its rule editor from these two answers, and reaches
 * `CatalogQueryService` — the storefront query service, 1400 lines — for them.
 * The port is the two questions.
 */
export interface CatalogPromoAttributePort {
  promoRuleAttributeKeys(): Promise<string[]>;
  getAttributeWithOptions(key: string): Promise<CatalogAttributeWithOptions | null>;
}

// --- the sellable-product filter ---------------------------------------------
//
// Feature 075. This is the demand the header of this section recorded as
// deliberately unmet and the `product_feeds` shard escalated back: that module
// compiles its own selection DSL into a MikroORM `where` object and hands it to
// `em.find(Product, where as never)`. A port cannot take that argument — a query
// object is the ORM, not a contract.
//
// The answer is a filter that is **narrower than MikroORM on purpose**: six
// columns, one JSONB bag, twelve operators, two combinators, and nothing else.
// It expresses every leaf `product_feeds` compiles today and it cannot become a
// general query surface, because there is no node for a join, a relation, a raw
// fragment or a column this list does not name.
//
// The **eligibility floor and the keyset cursor live inside the port**, not in
// the caller's conjunction. That is the whole reason the port is shaped this way
// rather than as "take a predicate, return rows": feature 067's FR-026 makes the
// floor non-overridable, and a caller-composed `$and` is exactly how it could
// stop being — the floor's channel membership, a category criterion and the
// cursor all constrain `id`, one object spread away from being a single
// surviving key.

/** A scalar a filter condition compares against. */
export type CatalogProductFilterValue = string | number | boolean | Date | null;

/**
 * What a condition addresses.
 *
 * `column` names one of the six product columns a selection may filter on;
 * `attribute` addresses one key of `products.attribute_values`, the JSONB bag
 * that has held product attributes and product custom fields alike since
 * feature 061.
 */
export type CatalogProductFilterField =
  | { kind: 'column'; column: 'id' | 'sku' | 'type' | 'status' | 'createdAt' | 'updatedAt' }
  | { kind: 'attribute'; key: string };

/**
 * The operators a condition may use.
 *
 * `contains` and `startsWith` are patterns the **owner** builds, so a caller
 * never writes SQL `LIKE` syntax and the escaping rule has one home. Both match
 * case-insensitively, as the queries they replace already did.
 *
 * **Their value is matched literally.** `%`, `_` and the escape character are
 * characters, not wildcards: the owner escapes them before building the
 * pattern, so `contains "50%"` selects the products whose text carries the
 * three characters `5`, `0`, `%` and not every product with "50" followed by
 * anything. That is part of this shape rather than one provider's detail — a
 * caller passes the value as the operator's user typed it and never
 * pre-escapes, and any provider of {@link CatalogProductFilterPort} owes the
 * same semantics.
 */
export type CatalogProductFilterOperator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'isNull'
  | 'isNotNull';

export interface CatalogProductFilterCondition {
  kind: 'condition';
  field: CatalogProductFilterField;
  op: CatalogProductFilterOperator;
  /**
   * The comparison values. `in` / `nin` read all of them; a range is expressed
   * as two conditions under an `and` group; every other operator reads the
   * first; `isNull` and `isNotNull` read none.
   */
  values: readonly CatalogProductFilterValue[];
}

export interface CatalogProductFilterGroup {
  kind: 'group';
  op: 'and' | 'or';
  children: readonly CatalogProductFilter[];
}

/**
 * The two constants a compiler needs and an empty object cannot express.
 *
 * `all` constrains nothing; `none` can never be satisfied. They are named
 * rather than left to `{}`, because inside an `or` branch an empty predicate
 * collapses the branch instead of matching everything — a superset silently
 * becoming a subset, which is how a filter drops the rows it was meant to keep.
 *
 * Two interfaces rather than one with a two-value `kind`, so `kind` stays a
 * discriminant a translator can narrow the whole union on.
 */
export interface CatalogProductFilterAll {
  kind: 'all';
}
export interface CatalogProductFilterNone {
  kind: 'none';
}
export type CatalogProductFilterConstant = CatalogProductFilterAll | CatalogProductFilterNone;

export type CatalogProductFilter =
  | CatalogProductFilterCondition
  | CatalogProductFilterGroup
  | CatalogProductFilterAll
  | CatalogProductFilterNone;

/** One keyset page of the products a filter selects. */
export interface CatalogSellableProductQuery {
  /**
   * The only ids the query may consider — for a feed, the sales channel's
   * membership, resolved by the caller through the sanctioned bridge accessor
   * (Principle XII). Required, and an empty list selects nothing: this port has
   * no "every product in the platform" reading.
   */
  productIds: readonly string[];
  filter: CatalogProductFilter;
  /** Keyset cursor. Only ids strictly greater come back; `null` starts at the first. */
  afterId?: string | null;
  /** Page size. Defaults to 500, the size the feed pipeline already walks in. */
  limit?: number;
}

/**
 * Container name: `catalogProductFilterPort`. Owner: `catalog`.
 *
 * **Sellable** is this module's floor and this module applies it: `status`
 * `active`, `visibility` `public`, not archived, not soft-deleted. It is
 * conjoined *with* the caller's filter here, so no filter a caller can
 * construct widens past it.
 *
 * Rows come back as {@link CatalogProductRecord} in ascending id order, which
 * is what makes the cursor a keyset rather than an offset: a catalogue that
 * moves under a long walk cannot make the walk skip a row or repeat one.
 *
 * When `catalog` is off both methods fail closed. A feed assembled from a
 * catalogue the platform is refusing to serve is worse than a run that stops
 * and says why.
 */
export interface CatalogProductFilterPort {
  listSellable(query: CatalogSellableProductQuery): Promise<CatalogProductRecord[]>;
  countSellable(query: Omit<CatalogSellableProductQuery, 'afterId' | 'limit'>): Promise<number>;
}
