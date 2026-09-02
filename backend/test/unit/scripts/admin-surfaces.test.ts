/**
 * `scripts/lib/admin-surfaces.ts` — where the admin keeps its module surfaces,
 * and whose each one is (feature 091, Phase 0).
 *
 * Two halves, and they fail differently. The **location** half is a derivation
 * with two refusals of its own — zero members declaring the source alias and
 * two — in the idiom `findManifestIndex` established, because picking one of an
 * ambiguous pair narrows every walk to it without saying so. The
 * **attribution** half is the one the boundary check's shards rest on, and the
 * case that makes it necessary is real rather than hypothetical: `warehouses`
 * is not a module id and `AppShell.tsx` attributes `/warehouses` to
 * `module: 'inventory'`.
 *
 * The last block is about this repository. It is the only place that asserts
 * the derivation lands where the tree actually keeps things, so a rename of the
 * alias, of `App.tsx` or of `AppShell.tsx` fails here rather than turning a
 * check silently green.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_SOURCE_ALIAS,
  AdminLayoutUnresolvableError,
  adminModuleDirectories,
  findAdminModuleRoot,
  adminNavEntries,
  adminRoutes,
  aliasTargetOf,
  findAliasMember,
  resolveAdminSurfaces,
  routeComponentDirectories,
} from '../../../scripts/lib/admin-surfaces.js';
import { nodeWorkspaceFs, workspaceMembers, type WorkspaceMember } from '../../../scripts/lib/workspace-packages.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

function member(name: string, dir: string): WorkspaceMember {
  return { name, dir, manifest: { name } } as WorkspaceMember;
}

const ALIASED = `{
  // A tsconfig in this repository carries comments, so JSON.parse refuses one.
  "compilerOptions": { "paths": { "${ADMIN_SOURCE_ALIAS}": ["./src/*"] } }
}`;

describe('finding the frontend member', () => {
  it('answers with the one member declaring the source alias', () => {
    const found = findAliasMember(
      [member('backend', '/w/backend'), member('admin', '/w/admin')],
      (path) => (path === '/w/admin/tsconfig.json' ? ALIASED : null),
    );
    expect(found.member.name).toBe('admin');
    expect(found.target).toBe('src');
  });

  it('refuses a workspace where no member declares it', () => {
    expect(() => findAliasMember([member('backend', '/w/backend')], () => null)).toThrow(
      AdminLayoutUnresolvableError,
    );
  });

  it('refuses a workspace where two members declare it', () => {
    // An ambiguous root narrows every scan to whichever sorted first, which is
    // the refusal `findManifestIndex` already makes for the manifest index.
    expect(() =>
      findAliasMember([member('admin', '/w/admin'), member('panel', '/w/panel')], () => ALIASED),
    ).toThrow(/2 workspace members/);
  });

  it('reads the alias out of a tsconfig carrying comments', () => {
    expect(aliasTargetOf(ALIASED)).toBe('src');
    expect(aliasTargetOf('{ "compilerOptions": {} }')).toBeNull();
  });
});

describe('reading the two host registries', () => {
  const APP = [
    "import { BlogList } from './modules/blog/BlogList.js';",
    "import { WarehouseEditor } from './modules/warehouses/WarehouseEditor.js';",
    "import { HomePage } from './modules/home/HomePage.js';",
    'export function App() {',
    '  return (<Routes>',
    '    <Route path="/blog" element={<BlogList />} />',
    '    <Route path="/warehouses/:id" element={<WarehouseEditor />} />',
    '    <Route path="/" element={<HomePage />} />',
    '  </Routes>);',
    '}',
  ].join('\n');

  it('reads every <Route> with its path and its component', () => {
    const routes = adminRoutes(APP);
    expect(routes.map((route) => route.path)).toEqual(['/blog', '/warehouses/:id', '/']);
    expect(routes[1]?.component).toBe('WarehouseEditor');
  });

  it('reads a route whose element is not a component as carrying none', () => {
    // `<Route path="/settings/x" element={<Navigate to="/y" replace />} />` is
    // a redirect; it renders no module's screen and must not be attributed to
    // whichever directory happens to export `Navigate`.
    const routes = adminRoutes('<Route path="/x" element={<Navigate to="/y" replace />} />');
    expect(routes[0]?.component).toBe('Navigate');
  });

  it('maps a component to the surface directory App.tsx imports it from', () => {
    const directories = routeComponentDirectories(APP, 'modules');
    expect(directories.get('BlogList')).toBe('blog');
    expect(directories.get('WarehouseEditor')).toBe('warehouses');
  });

  it('reads a nav entry as an object carrying both `to` and `module`', () => {
    // Object literals rather than members of a constant named `NAV`, so a
    // second nav array is in the population by construction.
    const nav = adminNavEntries(
      [
        'const NAV = [',
        "  { to: '/blog', labelKey: 'x', icon: Rss, module: 'blog' },",
        "  { to: '/', labelKey: 'y', icon: Home, module: null },",
        "  { labelKey: 'not a nav entry', module: 'blog' },",
        '];',
      ].join('\n'),
    );
    expect(nav.map((entry) => [entry.to, entry.module])).toEqual([
      ['/blog', 'blog'],
      ['/', null],
    ]);
  });
});

/**
 * The admin module root — **absence is a measurement, ambiguity is blindness**
 * (feature 091, Phase 5 T1; `contracts/admin-kit-surface.md` §7.2 R16).
 *
 * The predicate's two inputs are proved present before it is evaluated: the
 * source root is refused by {@link resolveAdminSurfaces} when the alias member
 * is missing, ambiguous or points at nothing, and the registered id set is
 * refused by `requireModuleLayout` when there is no manifest index. So *"no
 * directory under the source root is named after a registered module"* is an
 * answer three artefacts with three authors give together — the tsconfig alias,
 * the generated manifest index and the filesystem — and it flips back by itself
 * the day a module directory reappears.
 *
 * **Two** roots is still a throw, and for the reason it always was: picking one
 * narrows every walk to it without saying so.
 *
 * Each case is a real directory tree, because the derivation reads the
 * filesystem; a fixture handed a half-computed root could not prove which
 * directories it opens (issue #130).
 */
describe('the admin module root', () => {
  const trees: string[] = [];

  afterEach(() => {
    while (trees.length > 0) rmSync(trees.pop()!, { recursive: true, force: true });
  });

  function sourceTree(directories: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'admin-surfaces-'));
    trees.push(root);
    for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
    return root;
  }

  it('answers the one directory holding a child named after a registered module', () => {
    const root = sourceTree(['modules/blog', 'components']);
    expect(findAdminModuleRoot(root, new Set(['blog']))).toBe(join(root, 'modules'));
  });

  it('answers null when no directory is named after a registered module', () => {
    // The terminal state this feature exists to reach: `admin/src/modules/`
    // holds `cms_pages`, `home`, `platform` and `profile`, none of them a
    // registered id. A refusal here would send a reader to repair a tree that
    // is finished.
    const root = sourceTree(['modules/cms_pages', 'modules/home', 'modules/platform', 'components']);
    expect(findAdminModuleRoot(root, new Set(['blog', 'cms']))).toBeNull();
  });

  it('answers again the day a module directory reappears', () => {
    // The property a written-down "drain complete" flag would not have.
    const root = sourceTree(['modules/home', 'screens/blog']);
    expect(findAdminModuleRoot(root, new Set(['blog']))).toBe(join(root, 'screens'));
  });

  it('still refuses two, because ambiguity is blindness rather than a measurement', () => {
    const root = sourceTree(['modules/blog', 'screens/cms']);
    expect(() => findAdminModuleRoot(root, new Set(['blog', 'cms']))).toThrow(
      AdminLayoutUnresolvableError,
    );
  });
});

describe('which module owns a surface directory', () => {
  const routes = [
    { path: '/warehouses', component: 'WarehousesList', line: 1 },
    { path: '/warehouses/new', component: 'WarehouseEditor', line: 2 },
    { path: '/nowhere', component: 'OrphanPage', line: 3 },
  ];
  const componentDirectories = new Map([
    ['WarehousesList', 'warehouses'],
    ['WarehouseEditor', 'warehouses'],
    ['OrphanPage', 'cms_pages'],
  ]);

  it('takes a directory named after a registered module as that module', () => {
    const owners = adminModuleDirectories({
      directories: ['blog'],
      registered: new Set(['blog']),
      routes: [],
      nav: [],
      componentDirectories: new Map(),
    });
    expect(owners.get('blog')).toBe('blog');
  });

  it('takes a directory the nav attributes elsewhere as that module', () => {
    // The real case, and the one a `basename` attribution gets silently wrong.
    const owners = adminModuleDirectories({
      directories: ['warehouses'],
      registered: new Set(['inventory']),
      routes,
      nav: [{ to: '/warehouses', module: 'inventory', line: 1 }],
      componentDirectories,
    });
    expect(owners.get('warehouses')).toBe('inventory');
  });

  it('joins a child route to the nav entry it sits under', () => {
    // `/warehouses/new` is a route and never its own sidebar row, so an exact
    // match alone would attribute the directory only through its landing route.
    const owners = adminModuleDirectories({
      directories: ['warehouses'],
      registered: new Set(['inventory']),
      routes: [routes[1]!],
      nav: [{ to: '/warehouses', module: 'inventory', line: 1 }],
      componentDirectories,
    });
    expect(owners.get('warehouses')).toBe('inventory');
  });

  it('leaves a directory no nav entry claims host-owned', () => {
    // `cms_pages` is the live instance: nothing under `admin/` imports its one
    // component, so no route renders it and no nav entry claims it. Attributing
    // it by name would be a mapping written down, which is D-100 exactly.
    const owners = adminModuleDirectories({
      directories: ['cms_pages', '_shared', 'home', 'platform', 'profile'],
      registered: new Set(['cms', 'inventory']),
      routes,
      nav: [{ to: '/warehouses', module: 'inventory', line: 1 }],
      componentDirectories,
    });
    expect([...owners.keys()]).toEqual([]);
  });

  it('leaves a directory whose nav entry names an unregistered module host-owned', () => {
    const owners = adminModuleDirectories({
      directories: ['warehouses'],
      registered: new Set(['cms']),
      routes,
      nav: [{ to: '/warehouses', module: 'gone_module', line: 1 }],
      componentDirectories,
    });
    expect(owners.has('warehouses')).toBe(false);
  });
});

describe('this repository', () => {
  it('resolves the admin surfaces where the tree keeps them', async () => {
    const layout = await requireModuleLayout('[admin-surfaces-test]');
    const members = workspaceMembers(layout.repoRoot, nodeWorkspaceFs());
    const admin = resolveAdminSurfaces(members, new Set(layout.registeredIds));

    expect(admin.sourceRoot.endsWith('/admin/src')).toBe(true);
    expect(admin.aliasPrefix).toBe('@/');
    // The floors that survive the drain, and they are the ones a check rests
    // on: `sourceRoot` classifies a reach, `aliasPrefix` is what makes an
    // `aliased-reach` recognisable, and the route table and the nav are what
    // the host-route assertion reads. `moduleRoot` is deliberately **not**
    // among them — it is `null` in the terminal state (R16), which is the
    // measurement the block below asserts.
    expect(admin.routes.length).toBeGreaterThan(0);
    expect(admin.nav.length).toBeGreaterThan(0);
    expect(admin.registryFiles).toHaveLength(2);
  });

  it('answers null for the module root, an empty attribution, and no orphan', async () => {
    // SC-007's terminal state, asserted rather than inferred. The three
    // fields move together — a module root that is `null` has no directories
    // to list and no components to attribute — and each of them is a
    // measurement, not a failure: the alias resolved, `App.tsx` and
    // `AppShell.tsx` were read, and the manifest index yielded its ids.
    //
    // **This is a two-way assertion.** A module surface directory reappearing
    // under `admin/src` fails here, which is the moment somebody has to decide
    // whether it belongs to the admin application or to a module's package.
    const layout = await requireModuleLayout('[admin-surfaces-test]');
    const admin = await layout.adminSurfaces();
    expect(admin).not.toBeNull();
    expect(admin!.moduleRoot).toBeNull();
    expect(admin!.directories).toEqual([]);
    expect([...admin!.moduleOfDirectory]).toEqual([]);
    expect([...admin!.componentDirectories]).toEqual([]);
  });

  it('carries no refusal reason while the layout resolves', async () => {
    // R17's other direction: the reason is non-null **exactly** when the
    // layout is `null`, so a caller that prints it can never print a stale
    // sentence over a resolved layout.
    const layout = await requireModuleLayout('[admin-surfaces-test]');
    expect(await layout.adminSurfaces()).not.toBeNull();
    expect(await layout.adminSurfacesRefusal()).toBeNull();
  });

  it('leaves the admin application\'s own directories unattributed', async () => {
    // The four directories `admin/src/modules/` still holds. None is a
    // registered module id, which is why the module root is `null`; each is
    // therefore host-owned by the derivation rather than by a list, and
    // `moduleOfDirectory` — empty — claims none of them.
    const layout = await requireModuleLayout('[admin-surfaces-test]');
    const admin = await layout.adminSurfaces();
    for (const directory of ['cms_pages', 'home', 'platform', 'profile']) {
      expect(admin?.moduleOfDirectory.has(directory)).toBe(false);
    }
  });

  it('attributes no directory to anything that is not a registered module', async () => {
    // Vacuous today and deliberately kept: it is the assertion that catches a
    // surface directory reappearing under an owner the manifest index does not
    // know, which is the one way `moduleOfDirectory` can grow a wrong entry.
    const layout = await requireModuleLayout('[admin-surfaces-test]');
    const admin = await layout.adminSurfaces();
    const registered = new Set(layout.registeredIds);
    for (const owner of admin!.moduleOfDirectory.values()) {
      expect(registered.has(owner)).toBe(true);
    }
  });
});
