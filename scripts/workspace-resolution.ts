/**
 * Which checkout is this run's `@b2b/*` source coming from? (issue #255)
 *
 * ## The defect
 *
 * All five packages under `packages/` are `link:`ed workspace members whose
 * `dist` is built from the checkout they physically live in (feature 080,
 * T042), so a consumer that resolves `@b2b/contracts` reads whatever that
 * checkout last compiled — and which checkout that is comes down to one
 * symlink:
 *
 * ```
 * backend/node_modules/@b2b/contracts -> ../../../packages/contracts
 * ```
 *
 * That link is *relative*, and it is relative to where the link physically
 * lives. Point `backend/node_modules` at another checkout's `node_modules` —
 * the one-line wiring every `git worktree` here used to get — and the link
 * re-roots with it: the worktree's own `packages/contracts` is never opened,
 * and the run compiles and executes the **main tree's** branch instead.
 *
 * Measured on this tree, in a worktree whose `packages/contracts` carried a
 * symbol `master` does not have:
 *
 *   * `require.resolve('@b2b/contracts')` from `<worktree>/backend`
 *     → `/home/…/b2b-platform/packages/contracts/src/index.ts`. The main tree.
 *   * `vitest` imported that same file, so a test asserting the branch's own
 *     contract change failed against `master`'s source.
 *   * `tsc` did **not**: `tsconfig.base.json` maps four of the five packages
 *     through `paths`, which are relative to the config file and therefore to
 *     the worktree. The fifth, `@b2b/page-builder-core`, had no entry and
 *     resolved to the main tree — so a single run type-checked one branch and
 *     ran another.
 *   * `pnpm ls @b2b/contracts` reported
 *     `"path": "<worktree>/packages/contracts"`, which is false. pnpm answers
 *     from the manifest's `link:` declaration and never looks at the symlink,
 *     so the obvious diagnostic is the one that cannot see this.
 *
 * The `paths` list closes the `tsc` half and is now complete, but it is a hand
 * written list: the sixth package will be added by somebody who does not know
 * this file exists. Nothing closes the runtime half at all. Hence a guard,
 * placed in `vitest.config.base.ts` — the one file every workspace's vitest
 * config merges — so that a run whose result would be about another branch
 * refuses to produce a result instead.
 *
 * It is the same judgement `backend/test/global-setup.ts` already makes about
 * the database name: an environment that would make the run's answer a lie
 * about the wrong thing is refused, loudly, with an override for whoever
 * genuinely means it.
 *
 * ## What it reads
 *
 * The population is derived, not listed: every `@b2b/*` name declared in the
 * `dependencies` or `devDependencies` of any workspace manifest, crossed with
 * the workspace that declares it. Sixteen pairs stand today. Each pair names
 * one link — `<consumer>/node_modules/<specifier>` — which is `realpath`-ed and
 * asked one question: is the file it lands on inside *this* checkout?
 *
 * `peerDependencies` are deliberately out: pnpm installs no link for a peer
 * that is not also a direct dependency, so a peer-only entry would report as
 * missing on a perfectly good tree.
 *
 * ## What it cannot see
 *
 *   * **A package resolved from a registry rather than the workspace.** Today
 *     all five are `link:` workspace dependencies, so "outside this checkout"
 *     and "wrong branch" are the same statement. On the day `@b2b/contracts`
 *     is consumed as a published version through a symlinked root store, this
 *     guard would call a correct tree foreign. The remedy then is to key on
 *     the lockfile's `link:` specifier, not to widen the containment test.
 *   * **A stale copy.** `cp -a` of a workspace's `node_modules` re-roots the
 *     relative links correctly and is the fast wiring `scripts/setup-worktree.sh`
 *     uses, but nothing here notices that the *third-party* half of the copy is
 *     older than the lockfile. `pnpm install --frozen-lockfile` is what answers
 *     that question, and in this repository it takes about 3 s against a warm
 *     store.
 *   * **`tsc`, `eslint` and the `check-*` scripts.** They are not vitest, so
 *     they never load this. The `tsc` half is closed structurally instead, by
 *     the `paths` block in `tsconfig.base.json`, which
 *     `backend/test/unit/harness/workspace-resolution.test.ts` keeps complete.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** The scope every workspace package of this repository is published under. */
export const WORKSPACE_SCOPE = '@b2b/';

/** Set to `1` to run anyway. Named after the run it lets through, not the check. */
export const ALLOW_FOREIGN_ENV = 'ALLOW_FOREIGN_WORKSPACE_PACKAGES';

/**
 * The filesystem, as three questions.
 *
 * Injected so a red proof can hand in a whole synthetic checkout at the top of
 * the analysis rather than a half-classified record at the bottom of it
 * (issue #130): discovery, classification and the message are all downstream of
 * this interface, so a fixture exercises every one of them.
 */
export interface ResolutionFs {
  /** Parsed JSON, or `null` when the file is absent or unreadable. */
  readonly readJson: (path: string) => unknown;
  /** Immediate subdirectory names, or `[]` when the directory is absent. */
  readonly listDirectories: (path: string) => readonly string[];
  /** Fully resolved path of a link or file, or `null` when nothing is there. */
  readonly realpath: (path: string) => string | null;
}

/** One `<consumer>/node_modules/@b2b/<name>` link the manifests say must exist. */
export interface WorkspaceLink {
  /** Consumer directory, relative to the root — `backend`, `packages/api-client`. */
  readonly consumer: string;
  /** The bare specifier, e.g. `@b2b/contracts`. */
  readonly specifier: string;
  /** Where the link is expected, relative to the root. */
  readonly linkPath: string;
  /** Absolute, fully resolved target — `null` when the link is not there. */
  readonly target: string | null;
  readonly verdict: 'local' | 'foreign' | 'missing';
}

export interface WorkspaceResolutionReport {
  /** The checkout the guard is answering about, fully resolved. */
  readonly root: string;
  /** The `@b2b/*` names `packages/*` defines here. */
  readonly packages: readonly string[];
  /** Every declared consumer→package pair, classified. */
  readonly links: readonly WorkspaceLink[];
}

export type RefusalKind = 'no-packages' | 'no-links' | 'foreign' | 'missing';

export interface WorkspaceResolutionRefusal {
  readonly kind: RefusalKind;
  readonly message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `@b2b/*` names in `dependencies` + `devDependencies`, sorted, deduplicated. */
function declaredWorkspaceDependencies(manifest: unknown): readonly string[] {
  const record = asRecord(manifest);
  if (record === null) return [];
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const block = asRecord(record[field]);
    if (block === null) continue;
    for (const name of Object.keys(block)) {
      if (name.startsWith(WORKSPACE_SCOPE)) names.add(name);
    }
  }
  return [...names].sort();
}

function manifestName(manifest: unknown): string | null {
  const record = asRecord(manifest);
  const name = record?.['name'];
  return typeof name === 'string' ? name : null;
}

/**
 * Is `candidate` this checkout's own file?
 *
 * Both sides arrive fully resolved, so a repository reached through a symlinked
 * parent directory answers the same as one reached directly. The separator is
 * appended on purpose: `/srv/app` must not contain `/srv/app-2`.
 */
export function isInsideCheckout(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Every directory that can declare a dependency: the root, its workspaces, `packages/*`. */
function consumerDirectories(root: string, fs: ResolutionFs): readonly string[] {
  const candidates = new Set<string>(['.']);
  for (const entry of fs.listDirectories(root)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    candidates.add(entry);
  }
  for (const entry of fs.listDirectories(join(root, 'packages'))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    candidates.add(`packages/${entry}`);
  }
  return [...candidates]
    .filter((dir) => fs.readJson(join(root, dir, 'package.json')) !== null)
    .sort();
}

/**
 * The whole analysis, over an injected filesystem.
 *
 * `root` is taken as given and resolved by the caller; everything else —
 * which packages exist, who declares them, where each link lands — is derived
 * here, so there is no list to keep in step with `packages/`.
 */
export function inspectWorkspaceResolution(
  root: string,
  fs: ResolutionFs,
): WorkspaceResolutionReport {
  const packages: string[] = [];
  for (const entry of fs.listDirectories(join(root, 'packages'))) {
    const name = manifestName(fs.readJson(join(root, 'packages', entry, 'package.json')));
    if (name !== null && name.startsWith(WORKSPACE_SCOPE)) packages.push(name);
  }
  packages.sort();

  const links: WorkspaceLink[] = [];
  for (const consumer of consumerDirectories(root, fs)) {
    const manifest = fs.readJson(join(root, consumer, 'package.json'));
    for (const specifier of declaredWorkspaceDependencies(manifest)) {
      const linkPath = join(consumer, 'node_modules', specifier);
      const target = fs.realpath(join(root, linkPath));
      links.push({
        consumer,
        specifier,
        linkPath,
        target,
        verdict:
          target === null ? 'missing' : isInsideCheckout(root, target) ? 'local' : 'foreign',
      });
    }
  }

  return { root, packages, links };
}

const REMEDY =
  'Wire the worktree with `bash scripts/setup-worktree.sh` (about 0.2 s), or run\n' +
  '`pnpm install --frozen-lockfile` inside it (about 3 s against a warm store). Never\n' +
  'symlink a workspace\'s `node_modules` at another checkout: the `@b2b/*` links inside\n' +
  'it are relative, so they re-root at that checkout and this run measures its branch.';

/**
 * Why this run may not proceed, or `null`.
 *
 * Pure over the report, so every refusal is provable from a fixture and none of
 * them is a string this function happens to build. The order is deliberate:
 * an empty population is answered before a clean one, because "found nothing
 * wrong" and "looked at nothing" print the same green otherwise.
 */
export function workspaceResolutionRefusal(
  report: WorkspaceResolutionReport,
): WorkspaceResolutionRefusal | null {
  if (report.packages.length === 0) {
    return {
      kind: 'no-packages',
      message:
        `No workspace package was found under ${join(report.root, 'packages')}. This guard ` +
        'answers which checkout `@b2b/*` comes from, and over an empty set it answers ' +
        'nothing; refusing to let the run report a result it cannot vouch for.',
    };
  }
  if (report.links.length === 0) {
    return {
      kind: 'no-links',
      message:
        'No workspace manifest declares a dependency on any of ' +
        `${report.packages.join(', ')}. Either the layout this guard understands has ` +
        'changed, or nothing is installed; refusing to report a vacuous pass.',
    };
  }
  const missing = report.links.filter((link) => link.verdict === 'missing');
  const foreign = report.links.filter((link) => link.verdict === 'foreign');
  if (foreign.length > 0) {
    const lines = foreign.map(
      (link) => `  ${link.linkPath}\n    → ${link.target} (another checkout)`,
    );
    return {
      kind: 'foreign',
      message:
        `${foreign.length} of ${report.links.length} \`${WORKSPACE_SCOPE}*\` links in this ` +
        `checkout resolve outside it:\n${lines.join('\n')}\n\n` +
        `This checkout is ${report.root}. Every package under \`packages/\` resolves ` +
        'through its own `exports` map at `./dist`, so those links decide **whose ' +
        'source this run compiles and whose build it executes** — and the answer above ' +
        "is: another branch's. Nothing " +
        'else would report it: `pnpm ls` prints the path the manifest declares, not the ' +
        `one the symlink reaches.\n\n${REMEDY}\n\n` +
        `Set ${ALLOW_FOREIGN_ENV}=1 if you are deliberately measuring another checkout.`,
    };
  }
  if (missing.length > 0) {
    const lines = missing.map((link) => `  ${link.linkPath} (declared by ${link.consumer})`);
    return {
      kind: 'missing',
      message:
        `${missing.length} of ${report.links.length} declared \`${WORKSPACE_SCOPE}*\` links ` +
        `are not installed in this checkout:\n${lines.join('\n')}\n\n${REMEDY}`,
    };
  }
  return null;
}

/** The one-line disclosure of what the guard read, in the grammar the checks use. */
export function workspaceResolutionSummary(report: WorkspaceResolutionReport): string {
  return (
    `[workspace-resolution] read: links=${report.links.length} ` +
    `sources=workspace-packages:${report.packages.length}/${report.packages.length}`
  );
}

/** The real filesystem behind {@link ResolutionFs}. Absence is `null`, never a throw. */
export function nodeResolutionFs(): ResolutionFs {
  return {
    readJson(path: string): unknown {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
      } catch {
        return null;
      }
    },
    listDirectories(path: string): readonly string[] {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    realpath(path: string): string | null {
      try {
        statSync(path);
        return realpathSync(path);
      } catch {
        return null;
      }
    },
  };
}

/**
 * The checkout `cwd` belongs to: the nearest ancestor holding
 * `pnpm-workspace.yaml`.
 *
 * Nearest, so a worktree parked *inside* the main tree — which is where this
 * repository's agent worktrees live — answers with itself rather than with its
 * host. Derived from the filesystem on every call and never from
 * `import.meta.url`, which a bundled vite config rewrites to a temporary file.
 */
export function findCheckoutRoot(cwd: string, fs: ResolutionFs = nodeResolutionFs()): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (fs.realpath(join(dir, 'pnpm-workspace.yaml')) !== null) return realpathOr(dir, fs);
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function realpathOr(dir: string, fs: ResolutionFs): string {
  return fs.realpath(dir) ?? dir;
}

/**
 * The guard itself: throw unless every `@b2b/*` link is this checkout's own.
 *
 * Called from `vitest.config.base.ts`, so it runs once per vitest invocation in
 * every workspace, before a single test file is collected.
 */
export function assertWorkspacePackagesAreLocal(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env[ALLOW_FOREIGN_ENV] === '1') return;
  const fs = nodeResolutionFs();
  const root = findCheckoutRoot(cwd, fs);
  if (root === null) {
    // Not a checkout of this repository at all — a consumer vendoring the
    // config, or a run from outside the tree. There is nothing to be wrong
    // about, so there is nothing to refuse.
    return;
  }
  const report = inspectWorkspaceResolution(root, fs);
  const refusal = workspaceResolutionRefusal(report);
  if (refusal !== null) {
    throw new Error(`[workspace-resolution] ${refusal.message}`);
  }
  // Disclosure rather than silence: "all local" is the sentence that tells an
  // agent this run is about the branch they are on, and it is the sentence a
  // guard that had stopped looking could not print.
  process.stdout.write(`${workspaceResolutionSummary(report)}\n`);
}

// Answer the question without starting a test run:
//
//   backend/node_modules/.bin/tsx scripts/workspace-resolution.ts
//
// `scripts/setup-worktree.sh` ends with exactly this, so the wiring it just
// performed is verified by the analysis rather than assumed from an exit code.
// Vitest reaches this file as an import from a bundled config, where `argv[1]`
// is the vitest binary, so the tail stays inert there.
if (process.argv[1]?.endsWith('workspace-resolution.ts') === true) {
  try {
    assertWorkspacePackagesAreLocal();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
