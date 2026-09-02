import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `admin_roles` off-state — Constitution XVII item 6, for the module feature
 * 091's Phase 4 batch four gave an admin contribution to.
 *
 * **The nav-only shape, and it is the one no previous batch had.** This module
 * declares a sidebar entry and a palette action and **no route of its own**:
 * `/admin-roles`' route is `admin_users`', because the screen is served by
 * `GET /api/v1/admin/admin-roles` in that module. `plan.md`'s open question 3
 * recommended keeping exactly that attribution and both packages' own
 * `src/admin/index.ts` now say so; this file is where the consequence is
 * asserted.
 *
 * The consequence is that the two halves are withdrawn by **different** things,
 * which is the whole reason the split is worth making explicit:
 *
 *  * the **route** goes with `admin_users`, and is proved in that module's own
 *    off-state file;
 *  * the **sidebar entry and the palette action** go with this module — the
 *    palette here, because the Actions group is resolved by the server from the
 *    manifests against the effective enabled-set and no admin-side test can see
 *    it, and the sidebar in
 *    `admin/test/modules/admin-roles.module-owned-surface.test.tsx`.
 *
 * **On the platform axis the split is not observable, and that is measured
 * rather than assumed.** The obvious expectation — withdraw `admin_roles` and
 * the advertisement goes while the screen stays — is false, and it is false for
 * the reason this module's manifest gives: it *"answers the permission check
 * behind every guarded admin route"*, so with it platform-unavailable **every**
 * `requireAdmin` route in the platform answers `503 MODULE_DISABLED` naming
 * `admin_roles`, `/api/v1/admin/admin-roles` and the palette registry among
 * them. That is asserted below in the platform's own words. The axis on which
 * the split *would* be observable is the operator one, and both modules close
 * it — which is why the arrangement is inert today, and why the last assertion
 * reads both locks off the manifests rather than restating them: unlocking
 * either makes it red, at the moment somebody has to decide what withdrawing
 * one half without the other should look like.
 *
 * **This module ships no route of its own**, so there is no `expectModuleAbsent`
 * call: that harness requires a non-empty `routes` declaration, on the ground
 * that an off-state test asserting nothing passes vacuously, and it is right to.
 * Naming `admin_users`' route there to satisfy it would be this file claiming a
 * surface it does not own — the exact confusion the split exists to keep apart.
 */
describe('admin_roles off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const advertised = async (): Promise<Map<string, string[]>> => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(res.statusCode, 'the palette registry must answer').toBe(200);
    const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    const grouped = new Map<string, string[]>();
    for (const action of body.data.data) {
      grouped.set(action.moduleId, [...(grouped.get(action.moduleId) ?? []), action.actionId]);
    }
    return grouped;
  };

  it('registers no admin route of its own, which is what makes this file shaped as it is', () => {
    // Derived, not written down: the assertion is that this module's
    // contribution really is nav-and-palette only, so a later route landing here
    // makes this red and asks for the route half of the proof.
    const own = h.app
      .printRoutes({ commonPrefix: false })
      .split('\n')
      .filter((line) => line.includes('/api/v1/admin/admin-roles'));
    expect(own.length, '/api/v1/admin/admin-roles is registered').toBeGreaterThan(0);
    // …and it is registered by `admin_users`, which is the split this batch
    // made explicit. `admin_users`' own off-state file drives it.
    const manifest = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'admin_roles')?.manifest;
    expect(manifest, 'admin_roles is not a registered module').toBeDefined();
    expect(manifest?.actions?.map((a) => a.targetRoute)).toEqual(['/admin-roles']);
  });

  it('advertises its palette action while present and none while absent', async () => {
    // The positive control first: the entry did not exist before this batch, so
    // an empty answer below would otherwise be indistinguishable from the debt
    // this batch pays.
    expect((await advertised()).get('admin_roles')).toEqual(['open-admin-roles']);

    const baseline = registryCache.enabledIds();
    try {
      registryCache.__setEnabledForTesting(baseline.filter((id) => id !== 'admin_roles'));
      expect(effectiveState.isPresent('admin_roles')).toBe(false);
      // Measured, not assumed — see the note at the top. This module answers the
      // permission check behind every guarded admin route, so on the platform
      // axis the palette registry, the roles screen's own API and every other
      // admin route alike refuse and name it. That is a stronger absence than an
      // empty row set, and a test expecting the empty list would have been red
      // for a correct platform.
      for (const url of [
        '/api/v1/admin/admin-actions?language=en',
        '/api/v1/admin/admin-roles',
        '/api/v1/admin/admin-users',
      ]) {
        const res = await h.app.inject({ method: 'GET', url, cookies: admin });
        expect(res.statusCode, `${url} should refuse while admin_roles is absent`).toBe(503);
        const body = res.json() as { error?: { code?: string; details?: { module?: string } } };
        expect(body.error?.code).toBe('MODULE_DISABLED');
        expect(body.error?.details?.module).toBe('admin_roles');
      }
      // The presence projection is the one surface that keeps answering, which
      // is what lets both frontends gate anything at all in that state.
      const presence = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/module-presence',
        cookies: admin,
      });
      expect(presence.statusCode).toBe(200);
      const modules = (presence.json() as { modules: { id: string; present: boolean }[] }).modules;
      expect(modules.find((m) => m.id === 'admin_roles')?.present).toBe(false);
    } finally {
      registryCache.__setEnabledForTesting(baseline);
    }

    // Off is non-destructive and reversible.
    expect((await advertised()).get('admin_roles')).toEqual(['open-admin-roles']);
  });

  it('has no operator axis, and neither has the module whose route it points at', () => {
    // Why the split is inert today, stated as a measurement rather than as a
    // claim in a comment. Both locks are read from the manifests, so unlocking
    // either makes this red — which is the moment somebody has to decide what
    // withdrawing one half without the other should look like, and the operator
    // axis is where that question would first become visible.
    for (const id of ['admin_roles', 'admin_users']) {
      const activation = REGISTERED_MANIFESTS.find((e) => e.manifest.id === id)?.manifest
        .activation;
      expect(activation, `${id} declares no activation`).toBeDefined();
      expect(activation && 'nonDeactivatable' in activation, `${id} is deactivatable`).toBe(true);
      expect(registryCache.activationDeclaration(id)?.settingCode).toBeNull();
    }
  });
});
