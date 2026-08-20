import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  OrderReadPort,
  PaymentMethodReadPort,
  PaymentReadPort,
  PaymentReferencePort,
} from '@b2b/contracts';
import { AutopayTransactionService } from '../../../src/modules/autopay/services/autopay-transaction-service.js';
import type { AutopayClient } from '../../../src/modules/autopay/services/autopay-client.js';
import { StripeIntentService } from '../../../src/modules/stripe/services/stripe-intent-service.js';
import type { StripeClient } from '../../../src/modules/stripe/services/stripe-client.js';
import { PayuPaymentAdapter } from '../../../src/modules/payu/services/payu-payment-adapter.js';
import type { PayuClient } from '../../../src/modules/payu/services/payu-client.js';
import type { PayuOrderService } from '../../../src/modules/payu/services/payu-order-service.js';
import type { PayuEligibility } from '../../../src/modules/payu/services/payu-eligibility.js';
import { TpayPaymentAdapter } from '../../../src/modules/tpay/services/tpay-payment-adapter.js';
import type { TpayClient } from '../../../src/modules/tpay/services/tpay-client.js';
import type { TpayTransactionService } from '../../../src/modules/tpay/services/tpay-transaction-service.js';
import type { TpayEligibility } from '../../../src/modules/tpay/services/tpay-eligibility.js';

/**
 * Issue #274 — where each gateway returns the buyer once the order exists.
 *
 * All four used to point at a `/checkout/*` route: a **placement** surface,
 * reached by a buyer whose order is already placed, whose primary call to
 * action is "place an order". Two of them (PayU, Autopay) pointed at the
 * *success* page whatever the outcome, so a declined buyer was told the
 * payment worked. Each landing is now the order's own page.
 *
 * These drive the real call sites rather than the shared URL helper, because
 * the defect was never the helper — it was which page each gateway named.
 */

const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const PAYMENT_ID = '99999999-8888-4777-8666-555555555555';
const CHANNEL_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BASE = 'https://shop.example';

const paymentReference: PaymentReferencePort = {
  stampExternalReference: async () => true,
  stampExternalReferenceIfAbsent: async () => true,
  mergeProviderDetails: async () => true,
};

/**
 * The four read ports the gateway adapters resolve. None of them contributes to
 * the return URL, so a single "nothing found" stand-in stands for all four:
 * the adapters then fall back to the placement-time fields they were handed.
 */
const NULL_READ_PORT = { findById: async () => null };

/** Minimal EM stand-in: these services only create + flush a mapping row. */
function fakeEmFactory(): () => EntityManager {
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    persist: () => undefined,
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
    findOne: async () => null,
    nativeUpdate: async () => 0,
  };
  return () => em as unknown as EntityManager;
}

describe('Autopay ReturnURL (issue #274)', () => {
  it('returns the buyer to the order page, not to the checkout success page', async () => {
    let sentFields: Record<string, unknown> = {};
    const client = {
      preTransaction: async (input: { fields: Record<string, unknown> }) => {
        sentFields = input.fields;
        return { remoteId: 'remote-1', redirectUrl: 'https://autopay.example/pay', status: 'PENDING' };
      },
    } as unknown as AutopayClient;

    const service = new AutopayTransactionService(
      fakeEmFactory(),
      client,
      BASE,
      paymentReference,
    );
    await service.createRedirectTransaction({
      salesChannelId: CHANNEL_ID,
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      methodCode: 'autopay_pbl',
      amount: 100,
      currency: 'PLN',
      description: 'Order ORD-1',
      payerEmail: 'buyer@example.com',
    });

    // Autopay has a single ReturnURL and uses it whatever the outcome, so it
    // may never claim success.
    expect(sentFields.ReturnURL).toBe(`${BASE}/orders/${ORDER_ID}?payment=returned`);
    expect(String(sentFields.ReturnURL)).not.toContain('/checkout');
  });
});

describe('Stripe cancel_url (issue #274)', () => {
  it('returns a buyer who backed out to the order page, not to the failure page', async () => {
    let params: Record<string, unknown> = {};
    const stripe = {
      checkout: {
        sessions: {
          create: async (input: Record<string, unknown>) => {
            params = input;
            return { url: 'https://stripe.example/session', payment_intent: 'pi_1', id: 'cs_1' };
          },
        },
      },
    };
    const client = { getClient: async () => stripe } as unknown as StripeClient;

    const service = new StripeIntentService(fakeEmFactory(), client, paymentReference);
    await service.startCheckoutSession({
      salesChannelId: CHANNEL_ID,
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      methodCode: 'stripe_card',
      amount: 100,
      currency: 'PLN',
      storefrontBaseUrl: BASE,
    });

    // `cancel_url` fires when the buyer clicks *back*, not on a decline —
    // nothing failed, so the old `/checkout/failure` was wrong twice over.
    expect(params.cancel_url).toBe(`${BASE}/orders/${ORDER_ID}?payment=cancelled`);
    expect(String(params.cancel_url)).not.toContain('/checkout');
  });
});

describe('PayU continueUrl (issue #274)', () => {
  it('returns the buyer to the order page, not to the checkout success page', async () => {
    let sent: Record<string, unknown> = {};
    const orders = {
      createRedirectOrder: async (input: Record<string, unknown>) => {
        sent = input;
        return { payuOrderId: 'payu-1', redirectUrl: 'https://payu.example/pay' };
      },
    } as unknown as PayuOrderService;
    const client = {
      resolveConfig: async () => ({ active: true, displayMode: 'redirect' }),
    } as unknown as PayuClient;
    const eligibility = {
      assertOrderEligible: async () => undefined,
    } as unknown as PayuEligibility;

    const adapter = new PayuPaymentAdapter(
      client,
      orders,
      eligibility,
      async () => CHANNEL_ID,
      BASE,
      'https://api.example',
      NULL_READ_PORT as unknown as PaymentReadPort,
      NULL_READ_PORT as unknown as PaymentMethodReadPort,
      NULL_READ_PORT as unknown as OrderReadPort,
      NULL_READ_PORT as unknown as CustomerAccountReadPort,
    );

    await adapter.onStorefrontOrderCreated({
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      amount: 100,
      currency: 'PLN',
      paymentMethodCode: 'payu_pbl',
      salesChannelId: CHANNEL_ID,
      payerEmail: 'buyer@example.com',
      payerName: 'Buyer',
    });

    // PayU sends the buyer to continueUrl whatever the outcome — a declined
    // buyer used to land on a page that told them the order was paid.
    expect(sent.continueUrl).toBe(`${BASE}/orders/${ORDER_ID}?payment=returned`);
    expect(String(sent.continueUrl)).not.toContain('/checkout');
  });
});

describe('TPay errorUrl (issue #274)', () => {
  it('sends a failed payment to the order page, not to the checkout form', async () => {
    let sent: Record<string, unknown> = {};
    const transactions = {
      createTransaction: async (input: Record<string, unknown>) => {
        sent = input;
        return { transactionId: 'tpay-1', paymentUrl: 'https://tpay.example/pay' };
      },
    } as unknown as TpayTransactionService;
    const client = {
      resolveConfig: async () => ({ active: true, displayMode: 'redirect' }),
    } as unknown as TpayClient;
    const eligibility = {
      assertOrderEligible: async () => undefined,
    } as unknown as TpayEligibility;

    const adapter = new TpayPaymentAdapter(
      client,
      transactions,
      eligibility,
      async () => CHANNEL_ID,
      BASE,
      'https://api.example',
      NULL_READ_PORT as unknown as PaymentReadPort,
      NULL_READ_PORT as unknown as PaymentMethodReadPort,
      NULL_READ_PORT as unknown as OrderReadPort,
      NULL_READ_PORT as unknown as CustomerAccountReadPort,
    );

    await adapter.onStorefrontOrderCreated({
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      amount: 100,
      currency: 'PLN',
      paymentMethodCode: 'tpay_blik',
      salesChannelId: CHANNEL_ID,
      payerEmail: 'buyer@example.com',
      payerName: 'Buyer',
    });

    // `/checkout/pay` read `id`, and TPay passed `orderId` — the page then did
    // `if (!id) redirect('/checkout')` and dropped the buyer on the order form.
    expect(sent.errorUrl).toBe(`${BASE}/orders/${ORDER_ID}?payment=failed`);
    expect(String(sent.errorUrl)).not.toContain('/checkout');
  });
});
