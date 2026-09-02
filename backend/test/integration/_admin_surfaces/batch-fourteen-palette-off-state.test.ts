import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as customersAdmin } from '@endora-commerce/mod-customers/admin';
import { contributions as organizationsAdmin } from '@endora-commerce/mod-organizations/admin';
import { contributions as salesChannelsAdmin } from '@endora-commerce/mod-sales-channels/admin';
import type {
  AdminContributions,
  PermissionRequirement,
} from '@endora-commerce/admin-kit/contributions';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { ACTION_PERMISSION_DISAGREEMENTS } from '../../../scripts/check-action-route-permissions.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * The **server-side** half of feature 091 batch 14's off-state proof — the
 * command palette, for the three modules that took their admin surfaces into
 * their packages: `customers`, `organizations` and `sales_channels`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-fourteen-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the route, the sidebar, the contribution set and
 * the three zone mounts.
 *
 * ## Two palette rows left the shell, both by batch 10's route
 *
 * Neither `organizations` nor `sales_channels` declared an action that *opened*
 * its landing screen, so each hand-written `PALETTE_ITEMS` row was a copy the
 * server was never asked about — one that went on advertising the screen
 * whatever the effective enabled-set said. `open-organizations` and
 * `open-sales-channels` arrive here carrying those rows' destinations and
 * keywords, and their labels and descriptions are the four strings the rows
 * rendered, moved out of `_i18n`'s bundle into the two modules' own.
 * `customers` had no palette row at all and already declared both of its
 * actions; it is untouched.
 *
 * ## One narrowing, and it is the schema's rather than a choice
 *
 * The `/organizations` row carried an **any-of pair** —
 * `['customers:read', 'customers:manage']` — because the route is
 * `requireAdminAny` of the two. `ModuleActionSchema.requiredPermission` is a
 * single string, so `open-organizations` names `customers:read` and a role
 * holding only `customers:manage` loses the palette entry while keeping the
 * sidebar one, whose declaration takes the whole `PermissionRequirement`. The
 * pairing case below therefore reads **sufficiency** and not equality, which is
 * the rule `check:action-route-permissions` already applies one layer up:
 * holding the action's code alone must open the target.
 *
 * ## The axis, and why two of the three have the platform one
 *
 * `organizations` declares `activation.nonDeactivatable` (*"the single unit of
 * tenancy"*) and so does `sales_channels` (*"channel scoping is structural"*),
 * so neither has an operator axis at all and the harness drives the platform
 * one — which is what a deployment that never installs the module reaches.
 * `customers` is switchable, so `deactivated` is the axis that measures
 * something an operator can reach. The lock is read off the manifests in a case
 * of its own rather than restated here, so a module locked or unlocked one day
 * fails there instead of quietly keeping a table row that says its axis is the
 * other one.
 */

/**
 * Does holding `code` alone satisfy `requirement`?
 *
 * The kit publishes exactly this as `satisfiesPermission` on
 * `@endora-commerce/admin-kit/lib`, and importing it here would be wrong for a
 * reason that is structural rather than stylistic: `paths` puts that subpath's
 * **source** in the backend's `tsc` program, and it is a React barrel — `auth`,
 * `module-presence` and `TranslationProvider` are `.tsx`, and the backend
 * program carries no `jsx` setting and no `vite/client` types. Eight
 * diagnostics, measured, none of them about this file. The `contributions`
 * subpath is type-only and is imported above for the same reason in reverse.
 *
 * Four lines rather than a duplicated rule: the union's own shape is what the
 * two branches follow, and `check:admin-zones`' `AdminZonePropsMap` pairing is
 * the precedent for a backend test reading a frontend shape through its
 * contract type.
 */
function opensWith(requirement: PermissionRequirement | undefined, code: string): boolean {
  if (requirement === undefined) return true;
  if (typeof requirement === 'string') return requirement === code;
  return requirement.length === 0 || requirement.includes(code);
}

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
    module: 'customers',
    actions: ['online-customers', 'open-customers'],
    axis: 'deactivated',
    admin: customersAdmin,
  },
  {
    module: 'organizations',
    actions: ['open-organizations'],
    axis: 'platform-unavailable',
    admin: organizationsAdmin,
  },
  {
    module: 'sales_channels',
    actions: ['new-sales-channel', 'open-sales-channels'],
    axis: 'platform-unavailable',
    admin: salesChannelsAdmin,
  },
];

describe('batch 14 contributes no palette action while off (Constitution XVII item 5)', () => {
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
    '$module’s every action advertises a code that opens its own target',
    (subject) => {
      // Principle XVI item 2 — the palette must never advertise a 403 — read
      // between the two artefacts this batch put in one package, which is a
      // comparison nothing else makes.
      //
      // **Sufficiency and not equality**, which is
      // `check:action-route-permissions`' own reading and which this batch is
      // the first to need on this side of the seam: `/organizations` declares
      // an any-of pair and `ModuleActionSchema.requiredPermission` is a single
      // string, so `open-organizations` can only ever name one member of it.
      // The honest question is the operator's — does holding the advertised
      // code alone open the advertised screen — and `satisfiesPermission` is
      // the predicate the sidebar, the palette and the route gate already
      // share, so asking it here compares the two declarations through the same
      // answer an operator gets rather than through a second copy of the rule.
      //
      // **The exception is derived, never listed.** An owner may deliberately
      // advertise an *operation* rather than a screen, and
      // `ACTION_PERMISSION_DISAGREEMENTS` is where that decision is recorded
      // once. Reading that ledger here rather than writing an id into this file
      // means the day an owner decides, this case tightens in the same merge
      // request that empties the entry.
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      for (const action of manifest?.actions ?? []) {
        if (`${subject.module}:${action.id}` in ACTION_PERMISSION_DISAGREEMENTS) continue;
        const target = (subject.admin.routes ?? []).find(
          (route) => route.path === action.targetRoute,
        );
        expect(
          opensWith(target?.requiredPermission, action.requiredPermission ?? ''),
          `${action.id} advertises ${String(action.requiredPermission)} for ${action.targetRoute}`,
        ).toBe(true);
      }
    },
  );

  it('each module states the axis it has, in the manifests’ own words', () => {
    // Read from the manifests rather than restated, so a module whose
    // activation shape changes fails here instead of quietly keeping a table
    // row that says its axis is the other one. Two of this batch's three are
    // locked, which is why it drives both axes at all.
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

  it('the two new advertisements are the manifests’, with the deleted rows’ copy', () => {
    // The batch's two *new* actions, held to the thing that makes each a move
    // rather than a product change: both carry the destination and the keywords
    // their `PALETTE_ITEMS` row carried, so an operator's ⌘K answer for
    // `organizacja` or `kanał` is what it was — except that it is now resolved
    // against the effective enabled-set, which is what the first case above
    // proves.
    const actionOf = (moduleId: string, actionId: string) =>
      (
        REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === moduleId)?.manifest.actions ?? []
      ).find((entry) => entry.id === actionId);

    const organizations = actionOf('organizations', 'open-organizations');
    expect(organizations?.targetRoute).toBe('/organizations');
    // The narrowing, asserted rather than glossed: the row named an any-of pair
    // and the action can name one code. `customers:read` is the member that
    // opens the roster for the role the row was written for.
    expect(organizations?.requiredPermission).toBe('customers:read');
    for (const keyword of ['org', 'organization', 'organizacja', 'klient']) {
      expect(organizations?.keywords, keyword).toContain(keyword);
    }

    const salesChannels = actionOf('sales_channels', 'open-sales-channels');
    expect(salesChannels?.targetRoute).toBe('/sales-channels');
    expect(salesChannels?.requiredPermission).toBe('sales_channels:read');
    for (const keyword of ['sales', 'channel', 'kanał']) {
      expect(salesChannels?.keywords, keyword).toContain(keyword);
    }
  });

  it('customers advertises its two screens once, having had no hand-written row', () => {
    // The third module, and the case that says why it needed nothing: its two
    // actions predate this batch and name the two routes its `./admin` layer
    // now declares, so the conversion moved a sidebar and left the palette
    // alone. Asserted rather than assumed, because "we changed nothing" is the
    // claim that goes stale without a test.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'customers',
    )?.manifest;
    const byId = new Map((manifest?.actions ?? []).map((action) => [action.id, action]));
    expect(byId.get('open-customers')?.targetRoute).toBe('/customers');
    expect(byId.get('online-customers')?.targetRoute).toBe('/customers/online');
    for (const id of ['open-customers', 'online-customers']) {
      expect(byId.get(id)?.requiredPermission, id).toBe('customers:read');
    }
  });

  it('the sales-channel create action and its route agree on the write code', () => {
    // The batch's one operator-visible tightening, read across the seam.
    // `/sales-channels/new` was `App.tsx`'s and therefore ungated while
    // `new-sales-channel` advertised it under `sales_channels:write`; the route
    // is this module's own now and takes that same code, which is
    // `credentials`' shape from batch 10. Asserted here as well as in the admin
    // half because this is the seam where the two artefacts can disagree.
    const action = (
      REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === 'sales_channels')?.manifest
        .actions ?? []
    ).find((entry) => entry.id === 'new-sales-channel');
    expect(action?.requiredPermission).toBe('sales_channels:write');
    const route = (salesChannelsAdmin.routes ?? []).find(
      (entry) => entry.path === action?.targetRoute,
    );
    expect(route?.requiredPermission).toBe('sales_channels:write');
  });

  it('none of the three advertises a route it does not own', () => {
    // A palette row pointing into another module's surface is an advertisement
    // whose withdrawal nobody controls. Every action of every subject has to
    // land on a path that module's own `./admin` layer declares.
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
