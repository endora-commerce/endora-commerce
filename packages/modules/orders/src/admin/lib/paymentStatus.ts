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
 * What the detail screen's "Change…" dialog offers for an order currently at
 * `current` (issue #1470, DS-18): every settable value except the current one.
 *
 * The current value is shown beside the control as a badge, never offered as a
 * target, so an unsettable one (`failed`, `awaiting_payment`, `deferred`) is
 * still read and cannot be chosen. Payment status stays operator-editable when
 * the `payments` module records transactions too (owner decision DEC-11, issue
 * #1470): a bank transfer is confirmed by a person.
 */
export function paymentStatusTargets(current: string): string[] {
  return SELECTABLE_PAYMENT_STATUSES.filter((code) => code !== current);
}
