import { describe, expect, it } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { CHECKOUT_ERRORS } from '../../lib/commerce-errors';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #628 (#86) — a promotion whose usage limit is reached between the cart
 * and placement is `409 PROMOTION_USAGE_LIMIT_REACHED`, where it was
 * `VALIDATION_FAILED` reading `promotion_unavailable: …`, which the checkout
 * failure page could only word as its generic failure. The page now names the
 * code. With a coupon the backend's token is `with_coupon`; a URL carries no
 * coupon code, so the page has one sentence for both.
 */
function refusal(details?: Record<string, unknown>): StorefrontApiError {
  return new StorefrontApiError(
    409,
    'PROMOTION_USAGE_LIMIT_REACHED',
    'A promotion in your cart has reached its usage limit, so the order was not placed.',
    undefined,
    details,
  );
}

describe('PROMOTION_USAGE_LIMIT_REACHED on the checkout failure page', () => {
  it('travels as the code, with or without a coupon', () => {
    expect(CHECKOUT_ERRORS.failureCode(refusal({ promotionId: 'x' }), 'PLACE_FAILED')).toBe(
      'PROMOTION_USAGE_LIMIT_REACHED',
    );
    expect(
      CHECKOUT_ERRORS.failureCode(refusal({ code: 'with_coupon', couponCode: 'SUMMER' }), 'PLACE_FAILED'),
    ).toBe('PROMOTION_USAGE_LIMIT_REACHED');
  });

  it.each([
    [
      'en-US',
      'A promotion in your cart has reached its usage limit, so the order was not placed. Go back to your cart to see the current price.',
    ],
    [
      'pl-PL',
      'Promocja w Twoim koszyku osiągnęła limit użyć, więc zamówienie nie zostało złożone. Wróć do koszyka, aby zobaczyć aktualną cenę.',
    ],
  ])('reads %s as its own sentence', (locale, sentence) => {
    const key = CHECKOUT_ERRORS.errorKey('PROMOTION_USAGE_LIMIT_REACHED');
    expect(key).toBe('commerce.error.PROMOTION_USAGE_LIMIT_REACHED');
    expect(tForLocale(locale)(key as never)).toBe(sentence);
  });
});
