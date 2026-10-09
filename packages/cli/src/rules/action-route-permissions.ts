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
 * ## The artefact this reads, and when it refuses to judge it
 *
 * The route half is source text, walked. The **manifest** half is imported, and
 * a module that has become a workspace package resolves through its own
 * `exports` map at its build output (D-164) — so an action edited in
 * `packages/modules/<id>/src/manifest.ts` and not rebuilt is not the action
 * this check sees. Measured three consecutive times on
 * `specs/091-module-owned-admin-surfaces/`'s admin drain, most sharply on
 * !1203, where a `requiredPermission` changed from `payu:read` to `payu:write`
 * reported `findings=3 violations=0` and exit 0 before
 * `pnpm --filter @endora-commerce/mod-payu run build`, and `findings=4
 * violations=1` and exit 1 after it. So a run whose manifest artefact is older
 * than the source it was emitted from **exits 2** and names the package: the
 * tree is not in violation, this run could not see it. See
 * `scripts/lib/emitted-freshness.ts`, where the derivation lives, and the
 * `emitted-manifests` token on the `read:` line, which is how a clean run says
 * which artefact it read.
 *
 * Usage: `tsx scripts/check-action-route-permissions.ts [--list]`
 * Exit 0 = every action's declared code is the one its target enforces (or the
 * disagreement is ledgered); exit 1 = at least one is not, or a ledger entry is
 * stale; exit 2 = the scan read no route or no action, or the manifest artefact
 * it read has been outrun by its source — a green would have meant "not
 * looking" (issue #113).
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). `backend/scripts/check-action-route-permissions.ts` hosts it over this
 * repository's module walk roots, its overlay root and its emitted manifests,
 * and holds `ACTION_PERMISSION_DISAGREEMENTS` — a ledger of *this* tree's owner
 * decisions, which is why the ledger is an argument rather than a value this
 * file reads.
 *
 * `endora check`'s host lands with Phase 3 and its estate entry says why, with
 * the measurement: half this estate writes a permission code as a module-level
 * constant, the reader that follows one is `admin_roles`' `ConstantResolver`,
 * and no module package can reach it. Without it 27 gates in 11 of the 70
 * module packages read as `unreadable` — findings about correct code, which
 * §5.1 refuses.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import {
  moduleIdOf as segmentModuleIdOf,
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';


/** Every admin API path starts here; nothing else is an admin surface. */
const ADMIN_API_PREFIX = '/api/v1/admin';

/**
 * The Fastify shorthand methods a route registration can be written as.
 *
 * `all`, `head` and `options` are here although no shipped route uses them: a
 * reader that only knows the verbs somebody has already typed reports the first
 * `app.all(...)` as nothing at all.
 */
const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'head', 'options']);

/** The verbs a create form submits through — the write half of a surface. */
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** The guard family whose argument is a permission code. */
const GUARD_NAMES = new Set(['requireAdmin', 'requireAdminAny']);

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
  /**
   * Directories whose files belong to a module no `modules/<id>/` segment names
   * — `lib/module-roots.ts`' `hostResidentModules` (feature 080, T040b).
   *
   * `_lifecycle` serves `/api/v1/admin/modules/**`, so without it those routes
   * are read as belonging to no module and the third resolution level — the
   * owning module's own routes — has nothing to fall back to.
   */
  readonly hostResidentModules?: HostResidentModules;
  /**
   * Values for a path identifier that no declaration **in the file** supplies —
   * a registrar mounted under a prefix its caller hands it
   * (`mfa`'s `registerMfaSelfServiceRoutes(app, { pathPrefix })`, called once
   * per subject from another file). Keyed by source file, then identifier.
   *
   * One route is read per value. It is an input rather than something this
   * reader follows across files, because the caller is the one who can say
   * where a registrar is mounted and be held to it.
   */
  readonly pathBindings?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
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

/** What a path expression is read against. */
interface PathContext {
  readonly bindings: ReadonlyMap<string, ts.Expression>;
  /** Every call in the file, by callee name — a local helper's call sites. */
  readonly callsByName: ReadonlyMap<string, readonly ts.CallExpression[]>;
  /** {@link RouteScanInput.pathBindings} for this file. */
  readonly external: ReadonlyMap<string, readonly string[]> | undefined;
  /** Every `name: <initialiser>` in an object literal in the file, by name. */
  readonly propertiesByName: ReadonlyMap<string, readonly ts.Expression[]>;
}

/**
 * A path expression, read as far as it can be.
 *
 * `values` is every string the expression can denote, or `null` when some part
 * of it could not be resolved. `head` is the literal text before the first
 * unresolved part — enough, often, to say that a registration is **not** an
 * admin one (`/api/v1/auth/${surface}/…`) without knowing the rest.
 */
interface PathReading {
  readonly values: readonly string[] | null;
  readonly head: string;
}

const UNREAD: PathReading = { values: null, head: '' };

/** The function a node sits in whose parameter list declares `name`, with the index. */
function enclosingParameter(
  node: ts.Node,
  name: string,
): { readonly fn: ts.FunctionLikeDeclaration; readonly index: number } | null {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isFunctionLike(current) || !('parameters' in current)) continue;
    const fn = current as ts.FunctionLikeDeclaration;
    const index = fn.parameters.findIndex(
      (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
    );
    if (index >= 0) return { fn, index };
  }
  return null;
}

/** The name a local function is called by: `const f = (…) => …` or `function f(…)`. */
function localFunctionName(fn: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null;
  const parent = fn.parent;
  if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

/**
 * The paths a route registration's path argument denotes.
 *
 * The spellings in the tree, all resolved **inside the file**:
 *
 *  - a plain literal;
 *  - a template or a `+` concatenation whose parts resolve
 *    (`${base}/branding`, with `const base = '/api/v1/admin/<module>'`);
 *  - a bare identifier bound to one of those (`app.get(base, …)`);
 *  - a **parameter of a local helper**, read through that helper's call sites
 *    (`const patchRoute = (url, kind) => { app.patch(url, …) }` called three
 *    times with three literals is three routes);
 *  - a **member of a table row** (`cfg.verifyPath`), read as every value the
 *    file assigns to a property of that name.
 *
 * This reader used to accept the first two and silently skip the rest: a
 * registration whose path was an identifier was not a registration at all, so
 * four live admin routes were in no route record and `unreadablePaths` said 0.
 * An argument that still cannot be read is now reported — see
 * {@link RouteScanResult.unreadable}.
 */
function readPath(node: ts.Expression, context: PathContext, depth = 0): PathReading {
  if (depth > 6) return UNREAD;
  const literal = stringLiteralOf(node);
  if (literal !== null) return { values: [literal], head: literal };

  if (ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return readPath(node.expression, context, depth + 1);
  }

  if (ts.isIdentifier(node)) return readIdentifier(node, context, depth);

  // `cfg.setupBeginPath`, with `cfg` one row of a table declared in the file:
  // every `setupBeginPath: …` the file writes is a value it can take.
  if (ts.isPropertyAccessExpression(node)) {
    const initialisers = context.propertiesByName.get(node.name.text) ?? [];
    const values: string[] = [];
    for (const initialiser of initialisers) {
      const reading = readPath(initialiser, context, depth + 1);
      if (reading.values === null) return UNREAD;
      values.push(...reading.values);
    }
    return values.length === 0 ? UNREAD : { values, head: values.length === 1 ? (values[0] ?? '') : '' };
  }

  if (ts.isTemplateExpression(node)) {
    let reading: PathReading = { values: [node.head.text], head: node.head.text };
    for (const span of node.templateSpans) {
      reading = concat(reading, readPath(span.expression, context, depth + 1));
      reading = concat(reading, { values: [span.literal.text], head: span.literal.text });
    }
    return reading;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return concat(readPath(node.left, context, depth + 1), readPath(node.right, context, depth + 1));
  }

  return UNREAD;
}

function concat(left: PathReading, right: PathReading): PathReading {
  if (left.values === null) return left;
  if (right.values === null) {
    // Known so far, unknown from here: the head is what was known. Where the
    // left side is ambiguous there is no single head to speak of.
    return { values: null, head: left.values.length === 1 ? (left.values[0] ?? '') + right.head : '' };
  }
  const values = left.values.flatMap((a) => (right.values ?? []).map((b) => a + b));
  return { values, head: values.length === 1 ? (values[0] ?? '') : '' };
}

function readIdentifier(node: ts.Identifier, context: PathContext, depth: number): PathReading {
  // A parameter first: `bindings` is first-writer-wins over the whole file, and
  // a `const url` somewhere else in it must not answer for this function's `url`.
  const parameter = enclosingParameter(node, node.text);
  if (parameter !== null) {
    const name = localFunctionName(parameter.fn);
    const calls = name === null ? [] : (context.callsByName.get(name) ?? []);
    const values: string[] = [];
    for (const call of calls) {
      const argument = call.arguments[parameter.index];
      const reading = argument === undefined ? UNREAD : readPath(argument, context, depth + 1);
      if (reading.values === null) return UNREAD;
      values.push(...reading.values);
    }
    if (values.length > 0) return { values, head: values.length === 1 ? (values[0] ?? '') : '' };
    return external(node.text, context);
  }

  const bound = context.bindings.get(node.text);
  if (bound !== undefined) {
    const reading = readPath(bound, context, depth + 1);
    if (reading.values !== null) return reading;
  }
  return external(node.text, context);
}

function external(name: string, context: PathContext): PathReading {
  const values = context.external?.get(name);
  if (values === undefined || values.length === 0) return UNREAD;
  return { values: [...values], head: values.length === 1 ? (values[0] ?? '') : '' };
}

/**
 * Whether the literal start of a path settles that it is **not** an admin path:
 * it has diverged from `/api/v1/admin` before the unresolved part began.
 */
function provablyNotAdmin(head: string): boolean {
  if (head === '') return false;
  const compared = Math.min(head.length, ADMIN_API_PREFIX.length);
  return head.slice(0, compared) !== ADMIN_API_PREFIX.slice(0, compared);
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
      // An empty member is unreadable rather than dropped: at runtime it is a
      // code nobody holds, and silently narrowing the any-of would misstate it.
      if (code === null || code === '') return null;
      codes.push(code);
    }
    return codes;
  }
  const code = codeOf(argument);
  if (code === null) return null;
  // `requireAdmin('')` is `requireAdmin()` at runtime — the guard returns as
  // soon as the code is falsy — so it is read as what it does, not as a gate on
  // a code called the empty string.
  return code === '' ? [] : [code];
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

/** A route registration whose path could not be read, and so whose gate was not. */
export interface UnreadableRegistration {
  readonly file: string;
  readonly line: number;
  /** The path argument as written. */
  readonly pathText: string;
}

export interface RouteScanResult {
  readonly routes: readonly AdminRoute[];
  /** `unreadable.length` — kept as a number because the check's summary line prints it. */
  readonly unreadablePaths: number;
  /**
   * Registrations whose path is computed and could not be read, unless the part
   * that *was* read already shows the path is not an admin one.
   */
  readonly unreadable: readonly UnreadableRegistration[];
}

/** The property a route-shaped options object is recognised by. */
const OPTION_KEYS = new Set(['preHandler', 'schema', 'config', 'handler', 'onRequest', 'preValidation']);

/**
 * Whether a `<x>.<verb>(…)` call is a route registration rather than a `Map`
 * read or an HTTP client call.
 *
 * A literal path settles it. Without one the call has to look like a
 * registration in its other arguments: a handler function, or an options object
 * carrying a route option. `cache.get(key)` and `client.post(url, body)` have
 * neither.
 */
function isRegistrationShaped(call: ts.CallExpression): boolean {
  return call.arguments.slice(1).some(
    (argument) =>
      ts.isArrowFunction(argument) ||
      ts.isFunctionExpression(argument) ||
      (ts.isObjectLiteralExpression(argument) &&
        argument.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            OPTION_KEYS.has(property.name.getText()),
        )),
  );
}

/** `app.route({ method, url, … })` — the methods it names, or `null` if it is not one. */
function fullDeclarationOf(
  call: ts.CallExpression,
): { readonly methods: readonly string[] | null; readonly url: ts.Expression; readonly options: ts.ObjectLiteralExpression } | null {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'route') return null;
  const [options] = call.arguments;
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return null;
  let url: ts.Expression | null = null;
  let methods: string[] | null = null;
  let sawMethod = false;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText();
    if (name === 'url') url = property.initializer;
    if (name === 'method') {
      sawMethod = true;
      const elements = ts.isArrayLiteralExpression(property.initializer)
        ? property.initializer.elements
        : [property.initializer];
      const read = elements.map((element) => stringLiteralOf(element));
      methods = read.every((method): method is string => method !== null)
        ? read.map((method) => method.toLowerCase())
        : null;
    }
  }
  if (url === null || !sawMethod) return null;
  return { methods, url, options };
}

/** Every `/api/v1/admin/**` route registration under `sources`, with its gate. */
export function findAdminRoutes(input: RouteScanInput): RouteScanResult {
  const routes: AdminRoute[] = [];
  const unreadable: UnreadableRegistration[] = [];

  for (const [file, text] of input.sources) {
    // A file that neither names the admin prefix nor registers Fastify routes
    // holds nothing to read. The second half is what keeps a registrar mounted
    // under a prefix it is *handed* in the population: it never spells the
    // prefix, and skipping it is how its routes went unread.
    if (!text.includes(ADMIN_API_PREFIX) && !/from 'fastify'/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const bindings = localBindings(sf);
    const moduleId = moduleIdOf(file, input.hostResidentModules);

    const callsByName = new Map<string, ts.CallExpression[]>();
    const collect = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const list = callsByName.get(node.expression.text) ?? [];
        list.push(node);
        callsByName.set(node.expression.text, list);
      }
      node.forEachChild(collect);
    };
    sf.forEachChild(collect);
    const propertiesByName = new Map<string, ts.Expression[]>();
    const collectProperties = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
        const list = propertiesByName.get(node.name.text) ?? [];
        list.push(node.initializer);
        propertiesByName.set(node.name.text, list);
      }
      node.forEachChild(collectProperties);
    };
    sf.forEachChild(collectProperties);
    const context: PathContext = {
      bindings,
      callsByName,
      external: input.pathBindings?.get(file),
      propertiesByName,
    };

    const record = (
      call: ts.CallExpression,
      methods: readonly string[] | null,
      pathArgument: ts.Expression,
      optionsArgument: ts.Node | undefined,
      shaped: boolean,
    ): void => {
      const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
      const reading = readPath(pathArgument, context);
      const pathText = pathArgument.getText().replace(/\s+/g, ' ').slice(0, 120);
      if (reading.values === null) {
        // What was read already shows the path has left the admin prefix.
        if (provablyNotAdmin(reading.head)) return;
        // A call that is not shaped like a registration is only a registration
        // if its path says so in as many words; `rows.get(`${id}:order`, …)`
        // is a template and is not a route.
        if (!shaped && !pathText.includes(ADMIN_API_PREFIX)) return;
        unreadable.push({ file, line, pathText });
        return;
      }
      const admin = reading.values.filter((path) => path.startsWith(ADMIN_API_PREFIX));
      if (admin.length === 0) return;
      if (methods === null) {
        unreadable.push({ file, line, pathText });
        return;
      }
      for (const path of admin) {
        const gate = gateOf(optionsArgument, file, input, bindings);
        for (const method of methods) {
          routes.push({ file, line, method, path, moduleId, clauses: gate.clauses, gateText: gate.text });
        }
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const full = fullDeclarationOf(node);
        if (full !== null) {
          record(node, full.methods, full.url, full.options, true);
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ROUTE_METHODS.has(node.expression.name.text) &&
          node.arguments.length >= 2
        ) {
          const [pathArgument, optionsArgument] = node.arguments;
          if (pathArgument !== undefined) {
            const looksLikePath =
              ts.isStringLiteralLike(pathArgument) || ts.isTemplateExpression(pathArgument);
            if (looksLikePath || isRegistrationShaped(node)) {
              record(node, [node.expression.name.text], pathArgument, optionsArgument, isRegistrationShaped(node));
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }

  routes.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  return { routes, unreadablePaths: unreadable.length, unreadable };
}

/**
 * The module a source key belongs to, or `null` outside every module tree.
 *
 * The two anchored answers are the application's, on keys relative to its own
 * `src/`. The third is `lib/module-population.ts`' segment reader, which is what
 * attributes a module that has become a workspace package — its key is
 * repository-relative and starts with neither `modules` nor `apps` (feature
 * 080, T040a).
 */
export function moduleIdOf(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): string | null {
  const segments = file.split('/');
  if (segments[0] === 'modules') return segments[1] ?? null;
  // `apps/<deployment>/modules/<id>/…` — an overlay module is an ordinary
  // lifecycle participant and owns its actions the same way (feature 057).
  if (segments[0] === 'apps' && segments[2] === 'modules') return segments[3] ?? null;
  return segmentModuleIdOf(file, hostResident);
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

/**
 * A route's permission clauses, rendered for a message. Exported because the
 * sentence is part of the rule: an author outside this checkout reads the same
 * one this repository's run prints.
 */
export function renderClauses(clauses: readonly (readonly string[])[]): string {
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
  ledger: Readonly<Record<string, string>>,
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
  ledger: Readonly<Record<string, string>>,
): AnalysisResult {
  const scan = findAdminRoutes(input);
  return { ...checkActionRoutePermissions({ actions: input.actions, routes: scan.routes }, ledger), scan };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Every TypeScript source under `dir`, with the rule's own prunes applied.
 *
 * Exported because the population is part of the rule: two hosts computing
 * "which files this check reads" two ways is the shape that lets one of them go
 * half-blind.
 */
export function collectRouteSources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectRouteSources(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}
