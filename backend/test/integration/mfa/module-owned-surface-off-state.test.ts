import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * `mfa`'s **server-side** off-state, for the surface feature 091's Phase 4
 * batch four moved into its package.
 *
 * `test/integration/mfa/off-state.test.ts` already proves item 6 over this
 * module's routes, its configuration, both presence projections and the D-96
 * login degrade, and none of that changed. What the batch adds is the question
 * that file could not have asked before there was an admin contribution to ask
 * it about: **the palette**. Principle XVII item 5 lists a palette action among
 * the surfaces a switched-off module must not contribute, and the Actions group
 * is resolved *here* — by the server, from the manifests, against the effective
 * enabled-set — so no admin-side test can see it.
 *
 * **`mfa` declared no action until issue #510**, and this file asserted that
 * absence in both states so that whoever added one would be asked for the
 * off-state proof that goes with it. Issue #510 added `open-security`
 * (Principle XVI: an admin could not find the two-factor screen), so the file
 * now asserts the action is advertised while on and withdrawn while off. It
 * carries **no `requiredPermission`**, like the route it opens, so the stub
 * admin session sees it whatever codes it holds.
 *
 * A positive control about a **different** module stays first: an empty answer
 * for `mfa` while off proves nothing until the registry has been seen
 * answering somebody in that same state.
 *
 * `mfa` is the batch's one **switchable** module, so the operator axis —
 * platform-available, activation withdrawn, the case Constitution XVII names —
 * is driven here for real rather than asserted to be inert.
 */
describe('mfa advertises its palette action only while on (Principle XVII item 5)', () => {
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

  it('declares exactly one action, ungated, which is what the cases below rest on', () => {
    // Read from the manifest, not written down here: a later action fails this
    // case and asks for its own off-state.
    const manifest = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === 'mfa')?.manifest;
    expect(manifest, 'mfa is not a registered module').toBeDefined();
    const actions = manifest?.actions ?? [];
    expect(actions.map((action) => action.id)).toEqual(['open-security']);
    expect(actions[0]?.targetRoute).toBe('/profile/security');
    expect(actions[0]?.requiredPermission).toBeUndefined();
  });

  it('advertises it while on, with the registry demonstrably answering', async () => {
    const grouped = await actionsByModule();
    expect(grouped.get('analytics'), 'the palette advertises nothing at all').toBeDefined();
    expect(grouped.get('mfa') ?? []).toEqual(['open-security']);
  });

  it('advertises none while deactivated, and the flip really took', async () => {
    // The operator axis — the one an operator actually creates, and the one a
    // platform-availability flip would hide. `withModuleOff` asserts the module
    // is genuinely absent before the body observes anything (issue #141).
    await withModuleOff('mfa', 'deactivated', async () => {
      const grouped = await actionsByModule();
      expect(grouped.get('mfa') ?? []).toEqual([]);
      // Still a live registry while `mfa` is off, so the empty answer is about
      // this module and not about the endpoint.
      expect(grouped.get('analytics')).toBeDefined();
    });
    expect((await actionsByModule()).get('mfa') ?? []).toEqual(['open-security']);
  });
});
