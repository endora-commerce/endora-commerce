import { describe, expect, it } from 'vitest';
import { grossFromNet, moneyByMode } from '../../lib/i18n/money';

/**
 * Issue #132 — one seam for every derived gross figure.
 *
 * `BaseSalePriceBlock` hard-coded `vatRate = 0.23`, `ProductRow` multiplied by
 * `1.23` and `ProductCard` did the same again. Three copies of one assumption
 * meant a deployment outside Poland had no single place to correct — and one of
 * the copies also collapsed a zero net into "no gross", because it tested the
 * derived amount for truthiness.
 *
 * Since issue #852 there is no assumption left to name: every product read
 * carries its resolved `vatRate`, and a gross is derived at that rate or not at
 * all. What these tests pin is the derivation itself, and that zero survives.
 */

describe('grossFromNet', () => {
  it('derives gross from net at the given rate', () => {
    expect(grossFromNet(100, 0.23)).toBeCloseTo(123, 10);
    expect(grossFromNet(100, 0.19)).toBeCloseTo(119, 10);
  });

  it('derives a gross of zero from a net of zero, rather than answering "no gross"', () => {
    expect(grossFromNet(0, 0.23)).toBe(0);
    expect(grossFromNet(0, 0.23)).not.toBeNull();
  });

  it('answers null when there is no rate to apply, so nothing can be quoted', () => {
    expect(grossFromNet(100, null)).toBeNull();
  });

  it('answers null for a net that is not a finite number', () => {
    expect(grossFromNet(Number.NaN, 0.23)).toBeNull();
  });


});

/**
 * Review 2, finding 2 (release 0.108.0) — the gross the storefront shows beside
 * a net price agrees with a gross feed's: the exact decimal product, rounded
 * half-up to two places (`grossAmountHalfUp`; `specs/pricing/worked-examples.md`
 * §10.16). `net * (1 + rate)` on doubles made 16.50 at 23 % the double
 * 20.29499…, which `Intl.NumberFormat` showed as 20,29.
 */
describe('grossFromNet — the exact decimal product, half-up', () => {
  it.each([
    [29.5, 0.23, 36.29],
    [4.3, 0.05, 4.52],
    [31.5, 0.23, 38.75],
    [16.5, 0.23, 20.3],
    [24.5, 0.23, 30.14],
    [10, 0.085, 10.85],
  ])('%s at %s is %s', (net, rate, gross) => {
    expect(grossFromNet(net, rate)).toBe(gross);
  });

  it('the gross shown is the gross a feed publishes', () => {
    expect(moneyByMode({ amount: 16.5, currency: 'PLN' }, 'gross_only', 'pl-PL', 0.23).primary).toBe(
      new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(20.3),
    );
  });
});
