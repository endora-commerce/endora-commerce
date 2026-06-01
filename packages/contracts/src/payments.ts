import { z } from 'zod';
import { isoDateTimeSchema, paymentStatusSchema, uuidSchema } from './common.js';

/**
 * Payments (FR-072). Drivers: bank_transfer, pickup, credit_limit, gateway.
 * Driver-specific NextAction payloads live in orders.ts (the Place Order
 * response body).
 */

export const paymentMethodKindSchema = z.enum([
  'bank_transfer',
  'pickup',
  'credit_limit',
  'gateway',
]);
export type PaymentMethodKind = z.infer<typeof paymentMethodKindSchema>;

export const paymentMethodSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  kind: paymentMethodKindSchema,
  status: z.enum(['active', 'inactive']),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  paymentMethodId: uuidSchema,
  status: paymentStatusSchema,
  amount: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  paidAt: isoDateTimeSchema.nullable(),
  externalReference: z.string().nullable(),
  // Feature 034 — payment-process detail captured by the adapter on receive_payment.
  providerDetails: z.record(z.string(), z.unknown()).nullable().optional(),
  failureReason: z.string().nullable().optional(),
  attemptNo: z.number().int().positive().default(1),
});
export type Payment = z.infer<typeof paymentSchema>;

export const deliveryMethodSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  cost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(['active', 'inactive']),
});
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;
