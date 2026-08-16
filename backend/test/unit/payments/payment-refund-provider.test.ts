import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PaymentRefundProvider } from '../../../src/modules/payments/services/payment-refund.js';
import { gatewayRefundRegistry } from '../../../src/modules/payments/services/registry-singleton.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * What a return settles into when the PSP module that would refund it is
 * switched off (feature 074, FR-024).
 *
 * This is the operator-visible half of the registry's `skip` policy, and the
 * reason the policy is defensible at all: skipping does not drop the
 * obligation, it records it. The refund lands on the `pending_manual` answer
 * the provider has always given a deployment with no PSP integration — and it
 * says *which module* is off, because "no integration" and "the integration is
 * switched off" are two different things for the person settling it.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

/** An order paid through a gateway, with `adapter` naming the PSP. */
const emFor = (adapter: string | null): (() => EntityManager) => {
  const em = {
    findOne: async (_entity: unknown, where: { id: string }) => ({
      id: where.id,
      paymentMethodSnapshot: { kind: 'gateway', adapter },
      paymentMethodId: null,
    }),
  };
  return () => em as unknown as EntityManager;
};

const input = {
  orderId: 'order-1',
  amount: 100,
  currency: 'PLN',
  idempotencyKey: 'return-case-1',
};

describe('PaymentRefundProvider — a gateway whose module is switched off', () => {
  it('records the refund for manual settlement and names the module', async () => {
    gatewayRefundRegistry.register(
      { adapterKey: 'stripe', refund: async () => ({ state: 'issued' }) },
      'stripe',
    );
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['stripe'] });
    expect(effectiveState.isPresent('stripe')).toBe(false);

    try {
      const result = await new PaymentRefundProvider(emFor('stripe')).refund(input);

      // Not `issued`: the switched-off module must not have charged its PSP.
      expect(result.state).toBe('pending_manual');
      expect(result.failureReason).toContain('stripe');
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
      gatewayRefundRegistry.unregister('stripe');
    }
  });

  it('keeps the older sentence when no module ever registered a handler', async () => {
    const result = await new PaymentRefundProvider(emFor('bank_transfer_psp')).refund(input);

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
      const result = await new PaymentRefundProvider(emFor('stripe')).refund(input);
      expect(result).toEqual({ state: 'issued', externalReference: 're_1' });
    } finally {
      gatewayRefundRegistry.unregister('stripe');
    }
  });
});
