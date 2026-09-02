import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as catalogAdmin } from '@endora-commerce/mod-catalog/admin';
import { contributions as ordersAdmin } from '@endora-commerce/mod-orders/admin';
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
 * The **server-side** half of feature 091 batch 15's off-state proof — the
 * command palette, for the two modules that took their admin surfaces into
 * their packages: `catalog` and `orders`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-fifteen-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the routes, the sidebar, the contribution set and
 * the eleven zone mounts.
 *
 * ## Three palette rows left the shell, all by batch 10's route
 *
 * `catalog` declared `new-product` and nothing that *opened* any of the three
 * screens `AppShell.tsx` carried a hand-written `PALETTE_ITEMS` row for, and a
 * hand-written palette row is a copy the server was never asked about — it went
 * on advertising the screen whatever the effective enabled-set said.
 * `open-products`, `open-categories` and `open-attributes` arrive here carrying
 * those rows' destinations, codes and keywords, and their labels and
 * descriptions are the six strings the rows rendered, moved out of `_i18n`'s
 * bundle into this module's own.
 *
 * `orders` is batch 12's case instead: its `/orders` row duplicated an
 * `open-orders` action the manifest had declared all along, with the same
 * destination and the same code, so the row is simply gone and nothing replaces
 * it. Its manifest is untouched by this batch.
 *
 * ## Both modules are locked, which is a first for this drain
 *
 * `catalog` declares `activation.nonDeactivatable` (*"products, variants and
 * categories"*) and so does `orders` (*"the order is the transaction this
 * platform exists to record"*), so neither has an operator axis at all and the
 * harness drives the platform one — which is what a deployment that never
 * installs the module reaches. The lock is read off the manifests in a case of
 * its own rather than restated here, so a module locked or unlocked one day
 * fails there instead of quietly keeping a table row that says its axis is the
 * other one.
 *
 * ## One action's target is a route pattern rather than a path
 *
 * `new-product` targets `/catalog/products/new`, and `catalog` declares no such
 * route: the create form is `/catalog/products/:id` with the id `new`, which is
 * what `ProductEditor`'s own `isNew` reads and what `App.tsx` served before this
 * batch. So the pairing below matches an action's target against the declared
 * route **patterns**, not against a set of literal paths. That is the honest
 * question — *is there a route that will answer this URL* — and a set
 * comparison would have failed a screen that has worked since feature 022.
 */

/**
 * Does holding `code` alone satisfy `requirement`?
 *
 * The kit publishes exactly this as `satisfiesPermission` on
 * `@endora-commerce/admin-kit/lib`, and importing it here would be wrong for a
 * reason that is structural rather than stylistic: `paths` puts that subpath's
 * **source** in the backend's `tsc` program, and it is a React barrel. The
 * `contributions` subpath is type-only and is imported above for the same
 * reason in reverse.
 */
function opensWith(requirement: PermissionRequirement | undefined, code: string): boolean {
  if (requirement === undefined) return true;
  if (typeof requirement === 'string') return requirement === code;
  return requirement.length === 0 || requirement.includes(code);
}

/**
 * Does a declared route pattern answer this URL?
 *
 * Four lines rather than `react-router`'s matcher, which this workspace does not
 * depend on: a `:param` segment matches exactly one non-empty segment and every
 * other segment matches itself. That is the whole of the grammar these twelve
 * declarations use, and a pattern shape outside it would fail the equality in
 * the admin half rather than passing quietly here.
 */
function routeAnswers(pattern: string, url: string): boolean {
  const left = pattern.split('/');
  const right = url.split('/');
  if (left.length !== right.length) return false;
  return left.every((segment, index) =>
    segment.startsWith(':') ? (right[index] ?? '').length > 0 : segment === right[index],
  );
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
    module: 'catalog',
    actions: ['new-product', 'open-attributes', 'open-categories', 'open-products'],
    axis: 'platform-unavailable',
    admin: catalogAdmin,
  },
  {
    module: 'orders',
    actions: ['open-orders', 'order-statuses'],
    axis: 'platform-unavailable',
    admin: ordersAdmin,
  },
];

describe('batch 15 contributes no palette action while off (Constitution XVII item 5)', () => {
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
      //
      // Matched against the route **patterns** rather than against a set of
      // paths — see the header: `new-product` targets `/catalog/products/new`,
      // which `/catalog/products/:id` answers and no literal declaration does.
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      const actions = manifest?.actions ?? [];
      expect(actions.map((action) => action.id).sort()).toEqual([...subject.actions]);
      for (const action of actions) {
        const target = (subject.admin.routes ?? []).find((route) =>
          routeAnswers(route.path, action.targetRoute),
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
      // `check:action-route-permissions`' own reading. **The exception is
      // derived, never listed**: an owner may deliberately advertise an
      // *operation* rather than a screen, and `ACTION_PERMISSION_DISAGREEMENTS`
      // is where that decision is recorded once. Reading that ledger here rather
      // than writing an id into this file means the day an owner decides, this
      // case tightens in the same merge request that empties the entry.
      //
      // `new-product` is the reason that matters here: it advertises
      // `catalog:write` for a form the `catalog:read` route opens, which is a
      // *widening* rather than a 403 — holding the write code and not the read
      // code is a role nobody grants, and the ledger is where an owner would say
      // so if they disagreed.
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      for (const action of manifest?.actions ?? []) {
        if (`${subject.module}:${action.id}` in ACTION_PERMISSION_DISAGREEMENTS) continue;
        const target = (subject.admin.routes ?? []).find((route) =>
          routeAnswers(route.path, action.targetRoute),
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
    // row that says its axis is the other one. **Both of this batch's two are
    // locked**, which is a first for this drain and is why the assertion is
    // written as a comparison rather than as a constant: the day either lock is
    // lifted, the axis this file drives is the wrong one and it says so here.
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

  it('the three new advertisements are the manifest’s, with the deleted rows’ copy', () => {
    // The batch's three *new* actions, held to the thing that makes each a move
    // rather than a product change: each carries the destination, the code and
    // the keywords its `PALETTE_ITEMS` row carried, so an operator's ⌘K answer
    // for `produkty` or `kategorie` is what it was — except that it is now
    // resolved against the effective enabled-set, which is what the first case
    // above proves.
    const actionOf = (moduleId: string, actionId: string) =>
      (
        REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === moduleId)?.manifest.actions ?? []
      ).find((entry) => entry.id === actionId);

    const expected: readonly (readonly [string, string, readonly string[]])[] = [
      ['open-products', '/catalog/products', ['products', 'catalog', 'produkty', 'katalog']],
      ['open-categories', '/catalog/categories', ['category', 'categories', 'kategorie']],
      ['open-attributes', '/catalog/attributes', ['attribute', 'attributes', 'atrybuty']],
    ];
    for (const [id, route, keywords] of expected) {
      const action = actionOf('catalog', id);
      expect(action?.targetRoute, id).toBe(route);
      expect(action?.requiredPermission, id).toBe('catalog:read');
      for (const keyword of keywords) {
        expect(action?.keywords, `${id}: ${keyword}`).toContain(keyword);
      }
    }
  });

  it('orders advertises its two screens once, having had a row it already declared', () => {
    // The other module, and the case that says why it needed nothing: both of
    // its actions predate this batch and name two of the four routes its
    // `./admin` layer now declares, so the conversion moved a sidebar and
    // deleted a duplicate palette row. Asserted rather than assumed, because
    // "we changed nothing" is the claim that goes stale without a test.
    const manifest = REGISTERED_MANIFESTS.find(
      (entry) => entry.manifest.id === 'orders',
    )?.manifest;
    const byId = new Map((manifest?.actions ?? []).map((action) => [action.id, action]));
    expect(byId.get('open-orders')?.targetRoute).toBe('/orders');
    expect(byId.get('order-statuses')?.targetRoute).toBe('/orders/statuses');
    for (const id of ['open-orders', 'order-statuses']) {
      expect(byId.get(id)?.requiredPermission, id).toBe('orders:read');
    }
  });

  it('the order-entry route takes the write code the sidebar row advertised', () => {
    // The batch's one operator-visible tightening, read on the declaration that
    // makes it. `/orders/new` was `App.tsx`'s and therefore ungated while the
    // sidebar row that advertised it carried `orders:write` and the
    // `order.entry.tabs` contribution P4d declared carried the same code. No
    // manifest action targets it — `orders` never declared one — so this is the
    // route and the zone agreeing, which is the pair that can disagree.
    const route = (ordersAdmin.routes ?? []).find((entry) => entry.path === '/orders/new');
    expect(route?.requiredPermission).toBe('orders:write');
    const tab = (ordersAdmin.zones ?? []).find((entry) => entry.zone === 'order.entry.tabs');
    expect(tab?.requiredPermission).toBe('orders:write');
  });

  it('neither module advertises a route it does not own', () => {
    // A palette row pointing into another module's surface is an advertisement
    // whose withdrawal nobody controls. Every action of every subject has to
    // land on a path that module's own `./admin` layer answers.
    for (const subject of SUBJECTS) {
      const manifest = REGISTERED_MANIFESTS.find(
        (entry) => entry.manifest.id === subject.module,
      )?.manifest;
      const patterns = (subject.admin.routes ?? []).map((route) => route.path);
      for (const action of manifest?.actions ?? []) {
        expect(
          patterns.some((pattern) => routeAnswers(pattern, action.targetRoute)),
          `${subject.module}: ${action.targetRoute}`,
        ).toBe(true);
      }
    }
  });
});
