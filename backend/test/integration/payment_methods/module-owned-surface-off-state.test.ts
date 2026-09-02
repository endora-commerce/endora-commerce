import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `payment_methods`' **palette** off-state, for the surface feature 091's Phase
 * 4 moved into its package — the batch `plan.md`'s sequence table calls batch 7.
 *
 * One file per module, deliberately, as batch five's carrier pair and batch
 * six's set are.
 *
 * **This file answers one question and names where the others are answered.**
 * The module's admin routes and both presence projections are already driven by
 * `off-state.test.ts` beside it; duplicating `expectModuleAbsent` here would be
 * a second declaration of the same fact, which is the shape that comes to
 * disagree. What that file cannot see is the **palette**: Constitution XVII
 * item 5 lists a palette action among the surfaces a switched-off module must
 * not contribute, and the Actions group is resolved *here* — by the server,
 * from the manifests, against the effective enabled-set — so no admin-side test
 * can see it either.
 *
 * The route and sidebar halves of item 5 are proved in the admin, where the
 * gate is `App.tsx`'s `ModuleRoute` and `composeNav`'s filter —
 * `admin/test/modules/payment-methods.module-owned-surface.test.tsx`.
 *
 * **The action was already declared** (feature 076, D-83 item 8), so this module
 * is not one of the fifteen Principle XVI entries `specs/deferred-defects.md`
 * records as owed. What the drain adds is the proof that it goes when the module
 * does — which matters more here than for most: until batch 7 the admin also
 * carried a **hand-written** `PALETTE_ITEMS` row for the same screen, a copy the
 * server was never asked about, which went on advertising `/payment-methods`
 * after an operator switched the module off. That row is gone; this is what
 * stands in its place.
 *
 * Driven on the **operator** axis, which is the one an operator actually
 * creates and the one a platform-availability flip would hide. This module
 * declares an activation control with a default of `true`, so it has one.
 */
describe('payment_methods contributes no palette action while off (Constitution XVII item 5)', () => {
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
    const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    return body.data.data
      .filter((action) => action.moduleId === 'payment_methods')
      .map((action) => action.actionId)
      .sort();
  };

  it('advertises its palette action while on, and none while off', async () => {
    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    expect(await actionIds()).toEqual(['open-payment-methods']);
    await withModuleOff('payment_methods', 'deactivated', async () => {
      expect(await actionIds()).toEqual([]);
    });
    expect(await actionIds()).toEqual(['open-payment-methods']);
  });
});
