import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 8's off-state proof — the
 * command palette, for the six modules that took their admin surfaces into
 * their packages: `seo`, `taxes`, `credit_limits`, `delivery_methods`,
 * `megamenu` and `returns`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-eight-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the route and sidebar gates.
 *
 * ## What each module brings to it
 *
 * `credit_limits` and `delivery_methods` **gain** their action here. Both had a
 * hand-written `PALETTE_ITEMS` row in `AppShell.tsx` instead — a copy of an
 * advertisement the server was never asked about, which went on offering the
 * screen after an operator switched the module off. Two of the fifteen
 * Principle XVI entries `specs/deferred-defects.md` records are paid by that,
 * by the mechanism it predicts: the drain owes an off-state proof over every
 * surface a module contributes, and a `PALETTE_ITEMS` row is not one.
 *
 * `megamenu` and `returns` already declared theirs, so what the drain adds for
 * them is the proof that it goes when the module does.
 *
 * `seo` and `taxes` declare **none**, and that is asserted rather than skipped:
 * a module with no action has nothing to advertise, so the honest test is that
 * the registry answers nothing for it in both states — which also fails if
 * somebody adds one without adding it to this table. Both are Principle XVI
 * entries the register still owes; neither is this batch's to pay, because
 * inventing a landing action for a screen is a product decision and not a file
 * move.
 *
 * ## The axis is chosen from the manifest, not guessed
 *
 * `taxes` declares `activation.nonDeactivatable`, so a seeded deactivation
 * leaves it **present** and every assertion under it would be measuring the
 * module switched on — issue #141's shape. The platform axis is what a locked
 * module still has, and a deployment that never installs it reaches the same
 * gate.
 */

interface Subject {
  readonly module: string;
  /** The action ids the manifest declares, sorted. */
  readonly actions: readonly string[];
  readonly axis: OffStateAxis;
}

const SUBJECTS: readonly Subject[] = [
  { module: 'seo', actions: [], axis: 'deactivated' },
  // Locked: `activation.nonDeactivatable`, asserted below in the manifest's
  // own words rather than restated here.
  { module: 'taxes', actions: [], axis: 'platform-unavailable' },
  { module: 'credit_limits', actions: ['open-credit-limits'], axis: 'deactivated' },
  { module: 'delivery_methods', actions: ['open-delivery-methods'], axis: 'deactivated' },
  { module: 'megamenu', actions: ['edit-megamenu'], axis: 'deactivated' },
  { module: 'returns', actions: ['open-returns', 'return-statuses'], axis: 'deactivated' },
];

describe('batch 8 contributes no palette action while off (Constitution XVII item 5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The palette entries `moduleId` advertises, in id order. */
  const actionIds = async (moduleId: string): Promise<string[]> => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-actions?language=en',
      cookies: admin,
    });
    expect(res.statusCode, 'the palette registry must answer').toBe(200);
    const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
    return body.data.data
      .filter((action) => action.moduleId === moduleId)
      .map((action) => action.actionId)
      .sort();
  };

  it.each(SUBJECTS)(
    '$module advertises exactly what its manifest declares, and nothing while off',
    async (subject) => {
      // The positive control comes first: without it an empty list would prove
      // nothing, because a registry answering nothing to anybody would pass.
      expect(await actionIds(subject.module)).toEqual([...subject.actions]);
      await withModuleOff(subject.module, subject.axis, async () => {
        expect(await actionIds(subject.module)).toEqual([]);
      });
      expect(await actionIds(subject.module)).toEqual([...subject.actions]);
    },
  );

  it('taxes states the axis it does not have, in the manifest’s own words', () => {
    // Read from the manifest rather than restated, so a module that is unlocked
    // one day fails here instead of quietly keeping a table row that says its
    // axis is the platform one.
    const manifest = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === 'taxes')?.manifest;
    expect(manifest, 'taxes must be a registered module').toBeDefined();
    const activation = manifest?.activation;
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
    expect(
      activation && 'nonDeactivatable' in activation ? activation.reason : null,
    ).toBeTruthy();
  });

  it('the two new actions target the routes their modules declare', () => {
    // `check:action-route-permissions` holds a declared `requiredPermission` to
    // the code enforced on its own `targetRoute`. What it cannot see is that
    // the route is one the *admin* declares — the check reconstructs an API
    // path — so the pairing between the manifest action and the module's own
    // admin contribution is asserted here.
    const targets = new Map<string, string>([
      ['credit_limits', '/credit-limits'],
      ['delivery_methods', '/delivery-methods'],
    ]);
    for (const [moduleId, route] of targets) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === moduleId,
      )?.manifest;
      expect(manifest, `${moduleId} must be a registered module`).toBeDefined();
      const actions = manifest?.actions ?? [];
      expect(actions.map((action) => action.targetRoute)).toEqual([route]);
    }
  });
});
