import { describe, expect, it, vi } from 'vitest';
import {
  OrganizationCannotTransactError,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type OrderReadPort,
  type OrderRecord,
  type PaymentAdapter,
  type PaymentAdapterRegistryPort,
  type StartPaymentResult,
} from '@b2b/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { PaymentRetryService } from '../../../src/modules/payments/services/payment-retry-service.js';
import type { PaymentService } from '../../../src/modules/payments/services/payment-service.js';
import type { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * A buyer paying an order of theirs again (issue #264).
 *
 * The capability did not exist. `/checkout/pay?id=…` is linked only from the
 * checkout submit action, the gateway redirect URL is returned once in a
 * non-persisted `nextAction`, and `/checkout/failure` is the *placement*
 * failure page — its "Try again" goes back to `/checkout`, which for a buyer
 * whose card was declined would place a second order for goods the first one
 * still has allocated.
 *
 * The cases below are the four things such an endpoint has to get right before
 * it is worth having: it must be somebody's own order, the Organization must
 * still be allowed to transact, one click must be one provider session, and an
 * adapter that refuses must not leave an attempt row that a later click would
 * mistake for a live payment.
 */

const BUYER = '11111111-1111-4111-8111-111111111111';
const OTHER_BUYER = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '44444444-4444-4444-8444-444444444444';

function orderRecord(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: ORDER_ID,
    businessId: 'ORD-1042',
    organizationId: ORG_ID,
    placedByCustomerAccountId: BUYER,
    salesChannelId: '55555555-5555-4555-8555-555555555555',
    status: 'on_hold',
    paymentStatus: 'failed',
    billingAddress: { recipientName: 'A Buyer', country: 'PL' },
    paymentMethodId: '66666666-6666-4666-8666-666666666666',
    paymentMethodSnapshot: { code: 'payu_blik', name: 'BLIK', kind: 'gateway', adapter: 'payu' },
    total: '123.00',
    currency: 'PLN',
    ...over,
  } as unknown as OrderRecord;
}

function attempt(over: Partial<Payment> = {}): Payment {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    orderId: ORDER_ID,
    paymentMethodId: '66666666-6666-4666-8666-666666666666',
    status: 'awaiting_payment',
    amount: '123.00',
    currency: 'PLN',
    attemptNo: 2,
    ...over,
  } as unknown as Payment;
}

const buyerRead: CustomerAccountReadPort = {
  findById: async (id: string) =>
    ({ id, email: 'buyer@example.com', firstName: 'A', lastName: 'Buyer' }) as CustomerAccountRecord,
} as unknown as CustomerAccountReadPort;

function registryWith(adapter: PaymentAdapter | undefined): PaymentAdapterRegistryPort {
  return {
    register: () => undefined,
    get: () => adapter,
    ownerOf: () => (adapter ? 'payu' : null),
  };
}

function adapterReturning(
  result: StartPaymentResult | Error,
): PaymentAdapter & { calls: number } {
  const adapter = {
    adapterKey: 'payu',
    type: 'gateway' as const,
    calls: 0,
    validateUseOnStorefront: async () => true,
    validateUseOnAdmin: async () => true,
    validateUseInApi: async () => true,
    onStorefrontOrderCreated: async () => {
      adapter.calls += 1;
      if (result instanceof Error) throw result;
      return result;
    },
    onReceivePayment: async () => ({ result: 'success' as const }),
  };
  return adapter;
}

function build(over: {
  order?: OrderRecord | null;
  openRetry?: PaymentService['openRetry'];
  failAttempt?: PaymentService['failAttempt'];
  adapter?: PaymentAdapter | undefined;
  assertCanTransact?: (organizationId: string) => Promise<void>;
}) {
  const failAttempt = over.failAttempt ?? vi.fn(async () => undefined);
  const paymentService = {
    openRetry: over.openRetry ?? (async () => ({ payment: attempt(), opened: true })),
    failAttempt,
    listForOrder: async () => [],
  } as unknown as PaymentService;
  const service = new PaymentRetryService({
    orderRead: {
      findById: async () => ('order' in over ? over.order : orderRecord()) ?? null,
    } as unknown as OrderReadPort,
    customerAccountRead: buyerRead,
    paymentService,
    paymentAdapterRegistry: () =>
      registryWith('adapter' in over ? over.adapter : adapterReturning({ kind: 'none' })),
    assertOrganizationCanTransact: over.assertCanTransact ?? (async () => undefined),
  });
  return { service, failAttempt };
}

describe('customer payment retry (#264)', () => {
  it('refuses an order the caller did not place', async () => {
    const { service } = build({ order: orderRecord({ placedByCustomerAccountId: OTHER_BUYER }) });
    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('answers 404 for an order that does not exist, without disclosing more', async () => {
    const { service } = build({ order: null });
    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses an order that is already paid', async () => {
    const { service } = build({ order: orderRecord({ paymentStatus: 'paid' }) });
    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  /**
   * The money term is an allow-list of two, never a negation of `paid`
   * (research R13). A credit-limit order is `deferred`: unpaid, but drawn
   * against the buyer's limit inside the placement transaction, so the shop is
   * already acting on it and there is no buyer-initiated session to open. A
   * `refunded` order is settled the other way. A negation would admit both.
   */
  it('refuses a payment settled by arrangement or already reversed', async () => {
    for (const paymentStatus of ['deferred', 'refunded'] as const) {
      const { service } = build({ order: orderRecord({ paymentStatus }) });
      await expect(
        service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
  });

  /**
   * The other half of the allow-list. A bank-transfer or cash-on-pickup order
   * never advances its own money axis, so it sits at `awaiting_payment`
   * indefinitely and must stay retryable — the adapter check below is what
   * decides whether there is a session to open, not this predicate.
   */
  it('still accepts an order that has simply not been paid yet', async () => {
    const { service } = build({
      order: orderRecord({ status: 'new', paymentStatus: 'awaiting_payment' }),
      adapter: adapterReturning({ kind: 'redirect', url: 'https://psp.example/pay/2' }),
    });
    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).resolves.toMatchObject({ opened: true });
  });

  /**
   * The transact guard runs on this path exactly as it runs on placement: a
   * suspended Organization may not pay any more than it may buy. It is checked
   * *after* ownership, so a suspended organisation's status is not readable by
   * a stranger guessing order ids.
   */
  it('refuses a buyer whose Organization may not transact', async () => {
    const { service } = build({
      assertCanTransact: async () => {
        throw new OrganizationCannotTransactError(ORG_ID, 'blocked');
      },
    });
    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toBeInstanceOf(OrganizationCannotTransactError);
  });

  /**
   * The buyer this endpoint exists for, in the state feature 085 leaves them
   * in: the gateway declined, the ingress wrote `paymentStatus = 'failed'` and
   * moved the order to the method's failure status, seeded `on_hold`. That is
   * the fixture's order, and if the money-axis predicate is left at
   * `=== 'awaiting_payment'` this is a 409 for every declined buyer on every
   * gateway — the retry refusing precisely the population it was built for.
   *
   * The lifecycle status is still deliberately not consulted here; refusing a
   * terminal one is feature 085's Phase D, together with the transition seam
   * that makes a cancellation release stock.
   */
  it('opens the next attempt and starts its provider session', async () => {
    const adapter = adapterReturning({ kind: 'redirect', url: 'https://psp.example/pay/2' });
    const { service } = build({ adapter });

    const result = await service.retryForCustomer({
      orderId: ORDER_ID,
      customerAccountId: BUYER,
    });

    expect(result).toMatchObject({
      opened: true,
      attemptNo: 2,
      nextAction: { kind: 'redirect', url: 'https://psp.example/pay/2' },
    });
    expect(adapter.calls).toBe(1);
  });

  /**
   * One click, one provider object. A second ask while an attempt is open
   * resumes it and contacts nobody — PayU keys its order on `extOrderId`, which
   * is this platform's payment id, so a second create against a live attempt is
   * a duplicate at the POS.
   */
  it('resumes an open attempt without contacting the provider', async () => {
    const adapter = adapterReturning({ kind: 'redirect', url: 'https://psp.example/pay/1' });
    const { service } = build({
      adapter,
      openRetry: (async () => ({ payment: attempt({ attemptNo: 1 }), opened: false })) as
        PaymentService['openRetry'],
    });

    const result = await service.retryForCustomer({
      orderId: ORDER_ID,
      customerAccountId: BUYER,
    });

    expect(result).toMatchObject({ opened: false, attemptNo: 1, nextAction: { kind: 'none' } });
    expect(adapter.calls).toBe(0);
  });

  /**
   * The attempt row is written before the adapter can be asked, because the
   * adapter needs its id. An adapter that refuses must therefore not leave an
   * `awaiting_payment` row no provider knows about: the buyer's next click
   * would resume that phantom and be told to go and pay a session that was
   * never opened.
   */
  it('closes the attempt it opened when the provider refuses', async () => {
    const boom = new Error('PSP rejected the order');
    const { service, failAttempt } = build({ adapter: adapterReturning(boom) });

    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toBe(boom);
    expect(failAttempt).toHaveBeenCalledWith(
      '77777777-7777-4777-8777-777777777777',
      'PSP rejected the order',
    );
  });

  /**
   * The compensation must not swallow the presence answer. A gateway an
   * operator switched off throws `ModuleDisabledError` out of the adapter, and
   * that is a 503 the buyer has to see rather than a payment that half-started.
   */
  it('lets a switched-off gateway through as a module refusal', async () => {
    const disabled = new ModuleDisabledError('payu');
    const { service, failAttempt } = build({ adapter: adapterReturning(disabled) });

    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toBe(disabled);
    expect(failAttempt).not.toHaveBeenCalled();
  });

  /**
   * A method whose adapter is gone — the gateway module uninstalled, the
   * adapter key renamed — is refused, and the attempt this opened is closed
   * rather than left looking live.
   */
  it('refuses when the order`s adapter is no longer registered', async () => {
    const { service, failAttempt } = build({ adapter: undefined });

    await expect(
      service.retryForCustomer({ orderId: ORDER_ID, customerAccountId: BUYER }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(failAttempt).toHaveBeenCalled();
  });
});
