import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Inventory module contracts — feature 010 multi-warehouse rewrite.
 * Source of truth per Constitution Principle V; the backend re-uses
 * these schemas as route validators and the frontends consume the
 * inferred TS types.
 *
 * See specs/010-inventory-module/contracts/ for the HTTP contract docs.
 *
 * Foundation 001 schemas (`stockLevelSchema`, `adjustStockRequestSchema`,
 * `availabilityNotificationRequestSchema`) are preserved at the bottom
 * of the file for backward compatibility with the existing admin
 * inventory routes; new code should consume the feature-010 schemas.
 */

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const warehouseAddressSchema = z.object({
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
});
export type WarehouseAddress = z.infer<typeof warehouseAddressSchema>;

export const warehouseContactSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type WarehouseContact = z.infer<typeof warehouseContactSchema>;

export const warehouseSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(64),
  active: z.boolean(),
  description: z.string().nullable(),
  address: warehouseAddressSchema.nullable(),
  contact: warehouseContactSchema.nullable(),
  /**
   * Per-warehouse fallback low-stock threshold. Applied when the
   * Product itself has no `lowStockThreshold`. NULL means: no fallback
   * from this warehouse — system falls through to the global threshold.
   */
  defaultLowStockThreshold: z.number().int().nonnegative().nullable(),
  totals: z
    .object({
      products: z.number().int().nonnegative(),
      onHand: z.number().int().nonnegative(),
      isDefaultForChannelCount: z.number().int().nonnegative(),
    })
    .optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const createWarehouseRequestSchema = z.object({
  name: z.string().min(1).max(160),
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*[a-z0-9]$/),
  active: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  address: warehouseAddressSchema.nullable().optional(),
  contact: warehouseContactSchema.nullable().optional(),
  defaultLowStockThreshold: z.number().int().nonnegative().nullable().optional(),
});
export type CreateWarehouseRequest = z.infer<typeof createWarehouseRequestSchema>;

export const updateWarehouseRequestSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    active: z.boolean().optional(),
    description: z.string().max(2000).nullable().optional(),
    address: warehouseAddressSchema.nullable().optional(),
    contact: warehouseContactSchema.nullable().optional(),
    defaultLowStockThreshold: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type UpdateWarehouseRequest = z.infer<typeof updateWarehouseRequestSchema>;

// ---------------------------------------------------------------------------
// Warehouse ↔ Sales channel assignment
// ---------------------------------------------------------------------------

export const warehouseChannelAssignmentSchema = z.object({
  id: uuidSchema,
  warehouseId: uuidSchema,
  warehouseName: z.string(),
  warehouseCode: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  assignedAt: isoDateTimeSchema,
});
export type WarehouseChannelAssignment = z.infer<typeof warehouseChannelAssignmentSchema>;

export const assignWarehouseToChannelRequestSchema = z.object({
  warehouseId: uuidSchema,
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type AssignWarehouseToChannelRequest = z.infer<typeof assignWarehouseToChannelRequestSchema>;

export const patchWarehouseChannelAssignmentRequestSchema = z
  .object({
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PatchWarehouseChannelAssignmentRequest = z.infer<
  typeof patchWarehouseChannelAssignmentRequestSchema
>;

// ---------------------------------------------------------------------------
// Stock levels + Inventory landing
// ---------------------------------------------------------------------------

export const inventoryLandingKpisSchema = z.object({
  totalProductsTracked: z.number().int().nonnegative(),
  totalOnHand: z.number().int().nonnegative(),
  outOfStockCount: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  perWarehouseTotals: z.array(
    z.object({
      warehouseId: uuidSchema,
      warehouseCode: z.string(),
      onHand: z.number().int().nonnegative(),
    }),
  ),
});
export type InventoryLandingKpis = z.infer<typeof inventoryLandingKpisSchema>;

export const stockDisplayBandSchema = z.enum([
  'high',
  'medium',
  'low',
  'out_of_stock',
  'available',
]);
export type StockDisplayBand = z.infer<typeof stockDisplayBandSchema>;

export const stockLevelRowSchema = z.object({
  productId: uuidSchema,
  productSku: z.string(),
  productName: z.string(),
  manageStock: z.boolean(),
  backorderEnabled: z.boolean(),
  lowStockThreshold: z.number().int().nullable(),
  lowStockThresholdMode: z.enum(['cumulative', 'per_warehouse']),
  perWarehouse: z.array(
    z.object({
      warehouseId: uuidSchema,
      warehouseCode: z.string(),
      onHand: z.number().int().nonnegative(),
      reserved: z.number().int().nonnegative(),
      /**
       * Effective low-stock threshold for this (product, warehouse).
       * Resolved via: explicit row in `product_warehouse_low_stock_thresholds`
       * → `warehouses.default_low_stock_threshold` fallback → null.
       * Surfaced regardless of mode so the admin UI can render it.
       */
      lowStockThreshold: z.number().int().nullable(),
    }),
  ),
  cumulativeOnHand: z.number().int().nonnegative(),
  displayBand: stockDisplayBandSchema,
  isLowStock: z.boolean(),
  isOutOfStock: z.boolean(),
});
export type StockLevelRow = z.infer<typeof stockLevelRowSchema>;

/**
 * Bulk replace per-warehouse low-stock thresholds for one product.
 * The submitted set is the new truth: any (product, warehouse) row not
 * mentioned here is deleted. Pass `threshold: null` in an entry to
 * delete that single entry while keeping others.
 */
export const setProductWarehouseLowStockThresholdsRequestSchema = z.object({
  productId: uuidSchema,
  thresholds: z.array(
    z.object({
      warehouseId: uuidSchema,
      threshold: z.number().int().nonnegative().nullable(),
    }),
  ),
});
export type SetProductWarehouseLowStockThresholdsRequest = z.infer<
  typeof setProductWarehouseLowStockThresholdsRequestSchema
>;

export const setStockLevelRequestSchema = z.object({
  productId: uuidSchema,
  warehouseId: uuidSchema,
  variantId: uuidSchema.optional(),
  onHand: z.number().int().nonnegative(),
});
export type SetStockLevelRequest = z.infer<typeof setStockLevelRequestSchema>;

// ---------------------------------------------------------------------------
// Thresholds + display mode
// ---------------------------------------------------------------------------

export const inventoryDisplayModeSchema = z.enum([
  'exact',
  'band',
  'available_or_not',
]);
export type InventoryDisplayMode = z.infer<typeof inventoryDisplayModeSchema>;

export const thresholdTripleSchema = z.object({
  high: z.number().int().nullable(),
  medium: z.number().int().nullable(),
  low: z.number().int().nullable(),
});
export type ThresholdTriple = z.infer<typeof thresholdTripleSchema>;

export const inventoryThresholdsSchema = z.object({
  global: thresholdTripleSchema,
  perCategory: z.array(
    z.object({ categoryId: uuidSchema }).merge(thresholdTripleSchema),
  ),
  perProduct: z.array(
    z.object({ productId: uuidSchema }).merge(thresholdTripleSchema),
  ),
});
export type InventoryThresholds = z.infer<typeof inventoryThresholdsSchema>;

export const patchInventoryThresholdsRequestSchema = z
  .object({
    global: thresholdTripleSchema.partial().optional(),
    perCategory: z
      .array(
        z.object({ categoryId: uuidSchema }).merge(thresholdTripleSchema.partial()),
      )
      .optional(),
    perProduct: z
      .array(
        z.object({ productId: uuidSchema }).merge(thresholdTripleSchema.partial()),
      )
      .optional(),
  })
  .strict();
export type PatchInventoryThresholdsRequest = z.infer<
  typeof patchInventoryThresholdsRequestSchema
>;

// Storefront-public stock read

export const storefrontProductStockSchema = z.object({
  productId: uuidSchema,
  manageStock: z.boolean(),
  backorderEnabled: z.boolean(),
  displayMode: inventoryDisplayModeSchema,
  displayBand: stockDisplayBandSchema,
  exactOnHand: z.number().int().nullable(),
  isOutOfStock: z.boolean(),
  showNotifyButton: z.boolean(),
});
export type StorefrontProductStock = z.infer<typeof storefrontProductStockSchema>;

// ---------------------------------------------------------------------------
// Notify when available
// ---------------------------------------------------------------------------

export const availabilityNotificationStatusSchema = z.enum([
  'queued',
  'notified',
  'cancelled',
]);
export type AvailabilityNotificationStatus = z.infer<
  typeof availabilityNotificationStatusSchema
>;

export const availabilityNotificationSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string().optional(),
  productSku: z.string().optional(),
  customerAccountId: uuidSchema.nullable(),
  email: z.string().email(),
  status: availabilityNotificationStatusSchema,
  queuedAt: isoDateTimeSchema,
  notifiedAt: isoDateTimeSchema.nullable(),
});
export type AvailabilityNotification = z.infer<typeof availabilityNotificationSchema>;

export const subscribeAvailabilityNotificationRequestSchema = z.object({
  productId: uuidSchema,
  email: z.string().email(),
});
export type SubscribeAvailabilityNotificationRequest = z.infer<
  typeof subscribeAvailabilityNotificationRequestSchema
>;

export const patchAvailabilityNotificationRequestSchema = z.object({
  status: z.literal('cancelled'),
});
export type PatchAvailabilityNotificationRequest = z.infer<
  typeof patchAvailabilityNotificationRequestSchema
>;

// ---------------------------------------------------------------------------
// Fulfilment strategy
// ---------------------------------------------------------------------------

export const fulfilmentStrategySchema = z.enum([
  'any',
  'default_first',
  'lowest_stock_first',
  'highest_stock_first',
  'defined_order',
]);
export type FulfilmentStrategy = z.infer<typeof fulfilmentStrategySchema>;

// ---------------------------------------------------------------------------
// Stock import
// ---------------------------------------------------------------------------

export const stockImportErrorSchema = z.object({
  row: z.number().int().positive(),
  sku: z.string(),
  reason: z.enum(['product_not_found', 'invalid_quantity', 'malformed_row']),
});
export type StockImportError = z.infer<typeof stockImportErrorSchema>;

export const stockImportResultSchema = z.object({
  rowsRead: z.number().int().nonnegative(),
  rowsApplied: z.number().int().nonnegative(),
  rowsSkipped: z.number().int().nonnegative(),
  errors: z.array(stockImportErrorSchema),
});
export type StockImportResult = z.infer<typeof stockImportResultSchema>;

// ---------------------------------------------------------------------------
// Foundation 001 backward-compat schemas (preserved)
// ---------------------------------------------------------------------------

export const stockLevelSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
});
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const adjustStockRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  /** Signed delta — positive for receipts, negative for write-offs. */
  delta: z.number().int(),
  reason: z.string().optional(),
});
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

export const availabilityNotificationRequestSchema = z.object({
  variantId: uuidSchema.optional(),
});
export type AvailabilityNotificationRequest = z.infer<
  typeof availabilityNotificationRequestSchema
>;
