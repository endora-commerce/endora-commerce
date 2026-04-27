import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Promotion contracts (T129, T132 / FR-052).
 *
 * Three kinds shipped in this slice:
 *   - `percentage_off` — `value` is 0..100
 *   - `amount_off`     — `value` is money in `currency`
 *   - `free_delivery`  — `value` is ignored; the cart's delivery cost is zeroed
 *
 * Eligibility rules:
 *   - `code` (optional) — when present, only carts that present the code apply;
 *                          when null, the promotion applies automatically to
 *                          every eligible cart.
 *   - `minCartSubtotal`  — cart subtotal threshold (in promotion currency).
 *   - `validFrom` / `validUntil` — clock-bound validity window.
 *   - `organizationId` / `customerGroupId` — restrict to a single Customer / group.
 *   - `categoryId` / `productId` — restrict effect to lines in the chosen scope.
 */

export const promotionKindSchema = z.enum([
  'percentage_off',
  'amount_off',
  'free_delivery',
]);
export type PromotionKind = z.infer<typeof promotionKindSchema>;

export const promotionSchema = z.object({
  id: uuidSchema,
  code: z.string().nullable(),
  name: z.string().min(1).max(160),
  kind: promotionKindSchema,
  value: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217').nullable(),
  minCartSubtotal: z.number().finite().nonnegative().nullable(),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  productId: uuidSchema.nullable(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Promotion = z.infer<typeof promotionSchema>;

export const upsertPromotionRequestSchema = z
  .object({
    code: z.string().min(1).max(64).nullable().optional(),
    name: z.string().min(1).max(160),
    kind: promotionKindSchema,
    value: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    minCartSubtotal: z.number().finite().nonnegative().nullable().optional(),
    validFrom: isoDateTimeSchema.nullable().optional(),
    validUntil: isoDateTimeSchema.nullable().optional(),
    organizationId: uuidSchema.nullable().optional(),
    customerGroupId: uuidSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    productId: uuidSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'amount_off' && value.currency == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'amount_off promotions require a currency',
        path: ['currency'],
      });
    }
    if (value.kind === 'percentage_off' && (value.value < 0 || value.value > 100)) {
      ctx.addIssue({
        code: 'custom',
        message: 'percentage_off value must be between 0 and 100',
        path: ['value'],
      });
    }
  });

// --- Cart application ------------------------------------------------------

export const cartLineSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  categoryIds: z.array(uuidSchema),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSnapshotSchema = z.object({
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(cartLineSchema),
  deliveryTotal: z.number().finite().nonnegative(),
  /** Promotion code presented at checkout, if any. */
  promotionCode: z.string().nullable().optional(),
});
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;

export const promotionApplicationSchema = z.object({
  subtotal: z.number().finite().nonnegative(),
  discountTotal: z.number().finite().nonnegative(),
  deliveryTotal: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
  appliedPromotions: z.array(
    z.object({
      promotionId: uuidSchema,
      kind: promotionKindSchema,
      amount: z.number().finite().nonnegative(),
    }),
  ),
});
export type PromotionApplication = z.infer<typeof promotionApplicationSchema>;
