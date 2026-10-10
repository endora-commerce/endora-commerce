import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import ts from 'typescript';

import {
  collectRouteSources,
  findAdminRoutes,
  type AdminRoute,
  type RouteScanInput,
  type UnreadableRegistration,
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
 * **A registrar mounted under a prefix it is handed.** `mfa` mounts one
 * self-service surface twice, once per subject, under a `pathPrefix` its
 * registrar receives from another file, and gates it with a guard it receives
 * the same way. Neither is readable where the routes are written, so
 * {@link REGISTRAR_MOUNTS} says which function mounts which file and the sweep
 * **reads the rest off the call sites**: the prefixes, and the guard each mount
 * is handed. The routes then exist by name like any other, and a route added to
 * the registrar is a new name that is not on the list.
 *
 * **Every bare guard call is accounted for as well**, file by file: each
 * `requireAdmin()` — or `requireAdmin('')`, which is the same thing at runtime —
 * has to be the gate of a listed route in place or the guard a declared mount
 * is handed. A guard passed on some third way opens routes the sweep cannot
 * name, and that is a defect rather than a pass.
 *
 * **What it refuses to guess.** A registration whose path cannot be resolved,
 * a gate that cannot be read, and a plugin registered under an admin `prefix`
 * (whose routes carry only the tail of their URL) are each reported. None of
 * them is counted as gated.
 *
 * **What it cannot see at all** is a route no source under the module layout
 * registers through a Fastify verb — and for that there is a second,
 * independent enumeration: `test/contract/admin_users/
 * permissionless-admin-routes.runtime.test.ts` composes the application and
 * holds the route table Fastify actually built against this one.
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
}

/**
 * Every `/api/v1/admin/**` route that checks no permission code, keyed
 * `METHOD /path`.
 *
 * Adding an entry is a decision that the route does nothing on behalf of the
 * instance: it reads or changes the caller's own account, or it is something
 * the shell cannot render without. Anything else takes a permission code.
 *
 * **There is no "undecided" entry, deliberately.** The list once carried four
 * routes marked as awaiting a ruling; the owner ruled that all four stay open
 * and the marker went with them. A route found open is given a code or is
 * listed with the reason it is open — a third state would be a place for the
 * next one to sit indefinitely with the sweep green.
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
  'GET /api/v1/admin/account/mfa/status': {
    guard: 'session',
    reason:
      "The caller's own second factor — whether it is enrolled. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
  },
  'POST /api/v1/admin/account/mfa/setup': {
    guard: 'session',
    reason:
      "The caller's own second factor — starting an enrolment. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
  },
  'POST /api/v1/admin/account/mfa/activate': {
    guard: 'session',
    reason:
      "The caller's own second factor — confirming an enrolment. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
  },
  'POST /api/v1/admin/account/mfa/disable': {
    guard: 'session',
    reason:
      "The caller's own second factor — removing it. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
  },
  'POST /api/v1/admin/account/mfa/recovery-codes/regenerate': {
    guard: 'session',
    reason:
      "The caller's own second factor — new recovery codes. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
  },
  'DELETE /api/v1/admin/account/mfa/social-links/:provider': {
    guard: 'session',
    reason:
      "The caller's own second factor — unlinking a sign-in provider. The handler resolves the subject from the " +
      "session, so no request can name another administrator's; resetting somebody else's is " +
      '`mfa:reset`.',
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
      'Which release the instance runs, for the version badge in the header of every screen — ' +
      'one string, shown to whoever is signed in, whatever their role.',
  },
  'GET /api/v1/admin/i18n/bundles': {
    guard: 'session',
    reason:
      'The strings every screen renders, including the notice an account without a role is ' +
      'shown; without it the shell cannot render a single label.',
  },
  'GET /api/v1/admin/admin-actions': {
    guard: 'session',
    reason:
      'The command palette list, which the service filters by the permissions the caller ' +
      'holds: each administrator is answered with what they may open and nothing more.',
  },
  'POST /api/v1/admin/impersonation/end': {
    guard: 'none',
    reason:
      'Ends the impersonation the caller started. It carries no `requireAdmin` guard because ' +
      'the request arrives as the impersonated customer: the handler authenticates it itself, ' +
      'by the impersonation session cookie and the administrator shadow cookie together, and ' +
      'answers 401 without both.',
  },
};

/** A route file whose path prefix and guard are arguments of the function that mounts it. */
export interface RegistrarMount {
  /** The exported function that registers the routes. */
  readonly registrar: string;
  /** The source that calls it — where the prefixes and guards are written. */
  readonly mountedIn: string;
  /** The option the registrar reads its path prefix from. */
  readonly pathParameter: string;
  /** The option the registrar reads its guard from. */
  readonly guardParameter: string;
  readonly reason: string;
}

/**
 * Registrars whose routes cannot be read where they are written, keyed by the
 * registrar's own source file. An entry states structure only: the prefixes and
 * the guards are read from `mountedIn` on every run.
 */
export const REGISTRAR_MOUNTS: Readonly<Record<string, RegistrarMount>> = {
  'packages/modules/mfa/src/backend/routes.self-service.ts': {
    registrar: 'registerMfaSelfServiceRoutes',
    mountedIn: 'packages/modules/mfa/src/backend/plugin.ts',
    pathParameter: 'pathPrefix',
    guardParameter: 'requireGuard',
    reason:
      'One second-factor self-service surface, mounted once for customers and once for ' +
      'administrators, each under its own prefix and behind its own session guard.',
  },
};

// ---------------------------------------------------------------------------
// The rule — sources in, defects out
// ---------------------------------------------------------------------------

export interface PermissionlessRouteScan {
  /** Every admin route registration read, whatever its gate. */
  readonly routes: readonly AdminRoute[];
  /** Registrations whose path could not be resolved. */
  readonly unreadable: readonly UnreadableRegistration[];
  /** Bare `requireAdmin()` / `requireAdmin('')` calls, by source key. */
  readonly bareGuardSites: ReadonlyMap<string, number>;
  /** Bare guards a declared mount hands to its registrar, by the mounting file. */
  readonly handedOnGuards: ReadonlyMap<string, number>;
  /** Defects found while reading — mounts and prefixed plugins. */
  readonly readingDefects: readonly string[];
}

const GUARD_NAMES = new Set(['requireAdmin', 'requireAdminAny']);

/** A bare guard call inside a route's own options text. */
const BARE_GUARD_IN_PLACE = /\brequireAdmin(?:Any)?\s*(?:\?\.)?\(\s*(?:''|"")?\s*\)/u;

function calleeName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return calleeName(node.expression);
  }
  return null;
}

/**
 * A guard call that checks no code: no argument, or the empty string — which
 * the guard treats as no argument (`if (!permission) return`).
 */
function isBareGuardCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node.expression);
  if (name === null || !GUARD_NAMES.has(name)) return false;
  const [first] = node.arguments;
  return first === undefined || (ts.isStringLiteralLike(first) && first.text === '');
}

/** How many bare guard calls a source holds. Comments are not calls. */
function countBareGuardCalls(file: string, text: string): number {
  if (!text.includes('requireAdmin')) return 0;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (isBareGuardCall(node)) count += 1;
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

/** One call of a registrar: the prefix it mounts under and the guard it is handed. */
interface MountSite {
  readonly prefix: string;
  /** `[]` for a bare guard, the code for a coded one, `null` when it is neither. */
  readonly clauses: readonly (readonly string[])[] | null;
  readonly bare: boolean;
}

/** Read every call of a mount's registrar out of the file that makes them. */
function readMountSites(
  registrarFile: string,
  mount: RegistrarMount,
  sources: ReadonlyMap<string, string>,
  defects: string[],
): MountSite[] {
  const text = sources.get(mount.mountedIn);
  if (text === undefined) {
    defects.push(
      `[unreadable-mount] ${registrarFile}: REGISTRAR_MOUNTS says it is mounted in ` +
        `${mount.mountedIn}, which was not read.`,
    );
    return [];
  }
  const sf = ts.createSourceFile(mount.mountedIn, text, ts.ScriptTarget.Latest, true);
  const sites: MountSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === mount.registrar) {
      const options = node.arguments.find(ts.isObjectLiteralExpression);
      let prefix: string | null = null;
      let guard: ts.Expression | null = null;
      for (const property of options?.properties ?? []) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name.getText();
        if (name === mount.pathParameter && ts.isStringLiteralLike(property.initializer)) {
          prefix = property.initializer.text;
        }
        if (name === mount.guardParameter) guard = property.initializer;
      }
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (prefix === null) {
        defects.push(
          `[unreadable-mount] ${mount.mountedIn}:${line} calls ${mount.registrar} without a ` +
            `literal \`${mount.pathParameter}\`, so the routes it mounts cannot be named.`,
        );
      } else {
        let clauses: MountSite['clauses'] = null;
        const bare = guard !== null && isBareGuardCall(guard);
        if (bare) clauses = [];
        else if (guard !== null && ts.isCallExpression(guard)) {
          const name = calleeName(guard.expression);
          const [first] = guard.arguments;
          if (name === 'requireAdmin' && first !== undefined && ts.isStringLiteralLike(first)) {
            clauses = [[first.text]];
          }
        }
        sites.push({ prefix, clauses, bare });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  if (sites.length === 0) {
    defects.push(
      `[unreadable-mount] ${mount.mountedIn} holds no readable call of ${mount.registrar}. ` +
        'Correct or delete the REGISTRAR_MOUNTS entry.',
    );
  }
  return sites;
}

/** Whether what was read of a prefix shows it is not under the admin API. */
function notAnAdminPrefix(prefix: string): boolean {
  const admin = '/api/v1/admin';
  const compared = Math.min(prefix.length, admin.length);
  return prefix.slice(0, compared) !== admin.slice(0, compared);
}

/**
 * `app.register(plugin, { prefix: '/api/v1/admin/x' })` — the routes inside
 * carry only the tail of their URL, so nothing here can attribute them. There
 * is none in the tree; the first one has to arrive as a finding.
 */
function findPrefixedPlugins(file: string, text: string, defects: string[]): void {
  if (!text.includes('prefix')) return;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'register') {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'prefix') continue;
          const literal = ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null;
          if (literal !== null && notAnAdminPrefix(literal)) continue;
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          defects.push(
            `[prefixed-plugin] ${file}:${line} registers a plugin under prefix ` +
              `\`${property.initializer.getText()}\`. Its routes carry only the tail of their ` +
              'URL, so this sweep cannot say which of them check a permission. Write the full ' +
              'path at each registration.',
          );
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
}

export function scanPermissionlessRoutes(
  input: RouteScanInput,
  mounts: Readonly<Record<string, RegistrarMount>> = {},
): PermissionlessRouteScan {
  const readingDefects: string[] = [];
  const handedOnGuards = new Map<string, number>();
  const sitesByRegistrar = new Map<string, MountSite[]>();
  const pathBindings = new Map<string, ReadonlyMap<string, readonly string[]>>(input.pathBindings ?? []);

  for (const [registrarFile, mount] of Object.entries(mounts)) {
    const sites = readMountSites(registrarFile, mount, input.sources, readingDefects);
    sitesByRegistrar.set(registrarFile, sites);
    if (sites.length > 0) {
      pathBindings.set(registrarFile, new Map([[mount.pathParameter, sites.map((site) => site.prefix)]]));
    }
    const bare = sites.filter((site) => site.bare).length;
    if (bare > 0) handedOnGuards.set(mount.mountedIn, (handedOnGuards.get(mount.mountedIn) ?? 0) + bare);
  }

  const scan = findAdminRoutes({ ...input, pathBindings });
  const routes = scan.routes.map((route): AdminRoute => {
    if (route.clauses !== null) return route;

    // A route in a declared registrar, gated by the guard the registrar was handed.
    const mount = mounts[route.file];
    if (mount !== undefined && new RegExp(`\\bpreHandler:\\s*${mount.guardParameter}\\b`, 'u').test(route.gateText)) {
      const site = (sitesByRegistrar.get(route.file) ?? []).find((candidate) =>
        route.path.startsWith(`${candidate.prefix}/`),
      );
      if (site !== undefined && site.clauses !== null) return { ...route, clauses: site.clauses };
    }

    const code = forwardedCodeOf(route, input.sources.get(route.file));
    return code === null ? route : { ...route, clauses: [[code]] };
  });

  const bareGuardSites = new Map<string, number>();
  for (const [file, text] of input.sources) {
    const count = countBareGuardCalls(file, text);
    if (count > 0) bareGuardSites.set(file, count);
    findPrefixedPlugins(file, text, readingDefects);
  }
  return { routes, unreadable: scan.unreadable, bareGuardSites, handedOnGuards, readingDefects };
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
 * Everything that disagrees with the list, as sentences a failure can print.
 * Empty means every permissionless route and every bare guard is accounted
 * for, nothing was left unread, and no entry has outlived what it described.
 */
export function findPermissionlessRouteDefects(
  scan: PermissionlessRouteScan,
  allowed: Readonly<Record<string, PermissionlessRouteEntry>> = PERMISSIONLESS_ADMIN_ROUTES,
): string[] {
  const defects: string[] = [...scan.readingDefects];
  const seen = new Set<string>();
  const inPlaceByFile = new Map<string, number>();
  const counted = new Set<string>();

  for (const registration of scan.unreadable) {
    defects.push(
      `[unreadable-path] ${registration.file}:${registration.line} registers a route at ` +
        `\`${registration.pathText}\`, which could not be resolved to a path, so its gate was ` +
        'not checked. Write the path where it can be read, or teach the reader the shape.',
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
    // Counted per registration: one guard call gates every method an
    // `app.route({ method: [...] })` names.
    if (guard === 'session' && BARE_GUARD_IN_PLACE.test(route.gateText) && !counted.has(where)) {
      counted.add(where);
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

  const files = new Set([...scan.bareGuardSites.keys(), ...scan.handedOnGuards.keys()]);
  for (const file of [...files].sort()) {
    const bare = scan.bareGuardSites.get(file) ?? 0;
    const inPlace = inPlaceByFile.get(file) ?? 0;
    const handedOn = scan.handedOnGuards.get(file) ?? 0;
    if (bare === inPlace + handedOn) continue;
    defects.push(
      `[unaccounted-guard] ${file} holds ${bare} bare requireAdmin() call(s): ${inPlace} gate a ` +
        `listed route in place and ${handedOn} are handed to a registrar REGISTRAR_MOUNTS ` +
        'declares. A guard passed on any other way opens routes this sweep cannot name — ' +
        'declare the mount, or give the guard a permission code.',
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
  const scan = scanPermissionlessRoutes(
    {
      sources,
      hostResidentModules: layout.hostResidentModules,
      absolutePathOf: layout.absolutePathOf,
      lookupConstant: (file, name, property) => resolver.lookup(file, name, property),
    },
    REGISTRAR_MOUNTS,
  );
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
