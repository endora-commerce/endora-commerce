import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { OrderReadPort, OrderRecord, PaymentMethodReadPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { PaymentRefundProvider } from '../../../src/modules/payments/services/payment-refund.js';
import { gatewayRefundRegistry } from '../../../src/modules/payments/services/registry-singleton.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * What a return settles into when the PSP module that would refund it is
 * switched off (feature 074 FR-024; outcome ruled by D-71).
 *
 * This is the operator-visible half of the registry's `skip` policy. Skipping
 * is right — a module that is off must not charge its PSP's API — but the
 * answer the skip produced was not: `pending_manual` reads as *settled* to
 * everything above it, so `ReturnSettlementService` resolved the case, wrote
 * the `Refund` row, issued the corrective invoice and mailed the customer over
 * money that had not moved, and the admin card said "Settled."
 *
 * So a switched-off gateway is a **refusal** — the same `ModuleDisabledError`
 * envelope any other call into an absent module produces, naming the module,
 * because switching it back on is the whole remedy. `pending_manual` stays for
 * the deployment that never had a PSP integration: that one has nothing to
 * switch on and settles by hand. The two are asserted separately below,
 * because a single "no handler" answer covering both is exactly the conflation
 * D-71 unpicked.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

/**
 * An order paid through a gateway, with `adapter` naming the PSP — over
 * `orders`' published read port since feature 075's Phase C, where this used to
 * be an `EntityManager` stub answering `findOne(Order, …)`.
 *
 * The refusing `paymentMethodRead` is the assertion's other half: every case
 * here names an adapter in the order snapshot, so the provider must resolve the
 * PSP from that and never fall through to `payment_methods`. A permissive stub
 * would let that fall-through reappear unnoticed.
 */
const orderReadFor = (adapter: string | null): OrderReadPort =>
  ({
    findById: async (id: string) =>
      ({
        id,
        paymentMethodSnapshot: { kind: 'gateway', adapter },
        paymentMethodId: null,
      }) as unknown as OrderRecord,
  }) as unknown as OrderReadPort;

const refusingPaymentMethodRead: PaymentMethodReadPort = new Proxy({} as PaymentMethodReadPort, {
  get: () => () => {
    throw new Error(
      'the order snapshot names the adapter, so this test must not reach paymentMethodReadPort',
    );
  },
});

const providerFor = (adapter: string | null): PaymentRefundProvider =>
  new PaymentRefundProvider(orderReadFor(adapter), refusingPaymentMethodRead);

const input = {
  orderId: 'order-1',
  amount: 100,
  currency: 'PLN',
  idempotencyKey: 'return-case-1',
};

describe('PaymentRefundProvider — a gateway whose module is switched off', () => {
  it('refuses the refund and names the module', async () => {
    gatewayRefundRegistry.register(
      { adapterKey: 'stripe', refund: async () => ({ state: 'issued' }) },
      'stripe',
    );
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['stripe'] });
    expect(effectiveState.isPresent('stripe')).toBe(false);

    try {
      const thrown = await providerFor('stripe')
        .refund(input)
        .then(
          (result) => result as unknown,
          (err: unknown) => err,
        );

      // Not `issued`: the switched-off module must not have charged its PSP.
      // Not an outcome either: a returned value is something the caller settles
      // *on*, and every caller reads anything but `failed` as success.
      expect(thrown).toBeInstanceOf(ModuleDisabledError);
      expect((thrown as ModuleDisabledError).moduleId).toBe('stripe');
      expect((thrown as ModuleDisabledError).statusCode).toBe(503);
      expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
      gatewayRefundRegistry.unregister('stripe');
    }
  });

  it('keeps the older sentence when no module ever registered a handler', async () => {
    const result = await providerFor('bank_transfer_psp').refund(input);

    expect(result.state).toBe('pending_manual');
    expect(result.failureReason).toBe('Gateway refunds require a PSP refund integration.');
  });

  it('issues the refund again once the module is switched back on', async () => {
    gatewayRefundRegistry.register(
      { adapterKey: 'stripe', refund: async () => ({ state: 'issued', externalReference: 're_1' }) },
      'stripe',
    );
    registryCache.__setEnabledForTesting(ALL_IDS);

    try {
      const result = await providerFor('stripe').refund(input);
      expect(result).toEqual({ state: 'issued', externalReference: 're_1' });
    } finally {
      gatewayRefundRegistry.unregister('stripe');
    }
  });
});
