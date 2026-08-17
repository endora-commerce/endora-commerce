/**
 * CreditTopupPort — feature 046 (US5 / US7, R7).
 *
 * A "credit toward future orders" resolution credits the customer's
 * organization credit limit (handled by the existing credit_limits module,
 * whose checkout credit-check already provides redemption). Returns
 * `applied: false` when the organization has no credit limit grant.
 *
 * All three declarations moved to `@b2b/contracts` in feature 075's Phase P,
 * keeping their direction: `returns` still states the shape and
 * `credit_limits` still satisfies it. Re-exported here for the length of
 * Phase P, which cuts no consumer.
 */
export type { CreditTopupInput, CreditTopupResult, CreditTopupPort } from '@b2b/contracts';
