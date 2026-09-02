/**
 * `check:admin-registrations` — the two-way ratchet over the admin's two
 * hand-written registries (feature 091, FR-018).
 *
 * Every fixture here enters at the **top** of the analysis: route and nav
 * *declarations* plus the component→directory map, which is where the
 * attribution happens. A fixture handing in a ready-made owner would exercise
 * the subtraction and leave both attributions — the one that reads `App.tsx`'s
 * imports and the one that reads `AppShell.tsx`'s `module` field — unrun, which
 * is issue #130's shape.
 *
 * The last block is about **this** repository rather than a fixture: it counts
 * the real `App.tsx` and the real `AppShell.tsx` through the same function the
 * CLI calls, so the baseline and the tree cannot drift apart between the two.
 */
import { describe, expect, it } from 'vitest';

import {
  checkAdminRegistrations,
  countAdminRegistrations,
  vacuousReason,
  type AdminRegistrationsInput,
} from '../../../scripts/check-admin-registrations.js';
import {
  ADMIN_REGISTRATIONS_BASELINE,
  HOST_OWNER,
  type AdminRegistrationCounts,
} from '../../../scripts/ledgers/admin-registrations.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import type { AdminSurfaceLayout } from '../../../scripts/lib/admin-surfaces.js';

/**
 * A tree with one module's screens and one host screen.
 *
 * `WarehouseEditor` is imported from a directory whose **name is not its module
 * id** — the real `warehouses`, which `AppShell.tsx` attributes to `inventory` —
 * because that is the case a `basename` attribution gets wrong, and getting it
 * wrong is silent: the counts land under a module that does not exist.
 */
function input(overrides: Partial<AdminRegistrationsInput> = {}): AdminRegistrationsInput {
  return {
    routes: [
      { path: '/blog', component: 'BlogList', line: 1 },
      { path: '/blog/:id', component: 'BlogEditor', line: 2 },
      { path: '/warehouses', component: 'WarehouseEditor', line: 3 },
      { path: '/', component: 'HomePage', line: 4 },
    ],
    nav: [
      { to: '/blog', module: 'blog', line: 10 },
      { to: '/warehouses', module: 'inventory', line: 11 },
      { to: '/', module: null, line: 12 },
    ],
    componentDirectories: new Map([
      ['BlogList', 'blog'],
      ['BlogEditor', 'blog'],
      ['WarehouseEditor', 'warehouses'],
    ]),
    moduleOfDirectory: new Map([
      ['blog', 'blog'],
      ['warehouses', 'inventory'],
    ]),
    registered: new Set(['blog', 'inventory']),
    ...overrides,
  };
}

const TRUTHFUL: Readonly<Record<string, AdminRegistrationCounts>> = {
  [HOST_OWNER]: { routes: 1, nav: 1 },
  blog: { routes: 2, nav: 1 },
  inventory: { routes: 1, nav: 1 },
};

describe('attribution', () => {
  it('attributes a route by the surface directory its component comes from', () => {
    const counts = countAdminRegistrations(input());
    expect(counts.get('blog')?.routes).toBe(2);
  });

  it('attributes a directory whose name is not a module id to the module that owns it', () => {
    const counts = countAdminRegistrations(input());
    // Not `warehouses`, which is no module and would land as an owner nothing
    // answers to.
    expect(counts.has('warehouses')).toBe(false);
    expect(counts.get('inventory')).toEqual({ routes: 1, nav: 1 });
  });

  it('attributes a nav entry by its own `module` field, not by the route it points at', () => {
    // The real disagreement: `/admin-roles` renders a component `admin_users`
    // holds while its sidebar row declares `module: 'admin_roles'`. Forcing one
    // attribution on both would lose whichever fact it did not pick.
    const counts = countAdminRegistrations(
      input({
        routes: [{ path: '/admin-roles', component: 'AdminRolesPage', line: 1 }],
        nav: [{ to: '/admin-roles', module: 'inventory', line: 2 }],
        componentDirectories: new Map([['AdminRolesPage', 'blog']]),
      }),
    );
    expect(counts.get('blog')).toEqual({ routes: 1, nav: 0 });
    expect(counts.get('inventory')).toEqual({ routes: 0, nav: 1 });
  });

  it('attributes a route whose component the admin itself owns to the host', () => {
    expect(countAdminRegistrations(input()).get(HOST_OWNER)).toEqual({ routes: 1, nav: 1 });
  });

  it('attributes a nav entry naming an unregistered module to the host', () => {
    // A module id nothing registers is not a module — filing its entries under
    // that name would create a baseline owner no manifest can ever retire.
    const counts = countAdminRegistrations(
      input({ nav: [{ to: '/x', module: 'gone_module', line: 1 }] }),
    );
    expect(counts.has('gone_module')).toBe(false);
    expect(counts.get(HOST_OWNER)?.nav).toBe(1);
  });
});

describe('the ratchet, in both directions', () => {
  it('accepts a baseline that describes the tree', () => {
    expect(checkAdminRegistrations(input(), TRUTHFUL).findings).toEqual([]);
  });

  it('fails on a count below the walk — a registration nobody was asked about', () => {
    const findings = checkAdminRegistrations(input(), {
      ...TRUTHFUL,
      blog: { routes: 1, nav: 1 },
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['route-count-drift']);
    expect(findings[0]?.message).toContain('+1');
  });

  it('fails on a count above the walk — the Story 3 direction', () => {
    // The batch moved the screens into the package and left the `<Route>`
    // standing, so the admin declares it twice and `react-router` takes the
    // first match with no error anywhere.
    const findings = checkAdminRegistrations(input(), {
      ...TRUTHFUL,
      blog: { routes: 5, nav: 1 },
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['route-count-drift']);
    expect(findings[0]?.message).toContain('-3');
  });

  it('fails on a nav count drift independently of the route count', () => {
    const findings = checkAdminRegistrations(input(), {
      ...TRUTHFUL,
      blog: { routes: 2, nav: 9 },
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['nav-count-drift']);
  });

  it('fails on a module with registrations and no baseline entry', () => {
    const { blog: _blog, ...withoutBlog } = TRUTHFUL;
    const findings = checkAdminRegistrations(input(), withoutBlog).findings;
    expect(findings.map((finding) => finding.owner)).toEqual(['blog']);
    expect(findings[0]?.kind).toBe('unrecorded-module');
  });

  it('fails on a baseline entry that describes no registration', () => {
    const findings = checkAdminRegistrations(input(), {
      ...TRUTHFUL,
      megamenu: { routes: 2, nav: 1 },
    }).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['stale-baseline-entry']);
    expect(findings[0]?.owner).toBe('megamenu');
  });
});

describe('the vacuous guard', () => {
  const admin = { sourceRoot: 'admin/src' } as AdminSurfaceLayout;

  it('refuses a workspace with no admin layout', () => {
    expect(vacuousReason({ admin: null, routes: 0, nav: 0, baselineEntries: 3 })).toContain(
      'admin source alias',
    );
  });

  it('refuses a run that read no route', () => {
    expect(vacuousReason({ admin, routes: 0, nav: 5, baselineEntries: 3 })).toContain('<Route>');
  });

  it('refuses a run that read no nav entry', () => {
    expect(vacuousReason({ admin, routes: 5, nav: 0, baselineEntries: 3 })).toContain(
      'AppShell.tsx',
    );
  });

  it('refuses an empty baseline', () => {
    // Every count would then be an unrecorded module, which is loud — and a
    // baseline nobody can shrink is not a ratchet.
    expect(vacuousReason({ admin, routes: 5, nav: 5, baselineEntries: 0 })).toContain(
      'no owner',
    );
  });

  it('accepts a run that read both files against a non-empty baseline', () => {
    expect(vacuousReason({ admin, routes: 5, nav: 5, baselineEntries: 3 })).toBeNull();
  });
});

describe('this repository', () => {
  it('records exactly what the two host files declare', async () => {
    const layout = await requireModuleLayout('[admin-registrations-test]');
    const admin = await layout.adminSurfaces();
    expect(admin).not.toBeNull();
    const result = checkAdminRegistrations(
      {
        routes: admin!.routes,
        nav: admin!.nav,
        componentDirectories: admin!.componentDirectories,
        moduleOfDirectory: admin!.moduleOfDirectory,
        registered: new Set(layout.registeredIds),
      },
      ADMIN_REGISTRATIONS_BASELINE,
    );
    expect(result.findings.map((finding) => finding.message)).toEqual([]);
    // The floor, so a walk that stopped parsing either file cannot report the
    // baseline as satisfied by two empty sets.
    expect(admin!.routes.length).toBeGreaterThan(0);
    expect(admin!.nav.length).toBeGreaterThan(0);
  });
});
