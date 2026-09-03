/**
 * CI check — a module package's process singletons exist once (feature 080, T061;
 * D-160.6 widened past entity classes).
 *
 * ## The mechanism
 *
 * The platform composes a module package through its **published artefact**: the
 * generated composition imports `@endora-commerce/mod-<id>/backend`, which the
 * package's `exports` map points at `dist`. A file that names the *same*
 * package's **source** by filesystem path gets a second evaluation of that file
 * and of everything on its import graph. Two copies in one process, and `tsc`
 * cannot see it — the two spellings have identical types.
 *
 * T040c measured this for the platform's five directories: 59 runtime values,
 * none shared, `instanceof HttpError` false across the boundary, every 404 from
 * a packaged module a 500. D-160.6 wrote the rule down **about entity classes**,
 * where the failure is a lookup miss: loud, at a known moment.
 *
 * **The asymmetry is the finding this check exists for.** A duplicated
 * module-scope *value* fails **silently**. The second copy is simply empty, and
 * every reader sees an empty registry rather than an error. It has now happened
 * twice in two consecutive packaging batches:
 *
 *   * batch one — seven files acquired a second, empty `paymentAdapterRegistry`;
 *   * batch two — `backend/test/integration/shipments/carrier-module-off.test.ts`
 *     registered its synthetic carrier into a second, empty
 *     `ShippingAdapterRegistry`. The adapter was never *found*, so the shipment
 *     path took its "no carrier configured" branch and reported success: a
 *     switched-off module read as **present**, which is the exact state that
 *     file exists to refuse (Principle XVII item 6). A silent duplication
 *     producing a silent fail-open, two layers down from the duplication.
 *
 * Neither was visible to `tsc`, to any other check, or to `test:unit:fast` —
 * both live under the contract and integration trees that command skips.
 *
 * **Batch four is the third, and it is neither silent nor a value** (T061a;
 * D-160.6.1). `invoices` moved, and seven files in the test tree acquired a
 * second `Invoice` — an entity class, so D-160.6's own subject, but a
 * `@TransitivelyScoped` **parent**: `KsefSubmission` names it, the platform
 * resolves a tenant chain by class *name* (D-169/D-170), and
 * `assertTransitiveParentsResolve` refuses an ambiguous name rather than
 * guessing. So this duplication is a **hard refusal at ORM init** —
 * `UnresolvableTenantParentError` raised inside `setupBackendServer`, failing
 * every file in the fork rather than the one with the bad import, which makes it
 * the loudest of the three and the hardest to attribute.
 *
 * **And not one of the seven named the entity.** They import an `invoices`
 * *service*; four of those services import the entity. The duplication therefore
 * sat one hop *behind* the reached binding, and conjunct 2 asks about the
 * binding — which is why this file's own header used to name the shape as out of
 * reach. It is the third signal below.
 *
 * ## The rule, and why it is not "no module package source is ever reached"
 *
 * Several hundred value-position reaches into a module package's source stand in
 * this tree — the run prints the number as `sites=`, and it grows by a module's
 * worth every time the sweep packages one — and the overwhelming majority are
 * correct: a unit test that constructs its own service and hands it a stubbed
 * `EntityManager` has **one** copy in its process, so there is no second copy
 * for it to disagree with (D-168 says so in `test/helpers/package-entities.ts`).
 * A blanket rule would therefore be a ledger of nothing but exceptions, which is
 * the shape `check:diacritic-folds`' header refuses, and it would have no
 * available repair: a package's `exports` map publishes no service class, so
 * there is nothing for most of those reaches to be rewritten to.
 *
 * So the rule is the mechanism itself, and it is a **conjunction**:
 *
 *   1. **Both copies are in one process.** The reaching file's own value-import
 *      closure also loads that package's published artefact — through the
 *      generated composition, through a test harness that composes it, or by
 *      naming the bare specifier itself. This is derived, never declared: it is
 *      what makes the five entity reaches in unit tests *correct* rather than
 *      ledgered.
 *   2. **The platform composed the reached object.** Identity only matters where
 *      something else holds the other copy — so the binding is one the package's
 *      own composition hands to the container (`asValue` / `asFunction(() => x)`
 *      / `asClass`), or a member of the `entities` array the ORM registered.
 *
 * Both conjuncts come off the artefacts on every run. A thirtieth package, a new
 * registry and a new entity are covered by existing, and no list of them is
 * written down (D-100).
 *
 * ## Three findings
 *
 *   * **`composed-singleton-reach`** — the conjunction above, with the binding
 *     named. **No ledger, deliberately**: the composed container and
 *     `test/helpers/package-singletons.ts` / `package-entities.ts` are the
 *     supported doors and are always available, so an entry could only license
 *     re-opening the defect.
 *   * **`chain-parent-reach`** — the same conjunction with conjunct 2 asked of
 *     the reach's **import closure** instead of the binding it names, narrowed
 *     to the one class of duplication the platform *refuses* rather than
 *     tolerates: a `@TransitivelyScoped` parent (batch four, above). Also no
 *     ledger, for the same reason and one more — a second copy of one of these
 *     stops the whole fork booting, so an entry could not describe a site that
 *     is right to stand.
 *
 *     **The narrowing is the design, not a compromise.** The general shape —
 *     *any* composed singleton reached transitively — is every reach this run
 *     prints as `sites=`, most of them correct and most with no available repair
 *     (D-160.6.1's "deliberately not ruled"), so it would be a ledger of nothing
 *     but exceptions: the shape `check:diacritic-folds`' header refuses and the
 *     shape that got this check's third signal deleted. The chain parents are
 *     **derived** from the decorators on every run — two today (`Invoice`,
 *     `Order`), one of them in a package — so a third is covered by existing and
 *     no list of them is written down (D-100).
 *
 *     **No depth limit, and the number is measured rather than picked.** On this
 *     tree the reverse walk terminates at **2** hops, and it costs **2.2 ms** of
 *     a 10.1 s run — 8011 value edges over 3234 files, one BFS per duplicated
 *     class rather than one per site. A cap at one hop would already be blind to
 *     two live consumers (`test/unit/invoices/auto-issue-reactor.test.ts` and
 *     `issue-route-email-outcome.test.ts`, both correct today because they
 *     compose nothing), and the next service extracted between a test and an
 *     entity moves a site past whatever number were written here.
 *   * **`whole-file-reach`** — a namespace, dynamic, side-effect or `require`
 *     reach into a package's source under conjunct 1. It names no binding, so
 *     it takes the file's whole graph whatever that is, and no per-binding
 *     predicate can judge it (`check:platform-surface`'s reasoning verbatim).
 *     Two-way ledger.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 *   * A **computed** specifier — `await import(pathVariable)`. A literal
 *     dynamic import is `whole-file-reach`; a built one is outside every static
 *     check in this repository.
 *   * A module named as a **string** that is only *read* as text
 *     (`readFileSync(resolve(root, 'packages/modules/audit_logs/src/…'))`, one
 *     live site, deliberate and documented). That loads nothing, so it
 *     duplicates nothing; a string that is later *executed* would need dataflow
 *     the expression does not carry.
 *   * A singleton reached **transitively** that is *not* a tenant-chain parent —
 *     a test that imports a service class from a package's source, where that
 *     class's module body closes over the package's registry. `chain-parent-reach`
 *     walks the closure for the classes whose duplication is a refusal;
 *     everything else on it is still judged per binding, so a second copy that
 *     fails *silently* one hop down is invisible here. That is the narrowing
 *     three paragraphs above, and it is a decision rather than an oversight:
 *     D-160.6.1 leaves the general reach deliberately unruled, because a
 *     package's `exports` map publishes no service class and most of those
 *     reaches have no repair to be pointed at.
 *   * **A reach whose duplication only matters in a process it cannot name.**
 *     Conjunct 1 asks about the reaching file's own closure, which
 *     under-approximates for a file nothing runs on its own: a test helper
 *     reaching the harness through `import type` loads no artefact, while every
 *     test importing it loads both. `chain-parent-reach` answers this by walking
 *     value edges *backwards* as well (`coLoadedArtefacts`) — measured, it adds
 *     batch four's seventh site and no false one — and the other two signals
 *     deliberately do not, because widening the conjunct that clears several
 *     hundred correct reaches is a separate question with a separate
 *     measurement.
 *   * **Which copy produced the object under test.** Batch one's *second*
 *     finding was a service class duplicated the same way, caught by
 *     `toBeInstanceOf(AddressService)` and by nothing else — the instance came
 *     from the composed container and the class from the source. An
 *     `identity-comparison` signal over `instanceof` / `toBeInstanceOf` against
 *     a source-reached binding was written, measured and **removed**: it fired
 *     on all three sites in the tree and all three were correct, because in
 *     each of them the compared *object* was built by the test from the same
 *     source copy (`newsletter`'s provider registry twice,
 *     `transactional_emails`' reconciler once). The property it needs — which
 *     copy produced the left operand — is not lexically decidable, so the
 *     signal would have been a ledger of nothing but exceptions, which is the
 *     shape `check:diacritic-folds`' header refuses. Conjunct 2 is deliberately
 *     the narrower question, asked of an artefact rather than of dataflow.
 *   * `admin` and `storefront`. Neither composes the backend platform, so
 *     conjunct 1 is false for every file in them by construction.
 *   * A tenant chain whose parent is **computed** — `@TransitivelyScoped(NAME,
 *     'fk')`. That is not a blind spot but a **refusal**: the signal's whole
 *     population is those literals, so an unreadable one exits 2 rather than
 *     quietly shrinking it.
 *   * A `@TransitivelyScoped` on a class that is not `@Entity()`. Feature 050's
 *     classification is total over persisted entities, so a real chain's child
 *     is one; without the conjunct the population is 31 names on this tree, 29
 *     of them the tenancy suite's synthetic fixtures.
 *
 * Static analysis through the TypeScript compiler API, so a specifier mentioned
 * in a comment or a string literal is not a finding.
 *
 * ## One analysis, two hosts
 *
 * This file is the analysis (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). `backend/scripts/check-singleton-identity.ts` hosts it over every
 * consumer root in this repository and holds `WHOLE_FILE_REACHES_ALLOWED`,
 * which is a ledger of *this* tree's reaches, so `allowed` is an argument and
 * not a value this file reads — a ledger read from inside the analysis is a
 * ledger only one host can have.
 *
 * `endora check`'s host lands with Phase 3 and its estate entry says why: the
 * rule's subject is a reach into a module package's source from a process that
 * also loads that package's *artefact*, and `specifierGraph` skips a reach whose
 * target is the reaching file's **own** package — correctly, since a package's
 * internal relative imports are one copy and not two. So one package in
 * isolation has no second package for a reach to land in, and what the rule
 * needs is the peers' sources, which is Tier B's input rather than Tier A's.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { namedSpecifiers, type SpecifierKind } from '../lib/specifiers.js';

/** One module package, as the analysis needs it. */
export interface ModulePackageSurface {
  /** The module id of record — `endora.id`, never a path segment (D-142). */
  readonly moduleId: string;
  /** The npm name its published artefact is reached by. */
  readonly npmName: string;
  /** Its directory, as a key in the same namespace as {@link SingletonIdentityInput.sources}. */
  readonly root: string;
}

/**
 * Everything the analysis reads, and nothing it computes.
 *
 * Specifier resolution happens *inside* the analysis over this key set rather
 * than through an injected resolver, so a red proof drives the resolution too
 * (issue #130): a fixture that handed in pre-resolved targets would prove the
 * predicates and leave the step that finds them unproven, which is where a
 * `.js` → `.ts` rewrite or an `index.ts` directory target goes wrong.
 */
export interface SingletonIdentityInput {
  /** Repo-relative key → source text, for every file the walk opened. */
  readonly sources: ReadonlyMap<string, string>;
  readonly packages: readonly ModulePackageSurface[];
}

export type SingletonIdentityFindingKind =
  | 'composed-singleton-reach'
  | 'chain-parent-reach'
  | 'whole-file-reach'
  | 'stale-allowance';

export interface SingletonIdentityFinding {
  readonly kind: SingletonIdentityFindingKind;
  /** The file holding the second copy, or the ledger key for a stale entry. */
  readonly file: string;
  readonly line: number;
  /** The package whose source is reached. */
  readonly moduleId: string;
  /** The reached source file, in the same key namespace. */
  readonly target: string;
  /** The duplicated binding, where the finding names one. */
  readonly binding: string | null;
  /** Why the platform holds the other copy — printed to the author. */
  readonly why: string;
}

export interface SingletonIdentityResult {
  readonly findings: readonly SingletonIdentityFinding[];
  /** Reaches into a module package's source that the run examined. */
  readonly sites: number;
  /** Composed singletons derived from the packages' own sources. */
  readonly singletons: number;
  /** Module packages the derivation found at least one entity class for. */
  readonly packagesWithEntities: readonly string[];
  /**
   * The tenant-chain parents this walk named, and which of them it resolved to
   * a classified entity class — the `tenant-chains` reconciliation.
   *
   * Two authors answer it: the `@TransitivelyScoped` decorator on the *child*
   * (which module owns the child is nobody's choice but the chain's) and the
   * `@Entity()` class declaration of the *parent*, in another module and, since
   * batch four, in another workspace member. A walk that stopped reading one of
   * the two roots leaves a parent named and unresolved, which is #215 over this
   * population.
   */
  readonly chainParentNames: readonly string[];
  readonly resolvedChainParentNames: readonly string[];
  /** `@TransitivelyScoped` sites whose parent argument is not a string literal. */
  readonly unreadableChainParents: readonly string[];
  /** Chain parents that live in a module package — the signal's actual subject. */
  readonly chainParentSubjects: readonly ChainParentSubject[];
}

const REGISTRATION_CALLS = /(?:^|\.)(asValue|asFunction|asClass)$/;

/**
 * The half of a composed singleton's reason that says the **ORM** holds the
 * other copy.
 *
 * One constant rather than the same literal in three places: the chain-parent
 * signal and the `entities-registry` reconciliation both narrow the composed set
 * to this derivation, and a second spelling of it is two answers waiting to
 * disagree about which classes the ORM registered.
 */
const ENTITIES_ARRAY_WHY = "the ORM registered this class from the package's entities array";

/** The decorator whose first argument names a tenant chain's parent by class name. */
const TRANSITIVE_SCOPE_DECORATOR = 'TransitivelyScoped';

/** The candidate spellings a specifier can reach, in the order node would try. */
function candidateKeys(base: string): string[] {
  return [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    base,
  ];
}

/** `a/b/../c` → `a/c`, over the one separator every key in this check uses. */
function normalizeKey(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Which walked file a relative specifier written in `fromKey` names, or `null`.
 *
 * Only relative specifiers: a bare one is a package boundary and is conjunct 1's
 * business, not conjunct 2's.
 */
export function resolveRelative(
  fromKey: string,
  specifier: string,
  keys: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = normalizeKey(`${fromKey.split('/').slice(0, -1).join('/')}/${specifier}`);
  for (const candidate of candidateKeys(base)) if (keys.has(candidate)) return candidate;
  return null;
}

type ExportKind = 'value' | 'class' | 'entity' | 'function';

function sourceFileOf(key: string, text: string): ts.SourceFile {
  return ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true);
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * What each name a file exports *is*, at module scope.
 *
 * The distinction that matters is `value` (one object, created when the module
 * evaluates) against `function` / `class` (code, re-created identically by a
 * second evaluation and only identity-bearing where somebody compares it —
 * which is `identity-comparison`'s job). `entity` is a class the ORM keys its
 * metadata on, so a second one is a lookup miss.
 */
export function exportedKinds(key: string, text: string): Map<string, ExportKind> {
  const sf = sourceFileOf(key, text);
  const kinds = new Map<string, ExportKind>();
  for (const statement of sf.statements) {
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) kinds.set(declaration.name.text, 'value');
      }
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const decorated = (ts.getDecorators(statement) ?? []).some((decorator) =>
        decorator.getText(sf).startsWith('@Entity'),
      );
      kinds.set(statement.name.text, decorated ? 'entity' : 'class');
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      kinds.set(statement.name.text, 'function');
    }
  }
  return kinds;
}

/** Where each name a file imports as a value comes from, resolved to a walked key. */
function valueImportOrigins(
  key: string,
  text: string,
  keys: ReadonlySet<string>,
): Map<string, string> {
  const sf = sourceFileOf(key, text);
  const origins = new Map<string, string>();
  for (const statement of sf.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const target = resolveRelative(key, statement.moduleSpecifier.text, keys);
    if (target === null) continue;
    if (statement.importClause.name) origins.set(statement.importClause.name.text, target);
    const bound = statement.importClause.namedBindings;
    if (bound && ts.isNamedImports(bound)) {
      for (const element of bound.elements) {
        if (!element.isTypeOnly) origins.set(element.name.text, target);
      }
    }
  }
  return origins;
}

/** `<file>#<name>` — the identity of a binding, in one namespace. */
export function bindingKey(file: string, name: string): string {
  return `${file}#${name}`;
}

/**
 * Every binding the platform holds exactly one of, derived from the packages'
 * own sources.
 *
 * Two derivations and no third, each naming the thing that holds the other copy:
 * the **container** (`asValue` / `asFunction(() => x)` / `asClass`) and the
 * **ORM** (a member of the `entities` array). Both are read as literal AST
 * nodes, so a mention in a comment contributes nothing.
 */
export function composedSingletons(input: SingletonIdentityInput): Map<string, string> {
  const keys = new Set(input.sources.keys());
  const composed = new Map<string, string>();
  for (const pkg of input.packages) {
    const prefix = `${pkg.root}/`;
    for (const [key, text] of input.sources) {
      if (!key.startsWith(prefix)) continue;
      const sf = sourceFileOf(key, text);
      const origins = valueImportOrigins(key, text, keys);
      const ownKinds = exportedKinds(key, text);
      const record = (identifier: ts.Identifier, why: string, wanted: readonly ExportKind[]): void => {
        const from = origins.get(identifier.text) ?? (ownKinds.has(identifier.text) ? key : null);
        if (from === null) return;
        const text2 = input.sources.get(from);
        if (text2 === undefined) return;
        const kind = exportedKinds(from, text2).get(identifier.text);
        if (kind === undefined || !wanted.includes(kind)) return;
        composed.set(bindingKey(from, identifier.text), `${pkg.moduleId}: ${why}`);
      };
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && REGISTRATION_CALLS.test(node.expression.getText(sf))) {
          const [first] = node.arguments;
          const call = node.expression.getText(sf);
          if (first !== undefined) {
            if (ts.isIdentifier(first)) {
              record(first, `the composed container holds this object (${call})`, [
                'value',
                'class',
                'entity',
              ]);
            } else if (ts.isArrowFunction(first) && ts.isIdentifier(first.body)) {
              record(first.body, `the composed container holds this object (${call})`, [
                'value',
                'class',
                'entity',
              ]);
            }
          }
        }
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === 'entities' &&
          node.initializer &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          for (const element of node.initializer.elements) {
            if (ts.isIdentifier(element)) {
              record(element, ENTITIES_ARRAY_WHY, ['entity']);
            }
          }
        }
        node.forEachChild(visit);
      };
      sf.forEachChild(visit);
    }
  }
  return composed;
}

/**
 * Every class name a `@TransitivelyScoped` decorator names as a tenant parent,
 * and the persisted children that name it.
 *
 * Read as literal AST nodes — a decorator on a class declaration, whose callee
 * is that identifier and whose first argument is a string literal — so the files
 * that merely *mention* the decorator in prose, in a contract's doc block or in
 * a string fixture contribute nothing.
 *
 * **The child must also be `@Entity()`, and that conjunct is the population
 * rather than a tidy-up.** Feature 050's classification is total over
 * *persisted* entities, so a real chain's child is one; a `@TransitivelyScoped`
 * on a plain class registers into the same in-process registry and never
 * reaches ORM discovery. Measured on this tree, dropping the conjunct yields 31
 * parent names of which 29 are the tenancy suite's own synthetic fixtures
 * (`CycleA`, `DeepGlobalTerminus`, `AnEntityThisPlatformDoesNotHave`), each of
 * which would put a name nothing declares into the reconciliation below. It is
 * derived from the decorator rather than from a path exclusion on `test/` on
 * purpose: a rule keyed on where a file sits stops being true the day a tree
 * moves, which is what `moved-module-tree.test.ts` exists to refuse.
 *
 * `unreadable` is the other outcome and it is a refusal rather than a skip: a
 * computed first argument (`@TransitivelyScoped(PARENT, 'fk')`) is a chain this
 * walk cannot name, and a population quietly one shorter than it should be is
 * the whole of issue #113.
 */
export interface TransitiveParentScan {
  /** Parent class name → the child class names scoped through it. */
  readonly parents: ReadonlyMap<string, readonly string[]>;
  /** `<file>:<line>` for every decorator whose parent argument is not a literal. */
  readonly unreadable: readonly string[];
}

export function transitiveParents(sources: ReadonlyMap<string, string>): TransitiveParentScan {
  const parents = new Map<string, string[]>();
  const unreadable: string[] = [];
  for (const [key, text] of sources) {
    if (!text.includes(TRANSITIVE_SCOPE_DECORATOR)) continue;
    const sf = sourceFileOf(key, text);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node)) {
        const decorators = ts.getDecorators(node) ?? [];
        const persisted = decorators.some((decorator) =>
          decorator.getText(sf).startsWith('@Entity'),
        );
        for (const decorator of persisted ? decorators : []) {
          const call = decorator.expression;
          if (!ts.isCallExpression(call)) continue;
          if (call.expression.getText(sf) !== TRANSITIVE_SCOPE_DECORATOR) continue;
          const [first] = call.arguments;
          const line = sf.getLineAndCharacterOfPosition(decorator.getStart(sf)).line + 1;
          if (first === undefined || !ts.isStringLiteral(first)) {
            unreadable.push(`${key}:${line}`);
            continue;
          }
          const children = parents.get(first.text) ?? [];
          children.push(node.name?.text ?? `<anonymous at ${key}:${line}>`);
          parents.set(first.text, children);
        }
      }
      node.forEachChild(visit);
    };
    sf.forEachChild(visit);
  }
  return { parents, unreadable };
}

/**
 * Where each `@Entity()` class the walk read is declared, by class name.
 *
 * The independent half of the `tenant-chains` reconciliation: the decorator on
 * the child names a parent, and this says whether the walk reached the file that
 * declares it. Pre-filtered on the decorator's own text, so it parses the ~230
 * files that hold an entity rather than all 3200.
 */
export function entityClassLocations(
  sources: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [key, text] of sources) {
    if (!text.includes('@Entity')) continue;
    for (const [name, kind] of exportedKinds(key, text)) {
      if (kind !== 'entity') continue;
      const where = found.get(name) ?? [];
      where.push(key);
      found.set(name, where);
    }
  }
  return found;
}

/**
 * A class whose duplication the platform **refuses** rather than tolerates.
 *
 * The intersection of two derivations, both off the artefacts: a class the ORM
 * registered from a package's own `entities` array (conjunct 2, exactly as the
 * named-binding signal asks it), and a class name some `@TransitivelyScoped`
 * decorator names as a parent. `resolveTransitiveParent` keys the tenancy
 * registry on the class **name** and refuses an ambiguous one rather than
 * guessing (D-170), so a second registration of that name is
 * `UnresolvableTenantParentError` at ORM init.
 */
export interface ChainParentSubject {
  /** The file declaring the class — what a reach has to load to duplicate it. */
  readonly file: string;
  readonly className: string;
  /** The package whose published artefact holds the first copy. */
  readonly moduleId: string;
  /** The `@TransitivelyScoped` children that name it, for the message. */
  readonly children: readonly string[];
}

export function chainParentSubjects(
  input: SingletonIdentityInput,
  scan: TransitiveParentScan = transitiveParents(input.sources),
  composed: ReadonlyMap<string, string> = composedSingletons(input),
): ChainParentSubject[] {
  const subjects: ChainParentSubject[] = [];
  for (const [key, why] of composed) {
    if (!why.includes(ENTITIES_ARRAY_WHY)) continue;
    const cut = key.lastIndexOf('#');
    const file = key.slice(0, cut);
    const className = key.slice(cut + 1);
    const children = scan.parents.get(className);
    if (children === undefined) continue;
    subjects.push({ file, className, moduleId: why.split(':')[0] ?? '', children });
  }
  return subjects;
}

/** How a file reaches a chain parent: the hop count and the path it took. */
export interface ChainParentHit {
  readonly subject: ChainParentSubject;
  /** Value-import hops from this file to the declaring one. 0 = it *is* it. */
  readonly hops: number;
  /** The shortest path, declaring file last. */
  readonly via: readonly string[];
}

/**
 * For every walked file, the chain parents its own value-import closure loads.
 *
 * A **reverse** breadth-first walk from each subject rather than a forward one
 * per reach: the subjects are few and the reaches are many, so this is one BFS
 * per duplicated class over the whole edge set instead of one per site, and it
 * yields the *shortest* path for free — which is what the message prints, and
 * what makes the depth question answerable rather than assumed.
 *
 * **No depth limit**, and the measurement rather than the taste is the reason:
 * over this repository the real hits sit at 1 and 2 hops, and the walk to
 * exhaustion costs 0.1 s of a 13 s run (feature 080, T061a). A cap would be a
 * number written down that the next service extraction — one more file between
 * the test and the entity — would silently step past, which is the failure mode
 * this check's own header spends four paragraphs on.
 */
export function chainParentReaches(
  edges: ReadonlyMap<string, readonly string[]>,
  subjects: readonly ChainParentSubject[],
): Map<string, ChainParentHit[]> {
  const reverse = new Map<string, string[]>();
  for (const [from, targets] of edges) {
    for (const target of targets) {
      const callers = reverse.get(target) ?? [];
      callers.push(from);
      reverse.set(target, callers);
    }
  }
  const answer = new Map<string, ChainParentHit[]>();
  for (const subject of subjects) {
    const seen = new Map<string, string[]>([[subject.file, [subject.file]]]);
    let frontier = [subject.file];
    let hops = 0;
    while (frontier.length > 0) {
      for (const file of frontier) {
        const hits = answer.get(file) ?? [];
        hits.push({ subject, hops, via: [...(seen.get(file) ?? [file])].reverse() });
        answer.set(file, hits);
      }
      const next: string[] = [];
      for (const file of frontier) {
        for (const caller of reverse.get(file) ?? []) {
          if (seen.has(caller)) continue;
          seen.set(caller, [...(seen.get(file) ?? [file]), caller]);
          next.push(caller);
        }
      }
      frontier = next;
      hops += 1;
    }
  }
  return answer;
}

/**
 * Conjunct 1, asked of the **process** rather than of the file — for the
 * chain-parent signal only.
 *
 * The per-file closure under-approximates for a file nothing runs on its own: a
 * test *helper* reaches the harness through `import type` and so loads no
 * artefact of its own, while every test that imports it loads both. Batch four's
 * seventh site is exactly that file (`test/helpers/orders-neighbour-ports.ts`),
 * and the narrow conjunct clears it while the tree it lives in fails at ORM
 * init.
 *
 * So a file counts as sharing a process with artefact `A` when **some** walked
 * file's value-import closure holds both it and `A` — computed by walking value
 * edges backwards from the file and unioning conjunct 1's answer over everything
 * that reaches it. It is used **only** by the chain-parent signal, deliberately:
 * widening the named-binding signal the same way changes the population that
 * clears several hundred correct reaches, which is a separate question with a
 * separate measurement. Measured here — on this repository it adds one true
 * finding and no false one.
 */
function coLoadedArtefacts(
  edges: ReadonlyMap<string, readonly string[]>,
  loaded: ReadonlyMap<string, ReadonlySet<string>>,
  files: Iterable<string>,
): Map<string, ReadonlySet<string>> {
  const reverse = new Map<string, string[]>();
  for (const [from, targets] of edges) {
    for (const target of targets) {
      const callers = reverse.get(target) ?? [];
      callers.push(from);
      reverse.set(target, callers);
    }
  }
  const answer = new Map<string, ReadonlySet<string>>();
  for (const file of files) {
    if (answer.has(file)) continue;
    const out = new Set(loaded.get(file) ?? []);
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const id of loaded.get(current) ?? []) out.add(id);
      for (const caller of reverse.get(current) ?? []) {
        if (seen.has(caller)) continue;
        seen.add(caller);
        queue.push(caller);
      }
    }
    answer.set(file, out);
  }
  return answer;
}

interface Reach {
  readonly file: string;
  readonly line: number;
  readonly target: string;
  readonly pkg: ModulePackageSurface;
  readonly bindings: readonly string[];
  readonly kind: SpecifierKind;
  readonly whole: boolean;
}

function packageOf(
  key: string,
  packages: readonly ModulePackageSurface[],
): ModulePackageSurface | null {
  for (const pkg of packages) if (key.startsWith(`${pkg.root}/`)) return pkg;
  return null;
}

function bareNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/**
 * What one pass over every file's specifiers yields, for the three questions
 * that need it.
 *
 * One pass rather than three: conjunct 1's closure, the reach inventory and the
 * chain-parent walk all read the same specifiers, and parsing 3200 files is the
 * expensive half of this check. Sharing it also removes the way three copies of
 * "which specifiers count as a value edge" come to disagree.
 */
interface SpecifierGraph {
  /** Module ids whose published artefact this file names by bare specifier. */
  readonly direct: ReadonlyMap<string, ReadonlySet<string>>;
  /** Relative **value** edges, resolved to walked keys. */
  readonly edges: ReadonlyMap<string, readonly string[]>;
  /** Every reach into a module package's source, in walk order. */
  readonly reaches: readonly Reach[];
}

function specifierGraph(input: SingletonIdentityInput): SpecifierGraph {
  const keys = new Set(input.sources.keys());
  const direct = new Map<string, ReadonlySet<string>>();
  const edges = new Map<string, readonly string[]>();
  const reaches: Reach[] = [];
  for (const [key, text] of input.sources) {
    const own = packageOf(key, input.packages);
    const mine = new Set<string>();
    const targets: string[] = [];
    for (const specifier of namedSpecifiers(text, key)) {
      if (specifier.kind === 'type-only-import' || specifier.kind === 'import-type-node') continue;
      const bare = bareNameOf(specifier.text);
      const named = input.packages.find((pkg) => pkg.npmName === bare);
      if (named !== undefined && (own === null || own.npmName !== bare)) mine.add(named.moduleId);
      const target = resolveRelative(key, specifier.text, keys);
      if (target === null) continue;
      targets.push(target);
      const pkg = packageOf(target, input.packages);
      if (pkg === null || (own !== null && own.root === pkg.root)) continue;
      reaches.push({
        file: key,
        line: specifier.line,
        target,
        pkg,
        bindings: specifier.bindings,
        kind: specifier.kind,
        whole:
          specifier.kind === 'side-effect-import' ||
          specifier.kind === 'dynamic-import' ||
          specifier.kind === 'require-call' ||
          specifier.bindings.some((binding) => binding.startsWith('* as ')),
      });
    }
    direct.set(key, mine);
    edges.set(key, targets);
  }
  return { direct, edges, reaches };
}

/**
 * Every module package whose **published artefact** this file's value-import
 * closure loads — conjunct 1, derived rather than declared.
 *
 * The closure is over value edges only: a `import type` resolves at build time
 * and evaluates nothing, so it puts no second copy in any process.
 */
function artefactsLoaded(
  input: SingletonIdentityInput,
  graph: SpecifierGraph,
): Map<string, ReadonlySet<string>> {
  const { direct, edges } = graph;
  const memo = new Map<string, ReadonlySet<string>>();
  const resolve = (key: string, stack: Set<string>): ReadonlySet<string> => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (stack.has(key)) return new Set<string>();
    stack.add(key);
    const out = new Set(direct.get(key) ?? []);
    for (const target of edges.get(key) ?? []) {
      for (const id of resolve(target, stack)) out.add(id);
    }
    stack.delete(key);
    // A cycle member is not memoised under a partial answer: the first key on
    // the cycle would otherwise freeze the empty set every later visitor reads.
    if (stack.size === 0) memo.set(key, out);
    return out;
  };
  const answer = new Map<string, ReadonlySet<string>>();
  for (const key of input.sources.keys()) answer.set(key, resolve(key, new Set()));
  return answer;
}

/** The whole analysis, pure over {@link SingletonIdentityInput}. */
export function checkSingletonIdentity(
  input: SingletonIdentityInput,
  allowed: Readonly<Record<string, string>>,
): SingletonIdentityResult {
  const keys = new Set(input.sources.keys());
  const composed = composedSingletons(input);
  const graph = specifierGraph(input);
  const loaded = artefactsLoaded(input, graph);
  const parentScan = transitiveParents(input.sources);
  const subjects = chainParentSubjects(input, parentScan, composed);
  const chainReaches = chainParentReaches(graph.edges, subjects);
  const findings: SingletonIdentityFinding[] = [];
  const reaches = graph.reaches;
  const coLoaded = coLoadedArtefacts(
    graph.edges,
    loaded,
    reaches.filter((reach) => chainReaches.has(reach.target)).map((reach) => reach.file),
  );

  const usedAllowances = new Set<string>();
  for (const reach of reaches) {
    // Conjunct 1: both copies in one process. Derived, never declared.
    const sharesProcess = loaded.get(reach.file)?.has(reach.pkg.moduleId) ?? false;

    // Conjunct 2 asked of the reach's **closure** rather than of the binding it
    // names, and only for the classes whose duplication the platform refuses.
    // It runs before the two per-binding signals below because it is the one
    // that survives a `whole` reach and a reach naming an innocent binding
    // alike: what makes it a finding is what the specifier *loads*.
    for (const hit of chainReaches.get(reach.target) ?? []) {
      const { subject } = hit;
      if (!(coLoaded.get(reach.file)?.has(subject.moduleId) ?? false)) continue;
      // Hop 0 naming the class itself is already `composed-singleton-reach`,
      // which says the same thing with the binding named. Reporting it twice
      // would make the count a property of how the message is phrased.
      if (hit.hops === 0 && reach.bindings.includes(subject.className)) continue;
      findings.push({
        kind: 'chain-parent-reach',
        file: reach.file,
        line: reach.line,
        moduleId: subject.moduleId,
        target: subject.file,
        binding: subject.className,
        why:
          `\`${subject.className}\` is a \`@TransitivelyScoped\` parent — ` +
          `${subject.children.join(', ')} name${subject.children.length === 1 ? 's' : ''} it — ` +
          'and the platform resolves a tenant chain by class **name**, so two classes of that ' +
          'name are an ambiguity `assertTransitiveParentsResolve` refuses at ORM init rather ' +
          'than guesses at: `UnresolvableTenantParentError` inside `setupBackendServer`, which ' +
          'fails every file in the process rather than this one. This specifier loads it ' +
          `${hit.hops} hop(s) down, through ${hit.via.join(' -> ')}`,
      });
    }

    if (!sharesProcess) continue;
    if (reach.whole) {
      const ledgerKey = `${reach.file}:${reach.target}`;
      if (allowed[ledgerKey] !== undefined) {
        usedAllowances.add(ledgerKey);
        continue;
      }
      findings.push({
        kind: 'whole-file-reach',
        file: reach.file,
        line: reach.line,
        moduleId: reach.pkg.moduleId,
        target: reach.target,
        binding: null,
        why:
          `a ${reach.kind} names no binding, so it takes the file's whole import graph — ` +
          `every module-scope value on it is a second copy while this process also holds ` +
          `${reach.pkg.npmName}`,
      });
      continue;
    }
    for (const binding of reach.bindings) {
      const why = composed.get(bindingKey(reach.target, binding));
      if (why === undefined) continue;
      findings.push({
        kind: 'composed-singleton-reach',
        file: reach.file,
        line: reach.line,
        moduleId: reach.pkg.moduleId,
        target: reach.target,
        binding,
        why,
      });
    }
  }

  for (const ledgerKey of Object.keys(allowed)) {
    if (usedAllowances.has(ledgerKey)) continue;
    const [file = ledgerKey, target = ''] = ledgerKey.split(':');
    // Staleness is judged **in the tree that holds the file**. A ledger entry
    // names a site, and a site cannot be found absent from a tree its file is
    // not in — the fixture backends of `moved-module-tree.test.ts` carry no
    // test tree, and reporting four stale entries there would be the check
    // going red for the fixture's shape rather than for the repository's. The
    // other direction of the two-way rule — an entry whose file was *deleted*
    // — is held by `check-singleton-identity.test.ts`, which resolves every key
    // against this checkout's disk.
    if (!keys.has(file)) continue;
    findings.push({
      kind: 'stale-allowance',
      file,
      line: 0,
      moduleId: '',
      target,
      binding: null,
      why: 'the ledger allows a whole-file reach this walk did not find',
    });
  }

  const packagesWithEntities = [
    ...new Set(
      [...composed.entries()]
        .filter(([, why]) => why.includes(ENTITIES_ARRAY_WHY))
        .map(([, why]) => why.split(':')[0] ?? ''),
    ),
  ].sort();

  const entityClasses = entityClassLocations(input.sources);
  const chainParentNames = [...parentScan.parents.keys()].sort();

  return {
    findings,
    sites: reaches.length,
    singletons: composed.size,
    packagesWithEntities,
    chainParentNames,
    resolvedChainParentNames: chainParentNames.filter((name) => entityClasses.has(name)),
    unreadableChainParents: parentScan.unreadable,
    chainParentSubjects: subjects,
  };
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'build', '.next', 'coverage']);

/**
 * Every TypeScript source under `dir`, with the rule's own directory prunes.
 *
 * Exported because the population is part of the rule: two hosts computing
 * "which files this check reads" two ways is the shape that lets one of them go
 * half-blind.
 */
export function collectSingletonSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (directory) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      collectSingletonSources(full, out);
    } else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Which module packages the committed ORM registry imports an `entities` array
 * from — the independent derivation the walk is reconciled against (issue #244).
 *
 * It is a second author's answer to the same question: the registry is generated
 * from a filesystem walk of the packages' `exports` maps and names each package
 * by its bare specifier, while this check derives entities from each package's
 * own source. A walk that stopped reading a package's sources makes the two
 * disagree in the same run.
 */
export function packagesInEntitiesRegistry(source: string, npmNames: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/entities as \w+\s*\}\s*from\s*'([^']+)'/g)) {
    const bare = bareNameOf(match[1] ?? '');
    if (npmNames.has(bare)) found.add(bare);
  }
  return [...found].sort();
}

