import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanEnforcedPermissionGates } from './permission-inventory.js';

/**
 * The scanner is the only thing standing between "a route is gated on a code"
 * and "that code is grantable on `/admin-roles`". Every shape below is taken
 * from a real call site in `backend/src/modules`; a shape the scanner cannot
 * read is a gate whose code nobody ever checks.
 */

let root: string;

function writeModule(id: string, file: string, source: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), source, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'permission-inventory-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(`${root}-shell`, { recursive: true, force: true });
});

function codes(): string[] {
  return [...scanEnforcedPermissionGates([root]).codes].sort();
}

describe('permission gate scanner — call shapes', () => {
  it('reads a bare call with a string literal', () => {
    writeModule(
      'alpha',
      'routes.admin.ts',
      `app.get('/api/v1/admin/alpha', { preHandler: requireAdmin('alpha:read') }, h);`,
    );
    expect(codes()).toEqual(['alpha:read']);
  });

  it('reads a call reached through a dependency object or a cradle alias', () => {
    writeModule(
      'beta',
      'routes.admin.ts',
      [
        `const gate = deps.requireAdmin('beta:read');`,
        `const other = ctx.cradle.requireAdmin('beta:write');`,
        `const third = cradle().requireAdmin('beta:delete');`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['beta:delete', 'beta:read', 'beta:write']);
  });

  it('reads an optional call and a destructured guard bound to a local name', () => {
    writeModule(
      'gamma',
      'routes.admin.ts',
      [
        `const { requireAdmin } = deps;`,
        `const requireRead = deps.requireAdmin?.('gamma.read') ?? (async () => {});`,
        `const requireWrite = requireAdmin('gamma.write');`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['gamma.read', 'gamma.write']);
  });

  it('reads the any-of array form', () => {
    writeModule(
      'delta',
      'routes.admin.ts',
      `const gate = deps.requireAdminAny(['delta:read', 'delta:write']);`,
    );
    expect(codes()).toEqual(['delta:read', 'delta:write']);
  });

  /**
   * Issue #458 — the Admin UI's any-of. Its literal array is read like
   * `requireAdminAny`'s, as **one** site carrying every member, so the
   * foreign-gate sweep can judge the members as alternatives of each other.
   * The file names no `hasPermission`, which is what the pre-filter used to
   * require before a file was read at all.
   */
  it('reads the Admin UI any-of hasAnyPermission as one site with every member', () => {
    writeModule(
      'delta_ui',
      'references.ts',
      `const canDocuments = canWrite && hasAnyPermission(['orders:read', 'tasks:read']);`,
    );
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites.map((s) => [s.resolution, s.codes])).toEqual([
      ['code', ['orders:read', 'tasks:read']],
    ]);
  });

  /**
   * A narrowing applied to the literal at runtime (`.filter(...)`) leaves its
   * members the widest set the gate can ask for; a string inside the narrowing
   * is not a member.
   */
  it('reads only the array literal of an any-of narrowed at runtime', () => {
    writeModule(
      'delta_narrow',
      'references.ts',
      `const ok = hasAnyPermission(['orders:read', 'tasks:read'].filter((code) => scoped || code !== 'orders:read'));`,
    );
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites.map((s) => [s.resolution, s.codes])).toEqual([
      ['code', ['orders:read', 'tasks:read']],
    ]);
  });

  it('resolves a module-local constant', () => {
    writeModule(
      'epsilon',
      'routes.admin.ts',
      [`const EPS_READ = 'epsilon:read';`, `const gate = requireAdmin(EPS_READ);`].join('\n'),
    );
    expect(codes()).toEqual(['epsilon:read']);
  });

  it('resolves a constant imported from the module manifest', () => {
    writeModule('zeta', 'manifest.ts', `export const ZETA_READ = 'zeta:read';`);
    writeModule(
      'zeta',
      'routes.admin.ts',
      [`import { ZETA_READ } from './manifest.js';`, `const gate = requireAdmin(ZETA_READ);`].join(
        '\n',
      ),
    );
    expect(codes()).toEqual(['zeta:read']);
  });

  it('resolves a member read of a permission map', () => {
    writeModule(
      'eta',
      'permissions.ts',
      `export const ETA_PERMISSIONS = { READ: 'eta:read', WRITE: 'eta:write' } as const;`,
    );
    writeModule(
      'eta',
      'routes.admin.ts',
      [
        `import { ETA_PERMISSIONS } from './permissions.js';`,
        `const readGate = deps.requireAdmin(ETA_PERMISSIONS.READ);`,
        `const writeGate = deps.requireAdmin(ETA_PERMISSIONS.WRITE);`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['eta:read', 'eta:write']);
  });

  it('reads a direct capability check outside the route layer', () => {
    writeModule(
      'theta',
      'backend.ts',
      `const ok = await permissionService.hasPermission(adminUserId, 'theta:rollup');`,
    );
    expect(codes()).toEqual(['theta:rollup']);
  });
});

/**
 * Issue #1105 — the Admin UI writes most of its gates in component files. A
 * `.tsx` file was not part of the walk, so `hasPermission('x')` in a page or a
 * dialog was never read, and a code enforced only there was reported as
 * enforced by no gate.
 */
describe('permission gate scanner — component files', () => {
  it('reads a hasPermission gate written in a .tsx component', () => {
    writeModule(
      'kappa_ui',
      'KappaPage.tsx',
      [
        `export function KappaPage() {`,
        `  const { hasPermission } = useAuth();`,
        `  const canWrite = hasPermission('kappa:write');`,
        `  return <div>{canWrite ? <Button>Save</Button> : null}</div>;`,
        `}`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['kappa:write']);
  });

  it('reads a hasAnyPermission any-of in a .tsx component as one site', () => {
    writeModule(
      'kappa_any',
      'KappaList.tsx',
      `export const List = () => (hasAnyPermission(['kappa:read', 'kappa:write']) ? <ul /> : null);`,
    );
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites.map((s) => [s.resolution, s.codes])).toEqual([
      ['code', ['kappa:read', 'kappa:write']],
    ]);
  });

  /**
   * A JSX closing tag puts a `/` right after a `<`, where the comment blanker
   * would otherwise start a regular-expression literal and blank the rest of
   * the line — and with it a gate written after the tag.
   */
  it('reads a gate written after a JSX closing tag on the same line', () => {
    writeModule(
      'kappa_line',
      'KappaRow.tsx',
      `const row = <td><span>Name</span>{hasPermission('kappa:delete') && <DeleteButton />}</td>;`,
    );
    expect(codes()).toEqual(['kappa:delete']);
  });

  /**
   * A permission looked up in a module-local map keyed at runtime —
   * `hasPermission(OWNER[kind].readPermission)` — reads as the widest set: one
   * site per value the map holds for that property, so every code is checked
   * for grantability. One site each, not one any-of: the gate asks for the code
   * of the row's kind, never for any of them.
   */
  it('reads a computed lookup in a local map as every value of that property', () => {
    writeModule(
      'kappa_map',
      'LinkedRecords.tsx',
      [
        `const OWNER: Readonly<Record<Kind, { module: string; readPermission: string }>> = {`,
        `  order: { module: 'orders', readPermission: 'orders:read' },`,
        `  opportunity: { module: 'crm', readPermission: 'crm:read' },`,
        `};`,
        `const visible = kinds.filter((kind) => hasPermission(OWNER[kind].readPermission));`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites.map((s) => [s.resolution, s.codes])).toEqual([
      ['code', ['orders:read']],
      ['code', ['crm:read']],
    ]);
  });

  it('marks a UI permission check in an admin layer as a control, and nothing else', () => {
    writeModule('kappa_surface/src/admin', 'Page.tsx', `const a = hasPermission('kappa:read');`);
    writeModule('kappa_surface/src/backend', 'routes.ts', `requireAdmin('kappa:write');`);
    writeModule('kappa_surface/src/backend', 'service.ts', `await permissionService.hasPermission(actor, 'kappa:rollup');`);
    const result = scanEnforcedPermissionGates([root]);
    expect(
      result.sites.map((s) => [s.codes[0], s.surface]).sort(),
    ).toEqual([
      ['kappa:read', 'admin-control'],
      ['kappa:rollup', 'enforcement'],
      ['kappa:write', 'enforcement'],
    ]);
  });

  it('ignores a gate written in a *.test.tsx', () => {
    writeModule('kappa_test', 'KappaPage.test.tsx', `hasPermission('kappa:fixture');`);
    expect(codes()).toEqual([]);
  });
});

/**
 * Issue #1106 — the admin shell is a host root (`moduleId: null`) and an Admin
 * UI layer. Its nav and dashboard tiles declare `requiredPermission` as data,
 * not as a call, so the scanner reads that property there: a string literal is
 * one code, an array literal one any-of site carrying every member.
 */
describe('permission gate scanner — admin shell data', () => {
  // Beside the module root, not inside it: the walk reads a file once, under
  // the first root that reaches it.
  function shell(file: string, source: string): string {
    const dir = join(`${root}-shell`, 'src');
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), source, 'utf8');
    return dir;
  }

  it('reads nav requiredPermission literals as host-owned control sites', () => {
    const dir = shell(
      'components/AppShell.tsx',
      [
        `interface NavItem { requiredPermission?: PermissionRequirement; }`,
        `const items = [`,
        `  { to: '/platform/modules', requiredPermission: 'platform.modules.read', module: null },`,
        `  { to: '/platform/command-hooks', requiredPermission: ['platform.modules.read', 'platform.command_outbox.read'], module: null },`,
        `];`,
        `const forwarded = items.map((item) => ({ requiredPermission: item.requiredPermission }));`,
        `const mayUseAssistant = hasPermission('prompt_actions:use');`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([{ dir, moduleId: null, adminLayer: true }]);
    // Calls first, then data, each in source order. The forwarded value is the
    // declaration written elsewhere, a runtime value (issue #1123); the type is
    // not a site.
    expect(result.sites.map((s) => [s.moduleId, s.surface, s.resolution, s.codes])).toEqual([
      [null, 'admin-control', 'code', ['prompt_actions:use']],
      [null, 'admin-control', 'code', ['platform.modules.read']],
      [null, 'admin-control', 'code', ['platform.modules.read', 'platform.command_outbox.read']],
      [null, 'admin-control', 'runtime-value', []],
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps a declaration that decides whether a route element renders an enforcement site', () => {
    const dir = shell(
      'App.tsx',
      `const routes = [{ path: '/reports', element: <Reports />, requiredPermission: 'reports:read' }];`,
    );
    const result = scanEnforcedPermissionGates([{ dir, moduleId: null, adminLayer: true }]);
    expect(result.sites.map((s) => [s.surface, s.codes])).toEqual([['enforcement', ['reports:read']]]);
  });

  it('reads a dashboard tile carrying the API path it reads from as a control', () => {
    const dir = shell(
      'modules/home/HomePage.tsx',
      `const KPIS = [{ key: 'rfqs', requiredPermission: 'rfqs:handle', path: () => '/api/v1/admin/rfqs' }];`,
    );
    const result = scanEnforcedPermissionGates([{ dir, moduleId: null, adminLayer: true }]);
    expect(result.sites.map((s) => [s.surface, s.codes])).toEqual([['admin-control', ['rfqs:handle']]]);
  });

  it('does not read requiredPermission data outside an admin layer', () => {
    writeModule('lambda', 'index.ts', `export const nav = [{ to: '/l', requiredPermission: 'lambda:read' }];`);
    expect(codes()).toEqual([]);
  });
});

/**
 * Issue #1123 — a module's admin layer (`src/admin/**`) declares its nav
 * entries, routes, zones and visibility checks with `requiredPermission` as
 * data too, and mostly through a constant rather than a literal. Each
 * declaration is one site; an array is one any-of; a spread of a constant
 * array resolves to that array's members; anything else is `unresolved`.
 */
describe('permission gate scanner — module admin data', () => {
  function adminModule(id: string, files: Record<string, string>): string {
    const dir = join(root, id);
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), source, 'utf8');
    }
    return dir;
  }

  function sitesOf(dir: string, moduleId: string): Array<[string, string, string, string[]]> {
    return scanEnforcedPermissionGates([{ dir, moduleId }]).sites.map((s) => [
      s.surface,
      s.resolution,
      s.expression,
      [...s.codes],
    ]);
  }

  it('reads nav literals and module-local constants as control sites', () => {
    const dir = adminModule('mu', {
      'src/admin/index.ts': [
        `const READ_PERMISSION = 'mu:read';`,
        `const PERMS = { WRITE: 'mu:write' } as const;`,
        `export const contributions = {`,
        `  nav: [`,
        `    { to: '/mu', requiredPermission: 'mu:read' },`,
        `    { to: '/mu/a', requiredPermission: READ_PERMISSION },`,
        `    { to: '/mu/b', requiredPermission: PERMS.WRITE },`,
        `    { to: '/mu/c', requiredPermission: ['mu:read', 'orders:read'] },`,
        `  ],`,
        `};`,
      ].join('\n'),
    });
    expect(sitesOf(dir, 'mu')).toEqual([
      ['admin-control', 'code', `'mu:read'`, ['mu:read']],
      ['admin-control', 'code', 'READ_PERMISSION', ['mu:read']],
      ['admin-control', 'code', 'PERMS.WRITE', ['mu:write']],
      ['admin-control', 'code', `['mu:read', 'orders:read']`, ['mu:read', 'orders:read']],
    ]);
  });

  it('resolves a spread of a module-local constant array to one any-of site', () => {
    const dir = adminModule('nu', {
      'src/admin/index.ts': [
        `const READ_PERMISSION: readonly [string, string] = ['customers:read', 'customers:manage'];`,
        `const REQUIRED = [`,
        `  'catalog:read',`,
        `  'orders:read',`,
        `] as const;`,
        `export const contributions = {`,
        `  nav: [{ to: '/nu', requiredPermission: [...READ_PERMISSION] }],`,
        `  other: [{ to: '/nu/x', requiredPermission: [...REQUIRED, 'nu:read'] }],`,
        `  ids: [{ to: '/nu/y', requiredPermission: REQUIRED }],`,
        `};`,
      ].join('\n'),
    });
    expect(sitesOf(dir, 'nu')).toEqual([
      ['admin-control', 'code', '[...READ_PERMISSION]', ['customers:read', 'customers:manage']],
      ['admin-control', 'code', `[...REQUIRED, 'nu:read']`, ['catalog:read', 'orders:read', 'nu:read']],
      ['admin-control', 'code', 'REQUIRED', ['catalog:read', 'orders:read']],
    ]);
  });

  it('resolves a spread of an imported constant array', () => {
    const dir = adminModule('xi', {
      'src/admin/permissions.ts': `export const READ_ANY = ['xi:read', 'xi:manage'] as const;\nexport const ONE = 'xi:one';`,
      'src/admin/index.ts': [
        `import { READ_ANY, ONE as SINGLE } from './permissions.js';`,
        `export const contributions = {`,
        `  nav: [{ to: '/xi', requiredPermission: [...READ_ANY] }, { to: '/xi/1', requiredPermission: SINGLE }],`,
        `};`,
      ].join('\n'),
    });
    expect(sitesOf(dir, 'xi')).toEqual([
      ['admin-control', 'code', '[...READ_ANY]', ['xi:read', 'xi:manage']],
      ['admin-control', 'code', 'SINGLE', ['xi:one']],
    ]);
  });

  it('reports a spread or a constant it cannot resolve as unresolved, never drops it', () => {
    const dir = adminModule('omicron', {
      'src/admin/index.ts': [
        `import { ELSEWHERE } from '@vendor/permissions';`,
        `const MIXED = ['omicron:read', computeCode()];`,
        `export const contributions = {`,
        `  nav: [`,
        `    { to: '/o', requiredPermission: [...ELSEWHERE] },`,
        `    { to: '/o/a', requiredPermission: [...MIXED] },`,
        `    { to: '/o/b', requiredPermission: ['omicron:read', ...ELSEWHERE] },`,
        `    { to: '/o/c', requiredPermission: MISSING },`,
        `  ],`,
        `};`,
      ].join('\n'),
    });
    expect(sitesOf(dir, 'omicron')).toEqual([
      ['admin-control', 'unresolved', '[...ELSEWHERE]', []],
      ['admin-control', 'unresolved', '[...MIXED]', []],
      ['admin-control', 'unresolved', `['omicron:read', ...ELSEWHERE]`, []],
      ['admin-control', 'unresolved', 'MISSING', []],
    ]);
  });

  it('keeps a module route declaration an enforcement site and reads visibility checks as controls', () => {
    const dir = adminModule('pi', {
      'src/admin/index.ts': [
        `const READ = 'pi:read';`,
        `export const contributions = {`,
        `  routes: [{ path: '/pi', component: () => import('./pages/Pi.js'), requiredPermission: READ }],`,
        `  zones: [zoneComponent('order.detail.after', () => import('./zones/Z.js'), { requiredPermission: 'orders:read' })],`,
        `};`,
      ].join('\n'),
      'src/admin/pages/Pi.tsx': `const canWrite = isVisible({ module: 'pi', requiredPermission: 'pi:write' });`,
    });
    expect(sitesOf(dir, 'pi').sort()).toEqual(
      [
        ['enforcement', 'code', 'READ', ['pi:read']],
        ['admin-control', 'code', `'orders:read'`, ['orders:read']],
        ['admin-control', 'code', `'pi:write'`, ['pi:write']],
      ].sort(),
    );
  });

  it('skips a type annotation and reports a forwarded declaration as a runtime value', () => {
    const dir = adminModule('rho', {
      'src/admin/index.ts': [
        `import type { PermissionRequirement } from '@endora-commerce/admin-kit';`,
        `interface Entry { requiredPermission: PermissionRequirement; other: string }`,
        `function Route({ requiredPermission }: { requiredPermission: PermissionRequirement | undefined }) {}`,
        `const forwarded = items.map((item) => ({ requiredPermission: item.requiredPermission }));`,
      ].join('\n'),
    });
    expect(sitesOf(dir, 'rho')).toEqual([
      ['admin-control', 'runtime-value', 'item.requiredPermission', []],
    ]);
  });

  it('reads no requiredPermission data outside the admin layer', () => {
    const dir = adminModule('sigma', {
      'src/manifest.ts': `export const actions = [{ id: 's', requiredPermission: 'sigma:read' }];`,
      'src/backend/index.ts': `export const nav = [{ to: '/s', requiredPermission: 'sigma:read' }];`,
    });
    expect(sitesOf(dir, 'sigma')).toEqual([]);
  });
});

describe('permission gate scanner — a test is not an enforcement site', () => {
  // Feature 106 moved every co-located test into `packages/modules/<id>/src/`,
  // which is inside this scanner's walk. This file is one of them, and its
  // fixtures are deliberately fake codes — so before the exclusion the scanner
  // read them as real gates and the contract test went red on `master` with 18
  // codes "enforced but not grantable". The rule is about what the file *is*,
  // not where it sits: a gate written in a test guards nothing an operator can
  // reach.
  it('ignores a gate written in a *.test.ts beside the module sources', () => {
    writeModule('alpha', 'routes.admin.ts', `requireAdmin('alpha:read');`);
    writeModule('alpha', 'routes.admin.test.ts', `requireAdmin('alpha:fixture');`);
    expect(codes()).toEqual(['alpha:read']);
  });

  it('ignores a *.spec.ts too, and a test that is the only file in the module', () => {
    writeModule('beta', 'beta.spec.ts', `requireAdmin('beta:fixture');`);
    expect(codes()).toEqual([]);
  });

  it('still reads a source file whose name merely contains "test"', () => {
    // The predicate is the `.test.`/`.spec.` suffix, not the substring — a
    // module legitimately named for testing infrastructure keeps its gates.
    writeModule('gamma', 'test-harness-routes.ts', `requireAdmin('gamma:read');`);
    expect(codes()).toEqual(['gamma:read']);
  });
});

describe('permission gate scanner — shapes that carry no code', () => {
  it('ignores a mention inside a comment', () => {
    writeModule(
      'iota',
      'routes.admin.ts',
      [
        `/** Gated by requireAdmin('iota:phantom') — documentation only. */`,
        `// requireAdmin('iota:other')`,
        `const gate = requireAdmin('iota:real');`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['iota:real']);
  });

  it('classifies an argument-less gate as authenticated-admin rather than a code', () => {
    writeModule('kappa', 'routes.admin.ts', `app.get(p, { preHandler: deps.requireAdmin() }, h);`);
    const result = scanEnforcedPermissionGates([root]);
    expect([...result.codes]).toEqual([]);
    expect(result.authenticatedAdminOnly).toHaveLength(1);
    expect(result.unresolved).toEqual([]);
  });

  it('classifies a delegating re-registration as a runtime value, not as a code', () => {
    writeModule(
      'lambda',
      'backend.ts',
      [
        `ctx.di.providePort('requireAdmin', () => ({`,
        `  requireAdmin: (permission) => async (req, reply) =>`,
        `    cradle().requireAdmin(permission)(req, reply),`,
        `  requireAdminAny: (permissions) => async (req, reply) =>`,
        `    cradle().requireAdminAny(permissions)(req, reply),`,
        `}));`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([root]);
    expect([...result.codes]).toEqual([]);
    expect(result.runtimeValue).toHaveLength(2);
    expect(result.unresolved).toEqual([]);
  });

  it('classifies a guard implementation consuming its own parameter or loop variable', () => {
    writeModule(
      'nu_guard',
      'require-admin.ts',
      [
        `export function createRequireAdmin({ permissionService }) {`,
        `  return (permission?: string) => async (request) => {`,
        `    const ok = await permissionService.hasPermission(actor.adminUserId, permission);`,
        `  };`,
        `}`,
        `export function createRequireAdminAny({ permissionService }) {`,
        `  return (codes) => async (request) => {`,
        `    for (const code of codes) {`,
        `      if (await permissionService.hasPermission(actor.adminUserId, code)) return;`,
        `    }`,
        `  };`,
        `}`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([root]);
    expect([...result.codes]).toEqual([]);
    expect(result.runtimeValue).toHaveLength(2);
    expect(result.unresolved).toEqual([]);
  });

  it('classifies a code read off a registry entry as a runtime value', () => {
    writeModule(
      'xi',
      'plan-executor.service.ts',
      [
        `const tool = this.registry.get(op.toolId);`,
        `if (tool && !(await visibility.hasPermission(tool.requiredPermission))) throw e;`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([root]);
    expect([...result.codes]).toEqual([]);
    expect(result.runtimeValue.map((s) => s.expression)).toEqual(['tool.requiredPermission']);
  });

  it('ignores a parameter list in the guard signature', () => {
    writeModule(
      'omicron',
      'require-admin.port.ts',
      [
        `export interface RequireAdminFactory {`,
        `  (code: string): preHandlerHookHandler;`,
        `}`,
        `export interface AdminPermissionChecker {`,
        `  hasPermission(adminUserId: string, permission: string): Promise<boolean>;`,
        `}`,
      ].join('\n'),
    );
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites).toEqual([]);
  });

  it('ignores a matcher written as a regular-expression literal', () => {
    writeModule(
      'pi',
      'scanner.ts',
      [
        `const callRe = /requireAdmin(?:Any)?\\s*\\(/g;`,
        `const gate = requireAdmin('pi:read');`,
      ].join('\n'),
    );
    expect(codes()).toEqual(['pi:read']);
  });

  it('reports a gate whose argument it cannot resolve instead of dropping it', () => {
    writeModule('mu', 'routes.admin.ts', `const gate = requireAdmin(unboundElsewhere);`);
    const result = scanEnforcedPermissionGates([root]);
    expect([...result.codes]).toEqual([]);
    expect(result.unresolved.map((s) => s.expression)).toEqual(['unboundElsewhere']);
  });
});

describe('permission gate scanner — attribution', () => {
  it('attributes each gate to the module directory that owns the file', () => {
    writeModule('nu', 'routes.admin.ts', `const gate = requireAdmin('nu:read');`);
    const result = scanEnforcedPermissionGates([root]);
    expect(result.sites.map((s) => s.moduleId)).toEqual(['nu']);
  });
});
