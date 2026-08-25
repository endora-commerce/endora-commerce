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
 *   * **the ranges** — from the application that composes the modules
 *     (`backend/package.json`). A peer takes the major (`^6.6.13` → `^6`), a
 *     `devDependency` takes the range as declared, and a workspace member takes
 *     `workspace:*` (R5). A specifier the application declares nowhere is
 *     refused: inventing a range is how a package ships one nothing resolves.
 *
 * ## What is not derived, and is not emitted either
 *
 * **`peerDependenciesMeta`.** §2 marks it GENERATED "from the layer inventory"
 * and no shipped package carries one. It is vacuous under the rule above and
 * that is structural, not an omission: a peer appears **only** when a source
 * imports it, so a package with no `src/admin/` has no `react` peer to mark
 * optional in the first place. The contract's example — `react` optional
 * because the admin layer may be absent — describes a manifest whose peer list
 * is fixed, which is exactly the hand-written shape this file replaces. The
 * other reading, "optional means imported behind a runtime guard", needs
 * dataflow a specifier walk does not carry, and there is no such import in the
 * tree to calibrate it against. So nothing is emitted and §2 is amended to stop
 * claiming otherwise.
 */
import { readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';

import ts from 'typescript';

import { readEmitLayout, type EmitLayout } from './module-packages.js';
import { namedSpecifiers } from './specifiers.js';
import {
  expandWorkspaceGlob,
  nodeWorkspaceFs,
  workspaceGlobs,
  workspaceMembers,
  workspaceScopes,
  type WorkspaceFs,
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
];

/** What a package ships, as the directory says. */
export interface LayerInventory {
  readonly layers: readonly PackageLayer[];
  readonly hasI18n: boolean;
  readonly hasDocs: boolean;
  readonly hasTests: boolean;
  readonly hasVitestConfig: boolean;
}

/** The root export every module package has: its manifest. */
export const ROOT_ENTRY = 'src/manifest.ts';

/**
 * What a package ships, read off its directory.
 *
 * Three refusals, and each one is a file that would otherwise be published by
 * nothing: a missing root manifest, a directory under `src/` that maps to no
 * subpath, and a mapped directory with no `index.ts` for its subpath to name.
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
  return {
    layers,
    hasI18n: fs.listFiles(join(packageDir, 'i18n')).length > 0,
    hasDocs: fs.listFiles(join(packageDir, 'docs')).length > 0,
    hasTests:
      fs.listFiles(join(packageDir, 'test')).length > 0 ||
      fs.listDirectories(join(packageDir, 'test')).length > 0,
    hasVitestConfig: fs.readText(join(packageDir, 'vitest.config.ts')) !== null,
  };
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
 * Every third-party package the given sources name, as package names.
 *
 * A Node builtin is not a dependency, in either spelling: `isBuiltin` answers
 * for `node:crypto` and for the bare `crypto` all three shipped packages
 * actually write, and asking Node rather than keeping a list is what keeps this
 * right when the next builtin arrives (D-100).
 */
export function peerNamesOf(sources: ReadonlyMap<string, string>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [file, text] of sources) {
    for (const specifier of namedSpecifiers(text, file)) {
      const name = packageNameOf(specifier.text);
      if (name === null) continue;
      names.add(name);
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

// --- rendering -------------------------------------------------------------

/** The fields §2 marks HAND-WRITTEN: read from the existing file, never rewritten. */
const PRESERVED_FIELDS: readonly string[] = ['description', 'dependencies'];

/** Everything this generator writes. A field on neither list is refused. */
const GENERATED_FIELDS: readonly string[] = [
  'name',
  'version',
  'private',
  'type',
  'sideEffects',
  'endora',
  'exports',
  'files',
  'engines',
  'scripts',
  'peerDependencies',
  'devDependencies',
];

/** One package's rendered manifest. */
export interface RenderedPackageManifest {
  readonly packageName: string;
  readonly moduleId: string;
  /** Absolute path of the `package.json` this content belongs at. */
  readonly outputPath: string;
  readonly content: string;
}

/** What one run rendered, and what it read to do it. */
export interface ManifestRenderRun {
  readonly rendered: readonly RenderedPackageManifest[];
  /** Files opened — sources, manifests and build configurations alike. */
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
  const nodeEngine = rootNodeEngine(repoRoot, countingFs);

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

  const rendered = identities.map((identity) => {
    const layers = layerInventoryOf(identity.dir, countingFs);
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
    assertEndoraAgreement(identity.dir, identity.moduleId, identity.name, existing);

    const content = renderManifest({
      packageName: identity.name,
      moduleId: identity.moduleId,
      layers,
      emit,
      imported,
      selfName: identity.name,
      modulePackageNames,
      workspaceNames,
      versions,
      nodeEngine,
      existing,
      manifestSource: identity.manifestSource,
      manifestFile: join(identity.dir, ROOT_ENTRY),
    });
    return {
      packageName: identity.name,
      moduleId: identity.moduleId,
      outputPath: join(identity.dir, 'package.json'),
      content,
    };
  });

  const indexSource =
    manifestIndexPath === undefined ? null : readText(manifestIndexPath);
  if (manifestIndexPath !== undefined && indexSource === null) {
    throw new ModulePackageManifestError(
      `${manifestIndexPath} could not be read. It is the independent derivation this run is ` +
        `reconciled against; without it a short walk is indistinguishable from a clean one.`,
    );
  }

  return {
    rendered,
    filesRead,
    specifierSites,
    registeredPackageNames:
      indexSource === null ? [] : registeredPackageNamesIn(indexSource),
  };
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

interface RenderInput {
  readonly packageName: string;
  readonly moduleId: string;
  readonly layers: LayerInventory;
  readonly emit: EmitLayout;
  readonly imported: ReadonlySet<string>;
  readonly selfName: string;
  readonly modulePackageNames: ReadonlySet<string>;
  readonly workspaceNames: ReadonlySet<string>;
  readonly versions: ReadonlyMap<string, string>;
  readonly nodeEngine: string;
  readonly existing: Readonly<Record<string, unknown>> | null;
  readonly manifestSource: string;
  readonly manifestFile: string;
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

/** The whole file, as text. */
export function renderManifest(input: RenderInput): string {
  const exportsMap: Record<string, unknown> = {
    '.': conditionsFor(input.emit, ROOT_ENTRY),
  };
  for (const layer of input.layers.layers) {
    exportsMap[layer.subpath] = conditionsFor(input.emit, layer.entry);
  }
  // R1 — discovery reads `<pkg>/package.json` for the `endora` field; omitting
  // it is ERR_PACKAGE_PATH_NOT_EXPORTED at runtime and TS2307 at compile time.
  exportsMap['./package.json'] = './package.json';

  const peers = new Map<string, string>();
  const devs = new Map<string, string>();
  for (const name of [...input.imported].sort(byAscii)) {
    if (name === input.selfName) continue;
    if (input.modulePackageNames.has(name)) {
      throw new ModulePackageManifestError(
        `${input.packageName} imports ${name}, another module package. R4: a module reaches ` +
          `another through a port declared in its manifest \`dependencies\`, never through ` +
          `npm — a package edge is one the lifecycle, the migration order and an operator ` +
          `switching the owner off all know nothing about.`,
      );
    }
    if (input.workspaceNames.has(name)) {
      // R5 — `pnpm pack` rewrites `workspace:*` to the exact version, so this
      // source needs no change when versions become real.
      peers.set(name, 'workspace:*');
      devs.set(name, 'workspace:*');
      continue;
    }
    const declared = input.versions.get(name);
    if (declared === undefined) {
      throw new ModulePackageManifestError(
        `${input.packageName} imports '${name}', which the application declares nowhere. The ` +
          `peer range is the major of the version this repository actually runs; inventing ` +
          `one ships a package whose peer nothing resolves. Add it to backend/package.json ` +
          `first, with the justification Constitution IV requires.`,
      );
    }
    const major = majorOf(declared);
    if (major === null) {
      throw new ModulePackageManifestError(
        `${input.packageName}: the application declares '${name}' as '${declared}', which has ` +
          `no readable major version, so the peer range cannot be derived from it.`,
      );
    }
    peers.set(name, `^${major}`);
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
    const types = typesPackageFor(name);
    const typesDeclared = input.versions.get(types);
    if (typesDeclared !== undefined) devs.set(types, typesDeclared);
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

  const scripts: Record<string, string> = {
    build: 'tsc -p tsconfig.build.json',
    typecheck: 'tsc -p tsconfig.json',
    lint: input.layers.hasTests ? 'eslint src test' : 'eslint src',
  };
  if (input.layers.hasVitestConfig) scripts['test'] = 'vitest run --passWithNoTests';

  const files = [input.emit.outDir === '' ? 'dist' : input.emit.outDir];
  if (input.layers.hasI18n) files.push('i18n');
  if (input.layers.hasDocs) files.push('docs');

  const manifest = {
    name: input.packageName,
    // R6 — `0.0.0` and `private` until full F4; `pnpm pack` still works.
    version: '0.0.0',
    private: true,
    type: 'module',
    sideEffects: false,
    description: descriptionFor(input),
    endora: { type: 'module', id: input.moduleId },
    exports: exportsMap,
    files,
    engines: { node: input.nodeEngine },
    scripts,
    peerDependencies: Object.fromEntries(sortedByAscii(peers)),
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
 * The one field §2 marks HAND-WRITTEN.
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

/** Every version the application declares, `dependencies` and `devDependencies`. */
export function applicationVersions(
  repoRoot: string,
  fs: ManifestFs,
): ReadonlyMap<string, string> {
  const path = join(repoRoot, 'backend', 'package.json');
  const text = fs.readText(path);
  if (text === null) {
    throw new ModulePackageManifestError(
      `${path} could not be read. It is where the version of every framework a module can ` +
        `peer on is declared, so without it every peer range would have to be invented.`,
    );
  }
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const found = new Map<string, string>();
  for (const block of ['dependencies', 'devDependencies']) {
    const declared = manifest[block];
    if (typeof declared !== 'object' || declared === null) continue;
    for (const [name, range] of Object.entries(declared as Record<string, unknown>)) {
      if (typeof range === 'string' && !found.has(name)) found.set(name, range);
    }
  }
  if (found.size === 0) {
    throw new ModulePackageManifestError(
      `${path} declares no dependency at all, so no peer range could be derived from it.`,
    );
  }
  return found;
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
