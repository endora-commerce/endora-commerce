import type { PaymentMethodSummary } from '../api/methods';

/**
 * Which of the catalogue's payment methods checkout will actually offer this
 * buyer.
 *
 * Lifted out of the checkout page unchanged, for two reasons. It decides the
 * count `placeOrderBlock` gates on — an option the buyer cannot pick must not
 * keep the Place Order button enabled — and it is the tree's only statement
 * about who may pay on credit, which until now was an inline `filter` inside a
 * Server Component and therefore assertable nowhere.
 *
 * ## The credit-limit rule, and where it is *not* enforced
 *
 * `CreditLimitAdapter.validateUseOnStorefront` inherits
 * `BaseAdapter`'s `() => true`, so the backend's eligibility service offers a
 * `credit_limit` method to **every** buyer, including one whose organization
 * holds no grant at all. The rule below is the only thing between that answer
 * and the buyer, and a direct `POST /api/v1/orders` past it is refused by order
 * placement with `409 CREDIT_LIMIT_NOT_GRANTED`.
 *
 * So the outcome is right at every exit and the *layer* is wrong: the adapter is
 * asked the question and cannot answer it, because a `PaymentEligibilityContext`
 * carries the organization id and nothing about its credit, and `payments`
 * declares no edge to `credit_limits` in any of the three manifest forms. Moving
 * the answer there is a new cross-module edge and a product decision about what
 * happens when `credit_limits` is switched off, not a repair; it is recorded as
 * such rather than made here.
 */
export function selectablePaymentMethods(
  methods: readonly PaymentMethodSummary[],
  buyer: {
    /** The organization's granted credit, or `null` when it holds no grant. */
    creditAvailable: number | null;
    /** What the buyer would spend, in the same currency the limit is held in. */
    cartTotal: number;
  },
): PaymentMethodSummary[] {
  return methods.filter((m) => {
    // Defensive: the backend already only returns active methods, but never
    // offer an inactive method at checkout even if one slips through (feature
    // 049 — an inactive method must not be selectable).
    if (m.status !== 'active') return false;
    if (m.kind !== 'credit_limit') return true;
    // Hide the credit_limit-kind method(s) when the buyer's organization hasn't
    // been granted a limit, or when the cart total clearly exceeds the available
    // credit. The backend rejects an over-limit reservation anyway, but a
    // friendlier UX is to drop the option early.
    if (buyer.creditAvailable === null) return false;
    return buyer.creditAvailable >= buyer.cartTotal;
  });
}
