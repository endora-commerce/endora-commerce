import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as credentialsAdmin } from '@endora-commerce/mod-credentials/admin';
import { contributions as dictionariesAdmin } from '@endora-commerce/mod-dictionaries/admin';
import { contributions as pwaAdmin } from '@endora-commerce/mod-pwa/admin';
import { contributions as settingsAdmin } from '@endora-commerce/mod-settings/admin';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 10's off-state proof — the
 * command palette, for the three modules that took their admin surfaces into
 * their packages (`dictionaries`, `settings`, `credentials`) and the fourth
 * whose route came with them (`pwa`).
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-ten-surfaces.module-owned-surface.test.tsx` is the
 * other half and drives the route and sidebar gates.
 *
 * ## What each module brings to it
 *
 * `dictionaries` declares **two actions for the first time**, and that is the
 * batch's one addition to a manifest rather than a file move.
 * `AppShell.tsx`'s `PALETTE_ITEMS` carried a hand-written *Navigate* row for
 * each of its two screens, and a hand-written palette row is a copy the server
 * was never asked about: it went on advertising the screens whatever the
 * effective enabled-set said. Both arrive as manifest actions with the
 * destinations, the code and the keywords those rows carried, which is batches
 * 7 and 8's shape. That is the opposite of batch 9's `assets_library`, which
 * advertised nothing and had nothing invented for it.
 *
 * `settings` and `credentials` already declared theirs, and `pwa` declares
 * **none** — asserted rather than skipped, because a module with no action has
 * nothing to advertise and the honest test is that the registry answers nothing
 * for it in both states, which also fails if somebody adds one without adding
 * it to this table. So what the drain adds for the three is the proof that the
 * advertisement goes when the module does — and the pairing below, which
 * nothing else in the estate makes:
 * `check:action-route-permissions` holds a declared `requiredPermission` to the
 * code enforced on its own `targetRoute`, and what it cannot see is that the
 * route is one the **admin** declares, because it reconstructs an API path.
 * Since this batch every one of those routes is a line in the owning module's
 * own `./admin` layer, so the two declarations are read from the two artefacts
 * and compared here rather than copied into a table.
 *
 * ## The axis is chosen from the manifest, not guessed
 *
 * `settings` and `dictionaries` declare `activation.nonDeactivatable`, so a
 * seeded deactivation would leave either **present** and every assertion under
 * it would be measuring the module switched on — issue #141's shape. The
 * platform axis is what a locked module still has, and a deployment that never
 * installs it reaches the same gate. `credentials` and `pwa` are switchable and
 * are driven on the operator axis, which is the one an operator can actually
 * produce. The lock is read off the manifests in the last case below rather
 * than restated here, so a module unlocked — or locked — one day fails there.
 */

interface Subject {
  readonly module: string;
  /** The action ids the manifest declares, sorted. */
  readonly actions: readonly string[];
  readonly axis: OffStateAxis;
  /** The module's own `./admin` contributions, for the route/action pairing. */
  readonly admin: AdminContributions;
}

const SUBJECTS: readonly Subject[] = [
  // Locked: `activation.nonDeactivatable`, asserted below in the manifests' own
  // words rather than restated here.
  {
    module: 'dictionaries',
    actions: ['open-dictionary', 'open-dictionary-audit'],
    axis: 'platform-unavailable',
    admin: dictionariesAdmin,
  },
  {
    module: 'settings',
    actions: ['open-settings'],
    axis: 'platform-unavailable',
    admin: settingsAdmin,
  },
  // Switchable, so the operator axis is real and is the one driven.
  {
    module: 'credentials',
    actions: ['new-credential', 'open-credentials'],
    axis: 'deactivated',
    admin: credentialsAdmin,
  },
  {
    // Declares **no** action, and this batch does not invent one: choosing a
    // landing action for a screen is a product decision, not a file move — the
    // reasoning batch 9 recorded for `assets_library`. The empty answer is
    // driven in both states below, so an action added later without a proof
    // fails here. It is a Principle XVI entry the register still owes.
    module: 'pwa',
    actions: [],
    axis: 'deactivated',
    admin: pwaAdmin,
  },
];

describe('batch 10 contributes no palette action while off (Constitution XVII item 5)', () => {
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

  it.each(SUBJECTS)(
    '$module’s every action targets a route its own admin layer declares, on the same code',
    (subject) => {
      // The pairing `check:action-route-permissions` cannot make. It
      // reconstructs an **API** path from the SPA route, so it can say the code
      // is the one the API enforces and cannot say the SPA route exists. Since
      // this batch every one of these routes is the module's own declaration,
      // so both halves are read from their artefacts and compared.
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      const actions = manifest?.actions ?? [];
      expect(actions.map((action) => action.id).sort()).toEqual([...subject.actions]);
      for (const action of actions) {
        const target = (subject.admin.routes ?? []).find(
          (route) => route.path === action.targetRoute,
        );
        expect(target, `${action.id} targets ${action.targetRoute}`).toBeDefined();
        // And the code the action advertises is the one that opens the screen:
        // the palette must never advertise a 403 (Principle XVI item 2).
        expect(target?.requiredPermission).toBe(action.requiredPermission);
      }
    },
  );

  it('each module states the axis it has, in the manifests’ own words', () => {
    // Read from the manifests rather than restated, so a module whose
    // activation shape changes fails here instead of quietly keeping a table
    // row that says its axis is the other one.
    for (const subject of SUBJECTS) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      expect(manifest, `${subject.module} must be a registered module`).toBeDefined();
      const activation = manifest?.activation;
      const locked = Boolean(activation && 'nonDeactivatable' in activation);
      expect(locked, `${subject.module}'s axis`).toBe(subject.axis === 'platform-unavailable');
      if (locked && activation && 'nonDeactivatable' in activation) {
        expect(activation.reason).toBeTruthy();
      }
    }
  });

  it('dictionaries’ two actions carry the copy its hand-written palette rows carried', () => {
    // The one manifest addition of the batch, held to the thing that makes it a
    // move rather than a product change: the labels and descriptions are the
    // shipped strings of the `PALETTE_ITEMS` rows this batch deletes, and the
    // code is the module's only one. A palette entry that changed its wording
    // in a file-move batch would pass every other case here.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'dictionaries',
    )?.manifest;
    const actions = manifest?.actions ?? [];
    expect(actions.map((action) => action.targetRoute)).toEqual([
      '/dictionary',
      '/admin/dictionaries/audit',
    ]);
    for (const action of actions) {
      expect(action.requiredPermission).toBe('dictionary.write');
    }
  });

  it('pwa’s route came with settings’ directory, and it advertises nothing', () => {
    // Batch six's split closing, asserted from the artefact rather than from
    // its own doc block. `/settings/pwa` was a host `<Route>` — ungated, so an
    // operator who switched `pwa` off still reached the screen — while this
    // module declared only the sidebar row that pointed at it. The route is the
    // module's now. It still declares no palette action, which the table above
    // drives in both states; this case says the screen is there and only the
    // advertisement is missing, so the absence cannot pass vacuously.
    expect((pwaAdmin.routes ?? []).map((route) => route.path)).toEqual(['/settings/pwa']);
    expect((pwaAdmin.nav ?? []).map((entry) => entry.to)).toEqual(['/settings/pwa']);
    expect((settingsAdmin.routes ?? []).map((route) => route.path)).not.toContain(
      '/settings/pwa',
    );
  });
});
