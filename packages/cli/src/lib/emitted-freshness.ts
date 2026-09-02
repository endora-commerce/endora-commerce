/**
 * "Is the artefact this run read still the one its source says it is?"
 *
 * ## The defect
 *
 * A module package resolves through its own `exports` map at `./dist`
 * (D-164), so a check that imports a module's manifest by its bare specifier
 * reads `dist/manifest.js` and never opens `src/manifest.ts`. `tsc` is the
 * exception in this repository — `tsconfig.base.json`'s `paths` keeps it on the
 * packages' source — and every runtime (`node`, `tsx`, `vitest`, `vite`) is not.
 * So an author who edits a package's source and runs a check gets an answer
 * about the **previous build**, and the answer is green.
 *
 * Measured three consecutive times on feature
 * `specs/091-module-owned-admin-surfaces/`'s admin drain, most sharply on
 * !1203: changing one action's `requiredPermission` in
 * `packages/modules/payu/src/manifest.ts` left
 * `check:action-route-permissions` at `findings=3 violations=0`, exit 0; the
 * same tree after `pnpm --filter @endora-commerce/mod-payu run build` was
 * `findings=4 violations=1`, exit 1. Nothing in the run said which of the two
 * files it had read.
 *
 * ## Why exit 2 and not 1
 *
 * The tree is not in violation — the check could not see it. That is issue
 * #113's rule verbatim ("a green result must not be able to mean 'not
 * looking'") and its exit code is 2, distinct from both "clean" and "found
 * something". A warning printed beside `violations=0` would be the same false
 * green with prose on it.
 *
 * ## What it compares, and what it does not
 *
 * The subject is **the file whose bytes the run read**, never "this package's
 * `dist`" in general. A run that read a package's *sources* — a fixture whose
 * registry names `src/manifest.ts`, a package that declares no build — has no
 * staleness question to answer, and this derivation says so rather than
 * refusing a tree it was not looking at. Everything is read off the package's
 * own declarations: `exports` for where a bare specifier lands,
 * `tsconfig.build.json`'s `rootDir`/`outDir` (through
 * {@link readEmitLayout}, following a relative `extends`) for how a source
 * becomes an artefact. No path is written down here — `packages/modules` and
 * `dist` appear in no predicate (D-100).
 *
 * The comparison is **mtime**, and the direction is the one that fails safe: an
 * artefact is stale when its source is *strictly* newer. A build writes its
 * outputs after reading its inputs, so a freshly built package is never
 * reported; a source touched afterwards always is, whether or not its content
 * changed. Content is not available to compare — `tsc` emits no
 * `sourcesContent` in this repository's build configuration — and the remedy
 * (`pnpm run build:packages`) is cheap, so the tolerable error is the one that
 * asks for a rebuild that turns out to be a no-op.
 *
 * Stated rather than discovered later, this cannot see: a package whose build
 * is incremental and left one output untouched while rewriting another (the
 * comparison is per file, so the untouched output is judged on its own mtime,
 * which is correct); an artefact emitted from something other than a
 * TypeScript source under `rootDir` (reported as `unpairable-artefact`, not
 * skipped); and anything about a package the run never read.
 */
import { statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { readEmitLayout, declaredExports, type EmitLayout } from './module-packages.js';
import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
} from './workspace-packages.js';

/** A workspace member that compiles its sources into a separate directory. */
export interface EmittingPackage {
  /** The npm package name — the head of every bare specifier into it. */
  readonly name: string;
  /** Its directory, absolute. */
  readonly dir: string;
  /** `tsconfig.build.json`'s `rootDir`/`outDir`, package-relative. */
  readonly emit: EmitLayout;
  /** `exports` subpath → target, as declared. Wildcard subpaths are dropped. */
  readonly exports: ReadonlyMap<string, string>;
}

/**
 * Every workspace member that emits, whatever it declares itself to be.
 *
 * Not filtered to `endora.type === 'module'`: `@endora-commerce/platform` emits
 * too, and `_lifecycle`'s manifest is one of the artefacts a manifest-index
 * reader imports out of it (D-160.11). A member with no `tsconfig.build.json`
 * publishes its sources where they are and is not one of these.
 */
export function emittingPackages(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): readonly EmittingPackage[] {
  const found: EmittingPackage[] = [];
  for (const member of workspaceMembers(repoRoot, fs)) {
    const emit = readEmitLayout(member.dir, member.name, fs);
    if (emit === null) continue;
    found.push({
      name: member.name,
      dir: member.dir,
      emit,
      exports: declaredExports(member.manifest),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** The two filesystem questions this derivation asks, injected for fixtures. */
export interface FreshnessFs {
  /** Modification time in milliseconds, or `null` when the file is not there. */
  readonly mtimeMs: (absolutePath: string) => number | null;
}

/** The real one. A file that is not there answers `null`, never a throw. */
export function nodeFreshnessFs(): FreshnessFs {
  return {
    mtimeMs: (path: string): number | null => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

/** A file's path inside its package, `/`-separated. */
function packageRelative(pkg: EmittingPackage, absolutePath: string): string {
  return relative(pkg.dir, absolutePath).split(sep).join('/');
}

/** Is `candidate` inside `dir`? Both absolute. */
function contains(dir: string, candidate: string): boolean {
  const within = relative(dir, candidate);
  return within !== '' && !within.startsWith('..') && !within.startsWith(sep + '..');
}

/** The package a file belongs to, or `null` outside every emitting package. */
export function packageHolding(
  file: string,
  packages: readonly EmittingPackage[],
): EmittingPackage | null {
  let best: EmittingPackage | null = null;
  for (const pkg of packages) {
    if (!contains(pkg.dir, file)) continue;
    // Deepest wins, so a package nested inside another member's directory is
    // attributed to itself.
    if (best === null || pkg.dir.length > best.dir.length) best = pkg;
  }
  return best;
}

/** `./dist/manifest.js` → absolute; `null` when the package declares no root export. */
export function rootExportOf(pkg: EmittingPackage): string | null {
  const target = pkg.exports.get('.');
  if (target === undefined) return null;
  return join(pkg.dir, ...target.replace(/^\.\//, '').split('/'));
}

/**
 * The file a run's recorded location really names.
 *
 * A registry that imported a module by **bare** specifier records the package's
 * `package.json` as the module's location (`manifest-locations.ts`: that is the
 * anchor every consumer takes `dirname` of). The bytes it read are the root
 * `exports` target, so the location is followed one hop to it. Every other path
 * names itself.
 */
export function readArtefactOf(
  named: string,
  packages: readonly EmittingPackage[],
): string {
  if (!named.endsWith(`${sep}package.json`)) return named;
  const pkg = packages.find((candidate) => join(candidate.dir, 'package.json') === named);
  if (pkg === undefined) return named;
  return rootExportOf(pkg) ?? named;
}

/** The emitted extensions `tsc` writes, and the sources each can come from. */
const SOURCE_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

/**
 * The source an emitted file was compiled from, or `null` when none exists.
 *
 * The inverse of `module-packages.ts`' {@link emittedPathOf}, and deliberately
 * existence-checked rather than assumed: `.js` has two possible sources and a
 * guess between them would name a file that is not there.
 */
export function sourceOfEmitted(
  pkg: EmittingPackage,
  emitted: string,
  fs: FreshnessFs,
): string | null {
  const within = packageRelative(pkg, emitted);
  const prefix = pkg.emit.outDir === '' ? '' : `${pkg.emit.outDir}/`;
  if (prefix !== '' && !within.startsWith(prefix)) return null;
  const belowOut = within.slice(prefix.length);
  for (const [emittedExtension, sourceExtensions] of SOURCE_EXTENSIONS) {
    if (!belowOut.endsWith(emittedExtension)) continue;
    const stem = belowOut.slice(0, -emittedExtension.length);
    for (const extension of sourceExtensions) {
      const relativeSource =
        pkg.emit.rootDir === '' ? `${stem}${extension}` : `${pkg.emit.rootDir}/${stem}${extension}`;
      const absolute = join(pkg.dir, ...relativeSource.split('/'));
      if (fs.mtimeMs(absolute) !== null) return absolute;
    }
  }
  return null;
}

/** Whether a file the run read is emitted output, its own source, or neither. */
export type ArtefactOrigin = 'emitted' | 'source' | 'outside';

export function originOf(
  artefact: string,
  pkg: EmittingPackage | null,
): ArtefactOrigin {
  if (pkg === null) return 'outside';
  const within = packageRelative(pkg, artefact);
  const out = pkg.emit.outDir;
  if (out === '' || within === out || within.startsWith(`${out}/`)) return 'emitted';
  return 'source';
}

export type FreshnessFindingKind = 'stale-artefact' | 'unpairable-artefact';

export interface FreshnessFinding {
  readonly kind: FreshnessFindingKind;
  readonly packageName: string;
  /** The emitted file the run read, absolute. */
  readonly artefact: string;
  /** The source it is emitted from, absolute; `null` for `unpairable-artefact`. */
  readonly source: string | null;
  /** The sentence the operator reads, without the shared remedy. */
  readonly detail: string;
}

export interface FreshnessInput {
  /** The locations a run recorded for what it read, absolute. */
  readonly read: readonly string[];
  readonly packages: readonly EmittingPackage[];
  readonly fs?: FreshnessFs;
}

export interface FreshnessResult {
  readonly findings: readonly FreshnessFinding[];
  /** The artefacts classified as emitted output — what the disclosure counts. */
  readonly emitted: readonly string[];
  /** Those paired with a source and actually compared. */
  readonly compared: readonly string[];
}

/**
 * Every emitted artefact this run read that its source has since outrun.
 *
 * Pure over the record handed in, so a red proof enters where a real run
 * enters (issue #130): a synthetic checkout on disk, or an injected clock.
 */
export function checkEmittedFreshness(input: FreshnessInput): FreshnessResult {
  const fs = input.fs ?? nodeFreshnessFs();
  const findings: FreshnessFinding[] = [];
  const emitted: string[] = [];
  const compared: string[] = [];

  for (const named of [...new Set(input.read)].sort()) {
    const artefact = readArtefactOf(named, input.packages);
    const pkg = packageHolding(artefact, input.packages);
    if (originOf(artefact, pkg) !== 'emitted' || pkg === null) continue;
    emitted.push(artefact);

    const artefactMtime = fs.mtimeMs(artefact);
    if (artefactMtime === null) {
      findings.push({
        kind: 'unpairable-artefact',
        packageName: pkg.name,
        artefact,
        source: null,
        detail: 'the emitted file is not on disk, so what this run read is not what the tree holds',
      });
      continue;
    }
    const source = sourceOfEmitted(pkg, artefact, fs);
    if (source === null) {
      findings.push({
        kind: 'unpairable-artefact',
        packageName: pkg.name,
        artefact,
        source: null,
        detail:
          `no TypeScript source under ${pkg.emit.rootDir || '.'} emits it, so whether it is ` +
          'current cannot be decided — and an artefact that cannot be decided must not be ' +
          'reported as current',
      });
      continue;
    }
    compared.push(artefact);
    const sourceMtime = fs.mtimeMs(source);
    if (sourceMtime !== null && sourceMtime > artefactMtime) {
      findings.push({
        kind: 'stale-artefact',
        packageName: pkg.name,
        artefact,
        source,
        detail: 'its source has been modified since it was emitted',
      });
    }
  }

  return { findings, emitted, compared };
}

/**
 * The refusal as a reader sees it, or `null` when there is nothing to refuse.
 *
 * Separated from {@link refuseStaleEmittedArtefacts} for the reason
 * `read-size.ts` separates its two halves: a proof that constructed the message
 * would prove the formatting and leave the predicate unproven.
 */
export function freshnessRefusal(
  prefix: string,
  result: FreshnessResult,
  displayOf: (absolutePath: string) => string = (path) => path,
): string | null {
  if (result.findings.length === 0) return null;
  const lines = [
    `${prefix} this run read a package artefact that its source has outrun, so a clean ` +
      'result would mean "not looking" rather than "nothing wrong" (issue #113). A package ' +
      'resolves through its own `exports` map at its build output, so an edit to its source ' +
      'is invisible until the package is built.',
    '',
    'Run `pnpm run build:packages` (or build the named package) and run this check again.',
    '',
  ];
  for (const finding of result.findings) {
    lines.push(
      `  - [${finding.kind}] ${finding.packageName}`,
      `      read:   ${displayOf(finding.artefact)}`,
      `      source: ${finding.source === null ? '(none)' : displayOf(finding.source)}`,
      `      why:    ${finding.detail}`,
    );
  }
  return lines.join('\n');
}

/**
 * The CLI half: refuse and exit 2, or return.
 *
 * Exit 2 rather than 1 deliberately — see this file's header. The tree is not
 * in violation; the check was reading the previous build.
 */
export function refuseStaleEmittedArtefacts(
  prefix: string,
  result: FreshnessResult,
  displayOf?: (absolutePath: string) => string,
): void {
  const message = freshnessRefusal(prefix, result, displayOf);
  if (message === null) return;
  console.error(message);
  process.exit(2);
}
