/**
 * The boundary between two overlay modules — one analysis, two readers
 * (`specs/190-overlay-full-modules/` FR-070, FR-071; `contracts/overlay-ports.md` §2, §3).
 *
 * An overlay module may publish its port's types in its own `ports.ts`, and another
 * overlay module may import that file. Exactly one shape of that import is
 * sanctioned, and it is sanctioned iff **all four** clauses hold:
 *
 *   1. `type-only` — `import type …`, or every specifier `type`-qualified, or an
 *      `import('…').T` type node. A value in `ports.ts` (the owner's refusing
 *      default client, say) is then never evaluated outside the owner's gate.
 *   2. `ports-file` — it resolves to exactly `<sibling>/ports.ts` (`ports.js`,
 *      `ports.d.ts` or the extensionless spelling): not another file, not a
 *      `ports/` directory.
 *   3. `same-deployment` — both modules are under the same
 *      `apps/<deployment>/modules/`. Another deployment's module is never composed
 *      beside this one.
 *   4. `declared-dependency` — the importer's manifest `dependencies`, transitively,
 *      contain the sibling. The dependency is what the lifecycle, the migration order
 *      and both activation axes read; an import with no edge behind it is a coupling
 *      an operator can switch off underneath.
 *
 * Every other import between two overlay modules is a finding naming importer,
 * target, file and **every** clause that failed. An overlay reaching a core module or
 * a package is not this analysis' edge: that stays the existing boundary rule.
 *
 * ## The two readers
 *
 * `check:module-boundary` in this repository (whose files are keyed under
 * `backend/src/`, so `apps/<deployment>/modules/<id>/…`) and `endora generate` in an
 * instance (keyed under the instance root, the same shape). Both hand this module a
 * map of source texts and a map of declared dependencies, and neither decides an edge
 * itself — two derivations of one fact are two answers waiting to disagree.
 *
 * The dependencies are read off each `manifest.ts` as a **literal**
 * ({@link readManifestDependencies}), in both readers: an instance has no manifest
 * index and must not execute a client's manifest to lint it. A list that is not
 * written as literals answers `null`, and `null` declares nothing — the fail-closed
 * direction, since the only thing a missing answer can do here is fail clause 4.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { parseSource } from './parsed-source.js';
import { namedSpecifiers, type NamedSpecifier, type SpecifierKind } from './specifiers.js';

/** The four clauses of `overlay-ports.md` §2, in its order. */
export type OverlayBoundaryClause =
  | 'type-only'
  | 'ports-file'
  | 'same-deployment'
  | 'declared-dependency';

/** The sentence each clause states, for a finding's reader. */
export const OVERLAY_BOUNDARY_CLAUSES: Readonly<Record<OverlayBoundaryClause, string>> = {
  'type-only':
    'the import is not type-only — write `import type { … }` (or qualify every specifier ' +
    'with `type`), so nothing of the sibling is evaluated outside its own gate',
  'ports-file':
    "it does not resolve to the sibling's `ports.ts` — `ports.ts` is the only file of an " +
    'overlay module another one may import; move the type there',
  'same-deployment':
    'the sibling is in another deployment, which is never composed beside this one — ' +
    'copy the type, or move both modules into one deployment',
  'declared-dependency':
    "the importer's manifest `dependencies` do not (transitively) name the sibling — add " +
    'it, so the lifecycle, the migration order and both activation axes see the edge',
};

/** An overlay module's place in the tree: `apps/<deployment>/modules/<id>`. */
export interface OverlayModuleRef {
  readonly deployment: string;
  readonly id: string;
  /** `apps/<deployment>/modules/<id>`. */
  readonly dir: string;
}

const OVERLAY_PATH = /^apps\/([^/]+)\/modules\/([^/]+)(?:\/|$)/;

/** The overlay module a tree path belongs to, or `null` for any other path. */
export function overlayModuleOf(path: string): OverlayModuleRef | null {
  const match = OVERLAY_PATH.exec(path);
  if (match === null) return null;
  const [, deployment, id] = match;
  return { deployment: deployment!, id: id!, dir: `apps/${deployment!}/modules/${id!}` };
}

export interface OverlayBoundaryInput {
  /** Every overlay source, keyed by its path under the tree root, POSIX separators. */
  readonly sources: ReadonlyMap<string, string>;
  /**
   * Each overlay module's declared `dependencies`, keyed by its directory
   * (`apps/<deployment>/modules/<id>`). `null` is a manifest whose list could not be
   * read as literals; an absent key is a module with no manifest. Both declare nothing.
   */
  readonly dependencies: ReadonlyMap<string, readonly string[] | null>;
}

/** One import from an overlay module into another one. */
export interface OverlayBoundaryEdge {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly kind: SpecifierKind;
  readonly importer: string;
  readonly importerDeployment: string;
  readonly target: string;
  readonly targetDeployment: string;
  /** The target path inside the sibling, extension dropped: `ports`, `services/x`. */
  readonly targetPath: string;
}

/** An edge that is not the sanctioned one, with every clause it failed. */
export interface OverlayBoundaryFinding extends OverlayBoundaryEdge {
  readonly failed: readonly OverlayBoundaryClause[];
}

export interface OverlayBoundaryResult {
  readonly findings: readonly OverlayBoundaryFinding[];
  readonly sanctioned: readonly OverlayBoundaryEdge[];
  /** Specifiers the walk examined, cleared ones included. */
  readonly examined: number;
}

function posixNormalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

function posixDirname(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

/** Every binding of the import declaration at `line` naming `specifier` is `type`-qualified. */
function everyBindingTyped(source: string, file: string, line: number, specifier: string): boolean {
  const tree = parseSource(file, source);
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== specifier) continue;
    const at = tree.getLineAndCharacterOfPosition(statement.moduleSpecifier.getStart(tree)).line + 1;
    if (at !== line) continue;
    const clause = statement.importClause;
    if (clause === undefined) return false;
    if (clause.isTypeOnly) return true;
    if (clause.name !== undefined) return false;
    const bound = clause.namedBindings;
    if (bound === undefined || !ts.isNamedImports(bound)) return false;
    return bound.elements.length > 0 && bound.elements.every((element) => element.isTypeOnly);
  }
  return false;
}

function isTypeOnly(kind: SpecifierKind, typedEverywhere: () => boolean): boolean {
  if (kind === 'type-only-import' || kind === 'import-type-node') return true;
  return kind === 'mixed-type-specifier' && typedEverywhere();
}

/** Every module id reachable from `id` over its deployment's declared dependencies. */
function closureOf(
  module: OverlayModuleRef,
  dependencies: ReadonlyMap<string, readonly string[] | null>,
): ReadonlySet<string> {
  const declaredIn = (id: string): readonly string[] =>
    dependencies.get(`apps/${module.deployment}/modules/${id}`) ?? [];
  const reachable = new Set<string>();
  const stack = [...declaredIn(module.id)];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === module.id || reachable.has(next)) continue;
    reachable.add(next);
    stack.push(...declaredIn(next));
  }
  return reachable;
}

/**
 * The verdict on one specifier of an overlay source, or `null` when it is not an
 * edge between two overlay modules — a bare specifier, an import inside the module,
 * an import out to core. An empty `failed` is the sanctioned import.
 *
 * Per specifier as well as per file ({@link analyzeOverlaySource}), because
 * `check:module-boundary` walks every specifier once for all of its edges and asks
 * this for the overlay ones; a second walk there would be a second reading of which
 * specifiers a file names.
 */
export function overlayEdgeOf(
  source: string,
  file: string,
  specifier: NamedSpecifier,
  dependencies: ReadonlyMap<string, readonly string[] | null>,
): OverlayBoundaryFinding | null {
  const importer = overlayModuleOf(file);
  if (importer === null || !specifier.text.startsWith('.')) return null;
  const resolved = posixNormalize(`${posixDirname(file)}/${specifier.text}`);
  const target = overlayModuleOf(resolved);
  if (target === null || target.dir === importer.dir) return null;
  const targetPath = resolved
    .slice(target.dir.length + 1)
    .replace(/\.d\.ts$/, '')
    .replace(/\.(jsx?|tsx?|mjs|cjs|mts|cts)$/, '');
  const failed: OverlayBoundaryClause[] = [];
  if (!isTypeOnly(specifier.kind, () => everyBindingTyped(source, file, specifier.line, specifier.text))) {
    failed.push('type-only');
  }
  if (targetPath !== 'ports') failed.push('ports-file');
  if (target.deployment !== importer.deployment) failed.push('same-deployment');
  if (!closureOf(importer, dependencies).has(target.id)) failed.push('declared-dependency');
  return {
    file,
    line: specifier.line,
    specifier: specifier.text,
    kind: specifier.kind,
    importer: importer.id,
    importerDeployment: importer.deployment,
    target: target.id,
    targetDeployment: target.deployment,
    targetPath,
    failed,
  };
}

/**
 * The verdict on every import one overlay source names. `file` is its path under the
 * tree root; a path outside `apps/<deployment>/modules/<id>/` has no overlay edge.
 */
export function analyzeOverlaySource(
  source: string,
  file: string,
  dependencies: ReadonlyMap<string, readonly string[] | null>,
): OverlayBoundaryResult {
  if (overlayModuleOf(file) === null) return { findings: [], sanctioned: [], examined: 0 };
  const findings: OverlayBoundaryFinding[] = [];
  const sanctioned: OverlayBoundaryEdge[] = [];
  const specifiers = namedSpecifiers(source, file);
  for (const specifier of specifiers) {
    const edge = overlayEdgeOf(source, file, specifier, dependencies);
    if (edge === null) continue;
    if (edge.failed.length === 0) {
      const { failed: _none, ...sanctionedEdge } = edge;
      sanctioned.push(sanctionedEdge);
    } else findings.push(edge);
  }
  return { findings, sanctioned, examined: specifiers.length };
}

/** The analysis over a whole tree, in file then line order. */
export function analyzeOverlayBoundary(input: OverlayBoundaryInput): OverlayBoundaryResult {
  const findings: OverlayBoundaryFinding[] = [];
  const sanctioned: OverlayBoundaryEdge[] = [];
  let examined = 0;
  for (const file of [...input.sources.keys()].sort()) {
    const result = analyzeOverlaySource(input.sources.get(file)!, file, input.dependencies);
    findings.push(...result.findings);
    sanctioned.push(...result.sanctioned);
    examined += result.examined;
  }
  return { findings, sanctioned, examined };
}

/** One finding as a reader meets it: where, who, which sibling, and each failed clause. */
export function describeOverlayBoundaryFinding(finding: OverlayBoundaryFinding): string {
  return (
    `${finding.file}:${String(finding.line)} — overlay module ${finding.importer} ` +
    `(deployment ${finding.importerDeployment}) imports '${finding.specifier}' from overlay ` +
    `module ${finding.target} (deployment ${finding.targetDeployment}). The one import ` +
    `between overlay modules is \`import type\` of the sibling's ports.ts, in the same ` +
    `deployment, by a module that declares it in \`dependencies\`; this one fails:\n` +
    finding.failed
      .map((clause) => `    [${clause}] ${OVERLAY_BOUNDARY_CLAUSES[clause]}`)
      .join('\n')
  );
}

function stringLiterals(node: ts.Expression): readonly string[] | null {
  if (!ts.isArrayLiteralExpression(node)) return null;
  const out: string[] = [];
  for (const element of node.elements) {
    if (!ts.isStringLiteralLike(element)) return null;
    out.push(element.text);
  }
  return out;
}

/**
 * The `dependencies` a manifest source declares, read as literals, or `null` when
 * the exported `manifest` carries no such array of string literals — a spread, a
 * name, a missing property. `defineModuleManifest({ … })` and a plain object both read.
 */
export function readManifestDependencies(source: string, file: string): readonly string[] | null {
  const tree = parseSource(file, source);
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'manifest') continue;
      let value = declaration.initializer;
      if (value !== undefined && ts.isCallExpression(value)) value = value.arguments[0];
      while (value !== undefined && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) {
        value = value.expression;
      }
      if (value === undefined || !ts.isObjectLiteralExpression(value)) return null;
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name;
        if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'dependencies') {
          return stringLiterals(property.initializer);
        }
      }
      return null;
    }
  }
  return null;
}

const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts)$/;

function directoriesUnder(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function walkSources(absolute: string, key: string, out: Map<string, string>): void {
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const childAbsolute = join(absolute, entry.name);
    const childKey = `${key}/${entry.name}`;
    if (entry.isDirectory()) walkSources(childAbsolute, childKey, out);
    else if (SOURCE_EXTENSION.test(entry.name) && statSync(childAbsolute).isFile()) {
      out.set(childKey, readFileSync(childAbsolute, 'utf8'));
    }
  }
}

/**
 * Every deployment's overlay sources under `treeRoot/apps/`, and each overlay
 * module's declared dependencies — the input both readers hand the analysis.
 * `treeRoot` is the directory holding `apps/`: `backend/src` here, the instance root
 * there. A tree with no `apps/` is the empty input.
 */
export function overlayBoundaryInputUnder(treeRoot: string): OverlayBoundaryInput {
  const sources = new Map<string, string>();
  for (const deployment of directoriesUnder(join(treeRoot, 'apps'))) {
    const modulesRoot = join(treeRoot, 'apps', deployment, 'modules');
    for (const id of directoriesUnder(modulesRoot)) {
      walkSources(join(modulesRoot, id), `apps/${deployment}/modules/${id}`, sources);
    }
  }
  return { sources, dependencies: overlayDependenciesOf(sources) };
}

/**
 * Each overlay module's declared `dependencies`, read off the `manifest.ts` among
 * `sources` (keyed as {@link OverlayBoundaryInput.sources} is). A module whose
 * sources hold no manifest is `null`, which declares nothing.
 */
export function overlayDependenciesOf(
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[] | null> {
  const dependencies = new Map<string, readonly string[] | null>();
  for (const file of [...sources.keys()].sort()) {
    const module = overlayModuleOf(file);
    if (module === null || dependencies.has(module.dir)) continue;
    const manifestKey = `${module.dir}/manifest.ts`;
    const manifest = sources.get(manifestKey);
    dependencies.set(
      module.dir,
      manifest === undefined ? null : readManifestDependencies(manifest, manifestKey),
    );
  }
  return dependencies;
}
