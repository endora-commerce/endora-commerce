import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
// Comments removed by the parser rather than by an ordered pair of regexes
// (issue #241). This file is where the ordered pair was wrong: block-first, a
// `//` line ending in a route glob at `test-server.ts:1544` opened a comment
// that ran 1135 lines, and `runBootHooks(`, `errorEnvelope` and
// `resolvePreferredLanguage` were all invisible to every assertion below.
// Issue #234 fixed the order; #241 removed the order from the question.
import { codeOnly } from '../../../scripts/lib/source-text.js';
import { MODULES } from '../../../src/composition.generated.js';
// D-72 point 5 — the same manifest index `check-port-dependencies` and
// `check-port-catches` read, so "which modules the platform refuses to switch
// off" has one source in the tree rather than one per consumer.
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
// Feature 112 — where the platform's own source lives, derived from the one
// workspace member declaring `endora.type: "platform"` rather than spelled, so
// the seam derivation below follows the host wherever it moves.
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';
// Feature 109 (1c) — how a bare specifier is followed back to the source it was
// compiled from. The harness delegates its composition to a package now, and a
// package resolves at its build output (D-164); reading that would hold this
// file's ledgers to the previous build rather than to this branch.
import {
  emittingPackages,
  nodeFreshnessFs,
  sourceOfEmitted,
} from '../../../scripts/lib/emitted-freshness.js';

/**
 * The two composition roots, held to each other (feature 072, US6 / T075–T076).
 *
 * The harness is not a smaller version of production — it is a **second
 * composition root**, hand-maintained, and every difference between the two is
 * a class of bug the suite structurally cannot catch. That is a worse failure
 * than a missing test, because the suite reports green while the difference
 * exists: production wires something the harness never builds, so the code path
 * that uses it is exercised in a shape no deployment runs.
 *
 * Two properties are pinned here, and neither is "the harness is correct":
 *
 *  1. **A converted module costs no test-helper edit** (T075). The whole point
 *     of the generated composer is that adding a module is adding a file. If
 *     the harness has to be taught about each one, the sweep pays the cost 66
 *     times and the next contributor pays it again.
 *  2. **The drift is an exact ledger** (T076). Every construct production
 *     builds and the harness does not is listed below with what it costs. An
 *     entry going stale is a failure, and so is a new one appearing — the point
 *     is that the list can only be changed deliberately.
 *
 * Source-level assertions, deliberately. Booting both roots to compare them
 * would cost two compositions per run, and the property being checked is a
 * property of the *wiring*, which is what the source is.
 *
 * **A third property was added in feature 112 and its population is not two.**
 * T075 and T076 are about production and the harness *agreeing*; the block at
 * the foot of this file is about every root that composes the generated
 * `MODULES` list — five of them today, derived — offering every `ModuleContext`
 * seam a module of that list uses. That is a different question with a
 * different population, and it is kept in this file because the subject is the
 * same one: what a composition root owes. See its own header.
 */

const backendSrc = fileURLToPath(new URL('../../../src/', import.meta.url));
const harnessPath = fileURLToPath(new URL('../../helpers/test-server.ts', import.meta.url));

const harness = readFileSync(harnessPath, 'utf8');
const production = readFileSync(`${backendSrc}composition.ts`, 'utf8');

/* -------------------------------------------------------------------------- *
 * The harness root is two files (feature 109, Phase 1c).
 * -------------------------------------------------------------------------- */

const BACKEND_ROOT = resolve(backendSrc, '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');

/** Directories that hold no source of ours, or hold a second copy of it. */
const PRUNED = new Set(['node_modules', 'dist', 'build', '.turbo', 'i18n', 'docs', 'coverage']);

function sourceFilesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) found.push(...sourceFilesUnder(full, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
}

/**
 * **`setupBackendServer` no longer composes; it supplies a composition.**
 *
 * Since feature 109's Phase 1c the harness hands a `PlatformComposition` — which
 * modules, which ORM, which manifest registry, which decoration order — to
 * `@endora-commerce/test-kit/server`, and the kit calls `composeModules`, opens
 * the two Redis clients, builds the container, runs the one boot phase and takes
 * all of it down again. Every one of those steps still happens, once, in the
 * same order; what changed is which file holds it.
 *
 * So the assertions in this file split by **subject**, and the split is the
 * whole repair:
 *
 *   - what *this repository's root supplies* — the module list, the decoration
 *     order, the contribution calls, the error envelope, the actor property, the
 *     value imports it holds out of a module — stays asserted against
 *     {@link harness}, the file a reader of this branch edits;
 *   - what *the composition performs* — one `composeModules`, one boot phase, no
 *     `registerValues` inside the contribution window, two Redis clients, an
 *     opt-in subscription, a teardown that unsubscribes before it disconnects —
 *     is asserted against {@link harnessComposition}, the root **plus** the
 *     composer it delegates to.
 *
 * Leaving all of it on the first would have emptied ten of the properties this
 * file exists to hold: with the composition one package away, no `Redis` is
 * constructed anywhere in `test-server.ts`, and *"constructs the same two Redis
 * clients production does"* would have gone on passing while measuring nothing.
 * That is issue #113's shape arriving through a refactor instead of through a
 * rule.
 *
 * The construction is spelled around rather than quoted, deliberately:
 * `service-dependent-ledger.test.ts`' closure screen reads this file's **raw**
 * source, comments included, and a quoted `new` plus the class name reads there
 * as this test opening a connection. Failing closed on a mention is the right
 * direction for that screen and the wrong sentence for this comment.
 */
interface DelegatedComposer {
  /** The binding the root imports, which is how a delegated call is recognised. */
  readonly binding: string;
  /** The composer's own source directory, absolute — the 112 block walks it. */
  readonly dir: string;
  /** Every source file in it, concatenated in path order. */
  readonly source: string;
  /** The exported function that performs the composition. */
  readonly compositionFunction: string;
}

/**
 * Follow the specifier a root imports its composer from back to that composer's
 * **source**.
 *
 * Derived at every step and spelled at none: the *binding* decides which import
 * declaration is the composer's, the workspace member's own `exports` map
 * decides where the bare specifier lands, and its `tsconfig.build.json`'s
 * `rootDir` / `outDir` decide which source that artefact was compiled from. So
 * `packages/test-kit`, `dist` and `src` appear in no predicate here (D-100), and
 * a composer that moves is followed rather than lost.
 *
 * Reading the **source** rather than the artefact is the load-bearing half: a
 * package resolves at its build output (D-164), so a ledger computed from the
 * artefact would describe the previous `pnpm run build:packages` and not this
 * branch — the false green measured three times on feature 091's admin drain.
 *
 * Every step refuses rather than answering emptily. A root whose composer this
 * cannot find is a root whose composition nothing below would read, which is
 * exactly the state that makes ten ledgers vacuously green.
 */
function delegatedComposerOf(
  rootSource: string,
  rootPath: string,
  binding: string,
  compositionFunction: string,
): DelegatedComposer {
  const sourceFile = parse(rootPath, rootSource);
  let specifier: string | undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((element) => element.name.text === binding)) {
      specifier = statement.moduleSpecifier.text;
    }
  }
  if (specifier === undefined) {
    throw new Error(
      `[harness-parity] ${relative(REPO_ROOT, rootPath)} imports no '${binding}'. Either it ` +
        'composes for itself again, in which case the split above is wrong, or the binding was ' +
        'renamed. An unresolved composer leaves every composition assertion below reading a ' +
        'file that composes nothing.',
    );
  }

  // A loop rather than `Array#find`, and the reason is one estate over:
  // `check:fixture-substitution` counts a file as reading the database when it
  // sees a `find(` it cannot tell from an ORM one, so the tidier spelling would
  // enrol this file in that check's population while reading no database at all.
  let pkg: ReturnType<typeof emittingPackages>[number] | undefined;
  for (const candidate of emittingPackages(REPO_ROOT)) {
    if (specifier === candidate.name || specifier.startsWith(`${candidate.name}/`)) pkg = candidate;
  }
  if (pkg === undefined) {
    throw new Error(
      `[harness-parity] no emitting workspace member owns '${specifier}'. The composer is ` +
        'resolved through a package’s own exports map; a specifier no member claims cannot ' +
        'be followed back to a source.',
    );
  }
  const subpath = specifier === pkg.name ? '.' : `.${specifier.slice(pkg.name.length)}`;
  const target = pkg.exports.get(subpath);
  if (target === undefined) {
    throw new Error(
      `[harness-parity] ${pkg.name} declares no '${subpath}' subpath. Its exports map is what ` +
        'says where this specifier lands.',
    );
  }
  // `slice` rather than a `.replace()` over a character class: `check:diacritic-folds`
  // reads the second as slug construction and would count this file among the
  // sites it examines, which is a population it should not be in.
  const relativeTarget = target.startsWith('./') ? target.slice(2) : target;
  const emitted = join(pkg.dir, ...relativeTarget.split('/'));
  const entry = sourceOfEmitted(pkg, emitted, nodeFreshnessFs());
  if (entry === null) {
    throw new Error(
      `[harness-parity] no source under ${pkg.name}’s rootDir emits ` +
        `${relative(REPO_ROOT, emitted)}. Reading the artefact instead would hold this branch ` +
        'to the previous build.',
    );
  }

  const dir = dirname(entry);
  const files = sourceFilesUnder(dir, ['.ts']).sort();
  if (files.length === 0) {
    throw new Error(
      `[harness-parity] the composer directory ${relative(REPO_ROOT, dir)} holds no source.`,
    );
  }
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  if (!source.includes(`function ${compositionFunction}(`)) {
    throw new Error(
      `[harness-parity] ${relative(REPO_ROOT, dir)} declares no '${compositionFunction}'. The ` +
        'boot-step ledger reads that function’s statements; an absent one reports no steps ' +
        'at all, which agrees with every ledger.',
    );
  }
  return { binding, dir, source, compositionFunction };
}

const HARNESS_COMPOSER = delegatedComposerOf(
  harness,
  harnessPath,
  'composeTestServer',
  'composeTestServer',
);

/** The composition the harness performs: what it supplies, plus what composes it. */
const harnessComposition = `${harness}\n${HARNESS_COMPOSER.source}`;

/**
 * The two roots, each as **the whole composition it performs**.
 *
 * `ROOT_SOURCES` further down is the other half of the split and is deliberately
 * not this: its subject is what a root's own file names and imports, which is a
 * question about `test-server.ts` and not about the kit.
 */
const COMPOSITION_SOURCES: ReadonlyArray<readonly ['production' | 'harness', string]> = [
  ['production', production],
  ['harness', harnessComposition],
];

/** `new Foo(` occurrences, which is how both roots build everything hand-wired. */
function constructedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bnew ([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    names.add(match[1] as string);
  }
  return names;
}

/** `fooModule(` calls — the hand-wired module factories. */
function moduleFactories(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\b([a-z][A-Za-z0-9_]*Module)\s*\(/g)) {
    names.add(match[1] as string);
  }
  return names;
}

/**
 * The two roots' composition functions, by name.
 *
 * Written down because they are entry points rather than derived facts, and
 * {@link compositionTimeCalls} **refuses** a name it cannot find rather than
 * returning an empty set: a rename that emptied the population would otherwise
 * make every ledger below vacuously correct, which is the one way this file can
 * report green while looking at nothing (issue #113).
 */
const COMPOSITION_FUNCTIONS = { production: 'composeApp', harness: 'setupBackendServer' } as const;

/** Every named binding a root imports as a value — the callables it did not write itself. */
function importedValueNames(source: string): Set<string> {
  const sourceFile = ts.createSourceFile('root.ts', source, ts.ScriptTarget.ES2022, true);
  const names = new Set<string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node)) return;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly) return;
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) names.add(element.name.text);
    }
  });
  return names;
}

/**
 * Imported functions a root calls **while composing** — its boot steps.
 *
 * The two ledgers above derive their population from the source with `new X(`
 * and `xModule(`; this one could not, because a boot step is an ordinary call
 * and looks like every other call in the file. Two facts make it decidable
 * without a heuristic:
 *
 *   - **Imported.** A root's own local helpers are not boot steps; the steps are
 *     things the platform provides and a root invokes.
 *   - **Called while composing.** The walk starts at the composition function's
 *     own statements and descends, and it crosses a function literal only when
 *     that literal is an **argument** of a call already inside the region. That
 *     is the difference between a step that runs during composition — including
 *     the scoped shape `enterSystemScope('…', () => loadModulePresence(…))`,
 *     which is how production writes one — and a closure that is merely *stored*
 *     for a request handler to run later. Without it the population picks up
 *     every helper either root calls from inside a route, and a ledger whose
 *     entries mostly say "not a boot step" has outgrown its predicate.
 */
function compositionTimeCalls(
  source: string,
  functionName: string,
  delegates: ReadonlySet<string> = new Set(),
): Set<string> {
  const sourceFile = ts.createSourceFile('root.ts', source, ts.ScriptTarget.ES2022, true);
  let composition: ts.FunctionDeclaration | undefined;
  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) composition = node;
  });
  if (composition?.body === undefined) {
    throw new Error(
      `[harness-parity] no composition function '${functionName}' in this root. It was ` +
        `renamed or moved; point COMPOSITION_FUNCTIONS at the new name. An empty population ` +
        `would make the boot-step ledger below vacuously correct.`,
    );
  }

  const names = new Set<string>();
  // A call to a **delegate** — a composer this root hands its composition to
  // (feature 109, Phase 1c) — carries two extra kinds of composition step, and
  // both are steps this root performs rather than steps it stopped performing.
  //
  //  - A callback in its options object *runs during composition*, by that
  //    composer's contract. The default rule below sees only a function literal
  //    that is a **direct** argument, so `prepareDatabase`, `contribute`,
  //    `beforeBoot` and `afterReady` would all read as stored-for-later and
  //    their steps would vanish from the population. That is not the same
  //    blindness as `composedModules.contribute({ … })`, whose resolvers really
  //    are stored for a request handler, which is why this widening is keyed on
  //    the delegate rather than applied to every object literal.
  //  - An imported binding *handed over as a value* is performed by the
  //    delegate. `orm: { open: initOrm, close: closeOrm }` is the whole reason:
  //    the harness still opens the ORM through `initOrm`, it just supplies it
  //    instead of calling it, and a ledger that recorded that as "production
  //    opens the ORM and the harness does not" would be stating a divergence
  //    that is not there.
  const delegated = (node: ts.CallExpression): void => {
    for (const argument of node.arguments) {
      everyNode(argument, (child) => {
        if (ts.isIdentifier(child)) names.add(child.text);
      });
    }
  };
  const visit = (node: ts.Node, composing: boolean): void => {
    if (composing && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.add(node.expression.text);
      if (delegates.has(node.expression.text)) {
        delegated(node);
        for (const argument of node.arguments) {
          if (!ts.isObjectLiteralExpression(argument)) continue;
          for (const property of argument.properties) {
            const body = ts.isPropertyAssignment(property) ? property.initializer : undefined;
            if (body !== undefined && ts.isFunctionLike(body)) {
              body.forEachChild((child) => visit(child, true));
            }
          }
        }
      }
      node.forEachChild((child) => visit(child, true));
      return;
    }
    if (ts.isFunctionLike(node)) {
      const parent = node.parent;
      const isArgumentOfAComposingCall =
        composing &&
        parent !== undefined &&
        ts.isCallExpression(parent) &&
        (parent.arguments as readonly ts.Node[]).includes(node);
      node.forEachChild((child) => visit(child, isArgumentOfAComposingCall));
      return;
    }
    node.forEachChild((child) => visit(child, composing));
  };
  for (const statement of composition.body.statements) visit(statement, true);
  return names;
}

/** The boot steps one root performs — imported, and called while composing. */
function bootSteps(
  source: string,
  functionName: string,
  delegates: ReadonlySet<string> = new Set(),
): Set<string> {
  const imported = importedValueNames(source);
  return new Set(
    [...compositionTimeCalls(codeOnly(source), functionName, delegates)].filter((name) =>
      imported.has(name),
    ),
  );
}

describe('T075 — a converted module costs no test-helper edit', () => {
  it('the harness names no module from the generated composer', () => {
    // A module that has converted declares itself through `registerModule`, and
    // both roots reach it the same way: `composeModules(MODULES)`. If its id or
    // its plugin path still appears in the harness, something is wiring it
    // twice — which is the drift this feature exists to end, reintroduced one
    // module at a time.
    const named = MODULES.filter(
      (entry) =>
        harness.includes(`modules/${entry.id}/plugin.js`) ||
        harness.includes(`modules/${entry.id}/plugin.ts`),
    ).map((entry) => entry.id);

    expect(named).toEqual([]);
  });

  it('both roots compose the whole generated list, unfiltered', () => {
    // D-45 deleted `composition-passes.ts`: there is one pass, so a root that
    // wants to name a subset has to write the filter itself — and this is where
    // that shows up.
    //
    // The spelling is pinned including both **appends**: D-104's, a
    // deployment's overlay modules discovered at runtime, and T031's, the
    // instance's installed packages. Both go into this same single call, after
    // the frozen core list. What that buys is one registration pass in both
    // roots — not a decoration policy: this comment used to say it made
    // "overlay last, so a deployment's decoration wins" structural, and since
    // D-176's drain array position decides nothing about a wrap at all.
    // Extending the array is allowed and must be spelled identically in both
    // roots; narrowing it is what this refuses, and any `MODULES.filter(` would
    // fail the exact-match below.
    //
    // The **array literal** is pinned and nothing around it, which is what
    // survives feature 109's Phase 1c: production still writes it as
    // `composeModules`' first argument and the harness now writes it as the
    // `modules` member of the `PlatformComposition` it hands the kit. The list
    // is the property; which call receives it is not, and a pin including
    // `composeModules(` would have been a pin on prettier's line-breaking as
    // well as on a call site that legitimately moved.
    for (const [root, source] of ROOT_SOURCES) {
      expect(source, `${root} does not compose the generated list`).toContain(
        '[...MODULES, ...overlayModuleEntries, ...packageModuleEntries]',
      );
      expect(source).not.toContain('MODULES.filter(');
      expect(source).not.toContain('MODULES.slice(');
    }
  });

  it('every generated entry is composed exactly once', () => {
    // `composeModules` is called once in each root, and never a second time
    // with a hand-picked subset, which is how a root would start choosing its
    // own module set again.
    // The harness's one call is the kit's, which is why this reads the
    // composition rather than the root: a second `composeModules` anywhere in
    // the pair is a root that started choosing its own module set again.
    for (const [root, source] of COMPOSITION_SOURCES) {
      const calls = [...codeOnly(source).matchAll(/\bcomposeModules\s*\(/g)].length;
      expect(calls, `${root} calls composeModules ${calls} time(s)`).toBe(1);
    }
  });

  it('both roots pass the deployment\u2019s declared decoration order', () => {
    // Feature 107, P3. `ComposeModulesOptions.decorationOrder` existed from
    // feature 072 and was passed by **no** root, so `AmbiguousDecorationError`
    // told its reader there was no way to declare the order — correctly, because
    // the file its doc block named was never built. The supply is the
    // deployment's own `divergence.ts`, and it has to reach *both* roots or a
    // deployment that resolves an ambiguity in production meets the refusal in
    // every test: the composition the harness runs would not be the composition
    // production runs, on the one axis a deployment can change.
    for (const [root, source] of [
      ['harness', harness],
      ['production', production],
    ] as const) {
      expect(source, `${root} does not pass decorationOrder`).toContain(
        'decorationOrder: divergenceDeclaration.decorationOrder',
      );
      // Read once and used twice, never loaded twice: two `import()`s of one
      // file answering one question is how the omissions and the order come to
      // disagree about which declaration this deployment wrote.
      const loads = [...source.matchAll(/loadDivergenceDeclaration\(/g)].length;
      expect(loads, `${root} loads the declaration ${loads} time(s)`).toBe(1);
    }
  });

  it('each root contributes through the window method, not by hand', () => {
    // Issue #52 — D-45's contribution slot used to be a convention: a root
    // wrote `registerValues(container, …)` and had to have written it in the
    // right place. `composedModules.contribute(…)` *is* the slot, so the two
    // roots cannot spell it differently and a contribution cannot land after
    // the boot phase without throwing.
    for (const source of [harness, production]) {
      expect(source).toContain('composedModules.contribute(');
    }
  });

  it('neither root writes the container by hand once the modules have composed', () => {
    // The half a method alone cannot enforce: `registerValues(container, …)`
    // still works after `composeModules` and silently reopens the window. It is
    // legal *above* the call — that is where a host value no module defaults is
    // registered — so this is a position check, not a ban.
    for (const [root, source] of COMPOSITION_SOURCES) {
      const composeAt = source.indexOf('= composeModules(');
      expect(composeAt, `${root} composes no modules`).toBeGreaterThan(0);
      const afterCompose = source.slice(composeAt);
      const byHand = [...afterCompose.matchAll(/registerValues\(container, /g)].length;
      expect(byHand, `${root} registers a value by hand inside the window`).toBe(0);
    }
  });

  it('each root runs the one boot phase exactly once', () => {
    // The other half of D-45: a second `runBootHooks()` would mean a root had
    // grown a second boot phase, and with it the question of which half of the
    // root's contributions a module's hook can see.
    for (const [root, source] of COMPOSITION_SOURCES) {
      const calls = [...codeOnly(source).matchAll(/\.runBootHooks\s*\(/g)].length;
      expect(calls, `${root} runs ${calls} boot phase(s)`).toBe(1);
    }
  });
});

/**
 * The drift that made issue #234 unfindable, pinned (feature 083, R10 / D-137).
 *
 * Both roots wrote their own `resolvePreferredLanguage` closure. They were not
 * the same closure: production branched on `request.actor`, the harness on
 * `request.testActor` — a difference no test could see, because both were
 * wrong the same way for every non-admin actor and the suite asserted the
 * English they produced. That is the exact failure mode this file exists for:
 * a wiring difference the suite reports green over.
 *
 * **The assertion is re-derived rather than repaired**
 * (`specs/110-instance-repository/` T118). It read *"each root constructs
 * `createRequestLanguageResolver` exactly once"*, and that was the strongest
 * claim available while each root assembled the envelope itself: what remained
 * duplicated after feature 083 was the twenty lines *around* the shared ladder
 * — the same `errorTranslationTargets` wiring, the same admin lookup, the same
 * `translated === `${moduleId}.${key}`` miss test — written out in both files
 * and identical. T118 moved that assembly into the platform, so neither root
 * constructs the resolver now and the old assertion measured its absence.
 *
 * What the two roots owe each other here is therefore one line lower than it
 * was: each hands the shared assembly its own three composition inputs, and
 * neither reconstructs any part of the policy. The harness-only actor property
 * reappearing in that wiring is still the signal it always was.
 */
describe('083 — both roots resolve a request language through one function', () => {
  it('each root delegates the envelope rather than assembling one', () => {
    for (const [root, source] of [
      ['harness', harness],
      ['production', production],
    ] as const) {
      const code = codeOnly(source);
      const delegated = [...code.matchAll(/composeErrorEnvelopeOptions\(/g)].length;
      expect(delegated, `${root} does not delegate the error-envelope assembly`).toBe(1);
      // The two halves the assembly owns. A root that spells either has started
      // writing a second answer beside the one it just called.
      const ladder = [...code.matchAll(/createRequestLanguageResolver\(/g)].length;
      expect(ladder, `${root} reconstructs the language ladder`).toBe(0);
      const written = [...code.matchAll(/translateErrorMessage\s*:/g)].length;
      expect(written, `${root} writes its own translation callback`).toBe(0);
    }
  });

  it('the harness reads the same actor property production does', () => {
    // `registerTestAuth` mirrors every resolved actor onto `request.actor` as
    // well as onto the harness's own decoration, so the shared resolver —
    // which reads the production property — answers correctly here too. The
    // harness-only property reappearing in the `errorEnvelope` wiring means the
    // two roots have started answering different questions again.
    const code = codeOnly(harness);
    const at = code.indexOf('errorEnvelope: composeErrorEnvelopeOptions(');
    expect(at, 'the harness no longer delegates the envelope').toBeGreaterThan(0);
    const envelopeBlock = code.slice(at, code.indexOf('}),', at));
    expect(envelopeBlock).not.toContain('testActor');
  });
});

/**
 * What production builds and the harness does not — **the ledger** (T076).
 *
 * Each entry says what the gap costs, because a list of names is a list nobody
 * acts on. Removing an entry means the harness now builds it; adding one means
 * a new blind spot was accepted deliberately. Both are edits to this file, which
 * is the point.
 */
const PRODUCTION_ONLY_CONSTRUCTS: Readonly<Record<string, string>> = {
  // `MinisterstwoFinansowClient` left this ledger in T138. It was never really
  // a *root* construct — both roots built the pair of VAT clients only to hand
  // them to `organizations`. That module registers them as its own default now
  // and the harness overrides the pair through `organizationsTaxIdClients`, so
  // neither root names the class and the egress seam is declared in one place
  // instead of asserted in two.
  //
  // `ViesClient` drained in T140, exactly where the T138 note said it would.
  // `customers` was the last root-built one; the module defaults to the real
  // client and the harness contributes the fake, so neither root names the
  // class and the VAT egress seam is declared once instead of asserted twice.
  // `OpenIdOAuthProvider` left this ledger in T143c, and its entry —
  // "replaced by fakeOAuthProvider — a deliberate egress seam" — was true about
  // the seam and wrong about where it belonged. Production read `MFA_OAUTH_*`
  // and built the provider *for* `mfa`, so a root decided on the module's
  // behalf whether the module had social sign-in. The module reads its own
  // environment now and defaults to the real provider; the harness contributes
  // the fake over the same name, exactly as it does for the two VAT clients
  // (T138) and `ViesClient` (T140). The seam is declared once instead of
  // asserted in two roots, and neither root names the class.
  //
  // `SearchIndexer` left this ledger in T143a. Its entry read "built inside a
  // production-only closure; the harness builds its own through searchModule",
  // which named the defect without calling it one: production held a *second*
  // indexer, ungated, beside the one the module already built. `search` provides
  // `searchReindexPort` now, so both compositions reach one instance — the
  // harness reaching it only from the module's own route, on purpose (see the
  // note on `catalogSearchReindex` in `test-server.ts`).
  //
  // `SalesRepAssignmentService` was never on this ledger and should have been
  // watched all the same: both roots built one, with *different* constructor
  // arguments — the harness's without the subtree deps, so feature 056's
  // roll-up was exercised by nothing. It is `organizationSalesRepScopePort` now.
  StorefrontRevalidator:
    'outbound revalidation to the storefront is never exercised, so a broken ' +
    'revalidation payload cannot fail the suite',
  // `WarehouseChannelReconciler` left this ledger in T143a, and its entry is
  // the clearest example of what the ledger is for. It read "the boot-time
  // reconciler never runs in tests, so a warehouse/channel drift it would
  // repair is invisible" — an accepted blind spot in a repair that exists
  // because migration 030 seeds the Default warehouse before the system
  // channel exists. It is `inventory`'s `ctx.onBoot` now, so it runs in both
  // compositions, and it stops running when that module is switched off, which
  // the root's call never did.
};

/**
 * Module factories production composes and the harness does not.
 *
 * Empty since feature 072 wave 3 (T128/T130/T134/T135). The four payment
 * gateways were the entire list, recorded as "no payment provider composes in
 * tests" — which is exactly the shape a conversion removes: each module
 * registers itself now, so both compositions get it from the same generated
 * list and neither root can forget one.
 */
const PRODUCTION_ONLY_MODULES: Readonly<Record<string, string>> = {};

describe('T076 — the drift between the roots is an exact ledger', () => {
  it('lists every construct production builds and the harness does not', () => {
    const missing = [...constructedNames(production)]
      .filter((name) => !constructedNames(harnessComposition).has(name))
      .sort();

    expect(missing).toEqual(Object.keys(PRODUCTION_ONLY_CONSTRUCTS).sort());
  });

  it('lists every module factory production composes and the harness does not', () => {
    const missing = [...moduleFactories(production)]
      .filter((name) => !moduleFactories(harness).has(name))
      .sort();

    expect(missing).toEqual(Object.keys(PRODUCTION_ONLY_MODULES).sort());
  });

  /**
   * Boot steps production performs and the harness does not — the third ledger.
   *
   * The other two are computed from `new X(` and `xModule(`, so a divergence
   * that is neither cannot appear in them. This one used to be computed from
   * **nothing**: its test iterated `Object.entries(PRODUCTION_ONLY_BOOT_STEPS)`
   * and asked, of each declared entry, whether it was still true. A ledger that
   * iterates its own declarations can report a stale entry and can never report
   * an **omission** — which is "green means not looking" (issue #113) inside the
   * one test whose job is to name the divergences. It shipped that way with
   * exactly one entry while `loadOverlayDecorations` — a production-only boot
   * step, absent from the harness, loading the per-deployment file decorations
   * nothing in the suite ever composed — sat beside it unwritten and unseeable.
   *
   * It is computed both ways now, exactly as its two siblings are: the
   * population comes off both roots' sources, and the set difference is compared
   * to the ledger's keys. A new divergence fails, and so does an entry the
   * harness has since closed.
   *
   * `loadModulePresence` is the surviving entry, and it is a deliberate
   * decision recorded in `test-server.ts`: the harness has no database state to
   * reconcile and wants the two axes set by hand. Its consequence has to be
   * written down rather than discovered — **every refusal, reconcile and
   * derivation inside that boot step is exercised by nothing in the suite.**
   * D-101's boot refusal is the newest thing behind it, which is why that
   * decision put the analysis in a pure function (`assertLockedModulesPresent`)
   * and left only the call in the boot step;
   * `test/unit/_lifecycle/locked-modules-present.test.ts` is its proof, and it
   * runs because it needs no composition at all.
   */
  const PRODUCTION_ONLY_BOOT_STEPS: Readonly<Record<string, string>> = {
    assertPublicApiBaseUrlConfigured:
      'Production refuses to boot without PUBLIC_API_BASE_URL; the harness supplies its own ' +
      'base URL, so the refusal itself — the message an operator sees on a misconfigured ' +
      'deployment — is exercised by nothing here. `test/unit/config/public-api-base-url.test.ts` ' +
      'covers the resolver over its inputs instead.',
    configuredMigrations:
      'Production builds the ordered migration list for the running ORM; the harness migrates ' +
      'through the test template instead (`test/global-setup.ts`), so a defect in the wiring ' +
      'between the registry and the ORM config would not fail a test here. The ordering itself ' +
      'is proved by `test/unit/db/migrations-registry.test.ts` and `migration-order.test.ts`.',
    enterSystemScope:
      'Production wraps its boot-time database work in the system tenant scope; the harness ' +
      'composes inside the scope its own setup already established. A boot step that forgot the ' +
      'scope would therefore fail in production and pass here.',
    lifecycleModuleFromStaticEntries:
      'Production builds the lifecycle module from the deployment-resolved manifest set; the ' +
      'harness builds its own registry through `harnessManifestRegistry()` so a test can pin ' +
      'the two axes. A divergence between the resolved set and what the lifecycle module sees ' +
      'is invisible to the suite; `test/unit/_lifecycle/registered-manifests.test.ts` covers ' +
      'the resolution over its inputs.',
    loadModulePresence:
      'The harness seeds the registry cache by hand, so the reconciler, the gating-graph ' +
      'install and D-101’s two refusals never run in a test composition. Each is proved by a ' +
      'unit test over its pure half instead; a boot-level assertion here would be green for ' +
      'the wrong reason. It drains when the harness composes presence the way production ' +
      'does, which is T073’s open half.',
    resolvePublicApiBaseUrl:
      'The same seam as the assertion above, one call earlier: production derives the public ' +
      'base URL every absolute link is built from, and the harness sets one. A deployment whose ' +
      'derivation produced the wrong origin would ship links nobody in the suite ever reads.',
  };

  it('lists every boot step production runs and the harness does not', () => {
    // Comments are stripped first, and that is not a detail: `test-server.ts`
    // *names* `loadModulePresence()` in the comment explaining why it seeds the
    // cache instead of calling it. A population that read the mention as a call
    // would report the divergence closed by the very sentence documenting it.
    const productionSteps = bootSteps(production, COMPOSITION_FUNCTIONS.production);
    // Two functions for the harness, because its composition is two files: what
    // `setupBackendServer` performs itself, and what `composeTestServer`
    // performs on its behalf. `compositionTimeCalls` walks a *function's* own
    // statements, so a union is the honest way to ask "what does this root's
    // composition do" — a single call over the concatenated pair would find one
    // of the two and report the other's steps as divergences that are not there.
    const harnessSteps = new Set([
      ...bootSteps(harness, COMPOSITION_FUNCTIONS.harness, new Set([HARNESS_COMPOSER.binding])),
      ...bootSteps(HARNESS_COMPOSER.source, HARNESS_COMPOSER.compositionFunction),
    ]);

    // The vacuous-pass guard. Both roots compose, so both must have been read;
    // an empty population would agree with an empty ledger.
    expect(productionSteps.has('composeModules')).toBe(true);
    expect(harnessSteps.has('composeModules')).toBe(true);

    const missing = [...productionSteps].filter((step) => !harnessSteps.has(step)).sort();

    expect(missing).toEqual(Object.keys(PRODUCTION_ONLY_BOOT_STEPS).sort());
    for (const [step, cost] of Object.entries(PRODUCTION_ONLY_BOOT_STEPS)) {
      expect(cost.length, `${step} has no recorded cost`).toBeGreaterThan(20);
    }
  });

  it('every ledger entry carries what the gap costs, not just a name', () => {
    // A ledger of bare names is a list nobody acts on, and this one exists to
    // be acted on: each line is either closed or justified.
    for (const [name, reason] of Object.entries({
      ...PRODUCTION_ONLY_CONSTRUCTS,
      ...PRODUCTION_ONLY_MODULES,
    })) {
      expect(reason.length, `${name} has no recorded cost`).toBeGreaterThan(20);
    }
  });
});

/**
 * The per-composition resource ceiling.
 *
 * Everything one composition holds is multiplied by the number of compositions
 * a run performs, and that number is **555** — one per test file that calls
 * `setupBackendServer`. A second Redis client is not "one more client", it is
 * 555 more; a connection pool with four extra connections is 2220. That
 * multiplier is why the root container cannot be installed as the process root
 * yet, and it is measured rather than assumed.
 */
const REDIS_CLIENTS_PER_COMPOSITION = 2;

/**
 * Subscribing costs about **10 MB per composition** — measured, not estimated:
 * arming it in every composition added ~1 GB to the suite's live set (1224 MB →
 * 2231 MB at the same point in the run) and turned the full run into a heap OOM
 * at file 182 of 940. The client is constructed everywhere, because that is
 * cheap and matches production's shape; the *subscription* is opt-in.
 */
const PUBSUB_IS_OPT_IN = true;
const ORM_INSTANCES_PER_COMPOSITION = 1;

describe('T076 — what one composition costs, before the 555× multiplier', () => {
  it('constructs the same two Redis clients production does, and no more', () => {
    // Two, not one: ioredis refuses ordinary commands on a subscribed client,
    // so the pub/sub path needs its own connection (T073). Both are
    // disconnected in `teardownBackendServer` — the number that matters is
    // concurrent connections, and files run sequentially under `singleFork`.
    for (const [root, source] of COMPOSITION_SOURCES) {
      const clients = [...codeOnly(source).matchAll(/\bnew Redis\s*\(/g)].length;
      expect(clients, `${root} opens ${clients} Redis client(s)`).toBe(
        REDIS_CLIENTS_PER_COMPOSITION,
      );
    }
  });

  it('arms the subscription only where a test asks for it', () => {
    expect(PUBSUB_IS_OPT_IN).toBe(true);
    // **No** subscribing site is left in the harness, and that is the stronger
    // form of the property rather than a weakening of it.
    //
    // The custom-field cache moved into `custom_fields`' own `onBoot` when the
    // module was converted (feature 072, T087), which is where it belongs and
    // which is also why the guard could not follow it: a module must not know
    // it is being composed by a test harness. So the guard moved to the *input*
    // instead — the harness registers the real `redisSubscriber` only under
    // `exercisePubSub` and an inert stand-in otherwise, and the module arms
    // whichever it is handed.
    //
    // The one site that remained was the module-state channel, which dropped
    // the permission catalogue's memo. Issue #213 deleted the memo (and the
    // matching listener in `composition.ts`), so both roots subscribe to that
    // channel in exactly one place now — `registryCache.watch()`, which the
    // harness deliberately does not arm because it never populates
    // `module_registrations`.
    //
    // Two occurrences left: the registration ternary and the handle flag that
    // tells teardown whether there is anything to unsubscribe from. The flag
    // exists because `unsubscribe()` on a client that never subscribed rejects
    // asynchronously from ioredis's socket close handler, where no `try` can
    // reach it.
    const composition = codeOnly(harnessComposition);
    const guards = [...composition.matchAll(/options\.exercisePubSub === true/g)].length;
    const subscribes = [...composition.matchAll(/\.(subscribe|start)\(redisSubscriber|redisSubscriber\.subscribe\(/g)]
      .length;
    expect(guards).toBe(2);
    expect(subscribes).toBe(0);
  });

  it('unsubscribes and drops listeners before disconnecting', () => {
    // Disconnecting a subscribed client keeps its subscription set, and ioredis
    // re-establishes it on any reconnect — one armed subscription per
    // composition is how ~1 GB of retention accumulated.
    expect(harnessComposition).toContain("removeAllListeners('message')");
    expect(harnessComposition).toContain('unsubscribe()');
  });

  it('disconnects every client it opens', () => {
    // A leaked client is not one leaked client; it is 555. The receiver is not
    // pinned — the harness's teardown delegates to the kit's, which names its
    // own handle — because what has to be true is that both clients this
    // composition opens are disconnected, not what the variable holding them is
    // called.
    expect(harnessComposition).toContain('.redis.disconnect()');
    expect(harnessComposition).toContain('.redisSubscriber.disconnect()');
  });

  it('initialises one ORM per composition', () => {
    const orms = [...harnessComposition.matchAll(/MikroORM\.init\s*\(/g)].length;
    expect(orms).toBeLessThanOrEqual(ORM_INSTANCES_PER_COMPOSITION);
  });

  it('states the multiplier next to the ceiling, so a change is costed', () => {
    // Not a behavioural assertion — a refusal to let these numbers move
    // without the reader meeting the number they are multiplied by.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(self).toContain('555');
  });
});

/* -------------------------------------------------------------------------- *
 * T143c — what a root still knows about a module, as a draining ledger.
 * -------------------------------------------------------------------------- */

/** The two roots, named the way the ledger and the failure messages name them. */
type RootName = 'production' | 'harness';

const ROOT_SOURCES: ReadonlyArray<readonly [RootName, string]> = [
  ['production', production],
  ['harness', harness],
];

/**
 * One binding a root imports **as a value** from `src/modules/**`.
 *
 * A *value* import is a root reaching into a module's implementation; a
 * type-only import is a root typing a contribution it makes, and is not
 * measured (restated SC-001 / SC-006). The two look alike at a glance —
 * `import type { X }`, `import { type X }` and `import { X }` where `X` is only
 * ever used in a type position all read the same in a diff — so this is parsed
 * rather than grepped.
 */
interface RootModuleImport {
  /** The module that owns the imported file, as its `src/modules/<id>` folder. */
  readonly owner: string;
  /** The roots that hold it. An asymmetry between them is itself a finding. */
  readonly roots: ReadonlyArray<RootName>;
  /**
   * Why the root still names it **and what has to happen for it to drain**.
   *
   * A reason that only restates the import ("the root needs it") is worthless:
   * every entry here is needed, or it would not compile. The reason has to name
   * the seam that does not exist yet, because that is the next piece of work.
   *
   * A `permanent` entry is the exception and is held to the opposite rule: it
   * must name **no** exit, because a permanent entry carrying one is what makes
   * the next sweep try to drain it.
   */
  readonly reason: string;
  /**
   * Whether this entry's owner declares `activation.nonDeactivatable` — D-72
   * point 5, and **derived on every run** rather than believed.
   *
   * The ledger makes two claims about every entry, and the locks answered only
   * one of them. The presence claim ("a root-built instance keeps answering
   * after an operator switches its module off") is unreachable for a locked
   * owner; the Principle I / D-52-D-53 claim ("a root that names a module's
   * internals is a root that has to be edited when that module changes") is
   * untouched by any lock and is what the entry then rests on. Writing that
   * distinction into fifteen reasons would go stale the first time somebody
   * un-locks a module — three reasons were arguing the void claim when this
   * flag was added — so it is asserted against `DISCOVERED_MANIFESTS` instead.
   * Un-lock an owner and every entry resting on it re-reds in the same run,
   * with no sweep and no memory. That is D-63's property, one file over.
   */
  readonly ownerLocked?: boolean;
  /**
   * This entry has no exit and is not waiting for one (D-72 point 1).
   *
   * A permanent entry is **excluded from the ceiling arithmetic** below, so the
   * residue means "what is still to drain" rather than "what is left" — a
   * permanent entry sitting inside a ceiling that may only be lowered is
   * exactly what makes a ledger read as stalled when it is not.
   */
  readonly permanent?: boolean;
}

/**
 * **The ledger** (T143c), and the only thing that detects a new root→module
 * value import.
 *
 * The criterion the restated SC-001 and SC-006 set is **≤ 10 import
 * declarations from `src/modules/**` per root, and zero module-owned services
 * constructed**, deliberately one threshold for both roots: a second number for
 * the harness would licence exactly the root-to-root drift this file exists to
 * close. The construction half is met and asserted below. The import half is
 * **not**, and the ceilings below record the honest residue rather than the
 * target, so that a regression fails today instead of at the moment somebody
 * finally reaches 10.
 *
 * Keyed `<owner>:<binding>` — finer than the declaration it arrives in, because
 * a declaration drains one binding at a time and a per-declaration key would
 * hide the last two names of a three-name import.
 */
const ROOT_MODULE_VALUE_IMPORTS: Readonly<Record<string, RootModuleImport>> = {
  // `_i18n:ERROR_TRANSLATION_KEYS` stood here in both roots and drained with
  // T040b, which packaged the module: each root writes
  // `@endora-commerce/mod-i18n/backend` now, and a bare specifier into a package
  // is not an import from `src/modules/**`. The read itself is unchanged and
  // still right for the reason the entry gave — D-54 moved the map out of
  // `src/http` because a platform peer may not name a module and a root may —
  // and the drain the entry predicted, declaring the code→key mapping beside
  // the codes in `@endora-commerce/contracts`, is still available and still
  // worth doing. What this ledger measures is the *root's* reach into the
  // application's module tree, and that reach is gone.
  // **Six `_lifecycle` entries were here, and all six drained together with
  // feature 080's T040b** — `REGISTERED_MANIFESTS`, `buildStaticRegistry`,
  // `deploymentShippedEntries`, `resolvedManifestEntries`, `loadModulePresence`
  // and `lifecycleModuleFromStaticEntries`.
  //
  // Each of them said the same thing in its reason, in the same words: the read
  // is **right** and only its location is wrong, and it drains with the
  // relocation of the lifecycle cluster out of a module folder. That is what
  // happened. D-160.11 keeps the lifecycle subsystem out of the package sweep —
  // it is the platform's operator half — so instead of becoming
  // `@endora-commerce/mod-lifecycle` its sources became the host's own, at
  // `src/lifecycle/`, and the manifest index went to `src/` with them (D-160.3).
  // A composition root importing them is now the host importing itself, which
  // is what every one of the six reasons argued it always was.
  //
  // Nothing about the reads changed: which modules a deployment ships is still
  // a root input, production still boots an orchestrator the harness does not,
  // and the harness still builds the static registry `_i18n` walks. The ledger
  // stops recording them because its population is a root's value imports out of
  // a **module's** directory, and this is no longer one — not because the
  // divergences went away. `test/unit/_lifecycle/` is where they are measured.
  // `auth:promoteAdminActor` was here, production-only. It said it would drain
  // *"when `auth` provides actor promotion as a port"*, and that is **not** what
  // drained it: packaging the module (T040b) did, because this ledger's
  // population is a root's value imports from `src/modules/**` and the root now
  // names `@endora-commerce/mod-auth/backend`. The recorded drain condition was
  // one honest way out and not the only one, which is worth leaving in place of
  // the entry — a reason that names a single remedy reads as if nothing else can
  // clear it.
  //
  // What survives the re-spelling is the divergence itself: production promotes,
  // the harness resolves `request.testActor` and has nothing to promote. That is
  // measured by the roots' own actor resolvers, not here, and the port
  // conversion is still the thing that would collapse it.
  // `catalog:catalogPromptResolverTools`, `catalog:catalogPromptMutationTools`,
  // `inventory:inventoryPromptTools` and `orders:ordersPromptTools` were here.
  // All four were the same entry: a boot-time push into `prompt_actions`'
  // registry that could not move into the contributing module without declaring
  // `prompt_actions` a dependency — the declaration that would have made an
  // optional assistant undeactivatable. D-44's `nonBindingDependencies` is that
  // declaration without the claim, so all four now push from their own module's
  // boot hook. The `orders` one also closed a parity gap on its way out: it was
  // production-only, so no test composed an order tool.
  //
  // `catalog:catalogBulkProgressResolver` was the fifth and drained under D-72
  // point 4, which is why this comment is now the whole family's. Its obstacle
  // was the one D-44 could not remove and the core-set locks did not touch:
  // `promptActionsBulkProgressResolver` was not a registry but a single name
  // `prompt_actions` defaulted, and a module may not write a name another
  // module owns. The host keeps `promptActionBulkProgressRegistry` — a table
  // keyed by contributing module, stating a skip policy — so `catalog` pushes
  // from its own boot hook with a `nonBindingDependencies` entry, and neither
  // root names `catalog/prompt-tools.js`. Production 15 → 14, harness 10 → 9.
  //
  // `settings:collectRegisteredSettingsManifests`,
  // `customer_accounts:resolveCustomerRollupSubtreeIds`,
  // `email:absolutizePublicUrl` and `product_feeds:FeedDeliveryError` were the
  // last four whose owner is a packaging candidate (feature 080, T040b). Each
  // exited by a different door, and which door was a property of the site:
  //
  //  - the settings collector and the roll-up derivation are **rules a module
  //    owns**, so both are published ports — `settingsManifestCollectionPort`
  //    and `customerRollupScopePort` — and both roots resolve them lazily out
  //    of the container they already composed. The registry and the tree
  //    traversal stay the caller's arguments, because which modules a
  //    deployment ships and how an organisation's subtree is walked are not
  //    `settings`' or `customer_accounts`' to decide;
  //  - `absolutizePublicUrl` had **no consumer inside `email` at all** and is
  //    now the platform's, beside `configuredPublicApiBaseUrl`, unpublished
  //    because only the host calls it;
  //  - `FeedDeliveryError` was `permanent` here and the entry was **wrong**,
  //    not merely stale. Its argument was that nothing is *constructed* by the
  //    harness, which is true and is not the whole hazard: `DeliveryService`
  //    classifies on `instanceof FeedDeliveryError`, so a second evaluation of
  //    `product_feeds`' sources would answer false and silently reclassify
  //    every declared refusal as a retryable `internal_error`. The class now
  //    lives in `@endora-commerce/contracts`, beside the closed reason set it
  //    carries, which is resolved once.
};

/**
 * The residue **still to drain**, per root, as a ceiling that may only be
 * lowered.
 *
 * These are **import declarations**, which is the unit SC-001 and SC-006 are
 * written in; the ledger above is keyed one level finer. The criterion is 10
 * for both. Draining an entry means lowering the number here in the same merge
 * request, which is the whole mechanism: without it the last measurement was
 * taken by hand and nothing noticed the two that D-54 added to both roots on
 * its way past.
 *
 * D-72 point 1 — a declaration whose every binding is a `permanent` ledger
 * entry is **not** counted. A permanent entry inside a ceiling that may only be
 * lowered makes the ledger read as stalled when it is not, and it is the last
 * number to move that a reader would ever be able to move. The harness's 11
 * became 10 for that reason and for no drain.
 */
const ROOT_MODULE_IMPORT_CEILING: Readonly<Record<RootName, number>> = {
  // 8 → 5 (feature 080, T040b): the `settings` collector, the
  // `customer_accounts` roll-up derivation and `email`'s URL helper. What is
  // left is `auth` and the two infrastructure modules — `_i18n` and
  // `_lifecycle` — which are the last modules the packaging sweep converts, so
  // this root now holds a value import of no packaging candidate at all.
  //
  // It was 14 → 8 in T052. Six declarations left in one merge request, and
  // five of them were the same shape: `CustomerAccount`, `AdminUser`,
  // `AdminRole`, `Order` and `Asset`, each read with `em.findOne` in a root
  // bridge. The sixth was `auth:verifyPassword`, which drained with them
  // because what it compared against was two of those entities' password
  // columns.
  // 5 → 4 (T040b, `auth`): `promoteAdminActor` is the same declaration, now
  // written as a bare specifier into `@endora-commerce/mod-auth/backend`.
  //
  // 4 → 3 (T040b, `_i18n`): the cradle type and `ERROR_TRANSLATION_KEYS` were one
  // declaration, now `@endora-commerce/mod-i18n/backend`.
  //
  // **3 → 0 (T040b, `_lifecycle`).** The three that were left were this root's
  // reach into the lifecycle subsystem, and all of them drained at once when
  // D-160.11 made that subsystem the host's own code at `src/lifecycle/` rather
  // than a module in `src/modules/`. **Zero is the honest number and it is not
  // an achievement of decoupling**: this root imports no value out of a module
  // because there is no module left in the application tree to import one from.
  // The divergences those entries recorded are unchanged — production still
  // boots an orchestrator the harness does not — and they are measured by the
  // roots' own behaviour and by `test/unit/_lifecycle/`, not here.
  //
  // A clause naming `catalog` and `orders` stood here until this measurement:
  // it was written before batch six and the `orders`/`payments` pair, and both
  // had been packaged for some time. That is why the number, and not the prose
  // beside it, is what this file asserts.
  production: 0,
  // 5 → 3 (T040b): the same collector and roll-up derivation. The third
  // declaration this root lost is `product_feeds:FeedDeliveryError`, which was
  // `permanent` and therefore never counted here — so the raw count fell by
  // three and this number by two.
  //
  // It was 10 → 5 in T052, the same six as production minus
  // `auth:verifyPassword`, which this root never held: the harness contributes
  // no password verifier, so disabling a second factor here has always
  // required a current code.
  //
  // The comment this replaces recorded a raise, 9 → 10 (issue #158), and its
  // argument stands and is worth keeping in one line: the declaration added was
  // `buildStaticRegistry`, which made the harness build the manifest registry
  // the way the deployment does instead of contributing `() => undefined`. The
  // number went up and the divergence went down, and where those two disagree
  // the divergence is the one that matters.
  //
  // 3 → 2 (T040b, `_i18n`): the same declaration, on the same terms as
  // production's.
  //
  // **2 → 0 (T040b, `_lifecycle`)**, for the reason production reached zero:
  // `REGISTERED_MANIFESTS` and `buildStaticRegistry` were reaches into a module
  // folder that is now the host's own directory. The harness still builds the
  // static registry and still boots no orchestrator; what changed is where the
  // code it calls lives.
  harness: 0,
};

/**
 * What the restated SC-001 / SC-006 ask for, kept beside what is true.
 *
 * **Met since feature 080's T052**, in both roots, for the first time — which
 * is the event the assertion at the bottom of this describe block was written
 * to make somebody notice. It stays here rather than being deleted: the
 * ceilings are a ratchet, and a ratchet with nothing to be at or below is one
 * a later merge request can raise without argument.
 */
const ROOT_MODULE_IMPORT_CRITERION = 10;

/**
 * Classes a root may still construct out of a module, and why each is not a
 * service.
 *
 * SC-006's second clause — "constructs no module-owned service" — is met in
 * both roots, and this list is what keeps it met: an entry may only be added
 * with an argument for why the thing constructed is not a service, and "it is
 * convenient here" is not one. A module-owned *service* built by a root is
 * ungated by construction, so the root's instance keeps answering after an
 * operator switches its module off and no test can see the difference.
 */
const ROOT_CONSTRUCTED_MODULE_CLASSES: Readonly<Record<string, string>> = {
  // Empty since feature 080's T040b. `FeedDeliveryError` was the one entry —
  // 'an error type, not a service', which was true and was the wrong question:
  // `DeliveryService` classifies a transport refusal with
  // `instanceof FeedDeliveryError`, so what mattered was not whether the
  // harness builds a *service* but whether the class it builds is the one the
  // module compares against. Once `product_feeds` is a package it would not
  // have been. The class moved to `@endora-commerce/contracts`, which is
  // resolved once, so no root imports it out of a module any more.
};

/** Every value binding a root imports from `src/modules/**`, keyed `<owner>:<binding>`. */
function moduleValueImports(source: string, fileName: string): Map<string, string> {
  const found = new Map<string, string>();
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const owner = /(?:^|\/)modules\/([^/]+)\//.exec(specifier)?.[1];
    if (owner === undefined) continue;
    const clause = statement.importClause;
    // `import './x.js'` — no clause, so nothing is bound, but the module is
    // still evaluated for its side effects. Recorded under a name a reader can
    // act on rather than skipped.
    if (clause === undefined) {
      found.set(`${owner}:<side-effect>`, specifier);
      continue;
    }
    // `import type { … }` — the root typing a contribution, not reaching into
    // an implementation.
    if (clause.isTypeOnly) continue;
    if (clause.name) found.set(`${owner}:${clause.name.text}`, specifier);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      found.set(`${owner}:${bindings.name.text}`, specifier);
      continue;
    }
    for (const element of bindings.elements) {
      // `import { type X, Y }` — the inline form, which a grep cannot tell from
      // a value import and which is why this walks the AST.
      if (element.isTypeOnly) continue;
      found.set(`${owner}:${element.name.text}`, specifier);
    }
  }
  return found;
}

/** Import **declarations** from `src/modules/**` that bind at least one value. */
function moduleValueImportDeclarations(source: string, fileName: string): number {
  return new Set(moduleValueImports(source, fileName).values()).size;
}

/**
 * The same count, minus the declarations whose **every** binding is permanent
 * (D-72 point 1) — which is what the ceiling is a ceiling on.
 *
 * Per-declaration rather than per-binding on purpose: a declaration that brings
 * in one permanent name and one drainable one is still a declaration somebody
 * has to remove, so it keeps counting until the drainable half goes.
 */
function drainableModuleValueImportDeclarations(source: string, fileName: string): number {
  const drainablePerSpecifier = new Map<string, boolean>();
  for (const [key, specifier] of moduleValueImports(source, fileName)) {
    const permanent = ROOT_MODULE_VALUE_IMPORTS[key]?.permanent === true;
    drainablePerSpecifier.set(specifier, (drainablePerSpecifier.get(specifier) ?? false) || !permanent);
  }
  return [...drainablePerSpecifier.values()].filter(Boolean).length;
}

describe('T143c — the root value-import ledger', () => {
  it('declares every value a root imports out of a module', () => {
    const undeclared: string[] = [];
    for (const [root, source] of ROOT_SOURCES) {
      for (const key of moduleValueImports(source, `${root}.ts`).keys()) {
        if (ROOT_MODULE_VALUE_IMPORTS[key] === undefined) undeclared.push(`${root} ${key}`);
      }
    }

    // A new root→module value import is the regression this file exists to
    // catch. Declaring it here is deliberate; adding it silently is what
    // happened twice while this ledger did not exist.
    expect(undeclared.sort()).toEqual([]);
  });

  it('holds no entry that has already drained', () => {
    const live = new Set<string>();
    for (const [root, source] of ROOT_SOURCES) {
      for (const key of moduleValueImports(source, `${root}.ts`).keys()) live.add(key);
    }

    const stale = Object.keys(ROOT_MODULE_VALUE_IMPORTS)
      .filter((key) => !live.has(key))
      .sort();

    // A ledger that outlives what it records stops being read. The reason texts
    // are the value here, and a stale one is a claim about the tree that is no
    // longer true.
    expect(stale).toEqual([]);
  });

  it('records which roots hold each entry, so an asymmetry is deliberate', () => {
    const mismatched: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      const actual = ROOT_SOURCES.filter(([root, source]) =>
        moduleValueImports(source, `${root}.ts`).has(key),
      ).map(([root]) => root);
      const declared = [...entry.roots].sort().join(',');
      if (actual.sort().join(',') !== declared) {
        mismatched.push(`${key}: declared ${declared}, found ${actual.join(',') || 'neither'}`);
      }
    }

    // The two roots are held to each other, so "production has it and the
    // harness does not" is a fact the ledger states rather than one a reader
    // has to rediscover.
    expect(mismatched.sort()).toEqual([]);
  });

  it('names the owning module correctly on every entry', () => {
    const wrong: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (!key.startsWith(`${entry.owner}:`)) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });

  it('says what has to happen for each entry to drain, not that it is needed', () => {
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (entry.permanent === true) continue;
      expect(entry.reason.length, `${key} has no recorded exit`).toBeGreaterThan(80);
    }
  });

  it('lets a permanent entry name no exit, so no sweep has anything to aim at', () => {
    // D-72 point 5's companion, and the inverse of the assertion above. The
    // `webhooks` idiom in `PORT_CATCHES_TO_DRAIN` is what this enforces: an
    // entry that is not waiting for anything must not sound like it is, because
    // a sentence beginning "it drains when…" is what the next sweep reads as an
    // instruction. Prose alone did not hold — D-60 prescribed a repair no test
    // in the tree would have stopped — so the idiom is asserted.
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      if (entry.permanent !== true) continue;
      expect(entry.reason, `${key} is permanent but names an exit`).not.toMatch(/\bdrains\b/i);
      expect(entry.reason, `${key} is permanent but does not say so`).toMatch(/do not drain this/i);
    }
  });

  it('derives which entries rest on an owner lock, rather than believing a reason', () => {
    // D-72 point 5 — D-63's property applied one file over. The ledger makes
    // two claims per entry: a Principle XVII one (a root-built instance keeps
    // answering after its owner is switched off) and a Principle I / D-52-D-53
    // one (a root that names a module's internals is a root that has to be
    // edited when that module changes). Feature 074's locks made the first
    // claim unreachable for 15 of the 16 owners — and three reasons went on
    // arguing it for weeks, because nothing here could see the difference.
    //
    // So it is read from the manifests on every run. Withdraw a lock anywhere
    // and every entry resting on it re-reds in the same run, with no sweep.
    const locked = new Set(
      DISCOVERED_MANIFESTS.filter(
        (entry) =>
          (entry.manifest.activation as { nonDeactivatable?: boolean } | undefined)
            ?.nonDeactivatable === true,
      ).map((entry) => entry.id),
    );

    // The vacuous guard this assertion needs: a manifest index that loaded but
    // classified nothing would make every `ownerLocked: true` a finding, and a
    // tree in which nothing is locked would make the flag meaningless.
    expect(locked.size, 'no manifest declares nonDeactivatable — nothing was read').toBeGreaterThan(
      0,
    );

    const wrong: string[] = [];
    for (const [key, entry] of Object.entries(ROOT_MODULE_VALUE_IMPORTS)) {
      const isLocked = locked.has(entry.owner);
      if (isLocked && entry.ownerLocked !== true) {
        wrong.push(`${key}: owner '${entry.owner}' is nonDeactivatable, entry says otherwise`);
      }
      if (!isLocked && entry.ownerLocked === true) {
        wrong.push(`${key}: owner '${entry.owner}' is switchable, entry claims a lock`);
      }
    }
    expect(wrong.sort()).toEqual([]);
  });

  it('holds each root at or below its recorded residue', () => {
    for (const [root, source] of ROOT_SOURCES) {
      const count = drainableModuleValueImportDeclarations(source, `${root}.ts`);
      expect(count, `${root} grew a module import`).toBeLessThanOrEqual(
        ROOT_MODULE_IMPORT_CEILING[root],
      );
    }
  });

  it('keeps the ceiling honest about the permanent entries it excludes', () => {
    // The other half of the exclusion: without this, marking an entry
    // `permanent` would be a way to lower a ceiling by declaration. The raw
    // count is asserted to be exactly the drainable count plus the
    // permanent-only declarations, so the two numbers cannot drift apart.
    for (const [root, source] of ROOT_SOURCES) {
      const raw = moduleValueImportDeclarations(source, `${root}.ts`);
      const drainable = drainableModuleValueImportDeclarations(source, `${root}.ts`);
      const permanentOnly = new Set(
        [...moduleValueImports(source, `${root}.ts`)]
          .filter(([key]) => ROOT_MODULE_VALUE_IMPORTS[key]?.permanent === true)
          .map(([, specifier]) => specifier),
      );
      expect(raw - drainable, `${root}: excluded declarations do not match the permanent set`).toBe(
        [...permanentOnly].filter(
          (specifier) =>
            ![...moduleValueImports(source, `${root}.ts`)].some(
              ([key, value]) =>
                value === specifier && ROOT_MODULE_VALUE_IMPORTS[key]?.permanent !== true,
            ),
        ).length,
      );
    }
  });

  it('holds every root at the criterion, now that both are under it', () => {
    // This assertion used to read `toBeGreaterThanOrEqual` and was documented
    // as "the moment a ceiling reaches the criterion, this assertion is the one
    // that says so". T052 is that moment: production 14 → 8 and the harness
    // 10 → 5, both under 10. So it inverts, and what it now refuses is a
    // ceiling raised back over the criterion — which is the only direction
    // left that would mean anything.
    //
    // The two are separate assertions on purpose. The one above holds each root
    // to its own recorded residue and is what catches a new import; this one
    // holds the recorded residues to the number SC-001 and SC-006 asked for,
    // and is what catches a residue being edited upward to make room for one.
    for (const [root, ceiling] of Object.entries(ROOT_MODULE_IMPORT_CEILING)) {
      expect(ceiling, `${root}'s recorded residue is over the criterion`).toBeLessThanOrEqual(
        ROOT_MODULE_IMPORT_CRITERION,
      );
    }
  });
});

describe('T143c — no root constructs a module-owned service', () => {
  it('constructs nothing out of a module that is not on the allow-list', () => {
    const constructed: string[] = [];
    for (const [root, source] of ROOT_SOURCES) {
      const imported = new Set(
        [...moduleValueImports(source, `${root}.ts`).keys()].map((key) =>
          key.slice(key.indexOf(':') + 1),
        ),
      );
      for (const match of source.matchAll(/\bnew ([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
        const name = match[1] as string;
        if (!imported.has(name)) continue;
        if (ROOT_CONSTRUCTED_MODULE_CLASSES[name] !== undefined) continue;
        constructed.push(`${root} ${name}`);
      }
    }

    // The half of the criterion that is met, and the half that matters most: a
    // root-built service is ungated, so it answers with its module switched
    // off. Every one drained so far was found to be doing exactly that, and two
    // of them were built differently in the two roots.
    expect([...new Set(constructed)].sort()).toEqual([]);
  });

  it('says why each allowed construction is not a service', () => {
    for (const [name, reason] of Object.entries(ROOT_CONSTRUCTED_MODULE_CLASSES)) {
      expect(reason.length, `${name} has no recorded argument`).toBeGreaterThan(40);
    }
  });

  it('holds no allowance for a class no root imports out of a module', () => {
    // The direction the assertion above cannot have, because it iterates its
    // own declared entries: a list that only ever reads itself can say that
    // every entry carries an argument and can never say that an entry still
    // describes the tree. `FeedDeliveryError`'s allowance was exactly that —
    // it would have gone on asserting a shape `product_feeds` no longer
    // declares, in a file whose whole subject is claims about the two roots.
    const imported = new Set<string>();
    for (const [root, source] of ROOT_SOURCES) {
      for (const key of moduleValueImports(source, `${root}.ts`).keys()) {
        imported.add(key.slice(key.indexOf(':') + 1));
      }
    }
    const stale = Object.keys(ROOT_CONSTRUCTED_MODULE_CLASSES)
      .filter((name) => !imported.has(name))
      .sort();
    expect(stale).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- *
 * 112 — every root that composes the generated list mounts every seam a module
 *       of that list uses (`specs/112-test-tree-membership/`, FR-009/FR-010).
 * -------------------------------------------------------------------------- */

/**
 * The population above is **two** roots; this one is every root there is.
 *
 * `pim_unopim` became the first module to call `ctx.interceptors` on 2026-09-04
 * and reddened, in one commit, every compose-only root in the tree — because
 * `ModuleContextOptions.interceptorRegistry` is *optional in the type* and its
 * seam **throws** when it is absent. `tsc` therefore cannot see the
 * requirement, and it never will: the type cannot express "required iff the
 * composed list contains a module that uses it", and making it required would
 * refuse every hand-built context in the unit tree. **Six more fields on that
 * options type are optional in exactly the same way**, one first user away from
 * the identical red.
 *
 * So the assertion below is not about interceptors. It is the class:
 *
 *   for every `ModuleContext` seam whose absence the platform **throws** on,
 *   if any module of the generated list uses that seam, then every root that
 *   composes that list supplies the option field the seam needs.
 *
 * Three derivations, no list, and each of them refuses an empty answer rather
 * than passing vacuously over it (issue #113):
 *
 *   1. **The roots** — a file that *calls* `composeModules` and imports the
 *      generated composition. Parsed rather than grepped: the text predicate
 *      the design measurement used reports **seven** files and two of them are
 *      false, this file itself (which quotes `composeModules(` inside a
 *      `toContain` string) and `src/packages/package-runtime.ts` (which names
 *      both in comments). A population that includes the file asserting over it
 *      is not a population.
 *   2. **The guarded seams** — read off `createModuleContext`: an optional
 *      `ModuleContextOptions` field, bound in that function, whose absence a
 *      seam method guards with a `throw`. One today. A second one is picked up
 *      by existing.
 *   3. **The seam's users** — the module sources under each registered module's
 *      own directory, anchored at `dirname(manifestPath)` exactly as the `_i18n`
 *      boot reconciler anchors a bundle.
 *
 * Source-level, for the reason the whole file is: the property is a property of
 * the wiring, and booting five roots to compare them would cost five
 * compositions per run.
 *
 * **What it cannot see**, stated here rather than discovered later: a root that
 * builds its options object elsewhere and spreads it in (reported as
 * unreadable, not skipped); a seam reached through a helper in a file the
 * module does not own; a module composed from an installed package, whose
 * sources are its own; and an overlay module under `src/apps/`, which is
 * discovered per deployment and is not in the generated list.
 */

/** Every node of a source file, in no particular order. */
function everyNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => everyNode(child, visit));
}

/** One `composeModules(entries, { … })` call in a root, and what it supplies. */
interface CompositionCall {
  /** The option fields the call names, or `null` when the object cannot be read. */
  readonly supplies: ReadonlySet<string> | null;
  readonly line: number;
}

interface CompositionRoot {
  /** Repository-relative, so a failure message names the file a reader can open. */
  readonly path: string;
  readonly calls: readonly CompositionCall[];
}

/**
 * A root: it *calls* `composeModules` and it imports the **generated**
 * composition. Both halves are load-bearing — a dozen unit tests call the
 * composer over two hand-written entries and owe nothing to a module they do
 * not compose.
 *
 * `requiresGeneratedList` is what lets the **delegated composer** into this
 * population without letting those dozen unit tests in with it (feature 109,
 * Phase 1c). The kit composes whichever list its caller hands it — the generated
 * one, when the caller is this repository's harness — so it owes every seam that
 * list uses, unconditionally and with nothing to import. It is not a general
 * relaxation: the only directory it is applied to is the one
 * {@link delegatedComposerOf} reached by following the harness's own import
 * specifier, so a file becomes exempt from the second half by being the composer
 * a root delegates to, and by nothing else.
 */
function compositionRootsIn(
  directories: readonly string[],
  { requiresGeneratedList = true }: { requiresGeneratedList?: boolean } = {},
): CompositionRoot[] {
  const roots: CompositionRoot[] = [];
  for (const directory of directories) {
    for (const file of sourceFilesUnder(directory, ['.ts'])) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('composeModules')) continue;
      const sourceFile = parse(file, source);
      let importsGeneratedList = false;
      const calls: CompositionCall[] = [];
      everyNode(sourceFile, (node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.includes('composition.generated')
        ) {
          importsGeneratedList = true;
        }
        if (
          !ts.isCallExpression(node) ||
          !ts.isIdentifier(node.expression) ||
          node.expression.text !== 'composeModules'
        ) {
          return;
        }
        const options = node.arguments[1];
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        if (options === undefined || !ts.isObjectLiteralExpression(options)) {
          calls.push({ supplies: null, line });
          return;
        }
        const supplied = new Set<string>();
        let readable = true;
        for (const property of options.properties) {
          if (ts.isSpreadAssignment(property)) {
            // A spread hides what it carries. Reported rather than assumed
            // either way: read as "supplies everything" it excuses the root,
            // read as "supplies nothing" it accuses one that is correct.
            readable = false;
            continue;
          }
          if (property.name !== undefined && ts.isIdentifier(property.name)) {
            supplied.add(property.name.text);
          }
        }
        calls.push({ supplies: readable ? supplied : null, line });
      });
      if ((importsGeneratedList || !requiresGeneratedList) && calls.length > 0) {
        roots.push({ path: relative(REPO_ROOT, file), calls });
      }
    }
  }
  return roots.sort((left, right) => left.path.localeCompare(right.path));
}

const COMPOSITION_ROOTS = [
  ...compositionRootsIn([join(BACKEND_ROOT, 'src'), join(BACKEND_ROOT, 'test')]),
  ...compositionRootsIn([HARNESS_COMPOSER.dir], { requiresGeneratedList: false }),
].sort((left, right) => left.path.localeCompare(right.path));

/** The optional members of one options interface, by name. */
function optionalFieldsOf(sourceFile: ts.SourceFile, interfaceName: string): Set<string> {
  const fields = new Set<string>();
  sourceFile.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) return;
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.questionToken && ts.isIdentifier(member.name)) {
        fields.add(member.name.text);
      }
    }
  });
  return fields;
}

/** A seam of `ModuleContext` that throws when an option field is absent. */
interface GuardedSeam {
  /** The method a module calls — `interceptors`. */
  readonly seam: string;
  /** The `ModuleContextOptions` field whose absence it refuses. */
  readonly field: string;
}

/**
 * The seams read off the platform's own source.
 *
 * Three steps, each of them syntax rather than convention: the optional fields
 * of `ModuleContextOptions`; the local names `createModuleContext` binds them
 * to (`const { interceptorRegistry } = options`, `const x = options.y ?? …`);
 * and, in the context object it returns, a method guarding one of those names
 * with a `throw`.
 */
function guardedSeamsOf(sourceFile: ts.SourceFile, optional: ReadonlySet<string>): GuardedSeam[] {
  let factory: ts.FunctionDeclaration | undefined;
  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'createModuleContext') factory = node;
  });
  if (factory?.body === undefined) {
    throw new Error(
      '[harness-parity] no `createModuleContext` in the platform source. It was renamed or ' +
        'moved; an empty seam population would make the assertion below vacuously green.',
    );
  }

  const boundTo = new Map<string, string>();
  everyNode(factory.body, (node) => {
    if (!ts.isVariableDeclaration(node)) return;
    const initializer = node.initializer;
    if (initializer === undefined) return;
    if (ts.isIdentifier(initializer) && initializer.text === 'options' && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        const field = element.propertyName ?? element.name;
        if (ts.isIdentifier(field) && ts.isIdentifier(element.name) && optional.has(field.text)) {
          boundTo.set(element.name.text, field.text);
        }
      }
      return;
    }
    if (!ts.isIdentifier(node.name)) return;
    const access = ts.isPropertyAccessExpression(initializer)
      ? initializer
      : ts.isBinaryExpression(initializer) && ts.isPropertyAccessExpression(initializer.left)
        ? initializer.left
        : undefined;
    if (
      access !== undefined &&
      ts.isIdentifier(access.expression) &&
      access.expression.text === 'options' &&
      optional.has(access.name.text)
    ) {
      boundTo.set(node.name.text, access.name.text);
    }
  });

  let context: ts.ObjectLiteralExpression | undefined;
  everyNode(factory.body, (node) => {
    if (context === undefined && ts.isReturnStatement(node) && node.expression !== undefined) {
      if (ts.isObjectLiteralExpression(node.expression)) context = node.expression;
    }
  });
  if (context === undefined) {
    throw new Error(
      '[harness-parity] `createModuleContext` returns no object literal — the seam methods ' +
        'are not where this derivation reads them, and it would report none.',
    );
  }

  const seams: GuardedSeam[] = [];
  for (const property of context.properties) {
    let name: string | undefined;
    let body: ts.Node | undefined;
    if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) {
      name = property.name.text;
      body = property.body;
    } else if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))
    ) {
      name = property.name.text;
      body = property.initializer.body;
    }
    if (name === undefined || body === undefined) continue;
    everyNode(body, (node) => {
      if (!ts.isIfStatement(node)) return;
      const condition = node.expression;
      let guarded: string | undefined;
      if (
        ts.isPrefixUnaryExpression(condition) &&
        condition.operator === ts.SyntaxKind.ExclamationToken &&
        ts.isIdentifier(condition.operand)
      ) {
        guarded = condition.operand.text;
      } else if (
        ts.isBinaryExpression(condition) &&
        ts.isIdentifier(condition.left) &&
        condition.right.kind === ts.SyntaxKind.UndefinedKeyword
      ) {
        guarded = condition.left.text;
      }
      const field = guarded === undefined ? undefined : boundTo.get(guarded);
      if (field === undefined) return;
      let throws = false;
      everyNode(node.thenStatement, (statement) => {
        if (ts.isThrowStatement(statement)) throws = true;
      });
      if (throws) seams.push({ seam: name as string, field });
    });
  }
  return seams;
}

const platformSrc = platformSourceRootAt(REPO_ROOT);
if (platformSrc === null) {
  throw new Error(
    '[harness-parity] no workspace member declares `endora.type: "platform"`. The seam ' +
      'population is read off the platform source and would come back empty.',
  );
}
const moduleContextPath = join(platformSrc, 'kernel', 'module-context.ts');
const composePath = join(platformSrc, 'kernel', 'compose.ts');
const moduleContextSource = parse(moduleContextPath, readFileSync(moduleContextPath, 'utf8'));
const composeSource = parse(composePath, readFileSync(composePath, 'utf8'));

const OPTIONAL_CONTEXT_FIELDS = optionalFieldsOf(moduleContextSource, 'ModuleContextOptions');
const OPTIONAL_COMPOSE_FIELDS = optionalFieldsOf(composeSource, 'ComposeModulesOptions');
const GUARDED_SEAMS = guardedSeamsOf(moduleContextSource, OPTIONAL_CONTEXT_FIELDS);

/**
 * The registered modules' own source directories, anchored at
 * `dirname(manifestPath)` — the emitted location, so a module that has become a
 * package is followed rather than guessed at (feature 080, T041a). `src` when it
 * is there, the directory itself otherwise, which is what `_lifecycle` needs:
 * its manifest resolves inside the platform's build output.
 */
function moduleSourceFiles(): Map<string, readonly string[]> {
  const composed = new Set(MODULES.map((entry) => entry.id));
  const perModule = new Map<string, readonly string[]>();
  for (const entry of DISCOVERED_MANIFESTS) {
    if (!composed.has(entry.manifest.id)) continue;
    const root = dirname(entry.manifestPath);
    const src = join(root, 'src');
    const base = existsSync(src) ? src : root;
    perModule.set(entry.manifest.id, existsSync(base) ? sourceFilesUnder(base, ['.ts', '.js']) : []);
  }
  return perModule;
}

const MODULE_SOURCES = moduleSourceFiles();

/** Which modules call `<identifier>.<seam>(…)`, per guarded seam. */
function seamUsers(seam: string): string[] {
  const users: string[] = [];
  for (const [moduleId, files] of MODULE_SOURCES) {
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // The cheap half: 2000 files, one `includes` each. Only the survivors are
      // parsed, so a string literal or a comment naming the seam costs a parse
      // and is then correctly not a call.
      if (!source.includes(`.${seam}(`)) continue;
      let calls = false;
      everyNode(parse(file, source), (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === seam &&
          ts.isIdentifier(node.expression.expression)
        ) {
          calls = true;
        }
      });
      if (calls) {
        users.push(`${moduleId} (${relative(REPO_ROOT, file)})`);
        break;
      }
    }
  }
  return users.sort();
}

describe('112 — every composition root mounts every seam the composed list uses', () => {
  it('derives the root population, and it is more than the two pinned above', () => {
    // The floor is a broken-walk detector and it is also SC-004's second half:
    // narrowing this population back to the two roots T075/T076 pin is the
    // state that let three of them go red at once, so it has to fail rather
    // than quietly assert less.
    const paths = COMPOSITION_ROOTS.map((root) => root.path);
    expect(paths, 'the production root composes the generated list').toContain(
      relative(REPO_ROOT, join(backendSrc, 'composition.ts')),
    );
    // The harness composes the generated list **through the kit** since feature
    // 109's Phase 1c, so what has to be in this population is the composer it
    // delegates to. That the list it hands over is the generated one is pinned
    // by T075's first assertion, over `test-server.ts`' own text; what is pinned
    // here is that the composition performing it was found and judged.
    const composerDir = `${relative(REPO_ROOT, HARNESS_COMPOSER.dir)}/`;
    expect(
      paths.filter((path) => path.startsWith(composerDir)),
      `no file under ${composerDir} composes — the harness delegates there and nothing judged it`,
    ).not.toEqual([]);
    expect(
      paths.length,
      `only ${paths.length} composition roots found (${paths.join(', ')}). This assertion ` +
        'exists because there are more than the two held to each other above; a population ' +
        'of two means the walk broke, not that the tree shrank.',
    ).toBeGreaterThan(2);
  });

  it('reads every root option object — a spread would hide what it supplies', () => {
    const unreadable = COMPOSITION_ROOTS.flatMap((root) =>
      root.calls
        .filter((call) => call.supplies === null)
        .map((call) => `${root.path}:${call.line}`),
    );
    expect(
      unreadable,
      'These `composeModules(...)` calls do not pass a readable object literal, so what ' +
        'they mount cannot be decided. Read as "supplies everything" it excuses a root that ' +
        'mounts nothing; read as "supplies nothing" it accuses one that is correct. Spell ' +
        'the options at the call.',
    ).toEqual([]);
  });

  it('derives at least one guarded seam from the platform source', () => {
    // With no seam the assertion below iterates nothing and passes over every
    // root there is (issue #113). One stands today — `ctx.interceptors`.
    expect(OPTIONAL_CONTEXT_FIELDS.size).toBeGreaterThan(0);
    expect(
      GUARDED_SEAMS.map((entry) => `${entry.seam} -> ${entry.field}`),
      'No `ModuleContext` seam throws on an absent option field. Either the guard was ' +
        'removed — which is a change worth noticing — or this derivation stopped reading ' +
        `${relative(REPO_ROOT, moduleContextPath)}.`,
    ).not.toEqual([]);
  });

  it('every guarded field is one a root can actually supply', () => {
    // A seam guarding a field `ComposeModulesOptions` does not carry is a
    // requirement no root can meet, and the finding below would be unactionable.
    const unmountable = GUARDED_SEAMS.filter(
      (entry) => !OPTIONAL_COMPOSE_FIELDS.has(entry.field),
    ).map((entry) => `${entry.seam} needs \`${entry.field}\``);
    expect(
      unmountable,
      `These seams refuse an option \`ComposeModulesOptions\` has no member for, so no root ` +
        'can mount them. The composer is what forwards a root\'s options into a module ' +
        'context; add the field there, or the refusal is unreachable.',
    ).toEqual([]);
  });

  it('walks every composed module, and finds a source file for each', () => {
    // Issue #215's shape over this population: a module whose sources moved
    // contributes no file, is credited with using no seam, and every root goes
    // on looking correct.
    const empty = [...MODULE_SOURCES.entries()]
      .filter(([, files]) => files.length === 0)
      .map(([id]) => id);
    expect(MODULE_SOURCES.size, 'no composed module resolved to a directory').toBeGreaterThan(0);
    expect(
      empty,
      'These composed modules contributed no source file to the walk, so nothing they do ' +
        'with a `ModuleContext` seam is visible here.',
    ).toEqual([]);
  });

  it('every root supplies every option a seam the composed list uses needs', () => {
    const findings: string[] = [];
    for (const { seam, field } of GUARDED_SEAMS) {
      const users = seamUsers(seam);
      if (users.length === 0) continue;
      for (const root of COMPOSITION_ROOTS) {
        for (const call of root.calls) {
          if (call.supplies === null || call.supplies.has(field)) continue;
          findings.push(
            `${root.path}:${call.line} composes the generated list without \`${field}\`, ` +
              `and ctx.${seam}() — used by ${users.join(', ')} — throws without it`,
          );
        }
      }
    }
    expect(
      findings.sort(),
      'A root composing the generated list must offer every `ModuleContext` seam a module ' +
        'of that list uses. The option field is optional in the type — it has to be, since ' +
        '"required iff the composed list contains a module that uses it" is not expressible ' +
        '— so `tsc` cannot see this and only the composition can, by failing entirely.',
    ).toEqual([]);
  });
});
