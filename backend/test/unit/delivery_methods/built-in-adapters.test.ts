import { describe, expect, it } from 'vitest';
import { builtInShippingAdapters } from '../../../src/modules/delivery_methods/adapters/built-in-adapters.js';

/**
 * T014 (US1) — contract conformance for the bundled offline adapters.
 */
const ctxBase = {
  orderId: 'o1',
  shipmentId: 's1',
  deliveryMethodId: 'd1',
  attemptNo: 1,
};

describe('built-in shipping adapters', () => {
  const adapters = builtInShippingAdapters();

  it('ships manual_courier and personal_pickup', () => {
    expect(adapters.map((a) => a.adapterKey).sort()).toEqual(['manual_courier', 'personal_pickup']);
  });

  it('all validators return true and onOrderCreated is a no-op', async () => {
    for (const a of adapters) {
      const elig = {
        deliveryMethod: {} as never,
        salesChannelId: '',
        organizationId: null,
        customerAccountId: null,
        surface: 'storefront' as const,
      };
      expect(await a.validateUseOnStorefront(elig)).toBe(true);
      expect(await a.validateUseOnAdmin(elig)).toBe(true);
      expect(await a.validateUseInApi(elig)).toBe(true);
      await expect(
        a.onOrderCreated({ orderId: 'o1', deliveryMethodId: 'd1', salesChannelId: 'c1', organizationId: null }),
      ).resolves.toBeUndefined();
    }
  });

  it('manual_courier opens pending; personal_pickup reports generated', async () => {
    const manual = adapters.find((a) => a.adapterKey === 'manual_courier')!;
    const pickup = adapters.find((a) => a.adapterKey === 'personal_pickup')!;
    expect(await manual.onShipmentCreated(ctxBase)).toEqual({ kind: 'pending' });
    expect(await pickup.onShipmentCreated(ctxBase)).toEqual({ kind: 'generated' });
  });

  it('onReceiveShipment echoes the ingress outcome', async () => {
    const manual = adapters.find((a) => a.adapterKey === 'manual_courier')!;
    const outcome = await manual.onReceiveShipment({
      orderId: 'o1',
      shipmentId: 's1',
      externalReference: 'TRK1',
      providerDetails: { trackingNumber: 'TRK1' },
    });
    expect(outcome).toMatchObject({ result: 'success', externalReference: 'TRK1' });
  });
});
