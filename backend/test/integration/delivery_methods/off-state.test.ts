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
 * Until the amendment this module declared itself non-deactivatable, so no
 * off-state test could exist for it: neither axis had a reachable off state to
 * assert against. Dropping the flag creates one, and this file is what pays for
 * it — the flag was the only thing standing between an operator and every
 * surface below.
 *
 * The module owns a **public** route as well as the admin ones, which is the
 * half an admin-only probe list would miss: `GET /api/v1/delivery-methods` is
 * what a storefront checkout reads its shipping options from, and Constitution
 * XVII counts a storefront element that survives the switch as the module still
 * being present.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('delivery_methods — off state [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('is absent on every surface while off, and fully restored when on', async () => {
    await expectModuleAbsent(h, 'delivery_methods', {
      routes: [
        // Storefront: the shipping options a checkout picks from.
        '/api/v1/delivery-methods',
        // Admin: the catalog screen and its writes.
        { url: '/api/v1/admin/delivery-methods', cookies: ADMIN },
        {
          method: 'PUT',
          url: '/api/v1/admin/delivery-methods/off-state-probe',
          cookies: ADMIN,
          payload: { code: 'off-state-probe', name: 'Probe', kind: 'flat_rate' },
        },
        {
          method: 'DELETE',
          url: '/api/v1/admin/delivery-methods/00000000-0000-0000-0000-000000000000',
          cookies: ADMIN,
        },
      ],
      adminPresence: { cookies: ADMIN },
      // No `settingWrite`: the only Setting this module owns is its own
      // activation control, which is the documented exception to the
      // non-editable-configuration rule and is covered by the activation
      // endpoint's contract test.
    });
  });

  it('reports the two axes separately, and stays deactivatable on both', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['delivery_methods'] });
    expect(await presenceOf(h, 'delivery_methods')).toMatchObject({
      present: false,
      platformState: 'installed',
      activated: false,
      // The amendment's actual subject: before it, this read `false` and the
      // Admin UI rendered a locked control with the withdrawn "the platform
      // cannot take an order" as its reason.
      deactivatable: true,
    });

    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'delivery_methods'));
    const unavailable = await presenceOf(h, 'delivery_methods');
    expect(unavailable).toMatchObject({ present: false, activated: true });
    expect(unavailable?.platformState).not.toBe('installed');

    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await presenceOf(h, 'delivery_methods')).toMatchObject({
      present: true,
      platformState: 'installed',
      activated: true,
    });
  });

  it('leaves the stored catalog intact — off is not uninstall', async () => {
    // FR-040/FR-041. The rows the admin screen refuses to serve while off are
    // still there, so switching back on restores the catalog rather than an
    // empty one.
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods',
      cookies: ADMIN,
    });
    expect(before.statusCode).toBe(200);
    const codesBefore = (before.json() as { data: Array<{ code: string }> }).data.map(
      (m) => m.code,
    );

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['delivery_methods'] });
    try {
      const off = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/delivery-methods',
        cookies: ADMIN,
      });
      expect(off.statusCode).toBe(503);
    } finally {
      registryCache.__setEnabledForTesting(ALL_IDS);
    }

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods',
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
