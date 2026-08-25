import type { MessageKey } from '../i18n/messages';

/**
 * Why checkout cannot be submitted, if it cannot.
 *
 * Three independent gates end at one disabled button, so the button itself must
 * not decide which of them it is standing for. In the order they are answered:
 *
 *  - `moderation` — the Organization is not cleared to transact. It outranks
 *    everything below it, because neither a delivery method nor a payment method
 *    would help an organization that may not order at all.
 *  - `no-delivery-method` — checkout can offer nothing to have the order shipped
 *    or collected with. Either the shop configured no method, or an operator
 *    switched `delivery_methods` off; the buyer is told the same thing in both
 *    cases (`checkout.delivery.none`).
 *  - `no-payment-method` — checkout can offer nothing to pay with. Either the
 *    shop configured no method, or an operator switched the platform's payment
 *    capability off; the buyer is told the same thing in both cases
 *    (`checkout.payment.none`).
 *
 * ## Why delivery outranks payment
 *
 * Both are fatal, so the tie-break is not "which is worse" — it is which
 * sentence helps a buyer who is stuck. Two facts decide it and they agree.
 * Checkout renders the delivery section **above** the payment one, so naming the
 * payment gap while the delivery gap is also standing walks the buyer past the
 * first section they cannot complete in order to point at the second. And the
 * delivery choice is **upstream** of the payment one: it carries the shipping
 * cost that the order total is computed from, and that total is what an
 * amount-sensitive option such as the credit-limit method is judged against — so
 * "pick a delivery method" is a step that can change the payment answer, while
 * the reverse is not true. Repair delivery and the button re-evaluates and names
 * payment, if payment is still standing; the buyer is never told about a
 * downstream obstacle before an upstream one.
 *
 * Before any of this existed the button disabled on moderation alone, so a buyer
 * with an empty payment section could still submit: `paymentMethodId` went up as
 * an empty string and `placeOrderRequestSchema`'s `uuidSchema` answered
 * `400 VALIDATION_FAILED` — a schema error shown where a disabled control and a
 * sentence belong. `deliveryMethodId` had exactly the same hole.
 *
 * Pure and exported so the precedence can be unit-tested; the storefront test
 * harness is SSR-only, so the logic lives here rather than inside the component.
 */
export type PlaceOrderBlock = 'moderation' | 'no-delivery-method' | 'no-payment-method' | null;

export function placeOrderBlock(input: {
  canTransact: boolean;
  /**
   * How many delivery methods checkout will actually render — the catalogue as
   * the page received it, which is already filtered by the organization's
   * allow-list and by each adapter's storefront eligibility on the server.
   */
  deliveryMethodCount: number;
  /**
   * How many payment methods checkout will actually render. Counted *after* the
   * page's own eligibility filters (inactive rows, and a credit-limit method the
   * buyer has no granted limit for), because an option the buyer cannot pick is
   * not an option.
   */
  paymentMethodCount: number;
}): PlaceOrderBlock {
  if (!input.canTransact) return 'moderation';
  if (input.deliveryMethodCount <= 0) return 'no-delivery-method';
  if (input.paymentMethodCount <= 0) return 'no-payment-method';
  return null;
}

/**
 * The sentence the disabled Place Order button carries as its tooltip.
 *
 * Kept beside the precedence rather than inline in the page for the reason the
 * precedence itself is: a mapping written as a chain of ternaries in JSX is one
 * that can silently answer the payment sentence for the delivery gate, and
 * nothing would fail. Here it is exhaustive over `PlaceOrderBlock` — a fourth
 * gate added above without its sentence is a `tsc` error, not a wrong tooltip.
 *
 * `moderation` is the one case whose text is **not** a message key: the
 * Organization's own `moderationMessage` is what the operator wrote about this
 * buyer, and a translated generic sentence would replace it with less. The
 * fallback is used only when the platform sent none.
 */
export function blockTitle(
  block: PlaceOrderBlock,
  t: (key: MessageKey) => string,
  moderationMessage: string | null,
): string | undefined {
  switch (block) {
    case null:
      return undefined;
    case 'no-delivery-method':
      return t('checkout.delivery.none');
    case 'no-payment-method':
      return t('checkout.payment.none');
    case 'moderation':
      return moderationMessage ?? 'Ordering is currently unavailable.';
  }
}
