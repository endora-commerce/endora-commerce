import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as invoicesAdmin } from '@endora-commerce/mod-invoices/admin';
import { contributions as quoteRequestsAdmin } from '@endora-commerce/mod-quote-requests/admin';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 12's off-state proof — the
 * command palette, for the modules that took their admin surfaces into their
 * packages: `invoices` and `quote_requests`.
 *
 * The batch had a third, `ksef`, which left the repository (feature 134, T069;
 * `contracts/extraction-procedure.md` W2.4). Its row in `SUBJECTS` and its own
 * case — one action, for its own landing route, and its one zone kept out of
 * the palette — asserted that module's declaration, which travelled in its
 * package's `src/admin/index.test.ts`; the palette mechanism they drove is still
 * driven here, over the two real declarations that stay, on the same axis.
 * Recovery: `git show f75de58e9:backend/test/integration/_admin_surfaces/batch-twelve-palette-off-state.test.ts`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-twelve-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the route and the sidebar gates — for `invoices` and
 * `quote_requests` only since feature 134's W2.2, which moved `ksef`'s
 * declaration into its package and deleted its rendered cases against those two
 * as surviving drivers.
 *
 * ## What each module brings to it
 *
 * **This batch declares no new action**, which is the opposite of batches 8, 10
 * and 11 and is worth stating rather than leaving as an absence: the actions —
 * `open-invoices`, `invoice-templates` and `open-rfq-inbox` — were already in
 * the manifests. What the batch does delete
 * is `AppShell.tsx`'s hand-written `PALETTE_ITEMS` row for `/quote-requests`,
 * and that row was a **second copy** of `open-rfq-inbox`: the same
 * destination, the same code, the same keywords, advertised by a table the
 * server was never asked about. For a module an operator really can withdraw —
 * and `quote_requests` is switchable — the copy went on advertising the quote
 * desk after the withdrawal. The first case below is what makes the remaining
 * advertisement withdraw.
 *
 * ## The axis, and why it is the operator's for both
 *
 * Neither declares `activation.nonDeactivatable`, so an operator can
 * genuinely produce the off state and `deactivated` is the axis that measures
 * something an operator can reach. The lock is read off the manifests in the
 * last case rather than restated here, so a module locked one day fails there
 * instead of quietly keeping a table row that says its axis is the other one.
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
    module: 'invoices',
    actions: ['invoice-templates', 'open-invoices'],
    axis: 'deactivated',
    admin: invoicesAdmin,
  },
  {
    module: 'quote_requests',
    actions: ['open-rfq-inbox'],
    axis: 'deactivated',
    admin: quoteRequestsAdmin,
  },
];

describe('batch 12 contributes no palette action while off (Constitution XVII item 5)', () => {
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
      expect(activation, `${subject.module} must declare an activation control`).toBeDefined();
    }
  });

  it('quote_requests’ surviving advertisement is the manifest’s, with the deleted row’s copy', () => {
    // The batch's one palette change, held to the thing that makes it a
    // deletion rather than a product change: `open-rfq-inbox` carries the
    // destination, the code and the keywords the `PALETTE_ITEMS` row carried,
    // so an operator's ⌘K answer for *rfq* and *zapytanie* is what it was —
    // except that it now withdraws with the module, which the first case
    // above is what proves.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'quote_requests',
    )?.manifest;
    const action = (manifest?.actions ?? []).find((entry) => entry.id === 'open-rfq-inbox');
    expect(action?.targetRoute).toBe('/quote-requests');
    expect(action?.requiredPermission).toBe('rfqs:handle');
    for (const keyword of ['rfq', 'quote', 'zapytanie']) {
      expect(action?.keywords, keyword).toContain(keyword);
    }
  });
});
