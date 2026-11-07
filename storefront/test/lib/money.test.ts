import { describe, expect, it } from 'vitest';
import { formatMoney, moneyByMode, moneyByModeWithGross, DEFAULT_VAT_RATE } from '../../lib/i18n/money';

/**
 * Unit contract for `moneyByMode` — the single place that turns a net `Money`
 * value into the amount(s) a settings-driven display mode should render. The
 * cart, product cards, and PDP all rely on this agreeing, so the net/gross
 * decision is pinned here.
 */

const NET = { amount: 100, currency: 'PLN' };

describe('moneyByMode', () => {
  it('net_only → net amount tagged net, no secondary', () => {
    const r = moneyByMode(NET, 'net_only', 'pl-PL');
    expect(r.primary).toMatch(/100,00\s*zł/);
    expect(r.primaryKind).toBe('net');
    expect(r.secondary).toBeNull();
    expect(r.secondaryKind).toBeNull();
  });

  it('gross_only → gross amount (net × 1+vat) tagged gross, no secondary', () => {
    const r = moneyByMode(NET, 'gross_only', 'pl-PL');
    expect(r.primary).toMatch(/123,00\s*zł/);
    expect(r.primaryKind).toBe('gross');
    expect(r.secondary).toBeNull();
  });

  it('both → net primary + gross secondary', () => {
    const r = moneyByMode(NET, 'both', 'pl-PL');
    expect(r.primary).toMatch(/100,00\s*zł/);
    expect(r.primaryKind).toBe('net');
    expect(r.secondary).toMatch(/123,00\s*zł/);
    expect(r.secondaryKind).toBe('gross');
  });

  it('none → net amount, untagged (no suffix emphasis)', () => {
    const r = moneyByMode(NET, 'none', 'pl-PL');
    expect(r.primary).toMatch(/100,00\s*zł/);
    expect(r.primaryKind).toBeNull();
    expect(r.secondary).toBeNull();
  });

  it('honours a custom vat rate', () => {
    const r = moneyByMode(NET, 'gross_only', 'pl-PL', 0.08);
    expect(r.primary).toMatch(/108,00\s*zł/);
  });

  it('exposes the Polish VAT default', () => {
    expect(DEFAULT_VAT_RATE).toBe(0.23);
  });
});

/**
 * `specs/pricing/worked-examples.md` §10.16 — the storefront shows a resolver
 * amount half-up on its decimal digits (`Intl.NumberFormat` rounds the
 * shortest decimal of the number half-expand), which is the figure the cart
 * stores and the order charges: 9.0450 is 9,05 and 1.0050 is 1,01.
 */
describe('formatMoney — an x.xx50 amount is shown half-up', () => {
  it.each([
    ['9.0450', /^9,05\s*zł$/],
    ['1.0050', /^1,01\s*zł$/],
    ['2.6750', /^2,68\s*zł$/],
  ])('%s', (amount, shown) => {
    expect(formatMoney(Number(amount), 'PLN', 'pl-PL')).toMatch(shown);
  });
});

/**
 * Owner ruling of 2026-10-25 (§10.18) — a unit price (a product's price, a cart
 * or order line's unit price) shows its significant places, up to four, and at
 * least two; a line value or a total always shows two.
 */
describe('formatMoney — the unit-price display rule', () => {
  it.each([
    [0.0125, /^0,0125\s*zł$/],
    [1.5, /^1,50\s*zł$/],
    [1.505, /^1,505\s*zł$/],
    [9.045, /^9,045\s*zł$/],
  ])('unit price %s', (amount, shown) => {
    expect(formatMoney(amount, 'PLN', 'pl-PL', { unitPrice: true })).toMatch(shown);
  });

  it('an amount keeps two places', () => {
    expect(formatMoney(0.0125, 'PLN', 'pl-PL')).toMatch(/^0,01\s*zł$/);
  });
});

describe('moneyByMode — a unit price and its gross', () => {
  it('a sub-cent net unit price shows four places, and its gross is carried to four (0.015375 → 0,0154)', () => {
    const r = moneyByMode({ amount: 0.0125, currency: 'PLN' }, 'both', 'pl-PL', DEFAULT_VAT_RATE, { unitPrice: true });
    expect(r.primary).toMatch(/^0,0125\s*zł$/);
    expect(r.secondary).toMatch(/^0,0154\s*zł$/);
  });

  it('a two-place net unit price keeps its gross at two places (§10.16 G1)', () => {
    const r = moneyByMode({ amount: 29.5, currency: 'PLN' }, 'gross_only', 'pl-PL', DEFAULT_VAT_RATE, { unitPrice: true });
    expect(r.primary).toMatch(/^36,29\s*zł$/);
  });
});

/**
 * Issue #436 — a gross the backend computed (the cart's VAT per rate) is shown
 * as given; with no gross to show, the net is shown and tagged net, never a
 * gross derived from an assumed rate.
 */
describe('moneyByModeWithGross', () => {
  const NET_8450 = { amount: 84.5, currency: 'PLN' };

  it('shows the given gross, not net × a rate', () => {
    const r = moneyByModeWithGross(NET_8450, 96.9, 'gross_only', 'pl-PL');
    expect(r.primary).toMatch(/96,90\s*zł/);
    expect(r.primaryKind).toBe('gross');
    const both = moneyByModeWithGross(NET_8450, 96.9, 'both', 'pl-PL');
    expect(both.primary).toMatch(/84,50\s*zł/);
    expect(both.secondary).toMatch(/96,90\s*zł/);
    expect(both.secondaryKind).toBe('gross');
  });

  it('falls back to the net, tagged net, when there is no gross', () => {
    for (const mode of ['gross_only', 'both', 'net_only'] as const) {
      const r = moneyByModeWithGross(NET_8450, null, mode, 'pl-PL');
      expect(r.primary).toMatch(/84,50\s*zł/);
      expect(r.primaryKind).toBe('net');
      expect(r.secondary).toBeNull();
    }
    expect(moneyByModeWithGross(NET_8450, null, 'none', 'pl-PL').primaryKind).toBeNull();
  });
});
