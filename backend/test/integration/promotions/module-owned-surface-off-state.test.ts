import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `promotions`' **palette** off-state, for the surface feature 091's Phase 4
 * moved into its package — the batch `plan.md`'s sequence table calls batch 7.
 *
 * One file per module, deliberately, as batch five's carrier pair and batch
 * six's set are: two modules whose batch membership is one fact about their
 * reaches are still two platforms, and an off-state proof with a shared body
 * would be one declaration standing for both.
 *
 * **This file answers one question and names where the others are answered.**
 * The module's admin routes and both presence projections are already driven by
 * `off-state.test.ts` beside it, which feature 080's T040b wrote when the module
 * became a package; duplicating `expectModuleAbsent` here would be a second
 * declaration of the same fact, which is the shape that comes to disagree. What
 * that file cannot see is the **palette**: Constitution XVII item 5 lists a
 * palette action among the surfaces a switched-off module must not contribute,
 * and the Actions group is resolved *here* — by the server, from the manifests,
 * against the effective enabled-set — so no admin-side test can see it either.
 *
 * The route and sidebar halves of item 5 are proved in the admin, where the
 * gate is `App.tsx`'s `ModuleRoute` and `composeNav`'s filter —
 * `admin/test/modules/promotions.module-owned-surface.test.tsx`.
 *
 * **The two actions were already declared** (feature 045), so unlike batch six's
 * three members this module is not one of the fifteen Principle XVI entries
 * `specs/deferred-defects.md` records as owed. What the drain adds is the proof
 * that they go when the module does.
 *
 * Driven on the **operator** axis, which is the one an operator actually
 * creates and the one a platform-availability flip would hide. This module
 * declares an activation control with a default of `true`, so it has one.
 */
describe('promotions contributes no palette action while off (Constitution XVII item 5)', () => {
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
      .filter((action) => action.moduleId === 'promotions')
      .map((action) => action.actionId)
      .sort();
  };

  it('advertises both of its palette actions while on, and neither while off', async () => {
    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    expect(await actionIds()).toEqual(['new-promotion', 'open-promotions']);
    await withModuleOff('promotions', 'deactivated', async () => {
      expect(await actionIds()).toEqual([]);
    });
    expect(await actionIds()).toEqual(['new-promotion', 'open-promotions']);
  });
});
