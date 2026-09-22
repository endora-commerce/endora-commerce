/**
 * **E3p** — an extraction's path set, resolved over the history and never
 * written down (`specs/134-paid-module-extraction/contracts/extraction-procedure.md`
 * E3p and refusal 14; owner ruling **D-263**, 2026-09-22).
 *
 * `scripts/extract-paid-module.sh` calls this and passes the file it writes to
 * `git filter-repo --paths-from-file`. E3p is the normative statement of
 * everything below and is **not** restated here; what this header carries is the
 * operation, the two traps, and the exit codes.
 *
 * ## The operation
 *
 *   * **R1** — every path any commit held for a directory whose `manifest.ts`
 *     declared the id, mapped to `modules/<id>/`.
 *   * **R2** — the rename closure of the package's own file set at the ref: for
 *     every tracked file, every path it has ever **held**, with the destination
 *     its surviving tip path gives it.
 *   * **The ownership tie-break** where R2 reaches outside R1: a path carrying
 *     *another* module's id is that module's lineage — printed, not carried. A
 *     path carrying no module's id is carried.
 *   * **The completeness refusal** over every path the source history held: an
 *     id-bearing path the resolution neither carried nor dispositioned stops the
 *     run. The predicate is 129 FR-011(d)'s and lives in
 *     `lib/module-id-paths.ts` — one predicate, two instruments.
 *
 * ## Two traps, both measured rather than reasoned about
 *
 *   * **`git log --follow` reports copies as well as renames, and a copy source
 *     was never a path the file held.** The repository's root `LICENSE` is
 *     byte-identical to every module package's, so `--follow` on
 *     `packages/modules/<id>/LICENSE` prints `C100 LICENSE …` and then goes on
 *     printing the *root* file's history. Measured on `wfirma`: carried, the
 *     export is **30** commits rooted at
 *     `8cc26d6 chore: the repository carries the licence texts it declares`
 *     instead of **29** rooted at the module's own birth `15f75e9` — and the
 *     root is the SHA E3a's arrival merge message cites by value. The **tip tree
 *     is identical either way**, which is the trap rather than a mitigation: the
 *     two files are byte-identical, which is why git scored a copy at all, so
 *     the export's own stray check passes and only the root moves. Where a copy
 *     scores below 100 the same rule maps two live paths onto one destination as
 *     well. So the chain follows `R`, stops at `C`, and prints the stop.
 *   * **`--follow` crosses module boundaries.** Measured: `pim_pimcore`'s import
 *     run entity follows back into `pim_ergonode`'s, `pim_unopim`'s admin files
 *     into **free** `pim_connector`, `payu`'s migration into `tpay`'s, and
 *     `wfirma`'s service into `infakt`'s. That is what the tie-break is for, and
 *     it is why the closure is not used unfiltered.
 *
 * ## Exit codes
 *
 * `0` a path set was written; `1` the completeness refusal fired — the paths are
 * printed and the run stops; `2` a vacuous answer refused: no tracked file at
 * the ref, no manifest ever declared the id, or the history walk read nothing.
 * A derivation that silently resolves to nothing would hand `filter-repo` an
 * empty filter, and an empty filter publishes an empty module.
 *
 * Usage:
 *
 *   `pnpm --filter backend exec tsx scripts/derive-extraction-path-set.ts \
 *      <module-id> --ref <rev> --package <dir> --paths-file <out>`
 */
/* eslint-disable no-console -- CLI tool: stdout/stderr is the interface. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pathCarriesModuleId } from './lib/module-id-paths.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** One `git` invocation, injected so every resolver below is testable. */
export type GitRunner = (args: readonly string[]) => string;

/**
 * A marker rather than `%x00`: the separator has to be a byte that cannot occur
 * in either half **and** cannot break a diff, and `specs/conventions/check-estate.md`
 * records what choosing a raw NUL cost the last time (a commit git's own sniff
 * window called binary).
 */
const MARK = '@@commit@@';

// --- parsing ----------------------------------------------------------------

export interface NameStatusChange {
  readonly status: string;
  /** The pre-image path — for `A`/`M`/`D` the only path there is. */
  readonly from: string;
  /** The post-image path; equal to `from` unless the status is `R` or `C`. */
  readonly to: string;
}

export interface NameStatusCommit {
  readonly sha: string;
  readonly changes: readonly NameStatusChange[];
}

/** `git log --format=<MARK>%H --name-status` output, in the order git printed it. */
export function parseNameStatus(text: string): NameStatusCommit[] {
  const commits: NameStatusCommit[] = [];
  for (const record of text.split(MARK)) {
    const lines = record.split('\n').filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    const changes: NameStatusChange[] = [];
    for (const line of lines.slice(1)) {
      const columns = line.split('\t');
      const status = columns[0] ?? '';
      if (status.length === 0) continue;
      if ((status.startsWith('R') || status.startsWith('C')) && columns.length >= 3) {
        changes.push({ status, from: columns[1]!, to: columns[2]! });
        continue;
      }
      if (columns[1] === undefined) continue;
      changes.push({ status, from: columns[1], to: columns[1] });
    }
    commits.push({ sha: (lines[0] ?? '').trim(), changes });
  }
  return commits;
}

/**
 * The id a lifecycle-shape `manifest.ts` declares about itself, read out of a
 * **blob** rather than off the disk.
 *
 * The filesystem twin is `declaredManifestId` in
 * `packages/cli/src/lib/module-roots.ts` and the pattern is deliberately the
 * same one: a module is a module because its manifest says so (D-246, D-231),
 * and an id inferred from a directory name is the thing that rule exists
 * against. The twin is private to that module and reads a path; this reads a
 * historical blob, and exporting one of them from a published package is a
 * surface change this merge request has no other reason to make.
 */
export function declaredManifestId(source: string): string | null {
  return /defineModuleManifest\(\{[\s\S]*?\bid:\s*'([^']+)'/.exec(source)?.[1] ?? null;
}

/** The module root a historical `manifest.ts` path implies. */
export function moduleRootOf(manifestPath: string): string {
  const withoutFile = manifestPath.slice(0, manifestPath.lastIndexOf('/'));
  // A package keeps its manifest at `src/manifest.ts`; the pre-packaging era
  // kept it at the module root itself. The root is what carries `package.json`,
  // `i18n/` and `docs/`, so `src` is stepped over rather than treated as one.
  return withoutFile.endsWith('/src') ? withoutFile.slice(0, -'/src'.length) : withoutFile;
}

// --- R1 ---------------------------------------------------------------------

export interface ManifestResolution {
  /** Every directory whose manifest declared the id, at any commit. */
  readonly roots: readonly string[];
  /** Every id any commit's manifest declared — the tie-break's population. */
  readonly idPopulation: readonly string[];
  /** Distinct historical `manifest.ts` paths read. The walk size. */
  readonly manifestPathsRead: number;
}

export function resolveManifestRoots(input: {
  git: GitRunner;
  ref: string;
  moduleId: string;
}): ManifestResolution {
  const { git, ref, moduleId } = input;
  const touches = new Map<string, string[]>();
  for (const commit of parseNameStatus(
    git([
      'log',
      `--format=${MARK}%H`,
      '--name-status',
      '-M',
      '--diff-filter=AMR',
      ref,
      '--',
      '*manifest.ts',
    ]),
  )) {
    for (const change of commit.changes) {
      if (!change.to.endsWith('manifest.ts')) continue;
      const shas = touches.get(change.to) ?? [];
      shas.push(commit.sha);
      touches.set(change.to, shas);
    }
  }
  const roots = new Set<string>();
  const idPopulation = new Set<string>();
  for (const [path, shas] of touches) {
    // Both ends of the path's own life. A manifest's id is an identity and does
    // not change under a directory, but reading one commit would be an
    // assumption about that rather than a check, and the whole walk is 176 paths.
    for (const sha of new Set([shas[0]!, shas[shas.length - 1]!])) {
      const declared = declaredManifestId(git(['show', `${sha}:${path}`]));
      if (declared === null) continue;
      idPopulation.add(declared);
      if (declared === moduleId) roots.add(moduleRootOf(path));
    }
  }
  return {
    roots: [...roots].sort(),
    idPopulation: [...idPopulation].sort(),
    manifestPathsRead: touches.size,
  };
}

// --- R2 ---------------------------------------------------------------------

export interface ClosureEntry {
  readonly historical: string;
  readonly tip: string;
}

export interface CopyStop {
  readonly source: string;
  readonly into: string;
}

export interface ClosureResult {
  readonly entries: readonly ClosureEntry[];
  readonly copyStops: readonly CopyStop[];
  /** One historical path two surviving files both claim — reported, never picked. */
  readonly collisions: readonly { readonly historical: string; readonly tips: readonly string[] }[];
}

/** Every path one surviving file has held, newest first, stopping at a copy. */
export function followOne(input: {
  git: GitRunner;
  ref: string;
  file: string;
}): { readonly historical: readonly string[]; readonly copyStop: CopyStop | null } {
  const { git, ref, file } = input;
  const commits = parseNameStatus(
    git(['log', '--follow', '--name-status', '-M', `--format=${MARK}%H`, ref, '--', file]),
  );
  const historical: string[] = [];
  let current = file;
  let copyStop: CopyStop | null = null;
  for (const commit of commits) {
    for (const change of commit.changes) {
      if (change.to !== current) continue;
      if (change.status.startsWith('R')) {
        current = change.from;
        historical.push(current);
        break;
      }
      if (change.status.startsWith('C')) {
        copyStop = { source: change.from, into: current };
        return { historical, copyStop };
      }
    }
  }
  return { historical, copyStop };
}

export function resolveRenameClosure(input: {
  git: GitRunner;
  ref: string;
  files: readonly string[];
}): ClosureResult {
  const claims = new Map<string, Set<string>>();
  const copyStops: CopyStop[] = [];
  for (const file of input.files) {
    const { historical, copyStop } = followOne({ git: input.git, ref: input.ref, file });
    if (copyStop !== null) copyStops.push(copyStop);
    for (const path of historical) {
      if (path === file) continue;
      const tips = claims.get(path) ?? new Set<string>();
      tips.add(file);
      claims.set(path, tips);
    }
  }
  const entries: ClosureEntry[] = [];
  const collisions: { historical: string; tips: readonly string[] }[] = [];
  for (const [historical, tips] of [...claims.entries()].sort()) {
    const sorted = [...tips].sort();
    if (sorted.length > 1) {
      collisions.push({ historical, tips: sorted });
      continue;
    }
    entries.push({ historical, tip: sorted[0]! });
  }
  return { entries, copyStops, collisions };
}

// --- the ownership tie-break -----------------------------------------------

export interface ForeignLineage {
  readonly historical: string;
  readonly owner: string;
  readonly tip: string;
}

export interface OwnershipSplit {
  /** Outside every R1 root, and this module's: a rename pair is derived for each. */
  readonly carried: readonly ClosureEntry[];
  readonly foreign: readonly ForeignLineage[];
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function splitByOwnership(input: {
  entries: readonly ClosureEntry[];
  roots: readonly string[];
  moduleId: string;
  idPopulation: readonly string[];
}): OwnershipSplit {
  const { entries, roots, moduleId, idPopulation } = input;
  const others = idPopulation.filter((id) => id !== moduleId);
  const carried: ClosureEntry[] = [];
  const foreign: ForeignLineage[] = [];
  for (const entry of entries) {
    if (roots.some((root) => isUnder(entry.historical, root))) continue;
    const owner = others.find((id) => pathCarriesModuleId(entry.historical, id));
    if (owner !== undefined) {
      foreign.push({ historical: entry.historical, owner, tip: entry.tip });
      continue;
    }
    carried.push(entry);
  }
  return { carried, foreign };
}

// --- the completeness refusal ----------------------------------------------

export type Disposition =
  | 'design-record'
  | 'generated-reference-page'
  | 'ledger-shard'
  | 'host-bound-test';

export interface RefusalReport {
  readonly refused: readonly string[];
  readonly dispositioned: readonly { readonly path: string; readonly disposition: Disposition }[];
  readonly pathsWalked: number;
}

/** Every path the source history held at any commit, at any status. */
export function historicalPathsOf(input: { git: GitRunner; ref: string }): string[] {
  const paths = new Set<string>();
  for (const commit of parseNameStatus(
    input.git(['log', `--format=${MARK}%H`, '--name-status', '-M', input.ref]),
  )) {
    for (const change of commit.changes) {
      paths.add(change.from);
      paths.add(change.to);
    }
  }
  return [...paths].sort();
}

/** E3p's standing dispositions, as path shapes. `null` means *the run stops*. */
export function dispositionOf(path: string, moduleId: string): Disposition | null {
  const kebab = moduleId.replace(/_/g, '-');
  if (path.startsWith('specs/') || path.startsWith('.changeset/')) return 'design-record';
  if (path === `docs/docs/module-reference/${kebab}.md`) return 'generated-reference-page';
  if (new RegExp(`^backend/scripts/ledgers/[^/]+/${moduleId}\\.ts$`).test(path)) {
    return 'ledger-shard';
  }
  if (path.startsWith('backend/test/')) return 'host-bound-test';
  return null;
}

export function completenessRefusals(input: {
  historicalPaths: readonly string[];
  moduleId: string;
  roots: readonly string[];
  carried: readonly ClosureEntry[];
}): RefusalReport {
  const covered = new Set<string>();
  for (const entry of input.carried) {
    covered.add(entry.historical);
    covered.add(entry.tip);
  }
  const refused: string[] = [];
  const dispositioned: { path: string; disposition: Disposition }[] = [];
  for (const path of input.historicalPaths) {
    if (!pathCarriesModuleId(path, input.moduleId)) continue;
    if (covered.has(path)) continue;
    if (input.roots.some((root) => isUnder(path, root))) continue;
    const disposition = dispositionOf(path, input.moduleId);
    if (disposition === null) refused.push(path);
    else dispositioned.push({ path, disposition });
  }
  return { refused, dispositioned, pathsWalked: input.historicalPaths.length };
}

// --- the plan --------------------------------------------------------------

export interface FilterPlan {
  readonly keep: readonly string[];
  readonly renames: readonly { readonly from: string; readonly to: string }[];
}

export function filterPlan(input: {
  moduleId: string;
  roots: readonly string[];
  carried: readonly ClosureEntry[];
  tipRoot: string;
}): FilterPlan {
  const destination = `modules/${input.moduleId}/`;
  const keep = [
    ...input.roots.map((root) => `${root}/`),
    ...input.carried.map((entry) => entry.historical),
  ];
  const renames = [
    ...input.carried.map((entry) => ({
      from: entry.historical,
      to: destination + entry.tip.slice(`${input.tipRoot}/`.length),
    })),
    ...input.roots.map((root) => ({ from: `${root}/`, to: destination })),
  ];
  return { keep: [...new Set(keep)].sort(), renames };
}

/**
 * The `--paths-from-file` payload, and **the one home of its two ordering
 * rules** — both of which are ways the same correct-looking file exports the
 * wrong tree:
 *
 *   * **Every keep line comes before every rename.** `filter-repo` evaluates a
 *     `filter` line against the path as the renames seen so far have already
 *     rewritten it, so a keep line after a rename selects a path that no longer
 *     exists and the file is silently dropped.
 *   * **Longest source first.** It applies *every* matching rename in file
 *     order, each rewriting the path the next is matched against, so a directory
 *     rule placed first eats a file rule's prefix and lands the file at a
 *     destination nobody asked for.
 */
export function renderPathsFile(plan: FilterPlan): string {
  const renames = [...plan.renames].sort(
    (a, b) => b.from.length - a.from.length || a.from.localeCompare(b.from),
  );
  const lines = [
    '# Derived by backend/scripts/derive-extraction-path-set.ts — E3p, D-263.',
    '# Never edited by hand and never committed: it is a derived fact (D-100).',
    ...[...plan.keep].sort().map((path) => `literal:${path}`),
    ...renames.map((rename) => `${rename.from}==>${rename.to}`),
  ];
  return `${lines.join('\n')}\n`;
}

// --- the CLI ---------------------------------------------------------------

interface Options {
  readonly moduleId: string | undefined;
  readonly ref: string;
  readonly package: string | undefined;
  readonly pathsFile: string | undefined;
}

export function parseOptions(argv: readonly string[]): Options {
  let moduleId: string | undefined;
  let ref = 'HEAD';
  let pkg: string | undefined;
  let pathsFile: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--ref') ref = argv[(i += 1)] ?? ref;
    else if (arg === '--package') pkg = argv[(i += 1)];
    else if (arg === '--paths-file') pathsFile = argv[(i += 1)];
    else if (!arg.startsWith('-')) moduleId ??= arg;
  }
  return { moduleId, ref, package: pkg, pathsFile };
}

function main(): never {
  const options = parseOptions(process.argv.slice(2));
  const { moduleId, ref, pathsFile } = options;
  if (moduleId === undefined) {
    console.error(
      'usage: tsx scripts/derive-extraction-path-set.ts <module-id> [--ref <rev>] ' +
        '[--package <dir>] [--paths-file <out>]',
    );
    process.exit(2);
  }
  const tipRoot = options.package ?? `packages/modules/${moduleId}`;
  const git: GitRunner = (args) =>
    execFileSync('git', ['-C', REPO_ROOT, ...args], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 512,
    });
  const say = (line: string): void => console.log(`[path-set:${moduleId}] ${line}`);

  const files = git(['ls-tree', '-r', '--name-only', ref, '--', `${tipRoot}/`])
    .split('\n')
    .filter((line) => line.length > 0);
  if (files.length === 0) {
    console.error(
      `[path-set:${moduleId}] REFUSED — ${tipRoot} tracks no file at ${ref}. A path set derived ` +
        'from an empty file set is an empty filter, and an empty filter exports an empty module.',
    );
    process.exit(2);
  }

  const resolution = resolveManifestRoots({ git, ref, moduleId });
  if (resolution.roots.length === 0) {
    console.error(
      `[path-set:${moduleId}] REFUSED — no manifest at any commit declares this id. Either the ` +
        'id is a typo or the walk read nothing; both answers are about this run rather than ' +
        `about the module. ${resolution.manifestPathsRead} historical manifest path(s) read.`,
    );
    process.exit(2);
  }
  say(
    `R1 — ${resolution.roots.length} root(s) over ${resolution.manifestPathsRead} historical ` +
      `manifest path(s), against a population of ${resolution.idPopulation.length} id(s)`,
  );
  for (const root of resolution.roots) say(`  root: ${root}/`);

  const closure = resolveRenameClosure({ git, ref, files });
  const split = splitByOwnership({
    entries: closure.entries,
    roots: resolution.roots,
    moduleId,
    idPopulation: resolution.idPopulation,
  });
  say(
    `R2 — ${files.length} surviving file(s), ${closure.entries.length} historical path(s), ` +
      `${split.carried.length} outside every root`,
  );
  for (const entry of split.carried) say(`  carried: ${entry.historical} (from ${entry.tip})`);
  for (const stop of closure.copyStops) {
    say(`  copy, not a rename — the chain stops here: ${stop.source} -> ${stop.into}`);
  }
  for (const lineage of closure.collisions) {
    say(`  two surviving files claim ${lineage.historical}: ${lineage.tips.join(', ')} — not carried`);
  }
  for (const lineage of split.foreign) {
    say(
      `  ${lineage.owner}'s lineage, printed and not carried: ${lineage.historical} ` +
        `(--follow reached it from ${lineage.tip})`,
    );
  }

  const historicalPaths = historicalPathsOf({ git, ref });
  if (historicalPaths.length === 0) {
    console.error(
      `[path-set:${moduleId}] REFUSED — the history walk read no path at all, so the ` +
        'completeness assertion would be a green over an empty set.',
    );
    process.exit(2);
  }
  const report = completenessRefusals({
    historicalPaths,
    moduleId,
    roots: resolution.roots,
    carried: split.carried,
  });
  say(
    `refusal — ${report.pathsWalked} historical path(s) walked, ` +
      `${report.dispositioned.length} dispositioned, ${report.refused.length} refused`,
  );
  for (const row of report.dispositioned) say(`  ${row.disposition}: ${row.path}`);

  const plan = filterPlan({ moduleId, roots: resolution.roots, carried: split.carried, tipRoot });
  if (pathsFile !== undefined) writeFileSync(pathsFile, renderPathsFile(plan), 'utf8');

  if (report.refused.length > 0) {
    console.error(
      `[path-set:${moduleId}] REFUSED — ${report.refused.length} path(s) of this history carry ` +
        'this id, were not carried, and no standing disposition covers them:',
    );
    for (const path of report.refused) console.error(`  ${path}`);
    console.error(
      'Widen the resolution or record each as deliberately left, in the merge request. There is ' +
        'no default: both answers are real and the wrong one is unrecoverable (E3p, refusal 14).',
    );
    process.exit(1);
  }
  say(`plan — ${plan.keep.length} keep line(s), ${plan.renames.length} rename(s)`);
  process.exit(0);
}

// Run as CLI only — importing this module from a unit test must not shell out.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
