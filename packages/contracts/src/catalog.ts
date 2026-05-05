import { z } from 'zod';
import {
  isoDateTimeSchema,
  moneySchema,
  multilingualStringSchema,
  productVisibilitySchema,
  uuidSchema,
} from './common.js';

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

export const productStatusSchema = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof productStatusSchema>;

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

// --- Product summary (list response) ----------------------------------------

export const productSummarySchema = z.object({
  id: uuidSchema,
  sku: z.string().min(1).max(64),
  type: productTypeSchema,
  name: z.string(),
  slug: z.string(),
  categorySlugs: z.array(z.string()),
  primaryAssetUrl: z.string().url().nullable(),
  price: moneySchema.nullable(),
  stockIndicator: stockIndicatorSchema.nullable(),
  stockLevel: z.number().int().nullable(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

// --- Product variant --------------------------------------------------------

export const productVariantSchema = z.object({
  id: uuidSchema,
  sku: z.string().min(1).max(64),
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
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

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
  sku: z.string().min(1).max(64),
  type: productTypeSchema,
  name: multilingualStringSchema,
  description: multilingualStringSchema,
  categoryIds: z.array(uuidSchema),
  attributeValues: z.record(z.string(), z.unknown()),
  stockMode: stockModeSchema.optional(),
  visibility: productVisibilitySchema,
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

export const createVariantRequestSchema = z.object({
  sku: z.string().min(1).max(64),
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
   * Feature 012 — rich option list for select / enum / multiselect types.
   * When supplied alongside the legacy `enumValues`, this wins. The
   * service layer creates corresponding `attribute_options` rows.
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
      // The service maps either to `attribute_options` rows.
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

export const createCategoryRequestSchema = z.object({
  parentCategoryId: uuidSchema.nullable().optional(),
  name: multilingualStringSchema,
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case'),
  sortOrder: z.number().int().optional(),
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
    /** Feature 013 / US5 — Library Asset rendered as the category's main image. */
    mainImageAssetId: uuidSchema.nullable().optional(),
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
