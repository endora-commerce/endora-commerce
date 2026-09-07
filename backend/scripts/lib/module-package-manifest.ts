/**
 * A module package's `package.json`, derived (feature 080, T041).
 *
 * `specs/084-small-f4-package-layout/contracts/module-package-layout.md` §2
 * marks every field of that file GENERATED except two, and §0.4 admits what was
 * actually true until this file existed: *"what is generated today is nothing —
 * the manifest is hand-written"*. Three packages had been written that way, by
 * three agents, on three days.
 *
 * ## Why it stops being acceptable at module #6
 *
 * The batching decision of 2026-08-24 takes the remaining module moves ten at a
 * time. A batch of ten is ten hand-written manifests, and both ways of getting
 * one wrong are silent **here**:
 *
 *   * **A missing peer.** A workspace hoists every framework the application
 *     already declares, so a module package that names none of them builds,
 *     type-checks and tests exactly like one that names all of them. The
 *     failure is a stranger's `pnpm add`, months later, in a tree this
 *     repository cannot see.
 *   * **A wrong `exports` key.** Nothing type-checks an `exports` map. A
 *     subpath naming a file the build does not emit answers
 *     `ERR_PACKAGE_PATH_NOT_EXPORTED` at the first import that needs it — and
 *     for `./migrations` that import is the one the platform makes at boot,
 *     which is how D-149's *"a migration goes missing without a word"* happens
 *     one layer up.
 *
 * ## What is derived, and from what
 *
 *   * **`endora` and `name`** — from the module's own `src/manifest.ts`, never
 *     from the `package.json` being written. Reading the id out of the output
 *     would make the generator an instrument reading its own answer; a
 *     `package.json` whose `endora.id` disagrees with the manifest is the
 *     mismatch `src/packages/package-runtime.ts` diagnoses at boot, and it is
 *     refused here instead.
 *   * **`exports`** — from the layer inventory: which of `src/backend/index.ts`,
 *     `src/migrations/index.ts`, `src/ports/index.ts`, `src/admin/index.ts`
 *     exist. A layer that is absent contributes no subpath, and a layer that
 *     exists and maps to no subpath is **refused** rather than skipped, for the
 *     reason above. The targets name the **emitted** file, read out of the
 *     package's own `tsconfig.build.json` through the same `readEmitLayout` the
 *     composer uses (D-164) — not a `dist/` prefix written down twice.
 *   * **`peerDependencies`** — from every bare specifier the package's sources
 *     actually name, minus the Node builtins and minus the package itself. Not
 *     a list: `google_analytics` peers on `bullmq` and `ioredis` because it runs
 *     a real BullMQ consumer, `quote_requests` on neither because its sweep is a
 *     plain function, and that difference falls out of the walk rather than out
 *     of an author remembering. Specifiers are read as literal AST nodes
 *     (`lib/specifiers.ts`), so one written in a doc comment is out of the
 *     population by construction — all three shipped packages quote their own
 *     package name in a comment, and a text scan calls that a self-dependency.
 *   * **the ranges** — from the **applications** that compose the modules: the
 *     workspace members a *literal* entry produces (`backend`, `admin`, …),
 *     never a library family. A module has two composing applications since
 *     feature 091 — `backend` for `src/backend/`, `admin` for `src/admin/` —
 *     and `react` is declared by the second and by no other member.
 *     A peer takes the major (`^6.6.13` → `^6`), a
 *     `devDependency` takes the range as declared, and a workspace member takes
 *     `workspace:*` (R5). A specifier the application declares nowhere is
 *     refused: inventing a range is how a package ships one nothing resolves.
 *
 * ## What is not derived, and is preserved instead
 *
 * **`version`.** It is the release process's field, not the layer inventory's:
 * no fact about a package's directory says which release it is. So it is read
 * off the existing file and written back unchanged, and only a package with no
 * `package.json` at all — one just moved into place — is seeded, from the
 * platform host's own version (D-210). It was the constant `'0.0.0'` until the
 * first release set 79 manifests by hand and regenerating wanted to undo all 70
 * module packages; a constant here is a release decision recorded by hand
 * (D-100), and the next release would falsify a new one exactly as the last one
 * falsified that.
 *
 * ## Publication (F10 slice 3, D-208)
 *
 * A module package is **not** `private`, and this generator stopped emitting
 * the field rather than emitting `false`: absent is npm's own default and
 * `false` is the same fact stated twice. R6 wrote `private: true` while the
 * estate was pre-publication; D-208 ends that state — an instance takes the
 * platform and every module package as dependencies and holds a copy of none,
 * so a module package a client cannot install is a module a client cannot use.
 *
 * With it go the two fields a published package owes a consumer and a private
 * one does not: **`repository`**, whose `url` is the workspace root's and whose
 * `directory` is where this package sits in it, and **`publishConfig.access`**,
 * which is a property of the package rather than of the registry it happens to
 * reach. Both are `check:release-intent`'s `incomplete-public-package`, and
 * both are derived — see {@link rootRepositoryUrl}.
 *
 * ## The licence (the owner's ruling of 2026-09-06)
 *
 * **`license`** — the workspace root's, or this module's own override. The
 * split is by **package**: the open core is `MIT` and a paid package carries
 * `SEE LICENSE IN LICENSE.md`, with entitlement contractual rather than a
 * registry gate. What this file builds is the *mechanism* and never the values
 * — which modules are paid is a product decision nobody has taken, and a guess
 * rendered into 70 manifests would be a licence grant no owner authorised, in
 * the one direction that cannot be withdrawn from whoever installed it. So
 * there is one declared default at the root ({@link rootLicense}) and one
 * override per module ({@link modulePackageLicenseOf}), and assigning a module
 * to the paid tier later is one field in one file with the generator doing the
 * rest. See both for why the override is a named export rather than a manifest
 * field.
 *
 * ## `peerDependenciesMeta` — and what this paragraph used to say
 *
 * It said the field was *"vacuous under the rule above and that is structural,
 * not an omission: a peer appears **only** when a source imports it, so a
 * package with no `src/admin/` has no `react` peer to mark optional in the
 * first place."* Every clause of that is true and the conclusion does not
 * follow, because the population it reasons about is *packages that have no
 * admin layer* and the field's subject is *packages that have one*. Measured
 * on `master`: **54** of 70 module packages required `react`, **55** required
 * `@endora-commerce/admin-kit` and **56** required `vitest`, over a union of 54
 * distinct peers, and **not one** package declared a `peerDependenciesMeta` —
 * so an instance composing only a backend installed a test runner, React, a
 * router and a charting library. The other reading the paragraph rejected,
 * *"optional means imported behind a runtime guard"*, needs dataflow a
 * specifier walk does not carry and is rejected still; what it missed is the
 * third one, which needs no dataflow at all: **which layer wrote the reach**.
 * A specifier is already carried with the file it was written in, so the answer
 * was one field away the whole time. {@link peerRequirementOf} is the
 * derivation and FR-022 the requirement.
 */
import { readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';

import { join, relative, sep } from 'node:path';

import ts from 'typescript';

import { classifyAssetFile } from '../../../scripts/lib/runtime-assets.mjs';
import { type SourceReader } from './emitted-exports.js';
import {
  modulePackageSurfaces,
  type ModulePackageSurfaces,
  type SubpathSurface,
} from './module-package-subpaths.js';
import { findAliasMember } from './admin-surfaces.js';
import { readEmitLayout, type EmitLayout } from './module-packages.js';
import { namedSpecifiers, type SpecifierKind } from './specifiers.js';
import {
  ADMIN_LAYER_DIRECTORY,
  PUBLISHED_COMPONENT_LAYER_DIRECTORY,
  UI_LAYER_DIRECTORIES,
} from './ui-layer.js';
import {
  renderTailwindStylesheet,
  scannableLayersFrom,
  tailwindScannablePackages,
  tailwindStylesheetPathOf,
  TAILWIND_SOURCE_FILE,
  TAILWIND_SOURCE_SUBPATH,
  type TailwindScannableLayer,
  type TailwindScannablePackage,
} from './tailwind-sources.js';
import { platformPackageNameOf } from './platform-root.js';
import {
  classifyWorkspaceMembers,
  expandWorkspaceGlob,
  nodeWorkspaceFs,
  workspaceGlobs,
  workspaceMembers,
  workspaceScopes,
  type WorkspaceFs,
  type WorkspaceMember,
} from './workspace-packages.js';

/** Raised when a manifest cannot be derived. Never a partial answer. */
export class ModulePackageManifestError extends Error {
  override readonly name = 'ModulePackageManifestError';
}

/**
 * The filesystem, injected.
 *
 * `WorkspaceFs` plus a file listing, which the layer inventory needs and the
 * workspace derivation does not. Injected so a red proof hands in a whole
 * synthetic checkout at the top of the analysis rather than a half-computed
 * record at the bottom of it (issue #130).
 */
export interface ManifestFs extends WorkspaceFs {
  /** Immediate file names in a directory, or `[]` when it is absent. */
  readonly listFiles: (path: string) => readonly string[];
}

/** The real filesystem behind {@link ManifestFs}. Absence is `null`/`[]`, never a throw. */
export function nodeManifestFs(): ManifestFs {
  return {
    ...nodeWorkspaceFs(),
    listFiles(path: string): readonly string[] {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort();
      } catch {
        return [];
      }
    },
  };
}

// --- the layer inventory ---------------------------------------------------

/** One published layer: the directory under `src/` and the subpath serving it. */
export interface PackageLayer {
  /** The `exports` key, e.g. `./backend`. */
  readonly subpath: string;
  /** The directory name under `src/`. */
  readonly directory: string;
  /** The entry point, package-relative: `src/<directory>/index.ts`. */
  readonly entry: string;
}

/**
 * Which directory under `src/` publishes on which subpath.
 *
 * The order is the order the keys are emitted in, and it is the order
 * `module-package-layout.md` §2 writes them: the root, then the layers a
 * consumer reaches, then `./package.json`. A directory under `src/` that is
 * **not** here is a layer no subpath covers, which is refused rather than
 * skipped.
 */

const LAYER_SUBPATHS: ReadonlyArray<readonly [directory: string, subpath: string]> = [
  ['backend', './backend'],
  ['migrations', './migrations'],
  ['ports', './ports'],
  ['admin', './admin'],
  // D-191's published-component exit (feature 091, batch 10; Z9 of
  // `contracts/admin-component-contribution.md`). A **sibling** of `admin/`
  // rather than a second entry file inside it, because
  // `admin-contribution.md` R2 is *"`src/admin/index.ts` exports exactly one
  // value"* and a second file in that directory turns the rule into a rule
  // with a filename carve-out.
  //
  // It publishes React components rather than a contribution descriptor, so
  // `check:module-boundary`'s D-171 derivation keeps counting a reach into it
  // — the emitted module exports runtime bindings — which is D-191's own
  // condition and needs no change to that check.
  ['admin-ui', './admin-ui'],
];

/** What a package ships, as the directory says. */
export interface LayerInventory {
  readonly layers: readonly PackageLayer[];
  readonly hasI18n: boolean;
  readonly hasDocs: boolean;
  readonly hasTests: boolean;
  readonly hasVitestConfig: boolean;
  /**
   * Every test file the package ships — under `src/` and under `test/` alike,
   * sorted, package-relative.
   *
   * It exists because the two questions it joins were answered in different
   * places and never against each other: `hasVitestConfig` said whether a `test`
   * script would be emitted, and nothing said whether there was anything for it
   * to run. Four packaged modules shipped fifteen co-located test files with no
   * configuration, so no runner collected them, no job reported them and no
   * total counted them — not failing, simply absent (feature 089, Phase 1).
   */
  readonly testFiles: readonly string[];
  /**
   * Non-`.ts` files under `src/` that the running module opens — sorted,
   * relative to `src/`. `tsc` copies none of them (measured), so a package that
   * ships one needs a second build step, and whether it has one is read off the
   * directory rather than written into the manifest by an author: an asset rule
   * somebody has to remember is a rule somebody forgets, and the failure is
   * silent by construction — the readers document absence as legitimate.
   */
  readonly assets: readonly string[];
}

/** The root export every module package has: its manifest. */
export const ROOT_ENTRY = 'src/manifest.ts';

/**
 * What a package ships, read off its directory.
 *
 * Four refusals, and each one is a file that would otherwise be published — or
 * run — by nothing: a missing root manifest, a directory under `src/` that maps
 * to no subpath, a mapped directory with no `index.ts` for its subpath to name,
 * and a test file in a package that declares no `vitest.config.ts`.
 */
export function layerInventoryOf(packageDir: string, fs: ManifestFs): LayerInventory {
  if (fs.readText(join(packageDir, ROOT_ENTRY)) === null) {
    throw new ModulePackageManifestError(
      `${packageDir}: no ${ROOT_ENTRY}. The root export of a module package is its manifest ` +
        `(module-package-layout.md §1); without it the package publishes no '.' subpath and ` +
        `the platform cannot read the module id it claims.`,
    );
  }
  const srcDir = join(packageDir, 'src');
  const known = new Map(LAYER_SUBPATHS);
  const layers: PackageLayer[] = [];
  const present = new Set(fs.listDirectories(srcDir));
  for (const name of [...present].sort()) {
    if (!known.has(name)) {
      throw new ModulePackageManifestError(
        `${packageDir}: src/${name}/ is a layer no exports subpath covers. A layer nothing ` +
          `publishes is unreachable from every consumer, and emitting a manifest that omits ` +
          `it in silence is how a whole directory goes missing without a word (D-149). Either ` +
          `move it under a published layer (${[...known.keys()].join(', ')}) or add it to ` +
          `LAYER_SUBPATHS here and to module-package-layout.md §2 in the same merge request.`,
      );
    }
  }
  const strayFiles = fs
    .listFiles(srcDir)
    .filter((name) => name !== 'manifest.ts')
    .sort();
  if (strayFiles.length > 0) {
    throw new ModulePackageManifestError(
      `${packageDir}: src/ holds ${strayFiles.join(', ')} beside ${ROOT_ENTRY}. Only the ` +
        `manifest is published at the root subpath, so a sibling file is reachable through no ` +
        `subpath at all.`,
    );
  }
  for (const [directory, subpath] of LAYER_SUBPATHS) {
    if (!present.has(directory)) continue;
    const entry = `src/${directory}/index.ts`;
    if (fs.readText(join(packageDir, entry)) === null) {
      throw new ModulePackageManifestError(
        `${packageDir}: src/${directory}/ exists and has no index.ts. The '${subpath}' subpath ` +
          `has to name a file; a subpath pointing at a target the build does not emit answers ` +
          `ERR_PACKAGE_PATH_NOT_EXPORTED to every consumer.`,
      );
    }
    layers.push({ subpath, directory, entry });
  }
  const hasVitestConfig = fs.readText(join(packageDir, 'vitest.config.ts')) !== null;
  const testFiles = testFilesIn(packageDir, fs);
  if (testFiles.length > 0 && !hasVitestConfig) {
    throw new ModulePackageManifestError(
      `${packageDir}: ships ${testFiles.join(', ')} and declares no vitest.config.ts. The ` +
        `\`test\` script is emitted only for a package that has one (module-package-layout.md ` +
        `§0.5), so without it these files are collected by no run, reported by no job and ` +
        `counted in no total — not failing, absent. Add vitest.config.ts (merging the ` +
        `repository's vitest.config.base.ts, which is where issue #255's foreign-link refusal ` +
        `lives), or move the file to backend/test/ if it needs a booted server.`,
    );
  }
  return {
    layers,
    assets: assetsUnder(srcDir, fs, packageDir),
    hasI18n: fs.listFiles(join(packageDir, 'i18n')).length > 0,
    // Directories count, exactly as they do for `test/` two lines below. A
    // module's `docs/` is its fragment of the site's modules category
    // (`module-documentation-layer.md` §1), so a module whose single page is a
    // directory index — `docs/blog/index.md` — ships a `docs/` holding no
    // top-level file at all. Seven of the 64 modules that moved in feature 100
    // Phase 2 are that shape, and a file-only probe would have left `docs` out
    // of their `files` list: the pages travel in the repository and in no
    // published package, which is the one failure this layer exists to prevent.
    hasDocs:
      fs.listFiles(join(packageDir, 'docs')).length > 0 ||
      fs.listDirectories(join(packageDir, 'docs')).length > 0,
    hasTests:
      fs.listFiles(join(packageDir, 'test')).length > 0 ||
      fs.listDirectories(join(packageDir, 'test')).length > 0,
    hasVitestConfig,
    testFiles,
  };
}

/**
 * Vitest's own default test-file spelling, over the extensions this walk sees.
 *
 * {@link sourceFilesUnder} yields `.ts`/`.tsx`/`.mts`/`.cts` only, which is
 * every file a module package can hold — it ships compiled output and its
 * sources are TypeScript. The pattern is written against vitest's default
 * `include` rather than as a `.test.ts` suffix test so the refusal and the
 * runner answer the same question about the same file.
 */
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?tsx?$/;

/**
 * Every test file a package ships, under `src/` and under `test/`.
 *
 * Both roots, because the layout contract §1 puts package-owned tests in
 * `test/unit/` and every file this refusal was written for is co-located beside
 * its source under `src/`. Reading only one of them would leave exactly the
 * population that produced the defect invisible.
 */
function testFilesIn(packageDir: string, fs: ManifestFs): readonly string[] {
  const found: string[] = [];
  for (const root of ['src', 'test']) {
    for (const path of sourceFilesUnder(packageDir, root, fs)) {
      if (TEST_FILE_RE.test(path)) found.push(path);
    }
  }
  return found.sort();
}

/**
 * Every runtime asset under `src/`, and a refusal for a file kind nobody has
 * ruled on.
 *
 * The classification is `scripts/lib/runtime-assets.mjs`'s — one owner, shared
 * with the application's own copier, so a module gets the same answer about the
 * same file before and after it is packaged. The **walk** is local because this
 * one runs over the injected {@link ManifestFs}, which is what lets a red proof
 * hand in a whole synthetic checkout at the top of the analysis (issue #130).
 */
function assetsUnder(srcDir: string, fs: ManifestFs, packageDir: string): string[] {
  const assets: string[] = [];
  const unclassified: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of [...fs.listFiles(dir)].sort()) {
      const kind = classifyAssetFile(name);
      if (kind === 'ignored') continue;
      (kind === 'asset' ? assets : unclassified).push(`${prefix}${name}`);
    }
    for (const child of [...fs.listDirectories(dir)].sort()) {
      walk(join(dir, child), `${prefix}${child}/`);
    }
  };
  walk(srcDir, '');
  if (unclassified.length > 0) {
    throw new ModulePackageManifestError(
      `${packageDir}: src/ holds ${unclassified.join(', ')}, whose extension this build has ` +
        `no ruling for. Whoever added the file knows whether the module opens it at runtime ` +
        `and nobody downstream does — an asset that is not copied into the emitted tree is ` +
        `read as an absent feature, silently, because every reader is handed a directory and ` +
        `asked what is in it. Add the extension to RUNTIME_ASSET_EXTENSIONS or to ` +
        `NON_RUNTIME_EXTENSIONS with a reason, in scripts/lib/runtime-assets.mjs.`,
    );
  }
  return assets.sort();
}

// --- the module id, read from the module's own manifest --------------------

/**
 * The module id `src/manifest.ts` declares.
 *
 * Read from the `defineModuleManifest({ id: '…' })` call as a **literal AST
 * node**, so a computed id is refused rather than guessed at: the id is
 * identity of record for the lifecycle registry, the settings store, the
 * permission codes and every migration's owner (D-142), and a generator that
 * substituted the directory name for one it could not read would put that
 * disagreement into a committed file.
 */
export function moduleIdOf(source: string, file: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineModuleManifest'
    ) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        found = literalStringProperty(argument, 'id');
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (found === null) {
    throw new ModulePackageManifestError(
      `${file}: no defineModuleManifest({ id: '…' }) with a literal id. The module id is ` +
        `identity of record everywhere (D-142) and it is read from here rather than from the ` +
        `package.json this generator writes — an id computed at runtime is one this derivation ` +
        `cannot put in a committed file.`,
    );
  }
  return found;
}

/** The module description `src/manifest.ts` declares, when it is a literal. */
export function moduleDescriptionOf(source: string, file: string): string | null {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineModuleManifest'
    ) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isObjectLiteralExpression(argument)) {
        found = literalStringProperty(argument, 'description');
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return found;
}

function literalStringProperty(
  literal: ts.ObjectLiteralExpression,
  name: string,
): string | null {
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = property.name;
    const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : null;
    if (keyText !== name) continue;
    const value = property.initializer;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    return null;
  }
  return null;
}

/**
 * `@endora-commerce/` + `quote_requests` → `@endora-commerce/mod-quote-requests`
 * (§6): underscores become hyphens and a leading one is dropped, so `_lifecycle`
 * publishes as `mod-lifecycle`.
 */
export function npmNameFor(scope: string, moduleId: string): string {
  return `${scope}mod-${moduleId.replace(/^_+/, '').replace(/_/g, '-')}`;
}

// --- the peers -------------------------------------------------------------

/**
 * One reach into a package, as the source wrote it.
 *
 * The subpath and the import kind are what R4's narrowing turns on (D-171): a
 * type-only import at a subpath whose emitted module exports nothing is a reach
 * into published contract surface, and every other shape is the coupling R4
 * refuses. Both facts were already on {@link NamedSpecifier} and were discarded
 * one line before the refusal saw them.
 */
export interface PackageReach {
  /** The specifier's remainder after the package name: `ports`, `''` for the root. */
  readonly subpath: string;
  readonly kind: SpecifierKind;
  /** Package-relative source file, for a refusal that names where to look. */
  readonly file: string;
  readonly line: number;
}

/**
 * Every third-party package the given sources name, with how each was reached.
 *
 * A Node builtin is not a dependency, in either spelling: `isBuiltin` answers
 * for `node:crypto` and for the bare `crypto` all three shipped packages
 * actually write, and asking Node rather than keeping a list is what keeps this
 * right when the next builtin arrives (D-100).
 *
 * The reaches are kept **per name and in source order** rather than reduced to a
 * name: the R4 decision is over *every* reach into one package — one value
 * import beside ten type-only ones is the coupling, and a set of names cannot
 * say so.
 */
export function peerNamesOf(
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly PackageReach[]> {
  const names = new Map<string, PackageReach[]>();
  for (const [file, text] of sources) {
    for (const specifier of namedSpecifiers(text, file)) {
      const name = packageNameOf(specifier.text);
      if (name === null) continue;
      const reaches = names.get(name) ?? [];
      reaches.push({
        subpath: subpathOf(specifier.text),
        kind: specifier.kind,
        file,
        line: specifier.line,
      });
      names.set(name, reaches);
    }
  }
  return names;
}

/** `@mikro-orm/core/x` → `@mikro-orm/core`; `./x` and a builtin → `null`. */
export function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (isBuiltin(specifier)) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return isBuiltin(name) ? null : name;
}

/**
 * The remainder {@link packageNameOf} drops: `@scope/name/ports` → `ports`.
 *
 * The root export is `''`, which is the spelling `surfaceOfSubpath` takes and
 * renders back as `.` — one convention, so the two never disagree about what a
 * bare package name means.
 */
export function subpathOf(specifier: string): string {
  const name = packageNameOf(specifier);
  if (name === null || specifier === name) return '';
  return specifier.slice(name.length + 1);
}

/**
 * The layer a reach was written in: a directory name under `src/`, `'root'` for
 * `src/manifest.ts`, or `'test'` for a co-located test file.
 *
 * `'test'` is decided first and by {@link TEST_FILE_RE}, which is vitest's own
 * default `include` — the same spelling {@link layerInventoryOf} refuses an
 * unconfigured test file by, so the runner and this classification cannot come
 * to disagree about which file is a test.
 */
export function reachLayerOf(file: string): string {
  if (TEST_FILE_RE.test(file)) return 'test';
  const segments = file.split('/');
  return segments.length > 2 ? segments[1]! : 'root';
}

/**
 * What a consumer owes a package for one of its peers (FR-022).
 *
 * A `peerDependencies` entry is an **install-time** requirement: npm and pnpm
 * provide a missing one automatically, so every name in that map is something
 * an instance installs whether or not it uses the layer that needs it. Measured
 * on `master` before this landed, over 70 module packages: 56 required
 * `vitest`, 55 required `@endora-commerce/admin-kit`, 54 required `react`, and
 * not one package declared a `peerDependenciesMeta` at all — so an instance
 * that composes only a backend installed a test runner, React, a router and a
 * charting library, none of which any file it composes imports.
 *
 * The answer is derived from **which layer wrote the reach**, and each of the
 * three verdicts rests on a fact about the package's own build rather than on
 * anyone's judgement:
 *
 *   * **`build-only`** — every reach is in a test file. A module package's
 *     `tsconfig.json` excludes the test spellings from the program its
 *     `tsconfig.build.json` emits, so nothing a test imports survives into
 *     anything published: not the JavaScript, not the declarations. Such a name
 *     is a `devDependency` and is **not a peer at all** — `vitest` is a peer of
 *     a co-located test and never of the runtime, and `@fastify/type-provider-zod`
 *     was required by eight packages for exactly the same reason.
 *   * **`optional`** — every non-test reach is in a UI layer.
 *     {@link UI_LAYER_DIRECTORIES} are the only layers a consumer can decline
 *     to resolve: they publish on `./admin` and `./admin-ui`, and an instance
 *     composing the backend and no admin imports neither. Everything else —
 *     `src/backend/`, `src/migrations/`, `src/ports/` and the root manifest —
 *     is on the path of every consumer that composes the module at all.
 *   * **`required`** — anything else, including a name reached from a UI layer
 *     *and* from a runtime one. Optionality is a property of the whole set of
 *     reaches, so one runtime import is enough to make the peer owed.
 *
 * **`optional` is layer optionality and not a weakening of D-181 or D-191.**
 * Those two rulings say that a reach surviving into a package's emitted
 * declarations, or into a published component's emitted JavaScript, is a real
 * dependency a consumer must resolve — and both remain exactly that here, for
 * the consumer that resolves the subpath carrying them. What `optional` records
 * is that a consumer who never imports `./admin` is not silently made to
 * install React in order to compile a backend, which is the question neither
 * ruling was asked.
 */
export type PeerRequirement = 'required' | 'optional' | 'build-only';

/** {@link PeerRequirement}, from the layers one package's reaches were written in. */
export function peerRequirementOf(reaches: readonly PackageReach[]): PeerRequirement {
  const published = [...new Set(reaches.map((reach) => reachLayerOf(reach.file)))].filter(
    (layer) => layer !== 'test',
  );
  if (published.length === 0) return 'build-only';
  return published.every((layer) => UI_LAYER_DIRECTORIES.includes(layer))
    ? 'optional'
    : 'required';
}

/**
 * npm's name for a package's DefinitelyTyped companion: `nodemailer` →
 * `@types/nodemailer`, `@scope/name` → `@types/scope__name`.
 */
function typesPackageFor(name: string): string {
  if (name.startsWith('@types/')) return name;
  return name.startsWith('@')
    ? `@types/${name.slice(1).replace('/', '__')}`
    : `@types/${name}`;
}

/** `^6.6.13` → `6`; a range with no readable major is refused by the caller. */
function majorOf(range: string): string | null {
  const match = /^[^\d]*(\d+)\./.exec(range) ?? /^[^\d]*(\d+)$/.exec(range);
  return match?.[1] ?? null;
}

// --- what survives into the emitted declarations (D-181) -------------------

/**
 * The bare specifiers a package's **emitted declarations** name, with how many
 * `.d.ts` files were opened to find them.
 *
 * D-181's rule is *"if a specifier survives into a package's emitted `.d.ts`,
 * that package declares it as a real dependency"*, and its whole force is that
 * the predicate is a question about the **artefact** rather than about an
 * author's intent: `tsc` copies an import into the declarations it emits
 * verbatim, so a consumer type-checking the package has to resolve it. An
 * `import type` is erased from the emitted JavaScript — which is what D-171
 * reasoned from — and is *not* erased from the emitted declarations whenever
 * the type it names appears in an exported signature. Measured: with
 * `mod-custom-fields` absent, `mod-catalog`'s exported
 * `CatalogCradle.customFieldDefinitionService` becomes `any`, and under
 * `skipLibCheck: true` — what `tsc --init` writes — with no diagnostic at all.
 *
 * `null` when the emit directory holds no declaration file, which is the state
 * of a package that has never been built. The caller decides what to do with
 * that; this function does not guess.
 */
export interface EmittedDeclarations {
  /** Package name → every specifier the declarations wrote for it, sorted. */
  readonly names: ReadonlyMap<string, readonly string[]>;
  /** Declaration files opened, for the `read:` line. */
  readonly files: number;
}

export function emittedDeclarationSpecifiers(
  packageDir: string,
  outDir: string,
  fs: ManifestFs,
): EmittedDeclarations | null {
  const root = outDir === '' ? packageDir : join(packageDir, outDir);
  const names = new Map<string, Set<string>>();
  let files = 0;

  const walk = (dir: string): void => {
    for (const name of fs.listFiles(dir)) {
      if (!name.endsWith('.d.ts')) continue;
      const text = fs.readText(join(dir, name));
      if (text === null) continue;
      files += 1;
      for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
        const packageName = packageNameOf(ref.fileName);
        if (packageName === null) continue;
        const written = names.get(packageName) ?? new Set<string>();
        written.add(ref.fileName);
        names.set(packageName, written);
      }
    }
    for (const child of [...fs.listDirectories(dir)].sort()) walk(join(dir, child));
  };
  walk(root);

  if (files === 0) return null;
  return {
    names: new Map([...names].map(([name, written]) => [name, [...written].sort()])),
    files,
  };
}

/**
 * Whether a `@types/*` package is one the **consumer** supplies rather than one
 * we must declare (D-181).
 *
 * D-181 splits the `@types/*` question on *"can the consumer obtain these types
 * any other way?"*, and refuses a list of package names as the answer. The
 * derivable form of that question is what a duplicate copy would do to the
 * consumer's program: **a types package that contributes global declarations
 * exists exactly once in a program by construction**, so forcing ours on a
 * consumer who already has their own is a duplicate-identifier error the
 * application author cannot fix by any import — which is the hazard D-181
 * names for `@types/react`. A types package that declares only *modules* nests
 * harmlessly, and a consumer who does not write the library's specifier
 * themselves has no reason to have it at all, so it is ours to declare.
 *
 * A global declaration is either a `.d.ts` in global scope — no top-level
 * import or export, so everything in it is ambient — or an explicit
 * `declare global` block. Measured over the packages this repository installs:
 * `@types/react` ships 2 global-scope files of 13, `@types/react-dom` 2
 * `declare global` blocks of 14 and `@types/node` 62 global files of 70, while
 * `@types/pdfmake`, `@types/nodemailer`, `@types/web-push`,
 * `@types/ssh2-sftp-client` and `@types/leaflet` ship none.
 *
 * `null` when the package could not be found or holds no declaration at all: a
 * types package this cannot read must never become an answer in either
 * direction, so the caller refuses rather than guessing (issue #113).
 */
export function typesPackageIsConsumerSupplied(
  typesDir: string,
  fs: ManifestFs,
): boolean | null {
  let read = 0;
  let global = false;

  const walk = (dir: string): void => {
    for (const name of fs.listFiles(dir)) {
      if (!name.endsWith('.d.ts')) continue;
      const text = fs.readText(join(dir, name));
      if (text === null) continue;
      read += 1;
      const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
      const isModule = source.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement) ||
          ts.isExportAssignment(statement) ||
          ts.canHaveModifiers(statement) &&
            (ts.getModifiers(statement) ?? []).some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            ),
      );
      if (!isModule) global = true;
      for (const statement of source.statements) {
        if (
          ts.isModuleDeclaration(statement) &&
          statement.name.kind === ts.SyntaxKind.Identifier &&
          statement.name.text === 'global'
        ) {
          global = true;
        }
      }
    }
    for (const child of [...fs.listDirectories(dir)].sort()) walk(join(dir, child));
  };
  walk(typesDir);

  return read === 0 ? null : global;
}

/**
 * Where an installed `@types/*` package is: **every** application's
 * `node_modules`, then the workspace root's.
 *
 * The companion is always one an **application** declares — that is the only
 * way {@link renderManifest} learns of it at all — so it is installed under
 * that application's `node_modules` whenever anything in this repository has
 * been installed. `null` is therefore a tree with no install, which the caller
 * refuses.
 *
 * *Every* application since feature 091, and not `backend/` alone: pnpm links a
 * dependency into the `node_modules` of the workspace member that declares it,
 * and `@types/react` is `admin`'s. Looking only under `backend/` made the
 * generator refuse a real, installed checkout with "run `pnpm install`" — a
 * message about the world, produced by a walk that was looking in one place.
 * Applications are derived, never listed: a *literal* workspace entry names one
 * deployable, a glob enumerates a library family.
 */
export function findTypesPackage(
  repoRoot: string,
  typesName: string,
  fs: ManifestFs,
): string | null {
  const applications = classifyWorkspaceMembers(repoRoot, fs)
    .members.filter((member) => !member.family)
    .map((member) => member.dir)
    .sort();
  const candidates = [
    ...applications.map((dir) => join(dir, 'node_modules', typesName)),
    join(repoRoot, 'node_modules', typesName),
  ];
  for (const candidate of candidates) {
    if (fs.readText(join(candidate, 'package.json')) !== null) return candidate;
  }
  return null;
}

// --- rendering -------------------------------------------------------------

/**
 * The fields this generator does not author: read from the existing file, never
 * rewritten.
 *
 * `description` and `dependencies` are §2's two HAND-WRITTEN fields — a human's
 * sentence and a human's Constitution IV justification. **`version` joined them
 * on a different ground** (D-210): nobody hand-writes it, but the release
 * process owns it and a layer inventory cannot derive it, so the only honest
 * thing this file can do with it is leave it alone. See {@link versionFor}.
 */
const PRESERVED_FIELDS: readonly string[] = ['description', 'dependencies', 'version'];

/** Everything this generator writes. A field on neither list is refused. */
const GENERATED_FIELDS: readonly string[] = [
  'name',
  'type',
  'sideEffects',
  'license',
  'endora',
  'repository',
  'publishConfig',
  'exports',
  'files',
  'engines',
  'scripts',
  'peerDependencies',
  'peerDependenciesMeta',
  'devDependencies',
];

/**
 * One package's rendered `./tailwind.css` (R1.1/R1.4).
 *
 * A second artefact kind rather than a second `RenderedPackageManifest`,
 * because it is not a manifest: the CLI writes and `--check`s both by the same
 * loop, and every floor and coverage number on the manifest arrays is a
 * statement about manifests.
 */
export interface RenderedTailwindStylesheet {
  readonly packageName: string;
  /** Absolute path of the `tailwind.css` this content belongs at. */
  readonly outputPath: string;
  readonly content: string;
}

/** One package's rendered manifest. */
export interface RenderedPackageManifest {
  readonly packageName: string;
  /**
   * The module this manifest belongs to, or `null` for an **application**
   * manifest this run reconciles rather than renders (feature 091: the admin's
   * dependency on the modules it composes).
   */
  readonly moduleId: string | null;
  /** Absolute path of the `package.json` this content belongs at. */
  readonly outputPath: string;
  readonly content: string;
}

/** What one run rendered, and what it read to do it. */
export interface ManifestRenderRun {
  readonly rendered: readonly RenderedPackageManifest[];
  /**
   * Application manifests this run **reconciled** — today exactly one, the
   * admin's dependency on the module packages whose `./admin` layer the
   * generated registry imports by bare specifier.
   *
   * Kept apart from {@link ManifestRenderRun.rendered} because every floor and
   * every coverage number on that array is a statement about *module packages*:
   * `emitted-declarations` counts the ones with a `dist`, `manifest-index`
   * reconciles them against the registered set. An application is neither, and
   * folding it in would shift both by one for a reason neither derivation
   * knows about.
   */
  readonly applicationRendered: readonly RenderedPackageManifest[];
  /**
   * The **library family** manifests this run reconciles rather than renders:
   * the UI packages whose whole build is scannable (R1.3) — the shell and the
   * kit family.
   *
   * Kept apart from {@link ManifestRenderRun.rendered} for the reason the
   * application half is: every floor on that array counts *module packages*,
   * and these are not. The edit is deliberately as narrow as the admin's — the
   * `./tailwind.css` subpath and its `files` entry, and nothing else — because
   * their `exports` maps and dependency ranges are a human's, with
   * Constitution IV's justification behind them.
   */
  readonly familyRendered: readonly RenderedPackageManifest[];
  /**
   * Every `./tailwind.css` this run renders (R1.4): the module packages that
   * ship a UI layer, plus the family members above.
   */
  readonly stylesheets: readonly RenderedTailwindStylesheet[];
  /**
   * Files opened — sources, manifests and build configurations alike, plus the
   * owner manifests and emitted modules the D-171 surfaces predicate reads. A
   * check that reads files without counting them is issue #244 in the tool that
   * exists to prevent it.
   */
  readonly filesRead: number;
  /** Import specifiers examined inside them: the finer population (#237). */
  readonly specifierSites: number;
  /**
   * The packaged modules the generated manifest index registers, by npm name.
   *
   * The independent derivation this run is reconciled against: the index is a
   * committed artefact produced by a different walk, and a module it registers
   * by bare specifier is a module package that must have been rendered here.
   */
  readonly registeredPackageNames: readonly string[];
  /**
   * The packages whose D-181 answer was a guess rather than a measurement:
   * they have no emitted declarations, so every reach was taken to survive.
   *
   * `manifests:generate` renders them anyway — a package's manifest has to be
   * writable before the package can be built at all — and `--check` refuses
   * them, because a drift verdict against a fail-closed fallback compares the
   * tree to a render nobody will reproduce once the package is built.
   */
  readonly unbuiltPackages: readonly string[];
  /**
   * The packages this run rendered a **first** manifest for: they had no
   * `package.json` on disk when it started.
   *
   * Kept apart from {@link unbuiltPackages} because the two answer different
   * questions about the same fact. A package that has never been built is
   * usually a checkout that skipped `pnpm run build:packages`, which is a short
   * walk and is refused. A package that has no manifest *yet* cannot have been
   * built at all — nothing can build a package that is not a workspace member —
   * so its absent `dist` is a property of the world rather than of this run, and
   * a floor that counted it would refuse the one run that has to succeed: the
   * first one after a module is moved into place or scaffolded. That is the
   * chicken-and-egg this generator's own header states for `--check` and left
   * standing in the disclosure line.
   */
  readonly newPackages: readonly string[];
}

/** Every module package a `pnpm-workspace.yaml` glob reaches, by directory. */
function candidateDirectories(repoRoot: string, fs: ManifestFs): readonly string[] {
  const globs = workspaceGlobs(repoRoot, fs);
  if (globs.length === 0) {
    throw new ModulePackageManifestError(
      `${join(repoRoot, 'pnpm-workspace.yaml')} declares no workspace member. A module ` +
        `package is one, so this run would render nothing and report success.`,
    );
  }
  const excluded = new Set(
    globs
      .filter((glob) => glob.startsWith('!'))
      .flatMap((glob) => expandWorkspaceGlob(repoRoot, glob.slice(1), fs)),
  );
  const found = new Set<string>();
  for (const glob of globs.filter((candidate) => !candidate.startsWith('!'))) {
    for (const dir of expandWorkspaceGlob(repoRoot, glob, fs)) {
      if (excluded.has(dir)) continue;
      // Two ways in, and the second is why the first is not enough. A module
      // package is recognised by shipping a module manifest at the root export
      // rather than by already carrying the file being generated — that is what
      // lets a module just `git mv`d into place get its first `package.json`
      // from this command instead of from an author. But a directory that
      // *declares itself* a module and has no manifest would then drop out of
      // the population in silence, which is the failure this whole generator is
      // about; it is a candidate too, and `layerInventoryOf` refuses it by name.
      const declaresModule = declaresItselfAModule(fs.readText(join(dir, 'package.json')));
      if (fs.readText(join(dir, ROOT_ENTRY)) === null && !declaresModule) continue;
      found.add(dir);
    }
  }
  return [...found].sort();
}

/** Does a manifest's own `endora` block say this package is a module? */
function declaresItselfAModule(manifestText: string | null): boolean {
  if (manifestText === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText) as unknown;
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const endora = (parsed as Record<string, unknown>)['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return false;
  return (endora as Record<string, unknown>)['type'] === 'module';
}

/** Every `.ts`/`.tsx` file under a directory, package-relative, sorted. */
function sourceFilesUnder(
  packageDir: string,
  relativeDir: string,
  fs: ManifestFs,
  out: string[] = [],
): string[] {
  const absolute = join(packageDir, relativeDir);
  for (const name of fs.listFiles(absolute)) {
    if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(`${relativeDir}/${name}`);
  }
  for (const name of [...fs.listDirectories(absolute)].sort()) {
    sourceFilesUnder(packageDir, `${relativeDir}/${name}`, fs, out);
  }
  return out;
}

/** The npm names the generated manifest index registers by bare specifier. */
export function registeredPackageNamesIn(indexSource: string): readonly string[] {
  const names = new Set<string>();
  for (const match of indexSource.matchAll(
    /resolveManifestPath\(\s*import\.meta\.url\s*,\s*'([^']+)'\s*\)/g,
  )) {
    const specifier = match[1]!;
    if (specifier.startsWith('.')) continue;
    names.add(specifier);
  }
  return [...names].sort();
}

/**
 * Every module package's `package.json`, rendered.
 *
 * `manifestIndexPath` is passed in rather than searched for here: locating the
 * one generated index is `lib/module-roots.ts`' derivation and deriving it a
 * second time is two answers waiting to disagree (D-100).
 */
export function renderModulePackageManifests(
  repoRoot: string,
  fs: ManifestFs = nodeManifestFs(),
  manifestIndexPath?: string,
): ManifestRenderRun {
  let filesRead = 0;
  let specifierSites = 0;
  const readText = (path: string): string | null => {
    const text = fs.readText(path);
    if (text !== null) filesRead += 1;
    return text;
  };
  const countingFs: ManifestFs = { ...fs, readText };

  const members = workspaceMembers(repoRoot, fs);
  if (members.length === 0) {
    throw new ModulePackageManifestError(
      `${join(repoRoot, 'pnpm-workspace.yaml')} declares no workspace member. A module ` +
        `package is one, so this run would render nothing and report success — which is the ` +
        `vacuous pass a generator must not be able to print (issue #113).`,
    );
  }
  const scopes = workspaceScopes(members);
  if (scopes.length !== 1) {
    throw new ModulePackageManifestError(
      `${repoRoot}: the workspace members publish under ${scopes.length} scope(s) ` +
        `(${scopes.join(', ') || 'none'}). The npm name of a module package is ` +
        `'<scope>mod-<id>' (§6), and this derivation cannot choose between two scopes or ` +
        `invent one.`,
    );
  }
  const scope = scopes[0]!;
  const workspaceNames = new Set(members.map((member) => member.name));

  const versions = applicationVersions(repoRoot, countingFs);
  // The seed a package with no manifest yet is born at, derived once for the
  // run. Tolerant here and refused at the point of need (`versionFor`): a
  // workspace with no platform member renders perfectly well as long as every
  // package it holds already carries a version of its own.
  const platform = platformSeedVersion(members);
  const nodeEngine = rootNodeEngine(repoRoot, countingFs);
  const repositoryUrl = rootRepositoryUrl(repoRoot, countingFs);
  const defaultLicense = rootLicense(repoRoot, countingFs);

  const directories = candidateDirectories(repoRoot, fs);
  // Two passes: every module package's npm name has to be known before any one
  // of them is rendered, because "another module package" is a refusal (R4) and
  // a one-pass render would only see the packages it had already reached.
  const identities = directories.map((dir) => {
    const manifestSource = readText(join(dir, ROOT_ENTRY));
    if (manifestSource === null) {
      throw new ModulePackageManifestError(
        `${dir}: no ${ROOT_ENTRY}. The root export of a module package is its manifest ` +
          `(module-package-layout.md §1); this directory declares itself a module and ships ` +
          `none, so there is no id to write and nothing for the '.' subpath to name.`,
      );
    }
    const moduleId = moduleIdOf(manifestSource, join(dir, ROOT_ENTRY));
    return { dir, moduleId, name: npmNameFor(scope, moduleId), manifestSource };
  });
  const modulePackageNames = new Set(identities.map((identity) => identity.name));
  // D-171's predicate, read through the one function `check:module-boundary` and
  // T050's guard already read (`lib/module-package-subpaths.ts`). It opens each
  // owner's `package.json` and each measured emitted module, so it keeps its own
  // file count and this run adds it to the `read:` line rather than to
  // `countingFs` — the two readers would otherwise count the same manifest
  // twice.
  const surfaces = modulePackageSurfaces(
    new Map(identities.map((identity) => [identity.name, identity.dir])),
    surfaceReaderOver(fs),
  );

  // D-181's `@types/*` split, memoised across the run: the answer is a property
  // of the types package, not of the module asking about it, and reading
  // `@types/node`'s seventy declaration files once per module package would be
  // most of this command's work.
  const unbuilt: string[] = [];
  const firstRender: string[] = [];
  const typesAnswers = new Map<string, boolean>();
  const consumerSuppliesTypes = (typesName: string): boolean => {
    const cached = typesAnswers.get(typesName);
    if (cached !== undefined) return cached;
    const typesDir = findTypesPackage(repoRoot, typesName, countingFs);
    const answer =
      typesDir === null ? null : typesPackageIsConsumerSupplied(typesDir, countingFs);
    if (answer === null) {
      throw new ModulePackageManifestError(
        `'${typesName}' is declared by an application manifest and could not be read from any ` +
          `node_modules above it. D-181 makes a types package whose types reach a consumer a ` +
          `real dependency unless the consumer supplies it themselves, and that split is ` +
          `derived from the package's own declarations — a types package this cannot read ` +
          `must never become an answer in either direction (issue #113). Run \`pnpm install\`.`,
      );
    }
    typesAnswers.set(typesName, answer);
    return answer;
  };

  // The modules whose `./admin` layer the generated admin registry names by
  // bare specifier, collected from the same inventory the `exports` map is
  // rendered from rather than by a second walk — two walks are two answers
  // waiting to disagree, and this one decides whether the specifier resolves.
  //
  // **`./admin-ui` is deliberately not here** (feature 091, batch 10). The
  // question this set answers is *"does the admin application resolve a bare
  // specifier naming this package"*, and the admin registry names `./admin`
  // and nothing else. A published component is resolved by the **consuming
  // module's** package, which declares the edge in its own peers because its
  // own sources import it — the derivation two lines of `peerNamesOf` already
  // make. Adding it here would put a dependency in `admin/package.json` that
  // no file under `admin/src` names.
  const contributingPackageNames = new Set<string>();
  /**
   * The module packages that ship a UI layer, and the layers they declare
   * (R1.2).
   *
   * Collected from the render loop rather than re-derived from the workspace,
   * so a module whose `package.json` this run is writing for the **first** time
   * still gets its stylesheet — `workspaceMembers` cannot see a directory with
   * no manifest, which is exactly the state the first run after a `git mv`
   * leaves. It is the same inventory the `exports` entry above came from, so
   * the two halves of one declaration cannot disagree.
   */
  const moduleStylesheets: TailwindScannablePackage[] = [];
  const rendered = identities.map((identity) => {
    const layers = layerInventoryOf(identity.dir, countingFs);
    if (layers.layers.some((layer) => layer.directory === ADMIN_LAYER_DIRECTORY)) {
      contributingPackageNames.add(identity.name);
    }
    const emit = readEmitLayout(identity.dir, identity.name, countingFs);
    if (emit === null) {
      throw new ModulePackageManifestError(
        `${identity.dir}: no tsconfig.build.json. A module package ships compiled output ` +
          `(D-164) and its exports targets name the emitted file, so where the build puts it ` +
          `is not something this derivation may assume.`,
      );
    }
    const sourceFiles = [
      ROOT_ENTRY,
      ...sourceFilesUnder(identity.dir, 'src', countingFs).filter(
        (path) => path !== ROOT_ENTRY,
      ),
    ];
    const sources = new Map<string, string>();
    for (const relative of sourceFiles) {
      const text =
        relative === ROOT_ENTRY
          ? identity.manifestSource
          : readText(join(identity.dir, relative));
      if (text === null) continue;
      sources.set(relative, text);
    }
    for (const [file, text] of sources) {
      specifierSites += namedSpecifiers(text, file).length;
    }
    const imported = peerNamesOf(sources);

    const existing = existingManifest(identity.dir, countingFs);
    if (existing === null) firstRender.push(identity.name);
    assertEndoraAgreement(identity.dir, identity.moduleId, identity.name, existing);

    // D-181's population: what this package's own build publishes. Counted on
    // this run's `read:` line like everything else it opens, and remembered as
    // an answer-or-a-guess so `--check` can refuse the guess.
    const emitted = emittedDeclarationSpecifiers(identity.dir, emit.outDir, countingFs);
    if (emitted === null) unbuilt.push(identity.name);

    const content = renderManifest({
      packageName: identity.name,
      moduleId: identity.moduleId,
      layers,
      emit,
      imported,
      surfaces,
      emitted,
      consumerSuppliesTypes,
      selfName: identity.name,
      modulePackageNames,
      workspaceNames,
      versions,
      platform,
      nodeEngine,
      license:
        modulePackageLicenseOf(identity.manifestSource, join(identity.dir, ROOT_ENTRY)) ??
        defaultLicense,
      existing,
      manifestSource: identity.manifestSource,
      manifestFile: join(identity.dir, ROOT_ENTRY),
      repoRootPrefix: repoRootPrefixFor(repoRoot, identity.dir),
      repositoryUrl,
      packageDirFromRoot: relative(repoRoot, identity.dir).split(sep).join('/'),
    });
    const uiLayers = scannableLayersFrom(
      layers.layers
        .filter((layer) => UI_LAYER_DIRECTORIES.includes(layer.directory))
        .map((layer) => `${emit.rootDir === '' ? '' : `${emit.rootDir}/`}${layer.directory}`),
      emit,
    );
    if (uiLayers.length > 0) {
      moduleStylesheets.push({
        name: identity.name,
        dir: identity.dir,
        isModule: true,
        layers: uiLayers,
      });
    }
    return {
      packageName: identity.name,
      moduleId: identity.moduleId,
      outputPath: join(identity.dir, 'package.json'),
      content,
    };
  });

  refuseModulePackageDevDependencyCycle(rendered);

  // The library family's half of R1 — the shell and the kit family, whose
  // whole build is UI (R1.3). Their manifests are hand-written, so this
  // reconciles two keys and renders their stylesheet; the module half above
  // came out of the render loop. The population is one derivation shared with
  // the guard (`scripts/tailwind-source-scan.ts`), so a package the artefact
  // imports and a package the guard probes are the same set by construction.
  const familyScannable = tailwindScannablePackages(repoRoot, countingFs, countingFs.listFiles)
    .filter((pkg) => !pkg.isModule);
  const familyRendered = familyScannable.map((pkg) =>
    renderFamilyStylesheetManifest(pkg, countingFs),
  );
  const stylesheets = [...moduleStylesheets, ...familyScannable]
    .sort((left, right) => byAscii(left.name, right.name))
    .map((pkg) => ({
      packageName: pkg.name,
      outputPath: tailwindStylesheetPathOf(pkg),
      content: renderTailwindStylesheet(pkg),
    }));

  const indexSource =
    manifestIndexPath === undefined ? null : readText(manifestIndexPath);
  if (manifestIndexPath !== undefined && indexSource === null) {
    throw new ModulePackageManifestError(
      `${manifestIndexPath} could not be read. It is the independent derivation this run is ` +
        `reconciled against; without it a short walk is indistinguishable from a clean one.`,
    );
  }

  // The admin's dependency on the modules whose `./admin` layer the generated
  // registry names by bare specifier. Derived from the same layer inventory the
  // `exports` maps above came from, so a module that grows or drops the layer
  // moves both artefacts in one regeneration and neither can go stale under the
  // other.
  const applicationRendered = [
    renderAdminApplicationManifest({
      repoRoot,
      fs: countingFs,
      modulePackageNames,
      contributingPackageNames,
    }),
  ];

  return {
    rendered,
    applicationRendered,
    familyRendered,
    stylesheets,
    filesRead: filesRead + surfaces.filesRead(),
    specifierSites,
    registeredPackageNames:
      indexSource === null ? [] : registeredPackageNamesIn(indexSource),
    unbuiltPackages: [...unbuilt].sort(byAscii),
    newPackages: [...firstRender].sort(byAscii),
  };
}

/**
 * Two module packages that devDepend on each other, refused here rather than
 * discovered by a scheduling race in `build:packages`.
 *
 * pnpm's workspace graph **includes** `devDependencies`, and that is a benefit:
 * it is what orders `pnpm -r run build` so an owner's `dist/ports/index.d.ts`
 * exists before its consumer's `tsc` looks for it. A cycle is where it bites.
 * Measured on this tree, with `returns` and `credit_limits` devDepending on each
 * other and both `dist` directories cleared:
 *
 * ```
 * WARN There are cyclic workspace dependencies: .../credit_limits, .../returns
 * packages/modules/credit_limits build: Done
 * packages/modules/returns   build: error TS2307: Cannot find module
 *   '@endora-commerce/mod-credit-limits/ports'
 * ```
 *
 * pnpm **warns and does not fail**, loses the ordering and runs the pair
 * concurrently, reporting a TypeScript resolution error that names nothing about
 * the cycle that caused it.
 *
 * **How bad that is depends on how many directions carry a real reach, and the
 * paragraph that stood here measured only the easier of the two.** In the spike
 * above the devDependency was mutual and the *import* was not — `credit_limits`
 * reached nothing — so it compiled, emitted its `dist/ports/index.d.ts`, and an
 * immediate re-run of `returns` went green. A race: a fresh CI checkout red or
 * green by scheduling.
 *
 * Re-measured for the shape this refusal was written against, where **both**
 * directions carry a real `import type` (`orders` ↔ `payments`, T040b), it is
 * not a race at all. Every package build sets `noEmitOnError: true`, so the side
 * that loses the race emits nothing and the side that would have won never gets
 * the `.d.ts` it is waiting for. Seven runs on this tree, seven reds, the same
 * TS2307 every time — four cold and concurrent, two warm, and one cold at
 * `--workspace-concurrency=1`. **There is no build order**: a cycle of real
 * mutual type reaches has no serialisation that works, which is why
 * `build:packages` cannot be taught one and why a two-phase build (every
 * package's `./ports` first, then everything else) is the only ordering answer
 * — 66 packages changed to serve two.
 *
 * The distinction is what the message has to carry, because a race invites a
 * retry and a deadlock does not. `pnpm -r run` also aborts on the first failure,
 * so even the one-sided case only self-heals when the owner's build happens to
 * finish before the consumer's fails: measured three cold runs with an immediate
 * re-run each, in the direction where the consumer finishes first, and none of
 * the six went green.
 *
 * There is no cycle in this tree today, and there is a pair one packaging merge
 * request away: T048 (!1052) converted `orders`' reach into `payments`' `Payment`
 * entity class into a published port, so `orders` reaches `payments/ports/index`
 * and `payments` reaches `orders/ports/index` — both `import type`, both
 * directions, both still relative and therefore naming no package yet. Both exits
 * out of the refusal are real and the message names them, because "the generator
 * blocked my conversion" must not be the end of the sentence.
 */
function refuseModulePackageDevDependencyCycle(
  rendered: readonly RenderedPackageManifest[],
): void {
  const edges = new Map<string, ReadonlySet<string>>();
  const names = new Set(rendered.map((entry) => entry.packageName));
  for (const entry of rendered) {
    const manifest = JSON.parse(entry.content) as Record<string, unknown>;
    const devs = manifest['devDependencies'];
    const reached =
      typeof devs === 'object' && devs !== null && !Array.isArray(devs)
        ? Object.keys(devs as Record<string, unknown>).filter((name) => names.has(name))
        : [];
    edges.set(entry.packageName, new Set(reached));
  }
  // Mutual only, deliberately. A longer cycle is not reachable today — every
  // edge in this graph is a type-only reach into a `./ports` subpath and there
  // are none — and a refusal wider than the shape that has been measured is a
  // refusal whose message cannot say what to do about it.
  for (const [name, reached] of [...edges].sort((left, right) => byAscii(left[0], right[0]))) {
    for (const other of [...reached].sort(byAscii)) {
      if (byAscii(name, other) >= 0) continue;
      if (!edges.get(other)?.has(name)) continue;
      throw new ModulePackageManifestError(
        `${name} and ${other} would each devDepend on the other. pnpm's workspace graph ` +
          `includes devDependencies, so a cycle makes it warn, lose the build ordering and ` +
          `run the pair concurrently — the consumer's \`tsc\` then fails with TS2307 on the ` +
          `owner's not-yet-emitted \`.d.ts\`. Where both directions carry a real reach there ` +
          `is no build order at all, concurrent or serial: every package build sets ` +
          `noEmitOnError, so the side that loses emits nothing and the side that would have ` +
          `won never gets its \`.d.ts\` — measured red seven times out of seven, so re-running ` +
          `\`build:packages\` is not a way past this. Two exits, both of which this tree ` +
          `already demonstrates: ` +
          `publish the interface on ONE side only and let the other keep resolving by ` +
          `container name (its manifest's \`acknowledgedDependencies\` / ` +
          `\`nonBindingDependencies\` is where that edge is recorded), or move the interface ` +
          `whose signature permits it into @endora-commerce/contracts, which is not a module ` +
          `and is therefore not in this graph at all.`,
      );
    }
  }
}

/**
 * The surfaces reader over the generator's own injected filesystem.
 *
 * `ManifestFs` answers absence with `null` and `SourceReader` with a separate
 * `exists`, so the adaptor memoises: without it `exists` then `read` opens every
 * emitted module twice, and the second open is a file this run would report as
 * having read. A fixture therefore enters the surfaces predicate through exactly
 * the same map it enters the rest of the generator through (issue #130).
 */
function surfaceReaderOver(fs: ManifestFs): SourceReader {
  const seen = new Map<string, string | null>();
  const load = (path: string): string | null => {
    if (seen.has(path)) return seen.get(path) ?? null;
    const text = fs.readText(path);
    seen.set(path, text);
    return text;
  };
  return {
    exists: (path) => load(path) !== null,
    read: (path) => {
      const text = load(path);
      if (text === null) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

/**
 * `packages/modules/blog` -> `../../..`, in POSIX, whatever the platform.
 *
 * A package directory is always under the repository root, so the relative
 * path is always a run of `..` — but how many is a fact about the layout, and
 * writing one down is how a package that moves a directory gets a build script
 * pointing at nothing.
 */
function repoRootPrefixFor(repoRoot: string, packageDir: string): string {
  const depth = relative(repoRoot, packageDir).split(/[\\/]/).filter(Boolean).length;
  if (depth === 0) {
    throw new ModulePackageManifestError(
      `${packageDir} is the repository root, so it cannot be a module package: the build ` +
        `script's path to the root would be empty.`,
    );
  }
  return new Array(depth).fill('..').join('/');
}

/** The manifest already on disk, or `null` for a package that has none yet. */
function existingManifest(
  packageDir: string,
  fs: ManifestFs,
): Readonly<Record<string, unknown>> | null {
  const text = fs.readText(join(packageDir, 'package.json'));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new ModulePackageManifestError(
      `${join(packageDir, 'package.json')} does not parse (${String(error)}), so the fields ` +
        `this generator preserves cannot be read out of it.`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ModulePackageManifestError(
      `${join(packageDir, 'package.json')} is not a JSON object.`,
    );
  }
  const manifest = parsed as Record<string, unknown>;
  const known = new Set([...GENERATED_FIELDS, ...PRESERVED_FIELDS]);
  const unknownFields = Object.keys(manifest).filter((field) => !known.has(field));
  if (unknownFields.length > 0) {
    throw new ModulePackageManifestError(
      `${join(packageDir, 'package.json')} declares ${unknownFields.join(', ')}, which this ` +
        `generator neither writes nor preserves — regenerating would drop it in silence. ` +
        `Either add it to the generated half (and to module-package-layout.md §2 in the same ` +
        `merge request) or to PRESERVED_FIELDS if it is genuinely a package author's.`,
    );
  }
  return manifest;
}

/** The `endora` block on disk must agree with the module manifest, or say so. */
function assertEndoraAgreement(
  packageDir: string,
  moduleId: string,
  packageName: string,
  existing: Readonly<Record<string, unknown>> | null,
): void {
  if (existing === null) return;
  const endora = existing['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return;
  const declared = (endora as Record<string, unknown>)['id'];
  if (typeof declared === 'string' && declared !== moduleId) {
    throw new ModulePackageManifestError(
      `${join(packageDir, 'package.json')} declares endora.id '${declared}' while ` +
        `${ROOT_ENTRY} declares '${moduleId}'. That disagreement is what ` +
        `src/packages/package-runtime.ts refuses the package for at boot; the manifest is the ` +
        `authority, so rename the package's endora block or the module's id — this generator ` +
        `will not pick one.`,
    );
  }
  const name = existing['name'];
  if (typeof name === 'string' && name !== packageName) {
    throw new ModulePackageManifestError(
      `${join(packageDir, 'package.json')} publishes as '${name}' while §6 derives ` +
        `'${packageName}' from module id '${moduleId}'. A rename changes every consumer's ` +
        `specifier and every lockfile entry, so it is not something regeneration may do ` +
        `quietly.`,
    );
  }
}

/**
 * The one sentence R4's refusal gains: which reach failed, and why.
 *
 * `null` means every reach into `name` is a type-only import at contract
 * surface, which is the whole of D-171's exemption. The first failure is
 * reported rather than all of them: R4 is a refusal and not a ledger, and the
 * author's next step is the same whichever of them they repair first.
 *
 * {@link UnreadableSubpathError} is deliberately **not** caught here. A subpath
 * whose emitted module cannot be read is a broken artefact, not a coupling, and
 * a refusal that says "coupling" when the truth is "I could not read the file"
 * is worse than no refusal — it sends the author to redesign a seam that is
 * fine. The CLI turns it into exit 2 with its own message, which already names
 * the remedy (`pnpm run build:packages`).
 */
export function firstNonContractReach(
  name: string,
  reaches: readonly PackageReach[],
  surfaces: ModulePackageSurfaces,
): string | null {
  for (const reach of reaches) {
    const where = `${reach.file}:${reach.line}`;
    const written = `'${reach.subpath === '' ? name : `${name}/${reach.subpath}`}'`;
    // D-191's published-component exit, and the **only** value reach into
    // another module package this generator admits (feature 091, batch 10; R9).
    //
    // It cannot be derived the way D-171's exemption is. That one asks the
    // artefact *"does this subpath emit a runtime binding"* and gets an answer
    // that is true independently of anybody's intent; a published component
    // emits runtime bindings by construction, exactly as `./backend` does, so
    // the artefact cannot tell the two apart. What distinguishes them is which
    // **subpath** the owner published it on, which is a declaration — this
    // file's own `LAYER_SUBPATHS`, through the one name in `ui-layer.ts` — and
    // the whole of what D-191 settled.
    //
    // What it therefore does **not** waive, stated so the next reader does not
    // have to infer it: the reach stays a counted cross-module reach in
    // `check:module-boundary` (Z11 — do not widen that derivation), the
    // consumer gates the owner's presence at the render (Z12), and neither
    // module gains a manifest `dependencies` entry, because a component is not
    // a port and an npm edge is still not a lifecycle edge.
    if (reach.subpath === PUBLISHED_COMPONENT_LAYER_DIRECTORY) continue;
    if (reach.kind !== 'type-only-import') {
      return (
        `${where} writes ${written} as a ${reach.kind}, which survives into the emitted ` +
        `JavaScript and would need a real runtime dependency. Only an \`import type\` is ` +
        `erased, and only an erased reach is one npm need not know about (D-171).`
      );
    }
    const surface: SubpathSurface = surfaces.surfaceOfSubpath(name, reach.subpath);
    if (surface.kind === 'contract') continue;
    return (
      `${where} reaches ${written}, whose surface is '${surface.kind}'` +
      (surface.runtimeExports.length === 0
        ? ''
        : ` (its emitted module exports ${surface.runtimeExports.join(', ')})`) +
      `. A subpath is contract surface iff the module it resolves to exports no runtime ` +
      `binding (D-171); this one is not, so the reach is the coupling R4 refuses.`
    );
  }
  return null;
}

interface RenderInput {
  readonly packageName: string;
  readonly moduleId: string;
  readonly layers: LayerInventory;
  readonly emit: EmitLayout;
  /** Every package the sources name, with every reach into it (R4's population). */
  readonly imported: ReadonlyMap<string, readonly PackageReach[]>;
  /** Answers whether a module package's subpath is contract surface (D-171). */
  readonly surfaces: ModulePackageSurfaces;
  /**
   * The specifiers this package's **own** emitted declarations name (D-181), or
   * `null` when it has never been built.
   *
   * `null` is the bootstrap state — a module directory that has just been
   * `git mv`d into place has no `package.json`, so it cannot be built, so its
   * manifest is rendered before its `dist` exists. It fails **closed**: every
   * reach is treated as surviving, which over-declares rather than publishing
   * the `any` D-181 refuses, and regenerating after the first build narrows it.
   * The `--check` mode refuses a package that answered that way, so a drift
   * verdict is never taken against a render nobody will reproduce.
   */
  readonly emitted: EmittedDeclarations | null;
  /**
   * Whether a `@types/*` companion is the consumer's to supply (D-181).
   * Refuses — it does not guess — when the types package cannot be read.
   */
  readonly consumerSuppliesTypes: (typesName: string) => boolean;
  readonly selfName: string;
  readonly modulePackageNames: ReadonlySet<string>;
  readonly workspaceNames: ReadonlySet<string>;
  readonly versions: ReadonlyMap<string, string>;
  /**
   * The platform host and the version it carries, for a package that has no
   * manifest to preserve one from (D-210). `null` when this workspace has no
   * platform member; {@link versionFor} refuses at the point it needs one.
   */
  readonly platform: { readonly name: string; readonly version: string | null } | null;
  readonly nodeEngine: string;
  /**
   * The SPDX expression this package publishes under: the workspace root's
   * default ({@link rootLicense}), or this module's own override
   * ({@link modulePackageLicenseOf}) where it declares one.
   */
  readonly license: string;
  readonly existing: Readonly<Record<string, unknown>> | null;
  readonly manifestSource: string;
  readonly manifestFile: string;
  /**
   * The package directory's own path to the repository root, POSIX, e.g.
   * `../../..` — the prefix of the asset copier the `build` script names when
   * this package ships one. Derived from where the package actually is, never
   * a depth written down: a package one directory deeper would otherwise get a
   * build script that resolves to nothing.
   */
  readonly repoRootPrefix: string;
  /**
   * The `repository.url` the workspace root declares, verbatim.
   *
   * One repository, one URL. It is read from the root manifest rather than
   * written here because a published package's `repository` is what gives a
   * consumer a path back to the code, and a constant in this file would be that
   * URL recorded a seventy-first time (D-100) — the remote moves and every
   * package points at nothing until somebody regenerates.
   */
  readonly repositoryUrl: string;
  /**
   * This package's own directory, relative to the repository root, POSIX —
   * `repository.directory`, which is what tells a consumer *where in* the
   * monorepo the package lives. Derived from where the package is, like
   * {@link RenderInput.repoRootPrefix} and for the same reason.
   */
  readonly packageDirFromRoot: string;
}

/**
 * Whether a specifier into `name` survives into what this package publishes
 * (D-181).
 *
 * A package with no emitted declarations answers **yes** for everything, which
 * is the fail-closed direction: it over-declares a dependency that may not have
 * needed declaring, where the other direction is the silent `any` D-181 exists
 * to refuse.
 */
function survivesIntoDeclarations(input: RenderInput, name: string): boolean {
  return input.emitted === null || input.emitted.names.has(name);
}

/** `src/backend/index.ts` → `./dist/backend/index.js`, per the build declaration. */
function emittedTarget(emit: EmitLayout, entry: string, extension: string): string {
  const prefix = emit.rootDir === '' ? '' : `${emit.rootDir}/`;
  const within = entry.startsWith(prefix) ? entry.slice(prefix.length) : entry;
  const base = within.replace(/\.[cm]?tsx?$/, '');
  const out = emit.outDir === '' ? base : `${emit.outDir}/${base}`;
  return `./${out}${extension}`;
}

function conditionsFor(emit: EmitLayout, entry: string): Record<string, string> {
  return {
    types: emittedTarget(emit, entry, '.d.ts'),
    default: emittedTarget(emit, entry, '.js'),
  };
}

/**
 * The scannable layers this module package declares (R1.2).
 *
 * Derived from the layer inventory the `exports` map is already rendered from
 * and the build layout its targets already take, so a module that grows
 * `src/admin/` grows its `./tailwind.css` in the same regeneration that gives
 * it `./admin` — which is R1.4's whole reason for generating the file: a
 * mistyped `@source` is silent (M12), so no human types one.
 */
function tailwindLayersOf(input: RenderInput): readonly TailwindScannableLayer[] {
  const ui = input.layers.layers
    .filter((layer) => UI_LAYER_DIRECTORIES.includes(layer.directory))
    .map((layer) => `${input.emit.rootDir === '' ? '' : `${input.emit.rootDir}/`}${layer.directory}`);
  return scannableLayersFrom(ui, input.emit);
}

/** The whole file, as text. */
export function renderManifest(input: RenderInput): string {
  const exportsMap: Record<string, unknown> = {
    '.': conditionsFor(input.emit, ROOT_ENTRY),
  };
  for (const layer of input.layers.layers) {
    exportsMap[layer.subpath] = conditionsFor(input.emit, layer.entry);
  }
  // The package's own `@source` declarations
  // (`specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
  // R1.1), emitted for a package that ships a UI layer and for no other. It is
  // the subpath the instance's generated stylesheet imports by name, so a
  // package that ships screens and does not declare it is a screen an instance
  // renders unstyled — and an undeclared subpath is
  // ERR_PACKAGE_PATH_NOT_EXPORTED, which is the loud failure R1 trades the
  // silent one for.
  //
  // A CSS file, so it carries **no conditions**: `types` and `default` are for
  // a module a consumer imports, and this one is imported by a stylesheet.
  if (tailwindLayersOf(input).length > 0) {
    exportsMap[TAILWIND_SOURCE_SUBPATH] = `./${TAILWIND_SOURCE_FILE}`;
  }
  // R1 — discovery reads `<pkg>/package.json` for the `endora` field; omitting
  // it is ERR_PACKAGE_PATH_NOT_EXPORTED at runtime and TS2307 at compile time.
  exportsMap['./package.json'] = './package.json';

  const peers = new Map<string, string>();
  const devs = new Map<string, string>();
  /** The names {@link peerRequirementOf} answered `optional` for (FR-022). */
  const optionalPeers = new Set<string>();
  for (const name of [...input.imported.keys()].sort(byAscii)) {
    if (name === input.selfName) continue;
    // FR-022, asked once per name and before any of the three branches below,
    // because all three ask the same question of the same reaches. `build-only`
    // takes the `peers.set` off every branch and leaves `devs.set` where it is:
    // the package still has to compile and run its own tests, and the consumer
    // still owes nothing.
    const requirement = peerRequirementOf(input.imported.get(name) ?? []);
    const setPeer = (range: string): void => {
      if (requirement === 'build-only') return;
      peers.set(name, range);
      if (requirement === 'optional') optionalPeers.add(name);
    };
    if (input.modulePackageNames.has(name)) {
      // R4, narrowed by D-171 rather than waived. Every reach into that name
      // must be a type-only import at a subpath whose emitted module exports no
      // runtime binding; then the reach survives into nothing a consumer
      // resolves and `devDependencies` is the only npm field that is true about
      // it. Anything else keeps R4's refusal and R4's message.
      const failure = firstNonContractReach(
        name,
        input.imported.get(name) ?? [],
        input.surfaces,
      );
      if (failure !== null) {
        throw new ModulePackageManifestError(
          `${input.packageName} imports ${name}, another module package. R4: a module reaches ` +
            `another through a port declared in its manifest \`dependencies\`, never through ` +
            `npm — a package edge is one the lifecycle, the migration order and an operator ` +
            `switching the owner off all know nothing about. ${failure}`,
        );
      }
      // D-171's exemption is a build-time declaration and nothing more: no
      // `dependencies` (R4's own word, D-11 rule 3) and no `peerDependencies`,
      // which would assert an install-time requirement the module manifest's
      // `acknowledgedDependencies` / `nonBindingDependencies` classification
      // explicitly denies for four of today's reaches.
      //
      // **Unless the reach survives into what this package publishes** (D-181).
      // `tsc` copies an `import type` into the emitted `.d.ts` verbatim whenever
      // the type it names appears in an exported signature, and a consumer
      // type-checking the package must then resolve it: with the owner absent
      // the type silently becomes `any`, with no diagnostic under the
      // `skipLibCheck: true` a third-party author actually has. So the reach is
      // a real dependency and the peer is what says so — not an *optional*
      // peer, which documents the defect instead of removing it, and not a
      // `devDependency`, which a consumer never installs. It stays out of
      // `dependencies`, which is R4's own word and the field this generator
      // preserves for a package author.
      //
      // **And a published component is a peer outright** (D-191; feature 091,
      // batch 10). The reach survives into the emitted JavaScript by
      // construction — that is what a component *is* — so every consumer that
      // bundles this package's admin layer must resolve the owner. A
      // `devDependency` alone would be true of this repository, where every
      // package is a workspace member, and false of the first install from a
      // registry: the bundle would fail to resolve a specifier nothing declared.
      // Not an *optional* peer, for D-181's reason above — it documents the
      // defect instead of removing it — and still not `dependencies`, which is
      // R4's own word and the field this generator preserves for an author.
      if (
        survivesIntoDeclarations(input, name) ||
        (input.imported.get(name) ?? []).some(
          (reach) => reach.subpath === PUBLISHED_COMPONENT_LAYER_DIRECTORY,
        )
      ) {
        setPeer('workspace:*');
      }
      devs.set(name, 'workspace:*');
      continue;
    }
    if (input.workspaceNames.has(name)) {
      // R5 — `pnpm pack` rewrites `workspace:*` to the exact version, so this
      // source needs no change when versions become real.
      setPeer('workspace:*');
      devs.set(name, 'workspace:*');
      continue;
    }
    const declared = input.versions.get(name);
    if (declared === undefined) {
      throw new ModulePackageManifestError(
        `${input.packageName} imports '${name}', which the application declares nowhere. The ` +
          `peer range is the major of the version this repository actually runs; inventing ` +
          `one ships a package whose peer nothing resolves. Add it to the package.json of ` +
          `the application that composes this layer — backend/ for src/backend/, admin/ for ` +
          `src/admin/ — with the justification Constitution IV requires.`,
      );
    }
    const major = majorOf(declared);
    if (major === null) {
      throw new ModulePackageManifestError(
        `${input.packageName}: the application declares '${name}' as '${declared}', which has ` +
          `no readable major version, so the peer range cannot be derived from it.`,
      );
    }
    setPeer(`^${major}`);
    devs.set(name, declared);
    // A library whose types are a separate `@types/*` package. Nothing imports
    // that package, so the specifier walk above cannot see it — the compiler
    // finds it through `node_modules/@types`, which inside `backend/` is the
    // application's own declaration and inside a package is the package's. So a
    // module importing a JS-only library builds in `backend/src` and fails as a
    // package with TS7016 on a line its author never wrote: `newsletter` and
    // `nodemailer` was the first, `pwa` and `web-push` the second.
    //
    // Derived, never listed: the companion name is npm's mangling of the
    // library's, and it is added only when the application itself declares it —
    // a library that ships its own types has no `@types` entry to find, and one
    // whose types the application does not declare is a gap in
    // `backend/package.json` rather than something to invent here. It goes in
    // `devDependencies` only: a type-only package is a build input, not
    // something a consumer resolves.
    //
    // **And it is a real dependency when its types reach a consumer** (D-181):
    // a companion whose library's specifier survives into this package's
    // emitted declarations is one the consumer needs to type-check what we
    // publish, and cannot obtain any other way. The exception is a companion
    // that contributes *global* declarations — `@types/react`, `@types/node` —
    // which exists once in a program by construction, so forcing ours is a
    // conflict the application author cannot fix and the types are theirs to
    // supply. That split is derived from the types package itself
    // ({@link typesPackageIsConsumerSupplied}) and is never a list of names.
    //
    // **A companion inherits its library's {@link PeerRequirement}** (FR-022),
    // because the two are one requirement: a consumer who does not owe the
    // library cannot owe the declarations that describe it. `build-only` is
    // already handled — `survivesIntoDeclarations` is false for a name only a
    // test reaches once the package is built, and `setPeer` refuses it in any
    // case — and `optional` is carried across explicitly so that a UI-only
    // library and its `@types/*` never disagree about who has to install them.
    const types = typesPackageFor(name);
    const typesDeclared = input.versions.get(types);
    if (typesDeclared !== undefined) {
      devs.set(types, typesDeclared);
      if (
        requirement !== 'build-only' &&
        survivesIntoDeclarations(input, name) &&
        !input.consumerSuppliesTypes(types)
      ) {
        const typesMajor = majorOf(typesDeclared);
        if (typesMajor === null) {
          throw new ModulePackageManifestError(
            `${input.packageName}: the application declares '${types}' as '${typesDeclared}', ` +
              `which has no readable major version, so the peer range D-181 requires of it ` +
              `cannot be derived from it.`,
          );
        }
        peers.set(types, `^${typesMajor}`);
        if (requirement === 'optional') optionalPeers.add(types);
      }
    }
  }
  // The toolchain the generated `scripts` themselves need: `tsc` for `build`
  // and `typecheck`, and the ambient Node types every backend module compiles
  // against. Constant across every module package because the scripts are, and
  // taken at the application's own ranges so one repository runs one compiler.
  for (const name of ['@types/node', 'typescript']) {
    const declared = input.versions.get(name);
    if (declared === undefined) {
      throw new ModulePackageManifestError(
        `the application declares no '${name}', so a module package's own build script has no ` +
          `toolchain to name.`,
      );
    }
    devs.set(name, declared);
  }
  // And the runner the `test` script names, on the same terms and for the same
  // reason: a script that invokes a tool the package does not declare is a
  // script that cannot run. It arrived by accident for the four packages whose
  // tests sit *beside* their sources — the specifier walk reads the test's own
  // `import … from 'vitest'` — and not at all for a package whose tests live in
  // `test/`, which the walk does not enter. Measured on a scaffolded package:
  // `pnpm run test` answered `vitest: command not found`, which is the emitted
  // `test` script's own failure and not the author's. A **devDependency** only:
  // a consumer never runs this package's tests, and `tsconfig.build.json`
  // excludes them from the emit, so nothing published names the runner.
  if (input.layers.hasVitestConfig) {
    const declared = input.versions.get('vitest');
    if (declared === undefined) {
      throw new ModulePackageManifestError(
        `${input.packageName} declares a vitest configuration and the application declares no ` +
          `'vitest', so the \`test\` script this generator emits would name a runner nothing ` +
          `installs.`,
      );
    }
    devs.set('vitest', declared);
  }

  // `tsc` copies nothing but `.ts` (measured), so a package whose `src/` holds
  // a file the running module opens needs a second step — and whether it does
  // is read off the directory rather than declared by an author. An asset rule
  // somebody has to remember is a rule somebody forgets, and this one fails
  // silently: every reader downstream is handed a directory and asked what is
  // in it, for which "the build dropped it" and "this module ships none" are
  // the same input (D-165). The `--src`/`--out` pair is this package's own
  // emit layout, the same derivation the `exports` targets take.
  const emitFlags = `--src ${input.emit.rootDir || '.'} --out ${input.emit.outDir || '.'}`;
  // The admin layer compiles under its **own** emit configuration (feature 091,
  // `contracts/admin-contribution.md` R12): `jsx: "react-jsx"` and the `DOM`
  // lib are what a React screen needs and what a service file must not have —
  // one config for both lets a backend file reference `document` and compile
  // clean, in the layer where that is a production crash. Whether the second
  // invocation is emitted is read off the layer inventory, never declared by an
  // author, so a package that grows `src/admin/` grows the build step in the
  // same regeneration.
  //
  // **Either** UI layer triggers it, and there is still only one invocation
  // (Z9): `src/admin/` and `src/admin-ui/` run in the same runtime and emit
  // into the same `dist`, so a second `tsc` would be a third place the
  // `jsx`/`lib` pair is declared. The predicate is `UI_LAYER_DIRECTORIES` and
  // not `ADMIN_LAYER_DIRECTORY`, so a package that publishes a component and
  // contributes no screen — which is what an installed extension package
  // reaching D-191's exit looks like — still gets its build step.
  const uiBuild = input.layers.layers.some((layer) =>
    UI_LAYER_DIRECTORIES.includes(layer.directory),
  )
    ? ' && tsc -p tsconfig.ui.json'
    : '';
  const build =
    (input.layers.assets.length === 0
      ? 'tsc -p tsconfig.build.json'
      : `tsc -p tsconfig.build.json && node ${input.repoRootPrefix}/scripts/copy-package-assets.mjs ` +
        emitFlags) + uiBuild;
  const scripts: Record<string, string> = {
    build,
    // The UI program is type-checked by the same configuration that emits it,
    // with `--noEmit` on top: a second type-check-only config would be a third
    // place the `jsx`/`lib` pair is declared, and two declarations of a
    // compiler guarantee are two answers waiting to disagree.
    typecheck: uiBuild === '' ? 'tsc -p tsconfig.json' : 'tsc -p tsconfig.json && tsc -p tsconfig.ui.json --noEmit',
    lint: input.layers.hasTests ? 'eslint src test' : 'eslint src',
  };
  // Bare `vitest run`, never `--passWithNoTests` (feature 089, Phase 1). The
  // flag is the defect this script exists to fix, one layer up: a package that
  // declares a test configuration and collects zero files would exit 0, which is
  // `read-size.ts`'s own family — a green that means "not looking". Measured on
  // vitest 2.1.9 over a package with no test file: bare `run` exits 1 with
  // "No test files found", `--passWithNoTests` exits 0. So the floor costs
  // nothing; it only has to not be switched off. The other half of the same
  // rule is `layerInventoryOf`'s refusal of a test file with no configuration —
  // this one makes a *declared* run honest, that one makes an *undeclared* one
  // impossible.
  if (input.layers.hasVitestConfig) scripts['test'] = 'vitest run';

  const files = [input.emit.outDir === '' ? 'dist' : input.emit.outDir];
  if (input.layers.hasI18n) files.push('i18n');
  if (input.layers.hasDocs) files.push('docs');
  // The stylesheet sits at the package root beside `package.json`, outside
  // `dist`, so `files` has to name it: a subpath declared over a file the
  // tarball omits is M9 — ERR_PACKAGE_PATH_NOT_EXPORTED at the first consumer,
  // which `pack-gate` refuses as `unresolvable-export`.
  if (tailwindLayersOf(input).length > 0) files.push(TAILWIND_SOURCE_FILE);

  const manifest = {
    name: input.packageName,
    // R6's `private` half is gone with F10 slice 3 (D-208): every module
    // package publishes, so the field is dropped rather than emitted `false`
    // — absent is npm's own default. Its `version` half was overtaken by
    // D-210, which set every versionable package to the first release number
    // by hand; the field is preserved from disk now and is nothing this file
    // decides.
    version: versionFor(input),
    type: 'module',
    sideEffects: false,
    description: descriptionFor(input),
    // The estate's default, or this module's own override — {@link rootLicense}
    // and {@link modulePackageLicenseOf}. It is `MIT` for all 70 today because
    // no module declares an override, and the generator renders a guess for
    // none of them: which modules are paid is a product decision, and a value
    // invented here would be a licence grant nobody authorised.
    license: input.license,
    endora: { type: 'module', id: input.moduleId },
    repository: {
      type: 'git',
      url: input.repositoryUrl,
      directory: input.packageDirFromRoot,
    },
    publishConfig: { access: 'public' },
    exports: exportsMap,
    files,
    engines: { node: input.nodeEngine },
    scripts,
    peerDependencies: Object.fromEntries(sortedByAscii(peers)),
    // FR-022. Emitted only when this package has an optional peer, because an
    // empty object is the same fact as an absent one and npm reads neither —
    // and a key here that `peerDependencies` does not carry is a declaration
    // about nothing. See {@link peerRequirementOf} for what makes one optional.
    ...(optionalPeers.size === 0
      ? {}
      : {
          peerDependenciesMeta: Object.fromEntries(
            [...optionalPeers].sort(byAscii).map((name) => [name, { optional: true }]),
          ),
        }),
    devDependencies: Object.fromEntries(sortedByAscii(devs)),
    // HAND-WRITTEN (§2) — a third-party runtime library this module alone
    // needs, with the justification Constitution IV requires. Last, so the
    // generated half reads as one block above it.
    ...(input.existing?.['dependencies'] === undefined
      ? {}
      : { dependencies: input.existing['dependencies'] }),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The release process's field, preserved (D-210).
 *
 * Everything else in this manifest is derived from the package's own layers,
 * sources and declarations. A version is derived from none of them: it is the
 * release's statement about what this code *is*, written by
 * `changeset version` or, for the first one, by hand. So the generator reads it
 * and writes it back, and the only run in which it has to produce a number is
 * the one where there is no manifest to read — a module just moved into place,
 * which gets the platform's own version ({@link platformSeedVersion}).
 *
 * **Both refusals below are asked here rather than at the top of the run**, so
 * a checkout whose packages all carry a version never consults the platform at
 * all: an input nothing needed must not be able to fail a run that had no
 * question for it.
 */
function versionFor(input: RenderInput): string {
  const existing = input.existing?.['version'];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const platform = input.platform;
  if (platform === null) {
    throw new ModulePackageManifestError(
      `${input.packageName} has no package.json yet, so its version has to be seeded — and ` +
        `no workspace member declares \`endora: { "type": "platform" }\`. D-210 releases ` +
        `every versionable package under one number and \`pnpm pack\` rewrites a ` +
        `workspace: range to the exact sibling version, so a package born below its ` +
        `siblings pins a version that will never exist on a registry. The platform's own ` +
        `manifest is where that number is written and this generator will not invent one.`,
    );
  }
  if (platform.version === null) {
    throw new ModulePackageManifestError(
      `${input.packageName} has no package.json yet and ${platform.name} declares no ` +
        `\`version\`, so there is nothing to seed one from. That number is the platform's ` +
        `release, not a default this generator may choose: the constant it used to write ` +
        `went stale the first time a release moved (D-210), which is the whole reason the ` +
        `seed is derived.`,
    );
  }
  return platform.version;
}

/**
 * A sentence a human wrote, preserved (§2, HAND-WRITTEN).
 *
 * Preserved verbatim when the package has one, and seeded from the module's own
 * manifest when it does not — so a module that has just been moved into place
 * gets a first `package.json` from this command instead of from an author, and
 * never gets its sentence rewritten afterwards.
 */
function descriptionFor(input: RenderInput): string {
  const existing = input.existing?.['description'];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const declared = moduleDescriptionOf(input.manifestSource, input.manifestFile);
  if (declared !== null && declared.length > 0) return declared;
  throw new ModulePackageManifestError(
    `${input.packageName} has no description: neither its package.json nor its module ` +
      `manifest declares one. It is the field a human writes (§2), so this generator will ` +
      `not invent it.`,
  );
}

/** ASCII order, which is the order `@e` < `@m` < `@t` < bare names comes out in. */
function byAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedByAscii(entries: ReadonlyMap<string, string>): Array<[string, string]> {
  return [...entries.entries()].sort((left, right) => byAscii(left[0], right[0]));
}


// --- the admin application's dependency on the modules it composes ----------

/**
 * `workspace:*`, the range R5 gives every workspace edge: `pnpm pack` rewrites
 * it to the exact version, so this needs no change when versions become real.
 */
const MODULE_DEPENDENCY_RANGE = 'workspace:*';

/**
 * The admin application's `package.json`, with its module-package dependencies
 * reconciled against the layer inventory (feature 091, Phase 2).
 *
 * ## Why this file writes it
 *
 * `admin/src/modules.generated.ts` imports each contributing module by a **bare
 * specifier** derived from that module's own `exports` map (D-149). A bare
 * specifier resolves through `node_modules`, and pnpm links a workspace member
 * there only for a package that **declares** it. So a module that ships
 * `src/admin/` and is not a dependency of the admin is a registry entry Vite
 * cannot resolve — the build fails, which is at least loud, but it fails in a
 * file no author wrote and names a package they did not know they had to add.
 *
 * The alternative was a refusal telling the author to run `pnpm add`. It was
 * rejected because it re-creates exactly what this feature removes: a shared
 * file every module author edits by hand. `spec.md` §1.1 measures four of
 * those; adding a fifth while converting two is not a remedy.
 *
 * ## What it is allowed to touch, and what it is not
 *
 * **Only this repository's own module packages, inside `dependencies`.** Every
 * other key, and the order of every other key, is the file's own: a module the
 * inventory says contributes is inserted at its ASCII position among the keys
 * already there, a module that has dropped its admin layer is removed, and
 * nothing else moves. That is the narrowest edit that keeps the artefact true,
 * and it is deliberately not "rewrite the manifest from a derivation" — the
 * admin's React, Radix and Tailwind ranges are a human's, with Constitution
 * IV's justification behind them, and a generator that owned them would be
 * asserting an authority it does not have.
 *
 * Ours is answered from the identities this run derived, never from a `mod-`
 * prefix test: the prefix is a naming convention (§6), and a third-party
 * package that happened to follow it would be silently deleted here.
 *
 * ## Which application, and how it is found
 *
 * The member declaring the `"@/*"` tsconfig alias — the same derivation
 * `check:admin-surface`, `check:admin-zones` and the registry generator use,
 * and for the same reason: that alias is what `tsc` and Vite both resolve the
 * admin's own imports through, so it is a live declaration rather than a
 * convention. Zero or two members declaring it is a refusal.
 */
export function renderAdminApplicationManifest(input: {
  readonly repoRoot: string;
  readonly fs: ManifestFs;
  /** Every module package this run derived, by npm name. */
  readonly modulePackageNames: ReadonlySet<string>;
  /** The subset that ships `src/admin/` and therefore has to be resolvable. */
  readonly contributingPackageNames: ReadonlySet<string>;
}): RenderedPackageManifest {
  const members = workspaceMembers(input.repoRoot, input.fs);
  const memberNames = new Set(members.map((member) => member.name));
  const { member } = findAliasMember(members, (path) => input.fs.readText(path));
  const manifestPath = join(member.dir, 'package.json');
  const text = input.fs.readText(manifestPath);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${manifestPath} could not be read. It is the manifest whose dependencies make the ` +
        `bare specifiers in the generated admin registry resolvable; without it a module's ` +
        `admin layer is registered and unreachable.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const declared = manifest['dependencies'];
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new ModulePackageManifestError(
      `${manifestPath} declares no \`dependencies\` object. The admin registry's entries are ` +
        `resolved through it, so there is nowhere to record the modules this application ` +
        `composes.`,
    );
  }
  const kept = Object.entries(declared as Record<string, unknown>).filter(
    ([name, range]) => {
      if (input.contributingPackageNames.has(name)) return true;
      if (input.modulePackageNames.has(name)) return false;
      // A `workspace:` range naming no current member is an edge to a package
      // that has **gone** — a module deleted, renamed or moved out of the
      // globs. It is ours to remove and it is not a stranger's: a package from
      // a registry carries a semver range, never the workspace protocol, so
      // this discriminates without a `mod-` prefix test and without a list. It
      // has to exist, because the "is it one of ours" question above is
      // answered from the packages this run **found**, and a deleted one is
      // exactly the package it cannot find.
      return !(typeof range === 'string' && range.startsWith('workspace:') && !memberNames.has(name));
    },
  );
  const present = new Set(kept.map(([name]) => name));
  const missing = [...input.contributingPackageNames]
    .filter((name) => !present.has(name))
    .sort(byAscii);

  const reconciled: Array<[string, unknown]> = [];
  let cursor = 0;
  for (const [name, range] of kept) {
    while (cursor < missing.length && byAscii(missing[cursor]!, name) < 0) {
      reconciled.push([missing[cursor]!, MODULE_DEPENDENCY_RANGE]);
      cursor += 1;
    }
    reconciled.push([name, range]);
  }
  for (; cursor < missing.length; cursor += 1) {
    reconciled.push([missing[cursor]!, MODULE_DEPENDENCY_RANGE]);
  }

  manifest['dependencies'] = Object.fromEntries(reconciled);
  return {
    packageName: typeof manifest['name'] === 'string' ? manifest['name'] : member.name,
    moduleId: null,
    outputPath: manifestPath,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

// --- the library family's own source declarations (R1.3) --------------------

/**
 * A UI family member's `package.json`, with its `./tailwind.css` subpath and
 * `files` entry reconciled against what it ships
 * (`admin-stylesheet-composition.md` R1.3/R1.4).
 *
 * ## Why a reconciliation and not a render
 *
 * These five manifests are hand-written and must stay so. Their `exports` maps
 * carve out subpath families nothing in this repository derives
 * (`page-builder-core` publishes nine plus a wildcard), and their dependency
 * ranges are a human's with Constitution IV's justification behind them. A
 * generator that owned the whole file would be asserting an authority it does
 * not have — which is the argument {@link renderAdminApplicationManifest}
 * already makes, one artefact over.
 *
 * So this touches exactly two keys and moves nothing else. The alternative was
 * a refusal telling the author to add the entry by hand, and it is rejected for
 * R1.4's reason: the file the entry points at is generated precisely because a
 * mistyped `@source` is silent, and an entry a human maintains beside a file
 * they do not is the same defect one level up.
 *
 * ## Where the subpath goes, and what happens to `files`
 *
 * Immediately before `./package.json` when the map declares one, at the end
 * otherwise — one rule, deterministic, and it keeps the specific-then-wildcard
 * reading order these maps are written in. Node resolves an exact subpath ahead
 * of a `./*` pattern regardless, so position is presentation and not
 * behaviour.
 *
 * `files` is touched **only when the manifest declares one**. A package that
 * declares none packs everything, and adding a one-element list there would
 * silently drop its `dist` from the tarball — a narrow edit that is not narrow
 * at all.
 */
export function renderFamilyStylesheetManifest(
  pkg: TailwindScannablePackage,
  fs: ManifestFs,
): RenderedPackageManifest {
  const manifestPath = join(pkg.dir, 'package.json');
  const text = fs.readText(manifestPath);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${manifestPath} could not be read. It is where the '${TAILWIND_SOURCE_SUBPATH}' subpath ` +
        `is declared, and a package that ships UI and declares none is a package the ` +
        `instance's generated stylesheet cannot import — every utility it contributes is ` +
        `dropped from the host's bundle with no error anywhere.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const declared = manifest['exports'];
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new ModulePackageManifestError(
      `${manifestPath} declares no \`exports\` object, so there is nowhere to publish ` +
        `'${TAILWIND_SOURCE_SUBPATH}'. A package with no exports map publishes nothing a ` +
        `consumer can name, which is a state this reconciliation must not paper over by ` +
        `inventing one.`,
    );
  }
  const entries = Object.entries(declared as Record<string, unknown>).filter(
    ([subpath]) => subpath !== TAILWIND_SOURCE_SUBPATH,
  );
  const declaration: [string, unknown] = [
    TAILWIND_SOURCE_SUBPATH,
    `./${TAILWIND_SOURCE_FILE}`,
  ];
  const before = entries.findIndex(([subpath]) => subpath === './package.json');
  const reconciled = before === -1
    ? [...entries, declaration]
    : [...entries.slice(0, before), declaration, ...entries.slice(before)];
  manifest['exports'] = Object.fromEntries(reconciled);

  const files = manifest['files'];
  if (Array.isArray(files) && !files.includes(TAILWIND_SOURCE_FILE)) {
    manifest['files'] = [...files, TAILWIND_SOURCE_FILE];
  }
  return {
    packageName: pkg.name,
    moduleId: null,
    outputPath: manifestPath,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

/**
 * Every version **the applications** declare, `dependencies` and
 * `devDependencies`, first declaration winning.
 *
 * A module package's peer range is the major of the version this repository
 * actually runs; inventing one ships a package whose peer nothing resolves. So
 * the source is the application that composes the layer — and since feature 091
 * a module has **two** composing applications, not one. `backend` composes
 * `src/backend/`; `admin` composes `src/admin/`, and it is the only member that
 * declares `react`, `react-dom` and `lucide-react`. Reading `backend` alone
 * refused every admin layer at its first `import { useState } from 'react'`,
 * with a message telling the author to add React to the backend.
 *
 * **Which members are applications is derived, not listed**: a workspace entry
 * that is a *literal* directory names one deployable, a *glob* enumerates a
 * library family ({@link classifyWorkspaceMembers}, shared with
 * `check:release-intent` and the distribution gate). So a fifth application
 * joins this derivation by being declared, and a library never does — a
 * library's own dependency ranges are not what a module runs against.
 *
 * **Order is the workspace's own and first declaration wins**, which is what
 * makes the widening additive: every name a manifest resolves today is one
 * `backend` declares, `backend` is the workspace's first entry, so no rendered
 * manifest moves. A name two applications declare at two ranges takes the
 * earlier application's, deterministically, rather than whichever the
 * filesystem happened to hand back first.
 */
export function applicationVersions(
  repoRoot: string,
  fs: ManifestFs,
): ReadonlyMap<string, string> {
  const applications = classifyWorkspaceMembers(repoRoot, fs).members.filter(
    (member) => !member.family,
  );
  if (applications.length === 0) {
    throw new ModulePackageManifestError(
      `${join(repoRoot, 'pnpm-workspace.yaml')} declares no application member — every entry ` +
        `is a glob, so it enumerates library families and nothing that composes a module. ` +
        `The peer range of every module package is the major of the version an application ` +
        `runs, and there is nothing here to read one from.`,
    );
  }
  const found = new Map<string, string>();
  for (const application of applications) {
    for (const block of ['dependencies', 'devDependencies']) {
      const declared = application.manifest[block];
      if (typeof declared !== 'object' || declared === null) continue;
      for (const [name, range] of Object.entries(declared as Record<string, unknown>)) {
        if (typeof range === 'string' && !found.has(name)) found.set(name, range);
      }
    }
  }
  if (found.size === 0) {
    throw new ModulePackageManifestError(
      `${applications.map((member) => member.name).join(', ')} declare no dependency at all, ` +
        `so no peer range could be derived from them.`,
    );
  }
  return found;
}

/**
 * The version a module package that has **no manifest yet** is born at: the
 * platform host's own (D-210). `null` when this workspace has no platform
 * member, which the caller refuses at the point a seed is actually needed.
 *
 * ## Why a seed exists at all, and why it is not a constant
 *
 * A `version` is not derivable from a layer inventory, so this generator
 * **preserves** the one on disk — see {@link versionFor}. A package that has no
 * `package.json` yet has nothing to preserve, and the first render is exactly
 * the run that has to succeed (a module just `git mv`'d into place gets its
 * manifest from this command), so a number has to come from somewhere.
 *
 * It came from the literal `'0.0.0'` until D-210 set 79 manifests to `0.7.0` by
 * hand, whereupon regenerating wanted to reset all 70 module packages and
 * `manifests:check` went red on `master`. The lesson is not that the constant
 * was the wrong number — it is that a release decision written into a generator
 * is a derived fact recorded by hand (D-100), and the *next* release falsifies a
 * new constant exactly as the last one falsified `0.0.0`.
 *
 * ## Why the platform's number is the right seed
 *
 * D-210 releases the platform as one number across every versionable package,
 * because `pnpm pack` rewrites a `workspace:*` range to the **exact** sibling
 * version — so a package born below its siblings is one edit away from pinning a
 * version that will never exist on a registry, and it is a hand edit at release
 * time in a file this generator exists to stop anybody hand-editing. A new
 * module package joins the estate where the estate is.
 *
 * Changesets versions packages **independently** (D-108), so this says nothing
 * about where an *existing* package stands: the seed is a starting point for a
 * package that has never been released, and after that its number is the release
 * process's alone.
 *
 * ## Which member the platform is
 *
 * The one declaring `endora: { "type": "platform" }`, asked through
 * {@link platformPackageNameOf} rather than re-read here: that function is the
 * repository's single author for *"which member is the platform"* and it already
 * refuses a workspace where two members claim it. Going through the name and
 * back to the member costs a lookup and keeps the answer in one place (D-100).
 */
export function platformSeedVersion(
  members: readonly WorkspaceMember[],
): { readonly name: string; readonly version: string | null } | null {
  const name = platformPackageNameOf(members);
  if (name === null) return null;
  const member = members.find((candidate) => candidate.name === name);
  const declared = member?.manifest['version'];
  return {
    name,
    version: typeof declared === 'string' && declared.length > 0 ? declared : null,
  };
}

/**
 * The `repository.url` the workspace root declares — one repository, one URL.
 *
 * A published package's `repository` is what gives a consumer a path from the
 * package page back to the code, and npm makes provenance conditional on it
 * (`check:release-intent`'s `incomplete-public-package`). It is read here rather
 * than written into this generator because the URL is a fact about the remote:
 * a constant would be it recorded a seventy-first time (D-100), and the remote
 * moving would leave every module package pointing at nothing until somebody
 * happened to regenerate.
 *
 * The refusal is at the point of need, like {@link rootNodeEngine}'s: a
 * workspace root that declares no `repository` has no source for the field, and
 * inventing one publishes a link that resolves to somebody else's repository.
 */
export function rootRepositoryUrl(repoRoot: string, fs: ManifestFs): string {
  const path = join(repoRoot, 'package.json');
  const text = fs.readText(path);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${path} could not be read, so the repository a module package points a consumer at ` +
        `has no source.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const repository = manifest['repository'];
  const url =
    typeof repository === 'object' && repository !== null
      ? (repository as Record<string, unknown>)['url']
      : undefined;
  if (typeof url !== 'string' || url.length === 0) {
    throw new ModulePackageManifestError(
      `${path} declares no repository.url, so a module package's \`repository\` would be a ` +
        `URL written down once per package (D-100). Declare it once at the workspace root.`,
    );
  }
  return url;
}

/** The Node engine the workspace root declares — one repository, one floor. */
export function rootNodeEngine(repoRoot: string, fs: ManifestFs): string {
  const path = join(repoRoot, 'package.json');
  const text = fs.readText(path);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${path} could not be read, so the Node engine a module package declares has no source.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const engines = manifest['engines'];
  const node =
    typeof engines === 'object' && engines !== null
      ? (engines as Record<string, unknown>)['node']
      : undefined;
  if (typeof node !== 'string' || node.length === 0) {
    throw new ModulePackageManifestError(
      `${path} declares no engines.node, so a module package's engine floor would be a ` +
        `number written down twice (D-100).`,
    );
  }
  return node;
}

/**
 * The `license` the workspace root declares — the estate's single default.
 *
 * The owner's licensing ruling of 2026-09-06 splits **by package**: the open
 * core is `MIT`, and a paid package carries a proprietary licence spelled
 * `SEE LICENSE IN LICENSE.md`, which is the SPDX form npm and the licence
 * scanners accept. Entitlement is contractual rather than a registry gate, so
 * both kinds publish to the same registry and nothing at runtime reads this
 * field.
 *
 * **Which** modules are paid is a product decision nobody has taken, so this
 * generator renders the default and never a guess: a value invented here would
 * be a licence grant over 70 packages that no owner authorised, and the wrong
 * direction is not symmetric — an accidental `MIT` on a package meant to be
 * paid cannot be withdrawn from whoever already installed it.
 *
 * Read from the root manifest for {@link rootRepositoryUrl}'s reason: a
 * constant here would be the estate's licence recorded a seventy-first time
 * (D-100), and changing the default would then mean regenerating rather than
 * editing one field. The refusal is at the point of need — a workspace root
 * that declares no `license` has no default for a package to inherit, and
 * inventing one is exactly the unauthorised grant above.
 */
export function rootLicense(repoRoot: string, fs: ManifestFs): string {
  const path = join(repoRoot, 'package.json');
  const text = fs.readText(path);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${path} could not be read, so the licence a module package inherits has no source.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const license = manifest['license'];
  if (typeof license !== 'string' || license.trim().length === 0) {
    throw new ModulePackageManifestError(
      `${path} declares no \`license\`, so every module package would publish without one — ` +
        `and a generator that filled the gap would be granting a licence over 70 packages on ` +
        `nobody's authority. Declare the estate's default once at the workspace root.`,
    );
  }
  return license;
}

/**
 * The SPDX expression a module declares for **its own** package, overriding
 * {@link rootLicense}.
 *
 * The spelling is a plain named export beside the manifest —
 * `export const packageLicense = 'SEE LICENSE IN LICENSE.md';` — which is where
 * `installHook`, `uninstallHook` and `cliCommands` already live: facts about a
 * module that the tooling reads from `manifest.ts` and that are deliberately
 * not fields of the runtime manifest. It is **not** the manifest's own
 * `license` field, and that is a decision rather than an oversight: that field
 * is `ModuleLicenseTierSchema` (`'core' | 'pro' | 'enterprise'`), the dead
 * entitlement mechanism D-194 rules should be deleted, and it is published
 * contract surface on `ModuleListItem`. Repurposing it would put two meanings
 * on one name in one file, and deleting it now costs a `major` on
 * `@endora-commerce/contracts` that D-194 priced while every package was still
 * private. Both are the owner's call and neither is this generator's.
 *
 * Read as a **literal AST node**, so a computed value is refused rather than
 * guessed at: a licence this derivation cannot read must not be reported as
 * "this module takes the default" (issue #113), because the default is the
 * permissive one and the silent answer would be the grant.
 */
export function modulePackageLicenseOf(source: string, file: string): string | null {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  let refused = false;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.name.text !== MODULE_LICENSE_EXPORT) continue;
        const value = declaration.initializer;
        if (
          value !== undefined &&
          (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
        ) {
          found = value.text;
        } else {
          refused = true;
        }
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  if (refused) {
    throw new ModulePackageManifestError(
      `${file}: \`${MODULE_LICENSE_EXPORT}\` is not a string literal. A licence this ` +
        `derivation cannot read would fall back to the workspace default, which is the ` +
        `permissive one — so the silent answer is a grant nobody wrote. Declare it as a ` +
        `literal, or delete it and take the default deliberately.`,
    );
  }
  return found;
}

/** The named export {@link modulePackageLicenseOf} reads. */
export const MODULE_LICENSE_EXPORT = 'packageLicense';
