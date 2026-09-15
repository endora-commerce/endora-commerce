/**
 * `check-root-dispositions` — one red proof per shape it claims to refuse, plus
 * the two-way ratchet and the real record.
 *
 * The rule under test is D-232's second amendment, clauses (i) and (ii):
 * **private is a recorded disposition over an enumerated population, and an
 * entry carrying no disposition refuses the publish.** So the tests that matter
 * most here are the *negative* ones — a check of this shape is trivially green
 * over a complete record, and green is exactly what it printed the morning
 * entry number forty landed without one, because it did not exist.
 */
import { describe, expect, it } from 'vitest';

import {
  analyseDispositions,
  type DispositionDocument,
  globToRegExp,
  rootEntriesOf,
} from '../../../scripts/check-root-dispositions.js';

function doc(entries: DispositionDocument['entries']): DispositionDocument {
  return { version: 1, entries };
}

const PUBLIC_ROW = { entry: 'backend', disposition: 'public' as const, reason: 'source' };

function kinds(findings: readonly { kind: string }[]): string[] {
  return [...new Set(findings.map((f) => f.kind))].sort();
}

describe('the population is derived from the tree, never written down', () => {
  it('takes the first segment of every path, uniquely', () => {
    expect(rootEntriesOf(['backend/src/a.ts', 'backend/src/b.ts', 'README.md'])).toEqual([
      'README.md',
      'backend',
    ]);
  });

  it('is empty for an empty tree, which the CLI half turns into exit 2', () => {
    expect(rootEntriesOf([])).toEqual([]);
  });
});

describe('a glob over repository-relative paths', () => {
  it('lets `**` cross separators and `*` not', () => {
    expect(globToRegExp('specs/conventions/**').test('specs/conventions/a/b.md')).toBe(true);
    expect(globToRegExp('specs/*.md').test('specs/a.md')).toBe(true);
    expect(globToRegExp('specs/*.md').test('specs/nested/a.md')).toBe(false);
  });

  it('passes a character class through, which is what the numbered directories need', () => {
    const re = globToRegExp('specs/[0-9]*/**');
    expect(re.test('specs/080-f4-real-scope/rulings.md')).toBe(true);
    expect(re.test('specs/080-f4-real-scope/contracts/a.md')).toBe(true);
    expect(re.test('specs/conventions/a.md')).toBe(false);
  });

  it('does not let a `.` in the pattern match any character', () => {
    expect(globToRegExp('specs/a.md').test('specs/axmd')).toBe(false);
  });
});

describe('every shape it refuses, one red proof each', () => {
  it('refuses an entry the tree holds and the record does not name', () => {
    const analysis = analyseDispositions({
      paths: ['backend/src/a.ts', 'CONTRIBUTING.md'],
      document: doc([PUBLIC_ROW]),
    });
    expect(kinds(analysis.findings)).toEqual(['undisposed-root-entry']);
    expect(analysis.findings[0]?.subject).toBe('CONTRIBUTING.md');
  });

  it('refuses in neither direction by default — not private, not public', () => {
    const analysis = analyseDispositions({
      paths: ['CONTRIBUTING.md'],
      document: doc([]),
    });
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.findings[0]?.detail).toMatch(/does not default to private/);
    expect(analysis.findings[0]?.detail).toMatch(/does not default to public/);
  });

  it('refuses a file under a partially-public entry that matches no path rule', () => {
    const analysis = analyseDispositions({
      paths: ['specs/conventions/a.md', 'specs/a-new-standing-document.md'],
      document: doc([
        {
          entry: 'specs',
          disposition: 'partially-public',
          reason: 'split',
          paths: [{ match: 'specs/conventions/**', disposition: 'public', reason: 'operational' }],
        },
      ]),
    });
    expect(kinds(analysis.findings)).toEqual(['undisposed-path']);
    expect(analysis.findings[0]?.subject).toBe('specs/a-new-standing-document.md');
  });

  it('refuses a recorded entry the tree no longer holds', () => {
    const analysis = analyseDispositions({
      paths: ['backend/src/a.ts'],
      document: doc([PUBLIC_ROW, { entry: 'gone', disposition: 'public', reason: 'was here' }]),
    });
    expect(kinds(analysis.findings)).toEqual(['stale-disposition']);
  });

  it('refuses a path rule that matched nothing', () => {
    const analysis = analyseDispositions({
      paths: ['specs/conventions/a.md'],
      document: doc([
        {
          entry: 'specs',
          disposition: 'partially-public',
          reason: 'split',
          paths: [
            { match: 'specs/conventions/**', disposition: 'public', reason: 'operational' },
            { match: 'specs/gone.md', disposition: 'private', reason: 'moved away' },
          ],
        },
      ]),
    });
    expect(kinds(analysis.findings)).toEqual(['unreachable-path-rule']);
  });

  it('refuses two rows for one entry', () => {
    const analysis = analyseDispositions({
      paths: ['backend/src/a.ts'],
      document: doc([PUBLIC_ROW, { entry: 'backend', disposition: 'private', reason: 'no' }]),
    });
    expect(analysis.findings.map((f) => f.kind)).toContain('duplicate-disposition');
  });

  it('refuses a disposition outside the three words', () => {
    const analysis = analyseDispositions({
      paths: ['backend/src/a.ts'],
      document: doc([
        { entry: 'backend', disposition: 'maybe' as never, reason: 'unsure' },
      ]),
    });
    expect(kinds(analysis.findings)).toEqual(['invalid-disposition']);
  });

  it('refuses a row with no reason — a disposition without one is a vote', () => {
    const analysis = analyseDispositions({
      paths: ['backend/src/a.ts'],
      document: doc([{ entry: 'backend', disposition: 'public', reason: '  ' }]),
    });
    expect(kinds(analysis.findings)).toEqual(['invalid-disposition']);
  });

  it('refuses a partially-public entry with no path rules', () => {
    const analysis = analyseDispositions({
      paths: ['specs/a.md'],
      document: doc([{ entry: 'specs', disposition: 'partially-public', reason: 'split' }]),
    });
    expect(analysis.findings.map((f) => f.kind)).toContain('invalid-disposition');
  });

  it('refuses path rules on an entry that is not partially-public, which never consults them', () => {
    const analysis = analyseDispositions({
      paths: ['backend/a.ts'],
      document: doc([
        {
          entry: 'backend',
          disposition: 'public',
          reason: 'source',
          paths: [{ match: 'backend/**', disposition: 'private', reason: 'never read' }],
        },
      ]),
    });
    expect(kinds(analysis.findings)).toEqual(['invalid-disposition']);
  });

  it('refuses a path rule that reaches outside its own entry', () => {
    const analysis = analyseDispositions({
      paths: ['specs/conventions/a.md'],
      document: doc([
        {
          entry: 'specs',
          disposition: 'partially-public',
          reason: 'split',
          paths: [
            { match: 'specs/conventions/**', disposition: 'public', reason: 'operational' },
            { match: 'backend/**', disposition: 'private', reason: 'wrong entry' },
          ],
        },
      ]),
    });
    expect(analysis.findings.map((f) => f.kind)).toContain('invalid-disposition');
  });
});

describe('a complete record is silent', () => {
  it('finds nothing over a tree every rule reaches', () => {
    const analysis = analyseDispositions({
      paths: ['backend/a.ts', 'specs/conventions/a.md', 'specs/080-x/spec.md'],
      document: doc([
        PUBLIC_ROW,
        {
          entry: 'specs',
          disposition: 'partially-public',
          reason: 'split',
          paths: [
            { match: 'specs/conventions/**', disposition: 'public', reason: 'operational' },
            { match: 'specs/[0-9]*/**', disposition: 'private', reason: 'design record' },
          ],
        },
      ]),
    });
    expect(analysis.findings).toEqual([]);
    expect(analysis.resolved).toBe(4);
  });

  it('counts a root entry as resolved only when it is', () => {
    const analysis = analyseDispositions({ paths: ['a.md', 'b.md'], document: doc([]) });
    expect(analysis.resolved).toBe(0);
  });
});
