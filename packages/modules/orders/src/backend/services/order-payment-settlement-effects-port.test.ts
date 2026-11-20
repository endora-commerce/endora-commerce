import { describe, expect, it } from 'vitest';
import { OrderPaymentSettlementEffectsService } from './order-payment-settlement-effects-port.js';
import type { OrderTransitionEffectService } from './order-transition-effect-service.js';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';

/**
 * Colocated unit test for `OrderPaymentSettlementEffectsService`.
 *
 * Covers: drainForOrder delegates with the exact orderId; a rejection
 * propagates unchanged. Recording is tested with the merged apply service.
 */

function makeTransitionEffects(overrides: Partial<{
  drainForOrder: (orderId: string) => Promise<void>;
}> = {}) {
  return {
    drainForOrder: overrides.drainForOrder ?? (async () => undefined),
  } as unknown as OrderTransitionEffectService;
}

describe('OrderPaymentSettlementEffectsService', () => {
  it('drainForOrder delegates with the exact orderId', async () => {
    const drained: string[] = [];
    const transitionEffects = makeTransitionEffects({
      drainForOrder: async (orderId) => {
        drained.push(orderId);
      },
    });
    const port = new OrderPaymentSettlementEffectsService(transitionEffects);

    await expect(port.drainForOrder('ord-42')).resolves.toBeUndefined();
    expect(drained).toEqual(['ord-42']);
  });

  it('drainForOrder propagates a rejection unchanged', async () => {
    const error = new ModuleDisabledError('credit_limits');
    const transitionEffects = makeTransitionEffects({
      drainForOrder: async () => {
        throw error;
      },
    });
    const port = new OrderPaymentSettlementEffectsService(transitionEffects);

    await expect(port.drainForOrder('ord-1')).rejects.toBe(error);
  });
});
