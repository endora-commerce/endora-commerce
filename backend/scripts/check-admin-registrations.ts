/**
 * CI check — the admin's two hand-written registries, counted per module and
 * held both ways (feature 091, FR-018).
 *
 * ## The defect this exists for
 *
 * `admin/src/App.tsx` declares 149 routes and `admin/src/components/AppShell.tsx`
 * declares 100 nav entries, and 145 of the first and 97 of the second belong to
 * a module rather than to the admin application. Story 3 moves those
 * declarations into the modules that own them, one directory per merge request.
 *
 * **The batch that moves a directory does not touch either file.** That is the
 * exact shape AGENTS.md records as having produced three reds on `master` in a
 * row: a ledger derived *about* the files you changed is not a file you changed,
 * so the batch that frees an entry is structurally the batch that cannot see it
 * go stale. Here the two counts are facts about the module directories, derived
 * nowhere, and a batch that moves `blog`'s seven screens into
 * `@endora-commerce/mod-blog/admin` while leaving its seven `<Route>` elements
 * standing produces an admin that declares every one of them twice — with
 * `react-router` silently taking the first match, which
 * `specs/071-modular-packaging/decisions.md` D-23 calls the worst available
 * failure for exactly this reason.
 *
 * ## Two directions, and both of them fail
 *
 * A count **below** the walk is a module that grew a hand-written registration
 * nobody was asked about — the shape this feature exists to stop being the only
 * way to add a screen. A count **above** it is a number left standing after the
 * registrations went, which is the stale direction every ledger in this tree
 * refuses. Neither is allowed to be repaired by raising a number: the remedy
 * for the first is to declare the surface in the module, and the remedy for the
 * second is to remove the entry.
 *
 * ## What is counted, and how each side is attributed
 *
 * A **route** is attributed to the module whose surface directory `App.tsx`
 * imports its component from; a route whose component comes from the admin's
 * own code is `host`'s. A **nav entry** is attributed to the `module` field it
 * already carries — the field `admin/src/lib/surface-visibility.ts` reads, and
 * the one AppShell's own comment calls *"what keeps a new entry from being
 * silently unfiltered"* — and an entry declaring `module: null` is `host`'s.
 *
 * The two are attributed differently on purpose, because they answer different
 * questions and the tree disagrees about one screen: `/admin-roles` renders a
 * component `admin_users` holds, while its sidebar row declares
 * `module: 'admin_roles'`. Forcing one attribution on both would have to pick a
 * side, and picking either loses the fact the other records.
 *
 * ## The population, and why the file count is 2
 *
 * `files=2` is honest and is the point: this check reads exactly the two host
 * registries. `sites` is the finer population — every route and every nav entry
 * it examined — and it is the number that moves as Story 3 drains them.
 *
 * The independent source is the **generated manifest index**: every `module` a
 * nav entry declares must be a module the platform registers. `AppShell.tsx`
 * writes those strings and the index is generated from the manifests, so the
 * two have different authors, which is what issue #244 asks of a `sources`
 * token. A run in which AppShell stopped parsing declares `expected=0` and is
 * refused as `no-expectation`; a run in which the index went stale under it is
 * refused as `short-walk`.
 *
 * **When the last module registration goes, this check has nothing to ratchet
 * and is deleted** — `expected=0` is exit 2 in that grammar, and an instrument
 * with an empty population is the "done signal that says nothing" an empty
 * ledger shard is refused for. That is SC-007's moment, not a regression.
 *
 * Usage: `tsx scripts/check-admin-registrations.ts [--list]`
 * Exit 0 = every module's route and nav counts are what the baseline records;
 * exit 1 = at least one drifted, in either direction;
 * exit 2 = the check read nothing — no admin layout, no routes, no nav entries,
 * or an empty baseline.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { pathToFileURL } from 'node:url';

import {
  ADMIN_REGISTRATIONS_BASELINE,
  HOST_OWNER,
  type AdminRegistrationCounts,
} from './ledgers/admin-registrations.js';
import { requireModuleLayout } from './lib/module-roots.js';
import type {
  AdminNavDeclaration,
  AdminRouteDeclaration,
  AdminSurfaceLayout,
} from './lib/admin-surfaces.js';
import { reportReadSize } from './lib/read-size.js';

/** What the check reads, so a red proof enters where a real run enters. */
export interface AdminRegistrationsInput {
  /** The routes `App.tsx` declares. */
  readonly routes: readonly AdminRouteDeclaration[];
  /** The nav entries `AppShell.tsx` declares. */
  readonly nav: readonly AdminNavDeclaration[];
  /** Component name → the surface directory `App.tsx` imports it from. */
  readonly componentDirectories: ReadonlyMap<string, string>;
  /** Surface directory → the module that owns it. */
  readonly moduleOfDirectory: ReadonlyMap<string, string>;
  /** Module ids the generated manifest index registers. */
  readonly registered: ReadonlySet<string>;
}

export type AdminRegistrationFindingKind =
  | 'unrecorded-module'
  | 'stale-baseline-entry'
  | 'route-count-drift'
  | 'nav-count-drift';

export interface AdminRegistrationFinding {
  readonly kind: AdminRegistrationFindingKind;
  /** A module id, or {@link HOST_OWNER}. */
  readonly owner: string;
  readonly message: string;
}

export interface AdminRegistrationsResult {
  readonly counts: ReadonlyMap<string, AdminRegistrationCounts>;
  readonly findings: readonly AdminRegistrationFinding[];
  /** Routes plus nav entries examined — the `sites=` number. */
  readonly sites: number;
  /** Distinct modules the nav attributes to, for the independent source. */
  readonly navModules: readonly string[];
}

/**
 * Every registration in the input, counted per owner.
 *
 * Exported so the check's own test counts the **real** two files through the
 * same function the CLI uses: two similar walks are two answers waiting to
 * disagree.
 */
export function countAdminRegistrations(
  input: AdminRegistrationsInput,
): Map<string, AdminRegistrationCounts> {
  const counts = new Map<string, { routes: number; nav: number }>();
  const bump = (owner: string, field: 'routes' | 'nav'): void => {
    const entry = counts.get(owner) ?? { routes: 0, nav: 0 };
    entry[field] += 1;
    counts.set(owner, entry);
  };
  for (const route of input.routes) {
    const directory =
      route.component === null ? undefined : input.componentDirectories.get(route.component);
    const owner = directory === undefined ? undefined : input.moduleOfDirectory.get(directory);
    bump(owner === undefined ? HOST_OWNER : owner, 'routes');
  }
  for (const entry of input.nav) {
    const owner =
      entry.module === null || !input.registered.has(entry.module) ? HOST_OWNER : entry.module;
    bump(owner, 'nav');
  }
  return counts;
}

/**
 * The two-way comparison against the baseline.
 *
 * `baseline` is a parameter rather than the imported constant so a proof can
 * hand in one entry rather than the whole tree's — the fixture then enters at
 * the top of the analysis with the routes and the nav as declarations, which is
 * where the attribution happens (issue #130).
 */
export function checkAdminRegistrations(
  input: AdminRegistrationsInput,
  baseline: Readonly<Record<string, AdminRegistrationCounts>>,
): AdminRegistrationsResult {
  const counts = countAdminRegistrations(input);
  const findings: AdminRegistrationFinding[] = [];

  for (const [owner, found] of [...counts].sort()) {
    const recorded = baseline[owner];
    if (recorded === undefined) {
      findings.push({
        kind: 'unrecorded-module',
        owner,
        message:
          `${owner} declares ${found.routes} route(s) and ${found.nav} nav entry(ies) in the ` +
          'admin host files and the baseline records none. A module\'s admin surface is ' +
          'declared in the module (feature 091 FR-010); if this registration is genuinely ' +
          `the right place for now, record it as \`${owner}: { routes: ${found.routes}, ` +
          `nav: ${found.nav} }\` and say in the comment why.`,
      });
      continue;
    }
    if (recorded.routes !== found.routes) {
      findings.push({
        kind: 'route-count-drift',
        owner,
        message: driftMessage(owner, 'route', recorded.routes, found.routes),
      });
    }
    if (recorded.nav !== found.nav) {
      findings.push({
        kind: 'nav-count-drift',
        owner,
        message: driftMessage(owner, 'nav entry', recorded.nav, found.nav),
      });
    }
  }

  for (const owner of Object.keys(baseline).sort()) {
    if (counts.has(owner)) continue;
    findings.push({
      kind: 'stale-baseline-entry',
      owner,
      message:
        `${owner} has a baseline entry and declares no route and no nav entry in the admin ` +
        'host files. A number left standing after the registrations went is the stale ' +
        'direction every ledger in this tree refuses — remove the entry.',
    });
  }

  const navModules = [
    ...new Set(
      input.nav
        .map((entry) => entry.module)
        .filter((module): module is string => module !== null),
    ),
  ].sort();

  return { counts, findings, sites: input.routes.length + input.nav.length, navModules };
}

function driftMessage(owner: string, unit: string, recorded: number, found: number): string {
  if (recorded < found) {
    return (
      `${owner} records ${recorded} ${unit}(s), the walk found ${found} ` +
      `(+${found - recorded}) — a module grew a hand-written admin registration and no ` +
      'reviewer was asked why. Declare the surface in the module instead (FR-010), or ' +
      `record ${found} and say what the new one is for.`
    );
  }
  return (
    `${owner} records ${recorded} ${unit}(s), the walk found ${found} ` +
    `(-${recorded - found}) — the registrations went and the number stayed. Record ` +
    `${found}, or remove the entry if this owner has none left.`
  );
}

/**
 * Why this run must not report a pass, or `null`.
 *
 * Exit **2**, never 0 and never 1: a green result must not be able to mean "not
 * looking" (issue #113). Each of the four is an input whose absence would leave
 * the comparison vacuously true rather than failing.
 */
export function vacuousReason(input: {
  readonly admin: AdminSurfaceLayout | null;
  readonly routes: number;
  readonly nav: number;
  readonly baselineEntries: number;
}): string | null {
  if (input.admin === null) {
    return (
      'no workspace member declares the admin source alias, so there is no route table and ' +
      'no nav to count — refusing to report a vacuous pass'
    );
  }
  if (input.routes === 0) {
    return (
      `no <Route> declaration in ${input.admin.sourceRoot}/App.tsx — the route half of this ` +
      'ratchet reads nothing, and an empty walk compares equal to an empty baseline; ' +
      'refusing to report a vacuous pass'
    );
  }
  if (input.nav === 0) {
    return (
      `no nav declaration in ${input.admin.sourceRoot}/components/AppShell.tsx — the nav half ` +
      'of this ratchet reads nothing; refusing to report a vacuous pass'
    );
  }
  if (input.baselineEntries === 0) {
    return (
      'the baseline records no owner — every count would then be an unrecorded module, which ' +
      'is loud, but a baseline nobody can shrink is not a ratchet; refusing to report a ' +
      'vacuous pass'
    );
  }
  return null;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[admin-registrations]');
  const admin = await layout.adminSurfaces();

  const vacuous = vacuousReason({
    admin,
    routes: admin?.routes.length ?? 0,
    nav: admin?.nav.length ?? 0,
    baselineEntries: Object.keys(ADMIN_REGISTRATIONS_BASELINE).length,
  });
  if (vacuous !== null) {
    console.error(`[admin-registrations] ${vacuous}`);
    process.exit(2);
    return;
  }

  const registered = new Set(layout.registeredIds);
  const result = checkAdminRegistrations(
    {
      routes: admin!.routes,
      nav: admin!.nav,
      componentDirectories: admin!.componentDirectories,
      moduleOfDirectory: admin!.moduleOfDirectory,
      registered,
    },
    ADMIN_REGISTRATIONS_BASELINE,
  );

  if (listMode) {
    for (const [owner, counts] of [...result.counts].sort()) {
      console.log(`${owner.padEnd(24)} routes=${counts.routes} nav=${counts.nav}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: '[admin-registrations]',
    // Two, and that is the honest number: this check's subject is exactly the
    // admin's two hand-written registries. `sites` is what moves.
    files: 2,
    sites: result.sites,
    coverage: [
      {
        // `AppShell.tsx` writes these strings; the index is generated from the
        // manifests. Two authors, which is what makes this a reconciliation
        // rather than the walk reporting itself (issue #244).
        source: 'manifest-index',
        expected: result.navModules.length,
        covered: result.navModules.filter((module) => registered.has(module)).length,
      },
    ],
  });

  const moduleOwners = [...result.counts.keys()].filter((owner) => owner !== HOST_OWNER);
  const moduleRoutes = moduleOwners.reduce(
    (sum, owner) => sum + (result.counts.get(owner)?.routes ?? 0),
    0,
  );
  const moduleNav = moduleOwners.reduce(
    (sum, owner) => sum + (result.counts.get(owner)?.nav ?? 0),
    0,
  );
  console.log(
    `[admin-registrations] routes=${admin!.routes.length} nav=${admin!.nav.length} ` +
      `module-owned (routes=${moduleRoutes} nav=${moduleNav}) over ${moduleOwners.length} ` +
      `modules, host-owned (routes=${result.counts.get(HOST_OWNER)?.routes ?? 0} ` +
      `nav=${result.counts.get(HOST_OWNER)?.nav ?? 0}) ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nThe admin registration baseline no longer describes the two host files.\n' +
        'Both directions fail on purpose: a count below the walk is a registration nobody\n' +
        'was asked about, and a count above it is a number left standing after the\n' +
        'registrations went. Never raise a number to make the build pass.\n',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.message}\n`);
    }
  }

  process.exit(result.findings.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
