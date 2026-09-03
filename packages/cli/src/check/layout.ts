/**
 * `PackageLayout` — the one substitution
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §2 and §3).
 *
 * ## Why one seam and not thirty-five adapters
 *
 * `lib/module-roots.ts` is already two-sourced: a module's directory is *a
 * directory under the application's source root named after a registered id*
 * **or** *a workspace member declaring `endora: { type: 'module', id }`*. The
 * second source is the package half of that derivation, and a package-scope
 * layout is that half with the workspace enumeration replaced by a single
 * package. Rules do not learn about packages; they keep taking their population
 * as a parameter, and a second implementation of the layout supplies it.
 *
 * ## The floor is derived from the package's own declarations
 *
 * It has to be, because that is the only independent second author a single
 * package has. Issue #215's refusal was never *"an empty population is exit
 * 2"* — it was *"the walk disagreed with an independent second author about how
 * much there was to read"*, which is what `sources=<covered>/<expected>` encodes
 * and why `read-size.ts` has three refusal kinds rather than one. For one
 * package that author is its `package.json`: the `exports` map and the `endora`
 * block.
 *
 * So, per rule, in this order:
 *
 *   1. the package declares the subject and the walk found sources → `ran`;
 *   2. the package declares the subject and the walk found nothing → **short
 *      walk**, `unreadable`, exit 2. A declared `./migrations` with no migration
 *      source is a defect, not a clean tree;
 *   3. the package declares no subject → `not-applicable`, and the line names
 *      the declaration that is absent. The `sources=` token is **omitted**,
 *      never printed `0/0` — `read-size.ts` refuses `expected=0` as
 *      `no-expectation` and `check:admin-zones` already omits on that ground.
 *
 * The consequence is the point: a module package with no worker, no timer, no
 * admin layer, no entity and no migration is *completely* evaluated and exits
 * **0**. Nothing about it is skipped and nothing is silent.
 *
 * ## Nothing here spells a path
 *
 * Not `./backend`, not `src/`, not `dist/`, not `packages/modules` (D-100). The
 * subpath→directory mapping comes off the package's own `exports` map and the
 * source→artefact mapping off its own `tsconfig.build.json` `rootDir`/`outDir`,
 * through the derivations `lib/module-packages.ts` and `lib/emitted-freshness.ts`
 * already implement.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  nodeFreshnessFs,
  originOf,
  sourceOfEmitted,
  SOURCE_EXTENSIONS,
  type EmittingPackage,
} from '../lib/emitted-freshness.js';
import { declaredExports, readEmitLayout, type EmitLayout } from '../lib/module-packages.js';
import { nodeWorkspaceFs } from '../lib/workspace-packages.js';

/** Raised when the working directory is not a module package. Never a clean run. */
export class NotAModulePackageError extends Error {
  override readonly name = 'NotAModulePackageError';
}

/**
 * One layer the package's `exports` map declares, resolved back to its source.
 *
 * `entry` is the source file the declared target compiles from; `directory` is
 * that file's directory, which is what a walk attributes files to. A wildcard
 * subpath is not one of these — it contributes no expectation (§3), so
 * `declaredExports` drops it and so does this.
 */
export interface DeclaredLayer {
  /** As written: `.`, `./backend`, `./migrations`, … */
  readonly subpath: string;
  /** The declared target, as written. */
  readonly target: string;
  /** The source file it compiles from, absolute. */
  readonly entry: string;
  /** That file's directory, absolute — what the walk attributes to. */
  readonly directory: string;
}

export interface PackageLayout {
  /** The package's directory, fully resolved. */
  readonly packageRoot: string;
  readonly packageName: string;
  readonly packageVersion: string;
  /** `endora.id` — identity of record, never the directory name (D-142). */
  readonly moduleId: string;
  /** One element: {@link PackageLayout.moduleId}. Attribution keys on it. */
  readonly moduleIds: readonly string[];
  /** `tsconfig.build.json`'s emit layout, or `null` for a source-shipping package. */
  readonly emit: EmitLayout | null;
  /** The directory the package's sources are rooted at, absolute. */
  readonly sourceRoot: string;
  /** Every non-wildcard `exports` subpath whose target this package's build writes. */
  readonly layers: readonly DeclaredLayer[];
  /**
   * Why {@link PackageLayout.layers} could not be derived, or `null`.
   *
   * Non-null exactly when it is empty for a reason that is **not** "the package
   * declares none" — today, a module package with no build configuration. A
   * caller must read this before treating an empty layer list as *no subject*:
   * the two are `not-applicable` and `unreadable`, and telling them apart is the
   * whole of `exit-reduction.md` §2.
   */
  readonly layerRefusal: string | null;
  /**
   * The file the package's `endora` block declares as its check ledger, or
   * `null`. `null` means *no acknowledged debt*, never *skip*.
   */
  readonly ledgerPath: string | null;
  /** Package-relative, POSIX separators — one namespace, for keys and messages. */
  readonly keyOf: (absolutePath: string) => string;
  /** The same; a package's key already reads well enough to display. */
  readonly displayOf: (absolutePath: string) => string;
  /** The layer a walked file belongs to, or `null` when no layer covers it. */
  readonly layerOf: (absolutePath: string) => DeclaredLayer | null;
  /** The package as an emitting one, for the freshness derivation; `null` without a build. */
  readonly emitting: EmittingPackage | null;
}

/** `endora.id` from a manifest, or `null` when the member is not a module's. */
function declaredModuleId(manifest: Readonly<Record<string, unknown>>): string | null {
  const endora = manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return null;
  const block = endora as Record<string, unknown>;
  if (block['type'] !== 'module') return null;
  const id = block['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The ledger the package declares about itself, or `null`.
 *
 * Declared in the `endora` block and **not discovered by filename**: a
 * discovered filename is a convention nobody can see, which is the class of
 * defect this programme exists against (`contracts/package-ledger.md` §2).
 */
function declaredLedger(manifest: Readonly<Record<string, unknown>>): string | null {
  const endora = manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return null;
  const value = (endora as Record<string, unknown>)['checkLedger'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The nearest ancestor of `from` whose `package.json` declares a module. */
function findPackageRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        if (declaredModuleId(manifest) !== null) return dir;
      } catch {
        // A manifest that does not parse is not this package's answer; keep
        // walking rather than reporting the directory as not a module package,
        // which would name the wrong repair.
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

/**
 * The source a declared target *would* have compiled from, when none is there.
 *
 * `sourceOfEmitted` answers only for a source that exists — the right answer for
 * a freshness comparison, and the wrong one here: a declared `exports` subpath
 * whose source is gone is exactly the short walk the floor exists to refuse, and
 * a layer dropped for that reason would be reported as a clean run over a
 * smaller population. The extension map is `emitted-freshness.ts`', imported
 * rather than copied.
 */
function predictedSource(pkg: EmittingPackage, emitted: string): string | null {
  const within = posix(relative(pkg.dir, emitted));
  const prefix = pkg.emit.outDir === '' ? '' : `${pkg.emit.outDir}/`;
  if (prefix !== '' && !within.startsWith(prefix)) return null;
  const belowOut = within.slice(prefix.length);
  for (const [emittedExtension, sourceExtensions] of SOURCE_EXTENSIONS) {
    if (!belowOut.endsWith(emittedExtension)) continue;
    const stem = belowOut.slice(0, -emittedExtension.length);
    const extension = sourceExtensions[0];
    if (extension === undefined) continue;
    const relativeSource =
      pkg.emit.rootDir === '' ? `${stem}${extension}` : `${pkg.emit.rootDir}/${stem}${extension}`;
    return join(pkg.dir, ...relativeSource.split('/'));
  }
  return null;
}

/**
 * The layout for the module package at, or above, `from`.
 *
 * Refuses a directory that is not a module package **naming the declaration it
 * looked for**, rather than reporting a clean run over nothing (FR-002).
 */
export function resolvePackageLayout(from: string): PackageLayout {
  const packageRoot = findPackageRoot(from);
  if (packageRoot === null) {
    throw new NotAModulePackageError(
      `${resolve(from)} is not inside a module package: no \`package.json\` at or above it ` +
        `declares \`endora: { "type": "module", "id": … }\`. That block is how a package ` +
        `states what it is — the running platform reads the same one — so a run over a ` +
        `directory without it would be a clean verdict over nothing.`,
    );
  }

  const manifest = JSON.parse(
    readFileSync(join(packageRoot, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  const moduleId = declaredModuleId(manifest);
  if (moduleId === null) {
    throw new NotAModulePackageError(`${packageRoot} declares no \`endora.id\`.`);
  }
  const packageName = typeof manifest['name'] === 'string' ? manifest['name'] : packageRoot;
  const packageVersion = typeof manifest['version'] === 'string' ? manifest['version'] : '0.0.0';

  const emit = readEmitLayout(packageRoot, packageName, nodeWorkspaceFs());
  const exportsMap = declaredExports(manifest);
  const sourceRoot =
    emit === null || emit.rootDir === '' ? packageRoot : join(packageRoot, ...emit.rootDir.split('/'));

  const emitting: EmittingPackage | null =
    emit === null
      ? null
      : { name: packageName, dir: packageRoot, emit, exports: exportsMap };

  const fs = nodeFreshnessFs();
  const layers: DeclaredLayer[] = [];
  let layerRefusal: string | null = null;

  if (emitting === null) {
    // A module package emits (D-164): `tsx` applies one tsconfig per process, so
    // a decorated entity file outside it is lowered with standard semantics
    // while MikroORM's are legacy, and a source-shipping module's entities die
    // at load. Without a build layout there is no derivation from a declared
    // subpath to the sources it publishes, so the floor has no expectation to
    // compare — and a rule that reported clean on that basis would be reporting
    // on a walk nothing corroborated.
    layerRefusal =
      `${packageName} declares no \`tsconfig.build.json\`, so which of its sources each ` +
      `\`exports\` subpath publishes cannot be derived — and a module package emits ` +
      `rather than shipping source (D-164), because \`tsx\` lowers a decorated entity file ` +
      `outside its own tsconfig with the wrong decorator semantics. Add the build ` +
      `configuration and build the package.`;
  } else {
    for (const [subpath, target] of exportsMap) {
      const absolute = join(packageRoot, ...target.replace(/^\.\//, '').split('/'));
      // A subpath is a **source layer** iff the build produces its target. That
      // is what keeps `./package.json` — a real subpath the build writes
      // nothing for — out of the expectation, and it is derived from the
      // package's own `outDir` rather than from the file's name.
      if (originOf(absolute, emitting) !== 'emitted') continue;
      // The source, if it is there; otherwise the source it *would* have had.
      // Existence is deliberately not the test: a declared subpath whose source
      // is gone is the short walk the floor exists to refuse, and dropping the
      // layer here would report it as a clean run over a smaller population.
      const entry = sourceOfEmitted(emitting, absolute, fs) ?? predictedSource(emitting, absolute);
      if (entry === null) continue;
      layers.push({ subpath, target, entry, directory: dirname(entry) });
    }
    // Deepest directory first, so a file under `src/backend` is attributed to
    // `./backend` rather than to the root export's `src`.
    layers.sort((a, b) => b.directory.length - a.directory.length);
  }

  const keyOf = (absolutePath: string): string => posix(relative(packageRoot, absolutePath));

  const layerOf = (absolutePath: string): DeclaredLayer | null => {
    for (const layer of layers) {
      if (layer.entry === absolutePath) return layer;
      const prefix = layer.directory.endsWith(sep) ? layer.directory : layer.directory + sep;
      if (absolutePath.startsWith(prefix)) return layer;
    }
    return null;
  };

  const ledger = declaredLedger(manifest);

  return {
    packageRoot,
    packageName,
    packageVersion,
    moduleId,
    moduleIds: [moduleId],
    emit,
    sourceRoot,
    layers,
    layerRefusal,
    ledgerPath: ledger === null ? null : join(packageRoot, ...ledger.replace(/^\.\//, '').split('/')),
    keyOf,
    displayOf: keyOf,
    layerOf,
    emitting,
  };
}

/** The extensions a rule's own walk opens — the layer expectation is per rule. */
export interface LayerExpectation {
  /** Layers the rule's walk *should* have reached. */
  readonly expected: readonly DeclaredLayer[];
  /** Those that contributed at least one file to it. */
  readonly covered: readonly DeclaredLayer[];
}

/**
 * The declaration-derived floor for one rule's walk.
 *
 * **Expected** is the declared layers whose own entry file the rule's walk would
 * open — derived from the layer's entry extension, so a `./admin` layer entered
 * at a `.tsx` file is not expected of a `.ts`-only walk and cannot be reported
 * as a short one. **Covered** is those a walked file was attributed to.
 */
export function layerExpectation(
  layout: PackageLayout,
  walked: readonly string[],
  opens: (absolutePath: string) => boolean,
): LayerExpectation {
  const expected = layout.layers.filter((layer) => opens(layer.entry));
  const reached = new Set<string>();
  for (const file of walked) {
    const layer = layout.layerOf(file);
    if (layer !== null) reached.add(layer.subpath);
  }
  return {
    expected,
    covered: expected.filter((layer) => reached.has(layer.subpath)),
  };
}

/** `true` when the file is on disk — used where a walk is not the evidence. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
