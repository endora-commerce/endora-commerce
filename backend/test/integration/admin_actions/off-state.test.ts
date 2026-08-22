import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 073, Amendment A1 — the off-state obligation that comes with dropping
 * `nonDeactivatable` from this module (Constitution XVII, checklist item 6).
 *
 * This used to be the awkward one of the three, and what made it awkward is
 * gone — recorded here because the reasoning it replaced was written down as
 * settled. `admin_actions` owns a port, `adminActionsReconciler`, and
 * `composition.ts` forwarded it to the lifecycle orchestrator so that every
 * *other* module's `module:install` and `module:uninstall --hard` kept
 * `module_actions` aligned. `providePort` gates on the effective state, so with
 * the palette switched off that resolution threw `ModuleDisabledError` and
 * aborted the install of a module that has nothing to do with ⌘K. This file
 * called that correct, on the ground that the alternative was a stale palette;
 * it was the better of the only two options on the table, the other being a
 * backend that would not start.
 *
 * Feature 080's T036a took the third option (D-159 §9, the owner, 2026-08-22):
 * `module_actions` is a projection of manifest data, so this module declares a
 * `lifecycleParticipant` in its own `manifest.ts` and the orchestrator collects
 * it from the manifest registry. It is gated on nothing, so the rows are
 * written whether or not the palette is serving them — inert while it is off,
 * and answered from unchanged when it comes back. Nothing here resolves that
 * port any more, and `test/integration/_lifecycle/cli-install-reconciles-projections.integration.test.ts`
 * holds the palette-off install green.
 *
 * The boot case itself is not asserted here: this file flips the registry cache
 * against an already-running server, so it cannot observe a boot that never
 * happened. What it does assert is the property that makes the boot case
 * recoverable — the write that switches the palette back on never gates on the
 * palette.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('admin_actions — off state [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('is absent on every surface while off, and fully restored when on', async () => {
    await expectModuleAbsent(h, 'admin_actions', {
      routes: [{ url: '/api/v1/admin/admin-actions?language=en', cookies: ADMIN }],
      adminPresence: { cookies: ADMIN },
      // No `settingWrite`: the only Setting this module owns is its own
      // activation control — the documented exception.
    });
  });

  it('reports the two axes separately, and stays deactivatable on both', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['admin_actions'] });
    expect(await presenceOf(h, 'admin_actions')).toMatchObject({
      present: false,
      platformState: 'installed',
      activated: false,
      deactivatable: true,
    });

    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'admin_actions'));
    const unavailable = await presenceOf(h, 'admin_actions');
    expect(unavailable).toMatchObject({ present: false, activated: true });
    expect(unavailable?.platformState).not.toBe('installed');

    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await presenceOf(h, 'admin_actions')).toMatchObject({
      present: true,
      platformState: 'installed',
      activated: true,
    });
  });

  it('takes the whole admin down with it on no other surface', async () => {
    // Losing ⌘K is a degradation, not the loss of a capability — that is the
    // ground the amendment released the flag on, so it gets asserted rather
    // than assumed. The sidebar navigates through ordinary module routes, and
    // those keep answering while the palette is off.
    await withModuleOff('admin_actions', 'deactivated', async () => {
      const palette = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: ADMIN,
      });
      expect(palette.statusCode).toBe(503);

      for (const url of [
        '/api/v1/admin/module-presence',
        '/api/v1/admin/settings',
        '/api/v1/admin/admin-users',
      ]) {
        const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
        expect(res.statusCode, `${url} must keep answering while the palette is off`).toBe(200);
      }
    });
  });

  it('can still be switched back on from the surface that switched it off', async () => {
    // The one thing that must never gate on this module's own presence. The
    // activation write lives on `_lifecycle`'s `ungatedRoutes`, so switching
    // the palette off is reversible; if it ever moved behind a gate, an
    // operator would lose ⌘K permanently on the first flip.
    //
    // Issue #141 — a 200 is what this route answers with the palette *on* as
    // well, so the flip having taken is the whole content of the case.
    // `withModuleOff` asserts that before the write, and the gated palette
    // route below is the same fact seen from the module's own surface.
    await withModuleOff('admin_actions', 'deactivated', async () => {
      const gated = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: ADMIN,
      });
      expect(gated.statusCode, 'the palette is not off, so the write proves nothing').toBe(503);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/modules/admin_actions/activation',
        cookies: ADMIN,
        payload: { active: true },
      });
      expect(
        res.statusCode,
        'the activation write must not refuse for the module it is switching on',
      ).toBe(200);
      expect(res.json()).toMatchObject({ module: { id: 'admin_actions', activated: true } });
    });
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
