import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `admin_users` off-state — Constitution XVII item 6, for the module feature
 * 091's Phase 4 batch four moved into its own package.
 *
 * **The locked-with-nav shape.** Batch two rejected this module for declaring
 * `activation.nonDeactivatable`; `plan.md`'s Ruling 2 retires the ground —
 * `specs/deferred-defects.md` scopes item 6 to the modules declaring an
 * `activation.settingCode` **without** the lock, so a locked module is outside
 * that population by the owner's own measurement. `expectModuleAbsent` reads
 * the lock off the manifest and switches shape by itself: it seeds a
 * deactivation, requires the module to stay **present** under it, and then
 * drives the platform axis, which a deployment that never installs the module
 * reaches.
 *
 * **The palette assertion here is a refusal rather than an empty list, and that
 * is measured rather than chosen.** For every other module in this batch the
 * ⌘K registry answers 200 while the module is off and simply stops naming it.
 * Not for this one: `admin_actions` declares `admin_users` transitively through
 * `admin_roles`, and every admin request resolves this module's session, so
 * with `admin_users` platform-unavailable `GET /api/v1/admin/admin-actions`
 * itself answers `503 MODULE_DISABLED` with `details.module: "admin_users"`.
 * That is absence of the action *a fortiori* and it is what the platform really
 * does, so it is what is asserted — a test expecting an empty list here would
 * have been red for a correct platform. The presence projection is the surface
 * that keeps answering (`200`, reporting the module absent), which is what lets
 * the admin gate anything at all in that state.
 *
 * The **permission axis** is asserted beside the presence one, because they are
 * two axes and a test that moved only one would pass with either gate missing —
 * and for a locked module the permission axis is the one an operator can
 * actually reach.
 *
 * The **routes and the sidebar entry** are withdrawn at render by the admin's
 * own `isSurfaceVisible`, and are proved in
 * `admin/test/modules/admin-users.module-owned-surface.test.tsx`.
 */
describe('admin_users off-state, from a package (Constitution XVII)', () => {
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

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'admin_users', {
      routes: [
        // The two moved screens' own reads. `/admin-roles` is here rather than
        // in `admin_roles`' own file because this module declares that route:
        // the screen is served by this module's `routes.admin.ts`, which is the
        // half of the split `src/admin/index.ts` records. `admin_roles` ships
        // the sidebar entry and the palette action for it, and asserts those.
        { url: '/api/v1/admin/admin-users', cookies: admin },
        { url: '/api/v1/admin/admin-roles', cookies: admin },
      ],
      adminPresence: { cookies: admin },
      // No `settingWrite`: this module owns no setting. Its one permission code
      // is shared with `customers`, so the harness's `/admin-roles` catalogue
      // sweep excludes it while that owner is present — computed from the live
      // presence set, not listed.
    });
  });

  it('has no operator axis, and a seeded deactivation is proved inert', () => {
    // Ruling 2's *"the missing fourth is missing because the platform refuses to
    // have it, which is a fact about the module and is asserted as one"*. Both
    // halves: the manifest declares the lock, and the platform enforces it —
    // seeding a deactivation leaves the module **present**, which is issue
    // #141's finding stated as an assertion instead of as a green nobody read.
    const activation = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'admin_users')?.manifest
      .activation;
    expect(activation).toBeDefined();
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
    expect(registryCache.activationDeclaration('admin_users')?.settingCode).toBeNull();

    const baseline = registryCache.enabledIds();
    try {
      registryCache.__setEnabledForTesting(baseline, { deactivated: ['admin_users'] });
      expect(
        effectiveState.isPresent('admin_users'),
        'a seeded activation value made a non-deactivatable module absent',
      ).toBe(true);
    } finally {
      registryCache.__setEnabledForTesting(baseline);
    }
  });

  it('refuses both screens to a session without the code they enforce', async () => {
    // The axis a locked module does have, and the one the moved route and nav
    // declarations gate on. `stub-restricted-admin-session` holds `orders:read`
    // and nothing else — the codes are opaque strings, so holding *a* code is
    // not holding this one, which is the distinction a presence-only test would
    // pass without.
    const limited = { b2b_session: 'stub-restricted-admin-session' };
    for (const url of ['/api/v1/admin/admin-users', '/api/v1/admin/admin-roles']) {
      const res = await h.app.inject({ method: 'GET', url, cookies: limited });
      expect(res.statusCode, `${url} should refuse a session without admin_users:manage`).toBe(403);
    }
  });

  it('advertises its palette action while present, and the palette itself refuses while absent', async () => {
    // Principle XVII item 5's palette half. The positive control comes first:
    // the entry did not exist before this batch, and an absence proves nothing
    // until the presence has been seen.
    expect((await advertised()).get('admin_users')).toEqual(['open-admin-users']);

    const baseline = registryCache.enabledIds();
    try {
      registryCache.__setEnabledForTesting(baseline.filter((id) => id !== 'admin_users'));
      expect(effectiveState.isPresent('admin_users')).toBe(false);
      // Measured, not assumed — see the note at the top. The registry route is
      // itself gated behind this module, so the honest assertion is the refusal
      // and the module it names, which is a stronger absence than an empty row
      // set: nothing is advertised to anybody.
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: admin,
      });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { error?: { code?: string; details?: { module?: string } } };
      expect(body.error?.code).toBe('MODULE_DISABLED');
      expect(body.error?.details?.module).toBe('admin_users');
    } finally {
      registryCache.__setEnabledForTesting(baseline);
    }

    // Off is non-destructive and reversible: the action is advertised again.
    expect((await advertised()).get('admin_users')).toEqual(['open-admin-users']);
  });
});
