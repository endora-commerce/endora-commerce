import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * Feature 073, Amendment A1 — the off-state obligation that comes with dropping
 * `nonDeactivatable` from this module (Constitution XVII, checklist item 6).
 *
 * The delivery twin's file says why such a test could not exist before the
 * amendment. This one carries one extra assertion, because the module sits
 * under the checkout: `GET /api/v1/payment-methods` is the list a cart renders
 * its payment options from, so an off `payment_methods` must leave the checkout
 * with *no* payment list at all rather than a partial one.
 *
 * **What this file does not cover, deliberately.** The product ruling of
 * 2026-08-15 — a payment method whose *gateway* module is absent or switched
 * off disappears from cart and checkout — is a different question from this
 * module's own presence, and it has its own file:
 * `gateway-presence.test.ts`. It was open as issue #96 when this test was
 * written (measured then: with `payments` and a contributed adapter deactivated,
 * `GET /api/v1/payment-methods` answered 200 and still listed the
 * `bank_transfer`-backed methods) and is closed now — `paymentAdapterRegistry`
 * records the contributing module on every entry and skips an entry whose owner
 * is not effectively present.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('payment_methods — off state [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('is absent on every surface while off, and fully restored when on', async () => {
    await expectModuleAbsent(h, 'payment_methods', {
      routes: [
        // Storefront: the payment options a checkout picks from.
        '/api/v1/payment-methods',
        // Admin: the catalog screen, the adapter picker, the status options
        // and the writes. `/admin/order-statuses` is owned by this module even
        // though its name does not say so — an off-state list built from the
        // module's name alone would miss it.
        { url: '/api/v1/admin/payment-methods', cookies: ADMIN },
        { url: '/api/v1/admin/payment-methods/adapters', cookies: ADMIN },
        { url: '/api/v1/admin/order-statuses', cookies: ADMIN },
        {
          method: 'PUT',
          url: '/api/v1/admin/payment-methods/off-state-probe',
          cookies: ADMIN,
          payload: {
            code: 'off-state-probe',
            name: 'Probe',
            kind: 'gateway',
            statusOnPending: 'pending_payment',
            statusOnSuccess: 'paid',
            statusOnFailure: 'payment_failed',
          },
        },
        {
          method: 'DELETE',
          url: '/api/v1/admin/payment-methods/00000000-0000-0000-0000-000000000000',
          cookies: ADMIN,
        },
      ],
      adminPresence: { cookies: ADMIN },
      // No `settingWrite`: the only Setting this module owns is its own
      // activation control — the documented exception.
    });
  });

  it('reports the two axes separately, and stays deactivatable on both', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payment_methods'] });
    expect(await presenceOf(h, 'payment_methods')).toMatchObject({
      present: false,
      platformState: 'installed',
      activated: false,
      deactivatable: true,
    });

    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'payment_methods'));
    const unavailable = await presenceOf(h, 'payment_methods');
    expect(unavailable).toMatchObject({ present: false, activated: true });
    expect(unavailable?.platformState).not.toBe('installed');

    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await presenceOf(h, 'payment_methods')).toMatchObject({
      present: true,
      platformState: 'installed',
      activated: true,
    });
  });

  it('leaves the checkout with no payment list at all, not a partial one', async () => {
    // The blind alley the product ruling forbids is a checkout that still
    // offers a method it cannot take money through. With the catalog itself
    // off, the honest answer is the refusal envelope — not an empty `data`
    // array, which a storefront would render as "no methods configured".
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
    expect(before.statusCode).toBe(200);

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payment_methods'] });
    try {
      const off = await h.app.inject({ method: 'GET', url: '/api/v1/payment-methods' });
      expect(off.statusCode).toBe(503);
      expect(off.json().error?.code).toBe('MODULE_DISABLED');
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }
  });

  it('leaves the stored catalog intact — off is not uninstall', async () => {
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods',
      cookies: ADMIN,
    });
    expect(before.statusCode).toBe(200);
    const codesBefore = (before.json() as { data: Array<{ code: string }> }).data.map(
      (m) => m.code,
    );

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['payment_methods'] });
    try {
      const off = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/payment-methods',
        cookies: ADMIN,
      });
      expect(off.statusCode).toBe(503);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods',
      cookies: ADMIN,
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { data: Array<{ code: string }> }).data.map((m) => m.code)).toEqual(
      codesBefore,
    );
  });
});

async function presenceOf(
  h: BackendServerHandle,
  moduleId: string,
): Promise<
  | { present: boolean; platformState: string; activated: boolean; deactivatable: boolean }
  | undefined
> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/admin/module-presence',
    cookies: ADMIN,
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    modules: Array<{
      id: string;
      present: boolean;
      platformState: string;
      activated: boolean;
      deactivatable: boolean;
    }>;
  };
  return body.modules.find((m) => m.id === moduleId);
}
