import { describe, expect, it } from 'vitest';
import {
  storefrontOrderReturnUrl,
  type PaymentReturnOutcome,
} from '../src/payment-return-url.js';

/**
 * Issue #274 — every payment gateway returns the buyer to the order's own page.
 * The four gateways used to build four different `/checkout/*` URLs by hand;
 * this is the one rule they now share, so the shape cannot drift back apart.
 */
describe('storefrontOrderReturnUrl', () => {
  const orderId = '11111111-2222-4333-8444-555555555555';

  it('lands the buyer on the order page, never on a checkout surface', () => {
    const url = storefrontOrderReturnUrl('https://shop.example', orderId, 'returned');
    expect(url).toBe(`https://shop.example/orders/${orderId}?payment=returned`);
    expect(url).not.toContain('/checkout');
  });

  it('carries the outcome so the page can say what happened', () => {
    const outcomes: PaymentReturnOutcome[] = ['returned', 'cancelled', 'failed'];
    for (const outcome of outcomes) {
      expect(storefrontOrderReturnUrl('https://shop.example', orderId, outcome)).toBe(
        `https://shop.example/orders/${orderId}?payment=${outcome}`,
      );
    }
  });

  it('tolerates a base URL with a trailing slash', () => {
    expect(storefrontOrderReturnUrl('https://shop.example/', orderId, 'failed')).toBe(
      `https://shop.example/orders/${orderId}?payment=failed`,
    );
  });

  it('tolerates a base URL with several trailing slashes', () => {
    expect(storefrontOrderReturnUrl('https://shop.example///', orderId, 'failed')).toBe(
      `https://shop.example/orders/${orderId}?payment=failed`,
    );
  });

  it('encodes the order id so a hostile value cannot forge query parameters', () => {
    expect(storefrontOrderReturnUrl('https://shop.example', 'a b?x=1&y=2', 'cancelled')).toBe(
      'https://shop.example/orders/a%20b%3Fx%3D1%26y%3D2?payment=cancelled',
    );
  });
});
