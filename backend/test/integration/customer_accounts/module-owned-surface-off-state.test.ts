import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `customer_accounts`' **server-side** off-state, for the surface feature 091's
 * Phase 4 moved into its package — the batch `plan.md`'s sequence table calls
 * batch 7.
 *
 * **This is the locked member of the batch**, and `plan.md`'s Ruling 2 is what
 * makes it eligible for the drain at all: `specs/deferred-defects.md` scopes
 * Constitution XVII item 6 to the modules declaring an `activation.settingCode`
 * **without** `nonDeactivatable`, so a locked module is outside that population
 * by the owner's own measurement — but not outside the frontend's question,
 * which the admin asks of every module whatever its manifest says.
 *
 * What is asserted is therefore the axis this module has. `expectModuleAbsent`
 * reads the lock off the manifest and switches shape by itself: a seeded
 * deactivation must leave the module **present** (the door is proved shut), and
 * the platform axis — which a deployment that never installs it reaches — is
 * then driven for real. The last assertion states the closed axis in the
 * module's own words, so the missing case is a fact about `customer_accounts`
 * rather than an absence a reader has to infer.
 *
 * The **palette** is the second question and is asked here because the Actions
 * group is resolved by the server, from the manifests, against the effective
 * enabled-set — no admin-side test can see it. The action itself was declared
 * by feature 076 (D-79), so this module is not one of the fifteen Principle XVI
 * entries `specs/deferred-defects.md` records as owed; what the drain adds is
 * the proof that it goes when the module does.
 *
 * The route and sidebar halves of item 5 are proved in the admin, where the
 * gate is `App.tsx`'s `ModuleRoute` and `composeNav`'s filter —
 * `admin/test/modules/customer-accounts.module-owned-surface.test.tsx`.
 */
describe('customer_accounts contributes no admin surface while off (Constitution XVII item 5)', () => {
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
      .filter((action) => action.moduleId === 'customer_accounts')
      .map((action) => action.actionId)
      .sort();
  };

  it('refuses its admin API and disappears from both presence projections while off', async () => {
    await expectModuleAbsent(h, 'customer_accounts', {
      routes: [{ url: '/api/v1/admin/customer-groups', cookies: admin }],
      adminPresence: { cookies: admin },
    });
  });

  it('advertises no palette action while off, and its own again after', async () => {
    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    //
    // The axis is `platform-unavailable`, not `deactivated`: this module is
    // locked, so a seeded deactivation leaves it present and every assertion
    // under it would be measuring the module switched **on**. That is issue
    // #141's shape, and the axis is chosen here rather than discovered.
    expect(await actionIds()).toEqual(['open-customer-groups']);
    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      expect(await actionIds()).toEqual([]);
    });
    expect(await actionIds()).toEqual(['open-customer-groups']);
  });

  it('states the axis it does not have, in the manifest’s own words', () => {
    // Read from the manifest rather than restated, so a module that is
    // unlocked one day fails here instead of quietly keeping a test that says
    // it cannot be switched off.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'customer_accounts',
    )?.manifest;
    expect(manifest, 'customer_accounts must be a registered module').toBeDefined();
    // The declaration is a union — an activation control, or a lock with a
    // reason — so the narrowing is the assertion: a module that grew a
    // `settingCode` would fail here rather than quietly keeping a test that
    // says it cannot be switched off.
    const activation = manifest?.activation;
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
    expect(
      activation && 'nonDeactivatable' in activation ? activation.reason : null,
    ).toContain('identity a buyer signs in as');
  });
});
