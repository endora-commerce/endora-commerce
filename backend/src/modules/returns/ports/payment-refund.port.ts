/**
 * PaymentRefundPort — feature 046 (US5, R5).
 *
 * The documented interface through which the returns module asks the payments
 * domain to return funds. The implementation resolves the order's payment and,
 * where the payment method supports an automatic refund, issues it; otherwise it
 * reports `pending_manual` so an operator settles it out of band (FR-035).
 */
export interface PaymentRefundInput {
  orderId: string;
  amount: number;
  currency: string;
  paymentMethodId?: string;
  /** Idempotency key (the return case id) so retries do not double-refund. */
  idempotencyKey: string;
}

export interface PaymentRefundResult {
  state: 'issued' | 'pending_manual' | 'failed';
  externalReference?: string | null;
  providerDetails?: Record<string, unknown>;
  failureReason?: string;
}

export interface PaymentRefundPort {
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}
