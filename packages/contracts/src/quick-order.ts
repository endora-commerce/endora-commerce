import { z } from 'zod';
import { uuidSchema } from './common.js';

/**
 * Quick-order contracts (T202 / FR-031). The quick-order page lets buyers
 * paste CSV with `sku,quantity` headers and have the platform validate
 * each row against the catalog before adding to cart. The importer is
 * lenient on whitespace + quoting; the response is a partition of the
 * rows into recognised + rejected, with line numbers preserved so the UI
 * can highlight problem rows.
 */

export const quickOrderImportRequestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});
export type QuickOrderImportRequest = z.infer<typeof quickOrderImportRequestSchema>;

export const recognizedQuickOrderItemSchema = z.object({
  line: z.number().int().positive(),
  sku: z.string().min(1).max(64),
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  quantity: z.number().int().positive(),
});
export type RecognizedQuickOrderItem = z.infer<typeof recognizedQuickOrderItemSchema>;

export const rejectedQuickOrderItemSchema = z.object({
  line: z.number().int().positive(),
  raw: z.string(),
  reason: z.enum([
    'sku_missing',
    'quantity_invalid',
    'product_not_found',
    'product_archived',
    'malformed_row',
  ]),
});
export type RejectedQuickOrderItem = z.infer<typeof rejectedQuickOrderItemSchema>;

export const quickOrderImportResponseSchema = z.object({
  recognized: z.array(recognizedQuickOrderItemSchema),
  rejected: z.array(rejectedQuickOrderItemSchema),
});
export type QuickOrderImportResponse = z.infer<typeof quickOrderImportResponseSchema>;

/** Type-ahead search for SKU / name — used by the per-row fast-add field. */
export const quickOrderSearchQuerySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type QuickOrderSearchQuery = z.infer<typeof quickOrderSearchQuerySchema>;

export const quickOrderSearchResultSchema = z.object({
  productId: uuidSchema,
  sku: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['draft', 'active', 'inactive']),
});
export type QuickOrderSearchResult = z.infer<typeof quickOrderSearchResultSchema>;
