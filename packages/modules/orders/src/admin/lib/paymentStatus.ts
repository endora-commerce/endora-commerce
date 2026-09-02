import { adminOrderPaymentStatusTransitionSchema, paymentStatusSchema } from '@endora-commerce/contracts';

/**
 * The order's money axis, as the admin screens read and write it (feature 085).
 *
 * Two sets, and they are genuinely different sets — conflating them is what
 * produced the defect Phase C repaired, a hand-written list of four rendered as
 * a `<select>` while the route accepted two of them. Both are derived from the
 * contracts rather than written out here, so neither can drift from the API
 * again, and both live in one file because the list and the detail screen ask
 * different halves of the same question.
 */

/**
 * What may be **shown**: every value the platform can produce, from the wire
 * vocabulary itself. `failed` is among them since feature 085 (FR-001).
 */
export const DISPLAYABLE_PAYMENT_STATUSES: readonly string[] = paymentStatusSchema.options;

/**
 * What an operator may **set**, from the contract
 * `POST /api/v1/admin/orders/:id/payment-status` parses. A failed payment is
 * displayable and must never be settable: a payment fails at the gateway or it
 * does not (FR-024).
 */
export const SELECTABLE_PAYMENT_STATUSES: readonly string[] =
  adminOrderPaymentStatusTransitionSchema.shape.to.options;

/**
 * The i18n key for a payment status.
 *
 * Deliberately the **order detail screen's** existing namespace rather than a
 * second set of keys beside it: the same six sentences already ship in both
 * languages under it, and one vocabulary two screens read is what stops a third
 * copy appearing the next time a surface needs to print this value.
 */
export function paymentStatusLabelKey(code: string): string {
  return `orderDetail.paymentStatus.${code}`;
}

/**
 * What the detail screen's control may show for an order currently at `current`.
 *
 * The order's own value is always shown, even when it is not settable, so the
 * select displays the truth and offers only what the server will take.
 */
export function paymentStatusOptions(current: string): string[] {
  return SELECTABLE_PAYMENT_STATUSES.includes(current)
    ? [...SELECTABLE_PAYMENT_STATUSES]
    : [current, ...SELECTABLE_PAYMENT_STATUSES];
}
