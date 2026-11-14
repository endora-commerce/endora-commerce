import { describe, expect, it } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { CART_ERRORS } from '../../lib/commerce-errors';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #641 (#86) — one-click buy refused by the setting or the buyer's
 * defaults is `422 ONE_CLICK_UNAVAILABLE`, its `details.code` the eligibility
 * reason, where it was `VALIDATION_FAILED` with `details.code:
 * 'one_click_unavailable'`. The product page's one-click action lands on
 * `/cart?error=<code>`, so the cart names the code and each reason.
 */
function refusal(reason: string): StorefrontApiError {
  return new StorefrontApiError(422, 'ONE_CLICK_UNAVAILABLE', 'One-click buy is not available.', undefined, {
    code: reason,
    reason,
  });
}

describe('ONE_CLICK_UNAVAILABLE on the cart page', () => {
  it('carries the reason the backend refused for', () => {
    expect(CART_ERRORS.failureCode(refusal('setting_disabled'), 'ONE_CLICK_FAILED')).toBe(
      'ONE_CLICK_UNAVAILABLE.setting_disabled',
    );
    expect(CART_ERRORS.failureCode(refusal('missing_defaults'), 'ONE_CLICK_FAILED')).toBe(
      'ONE_CLICK_UNAVAILABLE.missing_defaults',
    );
    expect(CART_ERRORS.failureCode(refusal('other'), 'ONE_CLICK_FAILED')).toBe('ONE_CLICK_UNAVAILABLE');
  });

  it.each([
    [
      'en-US',
      'ONE_CLICK_UNAVAILABLE.setting_disabled',
      'One-click buy is switched off in this store. Add the product to the cart and place the order from there.',
    ],
    [
      'pl-PL',
      'ONE_CLICK_UNAVAILABLE.setting_disabled',
      'Zakup jednym kliknięciem jest wyłączony w tym sklepie. Dodaj produkt do koszyka i złóż zamówienie z koszyka.',
    ],
    [
      'en-US',
      'ONE_CLICK_UNAVAILABLE.missing_defaults',
      'One-click buy needs your default addresses, delivery method and payment method. Set them in your account, or add the product to the cart and place the order from there.',
    ],
    [
      'pl-PL',
      'ONE_CLICK_UNAVAILABLE.missing_defaults',
      'Zakup jednym kliknięciem wymaga domyślnych adresów, metody dostawy i metody płatności. Ustaw je na swoim koncie albo dodaj produkt do koszyka i złóż zamówienie z koszyka.',
    ],
    ['en-US', 'ONE_CLICK_UNAVAILABLE', 'One-click buy is not available for this product right now.'],
    ['pl-PL', 'ONE_CLICK_UNAVAILABLE', 'Zakup jednym kliknięciem nie jest teraz dostępny dla tego produktu.'],
  ])('reads %s %s as its own sentence', (locale, code, sentence) => {
    const key = CART_ERRORS.errorKey(code);
    expect(key).toBe(`commerce.error.${code}`);
    expect(tForLocale(locale)(key as never)).toBe(sentence);
  });
});
