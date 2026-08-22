import { describe, expect, it } from 'vitest';
import { storefrontPaymentReturnUrl, type PaymentReturnOutcome } from '@endora-commerce/contracts';
import {
  parseReturnOutcome,
  postPaymentDestination,
} from '../../lib/payments/post-payment-landing';

/**
 * Issue #287, per gateway — a paid return lands on the success page and a
 * failed one on the failure page, including for PayU and Autopay, where both
 * come through **one** URL.
 *
 * This drives the buyer's whole journey from the URL the gateway was handed:
 * the URL is parsed exactly as `/checkout/return` parses it, and the order is
 * the one the page would read. That the four adapters really do build these
 * URLs is the other half, asserted against the adapters themselves in
 * `backend/test/unit/payments/gateway-return-urls.test.ts` — the hook column
 * below is that test's subject, restated so a reader can see the whole path.
 */

const BASE = 'https://shop.example';
const ORDER_ID = '11111111-2222-4333-8444-555555555555';

/** Every gateway hook, and the outcome its return URL carries. */
const HOOKS: Array<{ gateway: string; hook: string; outcome: PaymentReturnOutcome }> = [
  { gateway: 'PayU', hook: 'continueUrl', outcome: 'returned' },
  { gateway: 'Autopay', hook: 'ReturnURL', outcome: 'returned' },
  { gateway: 'Stripe', hook: 'success_url', outcome: 'returned' },
  { gateway: 'Stripe', hook: 'cancel_url', outcome: 'cancelled' },
  { gateway: 'TPay', hook: 'successUrl', outcome: 'returned' },
  { gateway: 'TPay', hook: 'errorUrl', outcome: 'failed' },
];

/** The single-return-URL gateways: one hook, every outcome. */
const SINGLE_URL_HOOKS = HOOKS.filter((h) => h.gateway === 'PayU' || h.gateway === 'Autopay');

function order(paymentStatus: string, kind = 'gateway') {
  return { id: ORDER_ID, paymentStatus, paymentMethod: { kind } };
}

/** What the buyer sees, driven from the URL the gateway redirects them to. */
function landingFor(
  gatewayUrl: string,
  placed: ReturnType<typeof order>,
): string | 'the pending wait' {
  const url = new URL(gatewayUrl);
  // Whatever else changes, a gateway may never land a buyer on the checkout
  // form itself: its primary action places an order, and this buyer has one.
  expect(url.pathname).not.toBe('/checkout');
  const id = url.searchParams.get('id');
  expect(id).toBe(placed.id);
  const outcome = parseReturnOutcome(url.searchParams.get('outcome') ?? undefined);
  return postPaymentDestination(placed, outcome) ?? 'the pending wait';
}

describe('where each gateway hook lands a buyer', () => {
  for (const { gateway, hook, outcome } of HOOKS) {
    const url = storefrontPaymentReturnUrl(BASE, ORDER_ID, outcome);

    it(`${gateway} ${hook}: a paid order lands on the success page`, () => {
      expect(landingFor(url, order('paid'))).toBe(`/checkout/success?id=${ORDER_ID}`);
    });

    it(`${gateway} ${hook}: a failed payment lands on the failure page`, () => {
      expect(landingFor(url, order('failed'))).toBe(
        `/checkout/failure?id=${ORDER_ID}&outcome=failed`,
      );
    });
  }
});

describe('the gateways with one URL for every outcome', () => {
  for (const { gateway, hook, outcome } of SINGLE_URL_HOOKS) {
    const url = storefrontPaymentReturnUrl(BASE, ORDER_ID, outcome);

    it(`${gateway} ${hook} carries no verdict, so the order supplies it`, () => {
      // The same URL, three orders, three destinations. This is the whole
      // reason the landing exists: the ruling cannot be configured into PayU
      // or Autopay, so the platform decides after the buyer arrives.
      expect(landingFor(url, order('paid'))).toBe(`/checkout/success?id=${ORDER_ID}`);
      expect(landingFor(url, order('failed'))).toBe(
        `/checkout/failure?id=${ORDER_ID}&outcome=failed`,
      );
      expect(landingFor(url, order('awaiting_payment'))).toBe('the pending wait');
    });
  }
});

describe('the webhook race', () => {
  it('waits instead of showing the failure page, for every hook that can race', () => {
    // A buyer can be back before the gateway's confirmation. `errorUrl` is the
    // one hook excluded: TPay only uses it for an attempt it has already
    // rejected, so there is no confirmation coming to wait for.
    for (const { gateway, hook, outcome } of HOOKS) {
      if (hook === 'errorUrl' || hook === 'cancel_url') continue;
      const url = storefrontPaymentReturnUrl(BASE, ORDER_ID, outcome);
      expect(landingFor(url, order('awaiting_payment')), `${gateway} ${hook}`).toBe(
        'the pending wait',
      );
    }
  });

  it('does not make an offline order wait for a confirmation nobody will send', () => {
    // Bank transfer, cash on pickup and a credit-limit draw settle out of
    // band. They reach the success page from placement, and would still reach
    // it if a redirect ever put them through the landing.
    for (const kind of ['bank_transfer', 'pickup', 'credit_limit']) {
      const url = storefrontPaymentReturnUrl(BASE, ORDER_ID, 'returned');
      expect(landingFor(url, order('awaiting_payment', kind))).toBe(
        `/checkout/success?id=${ORDER_ID}`,
      );
    }
  });
});
