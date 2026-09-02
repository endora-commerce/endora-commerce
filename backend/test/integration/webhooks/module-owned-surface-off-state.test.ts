import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `webhooks`'s **server-side** off-state, for the surface feature 091's Phase 4
 * moved into its package — the batch `plan.md`'s sequence table calls batch 6.
 *
 * One file per module, deliberately, as batch five's carrier pair is: two
 * modules whose batch membership is one fact about their reaches are still two
 * platforms, and an off-state proof with a shared body would be one declaration
 * standing for both.
 *
 * Two questions, and the second is the one this batch created. The module's
 * admin API and both presence projections are driven through
 * `expectModuleAbsent`, which also holds the permission catalogue to the same
 * answer. The **palette** is the new one: Constitution XVII item 5 lists a
 * palette action among the surfaces a switched-off module must not contribute,
 * and the Actions group is resolved *here* — by the server, from the manifests,
 * against the effective enabled-set — so no admin-side test can see it. This
 * module declared no action at all until this batch, which is one of the
 * fifteen Principle XVI entries `specs/deferred-defects.md` records as owed; it
 * arrives with the drain because the drain owes an off-state proof over every
 * surface the module contributes, and there was nothing to assert.
 *
 * The route and sidebar halves of item 5 are proved in the admin, where the
 * gate is `App.tsx`'s `ModuleRoute` and `composeNav`'s filter —
 * `admin/test/modules/integrations-surfaces.module-owned-surface.test.tsx`.
 *
 * Driven on the **operator** axis, which is the one an operator actually
 * creates and the one a platform-availability flip would hide. This module
 * declares an activation control with a default of `true`, so it has one.
 */
describe('webhooks contributes no admin surface while off (Constitution XVII item 5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The palette entries this module advertises, in id order. */
  const actionIds = async (): Promise<string[]> => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(res.statusCode, 'the palette registry must answer').toBe(200);
    // The envelope wraps the paged payload, so the rows are one level deeper
    // than an ordinary list route's.
    const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    return body.data.data
      .filter((action) => action.moduleId === 'webhooks')
      .map((action) => action.actionId)
      .sort();
  };

  it('refuses its admin API and disappears from both presence projections while off', async () => {
    await expectModuleAbsent(h, 'webhooks', {
      routes: [{ url: '/api/v1/admin/webhooks', cookies: admin }],
      adminPresence: { cookies: admin },
    });
  });

  it('advertises no palette action while off, and its own again after', async () => {
    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    expect(await actionIds()).toEqual(['open-webhooks']);
    await withModuleOff('webhooks', 'deactivated', async () => {
      expect(await actionIds()).toEqual([]);
    });
    expect(await actionIds()).toEqual(['open-webhooks']);
  });
});
