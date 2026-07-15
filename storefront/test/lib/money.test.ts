import { describe, expect, it } from 'vitest';
import { moneyByMode, DEFAULT_VAT_RATE } from '../../lib/i18n/money';

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
