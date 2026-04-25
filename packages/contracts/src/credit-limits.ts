import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Credit Limit module contracts (US6) — see
 * specs/001-b2b-platform-foundation/contracts/credit_limits.contract.md.
 */

export const creditLimitReservationStatusSchema = z.enum(['active', 'released']);
export type CreditLimitReservationStatus = z.infer<typeof creditLimitReservationStatusSchema>;

export const creditLimitReservationReleaseReasonSchema = z.enum([
  'invoice_paid',
  'order_cancelled',
  'admin_revocation',
]);
export type CreditLimitReservationReleaseReason = z.infer<
  typeof creditLimitReservationReleaseReasonSchema
>;

export const creditLimitViewSchema = z.object({
  organizationId: uuidSchema,
  grantedAmount: z.number().finite().nonnegative(),
  availableAmount: z.number().finite(),
  currency: z.string().length(3),
  activeReservations: z.array(
    z.object({
      orderId: uuidSchema,
      amount: z.number().finite(),
      createdAt: isoDateTimeSchema,
    }),
  ),
  grantedAt: isoDateTimeSchema,
});
export type CreditLimitView = z.infer<typeof creditLimitViewSchema>;

export const grantCreditLimitRequestSchema = z.object({
  grantedAmount: z.number().finite().positive(),
  currency: z.string().length(3),
  reason: z.string().max(2000).optional(),
});
export type GrantCreditLimitRequest = z.infer<typeof grantCreditLimitRequestSchema>;

export const adjustCreditLimitRequestSchema = z.object({
  grantedAmount: z.number().finite().nonnegative(),
  reason: z.string().max(2000).optional(),
  allowOverAllocation: z.boolean().optional(),
});
export type AdjustCreditLimitRequest = z.infer<typeof adjustCreditLimitRequestSchema>;
