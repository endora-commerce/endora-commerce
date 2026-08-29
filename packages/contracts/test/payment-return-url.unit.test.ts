import { describe, expect, it } from 'vitest';
import {
  storefrontPaymentReturnUrl,
  type PaymentReturnOutcome,
} from '../src/payment-return-url.js';

/**
 * Issue #287 — every payment gateway hands the buyer back to one landing, and
 * the platform decides from there.
 *
 * Issue #274 had pointed the four gateways at the order page, because a buyer
 * whose order already exists must not be returned to a *placement* surface.
 * The owner then ruled that a correct payment belongs on the success page and
 * a failed one on the failure page — and PayU and Autopay have a single return
 * URL for every outcome, so no gateway configuration can express that. The one
 * URL they now share is the landing that resolves it.
 */
describe('storefrontPaymentReturnUrl', () => {
  const orderId = '11111111-2222-4333-8444-555555555555';

  it('lands every gateway on the one resolving route', () => {
    const url = storefrontPaymentReturnUrl('https://shop.example', orderId, 'returned');
    expect(url).toBe(`https://shop.example/checkout/return?id=${orderId}&outcome=returned`);
  });

  it('never lands the buyer on the checkout form itself', () => {
    // `/checkout` places an order. A buyer who already has one must not be
    // shown a page whose primary action places a second.
    for (const outcome of ['returned', 'cancelled', 'failed'] as PaymentReturnOutcome[]) {
      const url = new URL(storefrontPaymentReturnUrl('https://shop.example', orderId, outcome));
      expect(url.pathname).toBe('/checkout/return');
    }
  });

  it('carries the outcome so the landing can say what the gateway reported', () => {
    const outcomes: PaymentReturnOutcome[] = ['returned', 'cancelled', 'failed'];
    for (const outcome of outcomes) {
      expect(storefrontPaymentReturnUrl('https://shop.example', orderId, outcome)).toBe(
        `https://shop.example/checkout/return?id=${orderId}&outcome=${outcome}`,
      );
    }
  });

  it('tolerates a base URL with a trailing slash', () => {
    expect(storefrontPaymentReturnUrl('https://shop.example/', orderId, 'failed')).toBe(
      `https://shop.example/checkout/return?id=${orderId}&outcome=failed`,
    );
  });

  it('tolerates a base URL with several trailing slashes', () => {
    expect(storefrontPaymentReturnUrl('https://shop.example///', orderId, 'failed')).toBe(
      `https://shop.example/checkout/return?id=${orderId}&outcome=failed`,
    );
  });

  it('encodes the order id so a hostile value cannot forge query parameters', () => {
    expect(storefrontPaymentReturnUrl('https://shop.example', 'a b?x=1&y=2', 'cancelled')).toBe(
      'https://shop.example/checkout/return?id=a%20b%3Fx%3D1%26y%3D2&outcome=cancelled',
    );
  });
});
