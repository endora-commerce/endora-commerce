import { describe, expect, it } from 'vitest';

import {
  analyse,
  findAdminRoutes,
  isSufficient,
  resolveTarget,
  type ActionRecord,
} from '../../../scripts/check-action-route-permissions.js';
import { spawnSync } from 'node:child_process';
import { statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMovedModuleTreeFixture,
  KEPT_MODULE,
} from '../../helpers/moved-module-tree-fixture.js';
import { createEmittingPackageFixture } from '../../helpers/emitted-freshness-fixture.js';
import {
  checkEmittedFreshness,
  emittingPackages,
  freshnessRefusal,
  rootExportOf,
} from '../../../scripts/lib/emitted-freshness.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_ROOT = join(REPO_ROOT, 'backend');

/**
 * The shapes `check-action-route-permissions` claims to refuse, and the ones it
 * claims not to (issue #232).
 *
 * The check answers a question two existing sweeps cannot: not "is this code
 * real" (`permission-inventory.test.ts`, both directions) but "is this code the
 * one enforced on **this action's** target". Both defects that produced it —
 * `settings:open-settings` declaring nothing, `inventory:open-inventory`
 * declaring `catalog:write` against an `orders:read` route — were green in the
 * set sweeps, because both codes were real, declared and enforced somewhere.
 *
 * Every fixture below is source text: the route half of the comparison is read
 * out of a Fastify registration, and a test handing over a ready-made route
 * record would prove the comparison while leaving the gate reading — where all
 * the spellings live — unproven.
 */

const ROUTES_FILE = 'modules/inventory/routes.admin.ts';

function sources(text: string, file = ROUTES_FILE): Map<string, string> {
  return new Map([[file, text]]);
}

function action(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    moduleId: 'inventory',
    actionId: 'open-inventory',
    targetRoute: '/inventory',
    requiredPermission: 'orders:read',
    ...overrides,
  };
}

describe('check-action-route-permissions — the three findings', () => {
  const gatedList = `
    app.get('/api/v1/admin/inventory', { preHandler: requireAdmin('orders:read') }, handler);
  `;

  it('reports an action that declares no code while its target enforces one', () => {
    const result = analyse({
      sources: sources(gatedList),
      actions: [{ moduleId: 'inventory', actionId: 'open-inventory', targetRoute: '/inventory' }],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('missing');
    expect(result.findings[0]?.enforced).toBe('orders:read');
    expect(result.findings[0]?.declared).toBeNull();
  });

  it('reports an action whose code is a real code enforced on another route', () => {
    // The `inventory` defect exactly: `catalog:write` is a real, declared,
    // enforced code — which is why both directions of the set sweep passed it.
    const result = analyse({
      sources: sources(gatedList),
      actions: [action({ requiredPermission: 'catalog:write' })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('mismatched');
    expect(result.findings[0]?.enforced).toBe('orders:read');
    expect(result.findings[0]?.where).toContain('GET /api/v1/admin/inventory');
  });

  it('reports a target route no registration corresponds to', () => {
    const result = analyse({
      sources: sources(gatedList),
      actions: [action({ actionId: 'open-ghost', targetRoute: '/ghost', moduleId: 'ghosts' })],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('unresolvable');
    expect(result.findings[0]?.where).toContain('no /api/v1/admin route corresponds');
  });

  it('reports candidates that disagree rather than picking one of them', () => {
    const result = analyse({
      sources: sources(`
        app.get('/api/v1/admin/platform/modules/state', { preHandler: requireAdmin('platform.modules.read') }, handler);
        app.get('/api/v1/admin/platform/modules/presence', { preHandler: requireAdmin() }, handler);
      `),
      actions: [
        action({
          moduleId: '_lifecycle',
          actionId: 'open-platform-modules',
          targetRoute: '/platform/modules',
          requiredPermission: 'platform.modules.read',
        }),
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('unresolvable');
    expect(result.findings[0]?.enforced).toBe('(ambiguous)');
  });

  it('reports a gate it cannot read rather than treating the route as ungated', () => {
    // The failure this check would otherwise hide: an unreadable `preHandler`
    // read as "no gate" turns every `missing` finding under it into a pass.
    const result = analyse({
      sources: sources(`
        app.get('/api/v1/admin/inventory', { preHandler: guards[level] }, handler);
      `),
      actions: [{ moduleId: 'inventory', actionId: 'open-inventory', targetRoute: '/inventory' }],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('unresolvable');
    expect(result.findings[0]?.enforced).toBe('(unreadable gate)');
  });

  it('says nothing when the declared code is the one the route enforces', () => {
    expect(analyse({ sources: sources(gatedList), actions: [action()] }).findings).toEqual([]);
  });
});

describe('check-action-route-permissions — what "agrees" means', () => {
  it('accepts either member of an any-of gate, because either passes it', () => {
    const text = `
      app.get('/api/v1/admin/organizations', {
        preHandler: requireAdminAny(['customers:read', 'customers:manage']),
      }, handler);
    `;
    for (const code of ['customers:read', 'customers:manage']) {
      const result = analyse({
        sources: sources(text, 'modules/organizations/routes.admin.ts'),
        actions: [
          action({
            moduleId: 'organizations',
            actionId: 'open-organizations',
            targetRoute: '/organizations',
            requiredPermission: code,
          }),
        ],
      });
      expect(result.findings, `${code} should pass the any-of gate`).toEqual([]);
    }
  });

  it('refuses a code that is in neither member of an any-of gate', () => {
    const result = analyse({
      sources: sources(
        "app.get('/api/v1/admin/organizations', { preHandler: requireAdminAny(['customers:read', 'customers:manage']) }, handler);",
        'modules/organizations/routes.admin.ts',
      ),
      actions: [
        action({
          moduleId: 'organizations',
          actionId: 'open-organizations',
          targetRoute: '/organizations',
          requiredPermission: 'catalog:read',
        }),
      ],
    });
    expect(result.findings[0]?.kind).toBe('mismatched');
    expect(result.findings[0]?.enforced).toBe('any of [customers:read, customers:manage]');
  });

  it('treats two guards on one route as a conjunction no single code satisfies', () => {
    expect(isSufficient('product_feeds:read', [['product_feeds:read'], ['catalog:read']])).toBe(false);
    expect(isSufficient('product_feeds:read', [['product_feeds:read']])).toBe(true);
  });

  it('does not read write as implying read — the codes are opaque strings', () => {
    // `hasPermission` compares strings; nothing in the platform makes
    // `catalog:write` satisfy a `catalog:read` gate, which is the whole reason
    // a "wrong direction" mismatch is a defect rather than a style.
    expect(isSufficient('catalog:write', [['catalog:read']])).toBe(false);
  });

  it('accepts any declaration over an entry route that gates on no code', () => {
    // Stated as a limit rather than discovered as one: holding a code the route
    // does not ask for still opens the screen, so this cannot produce a 403.
    // It can under-advertise, and no shipped action does it today.
    const result = analyse({
      sources: sources("app.get('/api/v1/admin/me', { preHandler: requireAdmin() }, handler);", 'modules/admin_users/routes.admin.ts'),
      actions: [
        action({
          moduleId: 'admin_users',
          actionId: 'open-me',
          targetRoute: '/me',
          requiredPermission: 'admin_users:manage',
        }),
      ],
    });
    expect(result.findings).toEqual([]);
  });
});

describe('check-action-route-permissions — the gate spellings in the tree', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['a literal argument', "app.get('/api/v1/admin/inventory', { preHandler: requireAdmin('orders:read') }, h);"],
    [
      'a dependency-bag receiver',
      "app.get('/api/v1/admin/inventory', { preHandler: deps.requireAdmin('orders:read') }, h);",
    ],
    [
      'an optional call with a no-op fallback',
      [
        "const requireRead = deps.requireAdmin?.('orders:read') ?? (async () => {});",
        "app.get('/api/v1/admin/inventory', { preHandler: requireRead }, h);",
      ].join('\n'),
    ],
    [
      'a guard bound to a const',
      [
        "const readGate = requireAdmin('orders:read');",
        "app.get('/api/v1/admin/inventory', { preHandler: readGate }, h);",
      ].join('\n'),
    ],
    [
      'an options object held in a const',
      [
        "const read = { preHandler: deps.requireAdmin('orders:read') };",
        "app.get('/api/v1/admin/inventory', read, h);",
      ].join('\n'),
    ],
    [
      'an options object spread into another',
      [
        "const read = { preHandler: deps.requireAdmin('orders:read') };",
        "app.get('/api/v1/admin/inventory', { ...read, config: { streamingResponse: true } }, h);",
      ].join('\n'),
    ],
    [
      'an array of pre-handlers',
      "app.get('/api/v1/admin/inventory', { preHandler: [verifyEtag, requireAdmin('orders:read')] }, h);",
    ],
    [
      'a template-literal path off a local base',
      [
        "const base = '/api/v1/admin/inventory';",
        "app.get(`${base}`, { preHandler: requireAdmin('orders:read') }, h);",
      ].join('\n'),
    ],
  ];

  for (const [name, text] of cases) {
    it(`reads the code out of ${name}`, () => {
      const { routes } = findAdminRoutes({ sources: sources(text) });
      expect(routes).toHaveLength(1);
      expect(routes[0]?.clauses).toEqual([['orders:read']]);
      // And the comparison runs on it: a shape read but not compared is the
      // same green as a shape not read.
      expect(analyse({ sources: sources(text), actions: [action()] }).findings).toEqual([]);
    });
  }

  it('reads a code written as a constant through the injected resolver', () => {
    const text = [
      "app.get('/api/v1/admin/product-feeds', { preHandler: deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION) }, h);",
    ].join('\n');
    const { routes } = findAdminRoutes({
      sources: sources(text, 'modules/product_feeds/routes.admin.ts'),
      lookupConstant: (_file, name) =>
        name === 'PRODUCT_FEEDS_READ_PERMISSION' ? 'product_feeds:read' : null,
    });
    expect(routes[0]?.clauses).toEqual([['product_feeds:read']]);
  });

  it('reports a constant it cannot resolve rather than reading the route as ungated', () => {
    const { routes } = findAdminRoutes({
      sources: sources(
        "app.get('/api/v1/admin/product-feeds', { preHandler: deps.requireAdmin(SOME_CODE) }, h);",
        'modules/product_feeds/routes.admin.ts',
      ),
    });
    expect(routes[0]?.clauses).toBeNull();
  });

  it('counts an admin path it could not compute instead of dropping it silently', () => {
    const { routes, unreadablePaths } = findAdminRoutes({
      sources: sources("app.get(`${prefix}/api/v1/admin/x`, { preHandler: requireAdmin('a') }, h);"),
    });
    expect(routes).toHaveLength(0);
    expect(unreadablePaths).toBe(1);
  });
});

describe('check-action-route-permissions — which route a target resolves to', () => {
  const tree = [
    "app.get('/api/v1/admin/inventory', { preHandler: requireAdmin('orders:read') }, h);",
    "app.get('/api/v1/admin/custom-fields/definitions', { preHandler: requireAdmin('custom_fields:read') }, h);",
    "app.post('/api/v1/admin/credentials', { preHandler: requireAdmin('credentials:write') }, h);",
    "app.get('/api/v1/admin/credentials', { preHandler: requireAdmin('credentials:read') }, h);",
    "app.get('/api/v1/admin/stripe/config', { preHandler: requireAdmin('stripe:read') }, h);",
  ].join('\n');
  const routes = findAdminRoutes({ sources: sources(tree, 'modules/mixed/routes.admin.ts') }).routes;
  const withModule = routes.map((route) => ({ ...route, moduleId: 'stripe' }));

  it('prefers an exact registration', () => {
    const resolved = resolveTarget(action({ targetRoute: '/inventory' }), routes);
    expect(resolved?.level).toBe('exact');
    expect(resolved?.routes[0]?.path).toBe('/api/v1/admin/inventory');
  });

  it('falls to the shallowest registration in the target subtree', () => {
    const resolved = resolveTarget(action({ targetRoute: '/custom-fields' }), routes);
    expect(resolved?.level).toBe('subtree');
    expect(resolved?.routes[0]?.path).toBe('/api/v1/admin/custom-fields/definitions');
  });

  it('falls to the owning module when the SPA placement is not the API path', () => {
    // `/settings/stripe` is placed under Settings; its API is its own namespace.
    const resolved = resolveTarget(
      action({ moduleId: 'stripe', targetRoute: '/settings/stripe' }),
      withModule,
    );
    expect(resolved?.level).toBe('module');
    expect(resolved?.routes[0]?.path).toBe('/api/v1/admin/stripe/config');
  });

  it('asks the create route, not the list, for a `/new` target', () => {
    const resolved = resolveTarget(
      action({ moduleId: 'credentials', actionId: 'new-credential', targetRoute: '/credentials/new' }),
      routes,
    );
    expect(resolved?.routes[0]?.method).toBe('post');
    expect(resolved?.routes[0]?.clauses).toEqual([['credentials:write']]);
  });
});

describe('check-action-route-permissions — the ledger', () => {
  const text = "app.get('/api/v1/admin/megamenu/menus', { preHandler: requireAdmin('megamenu.read') }, h);";
  const edit = action({
    moduleId: 'megamenu',
    actionId: 'edit-megamenu',
    targetRoute: '/megamenu',
    requiredPermission: 'megamenu.write',
  });

  it('holds a disagreement out of the violations when it is ledgered', () => {
    const result = analyse(
      { sources: sources(text, 'modules/megamenu/routes.admin.ts'), actions: [edit] },
      { 'megamenu:edit-megamenu': 'undecided — see issue #232' },
    );
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
    expect(result.stale).toEqual([]);
  });

  it('fails on an entry that no longer describes a disagreement', () => {
    const result = analyse(
      { sources: sources(text, 'modules/megamenu/routes.admin.ts'), actions: [] },
      { 'megamenu:edit-megamenu': 'undecided — see issue #232' },
    );
    expect(result.stale).toEqual(['megamenu:edit-megamenu']);
  });
});

describe('check-action-route-permissions — it refuses a vacuous pass', () => {
  it('exits 2 when one half of the comparison read nothing', () => {
    // Behaviour, not source text: the fixture is a backend whose registry agrees
    // with the tree it has, so the module-population floor is satisfied and the
    // run reaches the check's own floor with no admin route to compare against.
    const fixture = createMovedModuleTreeFixture({ registeredIds: [KEPT_MODULE] });
    try {
      const result = fixture.run('check-action-route-permissions.ts');
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('nothing to check');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('check-action-route-permissions — the artefact it read (issue #113)', () => {
  it('refuses a run whose manifest artefact its source has outrun', () => {
    // Top entry: a real checkout on disk, whose workspace file, `exports` map
    // and two-file `tsconfig.build.json` chain the derivation reads for itself.
    // Nothing here hands it a verdict, a package record or an mtime.
    const fixture = createEmittingPackageFixture({ sourceIsNewer: true });
    try {
      const result = checkEmittedFreshness({
        read: [fixture.recordedLocation],
        packages: fixture.packages,
      });
      expect(result.findings.map((finding) => finding.kind)).toEqual(['stale-artefact']);
      expect(result.emitted).toHaveLength(1);
      // The registry recorded the package's `package.json`; the file whose bytes
      // the run read is the root `exports` target, and that is what is judged.
      expect(result.findings[0]?.artefact).toBe(join(fixture.packageDir, 'dist', 'manifest.js'));
      expect(result.findings[0]?.source).toBe(join(fixture.packageDir, 'src', 'manifest.ts'));
      expect(freshnessRefusal('[x]', result)).toContain('build:packages');
    } finally {
      fixture.cleanup();
    }
  });

  it('refuses an artefact no source under the package rootDir emits', () => {
    // The other direction a silence must not go: an artefact whose currency
    // cannot be decided is named, never reported current.
    const fixture = createEmittingPackageFixture({ sourceIsNewer: false, sourceExists: false });
    try {
      const result = checkEmittedFreshness({
        read: [fixture.recordedLocation],
        packages: fixture.packages,
      });
      expect(result.findings.map((finding) => finding.kind)).toEqual(['unpairable-artefact']);
      expect(result.compared).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('says nothing about a built package, and counts it as read', () => {
    const fixture = createEmittingPackageFixture({ sourceIsNewer: false });
    try {
      const result = checkEmittedFreshness({
        read: [fixture.recordedLocation],
        packages: fixture.packages,
      });
      expect(result.findings).toEqual([]);
      expect(result.compared).toHaveLength(1);
      expect(freshnessRefusal('[x]', result)).toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('says nothing about a manifest read from a package source', () => {
    // A fixture registry that names `src/manifest.ts` — the shape
    // `moved-module-tree-fixture.ts` stages — has no emitted artefact to judge,
    // and the derivation must not refuse a tree it was not reading.
    const fixture = createEmittingPackageFixture({ sourceIsNewer: true });
    try {
      const result = checkEmittedFreshness({
        read: [join(fixture.packageDir, 'src', 'manifest.ts')],
        packages: fixture.packages,
      });
      expect(result.findings).toEqual([]);
      expect(result.emitted).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('exits 2 when a real module package is built behind its own source', () => {
    // The end-to-end half, and the measurement !1203 made three times over: the
    // check reads the *emitted* manifest, so an edit to `src/manifest.ts` was
    // invisible to it. Here it is the artefact that moves rather than the
    // source, which is the same relative order and leaves the tree's contents
    // untouched — the mtime is restored in `finally`.
    const packages = emittingPackages(REPO_ROOT);
    const subject = packages.find((pkg) => pkg.name === '@endora-commerce/mod-payu');
    expect(subject, 'the fixture package is no longer a workspace member').toBeDefined();
    const artefact = rootExportOf(subject!);
    expect(artefact, 'the package declares no root export').not.toBeNull();
    const before = statSync(artefact!);
    try {
      const backdated = Math.floor(statSync(join(subject!.dir, 'src', 'manifest.ts')).mtimeMs / 1000) - 60;
      utimesSync(artefact!, backdated, backdated);
      const result = spawnSync(
        join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx'),
        [join(BACKEND_ROOT, 'scripts', 'check-action-route-permissions.ts')],
        { encoding: 'utf8', cwd: BACKEND_ROOT },
      );
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      expect(result.status, output).toBe(2);
      expect(output).toContain('@endora-commerce/mod-payu');
      expect(output).toContain('build:packages');
      // Not exit 1, and not a warning beside a finding count: the run reports no
      // findings at all, because it could not see the tree.
      expect(output).not.toContain('violations=');
    } finally {
      utimesSync(artefact!, before.atime, before.mtime);
    }
  }, 120_000);
});
