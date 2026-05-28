import { z } from 'zod';
import {
  addressSnapshotSchema,
  isoDateTimeSchema,
  orderStatusSchema,
  paymentStatusSchema,
  uuidSchema,
} from './common.js';

/**
 * Orders module contracts — Source of truth per Principle V.
 * See specs/001-b2b-platform-foundation/contracts/orders.contract.md.
 */

// --- Resource types --------------------------------------------------------

export const orderItemSchema = z.object({
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
  unitPrice: z.number().finite().nonnegative(),
  taxRate: z.number().finite().nonnegative(),
  lineTotal: z.number().finite().nonnegative(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const nextActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('redirect_to_gateway'),
    url: z.string().url(),
    expiresAt: isoDateTimeSchema,
  }),
  z.object({
    kind: z.literal('awaiting_transfer'),
    accountDetails: z.object({
      accountNumber: z.string(),
      accountHolder: z.string(),
      bankName: z.string(),
      amount: z.number().finite(),
      currency: z.string().length(3),
      reference: z.string(),
    }),
  }),
  z.object({
    kind: z.literal('none'),
  }),
]);
export type NextAction = z.infer<typeof nextActionSchema>;

export const orderSchema = z.object({
  id: uuidSchema,
  /**
   * Customer-facing business Order ID (feature 036). Distinct from the
   * database `id` (UUID): `${prefix}${sequence}${suffix}`, where prefix/suffix
   * come from the `orders.business_id.*` settings. This is the identifier
   * shown to the Customer; `id` stays internal.
   */
  businessId: z.string(),
  organizationId: uuidSchema,
  placedByCustomerAccountId: uuidSchema,
  placedOnBehalfByAdminUserId: uuidSchema.nullable(),
  salesChannelId: uuidSchema,
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  deliveryAddress: addressSnapshotSchema,
  billingAddress: addressSnapshotSchema,
  deliveryMethod: z.object({
    id: uuidSchema,
    code: z.string(),
    name: z.string(),
    cost: z.number().finite().nonnegative(),
  }),
  paymentMethod: z.object({
    id: uuidSchema,
    code: z.string(),
    name: z.string(),
    kind: z.enum(['bank_transfer', 'pickup', 'credit_limit', 'gateway']),
  }),
  sourceQuoteRequestId: uuidSchema.nullable(),
  items: z.array(orderItemSchema),
  subtotal: z.number().finite().nonnegative(),
  taxTotal: z.number().finite().nonnegative(),
  discountTotal: z.number().finite().nonnegative(),
  deliveryTotal: z.number().finite().nonnegative(),
  total: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  placedAt: isoDateTimeSchema,
  customerNote: z.string().nullable(),
  nextAction: nextActionSchema.nullable(),
});
export type Order = z.infer<typeof orderSchema>;

// --- Requests --------------------------------------------------------------

export const placeOrderRequestSchema = z.object({
  deliveryAddressId: uuidSchema,
  billingAddressId: uuidSchema,
  deliveryMethodId: uuidSchema,
  paymentMethodId: uuidSchema,
  salesChannelId: uuidSchema.optional(),
  promotionCode: z.string().optional(),
  customerNote: z.string().max(4000).optional(),
  idempotencyKey: z.string().optional(),
});
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

export const adminOrderStatusTransitionSchema = z.object({
  to: orderStatusSchema,
  reason: z.string().optional(),
});

export const adminOrderPaymentStatusTransitionSchema = z.object({
  to: z.enum(['paid', 'refunded']),
  reason: z.string().optional(),
  invoiceId: uuidSchema.optional(),
});

export const adminOrderRefundRequestSchema = z.object({
  amount: z.number().finite().positive().optional(),
});

export const adminOrderShippedRequestSchema = z.object({
  trackingNumber: z.string(),
  carrierCode: z.string(),
  shippedAt: isoDateTimeSchema,
});
