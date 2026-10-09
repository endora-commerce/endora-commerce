import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import ts from 'typescript';

import {
  collectRouteSources,
  findAdminRoutes,
  type AdminRoute,
  type RouteScanInput,
} from '@endora-commerce/cli/rules/action-route-permissions.js';
import { UI_LAYER_DIRECTORIES } from '@endora-commerce/cli/lib/ui-layer.js';

import { scanEnforcedPermissionGates } from '../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { requireModuleLayout } from '../../scripts/lib/module-roots.js';
import { activeOverlayModulesRoot } from '../../src/overlay/overlay-roots.js';
import { permissionScanRoots } from './permission-scan-roots.js';

/**
 * Issue #141 — the admin routes that check **no permission code**, held to an
 * explicit list.
 *
 * Since an administrator without a role is refused wherever a permission is
 * checked, the routes that check none are the whole of what such an account can
 * still reach — and, more ordinarily, the whole of what every administrator can
 * reach whatever their role says. Two of them were instance-wide operations
 * nobody had decided to leave open (`POST /api/v1/admin/i18n/reload` and
 * `GET /api/v1/admin/i18n/coverage`); they were open because `requireAdmin()`
 * with no argument is one keystroke shorter than `requireAdmin('code')` and
 * nothing listed the routes written that way.
 *
 * **What is read.** The route half is `check:action-route-permissions`' own
 * reader (`findAdminRoutes`), over the same files that check walks: every
 * `/api/v1/admin/**` registration, with the permission clauses its `preHandler`
 * installs. A route whose clauses are empty — a bare `requireAdmin()`, or no
 * `preHandler` at all — or unreadable has to be in
 * {@link PERMISSIONLESS_ADMIN_ROUTES} with the reason it is open.
 *
 * **What that reader cannot see, and the second count that covers it.** A
 * registration whose path is computed is not attributed to any URL: `mfa`
 * mounts one self-service surface twice, once per subject, under a `pathPrefix`
 * its registrar is handed, so `/api/v1/admin/account/mfa/*` appears in no
 * route record. The guard that opens those routes is still written somewhere —
 * `requireAdmin()` in `mfa/src/backend/plugin.ts` — so the sweep also counts
 * every bare guard **call** in every file and requires each one to be either
 * the gate of a route the first half listed or declared in
 * {@link HANDED_ON_SESSION_GUARDS}. A new `requireAdmin()` therefore cannot
 * arrive unseen whichever way its route is spelled.
 *
 * Both lists are two-way: an entry that no longer describes anything fails too,
 * so gating a route retires its entry in the same change.
 */

/** Why a route answers without a permission, and who decided it. */
export interface PermissionlessRouteEntry {
  /**
   * `session` — `requireAdmin()`: an administrator session, any role or none.
   * `none` — no `preHandler`; the handler authenticates the request itself.
   */
  readonly guard: 'session' | 'none';
  /** Why this route must answer whatever the caller's role grants. */
  readonly reason: string;
  /**
   * Set on an entry nobody has ruled on: the sweep found the route open, it is
   * not self-service on the face of it, and it is listed as found rather than
   * silently gated or silently blessed. Carries the recommendation.
   */
  readonly undecided?: string;
}

/**
 * Every `/api/v1/admin/**` route that checks no permission code, keyed
 * `METHOD /path`.
 *
 * Adding an entry is a decision that the route does nothing on behalf of the
 * instance: it reads or changes the caller's own account, or it is something
 * the shell cannot render without. Anything else takes a permission code.
 */
export const PERMISSIONLESS_ADMIN_ROUTES: Readonly<Record<string, PermissionlessRouteEntry>> = {
  'GET /api/v1/admin/me': {
    guard: 'session',
    reason:
      'The probe the shell signs in through: who the caller is, the role they hold and the ' +
      'permissions it grants. An account with no role has to be able to read that it has none.',
  },
  'PATCH /api/v1/admin/me': {
    guard: 'session',
    reason:
      "The caller's own first name, last name and password. Role and status are not accepted " +
      'here; changing those is `admin_users:manage`.',
  },
  'PATCH /api/v1/admin/me/preferred-language': {
    guard: 'session',
    reason: "The caller's own Admin UI language, written to the caller's own row.",
  },
  'GET /api/v1/admin/module-presence': {
    guard: 'session',
    reason:
      'The presence projection the shell boots from: which modules are there decides which ' +
      'routes and navigation entries exist at all, before any permission is consulted.',
  },
  'GET /api/v1/admin/platform-info': {
    guard: 'session',
    reason:
      'Which release the instance runs, for the version badge in the header of every screen. ' +
      'Its own registration says the missing code is deliberate, on the same ground as the ' +
      'presence projection.',
    undecided:
      'Not named in issue #141; it arrived on master while that issue was open. ' +
      'Recommendation: keep session-only — it answers one string, and the liveness probe ' +
      'already hands the same number to an anonymous caller.',
  },
  'GET /api/v1/admin/i18n/bundles': {
    guard: 'session',
    reason:
      'The strings every screen renders, including the notice an account without a role is ' +
      'shown. Read-only, and the same answer for every administrator.',
    undecided:
      'Not named in issue #141. Recommendation: keep session-only — the shell cannot render a ' +
      'single label without it.',
  },
  'GET /api/v1/admin/admin-actions': {
    guard: 'session',
    reason:
      'The command palette list. The service filters it by the permissions the caller holds, ' +
      'so the route answers each administrator with what they may open and nothing more.',
    undecided:
      'Not named in issue #141. Recommendation: keep session-only — the filtering is per ' +
      'caller, and a code here would hide the palette from roles that can use part of it.',
  },
  'POST /api/v1/admin/impersonation/end': {
    guard: 'none',
    reason:
      'Ends the impersonation the caller started. The request arrives carrying the ' +
      'impersonation session rather than an administrator one, so the handler authenticates ' +
      'it by the impersonation cookie and the shadow cookie together and answers 401 without ' +
      'both.',
    undecided:
      'Not named in issue #141, and the one admin route with no guard at all. Recommendation: ' +
      'keep — starting an impersonation is permission-gated, and refusing to end one would ' +
      'strand the administrator inside the customer session.',
  },
};

/** A bare `requireAdmin()` that is passed on instead of gating a route in place. */
export interface HandedOnGuardEntry {
  /** How many bare guard calls in the file are handed on. */
  readonly sites: number;
  /** The routes it opens, for a reader; the count is what the sweep holds. */
  readonly opens: readonly string[];
  readonly reason: string;
}

/**
 * Bare guard calls whose routes {@link findAdminRoutes} cannot attribute to a
 * URL, keyed by source file.
 */
export const HANDED_ON_SESSION_GUARDS: Readonly<Record<string, HandedOnGuardEntry>> = {
  'packages/modules/mfa/src/backend/plugin.ts': {
    sites: 1,
    opens: [
      'GET /api/v1/admin/account/mfa/status',
      'POST /api/v1/admin/account/mfa/setup',
      'POST /api/v1/admin/account/mfa/activate',
      'POST /api/v1/admin/account/mfa/disable',
      'POST /api/v1/admin/account/mfa/recovery-codes/regenerate',
      'DELETE /api/v1/admin/account/mfa/social-links/:provider',
    ],
    reason:
      "The caller's own second factor: its status, enrolment, removal, recovery codes and " +
      'linked sign-in providers. Every handler resolves the subject from the session, so no ' +
      "request can name another administrator's. Resetting somebody else's factor is a " +
      'different route behind `mfa:reset`.',
  },
};

// ---------------------------------------------------------------------------
// The rule — sources in, defects out
// ---------------------------------------------------------------------------

export interface PermissionlessRouteScan {
  /** Every admin route registration read, whatever its gate. */
  readonly routes: readonly AdminRoute[];
  /** Registrations under the admin prefix whose path could not be read. */
  readonly unreadablePaths: number;
  /** Bare `requireAdmin()` / `requireAdminAny()` calls, by source key. */
  readonly bareGuardSites: ReadonlyMap<string, number>;
}

const GUARD_NAMES = new Set(['requireAdmin', 'requireAdminAny']);

/** A bare guard call inside a route's own options text. */
const BARE_GUARD_IN_PLACE = /\brequireAdmin(?:Any)?\s*(?:\?\.)?\(\s*\)/u;

function calleeName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return calleeName(node.expression);
  }
  return null;
}

/** How many guard calls with no argument a source holds. Comments are not calls. */
function countBareGuardCalls(file: string, text: string): number {
  if (!text.includes('requireAdmin')) return 0;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 0) {
      const name = calleeName(node.expression);
      if (name !== null && GUARD_NAMES.has(name)) count += 1;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return count;
}

/** `preHandler: forCustomer('customers:read')` — a local factory handed one literal. */
const FACTORY_CALL = /\bpreHandler:\s*([A-Za-z_$][\w$]*)\(\s*(['"])([^'"]+)\2\s*\)/u;

/**
 * The code a route's gate checks when the gate is a **module-local factory
 * that forwards its argument to the guard** —
 * `const forCustomer = (permission: string) => [requireAdmin(permission), requireCustomerId]`,
 * called as `forCustomer('customers:read')`.
 *
 * {@link findAdminRoutes} reads a guard call and a binding to one; a call to a
 * local function is neither, so it answers "unreadable". That is the right
 * answer for the comparison it was written for and too coarse for this one:
 * the literal is at the registration and the factory is ten lines above it.
 *
 * It resolves exactly that and nothing wider. The factory has to be a `const`
 * in the same file, take one parameter, and pass **that parameter** as the
 * first argument of a guard call somewhere in its body. A factory that drops
 * its argument, or one called with something other than a string literal,
 * stays unreadable and is reported — which is the direction to fail in.
 */
function forwardedCodeOf(route: AdminRoute, text: string | undefined): string | null {
  if (text === undefined) return null;
  const call = FACTORY_CALL.exec(route.gateText);
  if (call === null) return null;
  const [, factoryName, , code] = call;
  if (factoryName === undefined || code === undefined || GUARD_NAMES.has(factoryName)) return null;

  const sf = ts.createSourceFile(route.file, text, ts.ScriptTarget.Latest, true);
  let forwards = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === factoryName &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      node.initializer.parameters.length === 1
    ) {
      const [parameter] = node.initializer.parameters;
      const parameterName =
        parameter !== undefined && ts.isIdentifier(parameter.name) ? parameter.name.text : null;
      const inBody = (inner: ts.Node): void => {
        if (ts.isCallExpression(inner)) {
          const name = calleeName(inner.expression);
          const [first] = inner.arguments;
          if (
            name !== null &&
            GUARD_NAMES.has(name) &&
            first !== undefined &&
            ts.isIdentifier(first) &&
            first.text === parameterName
          ) {
            forwards = true;
          }
        }
        inner.forEachChild(inBody);
      };
      if (parameterName !== null) inBody(node.initializer.body);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return forwards ? code : null;
}

export function scanPermissionlessRoutes(input: RouteScanInput): PermissionlessRouteScan {
  const scan = findAdminRoutes(input);
  const routes = scan.routes.map((route): AdminRoute => {
    if (route.clauses !== null) return route;
    const code = forwardedCodeOf(route, input.sources.get(route.file));
    return code === null ? route : { ...route, clauses: [[code]] };
  });
  const bareGuardSites = new Map<string, number>();
  for (const [file, text] of input.sources) {
    const count = countBareGuardCalls(file, text);
    if (count > 0) bareGuardSites.set(file, count);
  }
  return { routes, unreadablePaths: scan.unreadablePaths, bareGuardSites };
}

/** `METHOD /path` — the key {@link PERMISSIONLESS_ADMIN_ROUTES} is written in. */
export function routeKeyOf(route: Pick<AdminRoute, 'method' | 'path'>): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

/** The guard a permissionless route carries, in the allow-list's vocabulary. */
function guardOf(route: AdminRoute): 'session' | 'none' {
  return route.gateText === '' ? 'none' : 'session';
}

/**
 * Everything that disagrees with the two lists, as sentences a failure can
 * print. Empty means every permissionless route and every bare guard is
 * accounted for, and no entry has outlived what it described.
 */
export function findPermissionlessRouteDefects(
  scan: PermissionlessRouteScan,
  allowed: Readonly<Record<string, PermissionlessRouteEntry>> = PERMISSIONLESS_ADMIN_ROUTES,
  handedOn: Readonly<Record<string, HandedOnGuardEntry>> = HANDED_ON_SESSION_GUARDS,
): string[] {
  const defects: string[] = [];
  const seen = new Set<string>();
  const inPlaceByFile = new Map<string, number>();

  if (scan.unreadablePaths > 0) {
    defects.push(
      `[unreadable-path] ${scan.unreadablePaths} admin route registration(s) have a path the ` +
        'scanner could not read, so their gates were not checked.',
    );
  }

  for (const route of scan.routes) {
    const key = routeKeyOf(route);
    const where = `${route.file}:${route.line}`;
    if (route.clauses === null) {
      defects.push(
        `[unreadable-gate] ${key} (${where}) — preHandler \`${route.gateText}\` could not be ` +
          'read. Write the guard so the permission it checks is visible at the registration.',
      );
      continue;
    }
    if (route.clauses.length > 0) continue;

    seen.add(key);
    const guard = guardOf(route);
    if (guard === 'session' && BARE_GUARD_IN_PLACE.test(route.gateText)) {
      inPlaceByFile.set(route.file, (inPlaceByFile.get(route.file) ?? 0) + 1);
    }
    const entry = allowed[key];
    if (entry === undefined) {
      defects.push(
        `[unlisted] ${key} (${where}) checks no permission code. Give it one, or — if it only ` +
          "reads or changes the caller's own account, or the shell cannot render without it — " +
          'add it to PERMISSIONLESS_ADMIN_ROUTES with the reason.',
      );
    } else if (entry.guard !== guard) {
      defects.push(
        `[guard-changed] ${key} (${where}) is listed with guard '${entry.guard}' and now has ` +
          `'${guard}'. Re-read the entry's reason against the route as it stands.`,
      );
    }
  }

  for (const key of Object.keys(allowed)) {
    if (!seen.has(key)) {
      defects.push(
        `[stale-entry] ${key} is in PERMISSIONLESS_ADMIN_ROUTES and is no longer a mounted ` +
          'route without a permission code. Delete the entry.',
      );
    }
  }

  const files = new Set([...scan.bareGuardSites.keys(), ...Object.keys(handedOn)]);
  for (const file of [...files].sort()) {
    const bare = scan.bareGuardSites.get(file) ?? 0;
    const inPlace = inPlaceByFile.get(file) ?? 0;
    const declared = handedOn[file]?.sites ?? 0;
    if (bare === inPlace + declared) continue;
    defects.push(
      `[unaccounted-guard] ${file} holds ${bare} bare requireAdmin() call(s): ${inPlace} gate a ` +
        `listed route in place and HANDED_ON_SESSION_GUARDS declares ${declared}. A guard that ` +
        'is handed to a registrar opens routes this sweep cannot name — declare it with the ' +
        'routes it opens, or give it a permission code.',
    );
  }

  return defects;
}

// ---------------------------------------------------------------------------
// The live read
// ---------------------------------------------------------------------------

/**
 * This build's admin routes, read the way `check:action-route-permissions`
 * reads them: every backend source under the module layout's roots, the admin
 * UI layers left out, permission constants followed through `admin_roles`'
 * resolver.
 */
export async function readPermissionlessRoutes(): Promise<
  PermissionlessRouteScan & { readonly files: number }
> {
  const layout = await requireModuleLayout('[permissionless-admin-routes]');
  const uiLayers = layout.moduleRoots
    .filter((root) => root.origin === 'workspace-package')
    .flatMap((root) => UI_LAYER_DIRECTORIES.map((layer) => `${join(root.directory, 'src', layer)}/`));
  // Every deployment's overlay out, then the active one back in: a deployment
  // that is not selected is not part of this build.
  const coreFiles = layout.sourceRoots
    .flatMap((root) => collectRouteSources(root))
    .filter((file) => !file.startsWith(`${layout.overlayRoot}/`))
    .filter((file) => !uiLayers.some((layer) => file.startsWith(layer)));
  const overlayRoot = activeOverlayModulesRoot(process.env);
  const files = overlayRoot === null ? coreFiles : [...coreFiles, ...collectRouteSources(overlayRoot)];

  const sources = new Map<string, string>();
  for (const file of files) sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));

  const { ConstantResolver } = await import('@endora-commerce/mod-admin-roles/backend');
  const resolver = new ConstantResolver();
  const scan = scanPermissionlessRoutes({
    sources,
    hostResidentModules: layout.hostResidentModules,
    absolutePathOf: layout.absolutePathOf,
    lookupConstant: (file, name, property) => resolver.lookup(file, name, property),
  });
  return { ...scan, files: sources.size };
}

/**
 * The same population by the other reader: the `requireAdmin()` sites the
 * permission inventory resolves to "any authenticated admin", per source key.
 *
 * The inventory's scan tokenises and walks its own root list; the one above
 * parses and walks the route check's. Wherever the inventory sees a bare guard
 * this sweep has to see the same number in the same file, which is what makes
 * this one going blind visible. The comparison runs one way on purpose: the
 * route check's roots are the wider set — they hold the platform's own HTTP
 * layer, which the inventory does not walk.
 */
export async function inventoryBareGuardSites(): Promise<ReadonlyMap<string, number>> {
  const sites = scanEnforcedPermissionGates(await permissionScanRoots()).authenticatedAdminOnly;
  const byFile = new Map<string, number>();
  for (const site of sites) {
    // The inventory keys a file relative to `backend/src`; a packaged module's
    // therefore starts `../../packages/`. Normalise onto the layout's keys.
    const repoRelative = posix.normalize(posix.join('backend/src', site.file));
    const key = repoRelative.startsWith('backend/src/')
      ? repoRelative.slice('backend/src/'.length)
      : repoRelative;
    byFile.set(key, (byFile.get(key) ?? 0) + 1);
  }
  return byFile;
}
