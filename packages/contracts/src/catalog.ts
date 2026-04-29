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

export const productTypeSchema = z.enum(['simple', 'variant', 'grouped', 'virtual']);
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
});
export type FilterDefinition = z.infer<typeof filterDefinitionSchema>;

// --- Admin write-surface requests -------------------------------------------

export const createProductRequestSchema = z.object({
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
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = createProductRequestSchema
  .partial()
  // sku and type are immutable after creation (409 FIELD_IMMUTABLE if sent)
  .omit({ sku: true, type: true });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const createVariantRequestSchema = z.object({
  sku: z.string().min(1).max(64),
  variantAttributeValues: z.record(z.string(), z.unknown()),
  priceOverride: z.number().finite().optional(),
  stockLevel: z.number().int().nonnegative().optional(),
});
export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

export const createAttributeRequestSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, 'must be snake_case, start with a letter'),
    label: multilingualStringSchema,
    valueType: attributeValueTypeSchema,
    enumValues: z.array(z.string()).optional(),
    isSearchable: z.boolean(),
    isFilterable: z.boolean(),
    isVariantAxis: z.boolean(),
  })
  .refine(
    (v) => (v.valueType === 'enum' ? Array.isArray(v.enumValues) && v.enumValues.length > 0 : true),
    {
      message: 'enumValues is required when valueType=enum',
      path: ['enumValues'],
    },
  );
export type CreateAttributeRequest = z.infer<typeof createAttributeRequestSchema>;

export const updateAttributeRequestSchema = z
  .object({
    label: multilingualStringSchema.optional(),
    enumValues: z.array(z.string()).optional(),
    isSearchable: z.boolean().optional(),
    isFilterable: z.boolean().optional(),
    isVariantAxis: z.boolean().optional(),
  })
  .strict();
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
