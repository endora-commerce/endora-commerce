import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentAdapter } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { PaymentMethodReconciler } from '../../../src/modules/payment_methods/services/payment-method-reconciler.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * T053 (US7) — recognition + auto-creation (FR-001/FR-002). Simulates an
 * external module's install-hook contribution: registering a PaymentAdapter
 * makes it recognised and able to back a configurable payment_methods entry; a
 * key that no module registered is not recognised.
 */
const myAdapter = (key: string): PaymentAdapter => ({
  adapterKey: key,
  type: 'gateway',
  validateUseOnStorefront: async () => true,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onStorefrontOrderCreated: async () => ({ kind: 'redirect', url: 'https://psp.example/pay' }),
  onReceivePayment: async () => ({ result: 'success' }),
});

describe('payment-method module contribution', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a registered adapter is recognised and backs a configurable entry', async () => {
    const registry = new PaymentAdapterRegistry();
    const reconciler = new PaymentMethodReconciler(h.em);
    const key = `vendor_${randomUUID().slice(0, 8)}`;
    const code = `vendor_code_${randomUUID().slice(0, 8)}`;

    // The module's install hook would do exactly this:
    registry.register(myAdapter(key));
    await reconciler.ensureMethodForAdapter(key, {
      code,
      type: 'gateway',
      name: { default: 'Vendor Gateway' },
    });

    // Recognised by the registry.
    expect(registry.isRegistered(key)).toBe(true);
    expect(registry.list()).toContain(key);

    // A configurable entry now exists, bound to the adapter.
    const row = await h.em().findOne(PaymentMethod, { code });
    expect(row).not.toBeNull();
    expect(row!.adapter).toBe(key);
    expect(row!.kind).toBe('gateway');
    expect(row!.statusOnPending).toBe('new');
  });

  it('a key no module registered is not recognised', () => {
    const registry = new PaymentAdapterRegistry();
    expect(registry.isRegistered('not_a_module')).toBe(false);
    expect(registry.get('not_a_module')).toBeUndefined();
    expect(() => registry.resolve('not_a_module')).toThrow();
  });
});
