import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contributions as cmsAdmin } from '@endora-commerce/mod-cms/admin';
import { contributions as blogAdmin } from '@endora-commerce/mod-blog/admin';
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
import { resolveAdminSurfaces } from '../../../scripts/lib/admin-surfaces.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { nodeWorkspaceFs, workspaceMembers } from '../../../scripts/lib/workspace-packages.js';

/**
 * The **server-side** half of feature 091 batch 16's off-state proof — the
 * command palette, for the two modules that close the drain: `cms` and `blog`.
 *
 * ## Why this is here and not in the admin
 *
 * The palette's Actions group is resolved by the server, from the manifests,
 * against the effective enabled-set. No admin-side test can see it, which is
 * why every batch of this drain has paired an admin file with a backend one.
 * `admin/test/modules/batch-sixteen-surfaces.module-owned-surface.test.tsx` is
 * the other half and drives the routes, the sidebar and the contribution set.
 *
 * ## No palette row left the shell, and that is the batch's simplest fact
 *
 * `PALETTE_ITEMS` in `admin/src/components/AppShell.tsx` never carried a row
 * for either module: `cms` has declared `new-page` and `blog` `new-post` for as
 * long as the palette has been served from the manifests. So there is nothing
 * to convert here and nothing to invent — which is `assets_library`' shape from
 * batch 9 rather than `dictionaries`' from batch 10 — and the whole of what
 * this file adds is the proof that both advertisements are now withdrawn with
 * the module, and that each names a route its own `./admin` layer declares.
 *
 * ## The pairing this batch is the first to be able to make sharply
 *
 * Both actions advertise a **create** route under the write code, and both
 * create routes are declared on that same code in this merge request. Until
 * now those five routes were `App.tsx`'s and therefore ungated, so the
 * advertisement could not disagree with anything: the pairing case below had no
 * declaration to compare against. It has one now, and the equality it asserts
 * is what makes the tightening a decision rather than a typo — see the header
 * of `packages/modules/blog/src/admin/index.ts` for why it is forced.
 *
 * ## Both modules are switchable, so both drive the operator axis
 *
 * Neither declares `activation.nonDeactivatable` — `cms` declares
 * `cms.enabled` and `blog` declares `blog.activation` — so `deactivated` is the
 * axis an operator can actually reach for both, and it is the one driven. The
 * lock is read off the manifests in a case of its own rather than restated
 * here, so a module locked one day fails there instead of quietly keeping a
 * table row that says its axis is the other one.
 */

/**
 * Does holding `code` alone satisfy `requirement`?
 *
 * The kit publishes exactly this as `satisfiesPermission` on
 * `@endora-commerce/admin-kit/lib`, and importing it here would be wrong for a
 * reason that is structural rather than stylistic: `paths` puts that subpath's
 * **source** in the backend's `tsc` program, and it is a React barrel. The
 * `contributions` subpath is type-only and is imported above for the same
 * reason in reverse. Four lines rather than a duplicated rule: the union's own
 * shape is what the two branches follow.
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
  { module: 'cms', actions: ['new-page'], axis: 'deactivated', admin: cmsAdmin },
  { module: 'blog', actions: ['new-post'], axis: 'deactivated', admin: blogAdmin },
];

describe('batch 16 contributes no palette action while off (Constitution XVII item 5)', () => {
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
      // **This is the case that forced the batch's one tightening.** Both
      // actions advertise a create route under the write code. Declaring those
      // routes on the read code — which is what every other screen in both
      // modules takes — would have failed here, and correctly: holding
      // `cms.write` alone does not satisfy a `cms.read` gate, the codes being
      // opaque strings. The repair was the route, not the assertion.
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
    // row that says its axis is the other one. Both of this batch's two are
    // switchable, which is why both drive the operator axis.
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

  it('the five create routes take the write code, at both ends of the seam', () => {
    // The batch's one operator-visible tightening, read across the seam and per
    // route rather than per module: the two the actions advertise **and** the
    // three they do not. An equality over the advertised pair alone would pass
    // with the other three left on the read code, which is the half-applied
    // state that produces a `/cms/blocks/new` a read-only operator can open and
    // not save.
    const CREATE_ROUTES: readonly (readonly [
      module: string,
      path: string,
      code: string,
    ])[] = [
      ['cms', '/cms/pages/new', 'cms.write'],
      ['cms', '/cms/blocks/new', 'cms.write'],
      ['cms', '/cms/templates/new', 'cms.write'],
      ['blog', '/blog/posts/new', 'blog.write'],
      ['blog', '/blog/categories/new', 'blog.write'],
    ];
    const adminOf = new Map(SUBJECTS.map((subject) => [subject.module, subject.admin]));
    for (const [module, path, code] of CREATE_ROUTES) {
      const route = (adminOf.get(module)?.routes ?? []).find((entry) => entry.path === path);
      expect(route?.requiredPermission, path).toBe(code);
    }
    // And the advertisement's end, for the two the manifests name.
    const actionOf = (moduleId: string, actionId: string) =>
      (
        REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === moduleId)?.manifest.actions ?? []
      ).find((entry) => entry.id === actionId);
    expect(actionOf('cms', 'new-page')?.requiredPermission).toBe('cms.write');
    expect(actionOf('cms', 'new-page')?.targetRoute).toBe('/cms/pages/new');
    expect(actionOf('blog', 'new-post')?.requiredPermission).toBe('blog.write');
    expect(actionOf('blog', 'new-post')?.targetRoute).toBe('/blog/posts/new');
  });

  it('neither module advertises a route it does not own', () => {
    // A palette row pointing into another module's surface is an advertisement
    // whose withdrawal nobody controls. Every action of every subject has to
    // land on a path that module's own `./admin` layer declares — which for this
    // batch is worth asserting rather than assuming, because `blog` renders a
    // component `cms` publishes and a screen borrowed that way is exactly the
    // shape that tempts a borrowed advertisement.
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

  it('neither module had a hand-written palette row for this batch to convert', async () => {
    // The claim the header makes, asserted rather than left as prose. Batches
    // 10, 13 and 14 each moved a `PALETTE_ITEMS` row into a manifest action
    // because a hand-written row is a copy the server was never asked about;
    // these two never had one, so "we changed nothing here" is the statement —
    // and it is the statement that goes stale without a test.
    //
    // **The shell is located, not spelled.** This read
    // `resolve(process.cwd(), '../admin/src/components/AppShell.tsx')`, and
    // feature 110's T120 moved the file into `@endora-commerce/admin-shell`:
    // `readFileSync` threw `ENOENT` and the case stopped being about palette
    // rows at all. That commit moved the estate's own derivation with the files
    // (`AdminSurfaceLayout.shellRoot` / `registryFiles`), so the repair is to
    // ask the same question the checks ask instead of keeping a ninth literal —
    // and `resolveAdminSurfaces` refuses a tree where the pair has gone rather
    // than handing back a path that is not there.
    const layout = await requireModuleLayout('[batch-sixteen-palette-off-state]');
    const admin = resolveAdminSurfaces(
      workspaceMembers(layout.repoRoot, nodeWorkspaceFs()),
      new Set(layout.registeredIds),
    );
    // Of the two hand-written registries the layout returns, the one declaring
    // the palette table — the artefact this case is about, so it is found by
    // what it holds rather than by its name.
    const sources = admin.registryFiles.map((file) => readFileSync(file, 'utf8'));
    const palettes = sources
      .map((source) => /const PALETTE_ITEMS: PaletteItem\[\] = \[([\s\S]*?)\n\];/.exec(source)?.[1])
      .filter((match): match is string => match !== undefined);
    expect(palettes, 'exactly one registry must declare PALETTE_ITEMS').toHaveLength(1);
    const rows = palettes[0]!
      .split('\n')
      .filter((line) => /^\s*\{ group:/.test(line));
    expect(rows.length > 0, 'the palette table must still hold rows').toBe(true);
    for (const subject of SUBJECTS) {
      for (const row of rows) {
        expect(row, subject.module).not.toContain(`module: '${subject.module}'`);
      }
    }
  });
});
