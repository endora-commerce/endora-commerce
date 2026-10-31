import { describe, expect, it } from 'vitest';
import { miniCartCountLabel, productCountLabel } from '../../lib/i18n/chrome-counts';

/**
 * Issue #85 — the chrome's counted phrases take the reader's plural form.
 * Polish has three: 1, then 2–4 (but not 12–14), then everything else; the
 * pages used to write "produktów" after every number.
 */
describe('productCountLabel', () => {
  it.each([
    [1, '1 produkt'],
    [2, '2 produkty'],
    [4, '4 produkty'],
    [5, '5 produktów'],
    [12, '12 produktów'],
    [14, '14 produktów'],
    [22, '22 produkty'],
    [25, '25 produktów'],
    [104, '104 produkty'],
    [112, '112 produktów'],
  ])('says %i in Polish as "%s"', (count, expected) => {
    expect(productCountLabel(count, 'pl-PL')).toBe(expected);
  });

  it('says one and many in English, digits grouped for the locale', () => {
    expect(productCountLabel(1, 'en-US')).toBe('1 product');
    expect(productCountLabel(4218, 'en-US')).toBe('4,218 products');
  });
});

describe('miniCartCountLabel', () => {
  it('says the cart count in both languages', () => {
    expect(miniCartCountLabel(1, 'en-US')).toBe('1 item in cart');
    expect(miniCartCountLabel(2, 'en-US')).toBe('2 items in cart');
    expect(miniCartCountLabel(3, 'pl-PL')).toBe('3 pozycje w koszyku');
    expect(miniCartCountLabel(13, 'pl-PL')).toBe('13 pozycji w koszyku');
  });
});
