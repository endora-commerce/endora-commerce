import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * What `GET /api/v1/payment-methods` answers when payment capability is absent
 * — measured, on the operator axis, through the registry cache's own module-off
 * seam rather than by stubbing a failure.
 *
 * There are **two** absences and they answer differently, which is the whole
 * reason the storefront needed a repair:
 *
 *  - **`payments` off.** `payments` contributes all four built-in adapters, and
 *    `PaymentAdapterRegistry.get` filters on the contributing module's effective
 *    state, so every method's adapter stops resolving and the eligibility filter
 *    drops it. The route is owned by `payment_methods`, which is still on, so it
 *    answers honestly: `200 {"data": []}`.
 *  - **`payment_methods` off.** The route's own registration seam is gated, so
 *    there is no list to be empty: `503 MODULE_DISABLED`.
 *
 * The second is the one that reached a buyer as Next's 500 page. This file is
 * the contract the storefront's degrade is written against, so it asserts the
 * **envelope**, not just the status: `storefront/lib/api/module-absence.ts`
 * discriminates on `error.code === 'MODULE_DISABLED'` and on nothing else, and
 * `storefront/test/checkout/payment-catalogue-absence.test.tsx` builds its
 * responses from exactly the shapes below.
 *
 * Constitution XVII item 6: full restoration is asserted for both, because a
 * degrade that does not come back is not a degrade.
 */
const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

describe('payment-method catalogue with payment capability absent', () => {
  let h: BackendServerHandle;

  const deactivate = (moduleId: string): void => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: [moduleId] });
  };

  const listMethods = async (): Promise<{
    statusCode: number;
    body: { data?: unknown[]; error?: { code?: string } };
  }> => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
    return {
      statusCode: response.statusCode,
      body: response.json() as { data?: unknown[]; error?: { code?: string } },
    };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('offers at least one method while everything is on', async () => {
    // The control. Without it both cases below pass for a shop that simply has
    // no payment method configured, which is the state they are supposed to be
    // distinguishable from.
    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(200);
    expect(body.data?.length ?? 0).toBeGreaterThan(0);
  });

  it('answers an empty catalogue with `payments` off, because no adapter resolves', async () => {
    deactivate('payments');

    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('answers the MODULE_DISABLED envelope with `payment_methods` off', async () => {
    deactivate('payment_methods');

    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(503);
    // Both halves are load-bearing on the storefront side: the status alone is
    // shared with a draining load balancer, and only the code says the platform
    // *decided* this. A degrade keyed on the status would swallow the other one.
    expect(body.error?.code).toBe('MODULE_DISABLED');
  });

  it('restores the catalogue when either module comes back', async () => {
    for (const moduleId of ['payments', 'payment_methods']) {
      deactivate(moduleId);
      registryCache.__setEnabledForTesting(ALL_IDS);

      const { statusCode, body } = await listMethods();
      expect(statusCode, moduleId).toBe(200);
      expect(body.data?.length ?? 0, moduleId).toBeGreaterThan(0);
    }
  });
});
