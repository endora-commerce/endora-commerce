import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Price Lists (FR-050..FR-051). A PriceList is a Sales-Channel-scoped set of
 * per-Product (or per-Variant) unit prices + per-Organization overrides.
 *
 * Backend resolves the effective unit price for (product, variant?, org?,
 * salesChannel) and exposes it to Cart / Order pricing.
 */

export const priceListKindSchema = z.enum(['default', 'organization', 'promotion']);
export type PriceListKind = z.infer<typeof priceListKindSchema>;

export const priceListSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  kind: priceListKindSchema,
  currency: z.string().length(3),
  salesChannelIds: z.array(uuidSchema),
  organizationIds: z.array(uuidSchema),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
  priority: z.number().int(),
});
export type PriceList = z.infer<typeof priceListSchema>;

export const priceListItemSchema = z.object({
  id: uuidSchema,
  priceListId: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  unitPrice: z.number().finite().nonnegative(),
  quantityFrom: z.number().int().positive().nullable(),
});
export type PriceListItem = z.infer<typeof priceListItemSchema>;

export const createPriceListRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  kind: priceListKindSchema,
  currency: z.string().length(3),
  salesChannelIds: z.array(uuidSchema).optional(),
  organizationIds: z.array(uuidSchema).optional(),
  validFrom: isoDateTimeSchema.optional(),
  validUntil: isoDateTimeSchema.optional(),
  priority: z.number().int().optional(),
});

export const upsertPriceListItemRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  unitPrice: z.number().finite().nonnegative(),
  quantityFrom: z.number().int().positive().optional(),
});
