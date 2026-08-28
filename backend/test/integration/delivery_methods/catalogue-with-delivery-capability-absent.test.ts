import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * What `GET /api/v1/delivery-methods` answers when a capability checkout needs
 * is absent — measured on the operator axis, through the registry cache's own
 * module-off seam rather than by stubbing a failure.
 *
 * `backend/test/integration/delivery_methods/off-state.test.ts` already asserts
 * that this module off makes every one of its routes answer the
 * `MODULE_DISABLED` envelope. What that file cannot say — and what the
 * storefront's copy now rests on — is that the delivery catalogue and the
 * payment catalogue answer **independently**, so the sentence a stuck buyer is
 * shown names the capability that is actually missing:
 *
 *  - **`delivery_methods` off.** The route's own registration seam is gated:
 *    `503 MODULE_DISABLED`. `storefront/lib/api/methods.ts` degrades exactly
 *    that envelope, and exactly that one, to an empty catalogue.
 *  - **`payments` off.** A different capability, a different section. The
 *    delivery catalogue is untouched and still answers `200` with rows, so
 *    `placeOrderBlock` falls through the delivery gate to the payment one and
 *    the buyer is told about payment. Were this a 503 too, the precedence in
 *    `storefront/lib/checkout/place-order-gate.ts` would send every
 *    payments-off buyer to the wrong section.
 *
 * Constitution XVII item 6: full restoration is asserted, because a degrade
 * that does not come back is not a degrade.
 */
const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

describe('delivery-method catalogue with a checkout capability absent', () => {
  let h: BackendServerHandle;

  const deactivate = (moduleId: string): void => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: [moduleId] });
  };

  const listMethods = async (): Promise<{
    statusCode: number;
    body: { data?: unknown[]; error?: { code?: string } };
  }> => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/delivery-methods' });
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
    // The control. Without it the cases below pass for a shop that simply has no
    // delivery method configured, which is the state they exist to be
    // distinguishable from.
    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(200);
    expect(body.data?.length ?? 0).toBeGreaterThan(0);
  });

  it('answers the MODULE_DISABLED envelope with `delivery_methods` off', async () => {
    deactivate('delivery_methods');

    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(503);
    // Both halves are load-bearing on the storefront side: the status alone is
    // shared with a draining load balancer, and only the code says the platform
    // *decided* this. A degrade keyed on the status would swallow the other one.
    expect(body.error?.code).toBe('MODULE_DISABLED');
  });

  it('leaves the delivery catalogue alone when `payments` is off', async () => {
    // The independence the checkout precedence rests on. `payments` withdraws
    // the four built-in payment adapters and empties the *payment* catalogue;
    // nothing it owns reaches this route, so the buyer keeps a delivery section
    // to complete and is told about the section that is genuinely empty.
    deactivate('payments');

    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(200);
    expect(body.data?.length ?? 0).toBeGreaterThan(0);
  });

  it('restores the catalogue when the module comes back', async () => {
    deactivate('delivery_methods');
    registryCache.__setEnabledForTesting(ALL_IDS);

    const { statusCode, body } = await listMethods();
    expect(statusCode).toBe(200);
    expect(body.data?.length ?? 0).toBeGreaterThan(0);
  });
});
