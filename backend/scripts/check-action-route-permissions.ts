/**
 * CI check — a manifest action's `requiredPermission` is the code enforced on
 * the route behind its own `targetRoute` (issue #232; Principle XVI item 2, "the
 * code gating the target surface, so the palette never advertises a 403").
 *
 * `test/contract/admin_users/permission-inventory.test.ts` already sweeps two
 * directions — every enforced code is grantable, every grantable code is
 * enforced — and **both** of the defects that produced this check passed it,
 * because both codes were real, declared and enforced somewhere:
 *
 *  - `settings`' `open-settings` action declared no `requiredPermission` at all
 *    while `/api/v1/admin/settings` is `requireAdmin('settings:read')`, so ⌘K
 *    offered the screen to every role and every role without the code collected
 *    a guaranteed 403;
 *  - `inventory`' `open-inventory` declared `catalog:write` while
 *    `/api/v1/admin/inventory` is `requireAdmin('orders:read')` — wrong in both
 *    directions at once, hiding the screen from operators who can open it and
 *    offering it to some who cannot.
 *
 * Neither is visible to a sweep over the *set* of codes. The third direction —
 * the code is the one enforced on **this action's** target — is what this check
 * adds.
 *
 * ## What "agrees" means
 *
 * Permission codes are opaque: `hasPermission(userId, code)` compares strings
 * (plus the `'*'` wildcard), so `catalog:write` does not imply `catalog:read`.
 * The property is therefore **sufficiency**, not equality: *holding the declared
 * code, and nothing else, must be enough to open the target screen.* For
 * `requireAdmin('x')` that collapses to equality; for
 * `requireAdminAny(['customers:read', 'customers:manage'])` — the one any-of
 * gate in the tree — either member is sufficient and either is accepted.
 *
 * Sufficiency leaves one residue, deliberately: an action naming one member of
 * an any-of gate is hidden from an operator holding only the other member. That
 * is under-advertising, not a 403, and the manifest field is a single code, so
 * the palette cannot express the alternative. The sidebar can (MR !736 gave
 * `NavItem.requiredPermission` an any-of array for exactly this route); a
 * manifest action cannot, and widening the contract for one route is not
 * something this check should force.
 *
 * ## Which route is "the" route
 *
 * A `targetRoute` is an admin SPA path (`/inventory`), not an API path
 * (`/api/v1/admin/inventory`), and nothing in the tree declares the link. The
 * check reconstructs it as the **entry route**: the request the browser must be
 * allowed to make for the screen to render at all. Resolution runs in levels,
 * first non-empty level wins, and stops at the first level that answers:
 *
 *   1. **exact** — a registration at `/api/v1/admin` + the target;
 *   2. **subtree** — the shallowest registrations under it, for a screen whose
 *      data hangs off sub-resources (`/custom-fields` →
 *      `/api/v1/admin/custom-fields/definitions`);
 *   3. **module** — the shallowest registrations the owning module ships at all,
 *      for a screen whose SPA placement is not its API path (`/settings/stripe`
 *      is placed under Settings; its API is `/api/v1/admin/stripe/config`).
 *
 * An action targeting `/x/new` is a create form, so the parent path is resolved
 * instead and the method class flips from GET to the write verbs: the gate that
 * decides whether that form can be submitted is the POST's, not the list's.
 *
 * Where the shallowest candidates disagree on their gate, or where a selected
 * gate is a `preHandler` the scanner cannot read, the action is reported
 * `unresolvable` rather than compared against a guess. An entry route that gates
 * on **no** code accepts any declaration: holding a code the route does not ask
 * for still opens the screen, so it cannot produce a 403 — it can only
 * under-advertise, and no shipped action does.
 *
 * What the check cannot settle is where the label promises a write and the
 * screen opens on a read: one field cannot say both codes, and
 * `ACTION_PERMISSION_DISAGREEMENTS` holds those three with the question that
 * would retire each.
 *
 * Usage: `tsx scripts/check-action-route-permissions.ts [--list]`
 * Exit 0 = every action's declared code is the one its target enforces (or the
 * disagreement is ledgered); exit 1 = at least one is not, or a ledger entry is
 * stale; exit 2 = the scan read no route or no action, so a green would have
 * meant "not looking" (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { activeOverlayModulesRoot } from '../src/overlay/overlay-roots.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** Every admin API path starts here; nothing else is an admin surface. */
const ADMIN_API_PREFIX = '/api/v1/admin';

/** The Fastify shorthand methods a route registration can be written as. */
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** The verbs a create form submits through — the write half of a surface. */
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** The guard family whose argument is a permission code. */
const GUARD_NAMES = new Set(['requireAdmin', 'requireAdminAny']);

/**
 * Actions whose declared code disagrees with their target's gate and may stay
 * that way, with the reason and the question that would retire the entry.
 *
 * Keyed `<moduleId>:<actionId>`, so moving an action inside a manifest does not
 * invalidate an entry and re-opening the hole does not silently inherit one.
 * **Two-way**, in the idiom of `BARE_SUBSCRIPTIONS_TO_DRAIN`: an unledgered
 * disagreement fails the build, and an entry that no longer describes one fails
 * it too.
 *
 * The population that lands here is one shape: an action whose **intent is a
 * write** on a screen whose landing GET is read-gated — "Edit the megamenu",
 * "Import products". Declaring the write code hides the action from an operator
 * who could open the screen; declaring the read code advertises an action the
 * operator cannot complete. `requiredPermission` is a single code and the screen
 * needs two, so neither answer is right and the choice is the owner's, not this
 * check's. An entry says which two codes are defensible.
 */
export const ACTION_PERMISSION_DISAGREEMENTS: Readonly<Record<string, string>> = {
  'megamenu:edit-megamenu':
    '"Edit megamenu" declares `megamenu.write`; the screen it opens is gated by ' +
    '`megamenu.read` (GET /api/v1/admin/megamenu/menus). Retire this entry by ' +
    'answering one question: is the row a way *in* to the menu editor — then it is ' +
    '`megamenu.read` and an operator who cannot save still sees the tree — or is it ' +
    'the edit itself, in which case it stays as it is and hides from a read-only ' +
    'operator by design. Issue #232 left the verb-labelled actions undecided.',
  'pim_ergonode:run-ergonode-import':
    '"Import from Ergonode now" declares `pim_ergonode:write` and lands on ' +
    '`/pim-ergonode`, whose landing GETs are `pim_ergonode:read` — the same route ' +
    '`open-pim-ergonode` already advertises with the read code. Retire this entry by ' +
    'deciding whether the row promises the import (write, and it stays) or the screen ' +
    'the import is started from (read, and it becomes a duplicate of the open action).',
  'product_feeds:import-feed-template':
    '"Import a feed template" declares `product_feeds:write`; the import screen it ' +
    'opens is behind read-gated landing routes, and the POST that performs the import ' +
    'is the write one. Retire this entry with the same answer as the two above: a ' +
    'palette row is a navigation, and the field is a single code, so the label and the ' +
    'gate cannot both be honoured.',
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The manifest half of the comparison, flattened out of the module manifests. */
export interface ActionRecord {
  readonly moduleId: string;
  readonly actionId: string;
  readonly targetRoute: string;
  /** Absent when the manifest declares none — the `missing` finding's input. */
  readonly requiredPermission?: string;
}

/**
 * A gate, as a **conjunction of any-of clauses**: `requireAdmin('x')` is
 * `[['x']]`, `requireAdminAny(['a', 'b'])` is `[['a', 'b']]`, two guards on one
 * route are `[['x'], ['y']]`, and an empty conjunction is "any authenticated
 * admin". `null` is a `preHandler` the scanner could not read — never silently
 * treated as "ungated", which is the failure mode the whole file exists for.
 */
export type GateClauses = readonly (readonly string[])[] | null;

export interface AdminRoute {
  /** Path under `src/`, POSIX separators. */
  readonly file: string;
  readonly line: number;
  readonly method: string;
  /** The registered path, `/api/v1/admin/...`. */
  readonly path: string;
  readonly moduleId: string | null;
  readonly clauses: GateClauses;
  /** The `preHandler` as written, for a failure message that can be acted on. */
  readonly gateText: string;
}

/** Resolves a constant argument to its literal; injected so fixtures can drive it. */
export type ConstantLookup = (file: string, name: string, property: string | null) => string | null;

export interface RouteScanInput {
  /** Every source to read, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Absolute path of a source, for the constant resolver's import following.
   * Optional so a fixture can enter at the top with source text alone; a real
   * run supplies it, because half the tree writes its codes as constants.
   */
  readonly absolutePathOf?: (file: string) => string;
  readonly lookupConstant?: ConstantLookup;
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

/** The trailing identifier of a callee: `deps.requireAdmin` → `requireAdmin`. */
function tailName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return tailName(node.expression);
  }
  return null;
}

/** The string a node denotes, through casts. Template literals are handled apart. */
function stringLiteralOf(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return node.text;
  if (
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    return stringLiteralOf(node.expression);
  }
  return null;
}

/** Every `const x = <initialiser>` in a file, by name — the local scope this reads. */
function localBindings(sf: ts.SourceFile): Map<string, ts.Expression> {
  const bindings = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      // First writer wins: a name re-bound in an inner scope is the exception,
      // and taking the outer one keeps the answer stable across files.
      if (!bindings.has(node.name.text)) bindings.set(node.name.text, node.initializer);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return bindings;
}

/**
 * The path a route registration's first argument denotes.
 *
 * Two spellings appear: a plain literal, and a template whose head is a
 * module-local `const base = '/api/v1/admin/<module>'` (`newsletter`,
 * `transactional_emails`). A span that cannot be resolved yields `null` — the
 * registration is then not attributed to any target, and the run says how many
 * such there were rather than quietly shrinking the population.
 */
function routePathOf(node: ts.Expression, bindings: ReadonlyMap<string, ts.Expression>): string | null {
  const literal = stringLiteralOf(node);
  if (literal !== null) return literal;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const name = ts.isIdentifier(span.expression) ? span.expression.text : null;
      const bound = name === null ? undefined : bindings.get(name);
      const value = bound === undefined ? null : stringLiteralOf(bound);
      if (value === null) return null;
      out += value + span.literal.text;
    }
    return out;
  }
  return null;
}

/** The permission codes a guard call requires, as one clause, or `null`. */
function clauseOfGuardCall(
  call: ts.CallExpression,
  file: string,
  input: RouteScanInput,
): readonly string[] | null {
  const [argument] = call.arguments;
  if (argument === undefined) return []; // `requireAdmin()` — any authenticated admin.
  const absolute = input.absolutePathOf?.(file) ?? file;
  const lookup: ConstantLookup = input.lookupConstant ?? (() => null);

  const codeOf = (node: ts.Expression): string | null => {
    const literal = stringLiteralOf(node);
    if (literal !== null) return literal;
    if (ts.isIdentifier(node)) return lookup(absolute, node.text, null);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      return lookup(absolute, node.expression.text, node.name.text);
    }
    return null;
  };

  if (ts.isArrayLiteralExpression(argument)) {
    const codes: string[] = [];
    for (const element of argument.elements) {
      const code = ts.isSpreadElement(element) ? null : codeOf(element);
      if (code === null) return null;
      codes.push(code);
    }
    return codes;
  }
  const code = codeOf(argument);
  return code === null ? null : [code];
}

interface GateReading {
  readonly clauses: GateClauses;
  readonly text: string;
}

/**
 * The gate a route's options argument installs.
 *
 * The shapes present in the tree, all of them resolved module-locally:
 * `{ preHandler: requireAdmin('code') }` and its `deps.`/cradle receivers, the
 * same through a `const guard = requireAdmin(CODE)` binding, an options object
 * held in a `const read = { preHandler: … }` and passed bare or spread
 * (`{ ...write, bodyLimit }`), and an array of pre-handlers.
 */
function gateOf(node: ts.Node | undefined, file: string, input: RouteScanInput, bindings: ReadonlyMap<string, ts.Expression>, depth = 0): GateReading {
  const text = node === undefined ? '' : node.getText().replace(/\s+/g, ' ').slice(0, 120);
  if (node === undefined || depth > 4) return { clauses: node === undefined ? [] : null, text };

  // A handler, not an options object: the registration installs no gate.
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { clauses: [], text: '' };

  if (ts.isIdentifier(node)) {
    const bound = bindings.get(node.text);
    return bound === undefined
      ? { clauses: null, text }
      : { ...gateOf(bound, file, input, bindings, depth + 1), text };
  }

  if (ts.isObjectLiteralExpression(node)) {
    const clauses: (readonly string[])[] = [];
    let unreadable = false;
    let sawGateSlot = false;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = gateOf(property.expression, file, input, bindings, depth + 1);
        if (spread.clauses === null) unreadable = true;
        else if (spread.clauses.length > 0) {
          sawGateSlot = true;
          clauses.push(...spread.clauses);
        }
        continue;
      }
      if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'preHandler') continue;
      sawGateSlot = true;
      const handlers = ts.isArrayLiteralExpression(property.initializer)
        ? property.initializer.elements
        : [property.initializer];
      let recognised = false;
      for (const handler of handlers) {
        const clause = clauseOfPreHandler(handler, file, input, bindings, depth + 1);
        if (clause === undefined) continue;
        recognised = true;
        if (clause === null) unreadable = true;
        else if (clause.length > 0) clauses.push(clause);
      }
      if (!recognised) unreadable = true;
    }
    if (unreadable) return { clauses: null, text };
    return { clauses: sawGateSlot ? clauses : [], text: sawGateSlot ? text : '' };
  }

  return { clauses: null, text };
}

/**
 * One pre-handler's clause: `null` when it is a guard whose code cannot be read,
 * `undefined` when it is not a permission guard at all (an ETag validator, a
 * rate limiter — those gate nothing this check is about).
 */
function clauseOfPreHandler(
  node: ts.Expression,
  file: string,
  input: RouteScanInput,
  bindings: ReadonlyMap<string, ts.Expression>,
  depth: number,
): readonly string[] | null | undefined {
  if (depth > 6) return null;
  // `deps.requireAdmin?.('blog.write') ?? (async () => {})` — the guard is the
  // left operand and the fallback is a no-op the harness never takes. Reading
  // the `??` as unreadable is what hid `blog`'s and `cms`'s gates from a first
  // draft of this check.
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return clauseOfPreHandler(node.left, file, input, bindings, depth + 1);
  }
  if (ts.isCallExpression(node)) {
    const callee = tailName(node.expression);
    if (callee !== null && GUARD_NAMES.has(callee)) return clauseOfGuardCall(node, file, input);
    return undefined;
  }
  if (ts.isIdentifier(node)) {
    const bound = bindings.get(node.text);
    return bound === undefined ? undefined : clauseOfPreHandler(bound, file, input, bindings, depth + 1);
  }
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return null;
  return undefined;
}

export interface RouteScanResult {
  readonly routes: readonly AdminRoute[];
  /** Registrations whose path is computed and could not be read. */
  readonly unreadablePaths: number;
}

/** Every `/api/v1/admin/**` route registration under `sources`, with its gate. */
export function findAdminRoutes(input: RouteScanInput): RouteScanResult {
  const routes: AdminRoute[] = [];
  let unreadablePaths = 0;

  for (const [file, text] of input.sources) {
    if (!text.includes(ADMIN_API_PREFIX)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = localBindings(sf);
    const moduleId = moduleIdOf(file);

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ROUTE_METHODS.has(node.expression.name.text) &&
        node.arguments.length >= 2
      ) {
        const [pathArgument, optionsArgument] = node.arguments;
        if (pathArgument !== undefined) {
          const looksLikePath =
            ts.isStringLiteralLike(pathArgument) || ts.isTemplateExpression(pathArgument);
          const path = looksLikePath ? routePathOf(pathArgument, bindings) : null;
          if (looksLikePath && path === null && pathArgument.getText().includes(ADMIN_API_PREFIX)) {
            unreadablePaths += 1;
          }
          if (path !== null && path.startsWith(ADMIN_API_PREFIX)) {
            const gate = gateOf(optionsArgument, file, input, bindings);
            routes.push({
              file,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              method: node.expression.name.text,
              path,
              moduleId,
              clauses: gate.clauses,
              gateText: gate.text,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  routes.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return { routes, unreadablePaths };
}

/** The module a source under `src/` belongs to, or `null` outside a module tree. */
export function moduleIdOf(file: string): string | null {
  const segments = file.split('/');
  if (segments[0] === 'modules') return segments[1] ?? null;
  // `apps/<deployment>/modules/<id>/…` — an overlay module is an ordinary
  // lifecycle participant and owns its actions the same way (feature 057).
  if (segments[0] === 'apps' && segments[2] === 'modules') return segments[3] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Resolution: a target route to the gate that decides whether it opens
// ---------------------------------------------------------------------------

/** How the entry route was found, for the failure message and `--list`. */
export type ResolutionLevel = 'exact' | 'subtree' | 'module';

export interface ResolvedTarget {
  readonly level: ResolutionLevel;
  /** The shallowest candidates at that level — all of them, gates compared. */
  readonly routes: readonly AdminRoute[];
}

const depthOf = (path: string): number => path.split('/').length;

function shallowest(routes: readonly AdminRoute[]): readonly AdminRoute[] {
  if (routes.length === 0) return routes;
  const min = Math.min(...routes.map((route) => depthOf(route.path)));
  return routes.filter((route) => depthOf(route.path) === min);
}

/**
 * The entry route for an action's target, or `null` when no registration
 * corresponds to it at all — which is a defect of its own: a palette entry must
 * point at a real surface.
 */
export function resolveTarget(
  action: ActionRecord,
  routes: readonly AdminRoute[],
): ResolvedTarget | null {
  const creating = action.targetRoute.endsWith('/new');
  const path = creating ? action.targetRoute.slice(0, -'/new'.length) : action.targetRoute;
  const wanted = (route: AdminRoute): boolean =>
    creating ? WRITE_METHODS.has(route.method) : route.method === 'get';
  const base = ADMIN_API_PREFIX + path;

  const exact = routes.filter((route) => route.path === base && wanted(route));
  if (exact.length > 0) return { level: 'exact', routes: shallowest(exact) };

  const subtree = routes.filter((route) => route.path.startsWith(`${base}/`) && wanted(route));
  if (subtree.length > 0) return { level: 'subtree', routes: shallowest(subtree) };

  const owned = routes.filter((route) => route.moduleId === action.moduleId && wanted(route));
  if (owned.length > 0) return { level: 'module', routes: shallowest(closestTo(path, owned)) };

  return null;
}

/**
 * The module-level candidates whose path names most of the target's segments.
 *
 * At this level the SPA path and the API path have already been established not
 * to correspond, so "shallowest" alone picks by accident: `/platform/modules`
 * would compare against `/api/v1/admin/api-interceptors` as readily as against
 * `/api/v1/admin/modules`, and the two carry different gates. Ranking by shared
 * segment names first keeps the comparison against the route the screen is
 * actually named after, and leaves the ambiguity report for the case where
 * nothing distinguishes the candidates.
 */
function closestTo(target: string, routes: readonly AdminRoute[]): readonly AdminRoute[] {
  const wanted = new Set(target.split('/').filter((segment) => segment.length > 0));
  const score = (route: AdminRoute): number =>
    route.path
      .slice(ADMIN_API_PREFIX.length)
      .split('/')
      .filter((segment) => wanted.has(segment)).length;
  const best = Math.max(...routes.map(score));
  return routes.filter((route) => score(route) === best);
}

/** Whether holding `code` alone passes a gate. Membership in every clause. */
export function isSufficient(code: string, clauses: readonly (readonly string[])[]): boolean {
  return clauses.every((clause) => clause.includes(code));
}

/** A gate's clauses as a stable string, so two candidates can be compared. */
function gateKey(clauses: GateClauses): string {
  return clauses === null ? '<unreadable>' : JSON.stringify(clauses.map((c) => [...c].sort()));
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export type FindingKind = 'missing' | 'mismatched' | 'unresolvable';

export interface Finding {
  readonly kind: FindingKind;
  readonly moduleId: string;
  readonly actionId: string;
  readonly targetRoute: string;
  /** The declared code, or `null` for a `missing` finding. */
  readonly declared: string | null;
  /** What the entry route enforces, rendered for a human. */
  readonly enforced: string;
  /** Where that answer came from — the route, or why there is none. */
  readonly where: string;
}

/** `<moduleId>:<actionId>` — the ledger key, and the identity of a finding. */
export function keyOf(finding: Pick<Finding, 'moduleId' | 'actionId'>): string {
  return `${finding.moduleId}:${finding.actionId}`;
}

function renderClauses(clauses: readonly (readonly string[])[]): string {
  if (clauses.length === 0) return '(no code — any authenticated admin)';
  return clauses.map((clause) => (clause.length === 1 ? clause[0] : `any of [${clause.join(', ')}]`)).join(' and ');
}

export interface ComparisonInput {
  readonly actions: readonly ActionRecord[];
  readonly routes: readonly AdminRoute[];
}

/** Every action whose declared code is not the one its target enforces. */
export function findDisagreements(input: ComparisonInput): Finding[] {
  const findings: Finding[] = [];

  for (const action of input.actions) {
    const base = {
      moduleId: action.moduleId,
      actionId: action.actionId,
      targetRoute: action.targetRoute,
      declared: action.requiredPermission ?? null,
    };
    const resolved = resolveTarget(action, input.routes);
    if (resolved === null) {
      findings.push({
        ...base,
        kind: 'unresolvable',
        enforced: '(no registration)',
        where: `no /api/v1/admin route corresponds to ${action.targetRoute}, and ${action.moduleId} registers none`,
      });
      continue;
    }

    const keys = new Set(resolved.routes.map((route) => gateKey(route.clauses)));
    const [first] = resolved.routes;
    if (first === undefined) continue;
    if (keys.size > 1) {
      findings.push({
        ...base,
        kind: 'unresolvable',
        enforced: '(ambiguous)',
        where:
          `the ${resolved.level}-level candidates for ${action.targetRoute} disagree: ` +
          resolved.routes
            .map((route) => `${route.method.toUpperCase()} ${route.path} → ${renderClauses(route.clauses ?? [])}`)
            .join('; '),
      });
      continue;
    }
    if (first.clauses === null) {
      findings.push({
        ...base,
        kind: 'unresolvable',
        enforced: '(unreadable gate)',
        where: `${first.file}:${first.line} — preHandler \`${first.gateText}\` could not be read`,
      });
      continue;
    }

    const clauses = first.clauses;
    const where = `${first.method.toUpperCase()} ${first.path} (${first.file}:${first.line}, ${resolved.level})`;
    if (action.requiredPermission === undefined) {
      if (clauses.length === 0) continue; // Ungated surface, undeclared action — agreed.
      findings.push({ ...base, kind: 'missing', enforced: renderClauses(clauses), where });
      continue;
    }
    if (!isSufficient(action.requiredPermission, clauses)) {
      findings.push({ ...base, kind: 'mismatched', enforced: renderClauses(clauses), where });
    }
  }

  return findings.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

export interface CheckResult {
  readonly findings: readonly Finding[];
  readonly violations: readonly Finding[];
  readonly ledgered: readonly Finding[];
  /** Ledger keys that no longer describe a disagreement — the staleness half. */
  readonly stale: readonly string[];
}

export function checkActionRoutePermissions(
  input: ComparisonInput,
  ledger: Readonly<Record<string, string>> = ACTION_PERMISSION_DISAGREEMENTS,
): CheckResult {
  const findings = findDisagreements(input);
  const keys = new Set(findings.map(keyOf));
  return {
    findings,
    violations: findings.filter((finding) => ledger[keyOf(finding)] === undefined),
    ledgered: findings.filter((finding) => ledger[keyOf(finding)] !== undefined),
    stale: Object.keys(ledger).filter((key) => !keys.has(key)),
  };
}

export interface AnalysisInput extends RouteScanInput {
  /** The manifest half — a data input, not something this check computes. */
  readonly actions: readonly ActionRecord[];
}

export interface AnalysisResult extends CheckResult {
  readonly scan: RouteScanResult;
}

/**
 * The whole analysis, source text in and findings out — the entry a real run
 * takes and the one a red proof has to take with it (issue #130). A fixture
 * handed a ready-made `AdminRoute[]` would prove the comparison and skip the
 * route reading the comparison rests on, which is where every gate shape lives.
 */
export function analyse(
  input: AnalysisInput,
  ledger: Readonly<Record<string, string>> = ACTION_PERMISSION_DISAGREEMENTS,
): AnalysisResult {
  const scan = findAdminRoutes(input);
  return { ...checkActionRoutePermissions({ actions: input.actions, routes: scan.routes }, ledger), scan };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

async function loadActions(): Promise<ActionRecord[]> {
  const { resolvedManifestEntries } = await import('../src/modules/_lifecycle/registered-manifests.js');
  const entries = await resolvedManifestEntries();
  const actions: ActionRecord[] = [];
  for (const entry of entries) {
    for (const action of entry.manifest.actions ?? []) {
      actions.push({
        moduleId: entry.manifest.id,
        actionId: action.id,
        targetRoute: action.targetRoute,
        ...(action.requiredPermission === undefined
          ? {}
          : { requiredPermission: action.requiredPermission }),
      });
    }
  }
  return actions;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');

  // The deployment's overlay modules are part of this build's surface (feature
  // 057), and `src/apps` is otherwise skipped: another deployment's routes are
  // not registered here and its actions are not shipped here.
  const overlayRoot = activeOverlayModulesRoot(process.env);
  const coreFiles = walk(SRC_ROOT).filter((file) => !relative(SRC_ROOT, file).startsWith('apps'));

  // Before anything is imported out of the tree, and before a finding count can
  // be printed: over a moved module tree the walk comes back with `src/kernel`
  // and `src/db`, neither of which registers an admin route, so every other
  // guard here would read as a clean run (issue #215).
  await refuseVacuousModulePopulation({
    prefix: '[action-route-permissions]',
    srcRoot: SRC_ROOT,
    files: coreFiles,
  });

  const files = overlayRoot === null ? coreFiles : [...coreFiles, ...walk(overlayRoot)];
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(SRC_ROOT, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }

  // Imported here rather than at the top: both live in the module tree, so a
  // static import would die at module resolution over the residue above and
  // turn an exit 2 into an unhandled rejection.
  const { ConstantResolver } = await import('../src/modules/admin_roles/permission-inventory.js');
  const resolver = new ConstantResolver();
  const actions = await loadActions();

  const result = analyse({
    sources,
    actions,
    absolutePathOf: (file) => join(SRC_ROOT, file),
    lookupConstant: (file, name, property) => resolver.lookup(file, name, property),
  });

  // The second floor, one per half of the comparison: a run that read routes
  // but no action, or actions but no route, cannot answer the question and must
  // not answer it green (issue #113).
  if (result.scan.routes.length === 0 || actions.length === 0) {
    console.error(
      `[action-route-permissions] nothing to check: admin-routes=${result.scan.routes.length} ` +
        `actions=${actions.length}. Both halves of the comparison have to have been read; ` +
        'refusing to report a vacuous pass.',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const action of actions) {
      const resolved = resolveTarget(action, result.scan.routes);
      const first = resolved?.routes[0];
      const enforced =
        first === undefined
          ? '(unresolved)'
          : first.clauses === null
            ? '(unreadable)'
            : renderClauses(first.clauses);
      console.log(
        `${keyOf({ moduleId: action.moduleId, actionId: action.actionId }).padEnd(48)} ` +
          `${action.targetRoute.padEnd(36)} declared=${(action.requiredPermission ?? '-').padEnd(24)} ` +
          `enforced=${enforced.padEnd(28)} [${resolved?.level ?? 'none'}] ` +
          `${first === undefined ? '' : `${first.method.toUpperCase()} ${first.path}`}`,
      );
    }
    console.log('');
  }

  console.log(
    `[action-route-permissions] actions=${actions.length} admin-routes=${result.scan.routes.length} ` +
      `unreadable-paths=${result.scan.unreadablePaths} findings=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(ACTION_PERMISSION_DISAGREEMENTS).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      "\nA command-palette action advertises a permission that is not the one its\n" +
        'target route enforces (Principle XVI item 2 — "so the palette never\n' +
        'advertises a 403"). Take the code from the route unless the surface is\n' +
        'genuinely the other one, in which case the route is what changes.\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - [${finding.kind}] ${keyOf(finding)} → ${finding.targetRoute}\n` +
          `      declared: ${finding.declared ?? '(none)'}\n` +
          `      enforced: ${finding.enforced}\n` +
          `      where:    ${finding.where}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (no longer describe a disagreement — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
