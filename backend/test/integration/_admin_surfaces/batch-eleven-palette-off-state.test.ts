import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as newsletterAdmin } from '@endora-commerce/mod-newsletter/admin';
import { contributions as transactionalEmailsAdmin } from '@endora-commerce/mod-transactional-emails/admin';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 11's off-state proof — the
 * command palette, for the two modules that took their admin surfaces into
 * their packages: `newsletter` and `transactional_emails`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-eleven-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the route and sidebar gates.
 *
 * ## What each module brings to it
 *
 * Both declared palette actions already — two each — and both gain one or two
 * more here, which is the batch's only manifest addition rather than a file
 * move. `AppShell.tsx`'s `PALETTE_ITEMS` carried six hand-written *Navigate*
 * rows between them, and three of those six named destinations no manifest
 * action covered: `/newsletter/campaigns`, `/newsletter/automations` and
 * `/transactional-emails/blocks`. A hand-written palette row is a copy the
 * server was never asked about — for `newsletter`, a module an operator really
 * can withdraw, it went on advertising three screens after the withdrawal — so
 * the three arrive as declarations with the destinations, the codes and the
 * keywords those rows carried. That is batches 7, 8 and 10's shape; deleting
 * them without declaring them would have been a silent product change.
 *
 * What the drain adds is the proof that the advertisement goes when the module
 * does, and the pairing below, which nothing else in the estate makes:
 * `check:action-route-permissions` holds a declared `requiredPermission` to the
 * code enforced on its own `targetRoute`, and what it cannot see is that the
 * route is one the **admin** declares, because it reconstructs an API path.
 * Since this batch every one of those routes is a line in the owning module's
 * own `./admin` layer, so the two declarations are read from the two artefacts
 * and compared here rather than copied into a table.
 *
 * ## The axis is chosen from the manifest, not guessed
 *
 * `transactional_emails` declares `activation.nonDeactivatable`, so a seeded
 * deactivation would leave it **present** and every assertion under it would be
 * measuring the module switched on — issue #141's shape. The platform axis is
 * what a locked module still has, and a deployment that never installs it
 * reaches the same gate. `newsletter` is switchable (`newsletter.enabled`,
 * default on) and is driven on the operator axis, which is the one an operator
 * can actually produce. The lock is read off the manifests in the last case
 * below rather than restated here, so a module unlocked — or locked — one day
 * fails there.
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
  // Switchable, so the operator axis is real and is the one driven.
  {
    module: 'newsletter',
    actions: [
      'new-newsletter-campaign',
      'open-newsletter',
      'open-newsletter-automations',
      'open-newsletter-campaigns',
    ],
    axis: 'deactivated',
    admin: newsletterAdmin,
  },
  // Locked: `activation.nonDeactivatable`, asserted below in the manifest's own
  // words rather than restated here.
  {
    module: 'transactional_emails',
    actions: ['open-email-blocks', 'open-email-templates', 'open-transactional-emails'],
    axis: 'platform-unavailable',
    admin: transactionalEmailsAdmin,
  },
];

describe('batch 11 contributes no palette action while off (Constitution XVII item 5)', () => {
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

  it('the three new actions carry the copy their hand-written palette rows carried', () => {
    // The batch's only manifest addition, held to the thing that makes it a
    // move rather than a product change: the destinations and the codes are the
    // `PALETTE_ITEMS` rows this batch deletes. A palette entry that changed
    // where it goes, or what it costs to reach, would pass every other case
    // here.
    const declared = (moduleId: string, actionId: string) => {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === moduleId,
      )?.manifest;
      return (manifest?.actions ?? []).find((action) => action.id === actionId);
    };
    expect(declared('newsletter', 'open-newsletter-campaigns')).toMatchObject({
      targetRoute: '/newsletter/campaigns',
      requiredPermission: 'newsletter:read',
    });
    expect(declared('newsletter', 'open-newsletter-automations')).toMatchObject({
      targetRoute: '/newsletter/automations',
      requiredPermission: 'newsletter:read',
    });
    expect(declared('transactional_emails', 'open-email-blocks')).toMatchObject({
      targetRoute: '/transactional-emails/blocks',
      requiredPermission: 'transactional_emails:read',
    });
  });

  it('every route each module declares is reachable, and the two editors are two files', () => {
    // The screens the palette does *not* advertise still have to exist, or the
    // absence above could pass over a module that contributes nothing at all.
    // The two fragment-editor routes are the case worth naming: `App.tsx` wrote
    // `element={<EmailFragmentEditor kind="block" />}` and its template twin,
    // and a contribution declaration has nowhere to put a prop — so they are
    // two components now, and a batch that collapsed them back into one would
    // silently give both routes the same `kind`.
    expect((newsletterAdmin.routes ?? []).map((route) => route.path)).toEqual([
      '/newsletter/subscribers',
      '/newsletter/campaigns',
      '/newsletter/campaigns/new',
      '/newsletter/campaigns/:id',
      '/newsletter/campaigns/:id/stats',
      '/newsletter/automations',
      '/newsletter/automations/new',
      '/newsletter/automations/:id',
      '/newsletter/tags',
      '/newsletter/blocks',
      '/newsletter/provider',
    ]);
    expect((transactionalEmailsAdmin.routes ?? []).map((route) => route.path)).toEqual([
      '/transactional-emails',
      '/transactional-emails/blocks',
      '/transactional-emails/blocks/:id',
      '/transactional-emails/templates',
      '/transactional-emails/templates/:id',
      '/transactional-emails/:code',
    ]);
  });
});
