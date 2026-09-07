/**
 * CI check — **a client component does not fetch its own first-paint content**
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-020…FR-022;
 * `contracts/rsc-discipline-check.md`).
 *
 * ## The claim
 *
 * A component whose first-paint content comes from a network call inside an
 * effect renders nothing to a crawler. The server sends the loading branch —
 * a skeleton, an empty list, a `null` — and the effect that would replace it
 * never runs, because there is no browser. This is D-31's rule, *"data reaches
 * the renderer through a provider, never a fetch inside the component"*,
 * enforced for the first time, and Constitution VII's obligation as a static
 * signal.
 *
 * ## The population is derived, and that is the whole difference
 *
 * `contracts/rsc-discipline-check.md` §2. The roadmap's row for this rule reads
 * *"`grep -rl "'use client'" storefront/components` classifies 54 files"* — and
 * **all five known instances of the defect live in
 * `packages/cms-components/src/components/`**, which that population does not
 * reach. A check scoped to the application would have reported zero and been
 * wrong on the day it landed. So the walk is the storefront application **and
 * every workspace package the storefront composes**, taken from
 * `storefront/package.json`'s own `dependencies`: a `@endora-commerce/*`
 * workspace member that declares `react`. That declaration is the package's own
 * statement that it ships React components, so a fourth package the storefront
 * starts composing joins the walk with no edit here, and
 * `@endora-commerce/contracts` — schemas, no React — stays out of it without
 * being named.
 *
 * The same derivation is the run's **second author**:
 * `sources=storefront-deps:<covered>/<expected>` is how many of those packages
 * contributed a file, and a package that contributed none is a short walk
 * (issue #215 over this population). The application's own files would
 * otherwise keep `files=` respectable while a 43-file package dropped out in
 * silence.
 *
 * ## The predicate
 *
 * Three facts about one component, in conjunction (§3):
 *
 *   1. the file declares `'use client'`;
 *   2. it initialises state that its render **branches on** before returning
 *      content — an `isLoading` guard, an empty-array guard, a `null` guard;
 *   3. that state is written inside a `useEffect` that calls something the file
 *      imported — a fetch helper, an API module function, `fetch` itself.
 *
 * Clause 3 is the contract's, read at the **effect's** granularity rather than
 * the setter's, and the worked example is why: `ProductGrid`'s effect awaits
 * `fetchProductsList` and then calls `setIsLoading(false)`, whose *argument* is
 * a literal. A per-setter dataflow rule would clear `isLoading` — the state
 * whose gate returns the skeleton a crawler receives — and report only
 * `products`. So the rule is "this effect fetches, and it writes this state".
 *
 * `react` and `react-dom` are excluded from the imported set: they are the hook
 * machinery the predicate is *about*, not a source of content.
 *
 * ### FR-022 — deferred content is not first-paint content
 *
 * A component whose result renders only after an interaction is correct and is
 * not reported. The discriminator is whether the gated render is reachable on
 * first paint, and the contract's honest implementation of that is: a component
 * whose body sits behind an `open`/`isOpen`-style binding that is a prop, or is
 * state initialising falsy, is deferred.
 *
 * That leans on a **name**, which is a heuristic and is declared as one
 * ({@link OPENNESS_STEMS}). It fails in the safe direction: a gate this
 * vocabulary does not recognise is *reported*, and the author answers with a
 * ledger entry saying the content is not first-paint. What it must never do is
 * excuse a gate it cannot read — an undecidable openness gate is
 * **`unclassifiable-render-gate`**, because "deferred" as the default answer
 * for the undecidable case excuses everything (issue #113).
 *
 * ## Findings
 *
 *   * **`client-fetch-on-first-paint`** — the centre. The three clauses hold
 *     and the gate is reachable on first paint.
 *   * **`unclassifiable-render-gate`** — the three clauses hold and the
 *     component carries an openness gate whose initial value the analysis
 *     cannot decide. Reported *instead of* the first finding, never beside it:
 *     it is the classification of one candidate, not a second candidate.
 *   * **`stale-ledger-entry`**, **`ledger-entry-without-a-reason`**,
 *     **`ledger-entry-without-a-retiring-condition`** — the ledger's other
 *     direction. A debt with no retiring condition is a permanent exemption
 *     written as a temporary one.
 *
 * ## What it cannot see, stated here rather than discovered later (§3)
 *
 *   * A fetch reached through a custom hook in another file. The analysis is
 *     one file deep.
 *   * A fetch in a `useLayoutEffect` or a `useSyncExternalStore` subscription.
 *   * A component whose gate is a context value rather than local state — which
 *     is what a **correct** provider-based block looks like, so this blindness
 *     is in the right direction.
 *   * The `admin` SPA, out of scope by design: a client application behind a
 *     login, with no crawler.
 *   * An openness gate spelled `if (open) …` rather than `if (!open) return`,
 *     or reached through an object (`!props.isOpen`, where the binding in scope
 *     is `props`). Both read as *not deferred* — a candidate is reported and
 *     its author answers with a ledger entry, which is the direction a blind
 *     spot in an exemption has to fail in.
 *   * A render branch written `{isLoading && <Skeleton />}`. It renders the
 *     skeleton *beside* the content rather than instead of it, so it is not the
 *     early return this predicate is about; a component that also hides its
 *     content that way is invisible here.
 *
 * Usage: `tsx scripts/check-rsc-discipline.ts [--list]`
 * Exit 0 = every composed client component keeps its first-paint content on the
 * server; exit 1 = at least one finding; exit 2 = the run could not see the
 * population it judges.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { reportReadSize } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

const PREFIX = '[rsc-discipline]';

/** The application whose composed tree this rule is about. */
const STOREFRONT_ROOT = 'storefront';

/** The scope whose members are this repository's own packages. */
const WORKSPACE_SCOPE = '@endora-commerce/';

/**
 * Directories a source walk never descends into. Build output and installed
 * packages are not this repository's sources, and `.next` holds a compiled copy
 * of the very files being judged.
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

export type RscDisciplineFindingKind =
  | 'client-fetch-on-first-paint'
  | 'unclassifiable-render-gate'
  | 'stale-ledger-entry'
  | 'ledger-entry-without-a-reason'
  | 'ledger-entry-without-a-retiring-condition';

/** One `.tsx` file, as source text: the top of the analysis. */
export interface ClientSourceFile {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  readonly text: string;
}

/** An application or a workspace package whose files the walk covers. */
export interface ComposedPackage {
  /** The manifest `name`, printed in the shortfall message. */
  readonly name: string;
  /** The ledger shard its files are recorded in. */
  readonly shard: string;
  /** Repo-relative directory prefix its files sit under. */
  readonly root: string;
  /**
   * Whether it counts toward `storefront-deps`. The application itself does
   * not: it is the walk's own root, so counting it would let the second author
   * corroborate the walk with the walk.
   */
  readonly composed: boolean;
}

/** One recorded first-paint fetch, in the shard its file belongs to. */
export interface ClientFetchLedgerEntry {
  /**
   * Whether the gated content is first-paint content. `true` is real debt;
   * `false` is the entry that says this content need not be crawlable, and its
   * reason must say why — a personalised strip, a session-dependent widget.
   * "Defensive" and "deferred for performance" are not reasons.
   */
  readonly firstPaint: boolean;
  readonly reason: string;
  /** What retires the entry. An entry with none is a finding. */
  readonly retiredBy: string;
}

export type ClientFetchLedgerShard = Readonly<Record<string, ClientFetchLedgerEntry>>;

/** Shard name, then `(file, state name)`. */
export type ClientFetchLedger = Readonly<Record<string, ClientFetchLedgerShard>>;

export interface RscDisciplineInput {
  readonly files: readonly ClientSourceFile[];
  readonly composedPackages: readonly ComposedPackage[];
  readonly ledger: ClientFetchLedger;
}

export interface RscDisciplineFinding {
  readonly kind: RscDisciplineFindingKind;
  /** Repo-relative file the finding is about. */
  readonly path: string;
  /** The state variable, which with the path is the ledger key. */
  readonly state: string | null;
  readonly detail: string;
}

/** One state a component's render branches on, and how it is written. */
export interface StateGateSite {
  readonly path: string;
  readonly state: string;
  /** The component function the state and its gate live in. */
  readonly component: string;
  /** How the openness question was answered for this candidate. */
  readonly reachability: 'first-paint' | 'deferred' | 'undecidable';
  /** The openness binding, where there was one. */
  readonly gate: string | null;
}

export interface RscDisciplineResult {
  readonly findings: readonly RscDisciplineFinding[];
  /** Every file opened — the read line's `files`. */
  readonly filesRead: readonly string[];
  /** Those that declare `'use client'`. */
  readonly clientFiles: readonly string[];
  /** `useEffect` callbacks classified — the read line's `sites`. */
  readonly effects: number;
  /** Every candidate the predicate produced, ledgered or not. */
  readonly candidates: readonly StateGateSite[];
  /** Composed packages the walk should have covered. */
  readonly packagesExpected: number;
  /** Those that contributed at least one file. */
  readonly packagesCovered: number;
}

// ---------------------------------------------------------------------------
// The ledger key
// ---------------------------------------------------------------------------

/**
 * `(file, state name)` — **never a line**, so an insertion above the site does
 * not red an entry that still describes it, and an edited component does.
 */
export function ledgerKey(path: string, state: string): string {
  return `${path}#${state}`;
}

/**
 * The shard a file's entries live in: the longest composed root that prefixes
 * it. A cut that repairs one package touches that package's file and nobody
 * else's.
 */
export function shardOf(path: string, packages: readonly ComposedPackage[]): string | null {
  let best: ComposedPackage | null = null;
  for (const candidate of packages) {
    if (path !== candidate.root && !path.startsWith(`${candidate.root}/`)) continue;
    if (best === null || candidate.root.length > best.root.length) best = candidate;
  }
  return best === null ? null : best.shard;
}

// ---------------------------------------------------------------------------
// Clause 1 — the marker
// ---------------------------------------------------------------------------

/**
 * Whether the file opens with the `'use client'` directive.
 *
 * Read off the leading run of string-literal expression statements, which is
 * where a directive prologue lives; a `'use client'` further down the file is
 * not a directive and Next does not treat it as one.
 */
export function declaresUseClient(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) return false;
    const expression = statement.expression;
    if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
      return false;
    }
    if (expression.text === 'use client') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Clause 3 — what the file imported
// ---------------------------------------------------------------------------

/** Module specifiers whose imports are hook machinery rather than content. */
const NON_CONTENT_MODULES = new Set(['react', 'react-dom']);

/**
 * Value bindings the file imported, plus `fetch`.
 *
 * Type-only imports are excluded because they call nothing, and `react` /
 * `react-dom` because `useState` and friends are what this predicate is about
 * rather than a source of content.
 */
export function importedValueNames(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>(['fetch']);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier;
    if (ts.isStringLiteral(specifier) && NON_CONTENT_MODULES.has(specifier.text)) continue;
    if (clause.name !== undefined) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      names.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      names.add(element.name.text);
    }
  }
  return names;
}

/** The identifier a call expression ultimately calls, for a readable callee. */
function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return calleeName(expression.expression);
  if (ts.isCallExpression(expression)) return calleeName(expression.expression);
  return null;
}

// ---------------------------------------------------------------------------
// FR-022 — the openness vocabulary
// ---------------------------------------------------------------------------

/**
 * The stems that make a binding an `open`/`isOpen`-style gate.
 *
 * A declared vocabulary and therefore a heuristic, which is what
 * `contracts/rsc-discipline-check.md` §3 calls the honest implementation of
 * "reachable on first paint". It is deliberately short: a name outside it is
 * *reported*, and the author answers with a ledger entry that says the content
 * is not first-paint. Widening it silently excuses components; the ledger
 * excuses them with a sentence somebody can disagree with.
 */
export const OPENNESS_STEMS: readonly string[] = ['open', 'expand', 'visible', 'collaps'];

function isOpennessName(name: string): boolean {
  const lowered = name.toLowerCase();
  return OPENNESS_STEMS.some((stem) => lowered.includes(stem));
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface StateBinding {
  readonly name: string;
  readonly setter: string | null;
  readonly initializer: ts.Expression | undefined;
}

interface GateSite {
  readonly state: string;
  readonly position: number;
}

interface OpennessGate {
  readonly binding: string;
  readonly position: number;
}

interface ComponentScope {
  readonly node: ts.Node;
  readonly name: string;
  readonly states: StateBinding[];
  readonly gates: GateSite[];
  readonly opennessGates: OpennessGate[];
  /** Parameter names, so a prop-driven openness gate is decidable. */
  readonly parameters: Set<string>;
  /** State names written by an effect that also calls an imported function. */
  readonly fetchedStates: Set<string>;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** The name a component function is known by, for the finding's sentence. */
function componentNameOf(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) return node.name.text;
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return '(anonymous)';
}

function nearestFunction(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

/** The nearest ancestor that is a component scope, walking past plain callbacks. */
function scopeOf(node: ts.Node, scopes: Map<ts.Node, ComponentScope>): ComponentScope | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    const scope = scopes.get(current);
    if (scope !== undefined) return scope;
    current = current.parent;
  }
  return null;
}

function collectParameters(node: ts.Node, into: Set<string>): void {
  if (!isFunctionLike(node)) return;
  for (const parameter of (node as ts.SignatureDeclaration).parameters ?? []) {
    if (ts.isIdentifier(parameter.name)) {
      into.add(parameter.name.text);
      continue;
    }
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        if (ts.isIdentifier(element.name)) into.add(element.name.text);
      }
    }
  }
}

function forEachDescendant(node: ts.Node, visit: (child: ts.Node) => void): void {
  node.forEachChild((child) => {
    visit(child);
    forEachDescendant(child, visit);
  });
}

function hookName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text;
  return null;
}

/**
 * Whether the condition is a falsy test of an openness-named binding —
 * `!open`, `!props.isOpen`, `open === false`.
 */
function opennessGateOf(condition: ts.Expression): string | null {
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
    const name = calleeName(condition.operand);
    const leaf = ts.isPropertyAccessExpression(condition.operand)
      ? condition.operand.name.text
      : name;
    if (leaf !== null && isOpennessName(leaf)) return leaf;
    return null;
  }
  if (ts.isBinaryExpression(condition)) {
    const isFalseTest =
      (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
      condition.right.kind === ts.SyntaxKind.FalseKeyword;
    if (!isFalseTest) return null;
    const leaf = ts.isPropertyAccessExpression(condition.left)
      ? condition.left.name.text
      : ts.isIdentifier(condition.left)
        ? condition.left.text
        : null;
    if (leaf !== null && isOpennessName(leaf)) return leaf;
  }
  return null;
}

/** Whether a statement returns without falling through to the content below. */
function containsReturn(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  let found = false;
  forEachDescendant(statement, (child) => {
    if (ts.isReturnStatement(child) && nearestFunction(child) === nearestFunction(statement)) {
      found = true;
    }
  });
  return found;
}

/** Whether the node sits inside a `return` of `owner`, rather than of a callback. */
function isInsideReturn(node: ts.Node, owner: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && current !== owner) {
    if (ts.isReturnStatement(current)) return true;
    current = current.parent;
  }
  return false;
}

/** Identifiers a gate condition mentions. */
function referencedIdentifiers(node: ts.Node): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.add(child.text);
  };
  visit(node);
  forEachDescendant(node, visit);
  return names;
}

interface FileAnalysis {
  readonly isClient: boolean;
  readonly effects: number;
  readonly candidates: readonly StateGateSite[];
}

/**
 * One file, from its source text — the whole classifier.
 *
 * Exported so a red proof enters here rather than over a record this function
 * would otherwise have computed (issue #130).
 */
export function analyzeClientSource(path: string, text: string): FileAnalysis {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (!declaresUseClient(source)) return { isClient: false, effects: 0, candidates: [] };

  const imported = importedValueNames(source);
  const scopes = new Map<ts.Node, ComponentScope>();

  // Pass 1 — the scopes. A scope is a function that calls `useState`. An effect
  // callback calls none, so it is never a scope of its own and its writes are
  // attributed to the component that holds it, which is what makes the effect's
  // setters and the render's gates land in one record.
  forEachDescendant(source, (node) => {
    if (!ts.isCallExpression(node) || hookName(node) !== 'useState') return;
    const owner = nearestFunction(node);
    if (owner === null || scopes.has(owner)) return;
    const parameters = new Set<string>();
    collectParameters(owner, parameters);
    scopes.set(owner, {
      node: owner,
      name: componentNameOf(owner),
      states: [],
      gates: [],
      opennessGates: [],
      parameters,
      fetchedStates: new Set<string>(),
    });
  });

  // Pass 2 — clause 2's declarations: `const [value, setValue] = useState(init)`.
  // Its own pass, so a state declared after the effect that writes it is still
  // there to be reconciled; source order is React's convention rather than a
  // rule, and a classifier that depended on it would be blind at random.
  forEachDescendant(source, (node) => {
    if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return;
    const initializer = node.initializer;
    if (!ts.isCallExpression(initializer) || hookName(initializer) !== 'useState') return;
    const owner = nearestFunction(initializer);
    const scope = owner === null ? undefined : scopes.get(owner);
    if (scope === undefined || !ts.isArrayBindingPattern(node.name)) return;
    const [first, second] = node.name.elements;
    const name =
      first !== undefined && ts.isBindingElement(first) && ts.isIdentifier(first.name)
        ? first.name.text
        : null;
    const setter =
      second !== undefined && ts.isBindingElement(second) && ts.isIdentifier(second.name)
        ? second.name.text
        : null;
    if (name !== null) scope.states.push({ name, setter, initializer: initializer.arguments[0] });
  });

  // Pass 3 — clause 3's effects and clause 2's gates.
  let effects = 0;
  forEachDescendant(source, (node) => {
    if (ts.isCallExpression(node) && hookName(node) === 'useEffect') {
      effects += 1;
      const scope = scopeOf(node, scopes);
      const callback = node.arguments[0];
      if (scope === null || callback === undefined) return;
      let fetches = false;
      const written = new Set<string>();
      forEachDescendant(callback, (child) => {
        if (!ts.isCallExpression(child)) return;
        // A dynamic `import()` *is* the file importing something, and it is the
        // clearest possible statement that this effect leaves the process.
        // `CmsProductCard` reaches its fetch helper that way, and a predicate
        // reading only the static import list clears it — three of the five
        // known defects were invisible to one shape or the other, which is why
        // clause 3 counts both.
        if (child.expression.kind === ts.SyntaxKind.ImportKeyword) {
          fetches = true;
          return;
        }
        const name = calleeName(child.expression);
        if (name === null) return;
        if (imported.has(name)) fetches = true;
        written.add(name);
      });
      // Clause 3 is read at the *effect's* granularity, not the setter's:
      // `setIsLoading(false)`'s argument is a literal, and `isLoading` is
      // nonetheless the state whose gate a crawler receives.
      if (!fetches) return;
      for (const state of scope.states) {
        if (state.setter !== null && written.has(state.setter)) scope.fetchedStates.add(state.name);
      }
      return;
    }

    // Clause 2's second spelling: a conditional *expression* inside the
    // component's own `return`. `{isLoading ? <Skeleton /> : items.length === 0
    // ? <Empty /> : <List />}` is the same branch as three early returns, and
    // `CategoryList` and `CategoryGrid` — two of the five known defects — write
    // it that way. A predicate that read only `if … return` found neither.
    if (ts.isConditionalExpression(node)) {
      const owner = nearestFunction(node);
      if (owner === null) return;
      const scope = scopes.get(owner);
      if (scope === undefined || !isInsideReturn(node, owner)) return;
      const position = node.getStart(source);
      const openness = opennessGateOf(node.condition);
      if (openness !== null) scope.opennessGates.push({ binding: openness, position });
      for (const name of referencedIdentifiers(node.condition)) {
        scope.gates.push({ state: name, position });
      }
      return;
    }

    // An `if` whose *nearest function* is the component itself — so a `return`
    // inside an effect callback or a `map` callback is not a render gate.
    if (!ts.isIfStatement(node)) return;
    const owner = nearestFunction(node);
    if (owner === null) return;
    const scope = scopes.get(owner);
    if (scope === undefined) return;
    if (!containsReturn(node.thenStatement)) return;
    const position = node.getStart(source);
    const openness = opennessGateOf(node.expression);
    if (openness !== null) scope.opennessGates.push({ binding: openness, position });
    for (const name of referencedIdentifiers(node.expression)) {
      scope.gates.push({ state: name, position });
    }
  });

  const candidates: StateGateSite[] = [];
  for (const scope of scopes.values()) {
    for (const state of scope.states) {
      if (!scope.fetchedStates.has(state.name)) continue;
      const gate = scope.gates.find((candidate) => candidate.state === state.name);
      if (gate === undefined) continue;
      const reachability = reachabilityOf(scope, gate);
      candidates.push({
        path,
        state: state.name,
        component: scope.name,
        reachability: reachability.verdict,
        gate: reachability.binding,
      });
    }
  }
  candidates.sort((a, b) => a.state.localeCompare(b.state));
  return { isClient: true, effects, candidates };
}

/**
 * Whether the gated render is reachable on first paint (FR-022).
 *
 * Three answers and no fourth: a decidably falsy openness gate defers the body,
 * a decidably truthy one does not, and anything else is `undecidable` — which
 * is reported. Taking the undecidable case for "deferred" excuses everything,
 * which is the whole reason this finding exists.
 */
function reachabilityOf(
  scope: ComponentScope,
  gate: GateSite,
): { verdict: 'first-paint' | 'deferred' | 'undecidable'; binding: string | null } {
  // "Behind" is positional: an openness gate *after* the state gate does not
  // defer it, because the state gate has already returned.
  const chosen = scope.opennessGates
    .filter((candidate) => candidate.position < gate.position)
    .sort((a, b) => a.position - b.position)[0];
  if (chosen === undefined) return { verdict: 'first-paint', binding: null };
  // A prop: the parent decides whether this body is on screen, so the body is
  // behind an interaction wherever the parent puts it.
  if (scope.parameters.has(chosen.binding)) return { verdict: 'deferred', binding: chosen.binding };
  const state = scope.states.find((candidate) => candidate.name === chosen.binding);
  if (state === undefined) return { verdict: 'undecidable', binding: chosen.binding };
  const initializer = state.initializer;
  if (initializer === undefined) return { verdict: 'deferred', binding: chosen.binding };
  if (isFalsyLiteral(initializer)) return { verdict: 'deferred', binding: chosen.binding };
  if (isTruthyLiteral(initializer)) return { verdict: 'first-paint', binding: chosen.binding };
  return { verdict: 'undecidable', binding: chosen.binding };
}

function isFalsyLiteral(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(expression) && expression.text === 'undefined') return true;
  if (ts.isNumericLiteral(expression) && expression.text === '0') return true;
  if (ts.isStringLiteral(expression) && expression.text === '') return true;
  return false;
}

function isTruthyLiteral(expression: ts.Expression): boolean {
  return expression.kind === ts.SyntaxKind.TrueKeyword;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export function checkRscDiscipline(input: RscDisciplineInput): RscDisciplineResult {
  const findings: RscDisciplineFinding[] = [];
  const filesRead: string[] = [];
  const clientFiles: string[] = [];
  const candidates: StateGateSite[] = [];
  const covered = new Set<string>();
  let effects = 0;

  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    filesRead.push(file.path);
    const owner = input.composedPackages.find(
      (candidate) =>
        candidate.composed &&
        (file.path === candidate.root || file.path.startsWith(`${candidate.root}/`)),
    );
    if (owner !== undefined) covered.add(owner.name);
    const analysis = analyzeClientSource(file.path, file.text);
    effects += analysis.effects;
    if (!analysis.isClient) continue;
    clientFiles.push(file.path);
    candidates.push(...analysis.candidates);
  }

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.reachability === 'deferred') continue;
    const key = ledgerKey(candidate.path, candidate.state);
    const shard = shardOf(candidate.path, input.composedPackages);
    const entry = shard === null ? undefined : input.ledger[shard]?.[key];
    if (candidate.reachability === 'undecidable') {
      findings.push({
        kind: 'unclassifiable-render-gate',
        path: candidate.path,
        state: candidate.state,
        detail:
          `${candidate.component} gates its render on \`${candidate.state}\`, which an effect ` +
          `writes after calling something the file imported, behind \`${candidate.gate ?? '?'}\` ` +
          'whose initial value the analysis cannot decide. Deferred or first-paint is not ' +
          'readable here, and the undecidable case may not default to deferred.',
      });
      seen.add(`${shard ?? ''}\0${key}`);
      continue;
    }
    seen.add(`${shard ?? ''}\0${key}`);
    if (entry === undefined) {
      findings.push({
        kind: 'client-fetch-on-first-paint',
        path: candidate.path,
        state: candidate.state,
        detail:
          `${candidate.component} returns early on \`${candidate.state}\`, which a \`useEffect\` ` +
          'writes after calling something the file imported. A crawler receives that early ' +
          'return and nothing else.',
      });
      continue;
    }
    if (entry.reason.trim().length === 0) {
      findings.push({
        kind: 'ledger-entry-without-a-reason',
        path: candidate.path,
        state: candidate.state,
        detail: `the entry for \`${candidate.state}\` records the debt and says nothing about it.`,
      });
    }
    if (entry.retiredBy.trim().length === 0) {
      findings.push({
        kind: 'ledger-entry-without-a-retiring-condition',
        path: candidate.path,
        state: candidate.state,
        detail:
          `the entry for \`${candidate.state}\` names nothing that retires it, which is a ` +
          'permanent exemption written as a temporary one.',
      });
    }
  }

  for (const [shard, entries] of Object.entries(input.ledger)) {
    for (const key of Object.keys(entries)) {
      if (seen.has(`${shard}\0${key}`)) continue;
      const separator = key.lastIndexOf('#');
      findings.push({
        kind: 'stale-ledger-entry',
        path: separator === -1 ? key : key.slice(0, separator),
        state: separator === -1 ? null : key.slice(separator + 1),
        detail:
          `\`${shard}\`'s ledger records \`${key}\`, and this run found no such candidate. ` +
          'Either the component was repaired — delete the entry — or it moved and the entry ' +
          'moved with nothing.',
      });
    }
  }

  const expected = input.composedPackages.filter((candidate) => candidate.composed);
  return {
    findings,
    filesRead,
    clientFiles,
    effects,
    candidates,
    packagesExpected: expected.length,
    packagesCovered: expected.filter((candidate) => covered.has(candidate.name)).length,
  };
}

// ---------------------------------------------------------------------------
// The refusals — contract §4, over the record a run produces
// ---------------------------------------------------------------------------

export type RscDisciplineRefusalKind =
  | 'no-source-file'
  | 'no-client-component'
  | 'nothing-classified';

export interface RscDisciplineRefusal {
  readonly kind: RscDisciplineRefusalKind;
  readonly message: string;
}

/**
 * Why this run may not report on what it read, or `null`.
 *
 * Pure and over the record, so a red proof enters where a real run enters
 * (issue #130). The fourth refusal — a composed package that contributed no
 * file — is `readSizeRefusal`'s `short-walk` over the
 * `storefront-deps:<covered>/<expected>` token, so #215's predicate is stated
 * once for the estate rather than re-implemented here.
 */
export function vacuousReason(result: RscDisciplineResult): RscDisciplineRefusal | null {
  if (result.filesRead.length === 0) {
    return {
      kind: 'no-source-file',
      message:
        'the walk opened no `.tsx` file at all — a finding count over an empty input is not a ' +
        'clean tree',
    };
  }
  if (result.clientFiles.length === 0) {
    return {
      kind: 'no-client-component',
      message:
        "not one file in the population declares `'use client'`. The predicate's first clause " +
        'is the marker, so a marker whose spelling or whose walk stopped working reports every ' +
        'component clean',
    };
  }
  if (result.effects === 0) {
    return {
      kind: 'nothing-classified',
      message:
        'no `useEffect` was classified in any client component. That is the state where the ' +
        'file count stands still and the syntax walk has gone blind (#237): a healthy `files=` ' +
        'beside a cheerful `findings=0` over a tree nothing is reading',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The CLI half
// ---------------------------------------------------------------------------

const REMEDIES: Readonly<Record<RscDisciplineFindingKind, string>> = {
  'client-fetch-on-first-paint':
    'Move the read to the server. The component takes its content as a prop from a Server ' +
    'Component, or — for a page-builder block — through the `load` seam ' +
    '`specs/096-page-builder-block-ownership/` D-31 defines, so the data reaches the renderer ' +
    'through a provider rather than a fetch inside the component. Where the content genuinely ' +
    'need not be crawlable (a personalised strip, a session-dependent widget), record it in ' +
    '`backend/scripts/ledgers/client-fetches-on-first-paint/<shard>.ts` with `firstPaint: ' +
    'false` and a sentence saying why. "Defensive" and "deferred for performance" are not ' +
    'reasons.',
  'unclassifiable-render-gate':
    'Make the gate readable: initialise the openness state with a literal, or take the ' +
    'openness value as a prop. The analysis reports what it cannot decide rather than excusing ' +
    'it, because "deferred" as the default answer for the undecidable case excuses every ' +
    'component in the tree.',
  'stale-ledger-entry':
    'Delete the entry. It is either a repaired component — which is the point of a two-way ' +
    'ledger — or a file that moved, in which case the entry moved with nothing and the real ' +
    'site is now unrecorded.',
  'ledger-entry-without-a-reason':
    'Write the reason. The entry is what a reader disagrees with; a recorded debt that says ' +
    'nothing about itself cannot be argued with and will never be drained.',
  'ledger-entry-without-a-retiring-condition':
    'Name what retires the entry — the feature, the seam or the decision that removes it. An ' +
    'entry with no retiring condition is a permanent exemption written as a temporary one.',
};

/**
 * The packages the storefront composes, from its own `dependencies`.
 *
 * A workspace member under `@endora-commerce/` that declares `react` — the
 * package's own statement that it ships React components. Nothing here names a
 * package, so a fourth one the storefront starts composing joins the walk with
 * no edit, and `@endora-commerce/contracts` stays out of it without being
 * excluded by name.
 */
export function composedPackagesOf(repoRoot: string): readonly ComposedPackage[] {
  const fs = nodeWorkspaceFs();
  const members = workspaceMembers(repoRoot, fs);
  const storefront = members.find((member) => member.name === STOREFRONT_ROOT);
  const packages: ComposedPackage[] = [
    { name: STOREFRONT_ROOT, shard: STOREFRONT_ROOT, root: STOREFRONT_ROOT, composed: false },
  ];
  const dependencies = (storefront?.manifest['dependencies'] ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(dependencies).sort()) {
    if (!name.startsWith(WORKSPACE_SCOPE)) continue;
    const member = members.find((candidate) => candidate.name === name);
    if (member === undefined) continue;
    const declares = (key: string): boolean => {
      const block = member.manifest[key];
      return typeof block === 'object' && block !== null && 'react' in (block as object);
    };
    if (!declares('peerDependencies') && !declares('dependencies')) continue;
    packages.push({
      name,
      shard: name.slice(WORKSPACE_SCOPE.length),
      root: relative(repoRoot, member.dir).split(sep).join('/'),
      composed: true,
    });
  }
  return packages;
}

function walkTsx(repoRoot: string, root: string): ClientSourceFile[] {
  const files: ClientSourceFile[] = [];
  const walk = (directory: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      files.push({
        path: relative(repoRoot, full).split(sep).join('/'),
        text: readFileSync(full, 'utf8'),
      });
    }
  };
  walk(join(repoRoot, root));
  return files;
}

const LEDGER_ROOT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'ledgers',
  'client-fetches-on-first-paint',
);

/**
 * Every shard, keyed by the application or package it records.
 *
 * Imported rather than parsed, in `check:module-docs`' shape: the shard is
 * TypeScript, `tsc` holds its declared entry type, and a reader that read the
 * file as text would be a second answer to what the file says. Three refusals,
 * all of them "read nothing" rather than "found nothing": a directory that is
 * not there, a shard exporting no `entries`, and an empty shard — a done signal
 * that says nothing is not one, and the file should be deleted instead.
 */
export async function loadClientFetchLedger(
  directory: string = LEDGER_ROOT,
): Promise<ClientFetchLedger> {
  if (!existsSync(directory)) {
    throw new Error(
      `the client-fetch ledger directory is not at ${directory} — a two-way ledger whose ` +
        'shards cannot be read reports every recorded site as retired and every real one as ' +
        'unledgered; refusing to report on either',
    );
  }
  const ledger: Record<string, ClientFetchLedgerShard> = {};
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.ts')) continue;
    const shard = name.slice(0, -'.ts'.length);
    const loaded = (await import(pathToFileURL(join(directory, name)).href)) as {
      entries?: unknown;
    };
    const entries = loaded.entries;
    if (typeof entries !== 'object' || entries === null) {
      throw new Error(`ledger shard '${shard}' exports no 'entries' record`);
    }
    if (Object.keys(entries).length === 0) {
      throw new Error(
        `ledger shard '${shard}' is empty — delete the file instead. An empty shard is a done ` +
          'signal that says nothing.',
      );
    }
    ledger[shard] = entries as ClientFetchLedgerShard;
  }
  return ledger;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const composedPackages = composedPackagesOf(repoRoot);
  const files = composedPackages.flatMap((entry) => walkTsx(repoRoot, entry.root));

  let ledger: ClientFetchLedger;
  try {
    ledger = await loadClientFetchLedger();
  } catch (error) {
    console.error(`${PREFIX} ${(error as Error).message}`);
    process.exit(2);
  }

  const result = checkRscDiscipline({ files, composedPackages, ledger });

  const refusal = vacuousReason(result);
  if (refusal !== null) {
    console.error(`${PREFIX} ${refusal.message}; refusing to report a vacuous pass`);
    process.exit(2);
  }

  if (listMode) {
    for (const candidate of result.candidates) {
      console.log(
        `${candidate.reachability.padEnd(12)} ${candidate.path}#${candidate.state} ` +
          `(${candidate.component}${candidate.gate === null ? '' : `, gate ${candidate.gate}`})`,
      );
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead.length,
    sites: result.effects,
    coverage: [
      {
        source: 'storefront-deps',
        expected: result.packagesExpected,
        covered: result.packagesCovered,
      },
    ],
  });
  console.log(
    `${PREFIX} clients=${result.clientFiles.length} effects=${result.effects} ` +
      `candidates=${result.candidates.length} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      console.error(
        `  - ${finding.path}${finding.state === null ? '' : `#${finding.state}`}\n` +
          `      ${finding.detail}`,
      );
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
