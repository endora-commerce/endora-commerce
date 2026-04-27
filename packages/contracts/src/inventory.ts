import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Inventory module contracts (FR-060..FR-061). Covers numeric stock levels
 * (per Product / ProductVariant) and availability notifications.
 */

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
