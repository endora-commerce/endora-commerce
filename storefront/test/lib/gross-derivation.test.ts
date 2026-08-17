import { describe, expect, it } from 'vitest';
import { DEFAULT_VAT_RATE, grossFromNet } from '../../lib/i18n/money';

/**
 * Issue #132 — one seam for every derived gross figure.
 *
 * `BaseSalePriceBlock` hard-coded `vatRate = 0.23`, `ProductRow` multiplied by
 * `1.23` and `ProductCard` did the same again. Three copies of one assumption
 * meant a deployment outside Poland had no single place to correct — and one of
 * the copies also collapsed a zero net into "no gross", because it tested the
 * derived amount for truthiness.
 *
 * The rate itself is still an assumption; the storefront has no resolved tax to
 * read (see the note on `DEFAULT_VAT_RATE`). What these tests pin is that the
 * assumption is named once, that a caller can override it, and that zero
 * survives.
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

  it('keeps the deployment assumption in exactly one place', () => {
    expect(DEFAULT_VAT_RATE).toBe(0.23);
  });
});
