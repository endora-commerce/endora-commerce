import { describe, expect, it } from 'vitest';
import {
  cartLineAmount,
  cartShortfall,
  cartSubtotal,
  cartTotalAfterDiscount,
  cartTotalsByCart,
  cartVatMoney,
} from './cart-money.js';

/**
 * Issue #417 — a cart's amounts in exact decimal arithmetic. A cart is net and
 * carries no tax; its amounts are published as numbers (`Money.amount`), each a
 * two-place decimal read losslessly. On doubles, 3 × 9.05 published
 * 27.150000000000002 and 0.10 + 0.20 0.30000000000000004.
 */
describe('cart money', () => {
  it('publishes a line amount at two places, not the binary 27.150000000000002', () => {
    expect(9.05 * 3).toBe(27.150000000000002);
    expect(cartLineAmount('9.05', 3)).toBe(27.15);
  });

  it('sums a subtotal exactly', () => {
    expect(cartSubtotal([
      { unitPrice: '0.10', quantity: 1 },
      { unitPrice: '0.20', quantity: 1 },
    ])).toBe('0.30');
    expect(cartSubtotal([])).toBe('0.00');
  });

  it('subtracts a discount and never goes below zero', () => {
    expect(cartTotalAfterDiscount('0.30', 0.1)).toBe(0.2);
    expect(cartTotalAfterDiscount('5.00', 7.5)).toBe(0);
  });

  it('answers what is missing to a minimum, exactly, or null when the minimum is met', () => {
    expect(cartShortfall('0.30', '0.30')).toBeNull();
    expect(cartShortfall('0.30', '0.31')).toBe(0.01);
    expect(cartShortfall('100.00', '99.99')).toBeNull();
  });
});

describe('cartTotalsByCart', () => {
  it('groups lines by cart and sums each cart once, exactly', () => {
    const totals = cartTotalsByCart([
      { cartId: 'a', unitPrice: '0.10', quantity: 1, currency: 'PLN' },
      { cartId: 'b', unitPrice: '9.05', quantity: 3, currency: 'EUR' },
      { cartId: 'a', unitPrice: '0.20', quantity: 1, currency: 'PLN' },
    ]);
    expect(totals.get('a')).toEqual({ count: 2, total: 0.3, currency: 'PLN' });
    expect(totals.get('b')).toEqual({ count: 1, total: 27.15, currency: 'EUR' });
    expect(cartTotalsByCart([]).size).toBe(0);
  });
});

/**
 * Issue #436 — the cart's VAT under the one VAT method (owner ruling of
 * 2026-10-24): per rate, on the sum of the line nets at that rate, rounded
 * half-up once; gross = net + VAT. A line's gross is its own rounding and is
 * informational. The storefront used to show net × a flat 23 %.
 */
describe('cart VAT per rate', () => {
  const MIXED = [
    { unitPrice: '29.50', quantity: 1, taxRate: 0.23 },
    { unitPrice: '16.50', quantity: 1, taxRate: '0.2300' },
    { unitPrice: '8.25', quantity: 2, taxRate: 0.08 },
    { unitPrice: '0.0125', quantity: 800, taxRate: 0.05 },
    { unitPrice: '12.00', quantity: 1, taxRate: 0 },
  ];

  it('computes VAT per rate on the sum of the nets, not per line and not at a flat rate', () => {
    const vat = cartVatMoney(MIXED, 0);
    expect(vat.rows).toEqual([
      { taxRate: 0, net: 12, vat: 0, gross: 12 },
      { taxRate: 0.05, net: 10, vat: 0.5, gross: 10.5 },
      { taxRate: 0.08, net: 16.5, vat: 1.32, gross: 17.82 },
      // 46.00 × 0.23 = 10.58; the two lines' own VAT, 6.785 and 3.795, would round to 10.59.
      { taxRate: 0.23, net: 46, vat: 10.58, gross: 56.58 },
    ]);
    expect(vat.vatTotal).toBe(12.4);
    expect(vat.subtotalGross).toBe(96.9);
    expect(vat.grandTotalGross).toBe(96.9);
    // The flat 23 % the storefront applied: 84.50 × 1.23 = 103.94.
    expect(vat.subtotalGross).not.toBe(103.94);
  });

  it("gives each line its own rounding of its gross, which may differ from the rate's by a cent", () => {
    const vat = cartVatMoney(MIXED, 0);
    expect(vat.lines.map((l) => l.gross)).toEqual([36.29, 20.3, 17.82, 10.5, 12]);
    expect(36.29 + 20.3).not.toBe(56.58);
  });

  it('subtracts the discount from the gross, untaxed, as the order does', () => {
    expect(cartVatMoney(MIXED, '5.00').grandTotalGross).toBe(91.9);
    expect(cartVatMoney(MIXED, 0.1).grandTotalGross).toBe(96.8);
  });

  it('answers no rows and zero totals for no lines', () => {
    expect(cartVatMoney([], 0)).toEqual({ rows: [], lines: [], vatTotal: 0, subtotalGross: 0, grandTotalGross: 0 });
  });
});
