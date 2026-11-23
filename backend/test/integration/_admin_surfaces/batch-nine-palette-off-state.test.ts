import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as assetsLibraryAdmin } from '@endora-commerce/mod-assets-library/admin';
import { contributions as customFieldsAdmin } from '@endora-commerce/mod-custom-fields/admin';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 9's off-state proof — the
 * command palette, for the two modules that took their admin surfaces into
 * their packages: `assets_library` and `custom_fields`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-nine-surfaces.module-owned-surface.test.tsx` is the
 * other half and drives the route and sidebar gates.
 *
 * ## What each module brings to it
 *
 * `custom_fields` already declared `open-custom-fields`, so what the drain adds
 * for it is the proof that the advertisement goes when the module does — and
 * the pairing below, which nothing else in the estate makes:
 * `check:action-route-permissions` holds a declared `requiredPermission` to the
 * code enforced on its own `targetRoute`, and what it cannot see is that the
 * route is one the **admin** declares, because it reconstructs an API path.
 * Since this batch that route is a line in the module's own `./admin` layer, so
 * the two declarations are read from the two artefacts and compared here rather
 * than copied into a table.
 *
 * `assets_library` declared none when this batch landed, and paid that
 * Principle XVI entry later (`specs/156-asset-stable-url/`): it now declares
 * `open-assets-library` ("Assets library", `assets.read`), so it is held to the
 * same two proofs — the advertisement goes when the module does, and the
 * declared permission is the one its own `./admin` route enforces. The table
 * below names its action ids, so adding or dropping one without updating it
 * fails here.
 *
 * ## The axis is chosen from the manifest, not guessed
 *
 * **Both** modules declare `activation.nonDeactivatable`, so a seeded
 * deactivation leaves either **present** and every assertion under it would be
 * measuring the module switched on — issue #141's shape. The platform axis is
 * what a locked module still has, and a deployment that never installs it
 * reaches the same gate. The lock is read off the manifest in the last case
 * below rather than restated here.
 */

interface Subject {
  readonly module: string;
  /** The action ids the manifest declares, sorted. */
  readonly actions: readonly string[];
  readonly axis: OffStateAxis;
}

const SUBJECTS: readonly Subject[] = [
  // Both locked: `activation.nonDeactivatable`, asserted below in the
  // manifests' own words rather than restated here.
  { module: 'assets_library', actions: ['open-assets-library'], axis: 'platform-unavailable' },
  // #1804 added `new-custom-field`, which opens the definition editor's own route.
  {
    module: 'custom_fields',
    actions: ['new-custom-field', 'open-custom-fields'],
    axis: 'platform-unavailable',
  },
];

describe('batch 9 contributes no palette action while off (Constitution XVII item 5)', () => {
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

  it('both modules state the axis they do not have, in the manifests’ own words', () => {
    // Read from the manifests rather than restated, so a module that is
    // unlocked one day fails here instead of quietly keeping a table row that
    // says its axis is the platform one.
    for (const subject of SUBJECTS) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      expect(manifest, `${subject.module} must be a registered module`).toBeDefined();
      const activation = manifest?.activation;
      expect(
        activation && 'nonDeactivatable' in activation,
        `${subject.module} must declare nonDeactivatable`,
      ).toBe(true);
      expect(
        activation && 'nonDeactivatable' in activation ? activation.reason : null,
      ).toBeTruthy();
    }
  });

  it('every custom_fields action targets a route its own admin layer declares', () => {
    // The pairing `check:action-route-permissions` cannot make. It reconstructs
    // an **API** path from the SPA route, so it can say the code is the one the
    // API enforces and cannot say the SPA route exists. Since this batch the
    // route is the module's own declaration, so both halves are read from their
    // artefacts and compared — for each action, since #1804 added a second one.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'custom_fields',
    )?.manifest;
    const actions = manifest?.actions ?? [];
    expect(actions.map((action) => action.id)).toEqual(['open-custom-fields', 'new-custom-field']);
    const routes = customFieldsAdmin.routes ?? [];
    for (const action of actions) {
      const target = routes.find((route) => route.path === action.targetRoute);
      expect(target, `${action.id} must target a declared route`).toBeDefined();
      // And the code the action advertises is the one that opens the screen: the
      // palette must never advertise a 403 (Principle XVI item 2).
      expect(target?.requiredPermission, action.id).toBe(action.requiredPermission);
    }
  });

  it('assets_library’s action targets the route its own admin layer declares', () => {
    // Its "Assets library" action (`specs/156-asset-stable-url/` research R-16)
    // paid the Principle XVI debt this case used to record as an absence; the
    // pairing is now the same as custom_fields' above.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'assets_library',
    )?.manifest;
    const actions = manifest?.actions ?? [];
    expect(actions.map((action) => action.id)).toEqual(['open-assets-library']);
    expect((assetsLibraryAdmin.routes ?? []).map((route) => route.path)).toEqual([
      '/assets-library',
    ]);
    const target = (assetsLibraryAdmin.routes ?? []).find(
      (route) => route.path === actions[0]?.targetRoute,
    );
    expect(target?.requiredPermission).toBe(actions[0]?.requiredPermission);
  });
});
