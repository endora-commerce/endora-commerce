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
 * `--replace-message` over the seven commit messages of
 * `specs/126-public-mirror-disclosure/spec.md` §2.1 — **and no other content
 * change of any kind.** Two consequences of that last clause are decisions
 * this file takes and states rather than leaves to be discovered:
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
 * Usage:
 *
 *   `tsx scripts/public-history-filter.ts [--ref <rev>] [--out <dir>] [--apply]`
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  analyseDispositions,
  type DispositionDocument,
  DISPOSITIONS_PATH,
  globToRegExp,
} from './check-root-dispositions.js';
import { discoverModulePackages } from './lib/module-packages.js';

export type { DispositionDocument };

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** The message-replacement record (T022), beside the dispositions it is read with. */
export const REPLACEMENTS_PATH =
  'specs/129-github-canonical-migration/contracts/message-replacements.json';

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
}

export type FindingKind =
  | 'undisposed-root-entry'
  | 'undisposed-path'
  | 'invalid-disposition'
  | 'duplicate-disposition'
  | 'unresolved-module-id'
  | 'duplicate-module-id'
  | 'no-module-packages'
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
  | 'non-deterministic-map';

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

// --- the module-id exclusion (D-246) ---------------------------------------

/** A module package, as its own declared manifest names it. */
export interface DeclaredModulePackage {
  readonly moduleId: string;
  readonly dir: string;
}

export interface ModuleExclusionResolution {
  readonly paths: readonly string[];
  readonly findings: readonly Finding[];
}

/**
 * Resolve each excluded id to the package directory **its own manifest
 * declares** — never to a directory convention, because a package is a module
 * because it says so and not because of where it sits (D-246, D-231).
 *
 * Two refusals and one silence. An id that resolves to nothing **refuses the
 * run**: it is a typo, not an empty set, and a typo publishes the very module
 * it was written to withhold, into a repository that cannot take it back. An
 * id listed twice refuses, because the second entry is invisible. An **empty**
 * list is silent and legitimate (FR-012) — and a non-empty list against a scan
 * that found no module packages at all is the vacuous case wearing the list's
 * clothes, so it refuses too.
 */
export function resolveModuleExclusions(
  ids: readonly string[],
  packages: readonly DeclaredModulePackage[],
): ModuleExclusionResolution {
  if (ids.length === 0) return { paths: [], findings: [] };
  const findings: Finding[] = [];
  if (packages.length === 0) {
    findings.push({
      kind: 'no-module-packages',
      subject: `${ids.length} excluded id(s)`,
      detail:
        'the workspace scan found no module package at all, so every id below would resolve ' +
        'to nothing for a reason that is about the walk rather than about the list',
    });
    return { paths: [], findings };
  }
  const byId = new Map(packages.map((pkg) => [pkg.moduleId, pkg]));
  const seen = new Set<string>();
  const paths: string[] = [];
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
    const pkg = byId.get(id);
    if (pkg === undefined) {
      findings.push({
        kind: 'unresolved-module-id',
        subject: id,
        detail:
          'no workspace package declares this module id. A typo here publishes the module it ' +
          'was written to withhold, silently, into a repository that cannot take it back',
      });
      continue;
    }
    paths.push(pkg.dir);
  }
  return { paths: findings.length > 0 ? [] : paths, findings };
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

/** Every distinct path reachable history ever held, at any commit. */
function historicalPathsOf(rev: string, cwd: string = REPO_ROOT): string[] {
  const out = git(['log', '-z', '--format=', '--name-only', '--no-renames', rev], cwd);
  return [...new Set(out.split('\0').filter((line) => line !== ''))];
}

/** Every top-level name **history** ever held, which today's tree cannot answer. */
function historicalRootEntries(rev: string): string[] {
  // `-z` rather than newlines: `git log --name-only` quotes a path carrying a
  // special character, and a quoted path read as a name puts `\"storefront`
  // into the report as a top-level entry that never existed.
  const out = git(['log', '-z', '--format=', '--name-only', '--no-renames', rev]);
  const roots = new Set<string>();
  for (const line of out.split('\0')) {
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
  readonly modulePaths: readonly string[];
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
  p(
    `[public-history-filter] module ids excluded: ${
      report.moduleIds.length === 0
        ? '0 (an empty list is legitimate — D-246, FR-012)'
        : report.moduleIds.join(', ')
    }`,
  );
  for (const path of report.modulePaths) p(`  - ${path}`);
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
  const ref = valueOf(argv, '--ref') ?? 'HEAD';
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
  const specs = keepSpecsFrom(document);
  const modulePackages = discoverModulePackages(REPO_ROOT).map((pkg) => ({
    moduleId: pkg.moduleId,
    dir: pkg.dir.startsWith(REPO_ROOT)
      ? pkg.dir.slice(REPO_ROOT.length).replace(/^[/\\]+/, '')
      : pkg.dir,
  }));
  const moduleIds = exclusionBlock?.moduleIds ?? [];
  const exclusions = resolveModuleExclusions(moduleIds, modulePackages);
  findings.push(...exclusions.findings);
  findings.push(...validateReplacements(replacements));

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
    commitMap = composeCommitMaps(
      commitMap,
      parseCommitMap(
        readFileSync(join(projectionDir, '.git', 'filter-repo', 'commit-map'), 'utf8'),
      ),
    );
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
  if (deterministic === false) {
    findings.push({
      kind: 'non-deterministic-map',
      subject: mapPath,
      detail:
        'two runs over an unchanged tree produced different commit maps. The published SHAs ' +
        "are the final dry run's (FR-013), so this has to be understood before the push",
    });
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
    modulePaths: exclusions.paths,
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
    `${JSON.stringify({ ...report, patterns: report.patterns.map(({ literal, ...rest }) => ({ ...rest, literalLength: literal.length })) }, null, 2)}\n`,
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
