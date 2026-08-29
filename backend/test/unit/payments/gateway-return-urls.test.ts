import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  OrderReadPort,
  PaymentMethodReadPort,
  PaymentReadPort,
  PaymentReferencePort,
} from '@endora-commerce/contracts';
import { AutopayTransactionService } from '../../../../packages/modules/autopay/src/backend/services/autopay-transaction-service.js';
import type { AutopayClient } from '../../../../packages/modules/autopay/src/backend/services/autopay-client.js';
import { StripeIntentService } from '../../../../packages/modules/stripe/src/backend/services/stripe-intent-service.js';
import type { StripeClient } from '../../../../packages/modules/stripe/src/backend/services/stripe-client.js';
import { PayuPaymentAdapter } from '../../../../packages/modules/payu/src/backend/services/payu-payment-adapter.js';
import type { PayuClient } from '../../../../packages/modules/payu/src/backend/services/payu-client.js';
import type { PayuOrderService } from '../../../../packages/modules/payu/src/backend/services/payu-order-service.js';
import type { PayuEligibility } from '../../../../packages/modules/payu/src/backend/services/payu-eligibility.js';
import { TpayPaymentAdapter } from '../../../../packages/modules/tpay/src/backend/services/tpay-payment-adapter.js';
import type { TpayClient } from '../../../../packages/modules/tpay/src/backend/services/tpay-client.js';
import type { TpayTransactionService } from '../../../../packages/modules/tpay/src/backend/services/tpay-transaction-service.js';
import type { TpayEligibility } from '../../../../packages/modules/tpay/src/backend/services/tpay-eligibility.js';

/**
 * Issue #287 — where each gateway hands the buyer back once the order exists.
 *
 * The owner ruled that a correct payment lands on the success page and a
 * failed one on the failure page, for every gateway. PayU's `continueUrl` and
 * Autopay's `ReturnURL` are one URL for every outcome, so no gateway
 * configuration can express that: **every** hook — including the two that do
 * discriminate — points at `/checkout/return`, which reads the order's payment
 * state and forwards. One behaviour, not two.
 *
 * These drive the real call sites rather than the shared URL helper, because
 * the defect was never the helper — it was which page each gateway named, and
 * two of the six hooks (Stripe's `success_url`, TPay's `successUrl`) were
 * never covered here at all and went on naming the success page directly.
 */

/** The one landing, as every hook must build it. */
function landing(orderId: string, outcome: 'returned' | 'cancelled' | 'failed'): string {
  return `${BASE}/checkout/return?id=${orderId}&outcome=${outcome}`;
}

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

describe('Autopay ReturnURL (issue #287)', () => {
  it('hands every outcome to the resolving landing', async () => {
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
    // may never claim success — the landing reads the order and decides.
    expect(sentFields.ReturnURL).toBe(landing(ORDER_ID, 'returned'));
    expect(String(sentFields.ReturnURL)).not.toContain('/checkout/success');
  });
});

describe('Stripe return URLs (issue #287)', () => {
  it('sends both hooks to the resolving landing, so one rule decides both', async () => {
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

    // `cancel_url` fires when the buyer clicks *back*, not on a decline.
    expect(params.cancel_url).toBe(landing(ORDER_ID, 'cancelled'));
    // `success_url` is Stripe saying the session completed — a claim in a URL
    // the buyer can replay, and the page it used to name fires the purchase
    // conversion. The landing waits for the webhook instead.
    expect(params.success_url).toBe(landing(ORDER_ID, 'returned'));
    expect(String(params.success_url)).not.toContain('/checkout/success');
  });
});

describe('PayU continueUrl (issue #287)', () => {
  it('hands every outcome to the resolving landing', async () => {
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
    expect(sent.continueUrl).toBe(landing(ORDER_ID, 'returned'));
    expect(String(sent.continueUrl)).not.toContain('/checkout/success');
  });
});

describe('TPay return URLs (issue #287)', () => {
  it('sends both hooks to the resolving landing, so one rule decides both', async () => {
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

    // TPay does discriminate, and the landing still decides: a buyer who
    // replays `errorUrl` after paying is forwarded to the success page.
    expect(sent.errorUrl).toBe(landing(ORDER_ID, 'failed'));
    // The success hook used to name the success page directly, so a TPay
    // buyer whose notification had not landed was thanked for a payment
    // nobody had confirmed.
    expect(sent.successUrl).toBe(landing(ORDER_ID, 'returned'));
    expect(String(sent.successUrl)).not.toContain('/checkout/success');
  });
});
