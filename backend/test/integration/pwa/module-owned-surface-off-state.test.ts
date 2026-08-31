import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `pwa`'s **server-side** off-state, for the surface feature 091's Phase 4
 * batch six moved into its package.
 *
 * The admin half is `admin/test/modules/pwa.module-owned-surface.test.tsx`,
 * which drives the sidebar entry across the four cases. What that file cannot
 * see is the **palette**: Principle XVII item 5 lists a palette action among
 * the surfaces a switched-off module must not contribute, and the Actions group
 * is resolved *here* — by the server, from the manifests, against the effective
 * enabled-set.
 *
 * **`pwa` declares no action, and this file says so rather than omitting the
 * assertion.** `plan.md`'s Ruling 1 is explicit that a module contributing none
 * of a surface has nothing to assert absent *there*, and that *"the batch's own
 * test names the ones it does not contribute and why, derived from the manifest
 * and the contribution set rather than asserted"*. So the derivation is the
 * assertion: the manifest is read for an `actions` array, the registry is asked
 * what it advertises for this module, and the two are required to agree in both
 * states. Whoever gives `pwa` a palette action makes this file red, which is
 * the right moment to be asked for the off-state proof that goes with it.
 *
 * The positive control comes first and is deliberately about a **different**
 * module: an empty answer for `pwa` proves nothing until the registry has been
 * seen answering somebody, and asking `pwa` for its own control is impossible
 * when the expected answer is empty in both states.
 *
 * `pwa` is switchable — `activation: { settingCode: 'pwa.enabled', default: true }`
 * — so the operator axis is driven here for real rather than asserted to be
 * inert.
 */
describe('pwa contributes no palette action, off or on (Principle XVII item 5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Every action the palette registry advertises, grouped by owner. */
  const actionsByModule = async (): Promise<Map<string, string[]>> => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(res.statusCode, 'the palette registry must answer').toBe(200);
    // The envelope wraps the paged payload, so the rows are one level deeper
    // than an ordinary list route's.
    const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    const grouped = new Map<string, string[]>();
    for (const action of body.data.data) {
      grouped.set(action.moduleId, [...(grouped.get(action.moduleId) ?? []), action.actionId]);
    }
    return grouped;
  };

  it('declares none in its manifest, which is what makes the absence meaningful', () => {
    // Read from the manifest, not written down here: this is the fact the
    // assertions below rest on, and a batch that later adds an action changes
    // it in one place. `pwa` is one of the sixteen modules
    // `specs/deferred-defects.md` names under *"Sixteen modules with an admin
    // screen declare no command-palette action"* — it has an admin surface and
    // advertises none of it in the palette — so this assertion is also where
    // that debt is visible rather than merely deferred.
    const manifest = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === 'pwa')?.manifest;
    expect(manifest, 'pwa is not a registered module').toBeDefined();
    expect(
      manifest?.actions ?? [],
      'pwa now declares a palette action — assert its off-state here rather than deleting this',
    ).toEqual([]);
  });

  it('advertises none while on, with the registry demonstrably answering', async () => {
    const grouped = await actionsByModule();
    // The positive control. `analytics` converted in batch two and declares one
    // action; if the registry answered nobody, `pwa`'s empty answer below would
    // be indistinguishable from a broken endpoint.
    expect(grouped.get('analytics'), 'the palette advertises nothing at all').toBeDefined();
    expect(grouped.get('pwa') ?? []).toEqual([]);
  });

  it('advertises none while deactivated either, and the flip really took', async () => {
    // The operator axis — the one an operator actually creates, and the one a
    // platform-availability flip would hide. `withModuleOff` asserts the module
    // is genuinely absent before the body observes anything (issue #141).
    await withModuleOff('pwa', 'deactivated', async () => {
      const grouped = await actionsByModule();
      expect(grouped.get('pwa') ?? []).toEqual([]);
      // Still a live registry while `pwa` is off, so the empty answer is about
      // this module and not about the endpoint.
      expect(grouped.get('analytics')).toBeDefined();
    });
  });
});
