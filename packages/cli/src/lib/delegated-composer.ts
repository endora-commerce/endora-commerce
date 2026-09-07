/**
 * "This composition root does not compose; it hands its composition to
 * somebody. Where is that somebody's source?"
 *
 * ## The defect
 *
 * A composition root used to be one file. Since feature 109's Phase 1c
 * `backend/test/helpers/test-server.ts` supplies a `PlatformComposition` — which
 * modules, which ORM, which manifest registry, which decoration order — and
 * `@endora-commerce/test-kit/server` performs the composition: `composeModules`,
 * `registerValues`, the two Redis clients, the contribution window, the boot
 * phase, `buildServer`. Every one of those steps still happens, once, in the
 * same order; what changed is which file holds it.
 *
 * Every instrument whose subject is *what a root supplies* therefore has to
 * follow the delegation or start measuring half a composition. Measured, on the
 * merge request that made the harness the kit's first caller:
 * `check-port-dependencies` reported **16 root issues** — `redis`, `eventBus`,
 * `commandBus`, `apiInterceptors`, `resolvedModuleRegistry` and three more
 * "registered by production only" — every one of them registered by the harness
 * composition, in the composer, one directory away. Its own remedy sentences
 * (*add it to `ROOT_DIVERGENCE_ALLOWED`*, *register it in both roots*) were both
 * wrong, because the two compositions do not differ.
 *
 * ## Why the source and not the artefact
 *
 * A package resolves at its build output (D-164), so a derivation that read
 * `dist` would hold this branch to the previous `pnpm run build:packages`. That
 * is the false green measured three consecutive times on feature 091's admin
 * drain. Everything here is read off the package's own declarations — `exports`
 * for where a bare specifier lands, `tsconfig.build.json`'s `rootDir`/`outDir`
 * for how a source becomes an artefact — so no package name, no `dist` and no
 * `src` appears in any predicate (D-100), and a composer that moves is followed
 * rather than lost.
 *
 * ## What it refuses
 *
 * Every step, rather than answering emptily. A root whose composer cannot be
 * found is a root whose composition an instrument would then read as *absent*,
 * which is issue #113's shape: the finding would be about the walk and would be
 * reported as a finding about the tree.
 *
 * Stated rather than discovered later, this cannot see: a composer reached
 * through a re-export in a third package, a composer named by a computed
 * specifier, and a root that delegates to more than one composer (the first
 * matching import declaration wins, and a second would need a caller that wants
 * both).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import ts from 'typescript';

import {
  emittingPackages,
  nodeFreshnessFs,
  sourceOfEmitted,
  type FreshnessFs,
} from './emitted-freshness.js';
import { nodeWorkspaceFs, type WorkspaceFs } from './workspace-packages.js';

/** Directories under a composer's own that hold no source of its. */
const PRUNED = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage']);

/** The composer a root delegates its composition to. */
export interface DelegatedComposer {
  /** The binding the root imports — how a call to it is recognised at a site. */
  readonly binding: string;
  /** The bare specifier the root names it by. */
  readonly specifier: string;
  /** The composer's own source directory, absolute. */
  readonly dir: string;
  /** Its source files, absolute, in path order. */
  readonly files: readonly string[];
  /** Those files concatenated, which is what a text-level ledger reads. */
  readonly source: string;
}

/** Why a delegation could not be followed. Every one of these is an exit-2. */
export type DelegationRefusal =
  | { readonly kind: 'no-import'; readonly binding: string }
  | { readonly kind: 'no-package'; readonly specifier: string }
  | { readonly kind: 'no-subpath'; readonly specifier: string; readonly pkg: string }
  | { readonly kind: 'no-source'; readonly pkg: string; readonly emitted: string }
  | { readonly kind: 'empty-directory'; readonly dir: string };

export type DelegationResult =
  | { readonly ok: true; readonly composer: DelegatedComposer }
  | { readonly ok: false; readonly refusal: DelegationRefusal };

/** The specifier an import declaration binding `binding` names, if any. */
function specifierBinding(source: string, file: string, binding: string): string | null {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  let found: string | null = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((element) => element.name.text === binding)) {
      found = statement.moduleSpecifier.text;
    }
  }
  return found;
}

function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) found.push(...sourceFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Follow the specifier a root imports `binding` from back to that composer's
 * source directory.
 *
 * The **binding** decides which import declaration is the composer's, so a root
 * that imports twenty things from a package is followed by the one name that
 * matters. The workspace member's own `exports` map decides where the bare
 * specifier lands, and its emit layout decides which source produced it.
 */
export function delegatedComposerOf(
  rootSource: string,
  rootPath: string,
  repoRoot: string,
  binding: string,
  fs: { readonly workspace?: WorkspaceFs; readonly freshness?: FreshnessFs } = {},
): DelegationResult {
  const specifier = specifierBinding(rootSource, rootPath, binding);
  if (specifier === null) return { ok: false, refusal: { kind: 'no-import', binding } };

  let pkg: ReturnType<typeof emittingPackages>[number] | undefined;
  for (const candidate of emittingPackages(repoRoot, fs.workspace ?? nodeWorkspaceFs())) {
    if (specifier === candidate.name || specifier.startsWith(`${candidate.name}/`)) pkg = candidate;
  }
  if (pkg === undefined) return { ok: false, refusal: { kind: 'no-package', specifier } };

  const subpath = specifier === pkg.name ? '.' : `.${specifier.slice(pkg.name.length)}`;
  const target = pkg.exports.get(subpath);
  if (target === undefined) {
    return { ok: false, refusal: { kind: 'no-subpath', specifier, pkg: pkg.name } };
  }

  const relativeTarget = target.startsWith('./') ? target.slice(2) : target;
  const emitted = join(pkg.dir, ...relativeTarget.split('/'));
  const entry = sourceOfEmitted(pkg, emitted, fs.freshness ?? nodeFreshnessFs());
  if (entry === null) {
    return { ok: false, refusal: { kind: 'no-source', pkg: pkg.name, emitted } };
  }

  const dir = dirname(entry);
  const files = sourceFilesUnder(dir).sort();
  if (files.length === 0) return { ok: false, refusal: { kind: 'empty-directory', dir } };

  return {
    ok: true,
    composer: {
      binding,
      specifier,
      dir,
      files,
      source: files.map((file) => readFileSync(file, 'utf8')).join('\n'),
    },
  };
}

/** One sentence per refusal, in the estate's voice, for an exit-2 message. */
export function delegationRefusalMessage(prefix: string, refusal: DelegationRefusal): string {
  switch (refusal.kind) {
    case 'no-import':
      return (
        `${prefix} the composition root imports no '${refusal.binding}'. Either it composes for ` +
        'itself again, in which case this derivation is no longer needed, or the binding was ' +
        'renamed. An unfollowed delegation makes every question about what that root supplies ' +
        'read as "it supplies nothing".'
      );
    case 'no-package':
      return (
        `${prefix} no emitting workspace member owns '${refusal.specifier}'. A composer is ` +
        'resolved through a package’s own exports map; a specifier no member claims cannot be ' +
        'followed back to a source.'
      );
    case 'no-subpath':
      return (
        `${prefix} ${refusal.pkg} declares no subpath for '${refusal.specifier}'. Its exports ` +
        'map is what says where that specifier lands.'
      );
    case 'no-source':
      return (
        `${prefix} no source under ${refusal.pkg}’s rootDir emits ` +
        `${refusal.emitted.split(sep).slice(-3).join(sep)}. Reading the artefact instead would ` +
        'hold this run to the previous build.'
      );
    case 'empty-directory':
      return `${prefix} the composer directory ${refusal.dir} holds no source.`;
  }
}

/**
 * The composer's own option fields that it **spreads into a container
 * registration**.
 *
 * A delegating root supplies its host values as data — `values: { … }` on the
 * options object — rather than by calling `registerValues` itself, so a check
 * that recognises only the call shapes reads those names as registered by
 * nobody. Which option field carries them is the *composer's* declaration, not
 * a convention: it is the field the composer spreads into `registerValues`, and
 * reading it out of the composer's source is what keeps a caller's spelling and
 * this derivation from disagreeing (D-100).
 *
 * Measured: without it, the eight names `backend/test/helpers/test-server.ts`
 * passes as `values` — four worker flags, two `product_feeds` settings, a
 * storefront base URL and a test probe — read as production-only registrations,
 * and the remedy printed for each of them was to register it in both roots,
 * which it already is.
 */
export function delegatedSupplyFields(source: string, file: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const fields = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'registerValues'
    ) {
      const [, second] = node.arguments;
      if (second !== undefined && ts.isObjectLiteralExpression(second)) {
        for (const property of second.properties) {
          if (!ts.isSpreadAssignment(property)) continue;
          const spread = property.expression;
          if (ts.isPropertyAccessExpression(spread) && ts.isIdentifier(spread.name)) {
            fields.add(spread.name.text);
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return [...fields].sort();
}

/**
 * The registration names a root hands its composer as data, per
 * {@link delegatedSupplyFields}.
 *
 * Only an object literal is read. A spread or a computed field is a name this
 * derivation cannot reason about, exactly as it is for a `registerValues` call
 * written by hand.
 */
export function delegatedSuppliedNames(
  rootSource: string,
  rootFile: string,
  binding: string,
  fields: readonly string[],
): string[] {
  const wanted = new Set(fields);
  const sourceFile = ts.createSourceFile(rootFile, rootSource, ts.ScriptTarget.ES2022, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === binding
    ) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          if (!ts.isIdentifier(property.name) || !wanted.has(property.name.text)) continue;
          if (!ts.isObjectLiteralExpression(property.initializer)) continue;
          for (const supplied of property.initializer.properties) {
            if (supplied.name === undefined) continue;
            if (ts.isIdentifier(supplied.name)) names.push(supplied.name.text);
            else if (ts.isStringLiteral(supplied.name)) names.push(supplied.name.text);
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return names;
}
