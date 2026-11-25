import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * A compiled overlay is judged against its sources before anything is imported
 * (`specs/190-overlay-full-modules/` FR-015, `data-model.md` §5, contract
 * `overlay-build.md` §4, #1848).
 *
 * Since overlay modules are compiled (`endora build overlays`), a process can run a
 * `backend/dist/apps` that no longer matches `apps/`: an edit not rebuilt, a module added
 * and never built, a module deleted whose `.js` is still there. Each of those boots — the
 * loader imports what it finds — and runs code that is not the code on disk. So every
 * process that resolves overlay modules from a compiled tree, given the source root,
 * compares the two first and refuses on any pair that is not `fresh`, naming both paths
 * and the rebuild command.
 *
 * The pairing, per deployment `d`: `S/apps/d/modules/<id>/<p>.ts` ↔ `R/apps/d/modules/<id>/<p>.js`,
 * and a deployment-level `S/apps/d/<f>.ts` ↔ `R/apps/d/<f>.js`. Not paired: `admin/**` (the
 * admin build's), tests, declarations, source maps and runtime assets (re-copied by every
 * build, never judged here).
 */

export type FreshnessVerdict = 'fresh' | 'stale' | 'unbuilt' | 'orphan';

export interface FreshnessPair {
  readonly verdict: FreshnessVerdict;
  /** The source file; `null` for an `orphan`. */
  readonly source: string | null;
  /** The emitted file; `null` for an `unbuilt` source. */
  readonly emitted: string | null;
}

export interface OverlayRoots {
  /** The compiled tree: holds `apps/` as the processes import it. */
  readonly deploymentRoot: string;
  /** The sources: holds `apps/` as it was written. Absent: nothing is compared. */
  readonly deploymentSourceRoot?: string | undefined;
}

export class OverlayBuildError extends Error {
  override readonly name = 'OverlayBuildError';
  readonly pairs: readonly FreshnessPair[];

  constructor(pairs: readonly FreshnessPair[], rebuild: string) {
    const lines = pairs.map((pair) =>
      pair.verdict === 'orphan'
        ? `  - [orphan] ${String(pair.emitted)} has no source`
        : pair.verdict === 'unbuilt'
          ? `  - [unbuilt] ${String(pair.source)} was never compiled`
          : `  - [stale] ${String(pair.source)} is newer than ${String(pair.emitted)}`,
    );
    super(
      `[overlay] the compiled overlay modules do not match their sources ` +
        `(${String(pairs.length)} file(s)):\n${lines.join('\n')}\n` +
        'A process would import code that is not the code on disk. Nothing was composed.\n' +
        `Rebuild: ${rebuild}`,
    );
    this.pairs = pairs;
  }
}

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

function isSourceUnit(rel: string): boolean {
  return rel.endsWith('.ts') && !rel.endsWith('.d.ts') && !/\.(?:test|spec)\.ts$/.test(rel);
}

function isEmittedUnit(rel: string): boolean {
  return rel.endsWith('.js') && !/\.(?:test|spec)\.js$/.test(rel);
}

/** Files under `dir`, relative to it, posix; `admin/` under a module and `node_modules` skipped. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(current, name);
      let isDirectory: boolean;
      try {
        isDirectory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      const rel = toPosix(relative(dir, full));
      if (isDirectory) {
        if (name === 'node_modules' || /^modules\/[^/]+\/admin$/.test(rel)) continue;
        walk(full);
      } else {
        out.push(rel);
      }
    }
  };
  walk(dir);
  return out;
}

function mtimeOf(path: string): number {
  return statSync(path).mtimeMs;
}

/** Every unit pair of one deployment, sorted by path. */
export function overlayFreshness(roots: OverlayRoots, deployment: string): FreshnessPair[] {
  const source = roots.deploymentSourceRoot;
  if (source === undefined) return [];
  const sourceDir = join(source, 'apps', deployment);
  const compiledDir = join(roots.deploymentRoot, 'apps', deployment);
  const sources = new Set(filesUnder(sourceDir).filter(isSourceUnit));
  const emitted = new Set(filesUnder(compiledDir).filter(isEmittedUnit));

  const pairs: Array<FreshnessPair & { readonly key: string }> = [];
  for (const rel of sources) {
    const out = `${rel.slice(0, -'.ts'.length)}.js`;
    const sourcePath = join(sourceDir, rel);
    if (!emitted.has(out)) {
      pairs.push({ key: rel, verdict: 'unbuilt', source: sourcePath, emitted: null });
      continue;
    }
    const emittedPath = join(compiledDir, out);
    const verdict = mtimeOf(sourcePath) > mtimeOf(emittedPath) ? 'stale' : 'fresh';
    pairs.push({ key: rel, verdict, source: sourcePath, emitted: emittedPath });
  }
  for (const out of emitted) {
    if (sources.has(`${out.slice(0, -'.js'.length)}.ts`)) continue;
    pairs.push({ key: out, verdict: 'orphan', source: null, emitted: join(compiledDir, out) });
  }
  return pairs
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ verdict, source: s, emitted: e }) => ({ verdict, source: s, emitted: e }));
}

export interface FreshnessOptions {
  /** The command that rebuilds: `pnpm run build` in an instance. */
  readonly rebuild: string;
  /** Where the one "not compared" line goes. */
  readonly info?: (line: string) => void;
}

/**
 * Refuse when any pair of `deployment` is not `fresh`. With no source root, say once that
 * nothing was compared; when the source root is the deployment root (a run from sources),
 * there is nothing to compare and nothing is said.
 */
export function assertOverlayBuildFresh(
  roots: OverlayRoots,
  deployment: string,
  options: FreshnessOptions,
): void {
  if (roots.deploymentSourceRoot === undefined) {
    options.info?.('[overlay] no source root; build freshness not compared');
    return;
  }
  if (roots.deploymentSourceRoot === roots.deploymentRoot) return;
  const notFresh = overlayFreshness(roots, deployment).filter((pair) => pair.verdict !== 'fresh');
  if (notFresh.length > 0) throw new OverlayBuildError(notFresh, options.rebuild);
}
