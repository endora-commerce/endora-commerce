/**
 * PaymentRefundPort — feature 046 (US5, R5).
 *
 * The documented interface through which the returns module asks the payments
 * domain to return funds. The implementation resolves the order's payment and,
 * where the payment method supports an automatic refund, issues it; otherwise it
 * reports `pending_manual` so an operator settles it out of band (FR-035).
 *
 * All three declarations moved to `@b2b/contracts` in feature 075's Phase P,
 * keeping their direction: `returns` still states the shape, the gateway
 * modules still satisfy it. Re-exported here for the length of Phase P, which
 * cuts no consumer.
 */
export type { PaymentRefundInput, PaymentRefundResult, PaymentRefundPort } from '@b2b/contracts';
