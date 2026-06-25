/**
 * CreditTopupPort — feature 046 (US5 / US7, R7).
 *
 * A "credit toward future orders" resolution credits the customer's
 * organization credit limit (handled by the existing credit_limits module,
 * whose checkout credit-check already provides redemption). Returns
 * `applied: false` when the organization has no credit limit grant.
 */
export interface CreditTopupInput {
  organizationId: string;
  amount: number;
  currency: string;
  returnCaseId: string;
}

export interface CreditTopupResult {
  applied: boolean;
  availableAmountAfter?: number;
}

export interface CreditTopupPort {
  creditFromReturn(input: CreditTopupInput): Promise<CreditTopupResult>;
}
