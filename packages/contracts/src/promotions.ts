import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Promotions (FR-052). Three kinds supported in MVP: percentage_off,
 * amount_off, free_delivery. Each Promotion may carry a code, date range,
 * and a redemption cap.
 */

export const promotionKindSchema = z.enum(['percentage_off', 'amount_off', 'free_delivery']);
export type PromotionKind = z.infer<typeof promotionKindSchema>;

export const promotionSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  kind: promotionKindSchema,
  value: z.number().finite(),
  currency: z.string().length(3).optional(),
  minCartTotal: z.number().finite().nonnegative().optional(),
  usageLimit: z.number().int().positive().optional(),
  usedCount: z.number().int().nonnegative(),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
});
export type Promotion = z.infer<typeof promotionSchema>;

export const createPromotionRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  kind: promotionKindSchema,
  value: z.number().finite(),
  currency: z.string().length(3).optional(),
  minCartTotal: z.number().finite().nonnegative().optional(),
  usageLimit: z.number().int().positive().optional(),
  validFrom: isoDateTimeSchema.optional(),
  validUntil: isoDateTimeSchema.optional(),
});
