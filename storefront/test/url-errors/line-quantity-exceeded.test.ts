import { describe, expect, it } from 'vitest';
import { CART_ERRORS, QUICK_ORDER_ERRORS } from '../../lib/commerce-errors';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #351, architect ruling R1 — the cart's refusal of a line that would
 * end past the bound (`422 LINE_QUANTITY_EXCEEDED`) reaches `/cart?error=` as
 * its code, and the page reads it as a sentence of its own in both languages.
 */
describe('LINE_QUANTITY_EXCEEDED on the commerce pages', () => {
  it('is a code the cart and quick order name', () => {
    expect(CART_ERRORS.errorKey('LINE_QUANTITY_EXCEEDED')).toBe('commerce.error.LINE_QUANTITY_EXCEEDED');
    expect(QUICK_ORDER_ERRORS.isCode('LINE_QUANTITY_EXCEEDED')).toBe(true);
  });

  it.each([
    ['en-US', 'A line can hold at most 1,000,000 pieces. Lower the quantity and try again.'],
    ['pl-PL', 'Pozycja może mieć najwyżej 1 000 000 sztuk. Zmniejsz ilość i spróbuj ponownie.'],
  ])('reads in %s', (locale, sentence) => {
    expect(tForLocale(locale)('commerce.error.LINE_QUANTITY_EXCEEDED' as never)).toBe(sentence);
  });
});
