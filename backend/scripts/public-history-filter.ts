/**
 * The **one-time** disclosure filter that produces the canonical public
 * repository, and its dry-run report
 * (`specs/129-github-canonical-migration/` T020 – T025; FR-010 – FR-013 and
 * FR-020; owner rulings **D-240** as amended, **D-241**, **D-246**, **D-247**).
 *
 * ## What it is, and what it is deliberately not
 *
 * It is a migration tool. It runs by hand, twice — a rehearsal and the real
 * run, which are the same code path with `--apply` as the only difference —
 * and then it is history. **It is not a `check-*` script and must never be
 * named like one** (FR-014): that namespace carries four permanent obligations
 * and an enumerating test (`backend/test/unit/scripts/check-inventory.test.ts`),
 * so a throwaway named `check-…` acquires a permanent row for a temporary
 * thing. For the same reason it prints its own read line rather than calling
 * `reportReadSize`: that reporter's numbers are held against
 * `backend/test/helpers/check-read-sizes.ts`, a ledger every future merge
 * request is measured against, and this script will not exist to be measured.
 * What it does keep is the property those obligations exist for — **a green
 * that means "did not look" is refused**, here as exit 2 (FR-020, 126 FR-014).
 *
 * ## The operation (D-240, unchanged by its amendment)
 *
 * `git-filter-repo`, a **path filter over the recorded dispositions**, and
 * `--replace-message` over the commit messages the record lists (first
 * found by `specs/126-public-mirror-disclosure/spec.md` §2.1; D-275) — **and
 * no other content change of any kind**, with one exception the owner ruled narrowly (O-3 of
 * `specs/136-open-source-publication/`, 2026-09-25): `--replace-text` over
 * blobs **absent from the tip**, for S, C2 and C3 findings only. The tip stays
 * byte-identical, which {@link byteIdentityFindings} keeps asserting (129
 * SC-004), and {@link textReplacementFindings} refuses any rule that would
 * reach it. Two consequences of the no-other-change clause are decisions this
 * file takes and states rather than leaves to be discovered:
 *
 *   * **`--preserve-commit-hashes` is passed.** `git-filter-repo` rewrites, by
 *     default, any commit hash quoted *inside* a message to the hash the
 *     rewrite gave it. That is a message change nothing declared, across
 *     thousands of commits, and FR-010 admits exactly one class of message
 *     change. Under FR-013 the historical repository stays reachable and the
 *     commit map is the published bridge, so a pre-migration hash quoted in a
 *     message still resolves — on the side it was written about. The cost of
 *     this choice is that those quotations do not resolve in the canonical
 *     repository without the map; the benefit is that {@link
 *     messageIdentityFindings} can assert, over the projection itself, that
 *     **every surviving message is its original with the declared replacements
 *     applied and nothing else**. An assertion beats an assumption.
 *   * **The keep-list is a keep-list**, not an invert-list. The record is
 *     exclude-by-default over an enumerated population (126 FR-002), and the
 *     two formulations agree only while the record and the tree agree. A
 *     keep-list drops what nobody disposed of; an invert-list publishes it.
 *
 * ## Every assertion here is about the projected tree
 *
 * This filter runs once against real history and its output *becomes* the
 * canonical repository. An instrument that measures the tree the projection was
 * derived from measures a tree the client will never get. So the three
 * reconciliations below all read the **filtered** repository:
 * {@link byteIdentityFindings} compares blob ids in the projection against the
 * source (SC-004), {@link messageIdentityFindings} compares its messages, and
 * the projection's own path set is compared against the keep-list this file
 * computed independently — two authors for one population, which is the only
 * way a path rule that silently stopped matching is visible.
 *
 * ## Exit codes
 *
 * `0` clean; `1` findings — the run is refused, and under `--apply` nothing is
 * pushed; `2` **a vacuous pass refused**: a missing or unreadable record, no
 * `git-filter-repo`, an empty walk, or a commit map shorter than the walk that
 * produced it. A filter that silently walks nothing produces a beautiful empty
 * report, and that is the failure this estate exists against.
 *
 * Usage — **through the package script**, which is the spelling that keeps the
 * exit code:
 *
 *   `pnpm --filter backend run history:filter -- [--ref <rev>] [--out <dir>] [--apply]
 *     [--allow-tip-residue] [--replace-text <S-rule record outside the repository>]`
 *
 * The module-id exclusion resolves each id over the **history** of the ref
 * being filtered (129 FR-011 as amended; `specs/134-paid-module-extraction/`
 * T091): the manifest roots, the satellites, the rename closure, the host-tree
 * row of D-272's class table and the closed `withheldPaths` residue
 * ({@link resolveModuleExclusions}). A path carrying an excluded id that none
 * of those covers is public only by class — the tip, a free module's own file,
 * a changeset — and otherwise refuses the run rather than being published
 * (FR-011(d) as amended by D-272; {@link completenessWalk}).
 *
 * `--replace-text` takes rules of `{ class, ref, literal, replacement, reason }`
 * ({@link validateTextReplacements}) from **two** records, each class with one
 * home (owner ruling D-273): the C2/C3 rules from the committed private
 * {@link TEXT_REPLACEMENTS_PATH}, read on every run, and the S rules — each
 * with a `revoked` date — from `--replace-text <file>`, which must resolve
 * outside the repository ({@link replaceTextLocationRefusal}). The report names
 * each record by SHA-256 and each rule by its `ref`, and never prints a literal.
 *
 * `--allow-tip-residue` lets a dry run through while an excluded id is still
 * declared at the tip ({@link tipResidueFindings}); `--apply` ignores it.
 *
 * Measured, because the difference is invisible until it matters:
 * `pnpm --filter backend run` propagates this script's **2** and
 * `pnpm --filter backend exec` collapses it to its own **1**. A tool whose
 * whole refusal vocabulary is an exit code may not be run through a wrapper
 * that flattens it, so the script exists in `package.json` for that reason and
 * not for convenience.
 *
 * `--out` defaults to `<git-dir>/endora-public-history`, which is inside `.git`
 * on purpose and for two reasons. Every whole-tree walk in this repository
 * skips that directory by name, so a 5 000-commit projection left on disk
 * cannot move a recorded read size; and the working directory holds
 * `replace-message.txt`, which **is** the payload spelled out — an `--out`
 * inside the working tree would stage the very text the run exists to remove.
 * Run it twice with the same `--out` and the second run compares its commit map
 * against the first, which is FR-013's determinism checked rather than
 * asserted.
 */
/* eslint-disable no-console -- CLI tool: stdout/stderr is the interface. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  analyseDispositions,
  type DispositionDocument,
  DISPOSITIONS_PATH,
  globToRegExp,
} from './check-root-dispositions.js';
import { moduleIdMatcher, moduleIdSpellings } from './lib/module-id-paths.js';
import { discoverModulePackages } from './lib/module-packages.js';

export type { DispositionDocument };

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** The message-replacement record (T022), beside the dispositions it is read with. */
export const REPLACEMENTS_PATH =
  'specs/129-github-canonical-migration/contracts/message-replacements.json';

/**
 * The committed C2/C3 text-replacement record (owner ruling **D-273** clause
 * 1): private in the disposition record, read on every run, `{ "rules": [] }`
 * when empty, and a missing file is exit 2. S rules never live here.
 */
export const TEXT_REPLACEMENTS_PATH = 'specs/136-open-source-publication/text-replacements.json';

/** `git-filter-repo`'s own sentinel for "this commit did not survive". */
export const DROPPED = '0'.repeat(40);

// --- the records ------------------------------------------------------------

/** One literal substring of one commit message, and what replaces it. */
export interface MessageReplacement {
  readonly literal: string;
  readonly replacement: string;
}

/** One commit of 126 §2.1, with the class its disclosure falls in. */
export interface ReplacedCommit {
  readonly sha: string;
  readonly class: string;
  readonly label: string;
  readonly reason: string;
  readonly replacements: readonly MessageReplacement[];
}

export interface MessageReplacementDocument {
  readonly version: number;
  readonly notes?: readonly string[];
  readonly commits: readonly ReplacedCommit[];
}

/**
 * The module ids D-246 excludes. It lives in the disposition record — one file,
 * one list — and **an empty list is a legitimate, silent state** (FR-012): a
 * check that reports it as a misconfiguration teaches people to override
 * checks.
 */
export interface ModuleExclusionBlock {
  readonly moduleIds?: readonly string[];
  readonly reason?: string;
  /** D-272 clause 5: the closed, name-invisible residue — see {@link WithheldPathEntry}. */
  readonly withheldPaths?: readonly WithheldPathEntry[];
}

/**
 * One historical path no name and no rename reaches, withheld under one
 * excluded id (D-272 clause 5). A path at a fixed commit of an immutable
 * history does not go stale the way a derived fact does, and every way the
 * entry can be wrong refuses: a path no commit held, a path the tip holds, a
 * path a rule already resolves, an id not in the list, a reason under eight
 * characters, a path listed twice.
 */
export interface WithheldPathEntry {
  readonly path: string;
  readonly moduleId: string;
  readonly reason: string;
}

export type FindingKind =
  | 'undisposed-root-entry'
  | 'undisposed-path'
  | 'invalid-disposition'
  | 'duplicate-disposition'
  | 'unresolved-module-id'
  | 'duplicate-module-id'
  | 'uncovered-module-path'
  | 'invalid-withheld-path'
  | 'stale-withheld-path'
  | 'duplicate-withheld-path'
  | 'no-module-packages'
  | 'excluded-id-at-tip'
  | 'unusable-literal'
  | 'self-referential-replacement'
  | 'duplicate-literal'
  | 'invalid-sha'
  | 'unreasoned-replacement'
  | 'over-broad-literal'
  | 'inert-literal'
  | 'missing-from-projection'
  | 'undisposed-in-projection'
  | 'content-changed'
  | 'private-path-in-history'
  | 'undeclared-message-change'
  | 'payload-survived'
  | 'non-deterministic-map'
  | 'invalid-replacement-rule'
  | 'disallowed-replacement-class'
  | 'replacement-reaches-tip'
  | 'inert-text-replacement'
  | 'text-payload-survived';

export interface Finding {
  readonly kind: FindingKind;
  readonly subject: string;
  readonly detail: string;
}

// --- the keep-list ----------------------------------------------------------

/** One line of `git-filter-repo`'s `--paths-from-file`, and the row it came from. */
export interface KeepSpec {
  readonly kind: 'literal' | 'glob';
  readonly value: string;
  readonly source: string;
}

/**
 * A recorded `match` in the disposition record, as `git-filter-repo` spells it.
 *
 * `literal:` there means *this path or anything under it*, at a path boundary —
 * `filename_matches` in the filter's own source — which is exactly what a
 * `dir/**` rule and a bare file path both mean here. Anything else keeps its
 * wildcards and becomes a `glob:`, where the projection this file computes and
 * the filter's own `fnmatch` are two implementations of one rule; they are
 * reconciled after the run rather than assumed to agree.
 */
export function translateMatch(match: string): { kind: 'literal' | 'glob'; value: string } {
  if (match.endsWith('/**')) {
    const head = match.slice(0, -3);
    if (!/[*?[\]]/.test(head)) return { kind: 'literal', value: head };
  }
  if (!/[*?[\]]/.test(match)) return { kind: 'literal', value: match };
  return { kind: 'glob', value: match };
}

/**
 * The keep-list, derived from the record and from nothing else. A `public`
 * entry keeps its whole subtree; a `private` one contributes nothing; a
 * `partially-public` one contributes exactly its `public` path rules.
 */
export function keepSpecsFrom(document: DispositionDocument): KeepSpec[] {
  const specs: KeepSpec[] = [];
  for (const row of document.entries ?? []) {
    if (typeof row?.entry !== 'string' || row.entry === '') continue;
    if (row.disposition === 'public') {
      specs.push({ kind: 'literal', value: row.entry, source: row.entry });
      continue;
    }
    if (row.disposition !== 'partially-public') continue;
    for (const rule of row.paths ?? []) {
      if (rule?.disposition !== 'public' || typeof rule.match !== 'string') continue;
      const translated = translateMatch(rule.match);
      specs.push({ ...translated, source: `${row.entry} → ${rule.match}` });
    }
  }
  return specs;
}

function literalMatches(value: string, path: string): boolean {
  if (value === '') return true;
  if (!path.startsWith(value)) return false;
  return value.endsWith('/') || path.length === value.length || path[value.length] === '/';
}

function specMatches(spec: KeepSpec, path: string): boolean {
  return spec.kind === 'literal'
    ? literalMatches(spec.value, path)
    : globToRegExp(spec.value).test(path);
}

export interface Projection {
  readonly kept: readonly string[];
  readonly dropped: readonly string[];
}

/**
 * Which of a population's paths the projection carries. Exclude-by-default: a
 * path no keep spec reaches is dropped, and an excluded module directory is
 * subtracted afterwards, because D-246's list is a hole in a kept entry rather
 * than a fourth disposition.
 */
export function projectionOf(
  paths: readonly string[],
  specs: readonly KeepSpec[],
  excludedDirs: readonly string[],
): Projection {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const path of paths) {
    const excluded = excludedDirs.some((dir) => literalMatches(dir, path));
    if (!excluded && specs.some((spec) => specMatches(spec, path))) kept.push(path);
    else dropped.push(path);
  }
  return { kept, dropped };
}

export function renderPathsFile(specs: readonly KeepSpec[]): string {
  return specs.map((spec) => `${spec.kind}:${spec.value}\n`).join('');
}

// --- the module-id exclusion (D-246, resolved over the history) ------------

/** A module package, as its own declared manifest names it. */
export interface DeclaredModulePackage {
  readonly moduleId: string;
  readonly dir: string;
}

/** One historical `manifest.ts` blob and the id it declared about itself, if any. */
export interface HistoricalManifest {
  readonly path: string;
  readonly moduleId: string | null;
}

/**
 * What the resolution reads: every `manifest.ts` any commit held, and every
 * path any commit held. Both come from the **history being filtered**, never
 * from the working tree (129 FR-011(a), as amended 2026-09-17).
 */
export interface ModuleHistory {
  readonly manifests: readonly HistoricalManifest[];
  readonly paths: readonly string[];
  /** First-parent renames at `-M30%`, oldest last (D-272 clause 3). Absent reads as none. */
  readonly renames?: readonly RenamePair[];
  /** The paths the ref's own tree holds. Absent reads as an empty tip. */
  readonly tipPaths?: readonly string[];
}

/** One rename a first-parent commit recorded: `from` became `to`. */
export interface RenamePair {
  readonly from: string;
  readonly to: string;
}

/** One excluded id's resolution, in the form the report prints (129 FR-020 as amended). */
export interface ModuleResolution {
  readonly moduleId: string;
  /** Every resolved prefix: the manifest roots and the satellites history held. */
  readonly roots: readonly string[];
  /** Distinct historical paths under those prefixes. */
  readonly files: number;
  /** Historical paths the rename closure added (D-272 clause 3). */
  readonly renamed: number;
  /** Paths row W withheld, counted per host tree (D-272 clause 4). */
  readonly host: Readonly<Record<string, number>>;
  /** `moduleExclusions.withheldPaths` entries recorded under this id (D-272 clause 5). */
  readonly withheldPaths: number;
}

export interface ModuleExclusionResolution {
  /**
   * What the second pass removes: every resolved prefix for every id, then each
   * file the closure, row W and `withheldPaths` resolved — each a `literal:`
   * line, which `git-filter-repo` matches at a path boundary.
   */
  readonly paths: readonly string[];
  readonly perId: readonly ModuleResolution[];
  readonly findings: readonly Finding[];
}

/**
 * The id a lifecycle-shape `manifest.ts` declares about itself, read out of a
 * **blob** rather than off the disk: a module is a module because its manifest
 * says so (D-246, D-231). The same pattern the retired extraction deriver read
 * historical manifests with.
 */
export function declaredManifestId(source: string): string | null {
  return /defineModuleManifest\(\{[\s\S]*?\bid:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? null;
}

/**
 * The module root a historical `manifest.ts` path implies. A package keeps its
 * manifest at `src/manifest.ts`; the pre-packaging era kept it at the module
 * root itself.
 */
export function moduleRootOf(manifestPath: string): string {
  const withoutFile = manifestPath.slice(0, manifestPath.lastIndexOf('/'));
  return withoutFile.endsWith('/src') ? withoutFile.slice(0, -'/src'.length) : withoutFile;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The core-owned satellites of 129 FR-011(a), keyed to an id a manifest
 * declared — plus `admin/src/modules/<id>/`, which
 * `specs/134-paid-module-extraction/` T091 case 5 adds — each in **both**
 * spellings. Returns the prefix the second pass removes: the directory for a
 * directory convention, the file for a file convention.
 */
export function satellitePrefixOf(path: string, moduleId: string): string | null {
  const ids = moduleIdSpellings(moduleId).map(escapeRe).join('|');
  const conventions = [
    new RegExp(`^(backend/test/(?:unit|contract|integration|perf)/(?:${ids}))/`),
    new RegExp(`^(admin/test/modules/(?:${ids}))/`),
    new RegExp(`^(admin/src/modules/(?:${ids}))/`),
    new RegExp(`^(backend/scripts/ledgers/[^/]+/(?:${ids})\\.ts)$`),
    new RegExp(`^(packages/contracts/src/(?:${ids})\\.ts)$`),
  ];
  for (const convention of conventions) {
    const match = convention.exec(path);
    if (match) return match[1]!;
  }
  return null;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether a path is a member of, or lies under a member of, a set of prefixes —
 * by walking the path's own ancestors rather than the set, so that a set of
 * several thousand resolved files costs one lookup per path segment.
 */
function coveredBy(prefixes: ReadonlySet<string>): (path: string) => boolean {
  return (path) => {
    if (prefixes.has(path)) return true;
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
      if (prefixes.has(path.slice(0, at))) return true;
    }
    return false;
  };
}

/**
 * The host trees of D-272 clause 4 row **W**: where a file named for a vendor is
 * that vendor's artefact — its page, its translation cache, its fixture or
 * helper, its storefront fragment, its admin test, its example overlay.
 */
export const HOST_TREES = ['admin', 'storefront', 'docs', 'backend/test', 'backend/src/apps'] as const;

/** Which D-272 clause 4 row disposes of an id-carrying path the resolution did not reach. */
export type IdPathClass = 'P3' | 'P2' | 'P1' | 'W' | 'refuse';

/**
 * What the class table and the predicate read, derived from the history being
 * filtered: the excluded ids, the population the predicate's distinctive tokens
 * are derived against (every id any historical manifest declared, D-100), the
 * tip, and the free modules whose own files row **P2** exempts.
 */
export interface IdPathContext {
  readonly ids: readonly string[];
  readonly population: readonly string[];
  readonly tipPaths: ReadonlySet<string>;
  /** Manifest roots of every module that is not excluded — the closure's exception. */
  readonly freeRoots: readonly string[];
  /** Of those, the modules whose own id carries no excluded id — row P2's owners. */
  readonly p2Ids: readonly string[];
  readonly p2Roots: readonly string[];
  readonly matchers: ReadonlyMap<string, (path: string) => boolean>;
}

export function idPathContext(ids: readonly string[], history: ModuleHistory): IdPathContext {
  const excluded = new Set(ids);
  const population = [
    ...new Set([
      ...history.manifests.flatMap((m) => (m.moduleId === null ? [] : [m.moduleId])),
      ...ids,
    ]),
  ].sort();
  const matchers = new Map(ids.map((id) => [id, moduleIdMatcher(id, population)]));
  const free = population.filter((id) => !excluded.has(id));
  const p2Ids = free.filter((id) => !ids.some((x) => matchers.get(x)!(id)));
  const rootsOf = (owners: ReadonlySet<string>): string[] => [
    ...new Set(
      history.manifests
        .filter((m) => m.moduleId !== null && owners.has(m.moduleId))
        .map((m) => moduleRootOf(m.path)),
    ),
  ];
  return {
    ids,
    population,
    tipPaths: new Set(history.tipPaths ?? []),
    freeRoots: rootsOf(new Set(free)),
    p2Ids,
    p2Roots: rootsOf(new Set(p2Ids)),
    matchers,
  };
}

/** The excluded ids a path carries, by FR-011(d)'s predicate as D-272 amended it. */
export function carriedIds(path: string, context: IdPathContext): string[] {
  return context.ids.filter((id) => context.matchers.get(id)!(path));
}

/**
 * D-272 clause 4: the first row that matches an id-carrying path the manifest
 * roots, the satellites and the rename closure did not reach. **P3** — the tip
 * holds it, and SC-004 publishes it byte for byte. **P2** — a free module's own
 * file or satellite. **P1** — release notes. **W** — a host tree, withheld per
 * file. Anything else **refuses**, because outside the host trees a
 * vendor-named path is plausibly core code. The order is load-bearing: no row
 * below P3 may resolve a path the tip holds.
 */
export function idPathClass(path: string, context: IdPathContext): IdPathClass {
  if (context.tipPaths.has(path)) return 'P3';
  if (
    context.p2Roots.some((root) => isUnder(path, root)) ||
    context.p2Ids.some((id) => satellitePrefixOf(path, id) !== null)
  ) {
    return 'P2';
  }
  if (path.startsWith('.changeset/')) return 'P1';
  if (hostTreeOf(path) !== null) return 'W';
  return 'refuse';
}

function hostTreeOf(path: string): string | null {
  return HOST_TREES.find((tree) => isUnder(path, tree)) ?? null;
}

/** What {@link resolveModuleExclusions} is told beyond the ids and the history. */
export interface ResolveOptions {
  /**
   * Whether the keep-list publishes a path. Row W reads the **projected**
   * history, so a path the keep-list already drops is nobody's to withhold.
   * Absent: every path is kept.
   */
  readonly kept?: (path: string) => boolean;
  readonly withheldPaths?: readonly WithheldPathEntry[];
}

/**
 * Resolve each excluded id over the **history** (129 FR-011(a)–(c), as amended;
 * `specs/134-paid-module-extraction/` T091 and T094a).
 *
 * An id resolves to every directory a manifest declaring it occupied at any
 * commit — the module's own code, through the manifest and never through a
 * directory name — plus the satellites history held for it. The set is derived
 * here, on the day of the run, and never written down (FR-011(b)). D-272 adds
 * three steps, in this order, none of which may resolve a path the tip holds:
 *
 *   1. **The rename closure** (clause 3): every historical path a first-parent
 *      commit renamed, at `-M30%` and transitively, into a path already
 *      resolved to the id — except a rename source under the manifest root of a
 *      module that is not excluded, whose own code it was. Copies are not
 *      followed. It goes before the class table, so a path the closure reaches
 *      is resolved even where row P2 would exempt it.
 *   2. **Row W** of the class table (clause 4, {@link idPathClass}) over the
 *      projected history's id-carrying paths.
 *   3. **`withheldPaths`** (clause 5), the closed per-path residue.
 *
 * Refusals: an id no manifest declared **at any commit** (FR-011(c)) — a typo
 * resolves to nothing everywhere, while an id the extraction removed from the
 * tip resolves to its history, which is migration day's normal case; an id
 * listed twice; a non-empty list against a history holding no manifest at all;
 * and every way a `withheldPaths` entry can be wrong. An **empty** list is
 * silent and legitimate (FR-012).
 */
export function resolveModuleExclusions(
  ids: readonly string[],
  history: ModuleHistory,
  options: ResolveOptions = {},
): ModuleExclusionResolution {
  const withheld = options.withheldPaths ?? [];
  if (ids.length === 0) {
    const findings = withheld.map((entry) => ({
      kind: 'invalid-withheld-path' as const,
      subject: String(entry?.path),
      detail: 'recorded under an id the exclusion list does not hold — the list is empty',
    }));
    return { paths: [], perId: [], findings };
  }
  const findings: Finding[] = [];
  if (history.manifests.length === 0) {
    findings.push({
      kind: 'no-module-packages',
      subject: `${ids.length} excluded id(s)`,
      detail:
        'the history walk found no manifest at all, so every id below would resolve to ' +
        'nothing for a reason that is about the walk rather than about the list',
    });
    return { paths: [], perId: [], findings };
  }
  const seen = new Set<string>();
  const rootsById = new Map<string, string[]>();
  for (const id of ids) {
    if (seen.has(id)) {
      findings.push({
        kind: 'duplicate-module-id',
        subject: id,
        detail: 'listed twice — one id, one decision, or the second entry is invisible',
      });
      continue;
    }
    seen.add(id);
    const roots = new Set(
      history.manifests.filter((m) => m.moduleId === id).map((m) => moduleRootOf(m.path)),
    );
    if (roots.size === 0) {
      findings.push({
        kind: 'unresolved-module-id',
        subject: id,
        detail:
          'no manifest at any commit of the history declares this module id. A typo here ' +
          'publishes the module it was written to withhold, silently, into a repository that ' +
          'cannot take it back',
      });
      continue;
    }
    for (const path of history.paths) {
      const satellite = satellitePrefixOf(path, id);
      if (satellite !== null) roots.add(satellite);
    }
    rootsById.set(id, [...roots].sort());
  }
  if (findings.length > 0) return { paths: [], perId: [], findings };

  const context = idPathContext([...seen], history);
  const historySet = new Set(history.paths);
  const ownerOfRoot = new Map<string, string>();
  for (const [id, roots] of rootsById) for (const root of roots) ownerOfRoot.set(root, id);
  const underRoots = coveredBy(new Set(ownerOfRoot.keys()));
  const rootOwner = (path: string): string | undefined => {
    if (ownerOfRoot.has(path)) return ownerOfRoot.get(path);
    for (let at = path.lastIndexOf('/'); at !== -1; at = path.lastIndexOf('/', at - 1)) {
      const owner = ownerOfRoot.get(path.slice(0, at));
      if (owner !== undefined) return owner;
    }
    return undefined;
  };

  // 1. The rename closure, walked backwards from every resolved destination.
  const sourcesOf = new Map<string, string[]>();
  for (const { from, to } of history.renames ?? []) {
    const list = sourcesOf.get(to) ?? [];
    list.push(from);
    sourcesOf.set(to, list);
  }
  const closure = new Map<string, string>();
  const queue: [string, string][] = [];
  for (const to of sourcesOf.keys()) {
    const owner = rootOwner(to);
    if (owner !== undefined) queue.push([to, owner]);
  }
  while (queue.length > 0) {
    const [to, id] = queue.pop()!;
    for (const from of sourcesOf.get(to) ?? []) {
      if (closure.has(from) || underRoots(from) || context.tipPaths.has(from)) continue;
      if (context.freeRoots.some((root) => isUnder(from, root))) continue;
      closure.set(from, id);
      queue.push([from, id]);
    }
  }

  // 2. Row W, over the projected history's id-carrying paths.
  const kept = options.kept ?? (() => true);
  const hostWithheld = new Map<string, { id: string; tree: string }>();
  for (const path of history.paths) {
    if (underRoots(path) || closure.has(path)) continue;
    const carried = carriedIds(path, context);
    if (carried.length === 0 || !kept(path)) continue;
    if (idPathClass(path, context) !== 'W') continue;
    hostWithheld.set(path, { id: carried[0]!, tree: hostTreeOf(path)! });
  }

  // 3. The per-path residue, each entry checked against everything above.
  const residue = new Map<string, string>();
  const listed = new Set<string>();
  for (const entry of withheld) {
    const path = typeof entry?.path === 'string' ? entry.path : '';
    const refuse = (kind: FindingKind, detail: string): void => {
      findings.push({ kind, subject: path || '(no path)', detail });
    };
    if (listed.has(path)) {
      refuse('duplicate-withheld-path', 'listed twice — one path, one entry, one reason');
      continue;
    }
    listed.add(path);
    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < MIN_REASON) {
      refuse(
        'invalid-withheld-path',
        `a reason of at least ${MIN_REASON} characters is required: the entry has to say why ` +
          'no shape rule reaches the path',
      );
      continue;
    }
    if (!seen.has(entry.moduleId)) {
      refuse(
        'invalid-withheld-path',
        `recorded under \`${String(entry.moduleId)}\`, which the exclusion list does not hold`,
      );
      continue;
    }
    if (!historySet.has(path)) {
      refuse(
        'invalid-withheld-path',
        'no commit of the history holds this path. A typo here withholds nothing and says it did',
      );
      continue;
    }
    if (context.tipPaths.has(path)) {
      refuse(
        'invalid-withheld-path',
        'the tip holds this path, and SC-004 publishes the tip byte for byte — no rule may ' +
          'withhold it (D-272 clause 4)',
      );
      continue;
    }
    if (underRoots(path) || closure.has(path) || hostWithheld.has(path)) {
      refuse(
        'stale-withheld-path',
        'the resolution already withholds this path (manifest root, satellite, rename closure ' +
          'or host-tree rule), so the entry is stale. Remove it',
      );
      continue;
    }
    residue.set(path, entry.moduleId);
  }
  if (findings.length > 0) return { paths: [], perId: [], findings };

  const perId: ModuleResolution[] = [];
  for (const [id, prefixes] of rootsById) {
    const files = history.paths.filter((path) => prefixes.some((p) => isUnder(path, p))).length;
    const host: Record<string, number> = {};
    for (const { id: owner, tree } of hostWithheld.values()) {
      if (owner === id) host[tree] = (host[tree] ?? 0) + 1;
    }
    perId.push({
      moduleId: id,
      roots: prefixes,
      files,
      renamed: [...closure.values()].filter((owner) => owner === id).length,
      host,
      withheldPaths: [...residue.values()].filter((owner) => owner === id).length,
    });
  }
  const paths = [
    ...new Set([
      ...perId.flatMap((r) => r.roots),
      ...closure.keys(),
      ...hostWithheld.keys(),
      ...residue.keys(),
    ]),
  ].sort();
  return { paths, perId, findings };
}

/** What the completeness walk read and what it decided, for the report (FR-020, 126 FR-014). */
export interface CompletenessWalk {
  /** Every projected-history path the walk examined. */
  readonly examined: number;
  /** Of those, the id-carrying paths the resolution did not cover. */
  readonly idCarrying: number;
  readonly findings: readonly Finding[];
  /** The paths each exemption class published (D-272 clause 4). */
  readonly exempt: { readonly P1: readonly string[]; readonly P2: readonly string[]; readonly P3: readonly string[] };
}

/**
 * 129 FR-011(d) as amended by D-272: an incomplete resolution refuses rather
 * than publishes. Every path of the projected history that carries an excluded
 * id (the predicate's one home is `lib/module-id-paths.ts`) and that the
 * resolution does not cover is disposed of by {@link idPathClass}: P3, P2 and P1
 * are public and counted; anything else — a host-tree path row W should have
 * withheld, or a path outside the host trees — is printed and refuses. There is
 * no per-path public record (D-272 clause 4): the answer to a refusal is a class
 * widened with a reason, or a `withheldPaths` entry.
 */
export function completenessWalk(
  paths: readonly string[],
  resolved: readonly string[],
  context: IdPathContext,
): CompletenessWalk {
  const covered = coveredBy(new Set(resolved));
  const findings: Finding[] = [];
  const exempt = { P1: [] as string[], P2: [] as string[], P3: [] as string[] };
  let idCarrying = 0;
  for (const path of paths) {
    if (covered(path)) continue;
    const carried = carriedIds(path, context);
    if (carried.length === 0) continue;
    idCarrying += 1;
    const cls = idPathClass(path, context);
    if (cls === 'P1' || cls === 'P2' || cls === 'P3') {
      exempt[cls].push(path);
      continue;
    }
    findings.push({
      kind: 'uncovered-module-path',
      subject: path,
      detail:
        `carries the excluded id ${carried.join(', ')} and the resolution does not cover it. ` +
        (cls === 'W'
          ? 'It is in a host tree, where row W withholds it, yet the projection holds it: the ' +
            'second pass did not remove what the resolution named'
          : 'It is outside the host trees, where D-272 clause 4 refuses rather than guesses. ' +
            'Widen a class with a reason, or record it in `withheldPaths` — 129 FR-011(d) ' +
            'has no default'),
    });
  }
  for (const list of Object.values(exempt)) list.sort();
  return { examined: paths.length, idCarrying, findings, exempt };
}

/**
 * The report's completeness block (129 FR-020 as amended, D-272 clause 7): what
 * the walk examined, what it refused, one count per exemption class, and the
 * P2 and P3 paths — few, and the publish direction a reader must see. P1 is a
 * count. A resolved path is never printed.
 */
export function completenessLines(walk: CompletenessWalk): string[] {
  return [
    `[public-history-filter] completeness walk (129 FR-011(d)): ` +
      `projected-history-paths=${walk.examined} id-carrying=${walk.idCarrying} ` +
      `refused=${walk.findings.length} P1=${walk.exempt.P1.length} ` +
      `P2=${walk.exempt.P2.length} P3=${walk.exempt.P3.length}`,
    ...walk.exempt.P2.map((path) => `  - P2 (a free module's own file, public): ${path}`),
    ...walk.exempt.P3.map((path) => `  - P3 (held at the tip, public): ${path}`),
  ];
}

/** The report's module-id block: one line per id, counts and the roots, never the paths. */
export function moduleExclusionLines(
  ids: readonly string[],
  perId: readonly ModuleResolution[],
): string[] {
  if (ids.length === 0) {
    return [
      '[public-history-filter] module ids excluded: 0 (an empty list is legitimate — D-246, FR-012)',
    ];
  }
  const hostOf = (host: Readonly<Record<string, number>>): string => {
    const entries = Object.entries(host).sort(([a], [b]) => a.localeCompare(b));
    return entries.length === 0 ? 'none' : entries.map(([tree, n]) => `${tree}:${n}`).join(',');
  };
  return [
    `[public-history-filter] module ids excluded: ${ids.length}`,
    ...perId.map(
      (r) =>
        `  - ${r.moduleId} files=${r.files} renamed=${r.renamed} host=${hostOf(r.host)} ` +
        `withheld-paths=${r.withheldPaths} roots=${r.roots.join(', ')}`,
    ),
  ];
}

/**
 * Which of each id's resolved prefixes the **tip** still holds a path under —
 * FR-050's *"resolves at the tip"*, now that the resolution is over history.
 */
export function tipResolvedPaths(
  perId: readonly ModuleResolution[],
  tipPaths: readonly string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of perId) {
    const hits = tipPaths.filter((path) => r.roots.some((prefix) => isUnder(path, prefix)));
    if (hits.length > 0) out.set(r.moduleId, hits.sort());
  }
  return out;
}

/** What {@link tipResidueFindings} is told about the run it guards. */
export interface TipResidueOptions {
  /** `--allow-tip-residue`: a rehearsal while extraction waves are still landing. */
  readonly allowTipResidue: boolean;
  /** `--apply`: the final run, which the allowance never reaches. */
  readonly apply: boolean;
}

export interface TipResidue {
  /** Residue that refuses this run. */
  readonly findings: readonly Finding[];
  /** Residue a dry run was told to let through, reported rather than hidden. */
  readonly allowed: readonly Finding[];
}

/**
 * An excluded id whose module is **still declared at the tip** refuses the run
 * (`specs/136-open-source-publication/` FR-050, GAP-6).
 *
 * The exclusion is written for a module that has left this repository and
 * whose history must not follow it into the public one. An id still at the tip
 * is an extraction that has not finished: the second pass would strip the
 * module from a tip whose other packages still import it, or — were the list
 * resolved by history alone — the tip would be published with the module in
 * it. Neither is a projection anybody decided on, so the run refuses and names
 * each id with the root the tip holds it at.
 *
 * `tipPackages` is the **tip's** population — a scan of the tree being
 * projected — and stays that now the resolver is on history
 * (`specs/134-paid-module-extraction/` T091): the two questions are different,
 * "where has this id ever lived" and "is it still here". `resolvedAtTip` is the
 * second half of "still here": a history-resolved path — a satellite such as a
 * vendor contract module — that the tip still holds ({@link tipResolvedPaths}).
 * Left alone, the second pass would take it out of the published tip silently.
 *
 * `--allow-tip-residue` lets a **dry run** through while waves are still
 * landing, and what it let through is returned as `allowed` so the report says
 * so. It never reaches `--apply`: the final run may not carry residue.
 */
export function tipResidueFindings(
  ids: readonly string[],
  tipPackages: readonly DeclaredModulePackage[],
  options: TipResidueOptions,
  resolvedAtTip: ReadonlyMap<string, readonly string[]> = new Map(),
): TipResidue {
  const byId = new Map(tipPackages.map((pkg) => [pkg.moduleId, pkg]));
  const residue: Finding[] = [];
  for (const id of new Set(ids)) {
    const pkg = byId.get(id);
    const paths = resolvedAtTip.get(id) ?? [];
    if (pkg === undefined && paths.length === 0) continue;
    const where =
      pkg !== undefined
        ? `the tip still declares it at \`${pkg.dir}\``
        : `the tip still holds ${paths.length} path(s) its history resolves to, first ` +
          paths
            .slice(0, 5)
            .map((path) => `\`${path}\``)
            .join(', ');
    residue.push({
      kind: 'excluded-id-at-tip',
      subject: id,
      detail:
        `excluded, yet ${where}. Its extraction has not ` +
        'finished; the exclusion is for a module that has left this repository. ' +
        (options.apply
          ? 'The final run (--apply) refuses this whatever else is passed — ' +
            '--allow-tip-residue is for rehearsals only'
          : 'A rehearsal may pass --allow-tip-residue while waves are still landing'),
    });
  }
  if (options.allowTipResidue && !options.apply) return { findings: [], allowed: residue };
  return { findings: residue, allowed: [] };
}

// --- the replacement record (T022) -----------------------------------------

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The record's own validity, before a single commit is rewritten. Each shape
 * below is one the line-oriented file `git-filter-repo` parses cannot express,
 * or one whose result would be a message that still discloses.
 */
export function validateReplacements(document: MessageReplacementDocument): Finding[] {
  const findings: Finding[] = [];
  const literals = new Set<string>();
  for (const commit of document.commits ?? []) {
    const sha = typeof commit?.sha === 'string' ? commit.sha : '(unnamed)';
    if (!SHA_RE.test(sha)) {
      findings.push({
        kind: 'invalid-sha',
        subject: sha,
        detail: 'not a full 40-character commit id, so nothing can verify which commit it names',
      });
    }
    if (typeof commit.reason !== 'string' || commit.reason.trim() === '') {
      findings.push({
        kind: 'unreasoned-replacement',
        subject: sha,
        detail:
          'no reason. This record is the only account of why a published message differs from ' +
          'the historical one',
      });
    }
    for (const { literal, replacement } of commit.replacements ?? []) {
      if (typeof literal !== 'string' || literal.trim() === '') {
        findings.push({ kind: 'unusable-literal', subject: sha, detail: 'an empty literal' });
        continue;
      }
      if (/[\r\n]/.test(literal) || /[\r\n]/.test(replacement ?? '')) {
        findings.push({
          kind: 'unusable-literal',
          subject: `${sha}: ${literal.slice(0, 40)}…`,
          detail:
            'carries a newline. The replacement file is read a line at a time, so a literal ' +
            'spanning a wrap must be split at the wrap',
        });
        continue;
      }
      if (literal.includes('==>') || (replacement ?? '').includes('==>')) {
        findings.push({
          kind: 'unusable-literal',
          subject: sha,
          detail: "carries the file format's own `==>` separator, which it would be split on",
        });
        continue;
      }
      if ((replacement ?? '').includes(literal)) {
        findings.push({
          kind: 'self-referential-replacement',
          subject: sha,
          detail: 'the replacement still contains the literal, so the payload survives the run',
        });
      }
      if (literals.has(literal)) {
        findings.push({
          kind: 'duplicate-literal',
          subject: sha,
          detail: 'two entries claim one literal; the second can never be attributed',
        });
      }
      literals.add(literal);
    }
  }
  return findings;
}

export function renderReplaceMessageFile(document: MessageReplacementDocument): string {
  return (document.commits ?? [])
    .flatMap((commit) => commit.replacements ?? [])
    .map(({ literal, replacement }) => `literal:${literal}==>${replacement}\n`)
    .join('');
}

export interface PatternHit {
  readonly sha: string;
  readonly literal: string;
  readonly commits: readonly string[];
  readonly dropped: boolean;
}

export interface PatternAudit {
  readonly hits: readonly PatternHit[];
  readonly findings: readonly Finding[];
}

/**
 * What each literal actually reaches, measured over the messages themselves
 * before anything is rewritten.
 *
 * `--replace-message` is repository-wide: a literal short enough to occur in a
 * second commit silently rewrites that one too, and a literal that no longer
 * occurs rewrites nothing while the report still counts it. Both are refusals —
 * **except** where the path filter drops the commit the entry was written for,
 * which is the ordinary case for a spec-only commit and is silent.
 */
export function patternAudit(input: {
  document: MessageReplacementDocument;
  messages: ReadonlyMap<string, string>;
  survivors: ReadonlySet<string>;
}): PatternAudit {
  const hits: PatternHit[] = [];
  const findings: Finding[] = [];
  for (const commit of input.document.commits ?? []) {
    const dropped = !input.survivors.has(commit.sha);
    for (const { literal } of commit.replacements ?? []) {
      const matched: string[] = [];
      for (const [sha, message] of input.messages) {
        if (message.includes(literal)) matched.push(sha);
      }
      hits.push({ sha: commit.sha, literal, commits: matched, dropped });
      if (dropped) continue;
      const strays = matched.filter((sha) => sha !== commit.sha);
      if (strays.length > 0) {
        findings.push({
          kind: 'over-broad-literal',
          subject: `${commit.sha}: ${literal.slice(0, 60)}…`,
          detail:
            `also occurs in ${strays.length} other commit message(s) — ${strays
              .slice(0, 3)
              .join(', ')} — which this record does not account for. Lengthen the literal`,
        });
      }
      if (!matched.includes(commit.sha)) {
        findings.push({
          kind: 'inert-literal',
          subject: `${commit.sha}: ${literal.slice(0, 60)}…`,
          detail:
            'does not occur in the message it was written for, while that commit survives the ' +
            'path filter. The record has drifted from the history it describes',
        });
      }
    }
  }
  return { hits, findings };
}

// --- the text replacement (136 O-3, W2.4) ----------------------------------

/**
 * The classes O-3 admits: secrets, and the C2 and C3 classes of
 * `specs/conventions/commercial-data.md`. C4 in history stays accepted
 * (D-253, D-254); H, P, C1, L and R are fixed some other way or reported.
 */
export const REPLACEABLE_CLASSES = ['S', 'C2', 'C3'] as const;

export type ReplaceableClass = (typeof REPLACEABLE_CLASSES)[number];

/**
 * One literal to rewrite in historical blobs. `ref` is how every report names
 * it — the pre-publication scan's finding reference, typically — because the
 * literal is the payload and is never printed.
 */
export interface TextReplacementRule {
  readonly class: ReplaceableClass;
  readonly ref: string;
  readonly literal: string;
  readonly replacement: string;
  readonly reason: string;
  /**
   * S rules only, and required on them (D-273 clause 2): the ISO date the
   * operator attests the credential was revoked at its issuer (136 FR-004).
   */
  readonly revoked?: string;
}

export interface TextReplacementDocument {
  readonly version: number;
  readonly rules: readonly TextReplacementRule[];
}

const RULE_FIELDS = new Set(['class', 'ref', 'literal', 'replacement', 'reason', 'revoked']);

/** The vocabulary's own floor, which the reviewed-findings record also uses. */
const MIN_REASON = 8;

/**
 * The record's own validity, before a blob is rewritten. The shapes refused
 * are the message record's ({@link validateReplacements}) plus the two O-3
 * adds: a class it does not admit, and a field the record does not define.
 */
export function validateTextReplacements(document: TextReplacementDocument): Finding[] {
  const rules: unknown = (document as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) {
    return [
      {
        kind: 'invalid-replacement-rule',
        subject: '(record)',
        detail: 'the record carries no `rules` array, so nothing it says can be applied',
      },
    ];
  }
  const findings: Finding[] = [];
  const refs = new Set<string>();
  const literals = new Set<string>();
  for (const raw of rules as Record<string, unknown>[]) {
    const ref = typeof raw?.ref === 'string' && raw.ref.trim() !== '' ? raw.ref : null;
    if (ref === null) {
      findings.push({
        kind: 'invalid-replacement-rule',
        subject: '(no ref)',
        detail: 'a rule with no `ref` cannot be named in a report that never prints its literal',
      });
      continue;
    }
    if (refs.has(ref)) {
      findings.push({
        kind: 'invalid-replacement-rule',
        subject: ref,
        detail: 'two rules share one `ref`, so the report cannot tell them apart',
      });
      continue;
    }
    refs.add(ref);
    const unknown = Object.keys(raw).filter((key) => !RULE_FIELDS.has(key));
    if (unknown.length > 0 || typeof raw.replacement !== 'string') {
      findings.push({
        kind: 'invalid-replacement-rule',
        subject: ref,
        detail:
          unknown.length > 0
            ? `carries a field the record does not define: ${unknown.join(', ')}`
            : 'carries no string `replacement`',
      });
      continue;
    }
    if (!(REPLACEABLE_CLASSES as readonly unknown[]).includes(raw.class)) {
      findings.push({
        kind: 'disallowed-replacement-class',
        subject: ref,
        detail:
          `class ${JSON.stringify(raw.class)} is not one O-3 admits (${REPLACEABLE_CLASSES.join(', ')}). ` +
          'C4 in history stays accepted (D-253, D-254); every other class is fixed at the tip ' +
          'or reported',
      });
      continue;
    }
    if (typeof raw.reason !== 'string' || raw.reason.trim().length < MIN_REASON) {
      findings.push({
        kind: 'unreasoned-replacement',
        subject: ref,
        detail: `a reason of at least ${MIN_REASON} characters is required: this record is the ` +
          'only account of why a published historical blob differs from the original',
      });
    }
    const literal = typeof raw.literal === 'string' ? raw.literal : '';
    const replacement = raw.replacement;
    if (literal.trim() === '' || /[\r\n]/.test(literal) || /[\r\n]/.test(replacement)) {
      findings.push({
        kind: 'unusable-literal',
        subject: ref,
        detail:
          'empty, or carries a newline. The replacement file is read a line at a time, so a ' +
          'literal spanning lines must be split into one rule per line',
      });
      continue;
    }
    if (literal.includes('==>') || replacement.includes('==>')) {
      findings.push({
        kind: 'unusable-literal',
        subject: ref,
        detail: "carries the file format's own `==>` separator, which it would be split on",
      });
      continue;
    }
    if (replacement.includes(literal)) {
      findings.push({
        kind: 'self-referential-replacement',
        subject: ref,
        detail: 'the replacement still contains the literal, so the payload survives the run',
      });
    }
    if (literals.has(literal)) {
      findings.push({
        kind: 'duplicate-literal',
        subject: ref,
        detail: 'two rules claim one literal; the second can never be attributed',
      });
    }
    literals.add(literal);
  }
  return findings;
}

export function renderReplaceTextFile(document: TextReplacementDocument): string {
  return document.rules
    .map(({ literal, replacement }) => `literal:${literal}==>${replacement}\n`)
    .join('');
}

/**
 * The `--replace-text` record is read from **outside** the repository, and
 * anything inside it is refused. It carries the S rules (D-273 clause 2), whose
 * literals are credentials: a file kept beside the tree is one `git add` from
 * being committed, and a committed list of credentials is an index of them. So
 * the only place it may live is one this repository cannot stage. The C2/C3
 * rules have their own committed home, {@link TEXT_REPLACEMENTS_PATH}.
 */
export function replaceTextLocationRefusal(file: string, repoRoot: string): string | null {
  const rel = relative(resolvePath(repoRoot), resolvePath(file));
  const inside = rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${'/'}`));
  return inside
    ? `the --replace-text record resolves inside the repository (\`${rel || '.'}\`). Its ` +
        'literals are the payload — credentials, for class S — and a file inside the tree is ' +
        'one `git add` from being committed. Keep it outside the repository'
    : null;
}

/**
 * One of the two rule records D-273 gives the `--replace-text` pass, named in
 * the report by the SHA-256 of its bytes — never by its literals.
 */
export interface TextReplacementRecord {
  readonly label: string;
  readonly sha256: string;
  readonly document: TextReplacementDocument;
}

function recordOf(label: string, bytes: Buffer): TextReplacementRecord {
  return {
    label,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    document: JSON.parse(bytes.toString('utf8')) as TextReplacementDocument,
  };
}

/**
 * The committed C2/C3 record (D-273 clause 1), read on every run. Missing or
 * unreadable is a refusal (exit 2): `{ "rules": [] }` is the empty state, and a
 * run that cannot tell an empty record from an absent one has not looked.
 */
export function readCommittedTextRecord(repoRoot: string): TextReplacementRecord | { refusal: string } {
  const file = join(repoRoot, TEXT_REPLACEMENTS_PATH);
  if (!existsSync(file)) {
    return {
      refusal:
        `the committed text-replacement record is missing at \`${TEXT_REPLACEMENTS_PATH}\`. ` +
        'Its empty state is `{ "rules": [] }` (D-273); an absent file is not the same answer',
    };
  }
  try {
    return recordOf(TEXT_REPLACEMENTS_PATH, readFileSync(file));
  } catch (error) {
    return { refusal: `\`${TEXT_REPLACEMENTS_PATH}\` is not readable JSON: ${(error as Error).message}` };
  }
}

/** The outside `--replace-text` record, read as bytes so its SHA-256 is of what was read. */
export function readOutsideTextRecord(file: string): TextReplacementRecord | { refusal: string } {
  try {
    return recordOf('--replace-text (outside the repository)', readFileSync(file));
  } catch (error) {
    return { refusal: `the --replace-text record is not readable JSON: ${(error as Error).message}` };
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * D-273's placement refusals, each exit 2 because each is the record being in
 * the wrong place rather than a rule being wrong: each class has **one** home.
 * The committed record may hold no S rule and may not be reached by the
 * keep-list, which would publish the payload index. The outside record may hold
 * only S rules, each with a `revoked` ISO date.
 */
export function textRecordRefusals(input: {
  committed: TextReplacementRecord;
  outside: TextReplacementRecord | null;
  keep: readonly KeepSpec[];
}): string[] {
  const refusals: string[] = [];
  const rulesOf = (record: TextReplacementRecord): TextReplacementRule[] | null => {
    const rules: unknown = (record.document as { rules?: unknown } | null)?.rules;
    return Array.isArray(rules) ? (rules as TextReplacementRule[]) : null;
  };
  const committed = rulesOf(input.committed);
  if (committed === null) {
    refusals.push(`\`${input.committed.label}\` carries no \`rules\` array; its empty state is \`{ "rules": [] }\``);
  } else {
    for (const rule of committed.filter((r) => r?.class === 'S')) {
      refusals.push(
        `\`${input.committed.label}\` holds the S rule \`${String(rule.ref)}\`. An S literal is a ` +
          'credential and is never committed (D-273 clause 2): move the rule to the outside ' +
          '--replace-text record, and revoke the credential at its issuer first',
      );
    }
  }
  if (input.keep.some((spec) => specMatches(spec, TEXT_REPLACEMENTS_PATH))) {
    refusals.push(
      `the keep-list reaches \`${TEXT_REPLACEMENTS_PATH}\`, which would publish the index of ` +
        'every literal the pass removes. Record it `private` in the disposition record (D-273)',
    );
  }
  if (input.outside !== null) {
    const outside = rulesOf(input.outside);
    if (outside === null) {
      refusals.push('the --replace-text record carries no `rules` array');
    } else {
      for (const rule of outside) {
        const ref = String(rule?.ref);
        if (rule?.class !== 'S') {
          refusals.push(
            `the --replace-text record holds the ${String(rule?.class)} rule \`${ref}\`. C2 and C3 ` +
              `rules live in \`${TEXT_REPLACEMENTS_PATH}\`, reviewed in a merge request (D-273)`,
          );
        } else if (!isIsoDate(rule.revoked)) {
          refusals.push(
            `the S rule \`${ref}\` carries no \`revoked\` ISO date (YYYY-MM-DD). Revocation at the ` +
              'issuer comes first (136 FR-004), and the rule is where the operator states it happened',
          );
        }
      }
    }
  }
  return refusals;
}

/** Both records as the one pass's input; a `ref` repeated across them is then a validation finding. */
export function combineTextRecords(
  committed: TextReplacementRecord,
  outside: TextReplacementRecord | null,
): TextReplacementDocument {
  return {
    version: 1,
    rules: [...committed.document.rules, ...(outside?.document.rules ?? [])],
  };
}

/** One `--replace-text` rule as the report names it — never with its literal. */
export interface TextReplacementReport {
  readonly ref: string;
  readonly class: string;
  readonly blobsBefore: number;
  /** `null` when the rewrite did not run because the record refused first. */
  readonly blobsAfter: number | null;
  readonly revoked?: string;
}

/**
 * The report's text-replacement block: each record by SHA-256, each rule by
 * `ref`, class and reach, never a literal (contract §3 amendment, D-273).
 */
export function textRecordLines(
  records: readonly TextReplacementRecord[],
  rules: readonly TextReplacementReport[],
): string[] {
  return [
    `[public-history-filter] text-replacement records (136 O-3, D-273; literals not printed — ` +
      `they are the payload): ${records.length}`,
    ...records.map(
      (record) =>
        `  - ${record.label} sha256=${record.sha256} rules=${record.document.rules.length}`,
    ),
    `[public-history-filter] text replacements (historical blobs only): ${rules.length}`,
    ...rules.map(
      (rule) =>
        `  - ${rule.ref} [${rule.class}] historical-blobs=${rule.blobsBefore} ` +
        (rule.blobsAfter === null ? 'not applied' : `surviving=${rule.blobsAfter}`) +
        (rule.revoked === undefined ? '' : ` revoked=${rule.revoked}`),
    ),
  ];
}

/** Where one rule's literal was found, per the projection's blob population. */
export interface LiteralReach {
  /** Distinct blobs holding it that the tip does not hold. */
  readonly historyBlobs: number;
  /** Tip paths whose blob holds it. */
  readonly tipPaths: readonly string[];
}

/**
 * Which blobs hold each literal. A blob the tip holds counts toward the tip
 * whatever older commits also hold it, because it is one object.
 */
export function literalCensus(input: {
  blobs: Iterable<{ readonly id: string; readonly data: Buffer }>;
  tip: ReadonlyMap<string, string>;
  rules: readonly TextReplacementRule[];
}): Map<string, LiteralReach> {
  const tipPathsByBlob = new Map<string, string[]>();
  for (const [path, blob] of input.tip) {
    const paths = tipPathsByBlob.get(blob) ?? [];
    paths.push(path);
    tipPathsByBlob.set(blob, paths);
  }
  const needles = input.rules.map((rule) => ({ ref: rule.ref, bytes: Buffer.from(rule.literal) }));
  const history = new Map<string, number>(input.rules.map((rule) => [rule.ref, 0]));
  const tip = new Map<string, string[]>(input.rules.map((rule) => [rule.ref, []]));
  for (const blob of input.blobs) {
    for (const needle of needles) {
      if (!blob.data.includes(needle.bytes)) continue;
      const atTip = tipPathsByBlob.get(blob.id);
      if (atTip === undefined) history.set(needle.ref, history.get(needle.ref)! + 1);
      else tip.get(needle.ref)!.push(...atTip);
    }
  }
  return new Map(
    input.rules.map((rule) => [
      rule.ref,
      { historyBlobs: history.get(rule.ref)!, tipPaths: [...tip.get(rule.ref)!].sort() },
    ]),
  );
}

/**
 * O-3's restriction, checked rather than assumed: a rule may rewrite only blobs
 * **absent from the tip**, so the tip stays byte-identical (129 SC-004, which
 * {@link byteIdentityFindings} still asserts over the result). A literal at the
 * tip refuses — the tip is fixed by an ordinary commit, per the scan contract's
 * table. A rule that reaches nothing refuses, as a drifted record. And after the
 * rewrite, a literal still present anywhere refuses: `git-filter-repo` skips a
 * blob it classifies as binary, and that is exactly the case to hear about.
 */
export function textReplacementFindings(input: {
  rules: readonly TextReplacementRule[];
  before: ReadonlyMap<string, LiteralReach>;
  after: ReadonlyMap<string, LiteralReach> | null;
}): Finding[] {
  const findings: Finding[] = [];
  for (const rule of input.rules) {
    const before = input.before.get(rule.ref);
    if (before === undefined) continue;
    if (before.tipPaths.length > 0) {
      findings.push({
        kind: 'replacement-reaches-tip',
        subject: rule.ref,
        detail:
          `its literal is in ${before.tipPaths.length} file(s) at the tip — ` +
          `${before.tipPaths.slice(0, 5).join(', ')}. --replace-text rewrites only blobs absent ` +
          'from the tip (136 O-3): a tip site is fixed by an ordinary commit first, and ' +
          'rewriting it here would break 129 SC-004',
      });
    } else if (before.historyBlobs === 0) {
      findings.push({
        kind: 'inert-text-replacement',
        subject: rule.ref,
        detail:
          'its literal is in no blob of the projection — either the path filter already ' +
          'withholds the content, or the record has drifted from the history it describes',
      });
    }
    const after = input.after?.get(rule.ref);
    if (after !== undefined && after.historyBlobs + after.tipPaths.length > 0) {
      findings.push({
        kind: 'text-payload-survived',
        subject: rule.ref,
        detail:
          `its literal is still in ${after.historyBlobs + after.tipPaths.length} blob(s) after ` +
          'the rewrite. git-filter-repo skips a blob it classifies as binary',
      });
    }
  }
  return findings;
}

// --- the commit map (FR-013) -----------------------------------------------

/** `git-filter-repo`'s `commit-map`: one `old new` pair per original commit. */
export function parseCommitMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const [oldSha, newSha] = line.trim().split(/\s+/);
    if (oldSha === undefined || newSha === undefined) continue;
    if (!SHA_RE.test(oldSha)) continue;
    map.set(oldSha, newSha);
  }
  return map;
}

/**
 * Two passes, one published mapping. The module-id exclusion (D-246) is a
 * second `git-filter-repo` run when the list is non-empty, and its map is keyed
 * by the *first* pass's ids — which nobody outside this run has ever seen. What
 * FR-013 publishes is original → final, so the two are composed, and a commit
 * the second pass drops maps to the sentinel rather than to a stale id.
 */
export function composeCommitMaps(
  first: ReadonlyMap<string, string>,
  second: ReadonlyMap<string, string>,
): Map<string, string> {
  const composed = new Map<string, string>();
  for (const [original, intermediate] of first) {
    if (intermediate === DROPPED) {
      composed.set(original, DROPPED);
      continue;
    }
    composed.set(original, second.get(intermediate) ?? intermediate);
  }
  return composed;
}

/**
 * Which of the two shapes the second pass's `commit-map` is in, answered by
 * reading it rather than by trusting a paragraph.
 *
 * `git-filter-repo` keeps a **cumulative** map when it is run twice on the same
 * repository: the second run's file is still keyed by the **original** ids, not
 * by the first pass's. Composing that again looks up a first-pass id in a map
 * keyed by originals, misses, and falls through to the first-pass id — which
 * exists in no repository anybody will ever hold, and FR-013's published
 * mapping is then wrong for exactly the commits the exclusion touched.
 *
 * **This was measured rather than reasoned about**: the first end-to-end run
 * with a non-empty exclusion list reconciled 2676 of 4275 surviving commits,
 * and {@link vacuousReason}'s reconciliation guard is what refused it. The
 * detection is kept in both directions because the behaviour is somebody
 * else's program's and may change; the guard stays the backstop either way.
 */
export function commitMapAfterSecondPass(
  first: ReadonlyMap<string, string>,
  second: ReadonlyMap<string, string>,
): Map<string, string> {
  const cumulative = first.size > 0 && [...first.keys()].every((sha) => second.has(sha));
  return cumulative ? new Map(second) : composeCommitMaps(first, second);
}

// --- the assertions about the projected tree (SC-004) ----------------------

/**
 * The migrated tree is byte-identical to the pre-migration tree for every file
 * it keeps — the property that stops day one in the canonical repository
 * starting with an unexplainable red, because the suite and the 40 checks are
 * green against exactly these bytes.
 *
 * Both directions are findings, and the second is the one that publishes:
 * `missing-from-projection` is a file the record keeps and the filter lost,
 * `undisposed-in-projection` is a file the filter carried that the record does
 * not keep.
 */
export function byteIdentityFindings(input: {
  source: ReadonlyMap<string, string>;
  projected: ReadonlyMap<string, string>;
  expectedKept: ReadonlySet<string>;
}): Finding[] {
  const findings: Finding[] = [];
  for (const path of input.expectedKept) {
    if (!input.projected.has(path)) {
      findings.push({
        kind: 'missing-from-projection',
        subject: path,
        detail: 'the record keeps it and the filtered tree does not carry it',
      });
    }
  }
  for (const [path, blob] of input.projected) {
    if (!input.expectedKept.has(path)) {
      findings.push({
        kind: 'undisposed-in-projection',
        subject: path,
        detail:
          'the filtered tree carries it and the keep-list this record derives does not reach ' +
          'it. This is the direction that publishes',
      });
      continue;
    }
    const before = input.source.get(path);
    if (before !== undefined && before !== blob) {
      findings.push({
        kind: 'content-changed',
        subject: path,
        detail: `blob ${before} became ${blob}: the filter changed a file's bytes, and message ` +
          'replacement is meant to be its only content change',
      });
    }
  }
  return findings;
}

/**
 * **Every path the projection ever held**, at any commit, is one the record
 * keeps — 126 FR-011's R2 as the one-time migration assertion it becomes under
 * D-241 (spec §3.2).
 *
 * This is the assertion `byteIdentityFindings` cannot make and the one the
 * whole operation exists for. A path filter is run instead of a deletion commit
 * precisely because a file deleted at the tip is still in the history under
 * MIT, readable by anybody who clones — so an instrument that reads `HEAD`
 * reports exactly the tree that a deletion commit would have produced, and
 * calls it clean.
 */
export function historicalDisclosureFindings(
  paths: readonly string[],
  specs: readonly KeepSpec[],
  excludedDirs: readonly string[],
): Finding[] {
  return projectionOf(paths, specs, excludedDirs).dropped.map((path) => ({
    kind: 'private-path-in-history' as const,
    subject: path,
    detail:
      'the filtered history holds this path at some commit and the keep-list does not reach ' +
      'it. Deleting it at the tip would not answer this: the bytes are in the history, under ' +
      'the published licence, for anybody who clones',
  }));
}

/**
 * Every surviving message is its original with the **declared** replacements
 * applied, and nothing else (FR-010).
 *
 * This is the assertion `--preserve-commit-hashes` buys. Without it the filter
 * rewrites quoted hashes across thousands of messages and this reconciliation
 * cannot tell that class of change from a rule reaching further than its record
 * says.
 */
export function messageIdentityFindings(input: {
  original: ReadonlyMap<string, string>;
  projected: ReadonlyMap<string, string>;
  document: MessageReplacementDocument;
}): Finding[] {
  const findings: Finding[] = [];
  const all = (input.document.commits ?? []).flatMap((c) => c.replacements ?? []);
  for (const [sha, projected] of input.projected) {
    const before = input.original.get(sha);
    if (before === undefined) continue;
    let expected = before;
    for (const { literal, replacement } of all) expected = expected.split(literal).join(replacement);
    if (expected !== projected) {
      findings.push({
        kind: 'undeclared-message-change',
        subject: sha,
        detail:
          'the projected message is not its original with the declared replacements applied. ' +
          "Message replacement is the filter's only sanctioned content change",
      });
    }
    for (const { literal } of all) {
      if (projected.includes(literal)) {
        findings.push({
          kind: 'payload-survived',
          subject: sha,
          detail: `a declared literal is still present in the published message: ${literal.slice(0, 50)}…`,
        });
      }
    }
  }
  return findings;
}

// --- the vacuous guard (FR-020, 126 FR-014) --------------------------------

export interface WalkSizes {
  readonly pathsRead: number;
  readonly commitsRead: number;
  readonly survivingCommits: number;
  /** Surviving messages actually reconciled against their originals. */
  readonly reconciledMessages: number;
  /** Distinct paths the projected history holds, at any commit. */
  readonly projectedPathsRead: number;
  readonly commitMapEntries: number;
  readonly dispositionsRead: number;
  readonly replacementsRead: number;
}

/**
 * The #244 predicate for this tool: a green that means *"did not look"*. A
 * filter that walks nothing produces a beautiful empty report, and the report
 * is the only place anybody sees the result before it is irreversible.
 */
export function vacuousReason(sizes: WalkSizes): string | null {
  if (sizes.dispositionsRead === 0) {
    return 'the disposition record resolved no entry, so every path would be dropped for a ' +
      'reason that is about the record rather than about the tree';
  }
  if (sizes.pathsRead === 0) return 'the walk read no path at all';
  if (sizes.commitsRead === 0) return 'the walk read no commit at all';
  if (sizes.survivingCommits === 0) {
    return 'no commit survived the filter, which is a filter that projected nothing';
  }
  if (sizes.projectedPathsRead === 0) {
    return 'the walk over the projected history read no path, so the assertion that it holds ' +
      'nothing private is a green over an empty set';
  }
  if (sizes.reconciledMessages < sizes.survivingCommits) {
    return `the message reconciliation reached ${sizes.reconciledMessages} of ` +
      `${sizes.survivingCommits} surviving commits, so the assertion that no message changed ` +
      'except the declared ones is a green over a set it never built';
  }
  if (sizes.commitMapEntries < sizes.commitsRead) {
    return `the commit map holds ${sizes.commitMapEntries} entries for a walk of ` +
      `${sizes.commitsRead} commits, so the rewrite did not reach every commit it read`;
  }
  return null;
}

// --- the run ----------------------------------------------------------------

function git(args: readonly string[], cwd: string = REPO_ROOT): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
}

/** Every path the tree holds today, which is the population the record resolves. */
function treePaths(): string[] {
  const out = git(['ls-files', '--cached', '--others', '--exclude-standard']);
  return [...new Set(out.split('\n').filter((l) => l !== ''))];
}

/** Path → blob id for one revision, which is what byte identity is measured on. */
function treeBlobs(rev: string, cwd: string): Map<string, string> {
  const out = git(['ls-tree', '-r', '--format=%(objectname) %(path)', rev], cwd);
  const map = new Map<string, string>();
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const space = line.indexOf(' ');
    map.set(line.slice(space + 1), line.slice(0, space));
  }
  return map;
}

/** sha → full message, for every commit reachable from a revision. */
function messagesOf(rev: string, cwd: string): Map<string, string> {
  // `-z` terminates each commit's output with a NUL, which is the one byte a
  // commit message cannot carry and therefore the only safe record separator.
  // It is spelled `\0` below rather than as a unicode escape on purpose: a
  // `\u0000` written through a JSON-payload tool arrives as the actual byte and
  // classifies this file binary (`specs/conventions/check-estate.md`).
  const out = git(['log', '-z', '--format=%H%n%B', rev], cwd);
  const messages = new Map<string, string>();
  for (const block of out.split('\0')) {
    if (block === '') continue;
    const newline = block.indexOf('\n');
    if (newline === -1) continue;
    messages.set(block.slice(0, newline), block.slice(newline + 1));
  }
  return messages;
}

/**
 * Every distinct path reachable history ever held, at any commit.
 *
 * `--diff-merges=first-parent`, because `git log` prints **no diff for a merge
 * commit**, and a path a merge resolution wrote is then in no walk at all (D-246
 * as amended records the measurement). `--no-renames`, so that a rename is the
 * old path and the new one. **No pathspec**: history simplification can omit
 * commits under one.
 */
function historicalPathsOf(rev: string, cwd: string = REPO_ROOT): string[] {
  const out = git(
    ['log', '-z', '--format=', '--name-only', '--no-renames', '--diff-merges=first-parent', rev],
    cwd,
  );
  return [...new Set(out.split('\0').map((line) => line.replace(/^\n+/, '')).filter((l) => l !== ''))];
}

/**
 * Every rename a first-parent commit recorded, at D-272 clause 3's threshold.
 *
 * `-M30%` is D-264's measured threshold, below git's default 50%.
 * `--diff-merges=first-parent` for the reason {@link historicalPathsOf} gives.
 * `-l0` lifts git's rename limit, which otherwise skips the exhaustive pairing
 * in a commit touching more files than `diff.renameLimit` allows — and the
 * packaging migration moved modules in exactly such commits. On this history
 * the walk answers the same with and without it; the flag keeps a lowered
 * local `diff.renameLimit` from changing that silently. Copies (`C`) are never
 * followed: the source of a copy survives, and is its own file.
 */
export function readRenamePairs(rev: string, cwd: string = REPO_ROOT): RenamePair[] {
  const out = git(
    ['log', '-z', '--format=', '--name-status', '-M30%', '-l0', '--diff-merges=first-parent', rev],
    cwd,
  );
  const tokens = out.split('\0');
  const pairs: RenamePair[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const status = tokens[i]!.replace(/^\n+/, '');
    if (status === '') continue;
    if (/^[RC]\d*$/.test(status)) {
      const from = tokens[i + 1] ?? '';
      const to = tokens[i + 2] ?? '';
      i += 2;
      if (status.startsWith('R') && from !== '' && to !== '') pairs.push({ from, to });
      continue;
    }
    i += 1;
  }
  return pairs;
}

/**
 * What {@link resolveModuleExclusions} reads: every path the history held, and
 * every `manifest.ts` blob any commit wrote, with the id it declared — plus the
 * first-parent renames (D-272 clause 3) and the ref's own tree, which no rule
 * of D-272 may resolve a path of. Read from the **ref being filtered**, never
 * from the working tree (129 FR-011(a); 134 T091). The same three flags as
 * {@link historicalPathsOf}, for the same reasons.
 */
export function readModuleHistory(rev: string, cwd: string = REPO_ROOT): ModuleHistory {
  const paths = historicalPathsOf(rev, cwd);
  const raw = git(
    [
      'log',
      '-z',
      '--format=',
      '--raw',
      '--no-abbrev',
      '--no-renames',
      '--diff-merges=first-parent',
      rev,
    ],
    cwd,
  );
  const tokens = raw.split('\0');
  const touched = new Map<string, string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const meta = tokens[i]!.replace(/^\n+/, '');
    if (!meta.startsWith(':')) continue;
    const path = tokens[i + 1]!;
    i += 1;
    if (path !== 'manifest.ts' && !path.endsWith('/manifest.ts')) continue;
    const blob = meta.split(' ')[3] ?? '';
    if (!/^[0-9a-f]{40,64}$/.test(blob) || /^0+$/.test(blob)) continue;
    touched.set(`${blob} ${path}`, blob);
  }
  const blobs = [...new Set(touched.values())];
  const sources = new Map<string, string>();
  if (blobs.length > 0) {
    for (const { id, data } of catFileBatch(blobs, cwd)) sources.set(id, data.toString('utf8'));
  }
  const manifests: HistoricalManifest[] = [];
  for (const [key, blob] of touched) {
    manifests.push({
      path: key.slice(key.indexOf(' ') + 1),
      moduleId: declaredManifestId(sources.get(blob) ?? ''),
    });
  }
  const tipPaths = git(['ls-tree', '-r', '-z', '--name-only', rev], cwd)
    .split('\0')
    .filter((path) => path !== '');
  return { manifests, paths, renames: readRenamePairs(rev, cwd), tipPaths };
}

/** `git cat-file --batch` over a list of object ids, parsed as bytes. */
function catFileBatch(ids: readonly string[], cwd: string): { id: string; data: Buffer }[] {
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${ids.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  const objects: { id: string; data: Buffer }[] = [];
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at);
    if (eol === -1) break;
    const header = out.subarray(at, eol).toString('utf8').split(' ');
    if (header[1] === 'missing') {
      at = eol + 1;
      continue;
    }
    const size = Number(header[2]);
    objects.push({ id: header[0]!, data: out.subarray(eol + 1, eol + 1 + size) });
    at = eol + 1 + size + 1;
  }
  return objects;
}

/**
 * Every blob reachable from `rev`, read in batches bounded by size so that a
 * repository of a gigabyte and more never has to sit in one buffer.
 */
function* reachableBlobs(rev: string, cwd: string): Generator<{ id: string; data: Buffer }> {
  const ids = git(['rev-list', '--objects', rev], cwd)
    .split('\n')
    .map((line) => line.split(' ')[0]!)
    .filter((id) => id !== '');
  const checked = execFileSync(
    'git',
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { cwd, input: `${ids.join('\n')}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const CHUNK = 128 * 1024 * 1024;
  let batch: string[] = [];
  let size = 0;
  for (const line of checked.split('\n')) {
    const [id, type, bytes] = line.split(' ');
    if (type !== 'blob' || id === undefined) continue;
    batch.push(id);
    size += Number(bytes);
    if (size >= CHUNK) {
      yield* catFileBatch(batch, cwd);
      batch = [];
      size = 0;
    }
  }
  if (batch.length > 0) yield* catFileBatch(batch, cwd);
}

/** Every top-level name **history** ever held, which today's tree cannot answer. */
function historicalRootEntries(rev: string): string[] {
  // `-z` rather than newlines: `git log --name-only` quotes a path carrying a
  // special character, and a quoted path read as a name puts `\"storefront`
  // into the report as a top-level entry that never existed.
  const out = git([
    'log',
    '-z',
    '--format=',
    '--name-only',
    '--no-renames',
    '--diff-merges=first-parent',
    rev,
  ]);
  const roots = new Set<string>();
  for (const entry of out.split('\0')) {
    const line = entry.replace(/^\n+/, '');
    if (line === '') continue;
    const slash = line.indexOf('/');
    roots.add(slash === -1 ? line : line.slice(0, slash));
  }
  return [...roots].sort();
}

/**
 * A top-level name history held that the keep-list reaches **nowhere** inside.
 *
 * Reported rather than refused: the disposition record is derived from today's
 * tree, so a directory deleted years ago has no row and never will, and
 * exclude-by-default is the safe direction for it. What is not safe is nobody
 * knowing which ones those are, since each is a whole subtree leaving the
 * public history.
 */
export function historicalRootsDroppedBy(
  roots: readonly string[],
  specs: readonly KeepSpec[],
): string[] {
  return roots.filter(
    (root) =>
      !specs.some((spec) => spec.value === root || spec.value.startsWith(`${root}/`)) &&
      !specs.some((spec) => specMatches(spec, root)),
  );
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function refuse(message: string): never {
  console.error(`[public-history-filter] ${message}`);
  process.exit(2);
}

/** `git-filter-repo`, however this machine spells it. It is never vendored. */
function resolveFilterRepo(): readonly string[] {
  const declared = process.env.ENDORA_GIT_FILTER_REPO;
  if (declared !== undefined && declared !== '') {
    return declared.endsWith('.py') || declared.includes('/')
      ? ['python3', declared]
      : [declared];
  }
  for (const candidate of [
    ['git', 'filter-repo'],
    ['git-filter-repo'],
  ]) {
    try {
      execFileSync(candidate[0]!, [...candidate.slice(1), '--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next spelling */
    }
  }
  return refuse(
    'git-filter-repo is not on this machine. It is the operation D-240 rules (and the one ' +
      'this script does not reimplement): install it, or point ENDORA_GIT_FILTER_REPO at a ' +
      'checkout of the script. Refusing rather than reporting a projection nothing produced',
  );
}

interface RunReport {
  readonly mode: 'dry-run' | 'apply';
  readonly ref: string;
  readonly sourceSha: string;
  readonly sizes: WalkSizes;
  readonly keptFiles: number;
  readonly droppedFiles: number;
  readonly keptBytes: number;
  readonly excludedEntries: readonly { subject: string; disposition: string; reason: string }[];
  readonly moduleIds: readonly string[];
  readonly moduleResolutions: readonly ModuleResolution[];
  /** The completeness walk (129 FR-011(d)); `null` when no id is excluded. */
  readonly completeness: CompletenessWalk | null;
  /** The committed record, and the outside one when given (D-273). */
  readonly textRecords: readonly TextReplacementRecord[];
  readonly textReplacements: readonly TextReplacementReport[];
  /** Excluded ids still at the tip that `--allow-tip-residue` let a dry run through with. */
  readonly tipResidueAllowed: readonly string[];
  readonly historicalRootsDropped: readonly string[];
  readonly patterns: readonly PatternHit[];
  readonly replacedCommits: readonly { sha: string; class: string; label: string }[];
  readonly deterministic: boolean | null;
  readonly findings: readonly Finding[];
}

function excludedEntriesOf(document: DispositionDocument): RunReport['excludedEntries'] {
  const rows: RunReport['excludedEntries'] = [];
  const out = rows as { subject: string; disposition: string; reason: string }[];
  for (const row of document.entries ?? []) {
    if (row.disposition === 'private') {
      out.push({ subject: row.entry, disposition: 'private', reason: row.reason });
      continue;
    }
    for (const rule of row.paths ?? []) {
      if (rule.disposition === 'private') {
        out.push({ subject: rule.match, disposition: 'private', reason: rule.reason });
      }
    }
  }
  return rows;
}

function formatReport(report: RunReport): string[] {
  const lines: string[] = [];
  const p = (s: string): number => lines.push(s);
  p(`[public-history-filter] mode=${report.mode} ref=${report.ref} source=${report.sourceSha}`);
  p(
    `[public-history-filter] read: paths=${report.sizes.pathsRead} ` +
      `commits=${report.sizes.commitsRead} dispositions=${report.sizes.dispositionsRead} ` +
      `replacements=${report.sizes.replacementsRead} ` +
      `commit-map=${report.sizes.commitMapEntries} ` +
      `messages-reconciled=${report.sizes.reconciledMessages} ` +
      `projected-history-paths=${report.sizes.projectedPathsRead}`,
  );
  p(
    `[public-history-filter] projection: files=${report.keptFiles} ` +
      `bytes=${report.keptBytes} dropped-files=${report.droppedFiles} ` +
      `commits=${report.sizes.survivingCommits} ` +
      `dropped-commits=${report.sizes.commitsRead - report.sizes.survivingCommits}`,
  );
  p('[public-history-filter] excluded by disposition:');
  for (const row of report.excludedEntries) {
    p(`  - ${row.subject} [${row.disposition}] ${row.reason.slice(0, 110)}`);
  }
  for (const line of moduleExclusionLines(report.moduleIds, report.moduleResolutions)) p(line);
  if (report.completeness !== null) {
    for (const line of completenessLines(report.completeness)) p(line);
  }
  if (report.tipResidueAllowed.length > 0) {
    p(
      `[public-history-filter] still at the tip, let through by --allow-tip-residue ` +
        `(a rehearsal, not a publishable run): ${report.tipResidueAllowed.join(', ')}`,
    );
  }
  p(
    `[public-history-filter] historical top-level names the keep-list drops: ` +
      `${report.historicalRootsDropped.length}`,
  );
  for (const root of report.historicalRootsDropped) p(`  - ${root}`);
  // The literals are the payload. This report is read by a human before an
  // irreversible run (FR-021) and is quoted in the merge request that performs
  // it, so it names each replacement by its label and its reach and leaves the
  // text in the private record it came from.
  p(
    `[public-history-filter] message replacements (literals in \`${REPLACEMENTS_PATH}\`, ` +
      'not printed here — they are the payload):',
  );
  for (const commit of report.replacedCommits) {
    const hits = report.patterns.filter((hit) => hit.sha === commit.sha);
    const dropped = hits.every((hit) => hit.dropped);
    p(
      `  - ${commit.sha.slice(0, 9)} [${commit.class}] literals=${hits.length} ` +
        `${dropped ? 'commit dropped by the path filter' : `commits-reached=${new Set(hits.flatMap((h) => h.commits)).size}`}` +
        ` :: ${commit.label}`,
    );
  }
  for (const line of textRecordLines(report.textRecords, report.textReplacements)) p(line);
  p(
    `[public-history-filter] determinism: ${
      report.deterministic === null
        ? 'no previous map at this --out; run again to compare (FR-013)'
        : report.deterministic
          ? "identical to the previous run's commit map"
          : 'THE COMMIT MAP CHANGED between two runs over an unchanged tree'
    }`,
  );
  p(`[public-history-filter] findings=${report.findings.length}`);
  return lines;
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const allowTipResidue = argv.includes('--allow-tip-residue');
  const ref = valueOf(argv, '--ref') ?? 'HEAD';
  const replaceTextArg = valueOf(argv, '--replace-text');
  const gitDir = git(['rev-parse', '--absolute-git-dir']).trim();
  const out = valueOf(argv, '--out') ?? join(gitDir, 'endora-public-history');

  const recordPath = join(REPO_ROOT, DISPOSITIONS_PATH);
  const replacementsPath = join(REPO_ROOT, REPLACEMENTS_PATH);
  if (!existsSync(recordPath)) {
    refuse(
      `the disposition record is missing at \`${DISPOSITIONS_PATH}\`. After the migration it ` +
        'stays on the historical side (D-247), and this script has no projection to compute ' +
        'without it',
    );
  }
  if (!existsSync(replacementsPath)) {
    refuse(`the message-replacement record is missing at \`${REPLACEMENTS_PATH}\``);
  }
  let document: DispositionDocument;
  let replacements: MessageReplacementDocument;
  try {
    document = readJson<DispositionDocument>(recordPath);
    replacements = readJson<MessageReplacementDocument>(replacementsPath);
  } catch (error) {
    return refuse(`a record is not readable JSON: ${(error as Error).message}`);
  }
  const exclusionBlock = (document as { moduleExclusions?: ModuleExclusionBlock })
    .moduleExclusions;
  const specs = keepSpecsFrom(document);
  // D-273: the C2/C3 rules are a committed private record read on every run;
  // the S rules come only from outside the repository. Both feed one pass.
  const committedText = readCommittedTextRecord(REPO_ROOT);
  if ('refusal' in committedText) refuse(committedText.refusal);
  let outsideText: TextReplacementRecord | null = null;
  if (replaceTextArg !== undefined) {
    const file = resolvePath(replaceTextArg);
    const misplaced = replaceTextLocationRefusal(file, REPO_ROOT);
    if (misplaced !== null) refuse(misplaced);
    if (!existsSync(file)) refuse(`the --replace-text record does not exist: ${file}`);
    const read = readOutsideTextRecord(file);
    if ('refusal' in read) refuse(read.refusal);
    outsideText = read;
  }
  const placement = textRecordRefusals({ committed: committedText, outside: outsideText, keep: specs });
  if (placement.length > 0) {
    refuse(`the text-replacement records are misplaced (D-273):\n  - ${placement.join('\n  - ')}`);
  }
  const textRecords = outsideText === null ? [committedText] : [committedText, outsideText];
  const textRecord = combineTextRecords(committedText, outsideText);
  const filterRepo = resolveFilterRepo();

  // 1. The record against today's tree. An entry with no disposition refuses
  //    here exactly as it refuses in `check:root-dispositions` — one statement
  //    of the rule, imported rather than restated.
  const paths = treePaths();
  const analysis = analyseDispositions({ paths, document });
  const refusing = new Set<string>([
    'undisposed-root-entry',
    'undisposed-path',
    'invalid-disposition',
    'duplicate-disposition',
  ]);
  const findings: Finding[] = analysis.findings
    .filter((f) => refusing.has(f.kind))
    .map((f) => ({ kind: f.kind as FindingKind, subject: f.subject, detail: f.detail }));
  for (const f of analysis.findings) {
    if (!refusing.has(f.kind)) {
      console.warn(`[public-history-filter] note: [${f.kind}] ${f.subject}: ${f.detail}`);
    }
  }

  // 2. The keep-list and the module-id exclusion.
  const modulePackages = discoverModulePackages(REPO_ROOT).map((pkg) => ({
    moduleId: pkg.moduleId,
    dir: pkg.dir.startsWith(REPO_ROOT)
      ? pkg.dir.slice(REPO_ROOT.length).replace(/^[/\\]+/, '')
      : pkg.dir,
  }));
  const moduleIds = exclusionBlock?.moduleIds ?? [];
  // 129 FR-011(a)–(c) as amended by D-272: each id resolves over the history of
  // the ref being filtered (134 T091, T094a), never over the working tree, and
  // row W reads the projected history — the keep-list applied. An empty list
  // reads nothing and says so (FR-012).
  const history: ModuleHistory =
    moduleIds.length === 0 ? { manifests: [], paths: [] } : readModuleHistory(ref, REPO_ROOT);
  const exclusions = resolveModuleExclusions(moduleIds, history, {
    kept: (path) => specs.some((spec) => specMatches(spec, path)),
    withheldPaths: exclusionBlock?.withheldPaths ?? [],
  });
  findings.push(...exclusions.findings);
  // FR-050: "is it still here" is the tip's question — a package the tip still
  // declares, or any history-resolved path the tip still holds.
  const residue = tipResidueFindings(
    moduleIds,
    modulePackages,
    { allowTipResidue, apply },
    tipResolvedPaths(exclusions.perId, paths),
  );
  findings.push(...residue.findings);
  for (const f of residue.allowed) {
    console.warn(
      `[public-history-filter] allowed by --allow-tip-residue (rehearsal only): ` +
        `[${f.kind}] ${f.subject}: ${f.detail}`,
    );
  }
  findings.push(...validateReplacements(replacements));
  findings.push(...validateTextReplacements(textRecord));

  const projection = projectionOf(paths, specs, exclusions.paths);
  const sourceSha = git(['rev-parse', ref]).trim();
  const originalMessages = messagesOf(sourceSha, REPO_ROOT);
  const sourceBlobs = treeBlobs(sourceSha, REPO_ROOT);
  const historicalRoots = historicalRootEntries(sourceSha);
  const historicalRootsDropped = historicalRootsDroppedBy(historicalRoots, specs);

  if (findings.length > 0) {
    // The refusals above are about the *record*. Computing a projection from a
    // record that does not describe the tree would report a tree nobody is
    // going to publish, which is worse than no report.
    console.error('[public-history-filter] the record refuses this run before it starts:');
    for (const f of findings) console.error(`  - [${f.kind}] ${f.subject}: ${f.detail}`);
    process.exit(1);
  }

  // 3. The filter itself, in a clone of its own. `--force` is safe and is not
  //    a shortcut: the repository it operates on was created by this run, three
  //    lines above, and is deleted by the next one.
  mkdirSync(out, { recursive: true });
  const projectionDir = join(out, 'projection');
  rmSync(projectionDir, { recursive: true, force: true });
  git(['clone', '--no-local', '--single-branch', '--quiet', REPO_ROOT, projectionDir]);
  const clonedHead = git(['rev-parse', 'HEAD'], projectionDir).trim();
  if (clonedHead !== sourceSha) {
    refuse(
      `the clone's HEAD is ${clonedHead} and the ref asked for is ${sourceSha}. A projection ` +
        'of a different commit than the one measured is a report about nothing',
    );
  }
  const pathsFile = join(out, 'paths.txt');
  const replaceFile = join(out, 'replace-message.txt');
  writeFileSync(pathsFile, renderPathsFile(specs), 'utf8');
  writeFileSync(replaceFile, renderReplaceMessageFile(replacements), 'utf8');

  const filterArgs = [
    '--paths-from-file',
    pathsFile,
    '--replace-message',
    replaceFile,
    // FR-010: message replacement is the only content change. Without this the
    // filter rewrites quoted commit hashes across thousands of messages.
    '--preserve-commit-hashes',
    '--force',
  ];
  execFileSync(filterRepo[0]!, [...filterRepo.slice(1), ...filterArgs], {
    cwd: projectionDir,
    stdio: 'inherit',
  });
  let commitMap = parseCommitMap(
    readFileSync(join(projectionDir, '.git', 'filter-repo', 'commit-map'), 'utf8'),
  );

  // 3b. D-246's exclusion is a second pass, because a keep-list cannot subtract.
  //     Empty today, and the composition below is what keeps FR-013's mapping
  //     keyed to the original ids rather than to a pass nobody has seen.
  if (exclusions.paths.length > 0) {
    const excludeFile = join(out, 'module-exclusions.txt');
    writeFileSync(excludeFile, exclusions.paths.map((p) => `literal:${p}\n`).join(''), 'utf8');
    execFileSync(
      filterRepo[0]!,
      [
        ...filterRepo.slice(1),
        '--paths-from-file',
        excludeFile,
        '--invert-paths',
        '--preserve-commit-hashes',
        '--force',
      ],
      { cwd: projectionDir, stdio: 'inherit' },
    );
    commitMap = commitMapAfterSecondPass(
      commitMap,
      parseCommitMap(
        readFileSync(join(projectionDir, '.git', 'filter-repo', 'commit-map'), 'utf8'),
      ),
    );
  }

  // 3c. O-3's redaction (136 W2.4): a third pass, `--replace-text`, over blobs
  //     absent from the tip only. The census before it is what enforces that
  //     restriction — a literal at the tip refuses, and the pass never runs —
  //     and the census after it is what proves the payload left every blob.
  //     SC-004 is then asserted below exactly as for a run without it.
  let textReplacements: TextReplacementReport[] = [];
  if (textRecord.rules.length > 0) {
    const rules = textRecord.rules;
    const before = literalCensus({
      blobs: reachableBlobs('HEAD', projectionDir),
      tip: treeBlobs('HEAD', projectionDir),
      rules,
    });
    let pre = textReplacementFindings({ rules, before, after: null });
    let after: Map<string, LiteralReach> | null = null;
    if (pre.length === 0) {
      const textFile = join(out, 'replace-text.txt');
      writeFileSync(textFile, renderReplaceTextFile(textRecord), { encoding: 'utf8', mode: 0o600 });
      try {
        execFileSync(
          filterRepo[0]!,
          [
            ...filterRepo.slice(1),
            '--replace-text',
            textFile,
            '--preserve-commit-hashes',
            '--force',
          ],
          { cwd: projectionDir, stdio: 'inherit' },
        );
      } finally {
        // The rendered file is the payload spelled out; it does not outlive the pass.
        rmSync(textFile, { force: true });
      }
      commitMap = commitMapAfterSecondPass(
        commitMap,
        parseCommitMap(
          readFileSync(join(projectionDir, '.git', 'filter-repo', 'commit-map'), 'utf8'),
        ),
      );
      after = literalCensus({
        blobs: reachableBlobs('HEAD', projectionDir),
        tip: treeBlobs('HEAD', projectionDir),
        rules,
      });
      pre = textReplacementFindings({ rules, before, after });
    }
    findings.push(...pre);
    textReplacements = rules.map((rule) => ({
      ref: rule.ref,
      class: rule.class,
      blobsBefore: before.get(rule.ref)?.historyBlobs ?? 0,
      blobsAfter:
        after === null
          ? null
          : (after.get(rule.ref)?.historyBlobs ?? 0) + (after.get(rule.ref)?.tipPaths.length ?? 0),
      ...(rule.revoked === undefined ? {} : { revoked: rule.revoked }),
    }));
  }

  // 4. Everything below is measured on the **projection**, never on the tree it
  //    was derived from.
  const projectedHead = git(['rev-parse', 'HEAD'], projectionDir).trim();
  const projectedBlobs = treeBlobs(projectedHead, projectionDir);
  const projectedMessages = messagesOf(projectedHead, projectionDir);
  const survivingCommits = projectedMessages.size;
  const survivors = new Set<string>();
  for (const [original, rewritten] of commitMap) {
    if (rewritten !== DROPPED && projectedMessages.has(rewritten)) survivors.add(original);
  }
  const originalByProjected = new Map<string, string>();
  for (const [original, rewritten] of commitMap) {
    if (rewritten !== DROPPED) originalByProjected.set(rewritten, original);
  }
  const projectedByOriginal = new Map<string, string>();
  for (const [rewritten, message] of projectedMessages) {
    const original = originalByProjected.get(rewritten);
    if (original !== undefined) projectedByOriginal.set(original, message);
  }

  const audit = patternAudit({ document: replacements, messages: originalMessages, survivors });
  findings.push(...audit.findings);
  // Derived from the revision's own tree rather than from `projection`, whose
  // population is the index: the two agree in a clean checkout and diverge in
  // one with staged work, and an assertion about the projected tree may not
  // rest on which of the two the runner happened to have.
  const expectedKept = new Set(projectionOf([...sourceBlobs.keys()], specs, exclusions.paths).kept);
  findings.push(
    ...byteIdentityFindings({
      source: sourceBlobs,
      projected: projectedBlobs,
      expectedKept,
    }),
  );
  const projectedHistoryPaths = historicalPathsOf(projectedHead, projectionDir);
  findings.push(...historicalDisclosureFindings(projectedHistoryPaths, specs, exclusions.paths));
  // 129 FR-011(d) as amended by D-272: what the projection still holds that
  // carries an excluded id is either public by class (P1–P3) or refuses. Read
  // over the projection itself, so a path the second pass failed to remove is
  // seen here rather than assumed gone.
  const completeness =
    moduleIds.length === 0
      ? null
      : completenessWalk(projectedHistoryPaths, exclusions.paths, idPathContext(moduleIds, history));
  if (completeness !== null) findings.push(...completeness.findings);
  findings.push(
    ...messageIdentityFindings({
      original: originalMessages,
      projected: projectedByOriginal,
      document: replacements,
    }),
  );

  // 5. Determinism (FR-013), checked rather than asserted: the previous run's
  //    map, if this `--out` holds one, against this run's.
  const mapPath = join(out, 'commit-map');
  const previous = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : null;
  const serialised = [...commitMap]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([oldSha, newSha]) => `${oldSha} ${newSha}`)
    .join('\n');
  const deterministic = previous === null ? null : previous.trimEnd() === serialised;
  if (previous !== null && !deterministic) {
    findings.push({
      kind: 'non-deterministic-map',
      subject: mapPath,
      detail:
        'two runs over an unchanged tree produced different commit maps. The published SHAs ' +
        "are the final dry run's (FR-013), so this has to be understood before the push",
    });
    // Keep the disagreeing pair. Overwriting the earlier map would leave a
    // finding whose evidence the same line had just deleted, on the one
    // property nobody can re-derive afterwards.
    writeFileSync(join(out, 'commit-map.previous'), previous, 'utf8');
  }
  writeFileSync(mapPath, `${serialised}\n`, 'utf8');

  const keptBytes = Number(
    git(['ls-tree', '-r', '--format=%(objectsize)', projectedHead], projectionDir)
      .split('\n')
      .filter((l) => l !== '')
      .reduce((sum, size) => sum + BigInt(size), 0n),
  );

  const sizes: WalkSizes = {
    pathsRead: paths.length,
    commitsRead: originalMessages.size,
    survivingCommits,
    reconciledMessages: projectedByOriginal.size,
    projectedPathsRead: projectedHistoryPaths.length,
    commitMapEntries: commitMap.size,
    dispositionsRead: analysis.resolved,
    replacementsRead: replacements.commits.length,
  };
  const report: RunReport = {
    mode: apply ? 'apply' : 'dry-run',
    ref,
    sourceSha,
    sizes,
    keptFiles: projectedBlobs.size,
    droppedFiles: projection.dropped.length,
    keptBytes,
    excludedEntries: excludedEntriesOf(document),
    moduleIds,
    moduleResolutions: exclusions.perId,
    completeness,
    textRecords,
    textReplacements,
    tipResidueAllowed: residue.allowed.map((f) => f.subject),
    historicalRootsDropped,
    patterns: audit.hits,
    replacedCommits: replacements.commits.map((c) => ({
      sha: c.sha,
      class: c.class,
      label: c.label,
    })),
    deterministic,
    findings,
  };
  const lines = formatReport(report);
  for (const line of lines) console.log(line);
  writeFileSync(
    join(out, 'report.json'),
    `${JSON.stringify(
      {
        ...report,
        patterns: report.patterns.map(({ literal, ...rest }) => ({ ...rest, literalLength: literal.length })),
        // The records' rules carry the literals, which are the payload.
        textRecords: report.textRecords.map((r) => ({
          label: r.label,
          sha256: r.sha256,
          rules: r.document.rules.length,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(join(out, 'report.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`[public-history-filter] artefacts: ${out}`);

  const vacuous = vacuousReason(sizes);
  if (vacuous !== null) {
    console.error(`[public-history-filter] refusing a vacuous run: ${vacuous}`);
    process.exit(2);
  }
  if (findings.length > 0) {
    console.error('\n[public-history-filter] findings:');
    for (const f of findings.slice(0, 50)) console.error(`  - [${f.kind}] ${f.subject}: ${f.detail}`);
    if (findings.length > 50) console.error(`  … and ${findings.length - 50} more`);
    process.exit(1);
  }
  if (apply) {
    console.log(
      `\n[public-history-filter] the projection is at ${projectionDir}. Its SHAs are the ones ` +
        'to publish (FR-013). The push is T031 and this script never performs it:\n' +
        `  git -C ${projectionDir} remote add origin <canonical>\n` +
        `  git -C ${projectionDir} push --all origin`,
    );
  }
  process.exit(0);
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

// Run as CLI only — importing this module from a unit test must not clone a
// repository or exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
