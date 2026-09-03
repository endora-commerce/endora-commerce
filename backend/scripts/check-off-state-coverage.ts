/**
 * CI check — **every module with an activation control is the argument of an
 * `expectModuleAbsent` call** (feature 073,
 * `specs/073-lifecycle-gating-completion/contracts/off-state-coverage-ratchet.md`).
 *
 * Constitution XVII item 6 asks every module for an off-state test proving API
 * rejection, admin absence, non-editable configuration, storefront absence and
 * full restoration, and for the deactivated-while-platform-available case
 * specifically. Which modules actually have one was re-derived by hand three
 * times and produced **three different answers** — 15, 23 and 20 — and the two
 * careful attempts before the contract were wrong *in both directions at once*.
 * A rule re-derived by hand, wrongly, twice, is a rule the estate does not
 * hold. This is the instrument that holds it.
 *
 * ## The predicate, and the three load-bearing words in it
 *
 * > A module with an **activation control** is the **argument** of an
 * > **`expectModuleAbsent`** call somewhere in the harness-caller walk.
 *
 * **Argument, never path.** Both hand derivations keyed on the directory a test
 * file sits at, and that is precisely the defect: `payments` is named by six
 * files and **not one of them is under `payments/`` — they are the five gateway
 * modules and `payment_methods`, each asserting its own degradation.
 * `credit_limits` is named by five, three of them under `orders/`, `returns/`
 * and `organizations/`. Nine files sitting inside a module's own directory name
 * a *different* module, and `customers` — the largest module in the residue —
 * is named only from `_admin_surfaces/`, a directory under no module at all. So
 * the subject of a call is what the call *names*, resolved through the shapes
 * the tree actually writes: see {@link resolveSubject}.
 *
 * **`expectModuleAbsent`, not `withModuleOff`.** They are not interchangeable
 * and the difference *is* the tiering. `withModuleOff` is a state seam — a
 * palette test uses it, a consumer's fail-closed test uses it, an *exemption*
 * test uses it to prove a surface keeps answering while its module is off. Only
 * `expectModuleAbsent` asserts item 6's five things at once. A module named
 * exclusively by `withModuleOff` has an off-state mention and no off-state
 * proof, which is exactly the residue feature 073's F5 drained. There is
 * deliberately **no separate finding** for that state: it *is*
 * `uncovered-module`, and two findings for one condition are two numbers
 * waiting to disagree.
 *
 * **Activation control, derived from the manifest.** The population is every
 * module the generated manifest index registers whose manifest declares
 * `activation.settingCode` as a string. The 24 modules that declare
 * `nonDeactivatable` are excluded deliberately and the exclusion is measured
 * rather than assumed: they have no operator axis, so item 6's
 * deactivated-while-platform-available clause has no subject for them, and
 * widening the population to every registered module would land this check with
 * 21 findings — a ledger that starts full, which is a ledger nobody drains and
 * a number somebody eventually raises. If the platform axis is to be held for
 * locked modules too, that is a **second** predicate over a second population.
 *
 * **`health_checks` is outside the population by derivation, not by a ledger
 * entry.** It declares no activation block at all and every route it owns is
 * exempted from gating through `ctx.ungatedRoutes` (D-36b), so there is no seam
 * an `expectModuleAbsent` could assert — its probes are *required* to keep
 * answering while it is off. That its class has exactly one member is pinned,
 * independently, by `test/unit/_lifecycle/non-deactivatable-set.test.ts`;
 * writing it in here would be a derived fact copied into a second place (D-100).
 *
 * ## An unregistered subject, and the one derivation that excuses it
 *
 * `unknown-subject` refuses an id the index does not register — a test asserting
 * the absence of a module that does not exist passes vacuously for ever, and it
 * is usually a rename nobody followed. Two files in the tree name an id the
 * platform genuinely does not register and are right to: the harness's own
 * proof builds `fixture_gated` / `fixture_ungated` /
 * `fixture_non_deactivatable`, and `shipments/carrier-module-off.test.ts`
 * builds `demo_carrier`. Neither is an exception to write down — **the file
 * puts the id into the registry cache itself**, which is what makes it a module
 * for the length of that file and nowhere else, and
 * {@link locallyDeclaredModuleIds} reads that off the same source text. It
 * fails closed: a seeding written through a name the analysis cannot read
 * leaves the subject unknown and reported, which is the direction to be wrong
 * in. A path exclusion would have done the same job and would have been the
 * defect this check exists to replace, one surface over.
 *
 * ## What is excluded from the caller walk, and it is one file
 *
 * `test/helpers/off-state.ts` — the harness itself. §2's predicate is about the
 * harness's *callers*; the file that declares it is not one, and its own two
 * `withModuleOff(moduleId, …)` sites take a function parameter that no analysis
 * can resolve to an id. Its path is **exact**, never a filename rule, and it is
 * already the subject of the fifth vacuous refusal below — so a harness that
 * moved is a refusal rather than an exclusion matching nothing.
 *
 * ## What it does not cover, stated rather than discovered later
 *
 *   * **Whether a proof is any good.** `expectModuleAbsent` asserts item 6's
 *     five things and refuses an empty `routes` declaration; this check asks
 *     only that a module is its subject.
 *   * **A module proved by a bespoke `it`.** `seo`'s sitemap answers XML and
 *     the harness reads every body as JSON, so it was hand-asserted for a
 *     while; it carries an ordinary `expectModuleAbsent` today over its JSON
 *     routes. A module that ships *only* a bespoke proof is `uncovered-module`,
 *     and the honest repairs are to widen the harness or to widen the resolver —
 *     never a ledger entry, whose reason would belong to the harness rather than
 *     to the module.
 *   * **A stale emitted manifest.** The population is read out of the generated
 *     index, which resolves a module package through its `exports` map at its
 *     build output; a module whose activation control was added in source and
 *     not built is not yet in the population. That exposure is the estate's
 *     rather than this check's — 19 backend checks import a package's
 *     `dist/manifest.js` and one is wired to `emitted-freshness` — and it is in
 *     the defect register rather than repaired here.
 *   * **The admin and storefront halves** of an off-state proof. They are
 *     asserted inside the harness and in each batch's paired admin file.
 *
 * Usage: `tsx scripts/check-off-state-coverage.ts [--list]`
 * Exit 0 = every module with an activation control has a proof; exit 1 = at
 * least one does not, or the ledger has gone stale; exit 2 = the run could not
 * see the population it judges — no registered module, none of them switchable,
 * a caller walk that opened no file, a walk that resolved no `expectModuleAbsent`
 * site, a harness that is not where the check looks or no longer exports both
 * names, and a harness that grew a third assertion helper.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

import { deploymentsOnDisk, overlayModulesRootFor } from '../src/overlay/overlay-roots.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

const PREFIX = '[off-state-coverage]';

/**
 * The two harness seams, and the identifiers the predicate keys on.
 *
 * The order is the tiering: the first asserts item 6, the second only drives
 * state. `harness-exports` reconciles this list against the harness's own
 * source on every run, so a third assertion helper refuses the run rather than
 * being judged out of it.
 */
export const ASSERTION_HELPER = 'expectModuleAbsent';
export const STATE_HELPER = 'withModuleOff';
export const HARNESS_NAMES: readonly string[] = [ASSERTION_HELPER, STATE_HELPER];

/**
 * Which argument names the module, per helper.
 *
 * `expectModuleAbsent(server, moduleId, surfaces)` and
 * `withModuleOff(moduleId, axis, body)` — read off the harness's signatures
 * rather than guessed, and asserted by the companion test.
 */
const SUBJECT_ARGUMENT: Readonly<Record<string, number>> = {
  [ASSERTION_HELPER]: 1,
  [STATE_HELPER]: 0,
};

/** The methods a test calls to put a module into the registry cache itself. */
const REGISTRY_SEEDING_METHODS: readonly string[] = [
  '__setEnabledForTesting',
  'setActivationDeclarations',
];

/** The array methods whose first callback parameter binds one element. */
const ELEMENT_CALLBACK_METHODS: readonly string[] = ['forEach', 'map', 'flatMap'];

/**
 * The exemption ledger — module id → why it still owes no proof.
 *
 * **It lands empty**, which is the cheapest possible moment to lock an
 * invariant and the only moment at which a ledger is empty on the day it
 * arrives (`check:bundle-pairing`'s argument, and it applies identically here).
 * All 46 modules with an activation control are covered.
 *
 * An entry is a strong claim: *this module has an activation control and still
 * owes no `expectModuleAbsent` proof*. The one module in the tree that
 * genuinely cannot carry one is outside the population by derivation instead.
 * A reason naming another module's switchability is subject to
 * `check:lock-claims`, which reads reason strings in ledgers held inside checks
 * — so an entry resting on "`X` is always present" goes red the day `X`'s
 * manifest says otherwise, with no ledger to edit.
 *
 * An entry that ever reads "this module has no admin surface" or "no
 * storefront" means the predicate has been misread: **a "none" is answered
 * inside the test file, in its doc block, not by an exemption from having one
 * at all.**
 */
export const OFF_STATE_COVERAGE_EXEMPT: Readonly<Record<string, string>> = {};

export type OffStateCoverageFindingKind =
  | 'uncovered-module'
  | 'unresolvable-subject'
  | 'unknown-subject'
  | 'stale-ledger-entry'
  | 'orphan-ledger-entry'
  | 'ledger-entry-without-a-reason';

/** One registered module, as the generated index and its manifest describe it. */
export interface ModuleUnderCheck {
  readonly moduleId: string;
  /**
   * `activation.settingCode` — a string for a module with an operator axis,
   * `null` for one that declares `nonDeactivatable` or no activation block at
   * all. The population is exactly the modules for which this is a string.
   */
  readonly activationSettingCode: string | null;
}

/** One file of the caller walk: its display path and its whole text. */
export interface HarnessCallerFile {
  readonly path: string;
  readonly text: string;
}

/** One resolved harness call. */
export interface HarnessSite {
  readonly file: string;
  /** 1-based, so a reader can open it. */
  readonly line: number;
  readonly helper: string;
  /** Every module id this one call names — a table-driven call names many. */
  readonly subjects: readonly string[];
  /** The argument's source text, for the sentence an author reads. */
  readonly expression: string;
  /** False when the argument could not be read as a literal id at all. */
  readonly resolved: boolean;
}

export interface OffStateCoverageFinding {
  readonly kind: OffStateCoverageFindingKind;
  /** The module, or the id the tree named — every finding has a subject. */
  readonly moduleId: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly detail: string;
}

export interface OffStateCoverageInput {
  readonly modules: readonly ModuleUnderCheck[];
  readonly files: readonly HarnessCallerFile[];
  /** Defaults to {@link OFF_STATE_COVERAGE_EXEMPT}. */
  readonly ledger?: Readonly<Record<string, string>>;
  /**
   * Per-deployment overlay module ids this checkout ships.
   *
   * They exist and they are switchable, so naming one is not
   * `unknown-subject` — but they are **not** in the population, because the
   * population is what the *generated manifest index* registers and that index
   * is bare core under every value of `DEPLOYMENT` (D-104). An overlay module's
   * off-state proof is a per-deployment concern, exactly as its permission
   * inventory is, and holding one here would mean every deployment's overlay
   * modules owing a proof to a run that composes none of them.
   */
  readonly deploymentModules?: readonly string[];
}

export interface OffStateCoverageResult {
  readonly findings: readonly OffStateCoverageFinding[];
  /** Every harness call walked, both helpers — the read line's `sites`. */
  readonly sites: readonly HarnessSite[];
  /** Module ids with an activation control, sorted. */
  readonly population: readonly string[];
  /** Those of them an `expectModuleAbsent` call names, sorted. */
  readonly covered: readonly string[];
  /** Those excused by the ledger and reported clean, sorted. */
  readonly exempt: readonly string[];
  /**
   * `expectModuleAbsent` calls whose subject the walk resolved. Zero is the
   * dangerous silence — see {@link vacuousOffStateCoverage} condition 4.
   */
  readonly resolvedAssertionSites: number;
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * What a name is bound to, as far as this analysis can see.
 *
 * `element` is the one that matters: a name bound to *one member* of a table,
 * by `it.each`, `describe.each`, `.forEach`, `.map` or `for…of`. A call under
 * such a binding names every member at once, which is why a site carries a list
 * of subjects rather than one.
 */
type Binding =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'table'; readonly elements: readonly ts.Expression[] }
  | { readonly kind: 'element'; readonly elements: readonly ts.Expression[] };

/** Strip the wrappers that carry no meaning for a literal. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) current = current.expression;
    else if (ts.isAsExpression(current)) current = current.expression;
    else if (ts.isSatisfiesExpression(current)) current = current.expression;
    else if (ts.isNonNullExpression(current)) current = current.expression;
    else if (ts.isTypeAssertionExpression(current)) current = current.expression;
    else return current;
  }
}

/** A string literal's text, or `null` — template substitutions are not literals. */
function literalText(node: ts.Expression): string | null {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  return null;
}

/** The table a callback's first parameter is bound to, or `null`. */
function elementSourceOf(fn: ts.SignatureDeclaration): ts.Expression | null {
  const call = fn.parent;
  if (call === undefined || !ts.isCallExpression(call)) return null;
  if (!call.arguments.some((argument) => argument === (fn as unknown as ts.Expression))) return null;

  // `it.each(TABLE)(name, cb)` / `describe.each(TABLE)(name, cb)`
  const callee = call.expression;
  if (ts.isCallExpression(callee)) {
    const inner = callee.expression;
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'each') {
      return callee.arguments[0] ?? null;
    }
    return null;
  }
  // `TABLE.forEach(cb)` / `.map(cb)`
  if (ts.isPropertyAccessExpression(callee) && ELEMENT_CALLBACK_METHODS.includes(callee.name.text)) {
    return callee.expression;
  }
  return null;
}

/** The elements of a table expression, or `null` when it cannot be read. */
function elementsOf(expression: ts.Expression): readonly ts.Expression[] | null {
  const inner = unwrap(expression);
  if (ts.isArrayLiteralExpression(inner)) return inner.elements;
  if (ts.isIdentifier(inner)) {
    const bound = lookupBinding(inner, inner.text);
    return bound !== null && bound.kind === 'table' ? bound.elements : null;
  }
  return null;
}

/** How a `const` initialiser reads, or `null` when it reads as neither. */
function classifyInitializer(initializer: ts.Expression | undefined): Binding | null {
  if (initializer === undefined) return null;
  const text = literalText(initializer);
  if (text !== null) return { kind: 'string', value: text };
  const inner = unwrap(initializer);
  if (ts.isArrayLiteralExpression(inner)) return { kind: 'table', elements: inner.elements };
  return null;
}

/** The declaration of `name` among a scope's own statements, or `undefined`. */
function declarationIn(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): ts.VariableDeclaration | undefined {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
  return undefined;
}

/**
 * What `name` is bound to at `from`, resolved **lexically**.
 *
 * The nearest binding wins, which is not decoration: `off-state-harness.test.ts`
 * declares `CORE = 'audit_logs'` at file scope and shadows it with
 * `CORE = 'fixture_non_deactivatable'` inside a second `describe`, and a
 * file-wide map answers one of them for both call sites. An ordinary function
 * parameter resolves to **nothing** rather than falling through to an outer
 * binding of the same spelling — "the analysis cannot follow this" is not "this
 * is not a module id", and the fail-closed answer is a finding.
 */
function lookupBinding(from: ts.Node, name: string): Binding | null {
  let current: ts.Node | undefined = from;
  while (current !== undefined) {
    if (ts.isForOfStatement(current)) {
      const list = current.initializer;
      if (
        ts.isVariableDeclarationList(list) &&
        list.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
        )
      ) {
        const elements = elementsOf(current.expression);
        return elements === null ? null : { kind: 'element', elements };
      }
    }
    if (ts.isFunctionLike(current)) {
      const index = current.parameters.findIndex(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
      );
      if (index !== -1) {
        if (index !== 0) return null;
        const source = elementSourceOf(current);
        if (source === null) return null;
        const elements = elementsOf(source);
        return elements === null ? null : { kind: 'element', elements };
      }
    }
    if (ts.isSourceFile(current) || ts.isBlock(current) || ts.isModuleBlock(current)) {
      const declaration = declarationIn(current.statements, name);
      if (declaration !== undefined) return classifyInitializer(declaration.initializer);
    }
    current = current.parent;
  }
  return null;
}

/** Every member of `elements` read as a literal id, or `null` if any cannot be. */
function literalsOf(elements: readonly ts.Expression[]): string[] | null {
  const ids: string[] = [];
  for (const element of elements) {
    const text = literalText(element);
    // Partial resolution is the worst of both: it credits the members it read
    // and says nothing about the ones it did not.
    if (text === null) return null;
    ids.push(text);
  }
  return ids;
}

/** Every member's `property`, or `null` if any member does not carry one. */
function membersOf(elements: readonly ts.Expression[], property: string): string[] | null {
  const ids: string[] = [];
  for (const element of elements) {
    const inner = unwrap(element);
    if (!ts.isObjectLiteralExpression(inner)) return null;
    const assignment = inner.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
        candidate.name.text === property,
    );
    if (assignment === undefined) return null;
    const text = literalText(assignment.initializer);
    if (text === null) return null;
    ids.push(text);
  }
  return ids;
}

/**
 * Every module id one subject expression names, or `null` when it names none
 * the analysis can read.
 *
 * The shapes are the ones the tree writes, and each was measured rather than
 * guessed: a string literal; a file-local `const` alias; a member of an object
 * literal in an `it.each` / `describe.each` / `.forEach` / `.map` / `for…of`
 * binding; and a loop over bare string literals. Dropping the `each` shape
 * alone loses four subjects on this tree and turns nine correct sites into
 * `unresolvable-subject` findings.
 */
export function resolveSubject(expression: ts.Expression): string[] | null {
  const node = unwrap(expression);

  const direct = literalText(node);
  if (direct !== null) return [direct];

  if (ts.isIdentifier(node)) {
    const bound = lookupBinding(node, node.text);
    if (bound === null) return null;
    if (bound.kind === 'string') return [bound.value];
    if (bound.kind === 'element') return literalsOf(bound.elements);
    // An array is not a module id.
    return null;
  }

  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const bound = lookupBinding(node.expression, node.expression.text);
    if (bound === null || bound.kind !== 'element') return null;
    return membersOf(bound.elements, node.name.text);
  }

  return null;
}

/** Parse one caller file. */
function parse(file: HarnessCallerFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.ES2022,
    true,
    file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Every node under `root`, in source order. */
function walkNodes(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root);
  ts.forEachChild(root, (child) => walkNodes(child, visit));
}

/**
 * Every harness call in one file, with the module ids each one names.
 *
 * A **call**, read as an AST node — three files in the tree mention
 * `expectModuleAbsent` only in a doc block saying why they do not use it, and a
 * text scan credits all three with a proof they explicitly declined to write.
 */
export function harnessSitesIn(file: HarnessCallerFile): readonly HarnessSite[] {
  const source = parse(file);
  const sites: HarnessSite[] = [];
  walkNodes(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (!ts.isIdentifier(callee)) return;
    const helper = callee.text;
    const index = SUBJECT_ARGUMENT[helper];
    if (index === undefined) return;
    const argument = node.arguments[index];
    const subjects = argument === undefined ? null : resolveSubject(argument);
    sites.push({
      file: file.path,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      helper,
      subjects: subjects ?? [],
      expression: argument === undefined ? '(no argument)' : argument.getText(source),
      resolved: subjects !== null,
    });
  });
  return sites;
}

/**
 * Module ids this file puts into the registry cache itself.
 *
 * A synthetic module exists for the length of one file and is registered by
 * nobody, so the index cannot know it and `unknown-subject` would report it.
 * The exemption is derived from the same source text — the file's own
 * `__setEnabledForTesting` / `setActivationDeclarations` calls, read as
 * literals — rather than from a list of files, because a path exclusion is the
 * defect this check exists to replace.
 *
 * It fails closed: a seeding whose ids arrive through a name the analysis
 * cannot read (`__setEnabledForTesting(ALL_IDS)`) contributes nothing, so the
 * subject stays unknown and is reported.
 */
export function locallyDeclaredModuleIds(file: HarnessCallerFile): ReadonlySet<string> {
  const source = parse(file);
  const declared = new Set<string>();
  walkNodes(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !REGISTRY_SEEDING_METHODS.includes(callee.name.text)
    ) {
      return;
    }
    for (const argument of node.arguments) {
      walkNodes(argument, (inner) => {
        if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
          declared.add(inner.text);
          return;
        }
        // A property *name* is not a value; only an identifier in value
        // position can be an alias for an id.
        if (!ts.isIdentifier(inner)) return;
        if (inner.parent !== undefined && ts.isPropertyAssignment(inner.parent) && inner.parent.name === inner) {
          return;
        }
        const bound = lookupBinding(inner, inner.text);
        if (bound !== null && bound.kind === 'string') declared.add(bound.value);
      });
    }
  });
  return declared;
}

// ---------------------------------------------------------------------------
// The harness, read rather than assumed
// ---------------------------------------------------------------------------

/**
 * The **callable** helpers `off-state.ts` exports, from its source text.
 *
 * Exported types are not counted: `OffStateAxis`, `OffStateProbe` and
 * `OffStateSurfaces` are the caller's vocabulary and not a seam a subject can
 * be the argument of, so counting them would make the floor 2/5 and refuse
 * every run.
 */
export function harnessExportedFunctions(source: string): string[] {
  const file = ts.createSourceFile('off-state.ts', source, ts.ScriptTarget.ES2022, true);
  const names: string[] = [];
  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported !== true) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      names.push(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer === undefined || !ts.isIdentifier(declaration.name)) continue;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          names.push(declaration.name.text);
        }
      }
    }
  }
  return names.sort();
}

/**
 * `harness-exports:<recognised>/<exported>` — the independent author of "what a
 * harness call is called".
 *
 * The predicate keys on two identifiers. If the harness grows a third assertion
 * helper this goes short and the shared reporter refuses the run, rather than
 * this check silently judging two seams out of three.
 */
export function harnessExportsCoverage(source: string): ReadCoverage {
  const exported = harnessExportedFunctions(source);
  return {
    source: 'harness-exports',
    expected: exported.length,
    covered: exported.filter((name) => HARNESS_NAMES.includes(name)).length,
  };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/**
 * The findings, over the modules, the source text and the ledger handed in.
 *
 * Pure, and over exactly what a real run reads (issue #130): a fixture of
 * pre-resolved subjects would prove the set arithmetic — which is four lines —
 * and leave the resolver, which is the whole of this check's risk, unproven.
 */
export function checkOffStateCoverage(input: OffStateCoverageInput): OffStateCoverageResult {
  const ledger = input.ledger ?? OFF_STATE_COVERAGE_EXEMPT;
  const indexRegistered = new Set(input.modules.map((module) => module.moduleId));
  // "Does this module exist?" — the index's answer plus the deployments'.
  const registered = new Set([...indexRegistered, ...(input.deploymentModules ?? [])]);
  const population = input.modules
    .filter((module) => typeof module.activationSettingCode === 'string')
    .map((module) => module.moduleId)
    .sort();

  const findings: OffStateCoverageFinding[] = [];
  const sites: HarnessSite[] = [];
  const asserted = new Set<string>();
  let resolvedAssertionSites = 0;

  for (const file of input.files) {
    const fileSites = harnessSitesIn(file);
    if (fileSites.length === 0) continue;
    const synthetic = locallyDeclaredModuleIds(file);
    for (const site of fileSites) {
      sites.push(site);
      if (!site.resolved) {
        findings.push({
          kind: 'unresolvable-subject',
          moduleId: site.expression,
          file: site.file,
          line: site.line,
          detail:
            `${site.helper}(…) names its module as \`${site.expression}\`, which this ` +
            'analysis cannot read as a literal id',
        });
        continue;
      }
      if (site.helper === ASSERTION_HELPER) resolvedAssertionSites += 1;
      for (const subject of site.subjects) {
        if (!registered.has(subject) && !synthetic.has(subject)) {
          findings.push({
            kind: 'unknown-subject',
            moduleId: subject,
            file: site.file,
            line: site.line,
            detail:
              `${site.helper}(…) names "${subject}", which the manifest index does not ` +
              'register and this file does not seed into the registry cache itself',
          });
          continue;
        }
        if (site.helper === ASSERTION_HELPER) asserted.add(subject);
      }
    }
  }

  const covered = population.filter((moduleId) => asserted.has(moduleId));
  const exempt: string[] = [];

  for (const moduleId of population) {
    if (asserted.has(moduleId)) continue;
    if (Object.prototype.hasOwnProperty.call(ledger, moduleId)) {
      exempt.push(moduleId);
      continue;
    }
    findings.push({
      kind: 'uncovered-module',
      moduleId,
      file: null,
      line: null,
      detail:
        `declares an activation control and is the argument of no ${ASSERTION_HELPER} ` +
        'call, so nothing proves it is absent while an operator has it switched off',
    });
  }

  for (const [moduleId, reason] of Object.entries(ledger)) {
    if (reason.trim().length === 0) {
      findings.push({
        kind: 'ledger-entry-without-a-reason',
        moduleId,
        file: null,
        line: null,
        detail: 'the entry carries no reason, so it is an exemption nobody can disagree with',
      });
    }
    if (!population.includes(moduleId)) {
      findings.push({
        kind: 'orphan-ledger-entry',
        moduleId,
        file: null,
        line: null,
        detail: indexRegistered.has(moduleId)
          ? 'the module no longer declares an activation control, so it is outside the population'
          : 'the manifest index does not register this module at all',
      });
      continue;
    }
    if (asserted.has(moduleId)) {
      findings.push({
        kind: 'stale-ledger-entry',
        moduleId,
        file: null,
        line: null,
        detail: `the module is now the argument of an ${ASSERTION_HELPER} call`,
      });
    }
  }

  return {
    findings,
    sites,
    population,
    covered,
    exempt: exempt.sort(),
    resolvedAssertionSites,
  };
}

// ---------------------------------------------------------------------------
// The vacuous refusals
// ---------------------------------------------------------------------------

export type VacuousReasonKind =
  | 'no-registered-module'
  | 'no-activation-control'
  | 'no-caller-file'
  | 'no-assertion-site'
  | 'harness-not-found';

export interface VacuousReason {
  readonly kind: VacuousReasonKind;
  readonly message: string;
}

export interface VacuousInput {
  readonly modules: readonly ModuleUnderCheck[];
  readonly files: readonly HarnessCallerFile[];
  /** The harness's exact path, and its source — `null` when it is not there. */
  readonly harness: { readonly path: string; readonly source: string | null };
}

/**
 * Why this run may not report on what it read, or `null`.
 *
 * A green must not be able to mean "not looking" (issue #113), and for this
 * check the dangerous silence is **not** an empty walk: an empty walk reports
 * 46 findings, loudly. It is a walk that reads the wrong thing and a population
 * that came back empty.
 *
 * Pure and over the record a real run hands in, so a red proof enters where a
 * real run enters. The sixth condition — a harness that grew a third assertion
 * helper — is not here: it is a *short walk* against an independent
 * derivation, and `read-size.ts` refuses it in the shared grammar.
 */
export function vacuousOffStateCoverage(input: VacuousInput): VacuousReason | null {
  if (input.modules.length === 0) {
    return {
      kind: 'no-registered-module',
      message:
        'the generated manifest index registers no module, so the population this check ' +
        'judges is empty and every predicate over it is vacuously true',
    };
  }
  if (!input.modules.some((module) => typeof module.activationSettingCode === 'string')) {
    return {
      kind: 'no-activation-control',
      message:
        'no registered module declares `activation.settingCode`, so the population is empty ' +
        'and every module is vacuously covered — the shape `check:bundle-pairing` refuses ' +
        'for the same reason its predicate is a conditional',
    };
  }
  if (input.harness.source === null) {
    return {
      kind: 'harness-not-found',
      message:
        `the off-state harness is not at ${input.harness.path}. The predicate keys on the ` +
        `identifiers \`${ASSERTION_HELPER}\` and \`${STATE_HELPER}\`, so a harness that ` +
        'moved makes every call site invisible while this check reports on a population it ' +
        'can no longer see',
    };
  }
  const exported = harnessExportedFunctions(input.harness.source);
  const missing = HARNESS_NAMES.filter((name) => !exported.includes(name));
  if (missing.length > 0) {
    return {
      kind: 'harness-not-found',
      message:
        `${input.harness.path} no longer exports ${missing.join(' or ')}. A rename there ` +
        'makes every call site invisible, and a walk that finds none of them reports every ' +
        'module in the population as uncovered',
    };
  }
  if (input.files.length === 0) {
    return {
      kind: 'no-caller-file',
      message:
        'the caller walk opened no file at all — the test roots moved, and a finding count ' +
        'over an empty input is not a clean tree',
    };
  }
  const resolved = input.files
    .flatMap((file) => [...harnessSitesIn(file)])
    .filter((site) => site.helper === ASSERTION_HELPER && site.resolved);
  if (resolved.length === 0) {
    return {
      kind: 'no-assertion-site',
      message:
        `the walk resolved no ${ASSERTION_HELPER} site. With a whole population of ` +
        'switchable modules this state is reported as one finding per module — loud, and ' +
        'the opposite of the truth: it is a finding about the walk dressed as a finding ' +
        `about the tree. (${STATE_HELPER} sites alone never satisfy the predicate.)`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/** The remedy paragraph, one per finding kind. */
const REMEDIES: Readonly<Record<OffStateCoverageFindingKind, string>> = {
  'uncovered-module':
    'Constitution XVII item 6: ship an off-state test proving API rejection, admin absence, ' +
    'non-editable configuration and storefront absence while off, plus full restoration. ' +
    "Call `expectModuleAbsent(server, '<id>', { routes: […], … })` from " +
    '`test/integration/<module>/off-state.test.ts` — a bare `withModuleOff` is a state seam ' +
    'and asserts none of that. A surface the module genuinely does not have is answered in ' +
    "the test file's doc block, naming the property of the module that makes it absent; it " +
    'is never an exemption from having a proof at all.',
  'unresolvable-subject':
    'Write the module id as a string literal, a file-local `const`, or a member of the ' +
    '`it.each` / `for…of` table the call is under. An unreadable subject is a finding rather ' +
    'than a skip (issue #113): reading it as "some module is covered" is the direction that ' +
    'agrees with the defect.',
  'unknown-subject':
    'The manifest index does not register this module. It is usually a rename nobody ' +
    'followed, and a test asserting the absence of a module that does not exist passes ' +
    'vacuously for ever. A synthetic fixture module is exempt when the same file seeds it ' +
    'into the registry cache in literals the analysis can read.',
  'stale-ledger-entry':
    'Delete the `OFF_STATE_COVERAGE_EXEMPT` entry — the module has a proof now. The ledger ' +
    'is two-way, so an entry that no longer describes the tree is a finding.',
  'orphan-ledger-entry':
    'Delete the `OFF_STATE_COVERAGE_EXEMPT` entry — the module is not in the population, ' +
    'either because the index does not register it or because it declares no activation ' +
    'control. A locked module has no operator axis and owes nothing here.',
  'ledger-entry-without-a-reason':
    'Write the sentence. An exemption whose reason nobody wrote is an exemption nobody can ' +
    'disagree with, and this ledger is meant to stay empty.',
};

interface LoadedModules {
  readonly modules: readonly ModuleUnderCheck[];
  /** How many entries the index carried, whether or not their manifest read. */
  readonly registered: number;
}

async function loadModules(indexPath: string): Promise<LoadedModules> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifest?: { activation?: { settingCode?: unknown } };
    }>;
  };
  const entries = loaded.DISCOVERED_MANIFESTS ?? [];
  const modules: ModuleUnderCheck[] = [];
  for (const entry of entries) {
    if (entry.manifest === undefined) continue;
    const settingCode = entry.manifest.activation?.settingCode;
    modules.push({
      moduleId: entry.id,
      activationSettingCode: typeof settingCode === 'string' ? settingCode : null,
    });
  }
  return { modules, registered: entries.length };
}

/**
 * Every per-deployment overlay module this checkout ships, over every
 * deployment rather than the one `DEPLOYMENT` selects.
 *
 * `deploymentsOnDisk` and `overlayModulesRootFor` are the overlay path's own
 * root derivation, reused rather than re-spelled; what is added here is the
 * rule `overlay-runtime.ts` states in its own words — *an overlay module is
 * discovered by its directory and identified by its manifest*. The whole set
 * and not the active one, for the reason `overlay:check` gives: an artefact
 * only a run nobody makes would check is an artefact nothing checks.
 */
function deploymentModuleIds(): string[] {
  const ids = new Set<string>();
  for (const deployment of deploymentsOnDisk()) {
    const root = overlayModulesRootFor(deployment);
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const carriesManifest = ['manifest.ts', 'manifest.js'].some((name) => {
        try {
          return statSync(join(root, entry.name, name)).isFile();
        } catch {
          return false;
        }
      });
      if (carriesManifest) ids.add(entry.name);
    }
  }
  return [...ids].sort();
}

/** Every `.ts`/`.tsx` file under `root`, in a stable order. */
function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
    }
  };
  visit(root);
  return found;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const backendRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

  // The harness's **exact** path, never a filename rule — and the test root is
  // derived from it rather than spelled a second time, so the walk and the
  // vacuous guard cannot come to disagree about where the tests are.
  const harnessPath = join(backendRoot, 'test', 'helpers', 'off-state.ts');
  const testRoot = dirname(dirname(harnessPath));
  let harnessSource: string | null;
  try {
    harnessSource = statSync(harnessPath).isFile() ? readFileSync(harnessPath, 'utf8') : null;
  } catch {
    harnessSource = null;
  }

  const loaded = await loadModules(layout.manifestIndexPath);

  const files: HarnessCallerFile[] = [];
  for (const path of sourceFilesUnder(testRoot)) {
    // The harness declares the two names; it is not a caller of them, and its
    // own `withModuleOff(moduleId, …)` sites take a parameter no analysis can
    // read. Excluded by exact path, which the refusal above already guards.
    if (path === harnessPath) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!HARNESS_NAMES.some((name) => text.includes(name))) continue;
    files.push({ path: relative(layout.repoRoot, path), text });
  }

  const vacuous = vacuousOffStateCoverage({
    modules: loaded.modules,
    files,
    harness: { path: relative(layout.repoRoot, harnessPath), source: harnessSource },
  });
  if (vacuous !== null) {
    console.error(`${PREFIX} ${vacuous.message}; refusing to report a vacuous pass`);
    process.exit(2);
  }

  const deploymentModules = deploymentModuleIds();
  const result = checkOffStateCoverage({ modules: loaded.modules, files, deploymentModules });

  if (listMode) {
    for (const moduleId of result.population) {
      const state = result.covered.includes(moduleId)
        ? 'PROVEN '
        : result.exempt.includes(moduleId)
          ? 'EXEMPT '
          : 'MISSING';
      console.log(`${state} ${moduleId}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: files.length,
    sites: result.sites.length,
    coverage: [
      // Every entry the index carries, classified — the independent author of
      // "which modules exist and which of them have an operator axis". The
      // check computes no list of module ids of its own, and a module gaining
      // or losing an activation control moves the population in the same run.
      {
        source: 'manifest-index',
        expected: loaded.registered,
        covered: loaded.modules.length,
      },
      // The sixth vacuous condition, in the shared grammar: a third exported
      // assertion helper is `2/3`, which the reporter refuses as a short walk.
      harnessExportsCoverage(harnessSource ?? ''),
    ],
  });
  console.log(
    `${PREFIX} switchable=${result.population.length} proven=${result.covered.length} ` +
      `exempt=${result.exempt.length} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const where = finding.file === null ? '' : ` (${finding.file}:${finding.line})`;
      console.error(`  - ${finding.moduleId}${where}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
