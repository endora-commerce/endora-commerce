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
 * ## Two findings
 *
 *   * **`composed-singleton-reach`** — the conjunction above, with the binding
 *     named. **No ledger, deliberately**: the composed container and
 *     `test/helpers/package-singletons.ts` / `package-entities.ts` are the
 *     supported doors and are always available, so an entry could only license
 *     re-opening the defect.
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
 *   * A singleton reached **transitively** — a test that imports a service class
 *     from a package's source, where that class's module body closes over the
 *     package's registry. Conjunct 2 is per binding, so the closure is invisible.
 *     `whole-file-reach` covers the shape where the reach names no binding at
 *     all; this one names the wrong one.
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
 *
 * Static analysis through the TypeScript compiler API, so a specifier mentioned
 * in a comment or a string literal is not a finding.
 *
 * Usage: `tsx scripts/check-singleton-identity.ts [--list]`
 * Exit 0 = every composed singleton exists once; 1 = at least one second copy;
 * 2 = the check did not read its population.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

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
}

/**
 * Whole-file reaches into a module package's source that are right to stand.
 *
 * **Two-way**: a reach with no entry is a finding, and an entry that names no
 * reach is a `stale-allowance` finding. The key is `<file>:<target>` — line
 * independent, so moving the import does not need an edit here.
 *
 * Each entry says why the second copy is **right**, not that it is tolerated.
 */
export const WHOLE_FILE_REACHES_ALLOWED: Readonly<Record<string, string>> = {
  'backend/test/integration/blog/asset-reference-while-off.test.ts:packages/modules/blog/src/backend/index.ts':
    "composes `blog`'s own `registerModule` from source into a container of its own, to drive " +
    'the contribution half of its split boot hook in isolation (issue #146, D-67/D-68) — the ' +
    'published artefact composes into the harness container and cannot be re-composed there. ' +
    'The second copy is inert: the descriptor it contributes resolves references through SQL ' +
    'over the table `blog` owns (feature 077, D-87), so no entity class of the second copy ' +
    'ever reaches the ORM. Retires when the kernel offers a seam for composing one module ' +
    'twice, or when the contribution is readable without composing at all.',
  'backend/test/integration/cms/asset-reference-while-off.test.ts:packages/modules/cms/src/backend/index.ts':
    "the `cms` twin of the entry above, for the same boot-hook split and with the same reason: " +
    'the contributed descriptor resolves through SQL, so the second copy holds no ORM identity.',
  'backend/test/unit/blog/boot-hook-split.test.ts:packages/modules/blog/src/backend/index.ts':
    'the unit twin of the integration entry above (issue #146, D-68), and the artefact it ' +
    "shares the process with is the package's **root** export — the manifest, which " +
    '`manifest-index.generated.ts` imports and which is a descriptor the host reads and ' +
    'nobody mutates. Nothing behind `./backend` is loaded twice here: this test composes ' +
    "`blog` alone, over a stub `emFactory` that returns `{}`, so the second copy's entity " +
    'classes reach no ORM and its container is its own. Retires with the integration entry, ' +
    'on the same seam.',
  'backend/test/unit/cms/boot-hook-split.test.ts:packages/modules/cms/src/backend/index.ts':
    'the `cms` twin of the entry above, for the same boot-hook split and with the same reason: ' +
    'the artefact in the process is the root manifest, the composition is this test\'s own, and ' +
    'the stub `emFactory` means no entity class of the second copy reaches an ORM.',
};

const REGISTRATION_CALLS = /(?:^|\.)(asValue|asFunction|asClass)$/;

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
              record(element, "the ORM registered this class from the package's entities array", [
                'entity',
              ]);
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
 * Every module package whose **published artefact** this file's value-import
 * closure loads — conjunct 1, derived rather than declared.
 *
 * The closure is over value edges only: a `import type` resolves at build time
 * and evaluates nothing, so it puts no second copy in any process.
 */
function artefactsLoaded(input: SingletonIdentityInput): Map<string, ReadonlySet<string>> {
  const keys = new Set(input.sources.keys());
  const direct = new Map<string, Set<string>>();
  const edges = new Map<string, string[]>();
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
      if (target !== null) targets.push(target);
    }
    direct.set(key, mine);
    edges.set(key, targets);
  }
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
  allowed: Readonly<Record<string, string>> = WHOLE_FILE_REACHES_ALLOWED,
): SingletonIdentityResult {
  const keys = new Set(input.sources.keys());
  const composed = composedSingletons(input);
  const loaded = artefactsLoaded(input);
  const findings: SingletonIdentityFinding[] = [];
  const reaches: Reach[] = [];

  for (const [key, text] of input.sources) {
    const own = packageOf(key, input.packages);
    for (const specifier of namedSpecifiers(text, key)) {
      if (specifier.kind === 'type-only-import' || specifier.kind === 'import-type-node') continue;
      const target = resolveRelative(key, specifier.text, keys);
      if (target === null) continue;
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
  }

  const usedAllowances = new Set<string>();
  for (const reach of reaches) {
    // Conjunct 1: both copies in one process. Derived, never declared.
    if (!(loaded.get(reach.file)?.has(reach.pkg.moduleId) ?? false)) continue;
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
        .filter(([, why]) => why.includes('entities array'))
        .map(([, why]) => why.split(':')[0] ?? ''),
    ),
  ].sort();

  return { findings, sites: reaches.length, singletons: composed.size, packagesWithEntities };
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'build', '.next', 'coverage']);

function walk(dir: string, out: string[] = []): string[] {
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
      walk(full, out);
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

/** Every directory a consumer of a module package's source can live in. */
function consumerRoots(layout: ModuleTreeLayout): string[] {
  const roots = [layout.applicationRoot];
  if (layout.platformRoot !== null) roots.push(layout.platformRoot);
  for (const root of layout.moduleRoots) {
    if (root.origin === 'workspace-package') roots.push(root.directory);
  }
  return roots.filter((root, index, all) => all.indexOf(root) === index);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[singleton-identity]');
  const packages: ModulePackageSurface[] = [];
  for (const [npmName, moduleId] of layout.modulePackageNames) {
    const root = layout.moduleRoots.find(
      (candidate) => candidate.origin === 'workspace-package' && candidate.moduleId === moduleId,
    );
    if (root === undefined) continue;
    packages.push({
      moduleId,
      npmName,
      root: relative(layout.repoRoot, root.directory).split(sep).join('/'),
    });
  }
  const files = consumerRoots(layout).flatMap((root) => walk(root));
  // #215's floor **first**, before every other refusal this check has. A tree
  // whose modules have moved out from under the walk fails all of them at once
  // — no module package is discovered either — and the first message wins, so
  // the order decides whether the author is told "the module tree moved" or
  // something downstream of that. It is also what
  // `test/unit/scripts/moved-module-tree.test.ts` reads.
  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  const modulePopulation = await refuseVacuousModulePopulation({
    prefix: '[singleton-identity]',
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });
  if (packages.length === 0) {
    console.error(
      '[singleton-identity] this workspace declares no module package, so no module has a ' +
        'published artefact for a filesystem reach to duplicate — the rule has no subject; ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(layout.repoRoot, file).split(sep).join('/'), readFileSync(file, 'utf8'));
  }
  const result = checkSingletonIdentity({ sources, packages });
  if (result.singletons === 0) {
    console.error(
      `[singleton-identity] ${packages.length} module package(s) declare no composed ` +
        'singleton at all — no container registration and no entity class — so every reach ' +
        'into their sources reads clean whatever it names; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const npmNames = new Set(packages.map((pkg) => pkg.npmName));
  const registryPath = join(layout.srcRoot, 'db', 'entities-registry.generated.ts');
  let registryPackages: string[];
  try {
    registryPackages = packagesInEntitiesRegistry(readFileSync(registryPath, 'utf8'), npmNames);
  } catch (error: unknown) {
    console.error(
      `[singleton-identity] the generated entity registry at ${registryPath} could not be ` +
        `read (${String(error)}) — it is the independent derivation this walk is reconciled ` +
        'against; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const derived = new Set(result.packagesWithEntities);
  const coverage: ReadCoverage[] = [
    modulePopulation,
    {
      source: 'entities-registry',
      expected: registryPackages.length,
      covered: registryPackages.filter((npmName) => {
        const pkg = packages.find((candidate) => candidate.npmName === npmName);
        return pkg !== undefined && derived.has(pkg.moduleId);
      }).length,
    },
  ];

  if (listMode) {
    console.log(`[singleton-identity] ${packages.length} module package(s):`);
    for (const pkg of packages) console.log(`  - ${pkg.moduleId} (${pkg.npmName}) at ${pkg.root}`);
  }

  reportReadSize({
    prefix: '[singleton-identity]',
    files: files.length,
    sites: result.sites,
    coverage,
  });
  console.log(
    `[singleton-identity] packages=${packages.length} composed singletons=${result.singletons} ` +
      `ledger-size=${Object.keys(WHOLE_FILE_REACHES_ALLOWED).length} ` +
      `violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      "\nA module package's process singletons must exist once. The platform composes the " +
        "package through its published artefact ('dist', via the bare specifier); a " +
        'filesystem path into the same package\'s source evaluates it a second time, and the ' +
        'second copy is empty rather than absent — a registry with no adapters, an entity the ' +
        'ORM never discovered, an `instanceof` that is false. Take the object from the ' +
        'composed container (`test/helpers/package-singletons.ts`) or the class from the ' +
        "package's published `entities` array (`test/helpers/package-entities.ts`); an " +
        '`import type` of the source is free, because it erases:',
    );
    for (const finding of result.findings) {
      const at = finding.line > 0 ? `:${finding.line}` : '';
      const binding = finding.binding === null ? '' : ` '${finding.binding}'`;
      console.error(
        `  - [${finding.kind}] ${finding.file}${at}${binding} <- ${finding.target}\n` +
          `      ${finding.why}`,
      );
    }
  }

  process.exit(result.findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
