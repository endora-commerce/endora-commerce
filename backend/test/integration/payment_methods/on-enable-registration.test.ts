import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentAdapter } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { paymentAdapterRegistryOf } from '../../helpers/package-singletons.js';
import { PaymentMethodReconciler } from '../../../../packages/modules/payment_methods/src/backend/services/payment-method-reconciler.js';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * On-enable adapter registration (feature 034, FR-001/FR-002 for external
 * modules). Simulates a third-party module's installHook: it registers its
 * adapter into the shared singleton and reconciles a payment_methods row. The
 * live admin route — wired with the same singleton by commerceModule — then
 * recognises the adapter (upsert succeeds) where an unregistered key is
 * rejected.
 */
const VENDOR_KEY = `vendor_onenable_${randomUUID().slice(0, 8)}`;

const vendorAdapter: PaymentAdapter = {
  adapterKey: VENDOR_KEY,
  type: 'gateway',
  validateUseOnStorefront: async () => true,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onStorefrontOrderCreated: async () => ({ kind: 'redirect', url: 'https://psp.example/pay' }),
  onReceivePayment: async () => ({ result: 'success' }),
};

describe('payment adapter on-enable registration (singleton)', () => {
  let h: BackendServerHandle;
  // The registry the platform composed, never the copy a source import
  // would build (D-160.6 over a module-scope value — see the helper).
  const paymentAdapterRegistry = () => paymentAdapterRegistryOf(h.container);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
    // What an external module's installHook does on enable. The owner id has
    // to be a module this deployment actually carries: since issue #96 the
    // registry skips an adapter whose owner is not effectively present, so a
    // made-up id would (correctly) make the adapter invisible.
    paymentAdapterRegistry().register(vendorAdapter, 'payments');
    await new PaymentMethodReconciler().ensureMethodForAdapter(h.em(), VENDOR_KEY, {
      code: VENDOR_KEY,
      type: 'gateway',
      name: { default: 'Vendor Gateway' },
    });
  });

  afterAll(async () => {
    paymentAdapterRegistry().unregister(VENDOR_KEY);
    await teardownBackendServer(h);
  });

  it('reconciles a configurable entry for the registered adapter', async () => {
    const row = await h.em().findOne(PaymentMethod, { code: VENDOR_KEY });
    expect(row?.adapter).toBe(VENDOR_KEY);
    expect(row?.kind).toBe('gateway');
  });

  it('the live admin route recognises the singleton-registered adapter', async () => {
    // Same singleton instance the route holds → upsert with the vendor adapter
    // succeeds, proving install-time registration reaches the live routes.
    const ok = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/${VENDOR_KEY}`,
      ...admin,
      payload: { name: { default: 'Vendor Gateway' }, kind: 'gateway', adapter: VENDOR_KEY },
    });
    expect(ok.statusCode).toBe(200);

    // Control: an adapter no module registered is still rejected.
    const rejected = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/never_${randomUUID().slice(0, 8)}`,
      ...admin,
      payload: { name: { default: 'X' }, kind: 'gateway', adapter: 'unregistered_vendor' },
    });
    expect(rejected.statusCode).toBe(400);
  });
});
