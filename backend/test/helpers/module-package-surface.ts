import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

import {
  isInsideNestedCheckout,
  nestedCheckoutRoots,
} from '../../scripts/lib/nested-checkouts.js';

/**
 * What a module package's `./backend` subpath publishes about its entities
 * (D-168).
 *
 * The rule, in full: a module package declares **one `entities` array** and
 * **no entity class by name**. Two independent readers already take the array —
 * `src/packages/package-runtime.ts` at boot and
 * `scripts/lib/package-declarations.ts` statically — and the absence of the
 * named export is what makes `import type { BlogPost } from
 * '@endora-commerce/mod-blog/backend'` a compile error **in the consumer's own
 * tree**, where none of this repository's checks run. Measured, that error is
 * `TS2459` for a class the barrel imports in order to build the array and
 * `TS2305` for one it does not name at all; both refuse the import, which is the
 * property the ruling buys. A check keyed on a diagnostic code would be keyed on
 * an implementation detail of the barrel, so this analyser is keyed on the
 * **export**.
 *
 * ## Why the analysis is here rather than in a `check-*` script
 *
 * It reads exactly one file per package, has no ledger and no escape hatch, and
 * its population is a handful of manifests rather than the module tree — none of
 * the machinery the inventory exists to keep honest applies. What does apply is
 * issue #130: the entry point below takes a **barrel path and a reader**, so a
 * fixture enters at the top of the analysis and every step it is meant to
 * protect actually runs.
 *
 * ## What it can and cannot see
 *
 * It follows `export *` and `export { X } from '…'` through relative specifiers,
 * recursively, which is the shape that hid the defect: `blog` published eleven
 * `export *` lines and every entity class with them. A **bare** specifier is not
 * followed and is reported as `unresolvable-reexport` rather than skipped — a
 * re-export this cannot read is the one case where a silent pass would mean
 * "not looking" (issue #113). It reads literal AST nodes, so a comment quoting
 * the shape is out of the population by construction, and it does not follow a
 * class through an alias assignment or a computed export.
 */

/** A file reader the caller supplies, so a fixture can enter at the top. */
export interface SourceReader {
  readonly exists: (path: string) => boolean;
  readonly read: (path: string) => string;
}

export const nodeSourceReader: SourceReader = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, 'utf8'),
};

/** One thing wrong with a module package's published entity surface. */
export interface BackendSurfaceFinding {
  readonly kind:
    | 'missing-entities-array'
    | 'entities-not-an-array'
    | 'named-entity-export'
    | 'entity-missing-from-array'
    | 'unresolvable-reexport';
  readonly detail: string;
}

export interface BackendSurface {
  /** Names the barrel exports that resolve to a class carrying the ORM decorator. */
  readonly namedEntityExports: readonly string[];
  /** Identifier names inside the `entities` array literal, or `null` when absent. */
  readonly entitiesArray: readonly string[] | null;
  /** `true` when an `entities` export exists but is not an array literal. */
  readonly entitiesNotAnArray: boolean;
  /** Re-export specifiers the analysis could not follow. */
  readonly unresolvable: readonly string[];
}

/** The decorator the ORM keys on, assembled so this file is not its own match. */
const ENTITY_DECORATOR_NAME = `${'Ent'}${'ity'}`;

function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

/** `./x.js` → `<dir>/x.ts`, `./x` → `<dir>/x.ts` or `<dir>/x/index.ts`; `null` for a bare one. */
function resolveRelative(from: string, specifier: string, reader: SourceReader): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    base,
    join(base, 'index.ts'),
  ];
  return candidates.find((candidate) => reader.exists(candidate)) ?? null;
}

function isEntityClass(node: ts.ClassDeclaration): boolean {
  for (const decorator of ts.getDecorators(node) ?? []) {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    if (ts.isIdentifier(expression) && expression.text === ENTITY_DECORATOR_NAME) return true;
  }
  return false;
}

interface ModuleFacts {
  /** Exported name → `true` when it resolves to a class carrying the decorator. */
  readonly exports: Map<string, boolean>;
  readonly unresolvable: string[];
}

/**
 * Every name a source file exports, and whether each is an entity class.
 *
 * `seen` breaks a re-export cycle; a package that builds one is a package whose
 * own build would not terminate either, so answering once is enough.
 */
function factsFor(path: string, reader: SourceReader, seen: Set<string>): ModuleFacts {
  const facts: ModuleFacts = { exports: new Map(), unresolvable: [] };
  if (seen.has(path)) return facts;
  seen.add(path);

  const source = parse(path, reader.read(path));
  const localEntityClasses = new Map<string, boolean>();
  const localImportOrigins = new Map<string, { from: string; imported: string }>();

  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      localEntityClasses.set(statement.name.text, isEntityClass(statement));
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          localImportOrigins.set(element.name.text, {
            from: statement.moduleSpecifier.text,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
  }

  const factsOfTarget = (specifier: string): ModuleFacts | null => {
    const target = resolveRelative(path, specifier, reader);
    if (target === null) {
      facts.unresolvable.push(specifier);
      return null;
    }
    return factsFor(target, reader, seen);
  };

  for (const statement of source.statements) {
    // `export class X` / `export const x`
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isExported = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (isExported && ts.isClassDeclaration(statement) && statement.name) {
      facts.exports.set(statement.name.text, isEntityClass(statement));
      continue;
    }
    if (isExported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) facts.exports.set(declaration.name.text, false);
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;

    const specifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;

    // `export * from './x.js'`
    if (statement.exportClause === undefined) {
      if (specifier === null) continue;
      const target = factsOfTarget(specifier);
      if (target === null) continue;
      facts.unresolvable.push(...target.unresolvable);
      for (const [name, entity] of target.exports) facts.exports.set(name, entity);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;

    for (const element of statement.exportClause.elements) {
      const local = (element.propertyName ?? element.name).text;
      const exposed = element.name.text;
      if (specifier !== null) {
        const target = factsOfTarget(specifier);
        if (target === null) continue;
        facts.unresolvable.push(...target.unresolvable);
        facts.exports.set(exposed, target.exports.get(local) === true);
        continue;
      }
      // `export { X }` over a local binding, imported or declared here.
      const declaredHere = localEntityClasses.get(local);
      if (declaredHere !== undefined) {
        facts.exports.set(exposed, declaredHere);
        continue;
      }
      const origin = localImportOrigins.get(local);
      if (origin === undefined) {
        facts.exports.set(exposed, false);
        continue;
      }
      const target = factsOfTarget(origin.from);
      if (target === null) continue;
      facts.unresolvable.push(...target.unresolvable);
      facts.exports.set(exposed, target.exports.get(origin.imported) === true);
    }
  }

  return facts;
}

/** The `entities` array literal's member names, when the barrel declares one. */
function entitiesArrayOf(path: string, reader: SourceReader): {
  members: string[] | null;
  notAnArray: boolean;
} {
  const source = parse(path, reader.read(path));
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const modifiers = ts.getModifiers(statement);
    if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'entities') continue;
      let initializer = declaration.initializer;
      while (initializer && (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (initializer === undefined || !ts.isArrayLiteralExpression(initializer)) {
        return { members: null, notAnArray: true };
      }
      return {
        members: initializer.elements.filter(ts.isIdentifier).map((element) => element.text),
        notAnArray: false,
      };
    }
  }
  return { members: null, notAnArray: false };
}

/**
 * The entity surface a module package's `./backend` barrel publishes.
 *
 * `barrelPath` is the **source** file behind the subpath, and `reader` is how it
 * is read — both parameters so a fixture tree enters at the top of the analysis
 * rather than below the step it is meant to protect (issue #130).
 */
export function readBackendSurface(
  barrelPath: string,
  reader: SourceReader = nodeSourceReader,
): BackendSurface {
  const facts = factsFor(barrelPath, reader, new Set());
  const { members, notAnArray } = entitiesArrayOf(barrelPath, reader);
  return {
    namedEntityExports: [...facts.exports]
      .filter(([, entity]) => entity)
      .map(([name]) => name)
      .sort(),
    entitiesArray: members === null ? null : [...members].sort(),
    entitiesNotAnArray: notAnArray,
    unresolvable: [...new Set(facts.unresolvable)].sort(),
  };
}

/**
 * D-168, applied — the findings for one package.
 *
 * `declaredEntityClasses` is the independent oracle: every class carrying the
 * ORM decorator anywhere in the package's own sources. Comparing it to the array
 * catches the failure the new shape introduces and the old one could not have —
 * an entity added to the package and forgotten in the declaration, which under
 * `export *` was impossible and is now one omission away.
 */
export function d168Findings(
  surface: BackendSurface,
  declaredEntityClasses: readonly string[],
): BackendSurfaceFinding[] {
  const findings: BackendSurfaceFinding[] = [];
  for (const specifier of surface.unresolvable) {
    findings.push({
      kind: 'unresolvable-reexport',
      detail:
        `the barrel re-exports '${specifier}', which this analysis cannot follow, so whether ` +
        `it carries an entity class by name is unknown rather than false`,
    });
  }
  if (surface.entitiesNotAnArray) {
    findings.push({
      kind: 'entities-not-an-array',
      detail:
        `it exports 'entities' as something other than an array literal; the platform's ` +
        `loader takes it as the list of classes the host's ORM registers`,
    });
  } else if (surface.entitiesArray === null) {
    findings.push({
      kind: 'missing-entities-array',
      detail:
        `its './backend' export declares no 'entities' array. Installed rather than linked, ` +
        `the platform reads 'undefined' there and registers zero entities without a word`,
    });
  }
  for (const name of surface.namedEntityExports) {
    findings.push({
      kind: 'named-entity-export',
      detail:
        `its './backend' export names the entity class '${name}'. That is the one thing that ` +
        `makes a foreign module's 'import type { ${name} } from …' compile, in a tree where ` +
        `none of this repository's checks run (D-168)`,
    });
  }
  for (const name of declaredEntityClasses) {
    if (surface.entitiesArray !== null && !surface.entitiesArray.includes(name)) {
      findings.push({
        kind: 'entity-missing-from-array',
        detail:
          `'${name}' carries the ORM decorator in this package's sources and is not in its ` +
          `'entities' array, so the host would map it to no table`,
      });
    }
  }
  return findings;
}

/** Class names carrying the ORM decorator anywhere under a package's `src`. */
export function declaredEntityClassesUnder(dir: string): string[] {
  const names: string[] = [];
  for (const file of walkSources(dir)) {
    const source = parse(file, readFileSync(file, 'utf8'));
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
      if (isEntityClass(statement)) names.push(statement.name.text);
    }
  }
  return [...new Set(names)].sort();
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Where a package's build puts what it compiled, read out of **the tsconfig its
 * own `build` script names**.
 *
 * `scripts/lib/module-packages.ts`'s `readEmitLayout` answers the same question
 * for the composer and spells `tsconfig.build.json`, which is right there — the
 * two-tsconfig split is a rule for a *workspace* package, whose type-check
 * config carries `paths` and cannot emit. It is not a rule for a module package
 * in general: the acceptance fixture is outside the workspace, has no `paths`
 * to clear, and builds with `tsc -p tsconfig.json`. Deriving the filename from
 * the `build` script is the declaration rather than a second convention, and it
 * follows a package that renames its build config.
 *
 * `null` means the package declares no build, so it publishes its sources where
 * they are and the `exports` target already names one.
 */
export function emitLayoutOfBuild(
  dir: string,
  buildScript: string | undefined,
): { rootDir: string; outDir: string } | null {
  if (buildScript === undefined) return null;
  const named = /(?:^|\s)-p\s+(\S+)|(?:^|\s)--project\s+(\S+)/.exec(buildScript);
  const configName = named?.[1] ?? named?.[2] ?? 'tsconfig.json';
  let current = resolve(dir, configName);
  const seen = new Set<string>();
  let rootDir: string | null = null;
  let outDir: string | null = null;

  while (!seen.has(current) && existsSync(current)) {
    seen.add(current);
    const text = readFileSync(current, 'utf8')
      .split('\n')
      .map((line) => (/^\s*\/\//.test(line) ? '' : line))
      .join('\n');
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
    const options = (config['compilerOptions'] ?? {}) as Record<string, unknown>;
    if (rootDir === null && typeof options['rootDir'] === 'string') {
      rootDir = options['rootDir'].replace(/^\.\//, '').replace(/\/$/, '');
    }
    if (outDir === null && typeof options['outDir'] === 'string') {
      outDir = options['outDir'].replace(/^\.\//, '').replace(/\/$/, '');
    }
    const parent = config['extends'];
    if (typeof parent !== 'string' || !parent.startsWith('.')) break;
    current = resolve(dirname(current), parent);
  }
  return rootDir !== null && outDir !== null ? { rootDir, outDir } : null;
}

/**
 * The source file behind a package's `./backend` subpath.
 *
 * A module package ships `dist` (D-164), so the `exports` target names a `.js`
 * under `outDir` while the file an author edits is a `.ts` under `rootDir`. The
 * mapping is the inverse of `scripts/lib/module-packages.ts`'s `emittedPathOf`
 * and is read out of the package's own build declaration for the same reason:
 * a package with no build publishes what it wrote, and its target already names
 * the source.
 */
export function backendBarrelSourceOf(
  dir: string,
  target: string,
  emit: { rootDir: string; outDir: string } | null,
): string | null {
  const relative = target.replace(/^\.\//, '');
  const packageRelative =
    emit !== null && relative.startsWith(`${emit.outDir}/`)
      ? join(emit.rootDir, relative.slice(emit.outDir.length + 1))
      : relative;
  const absolute = isAbsolute(packageRelative) ? packageRelative : join(dir, packageRelative);
  for (const candidate of [absolute.replace(/\.js$/, '.ts'), absolute]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** A module package the checkout holds, as its own manifest declares it. */
export interface ScannedModuleManifest {
  /** The `endora.id` the package declares — identity of record (D-142). */
  readonly moduleId: string;
  /** The npm name, which is npm's namespace and not identity. */
  readonly name: string;
  /** Absolute directory holding the manifest. */
  readonly dir: string;
  /** The `./backend` export target, or `null` when the package publishes none. */
  readonly backendTarget: string | null;
  /**
   * The `./ports` export target, or `null` when the package publishes none.
   *
   * A package with no cross-module seam of its own declares no `./ports`, and
   * that is the ordinary case — the subpath is not part of the minimum shape.
   */
  readonly portsTarget: string | null;
  /** The package's own `build` script, which names the tsconfig its emit follows. */
  readonly buildScript: string | undefined;
}

/** Directories a scan for module manifests never enters. */
const SKIPPED_SCAN_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.next',
  'build',
]);

/** How deep below the repository root a module package can sit. */
const MAX_SCAN_DEPTH = 6;

function exportTargetOf(manifest: Record<string, unknown>, subpath: string): string | null {
  const exportsMap = manifest['exports'] as Record<string, unknown> | undefined;
  const declared = exportsMap?.[subpath];
  if (typeof declared === 'string') return declared;
  const withConditions = declared as { default?: unknown } | undefined;
  return typeof withConditions?.default === 'string' ? withConditions.default : null;
}

/**
 * Every `endora: { type: 'module' }` manifest **in this checkout**, fixtures
 * included.
 *
 * Deliberately wider than the workspace globs: a module package that is not a
 * member — the acceptance fixture is one by design (D-110) — is a module
 * package all the same, and a rule about what a module package publishes has to
 * be able to see it. That width is the whole value of the sweep, so the two
 * exclusions below are the only ones it makes.
 *
 * ## "In this checkout" excludes a checkout nested inside it
 *
 * Agents in this project work in `git worktree`s created **under** the
 * repository directory, and each is a complete copy of the tree — so without
 * the prune this scan finds one of every module manifest per worktree, fifty-one
 * of them on the machine this was written for, and the accounting sweep that
 * consumes it reports every one as unaccounted. It did: the D-168 guard was red
 * on every developer machine within an hour of merging and green in CI, CI being
 * right only because it has no nested worktrees.
 *
 * A nested work tree is another commit of this same repository, so scanning it
 * means judging another branch's tree and reporting the verdict as this one's.
 * Pruning it therefore *narrows the population to the subject* rather than
 * excusing part of it, and two module packages that genuinely share a directory
 * name in one checkout are still both reported. The discriminator is the `.git`
 * entry rather than a path name, for the reasons
 * `scripts/lib/nested-checkouts.ts` records — chiefly that `.claude/worktrees`
 * is a derived fact, and writing it down (D-100) would miss the first checkout
 * parked anywhere else.
 */
export function moduleManifestsInCheckout(root: string): ScannedModuleManifest[] {
  const nested = nestedCheckoutRoots(root);
  const out: ScannedModuleManifest[] = [];

  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    if (entries.includes('package.json')) {
      let manifest: Record<string, unknown> | null = null;
      try {
        manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        manifest = null;
      }
      const endora = manifest?.['endora'] as { type?: unknown; id?: unknown } | undefined;
      if (manifest !== null && endora?.type === 'module' && typeof endora.id === 'string') {
        out.push({
          moduleId: endora.id,
          name: String(manifest['name'] ?? endora.id),
          dir: directory,
          backendTarget: exportTargetOf(manifest, './backend'),
          portsTarget: exportTargetOf(manifest, './ports'),
          buildScript: (manifest['scripts'] as Record<string, string> | undefined)?.['build'],
        });
      }
    }
    for (const entry of entries) {
      if (SKIPPED_SCAN_DIRECTORIES.has(entry)) continue;
      const full = join(directory, entry);
      if (isInsideNestedCheckout(relative(root, full), nested)) continue;
      try {
        if (statSync(full).isDirectory()) visit(full, depth + 1);
      } catch {
        /* a dangling link is not a package */
      }
    }
  };

  visit(root, 0);
  return out;
}

/**
 * What a module package's `./ports` subpath publishes (D-169, owner approval of
 * 2026-08-24).
 *
 * D-169 rules that a co-transactional cross-module seam becomes an
 * `EntityManager`-taking published port. Those interfaces have nowhere to live:
 * `@endora-commerce/contracts` is compiled by `admin` and `storefront` as well
 * as by the backend, and it holds **zero** `@mikro-orm` imports on purpose,
 * which is why `CreditLimitPort` sits beside its implementation and says so in
 * its own header. So the owner's provider publishes them itself, on an
 * enumerated `./ports` subpath that carries **types only**.
 *
 * ## The rule, and why it needs a guard at all
 *
 * `./ports` is a second declared door out of a module package, and D-168 shut
 * the first one deliberately: `./backend` publishes `export const entities =
 * [...]` and **no entity class by name**, so `import type { BlogPost } from
 * '@endora-commerce/mod-blog/backend'` is a compile error in the consumer's own
 * tree, where none of this repository's checks run. A subpath added later, by an
 * author who never read that ruling, is exactly how that guarantee is given
 * back — one `export type { QuoteRequest }` line, in a file whose whole point is
 * that it publishes types.
 *
 * Two properties, therefore, and they fail for different reasons:
 *
 *  - **Nothing crosses `./ports` at runtime.** The subpath's emitted module must
 *    export no binding. A value there is a second import path into the package's
 *    implementation, and — unlike a type — it survives into the consumer's
 *    bundle, so the owner's activation state stops deciding anything.
 *  - **No entity class by name, type-only included.** The type position is the
 *    whole hazard D-168 named: erasure makes it free at runtime and permanent at
 *    compile time.
 *
 * ## What it can and cannot see
 *
 * It reads literal AST nodes, so a comment quoting either shape is out of the
 * population by construction. Type-only-ness is read as **syntax** —
 * `export type { … }`, `export type * from`, an element's own `type` keyword,
 * and the inherently type-only declarations — which is what the compiler reads
 * under `verbatimModuleSyntax` (`tsconfig.base.json`), so the two cannot come to
 * disagree. Entity-ness is resolved through relative specifiers, recursively,
 * and a **bare** specifier is reported as `unresolvable-reexport` rather than
 * skipped: a re-export this cannot follow leaves the entity question unknown
 * rather than answered no (issue #113).
 */

/** One thing wrong with a module package's published `./ports` surface. */
export interface PortsSurfaceFinding {
  readonly kind: 'runtime-export' | 'named-entity-export' | 'unresolvable-reexport';
  readonly detail: string;
}

export interface PortsSurface {
  /** Exported names that survive into the emitted JavaScript. */
  readonly runtimeExports: readonly string[];
  /** Every name the subpath publishes, type-only ones included. */
  readonly publishedNames: readonly string[];
  /** Published names that resolve to a class carrying the ORM decorator. */
  readonly entityExports: readonly string[];
  /** Re-export specifiers the analysis could not follow. */
  readonly unresolvable: readonly string[];
}

interface PortsAccumulator {
  readonly runtimeExports: Set<string>;
  readonly publishedNames: Set<string>;
  readonly entityExports: Set<string>;
  readonly unresolvable: Set<string>;
}

function hasExportModifier(statement: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/**
 * The ports barrel's published surface.
 *
 * `barrelPath` is the **source** file behind the subpath and `reader` is how it
 * is read, both parameters for the same reason `readBackendSurface` takes them:
 * a fixture enters at the top of the analysis rather than below the step it is
 * meant to protect (issue #130).
 */
export function readPortsSurface(
  barrelPath: string,
  reader: SourceReader = nodeSourceReader,
): PortsSurface {
  const found: PortsAccumulator = {
    runtimeExports: new Set(),
    publishedNames: new Set(),
    entityExports: new Set(),
    unresolvable: new Set(),
  };
  const source = parse(barrelPath, reader.read(barrelPath));

  const localClasses = new Map<string, boolean>();
  const localImportOrigins = new Map<string, { from: string; imported: string }>();
  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) && statement.name) {
      localClasses.set(statement.name.text, isEntityClass(statement));
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          localImportOrigins.set(element.name.text, {
            from: statement.moduleSpecifier.text,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
  }

  const factsOf = (specifier: string): ModuleFacts | null => {
    const target = resolveRelative(barrelPath, specifier, reader);
    if (target === null) {
      found.unresolvable.add(specifier);
      return null;
    }
    const facts = factsFor(target, reader, new Set());
    for (const unresolved of facts.unresolvable) found.unresolvable.add(unresolved);
    return facts;
  };

  const publish = (name: string, entity: boolean, runtime: boolean): void => {
    found.publishedNames.add(name);
    if (entity) found.entityExports.add(name);
    if (runtime) found.runtimeExports.add(name);
  };

  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      // `export default x` and `export = x` are both value exports, and neither
      // has a name this could publish it under instead.
      publish('default', false, true);
      continue;
    }
    if (hasExportModifier(statement)) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        publish(statement.name.text, false, false);
        continue;
      }
      if (ts.isClassDeclaration(statement) && statement.name) {
        publish(statement.name.text, isEntityClass(statement), true);
        continue;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        publish(statement.name.text, false, true);
        continue;
      }
      if (ts.isEnumDeclaration(statement)) {
        publish(statement.name.text, false, true);
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) publish(declaration.name.text, false, true);
        }
        continue;
      }
    }
    if (!ts.isExportDeclaration(statement)) continue;

    const specifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;

    // `export * from './x.js'` / `export type * from './x.js'`
    if (statement.exportClause === undefined) {
      if (specifier === null) continue;
      const facts = factsOf(specifier);
      if (!statement.isTypeOnly) found.runtimeExports.add(`* from '${specifier}'`);
      if (facts === null) continue;
      for (const [name, entity] of facts.exports) publish(name, entity, !statement.isTypeOnly);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;

    for (const element of statement.exportClause.elements) {
      const local = (element.propertyName ?? element.name).text;
      const exposed = element.name.text;
      const runtime = !statement.isTypeOnly && !element.isTypeOnly;
      if (specifier !== null) {
        const facts = factsOf(specifier);
        publish(exposed, facts?.exports.get(local) === true, runtime);
        continue;
      }
      const declaredHere = localClasses.get(local);
      if (declaredHere !== undefined) {
        publish(exposed, declaredHere, runtime);
        continue;
      }
      const origin = localImportOrigins.get(local);
      if (origin === undefined) {
        publish(exposed, false, runtime);
        continue;
      }
      const facts = factsOf(origin.from);
      publish(exposed, facts?.exports.get(origin.imported) === true, runtime);
    }
  }

  const sorted = (values: Set<string>): string[] => [...values].sort();
  return {
    runtimeExports: sorted(found.runtimeExports),
    publishedNames: sorted(found.publishedNames),
    entityExports: sorted(found.entityExports),
    unresolvable: sorted(found.unresolvable),
  };
}

/**
 * D-169, applied — the findings for one package's `./ports` surface.
 *
 * `declaredEntityClasses` is the same independent oracle `d168Findings` takes:
 * every class carrying the ORM decorator anywhere in the package's own sources.
 * It answers the case the resolution walk cannot — a name re-exported through a
 * shape this does not follow is still that entity's name published on the
 * subpath.
 */
export function d169PortsFindings(
  surface: PortsSurface,
  declaredEntityClasses: readonly string[],
): PortsSurfaceFinding[] {
  const findings: PortsSurfaceFinding[] = [];
  for (const specifier of surface.unresolvable) {
    findings.push({
      kind: 'unresolvable-reexport',
      detail:
        `its './ports' barrel re-exports '${specifier}', which this analysis cannot follow, ` +
        `so whether it carries an entity class by name is unknown rather than false`,
    });
  }
  for (const name of surface.runtimeExports) {
    findings.push({
      kind: 'runtime-export',
      detail:
        `its './ports' export carries '${name}' into the emitted JavaScript. The subpath is ` +
        `type-only (D-169): a value there is a second import path into the package's ` +
        `implementation, and it survives into the consumer's bundle, where the owner's ` +
        `activation state decides nothing`,
    });
  }
  const entityNames = new Set([
    ...surface.entityExports,
    ...declaredEntityClasses.filter((name) => surface.publishedNames.includes(name)),
  ]);
  for (const name of [...entityNames].sort()) {
    findings.push({
      kind: 'named-entity-export',
      detail:
        `its './ports' export names the entity class '${name}'. Erasing at runtime does not ` +
        `make it free: it is what makes a foreign module's ` +
        `'import type { ${name} } from …/ports' compile, which is the door D-168 shut on ` +
        `'./backend'`,
    });
  }
  return findings;
}

/**
 * Names an **emitted** ES module exports at runtime, read as syntax.
 *
 * The source analysis above answers what the author wrote; this answers what the
 * build actually published, and only the second is what a consumer's bundler
 * loads. A type-only module compiles to `export {};` under
 * `verbatimModuleSyntax`, so the sound answer here is the empty list.
 */
export function runtimeExportsOfEmittedModule(
  path: string,
  reader: SourceReader = nodeSourceReader,
): string[] {
  const source = parse(path, reader.read(path));
  const found = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      found.add('default');
      continue;
    }
    if (hasExportModifier(statement)) {
      if (ts.isClassDeclaration(statement) && statement.name) found.add(statement.name.text);
      else if (ts.isFunctionDeclaration(statement) && statement.name) found.add(statement.name.text);
      else if (ts.isEnumDeclaration(statement)) found.add(statement.name.text);
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) found.add(declaration.name.text);
        }
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    if (statement.exportClause === undefined) {
      if (specifier !== null) found.add(`* from '${specifier}'`);
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      found.add(element.name.text);
    }
  }
  return [...found].sort();
}
