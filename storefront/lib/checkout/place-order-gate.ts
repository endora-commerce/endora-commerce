/**
 * Why checkout cannot be submitted, if it cannot.
 *
 * Two independent gates end at one disabled button, so the button itself must
 * not decide which of them it is standing for:
 *
 *  - `moderation` — the Organization is not cleared to transact. It outranks
 *    everything below it, because a cleared payment method would not help.
 *  - `no-payment-method` — checkout can offer nothing to pay with. Either the
 *    shop configured no method, or an operator switched the platform's payment
 *    capability off; the buyer is told the same thing in both cases
 *    (`checkout.payment.none`).
 *
 * Before this existed the button disabled on moderation alone, so a buyer with
 * an empty payment section could still submit: `paymentMethodId` went up as an
 * empty string and `placeOrderRequestSchema`'s `uuidSchema` answered
 * `400 VALIDATION_FAILED` — a schema error shown where a disabled control and a
 * sentence belong.
 *
 * Pure and exported so the precedence can be unit-tested; the storefront test
 * harness is SSR-only, so the logic lives here rather than inside the component.
 */
export type PlaceOrderBlock = 'moderation' | 'no-payment-method' | null;

export function placeOrderBlock(input: {
  canTransact: boolean;
  /**
   * How many payment methods checkout will actually render. Counted *after* the
   * page's own eligibility filters (inactive rows, and a credit-limit method the
   * buyer has no granted limit for), because an option the buyer cannot pick is
   * not an option.
   */
  paymentMethodCount: number;
}): PlaceOrderBlock {
  if (!input.canTransact) return 'moderation';
  if (input.paymentMethodCount <= 0) return 'no-payment-method';
  return null;
}
