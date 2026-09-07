/**
 * Which packages ship scannable UI, and what their own `./tailwind.css` says
 * (`specs/110-instance-repository/contracts/admin-stylesheet-composition.md`,
 * R1 and R2.2; FR-023).
 *
 * ## The defect, stated once
 *
 * `admin/src/index.css` reached every package's UI with
 * `@source "../../packages/**"`. In this repository that is correct; in a
 * client's instance it names a directory that is not there, because under D-207
 * the shell and the module packages are **installed**. Tailwind emits no
 * diagnostic for a source that matches nothing (§1, M12), so the instance's
 * admin would build green and render every screen unstyled.
 *
 * The repair inverts the direction: a package names **its own** layers, in a
 * stylesheet it publishes at `./tailwind.css`, and the host imports it by name.
 * That converts the two silent failures into build errors — an undeclared
 * subpath is `ERR_PACKAGE_PATH_NOT_EXPORTED` (M9) and a missing package is
 * `Can't resolve` (M10) — and `@source` resolves relative to the stylesheet
 * that declares it (M7), so the package needs to know nothing about where it
 * was installed.
 *
 * ## Why this derivation is shared rather than repeated
 *
 * Three programs need one answer to *"does this package ship scannable UI, and
 * where"*: `manifests:generate` renders the stylesheet and its `exports`/`files`
 * entries (R1.4), `composer:generate` renders `admin/src/tailwind.generated.css`
 * over the packages that declare the subpath (R2.1), and the guard
 * (`scripts/tailwind-source-scan.ts`) plants a probe in each directory and
 * asserts the compiled stylesheet carries it (T125). Two derivations of one
 * population are two answers waiting to disagree, and the disagreement here is
 * invisible: the stylesheet would name a directory the guard never probes, or
 * the guard would probe a directory nothing declares.
 *
 * ## What decides the population, and what does not
 *
 * Nothing here names a package. R4.3 asks *"do this package's components take
 * the host's design tokens?"*, and the answer a program can read is the subpath
 * the package **declares**: a package that publishes a finished stylesheet at
 * `./styles.css` compiled its own CSS and the host imports the bytes (R4.2), so
 * it is excluded — that is the whole of `cms-components`' exclusion, derived
 * rather than written down (D-100).
 *
 * Beyond that exclusion there are two shapes of scannable package and the
 * package's own `endora` block says which:
 *
 *  * a **module package** ships UI in its declared UI layers, and only there
 *    (R1.2) — `src/admin/` and `src/admin-ui/`, the same inventory that decides
 *    whether it declares `./admin`;
 *  * a **library family member** whose whole build is UI (R1.3) declares its
 *    whole `src` and its whole emit directory, because it has no layer
 *    structure to narrow to.
 *
 * A family member ships scannable UI iff it ships a `.tsx` source: that is a
 * fact about what is in the package rather than a name, and it fails in the safe
 * direction — a package that grows a React component grows its declaration in
 * the same regeneration. Reading `react` out of `peerDependencies` would answer
 * the same for this tree and would be a **generated** manifest field answering a
 * question that decides another generated field, which is a derivation reading
 * its own output.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readEmitLayout, type EmitLayout } from './module-packages.js';
import {
  classifyWorkspaceMembers,
  nodeWorkspaceFs,
  type WorkspaceFs,
  type WorkspaceMember,
} from './workspace-packages.js';
import { UI_LAYER_DIRECTORIES } from './ui-layer.js';

/** The subpath a package publishes its own `@source` declarations at (R1.1). */
export const TAILWIND_SOURCE_SUBPATH = './tailwind.css';

/**
 * The generated stylesheet the host imports, beside the admin contribution
 * registry (R2.1/R2.5).
 *
 * It sits in the admin project's own source root — found through the `"@/*"`
 * tsconfig alias, like every other admin derivation — so an instance's copy
 * lands in the client's tree and this repository's lands in `admin/src/`. In an
 * instance it is a **build input** rather than a committed file (R2.4): which
 * packages were installed is a fact about the process. Here it is committed and
 * held to `overlay:check`'s four verdicts, which is R7.6 — a shape we cannot
 * adopt ourselves is one we may not ask a client for, and it is what makes our
 * own admin build the instance's mechanism on every pipeline.
 */
export const TAILWIND_REGISTRY_ARTEFACT = 'tailwind.generated.css';

/** The file that subpath names, at the package root beside `package.json`. */
export const TAILWIND_SOURCE_FILE = 'tailwind.css';

/**
 * The subpath a package publishes a **finished** stylesheet at (R4.2).
 *
 * A package declaring it is excluded from R1: the host imports its bytes and
 * must not also scan it, which R4.4 measures as three unprefixed utilities
 * emitted into the admin bundle for a component whose every class is prefixed.
 */
export const PREBUILT_STYLESHEET_SUBPATH = './styles.css';

/** One directory a package asks the host to scan, both spellings (R1.2). */
export interface TailwindScannableLayer {
  /** Package-relative, POSIX: what the build emits — `dist/admin`, or `dist`. */
  readonly emitted: string;
  /** Package-relative, POSIX: the sources that emit it — `src/admin`, or `src`. */
  readonly source: string;
}

/** A package that ships scannable UI, and the layers it declares. */
export interface TailwindScannablePackage {
  readonly name: string;
  /** Absolute package directory. */
  readonly dir: string;
  /** `true` when the package's own `endora` block declares it a module. */
  readonly isModule: boolean;
  /** Sorted, non-empty: a package with no layer is not in this population. */
  readonly layers: readonly TailwindScannableLayer[];
}

/** Raised when a package's scannable layers cannot be derived. Never a guess. */
export class TailwindSourceError extends Error {
  override readonly name = 'TailwindSourceError';
}

/** Does this member's own `endora` block declare it a module package? */
function declaresModule(member: WorkspaceMember): boolean {
  const endora = member.manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return false;
  return (endora as Record<string, unknown>)['type'] === 'module';
}

/** The `exports` map a member declares, as a plain record. */
function exportsOf(member: WorkspaceMember): Record<string, unknown> {
  const declared = member.manifest['exports'];
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return {};
  return declared as Record<string, unknown>;
}

/** Does this member publish a finished stylesheet, and therefore owe no sources (R4.2)? */
export function shipsPrebuiltStylesheet(member: WorkspaceMember): boolean {
  return exportsOf(member)[PREBUILT_STYLESHEET_SUBPATH] !== undefined;
}

/** Does this member declare `./tailwind.css` — R2.1's predicate, read off the map? */
export function declaresTailwindSources(member: WorkspaceMember): boolean {
  return exportsOf(member)[TAILWIND_SOURCE_SUBPATH] !== undefined;
}

/**
 * `src/admin` → `dist/admin`, and `src` → `dist`, through the package's own
 * build declaration.
 *
 * The whole-root case is the one worth naming: `tsc` emits a file at
 * `rootDir/x` to `outDir/x`, so the *root itself* maps to `outDir` and not to
 * `outDir/rootDir`. Getting it wrong is silent in the direction this whole
 * contract is about — `@source "./dist/src"` names a directory that is not
 * there, which Tailwind skips without a word (M12).
 */
function emittedDirectoryOf(emit: EmitLayout, sourceDirectory: string): string {
  const prefix = emit.rootDir === '' ? '' : `${emit.rootDir}/`;
  const within =
    sourceDirectory === emit.rootDir
      ? ''
      : sourceDirectory.startsWith(prefix)
        ? sourceDirectory.slice(prefix.length)
        : sourceDirectory;
  if (within === '') return emit.outDir === '' ? '.' : emit.outDir;
  return emit.outDir === '' ? within : `${emit.outDir}/${within}`;
}

/** Does a directory hold a `.tsx` file, at any depth? */
function holdsComponent(directory: string, fs: WorkspaceFs, listFiles: FileLister): boolean {
  if (listFiles(directory).some((name) => name.endsWith('.tsx'))) return true;
  return fs
    .listDirectories(directory)
    .some((name) => holdsComponent(join(directory, name), fs, listFiles));
}

/** Immediate file names in a directory, or `[]` when it is absent. */
export type FileLister = (path: string) => readonly string[];

/**
 * The layers a package asks the host to scan, given the source directories its
 * inventory holds and the build layout it declares.
 *
 * Exported because the manifest generator has already read both — it renders
 * every `exports` target through the same {@link EmitLayout} — and asking the
 * filesystem a second time there would be a second answer to *"which layers
 * does this package publish"*, in the one file whose whole job is that
 * question.
 */
export function scannableLayersFrom(
  sourceDirectories: readonly string[],
  emit: EmitLayout,
): readonly TailwindScannableLayer[] {
  return sourceDirectories.map((source) => ({
    emitted: emittedDirectoryOf(emit, source),
    source,
  }));
}

/**
 * The layers one member asks the host to scan, or `[]` when it ships no UI.
 *
 * @throws TailwindSourceError when a member that ships UI declares no build
 * layout: the emitted half of every declaration is read out of
 * `tsconfig.build.json`, and guessing `dist` would be the one spelling this
 * whole mechanism exists to stop a host from writing (§4(b)).
 */
export function scannableLayersOf(
  member: WorkspaceMember,
  fs: WorkspaceFs,
  listFiles: FileLister,
): readonly TailwindScannableLayer[] {
  // R4.2, and it is asked first: a package that publishes finished CSS owes no
  // source declaration whatever else it ships.
  if (shipsPrebuiltStylesheet(member)) return [];

  const sourceDirectories = declaresModule(member)
    ? moduleUiSourceDirectories(member.dir, fs)
    : holdsComponent(join(member.dir, 'src'), fs, listFiles)
      ? ['src']
      : [];
  if (sourceDirectories.length === 0) return [];

  const emit = readEmitLayout(member.dir, member.name, fs);
  if (emit === null) {
    throw new TailwindSourceError(
      `${member.name} ships scannable UI (${sourceDirectories.join(', ')}) and declares no ` +
        `tsconfig.build.json. Its \`@source\` lines name what the build emits, and where a ` +
        `build puts its output is not something this derivation may assume — writing 'dist' ` +
        `here would be the host naming a directory inside a package, which is exactly the ` +
        `silent failure (M12) R1 exists to remove.`,
    );
  }
  return scannableLayersFrom(sourceDirectories, emit);
}

/** The UI layers a module package's `src/` holds, in {@link UI_LAYER_DIRECTORIES} order. */
export function moduleUiSourceDirectories(
  packageDir: string,
  fs: WorkspaceFs,
): readonly string[] {
  const present = fs.listDirectories(join(packageDir, 'src'));
  return UI_LAYER_DIRECTORIES.filter((layer) => present.includes(layer)).map(
    (layer) => `src/${layer}`,
  );
}

/**
 * Every workspace member that ships scannable UI, sorted by package name.
 *
 * The sort is the artefact's order (R2.1) and the guard's, so a package moving
 * in the workspace globs does not reorder either.
 *
 * **The population is the library family, never an application.** The split is
 * `classifyWorkspaceMembers`' — a glob workspace entry enumerates a family, a
 * literal names one deployable — and it is the right one here for the reason
 * R2.3 gives: an application's own sources are covered by Tailwind's automatic
 * detection, rooted at the project it builds, so it neither needs nor could
 * publish a `./tailwind.css`. It also publishes nothing at all, which is what
 * makes an `exports` entry there meaningless.
 */
export function tailwindScannablePackages(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
  listFiles: FileLister = nodeFileLister(),
): readonly TailwindScannablePackage[] {
  const found: TailwindScannablePackage[] = [];
  for (const member of classifyWorkspaceMembers(repoRoot, fs).members) {
    if (!member.family) continue;
    const layers = scannableLayersOf(member, fs, listFiles);
    if (layers.length === 0) continue;
    found.push({
      name: member.name,
      dir: member.dir,
      isModule: declaresModule(member),
      layers,
    });
  }
  return found.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/** The real filesystem behind {@link FileLister}. Absence is `[]`, never a throw. */
export function nodeFileLister(): FileLister {
  return (path: string): readonly string[] => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  };
}

/**
 * One package's `./tailwind.css`, rendered (R1.2).
 *
 * Two lines per layer, the emitted one first. The `src` line is inert in a
 * published tarball, which ships no `src` — a missing `@source` directory is
 * skipped rather than an error (M12) — and it is there so that this
 * repository's own `pnpm --filter admin run dev` keeps scanning source and does
 * not need a package rebuild to see a class, which is the one property the glob
 * it replaces had.
 *
 * The file is generated rather than written by hand for the reason M12 states:
 * a mistyped `@source` is silent, and the remedy for a silent path is that no
 * human types it.
 */
export function renderTailwindStylesheet(pkg: TailwindScannablePackage): string {
  const lines = [
    `/* ${pkg.name} — AUTO-GENERATED by \`pnpm --filter backend run manifests:generate\`.`,
    ` *`,
    ` * The \`@source\` directives this package asks its host to scan`,
    ` * (\`specs/110-instance-repository/contracts/admin-stylesheet-composition.md\` R1).`,
    ` * They resolve relative to **this file**, so they hold wherever the package is`,
    ` * installed — a workspace link here, \`node_modules\` in a client's instance.`,
    ` *`,
    ` * The \`dist\` line is what a published tarball ships and is what an instance`,
    ` * scans; the \`src\` line is inert there and is what keeps \`pnpm --filter admin`,
    ` * run dev\` reading source in this repository. Do not edit: run`,
    ` * \`pnpm --filter backend run manifests:generate\`.`,
    ` */`,
  ];
  for (const layer of pkg.layers) {
    lines.push(`@source "./${layer.emitted}";`);
    lines.push(`@source "./${layer.source}";`);
  }
  return `${lines.join('\n')}\n`;
}

/** Where one package's stylesheet lands: the package root, beside `package.json`. */
export function tailwindStylesheetPathOf(pkg: TailwindScannablePackage): string {
  return join(pkg.dir, TAILWIND_SOURCE_FILE);
}
