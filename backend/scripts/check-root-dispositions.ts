/**
 * CI check — every top-level entry of this repository has a **recorded
 * disposition**, and an entry that has none refuses
 * (`specs/129-github-canonical-migration/` T012 / FR-003; D-232's second
 * amendment, clauses (i) and (ii)).
 *
 * ## Why this is a standing check and not a stage of the filter
 *
 * The migration filter does not exist yet, and the hazard this refuses is
 * produced by **ordinary merges at ordinary speed** rather than by the
 * migration. D-232's amendment argued in the abstract that an include-list is
 * the wrong shape because *"nothing in this ruling decides what happens to entry
 * number forty"*, and measured **39** top-level entries the morning it was
 * written. Entry number forty — `CONTRIBUTING.md`, a good file added by an
 * ordinary merge — arrived the same day, carrying no disposition, by people who
 * had no reason to have read a clause written that morning. **Nobody did
 * anything wrong; there was simply no instrument.** A disposition file that
 * lands now catches entry forty-one; the same file written alongside the filter
 * would first run against a population that had been drifting for weeks, by
 * somebody with no way to tell a deliberate addition from an oversight.
 *
 * ## What it refuses, and why the default is refusal in *neither* direction
 *
 *   * `undisposed-root-entry` — the tree holds an entry the record does not
 *     name. **This is the rule.** It does not default to private and it does
 *     not default to public: a refusal costs whoever added the entry five
 *     minutes, and a default is a decision nobody took, one of whose two
 *     directions is irreversible in public.
 *   * `undisposed-path` — a file under a `partially-public` entry that matches
 *     no recorded path rule. The same rule one level down, and it is the one
 *     that would have caught the single real leak this estate found: a standing
 *     `specs/*.md` document that travelled because the ruling's phrasing was
 *     shaped like a directory and the file was not one.
 *   * `stale-disposition` — the record names an entry the tree no longer holds,
 *     and `unreachable-path-rule` — a path rule that matched nothing. Both are
 *     the ratchet's other direction. Without them the record accretes ghosts,
 *     and a reader cannot tell which rows still describe the tree from which
 *     ones are answering a question nobody asks any more.
 *   * `duplicate-disposition` and `invalid-disposition` — two rows for one
 *     entry, a disposition outside the three words, a `partially-public` entry
 *     with no path rules, or a row with no reason. A reason is not decoration:
 *     without one a disposition is a vote, and with one it is a decision the
 *     next reader can disagree with by name.
 *
 * ## Exit codes
 *
 * `0` clean, `1` findings, `2` **a vacuous pass refused** — a missing or
 * unparseable record, an empty walk, or a walk shorter than the commit tree's
 * own count of root entries. The vacuous case is the #244 predicate and it is
 * the one that matters most here: a green that means *"not looking"* is the
 * failure this estate exists against, and this check's green is the one nobody
 * would question. `reportReadSize` owns all three refusals, so the vacuous
 * verdict enters where a real run enters rather than being re-derived here.
 *
 * Usage: `tsx scripts/check-root-dispositions.ts [--list]`
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { reportReadSize } from './lib/read-size.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** Where the record lives. One file, read by this check and by the filter. */
export const DISPOSITIONS_PATH =
  'specs/129-github-canonical-migration/contracts/root-dispositions.json';

/** The three words a disposition may be. */
export type Disposition = 'public' | 'private' | 'partially-public';

/** A rule inside a `partially-public` entry. First match wins; there is no default. */
export interface PathRule {
  readonly match: string;
  readonly disposition: 'public' | 'private';
  readonly reason: string;
}

export interface RootDisposition {
  readonly entry: string;
  readonly disposition: Disposition;
  readonly reason: string;
  readonly paths?: readonly PathRule[];
}

export interface DispositionDocument {
  readonly version: number;
  readonly notes?: readonly string[];
  readonly entries: readonly RootDisposition[];
}

export type FindingKind =
  | 'undisposed-root-entry'
  | 'undisposed-path'
  | 'stale-disposition'
  | 'unreachable-path-rule'
  | 'duplicate-disposition'
  | 'invalid-disposition';

export interface Finding {
  readonly kind: FindingKind;
  readonly subject: string;
  readonly detail: string;
}

export interface DispositionInput {
  /**
   * Every path the tree holds, repository-relative and forward-slashed. The
   * population is **derived** and never written down (D-100).
   */
  readonly paths: readonly string[];
  readonly document: DispositionDocument;
}

export interface DispositionAnalysis {
  readonly findings: readonly Finding[];
  /** The derived top-level entries. */
  readonly rootEntries: readonly string[];
  /** Dispositions resolved: one per root entry, plus one per path under a partial entry. */
  readonly resolved: number;
}

/**
 * A glob over repository-relative paths: `**` crosses separators, `*` and `?`
 * do not, and a character class is passed through.
 *
 * Deliberately small. The alternative was a dependency, and Constitution IV's
 * default answer to a new runtime dependency is no — for a matcher this check
 * uses over three shapes of pattern, the justification would have to be written
 * and would not survive being written.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? '';
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) {
        out += '\\[';
      } else {
        out += glob.slice(i, end + 1);
        i = end;
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('.+^${}()|\\/'.includes(c)) {
      out += c === '/' ? '/' : `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`${out}$`);
}

/** The first path segment of every path, uniquely, in tree order. */
export function rootEntriesOf(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const path of paths) {
    const first = path.split('/')[0];
    if (first !== undefined && first !== '') seen.add(first);
  }
  return [...seen].sort();
}

function validate(document: DispositionDocument): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const row of document.entries ?? []) {
    const name = typeof row?.entry === 'string' ? row.entry : '(unnamed)';
    if (seen.has(name)) {
      findings.push({
        kind: 'duplicate-disposition',
        subject: name,
        detail: 'recorded twice — one entry, one decision, or the second one is invisible',
      });
    }
    seen.add(name);
    if (name === '(unnamed)' || name.trim() === '') {
      findings.push({
        kind: 'invalid-disposition',
        subject: name,
        detail: 'a row with no `entry` names nothing and can resolve nothing',
      });
      continue;
    }
    if (
      row.disposition !== 'public' &&
      row.disposition !== 'private' &&
      row.disposition !== 'partially-public'
    ) {
      findings.push({
        kind: 'invalid-disposition',
        subject: name,
        detail: `disposition ${JSON.stringify(row.disposition)} is not one of public, private, partially-public`,
      });
    }
    if (typeof row.reason !== 'string' || row.reason.trim() === '') {
      findings.push({
        kind: 'invalid-disposition',
        subject: name,
        detail:
          'no reason. A disposition without one is a vote; with one it is a decision the ' +
          'next reader can disagree with by name',
      });
    }
    const rules = row.paths ?? [];
    if (row.disposition === 'partially-public' && rules.length === 0) {
      findings.push({
        kind: 'invalid-disposition',
        subject: name,
        detail: 'partially-public with no path rules resolves no file under it',
      });
    }
    if (row.disposition !== 'partially-public' && rules.length > 0) {
      findings.push({
        kind: 'invalid-disposition',
        subject: name,
        detail: `path rules under a ${row.disposition} entry are never consulted`,
      });
    }
    for (const rule of rules) {
      if (typeof rule?.match !== 'string' || rule.match.trim() === '') {
        findings.push({
          kind: 'invalid-disposition',
          subject: name,
          detail: 'a path rule with no `match` matches nothing',
        });
        continue;
      }
      if (rule.disposition !== 'public' && rule.disposition !== 'private') {
        findings.push({
          kind: 'invalid-disposition',
          subject: `${name} → ${rule.match}`,
          detail: `path disposition ${JSON.stringify(rule.disposition)} is not public or private`,
        });
      }
      if (typeof rule.reason !== 'string' || rule.reason.trim() === '') {
        findings.push({
          kind: 'invalid-disposition',
          subject: `${name} → ${rule.match}`,
          detail: 'a path rule with no reason is a rule nobody can review',
        });
      }
      if (!rule.match.startsWith(`${name}/`) && rule.match !== name) {
        findings.push({
          kind: 'invalid-disposition',
          subject: `${name} → ${rule.match}`,
          detail: `a path rule under \`${name}\` must match paths inside it`,
        });
      }
    }
  }
  return findings;
}

/**
 * The whole rule, pure over the record and the derived population, so a red
 * proof enters where a real run enters (issue #130).
 */
export function analyseDispositions(input: DispositionInput): DispositionAnalysis {
  const findings: Finding[] = [...validate(input.document)];
  const rootEntries = rootEntriesOf(input.paths);
  const byEntry = new Map<string, RootDisposition>();
  for (const row of input.document.entries ?? []) {
    if (typeof row?.entry === 'string' && !byEntry.has(row.entry)) byEntry.set(row.entry, row);
  }

  for (const entry of rootEntries) {
    if (!byEntry.has(entry)) {
      findings.push({
        kind: 'undisposed-root-entry',
        subject: entry,
        detail:
          'the tree holds it and the record does not name it. It does not default to private ' +
          'and it does not default to public — record a disposition and a reason in ' +
          `\`${DISPOSITIONS_PATH}\``,
      });
    }
  }
  for (const entry of byEntry.keys()) {
    if (!rootEntries.includes(entry)) {
      findings.push({
        kind: 'stale-disposition',
        subject: entry,
        detail:
          'recorded, and the tree no longer holds it. Remove the row, so that every row left ' +
          'still describes the tree',
      });
    }
  }

  let resolved =
    rootEntries.length - findings.filter((f) => f.kind === 'undisposed-root-entry').length;
  // Keyed per entry rather than by a composite string. The composite was a
  // `${entry}<separator>${match}` key, and choosing a separator that cannot
  // occur in either half means choosing a byte — which `check:nul-bytes`
  // refuses on sight, correctly: a source file carrying a raw NUL is classified
  // binary by git and every diff of it reads "Binary files differ". A nested
  // map has no separator to choose.
  const matched = new Map<string, Set<string>>();
  for (const [entry, row] of byEntry) {
    if (row.disposition !== 'partially-public') continue;
    const rules = (row.paths ?? []).map((rule) => ({ rule, re: globToRegExp(rule.match) }));
    for (const path of input.paths) {
      if (path !== entry && !path.startsWith(`${entry}/`)) continue;
      resolved += 1;
      const hit = rules.find(({ re }) => re.test(path));
      if (hit === undefined) {
        findings.push({
          kind: 'undisposed-path',
          subject: path,
          detail: `under \`${entry}\`, which is partially-public, and it matches no recorded path rule`,
        });
      } else {
        const hits = matched.get(entry) ?? new Set<string>();
        hits.add(hit.rule.match);
        matched.set(entry, hits);
      }
    }
    for (const { rule } of rules) {
      if (!(matched.get(entry)?.has(rule.match) ?? false)) {
        findings.push({
          kind: 'unreachable-path-rule',
          subject: `${entry} → ${rule.match}`,
          detail:
            'the rule matched no file in the tree. A rule that stopped matching is a rule ' +
            'nobody notices went dead',
        });
      }
    }
  }

  return { findings, rootEntries, resolved };
}

/** Every tracked path plus every untracked one git does not ignore. */
function treePaths(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split('\n').filter((l) => l !== ''))];
}

/**
 * The independent second author: the committed tree's own top-level entries,
 * read from the commit rather than from the index this check's walk uses. It is
 * a different store answering the same question, which is what makes the
 * reconciliation worth printing rather than the same number twice.
 */
function committedRootEntries(): string[] {
  const out = execFileSync('git', ['ls-tree', '--name-only', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return out.split('\n').filter((l) => l !== '');
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const recordPath = join(REPO_ROOT, DISPOSITIONS_PATH);
  if (!existsSync(recordPath)) {
    console.error(
      `[root-dispositions] the record is missing at \`${DISPOSITIONS_PATH}\`, so every entry ` +
        'in the tree is undisposed and a clean result would mean "not looking"',
    );
    process.exit(2);
  }
  let document: DispositionDocument;
  try {
    document = JSON.parse(readFileSync(recordPath, 'utf8')) as DispositionDocument;
  } catch (error) {
    console.error(
      `[root-dispositions] the record at \`${DISPOSITIONS_PATH}\` is not readable JSON: ` +
        `${(error as Error).message}`,
    );
    process.exit(2);
  }
  if (!Array.isArray(document.entries)) {
    console.error(
      `[root-dispositions] the record at \`${DISPOSITIONS_PATH}\` declares no \`entries\` array`,
    );
    process.exit(2);
  }

  const paths = treePaths();
  const analysis = analyseDispositions({ paths, document });
  const committed = committedRootEntries();
  const covered = committed.filter((e) => analysis.rootEntries.includes(e)).length;

  if (listMode) {
    for (const entry of analysis.rootEntries) {
      const row = document.entries.find((r) => r.entry === entry);
      console.log(`[root-dispositions] ${entry} ${row?.disposition ?? '(none)'}`);
    }
  }

  reportReadSize({
    prefix: '[root-dispositions]',
    files: paths.length,
    sites: analysis.resolved,
    coverage: [{ source: 'git-tree-entries', expected: committed.length, covered }],
  });
  const counts = new Map<FindingKind, number>();
  for (const f of analysis.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const kinds: FindingKind[] = [
    'undisposed-root-entry',
    'undisposed-path',
    'stale-disposition',
    'unreachable-path-rule',
    'duplicate-disposition',
    'invalid-disposition',
  ];
  console.log(
    `[root-dispositions] root-entries=${analysis.rootEntries.length} ` +
      `recorded=${document.entries.length} resolved=${analysis.resolved} ` +
      `${kinds.map((k) => `${k}=${counts.get(k) ?? 0}`).join(' ')} ` +
      `findings=${analysis.findings.length}`,
  );

  if (analysis.findings.length > 0) {
    console.error(
      `\nEvery top-level entry needs a recorded disposition, and one that has none refuses ` +
        `(D-232 clause (ii)). The record is \`${DISPOSITIONS_PATH}\`:`,
    );
    for (const f of analysis.findings.slice(0, 50)) {
      console.error(`  - [${f.kind}] ${f.subject}: ${f.detail}`);
    }
    if (analysis.findings.length > 50) {
      console.error(`  … and ${analysis.findings.length - 50} more`);
    }
  }

  process.exit(analysis.findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module from a unit test must not trigger the
// walk or the exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
