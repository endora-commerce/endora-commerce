import { describe, expect, it } from 'vitest';
import { storefrontPaymentReturnUrl } from '@endora-commerce/contracts';
import {
  PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL,
  paymentGatewayFixtureAdapters,
} from '../../../src/apps/example/modules/payment_gateway_fixture/backend.js';

/**
 * Issue #287 — where a gateway hands the buyer back once the order exists.
 *
 * The paid gateways that originally exposed the defect have left this
 * repository. The example deployment's fixture is the standing free-side
 * driver: it proves the shared return path still lands on the page that reads
 * payment state and decides the outcome, rather than claiming success in the
 * URL itself.
 */
describe('the fixture gateway’s landing (issue #287, FR-021)', () => {
  it('hands the buyer to the resolving landing, and never to the success page', async () => {
    const orderId = '11111111-2222-4333-8444-555555555555';
    const [redirect] = paymentGatewayFixtureAdapters();
    const started = await redirect!.onStorefrontOrderCreated({
      orderId,
      paymentId: '99999999-8888-4777-8666-555555555555',
      amount: 100,
      currency: 'PLN',
    });

    expect(started.kind).toBe('redirect');
    const url = (started as { kind: 'redirect'; url: string }).url;
    expect(url).toBe(
      storefrontPaymentReturnUrl(
        PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL,
        orderId,
        'returned',
      ),
    );
    expect(url).toContain('/checkout/return?');
    expect(url).not.toContain('/checkout/success');
  });
});
