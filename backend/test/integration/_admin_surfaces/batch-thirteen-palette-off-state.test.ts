import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as priceListsAdmin } from '@endora-commerce/mod-price-lists/admin';
import { contributions as quickOrderAdmin } from '@endora-commerce/mod-quick-order/admin';
import { contributions as inventoryAdmin } from '@endora-commerce/mod-inventory/admin';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { ACTION_PERMISSION_DISAGREEMENTS } from '../../../scripts/check-action-route-permissions.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 13's off-state proof — the
 * command palette, for the four modules that took their admin surfaces into
 * their packages: `price_lists`, `quick_order`, `inventory` and `pim_ergonode`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-thirteen-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the route, the sidebar and the contribution set.
 *
 * ## Two palette rows left the shell, by the two routes earlier batches set
 *
 * `inventory`'s hand-written `PALETTE_ITEMS` row is batch 12's case: its
 * manifest already declared `open-inventory` with the same destination and the
 * same code, so the row was a **second copy** the server was never asked
 * about — one that went on advertising the stock roster after an operator
 * withdrew a module they really can withdraw. Nothing replaces it.
 *
 * `price_lists`' row is batch 10's case: this module declared no action at all,
 * so `open-price-lists` arrives here carrying the row's destination, code and
 * keywords, and its label and description are the two strings the row rendered,
 * moved out of `_i18n`'s bundle into this module's own.
 *
 * `quick_order` and `pim_ergonode` already declared theirs and are untouched.
 *
 * ## Three subjects, not four (feature 134, W2.4)
 *
 * `pim_ergonode`'s row left this file by subject. The **mechanism** — the
 * server resolving the palette against the effective enabled-set, on the
 * operator axis — stays driven here by `quick_order` and `inventory`, whose
 * declarations are in this repository, and on the platform axis by
 * `price_lists`. The **declaration** — its four actions, each landing on a
 * route its own `./admin` layer declares, on the code that route enforces
 * save the one import row `ACTION_PERMISSION_DISAGREEMENTS` records — is that
 * module's and is asserted inside its package. The deleted row is read back
 * from `git show 077b90f42:backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
 *
 * ## The axis, and why one of the three has the other one
 *
 * Two of the three are switchable, so `deactivated` is the axis that measures
 * something an operator can reach. `price_lists` declares
 * `activation.nonDeactivatable` (*"B2B is contract pricing"*), so it has no
 * operator axis at all and the harness drives the platform one — which is what
 * a deployment that never installs the module reaches. The lock is read off the
 * manifests in a case of its own rather than restated here, so a module locked
 * or unlocked one day fails there instead of quietly keeping a table row that
 * says its axis is the other one.
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
  {
    module: 'price_lists',
    actions: ['open-price-lists'],
    axis: 'platform-unavailable',
    admin: priceListsAdmin,
  },
  {
    module: 'quick_order',
    actions: ['open-quick-order'],
    axis: 'deactivated',
    admin: quickOrderAdmin,
  },
  {
    module: 'inventory',
    actions: ['open-inventory'],
    axis: 'deactivated',
    admin: inventoryAdmin,
  },
];

describe('batch 13 contributes no palette action while off (Constitution XVII item 5)', () => {
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
    '$module’s every action targets a route its own admin layer declares',
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
      }
    },
  );

  it.each(SUBJECTS)(
    '$module’s every action advertises the code that opens its own target',
    (subject) => {
      // Principle XVI item 2 — the palette must never advertise a 403 — read
      // between the two artefacts this batch put in one package, which is a
      // comparison nothing else makes.
      //
      // **The exception is derived, never listed.** An import row that lands
      // on a connector's landing screen with the module's write code — the row
      // promises the import and not the screen, and `requiredPermission` is a
      // single field that cannot say both — is an owner's undecided question
      // rather than a defect, and it is recorded once, in
      // `ACTION_PERMISSION_DISAGREEMENTS`. None of the three subjects left here
      // holds such an entry since the PIM connector's row moved into its
      // package (feature 134, W2.4); the ledger is still read rather than
      // assumed empty, so a subject that gains one is exempted by the same
      // decision and not by an edit to this file.
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      for (const action of manifest?.actions ?? []) {
        if (`${subject.module}:${action.id}` in ACTION_PERMISSION_DISAGREEMENTS) continue;
        const target = (subject.admin.routes ?? []).find(
          (route) => route.path === action.targetRoute,
        );
        expect(target?.requiredPermission, action.id).toBe(action.requiredPermission);
      }
    },
  );

  it('each module states the axis it has, in the manifests’ own words', () => {
    // Read from the manifests rather than restated, so a module whose
    // activation shape changes fails here instead of quietly keeping a table
    // row that says its axis is the other one. `price_lists` is the locked one
    // and is why this batch drives both axes at all.
    for (const subject of SUBJECTS) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      expect(manifest, `${subject.module} must be a registered module`).toBeDefined();
      const activation = manifest?.activation;
      const locked = Boolean(activation && 'nonDeactivatable' in activation);
      expect(locked, `${subject.module}'s axis`).toBe(subject.axis === 'platform-unavailable');
      expect(activation, `${subject.module} must declare an activation control`).toBeDefined();
    }
  });

  it('price_lists’ surviving advertisement is the manifest’s, with the deleted row’s copy', () => {
    // The batch's one *new* action, held to the thing that makes it a move
    // rather than a product change: `open-price-lists` carries the destination,
    // the code and the keywords the `PALETTE_ITEMS` row carried, so an
    // operator's ⌘K answer for *cennik* is what it was — except that it is now
    // resolved against the effective enabled-set, which is what the first case
    // above proves.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'price_lists',
    )?.manifest;
    const action = (manifest?.actions ?? []).find((entry) => entry.id === 'open-price-lists');
    expect(action?.targetRoute).toBe('/price-lists');
    expect(action?.requiredPermission).toBe('price_lists:read');
    for (const keyword of ['pricing', 'prices', 'price list', 'cennik']) {
      expect(action?.keywords, keyword).toContain(keyword);
    }
  });

  it('inventory advertises its landing screen once, the deleted row having been a copy', () => {
    // The other of the two deletions, and the assertion that makes it a
    // deletion: `open-inventory` names the same destination and the same code
    // the hand-written row named, so nothing an operator could reach has gone —
    // only the copy the server was never asked about, which is the one that
    // survived a withdrawal.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'inventory',
    )?.manifest;
    const action = (manifest?.actions ?? []).find((entry) => entry.id === 'open-inventory');
    expect(action?.targetRoute).toBe('/inventory');
    expect(action?.requiredPermission).toBe('inventory:read');
  });

  it('none of the three advertises a route it does not own', () => {
    // A palette row pointing into another module's surface is an advertisement
    // whose withdrawal nobody controls. Every action of every subject has to
    // land on a path that module's own `./admin` layer declares — which for
    // `quick_order` is the sharp case, its one route sitting under `/orders/`.
    for (const subject of SUBJECTS) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      const routes = new Set((subject.admin.routes ?? []).map((route) => route.path));
      for (const action of manifest?.actions ?? []) {
        expect(routes.has(action.targetRoute), `${subject.module}: ${action.targetRoute}`).toBe(
          true,
        );
      }
    }
  });
});
