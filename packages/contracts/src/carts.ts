import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from './common.js';

/**
 * Cart + CartItem contracts (US2). The Cart can be anonymous (cookie-held) or
 * logged-in; `mergeAnonymousOnLogin` merges the anonymous basket into the
 * authenticated Cart on sign-in (R-09, FR-010).
 */

export const cartItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productSnapshot: z.object({
    sku: z.string(),
    name: z.string(),
    primaryAssetUrl: z.string().url().nullable(),
  }),
  variantId: uuidSchema.nullable(),
  variantSnapshot: z
    .object({
      sku: z.string(),
      label: z.string(),
    })
    .nullable(),
  quantity: z.number().int().positive(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: uuidSchema,
  customerAccountId: uuidSchema.nullable(),
  organizationId: uuidSchema.nullable(),
  anonymousCartToken: z.string().nullable(),
  items: z.array(cartItemSchema),
  subtotal: moneySchema,
  itemCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Cart = z.infer<typeof cartSchema>;

export const addCartItemRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  quantity: z.number().int().positive(),
});
export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>;

export const updateCartItemRequestSchema = z.object({
  quantity: z.number().int().positive(),
});
export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>;
