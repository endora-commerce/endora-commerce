/**
 * The root-disposition analysis — what the one-time history filter
 * (`public-history-filter.ts`, 129 T025) reads its record with.
 *
 * **This was `check-root-dispositions.ts` and it is no longer a check.** It
 * held every top-level entry of the repository to a recorded disposition
 * (`specs/129-github-canonical-migration/` T012 / FR-003; D-232's second
 * amendment, clauses (i) and (ii)), so that the population the filter would
 * carry into the public repository could not drift while nobody looked. Its
 * subject ended at T031, when the filter ran: in a public repository every
 * committed path is published, so a `private` disposition cannot be honoured,
 * and the record itself is a withheld path. 129 T035 (D-283 §4.7) retired the
 * check from the canonical tree — its inventory row, its estate verdict, its
 * `quality` line, its read size and its command — and kept the analysis here,
 * because the filter still imports it until it retires with T045.
 *
 * What it refuses, one finding kind each, is unchanged and is proven in
 * `backend/test/unit/scripts/root-dispositions.test.ts`:
 *
 *   * `undisposed-root-entry` — the tree holds an entry the record does not
 *     name, and there is no default in either direction.
 *   * `undisposed-path` — a file under a `partially-public` entry that matches
 *     no recorded path rule.
 *   * `stale-disposition` and `unreachable-path-rule` — the ratchet's other
 *     direction: a row or a rule that no longer describes the tree.
 *   * `duplicate-disposition` and `invalid-disposition` — a record that is
 *     not well formed, including a row with no reason.
 */

/** Where the record lives, in the pre-migration record: withheld from the public tree. */
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
