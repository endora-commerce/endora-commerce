/**
 * The one-time disclosure filter — one red proof per shape it refuses, and the
 * three assertions that are about the **projected** tree rather than about the
 * working tree it was derived from
 * (`specs/129-github-canonical-migration/` T020 – T025; FR-010 – FR-013,
 * FR-020; D-240 as amended, D-246, D-247).
 *
 * ## Why every fixture here is synthetic
 *
 * The seven messages this filter replaces carry the C1 and C2 payloads the
 * migration exists to leave behind, and this file is **public** under the
 * record the filter reads. A test quoting a real payload to prove the
 * replacement works would publish the payload in the same merge request that
 * removes it — `specs/conventions/commercial-data.md` §1 read from the public
 * tree alone. So the record lives in the private
 * `specs/129-github-canonical-migration/contracts/`, and everything below is
 * invented.
 *
 * ## What is worth testing in a script that runs twice and is then history
 *
 * Not the `git-filter-repo` invocation — that is somebody else's program, and
 * the run itself proves it. What is worth testing is every place where **this**
 * repository's record is turned into an assertion: the keep-list derived from
 * the dispositions, the module ids resolved through declared manifests, the
 * replacement list's own validity, the composition of two commit maps, and the
 * three reconciliations that compare what was projected against what was
 * promised. Each of those is a place where a green could mean *"not looking"*,
 * which is the one failure a run against real history cannot afford.
 */
import { describe, expect, it } from 'vitest';

import {
  byteIdentityFindings,
  historicalDisclosureFindings,
  historicalRootsDroppedBy,
  composeCommitMaps,
  type DispositionDocument,
  keepSpecsFrom,
  type MessageReplacementDocument,
  messageIdentityFindings,
  parseCommitMap,
  patternAudit,
  projectionOf,
  renderPathsFile,
  renderReplaceMessageFile,
  resolveModuleExclusions,
  translateMatch,
  vacuousReason,
  validateReplacements,
} from '../../../scripts/public-history-filter.js';

function doc(entries: DispositionDocument['entries']): DispositionDocument {
  return { version: 1, entries };
}

const TREE = doc([
  { entry: 'backend', disposition: 'public', reason: 'source' },
  { entry: 'private-notes', disposition: 'private', reason: 'internal' },
  {
    entry: 'specs',
    disposition: 'partially-public',
    reason: 'split',
    paths: [
      { match: 'specs/conventions/**', disposition: 'public', reason: 'operational' },
      { match: 'specs/[0-9]*/**', disposition: 'private', reason: 'design record' },
      { match: 'specs/a-standing-measure.md', disposition: 'public', reason: 'measurement' },
    ],
  },
]);

describe('the keep-list is derived from the record, and nothing else', () => {
  it('keeps a public entry, drops a private one, and reads a partial entry rule by rule', () => {
    const specs = keepSpecsFrom(TREE);
    expect(specs.map((s) => s.value).sort()).toEqual([
      'backend',
      'specs/a-standing-measure.md',
      'specs/conventions',
    ]);
  });

  it('names the row each spec came from, so the report can say why a path survived', () => {
    const specs = keepSpecsFrom(TREE);
    expect(specs.find((s) => s.value === 'specs/conventions')?.source).toBe(
      'specs → specs/conventions/**',
    );
    expect(specs.find((s) => s.value === 'backend')?.source).toBe('backend');
  });

  it('derives an empty keep-list from an empty record rather than keeping everything', () => {
    expect(keepSpecsFrom(doc([]))).toEqual([]);
  });

  it('translates the three shapes a recorded match can have', () => {
    expect(translateMatch('specs/conventions/**')).toEqual({
      kind: 'literal',
      value: 'specs/conventions',
    });
    expect(translateMatch('specs/a.md')).toEqual({ kind: 'literal', value: 'specs/a.md' });
    expect(translateMatch('specs/[0-9]*/**').kind).toBe('glob');
  });
});

describe('the projection is exclude-by-default', () => {
  const specs = keepSpecsFrom(TREE);

  it('drops a path no keep-list entry reaches, rather than publishing it', () => {
    const projection = projectionOf(
      [
        'backend/src/a.ts',
        'private-notes/deal.md',
        'specs/conventions/a.md',
        'specs/080-x/spec.md',
        'specs/a-standing-measure.md',
        'a-new-top-level-entry.md',
      ],
      specs,
      [],
    );
    expect([...projection.kept].sort()).toEqual([
      'backend/src/a.ts',
      'specs/a-standing-measure.md',
      'specs/conventions/a.md',
    ]);
    expect([...projection.dropped].sort()).toEqual([
      'a-new-top-level-entry.md',
      'private-notes/deal.md',
      'specs/080-x/spec.md',
    ]);
  });

  it('matches a literal spec at a path boundary and never mid-segment', () => {
    const projection = projectionOf(['backend-private/a.ts', 'backend'], specs, []);
    expect([...projection.kept]).toEqual(['backend']);
  });

  it('subtracts an excluded module directory from a kept entry', () => {
    const projection = projectionOf(
      ['backend/src/a.ts', 'packages/modules/paid/src/index.ts'],
      [{ kind: 'literal', value: 'packages', source: 'packages' }, ...specs],
      ['packages/modules/paid'],
    );
    expect([...projection.kept]).toEqual(['backend/src/a.ts']);
    expect([...projection.dropped]).toEqual(['packages/modules/paid/src/index.ts']);
  });
});

describe('a top-level name only history holds', () => {
  const specs = keepSpecsFrom(TREE);

  it('reports a root the keep-list reaches nowhere inside, and not one it partly keeps', () => {
    // `specs` is the case that matters: a partially-public entry is not a
    // dropped root, and reporting it as one buries the two that really are.
    expect(historicalRootsDroppedBy(['backend', 'specs', 'eslint-rules'], specs)).toEqual([
      'eslint-rules',
    ]);
  });

  it('is empty when the keep-list reaches every root history held', () => {
    expect(historicalRootsDroppedBy(['backend'], specs)).toEqual([]);
  });
});

describe('the module-id exclusion resolves through the declared manifest (D-246)', () => {
  const packages = [
    { moduleId: 'blog', dir: 'packages/modules/blog' },
    { moduleId: 'quotes', dir: 'packages/modules/rfq' },
  ];

  it('is silent and legitimate when the list is empty (FR-012)', () => {
    const resolved = resolveModuleExclusions([], packages);
    expect(resolved.findings).toEqual([]);
    expect(resolved.paths).toEqual([]);
  });

  it('resolves an id to the directory its own manifest declares, not to its name', () => {
    const resolved = resolveModuleExclusions(['quotes'], packages);
    expect(resolved.paths).toEqual(['packages/modules/rfq']);
    expect(resolved.findings).toEqual([]);
  });

  it('refuses an id that resolves to no package — a typo publishes what it meant to withhold', () => {
    const resolved = resolveModuleExclusions(['quote'], packages);
    expect(resolved.findings.map((f) => f.kind)).toEqual(['unresolved-module-id']);
    expect(resolved.paths).toEqual([]);
  });

  it('refuses the same id twice, because the second entry is invisible', () => {
    const resolved = resolveModuleExclusions(['blog', 'blog'], packages);
    expect(resolved.findings.map((f) => f.kind)).toEqual(['duplicate-module-id']);
  });

  it('refuses a run that could resolve no module at all, rather than excluding nothing', () => {
    const resolved = resolveModuleExclusions(['blog'], []);
    expect(resolved.findings.map((f) => f.kind)).toContain('no-module-packages');
  });
});

describe('the replacement list is data, and it is validated before it is used', () => {
  function replacements(
    entries: MessageReplacementDocument['commits'],
  ): MessageReplacementDocument {
    return { version: 1, commits: entries };
  }
  const ONE = replacements([
    {
      sha: 'a'.repeat(40),
      class: 'C1',
      label: 'a cost figure',
      reason: 'invented',
      replacements: [{ literal: 'costed at N days', replacement: 'costed' }],
    },
  ]);

  it('accepts a complete entry', () => {
    expect(validateReplacements(ONE)).toEqual([]);
  });

  it('refuses a literal carrying a newline, which no line-oriented file can express', () => {
    const findings = validateReplacements(
      replacements([
        {
          ...ONE.commits[0]!,
          replacements: [{ literal: 'two\nlines', replacement: 'one' }],
        },
      ]),
    );
    expect(findings.map((f) => f.kind)).toEqual(['unusable-literal']);
  });

  it("refuses a literal carrying the file format's own separator", () => {
    const findings = validateReplacements(
      replacements([
        {
          ...ONE.commits[0]!,
          replacements: [{ literal: 'a==>b', replacement: 'c' }],
        },
      ]),
    );
    expect(findings.map((f) => f.kind)).toEqual(['unusable-literal']);
  });

  it('refuses a replacement that still contains the thing it replaces', () => {
    const findings = validateReplacements(
      replacements([
        {
          ...ONE.commits[0]!,
          replacements: [{ literal: 'N days', replacement: 'about N days' }],
        },
      ]),
    );
    expect(findings.map((f) => f.kind)).toEqual(['self-referential-replacement']);
  });

  it('refuses two entries claiming the same literal', () => {
    const findings = validateReplacements(
      replacements([
        ONE.commits[0]!,
        { ...ONE.commits[0]!, sha: 'b'.repeat(40) },
      ]),
    );
    expect(findings.map((f) => f.kind)).toEqual(['duplicate-literal']);
  });

  it('refuses a sha that is not one, and an entry with no reason', () => {
    expect(
      validateReplacements(replacements([{ ...ONE.commits[0]!, sha: 'abc' }])).map((f) => f.kind),
    ).toEqual(['invalid-sha']);
    expect(
      validateReplacements(replacements([{ ...ONE.commits[0]!, reason: ' ' }])).map((f) => f.kind),
    ).toEqual(['unreasoned-replacement']);
  });

  it('renders one line per literal, in the format the filter parses', () => {
    expect(renderReplaceMessageFile(ONE)).toBe('literal:costed at N days==>costed\n');
  });

  it('renders the keep-list as one prefixed line per spec, in record order', () => {
    expect(renderPathsFile(keepSpecsFrom(TREE))).toBe(
      'literal:backend\nliteral:specs/conventions\nliteral:specs/a-standing-measure.md\n',
    );
  });
});

describe('a literal that reaches further than its own commit refuses the run', () => {
  const messages = new Map([
    ['a'.repeat(40), 'fixes the thing, costed at N days'],
    ['b'.repeat(40), 'another commit, costed at N days'],
    ['c'.repeat(40), 'unrelated'],
  ]);

  it('reports the commits a literal reaches', () => {
    const audit = patternAudit({
      document: {
        version: 1,
        commits: [
          {
            sha: 'a'.repeat(40),
            class: 'C1',
            label: 'x',
            reason: 'y',
            replacements: [{ literal: 'costed at N days', replacement: 'costed' }],
          },
        ],
      },
      messages,
      survivors: new Set(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]),
    });
    expect(audit.findings.map((f) => f.kind)).toEqual(['over-broad-literal']);
    expect(audit.hits[0]?.commits).toEqual(['a'.repeat(40), 'b'.repeat(40)]);
  });

  it('refuses a literal that matches nothing while its commit survives', () => {
    const audit = patternAudit({
      document: {
        version: 1,
        commits: [
          {
            sha: 'c'.repeat(40),
            class: 'C1',
            label: 'x',
            reason: 'y',
            replacements: [{ literal: 'a phrase nobody wrote', replacement: '' }],
          },
        ],
      },
      messages,
      survivors: new Set(['c'.repeat(40)]),
    });
    expect(audit.findings.map((f) => f.kind)).toEqual(['inert-literal']);
  });

  it('is silent about a literal whose commit the path filter drops', () => {
    const audit = patternAudit({
      document: {
        version: 1,
        commits: [
          {
            sha: 'c'.repeat(40),
            class: 'C1',
            label: 'x',
            reason: 'y',
            replacements: [{ literal: 'a phrase nobody wrote', replacement: '' }],
          },
        ],
      },
      messages,
      survivors: new Set(),
    });
    expect(audit.findings).toEqual([]);
    expect(audit.hits[0]?.dropped).toBe(true);
  });
});

describe('the commit map, and why two passes still publish one mapping', () => {
  it('parses a map, dropped commits included', () => {
    const parsed = parseCommitMap(
      `old                                      new\n${'a'.repeat(40)} ${'1'.repeat(40)}\n${'b'.repeat(40)} ${'0'.repeat(40)}\n`,
    );
    expect(parsed.get('a'.repeat(40))).toBe('1'.repeat(40));
    expect(parsed.get('b'.repeat(40))).toBe('0'.repeat(40));
    expect(parsed.size).toBe(2);
  });

  it('composes two passes into original → final, never pass-one → final', () => {
    const first = new Map([
      ['a'.repeat(40), '1'.repeat(40)],
      ['b'.repeat(40), '0'.repeat(40)],
    ]);
    const second = new Map([['1'.repeat(40), '2'.repeat(40)]]);
    const composed = composeCommitMaps(first, second);
    expect(composed.get('a'.repeat(40))).toBe('2'.repeat(40));
    expect(composed.get('b'.repeat(40))).toBe('0'.repeat(40));
  });

  it('maps a commit the second pass drops to the dropped sentinel, not to a stale sha', () => {
    const composed = composeCommitMaps(
      new Map([['a'.repeat(40), '1'.repeat(40)]]),
      new Map([['1'.repeat(40), '0'.repeat(40)]]),
    );
    expect(composed.get('a'.repeat(40))).toBe('0'.repeat(40));
  });
});

describe('the two assertions about the projected tree (SC-004)', () => {
  const source = new Map([
    ['backend/a.ts', 'blob1'],
    ['specs/conventions/a.md', 'blob2'],
    ['specs/080-x/spec.md', 'blob3'],
  ]);

  it('passes when every kept file arrives byte for byte', () => {
    expect(
      byteIdentityFindings({
        source,
        projected: new Map([
          ['backend/a.ts', 'blob1'],
          ['specs/conventions/a.md', 'blob2'],
        ]),
        expectedKept: new Set(['backend/a.ts', 'specs/conventions/a.md']),
      }),
    ).toEqual([]);
  });

  it('refuses a kept file whose bytes changed on the way through', () => {
    const findings = byteIdentityFindings({
      source,
      projected: new Map([
        ['backend/a.ts', 'blob9'],
        ['specs/conventions/a.md', 'blob2'],
      ]),
      expectedKept: new Set(['backend/a.ts', 'specs/conventions/a.md']),
    });
    expect(findings.map((f) => f.kind)).toEqual(['content-changed']);
  });

  it('refuses a file the record keeps and the projection lost', () => {
    const findings = byteIdentityFindings({
      source,
      projected: new Map([['backend/a.ts', 'blob1']]),
      expectedKept: new Set(['backend/a.ts', 'specs/conventions/a.md']),
    });
    expect(findings.map((f) => f.kind)).toEqual(['missing-from-projection']);
  });

  it('refuses a file the projection carries and the record does not keep — the direction that publishes', () => {
    const findings = byteIdentityFindings({
      source,
      projected: new Map([
        ['backend/a.ts', 'blob1'],
        ['specs/080-x/spec.md', 'blob3'],
      ]),
      expectedKept: new Set(['backend/a.ts']),
    });
    expect(findings.map((f) => f.kind)).toEqual(['undisposed-in-projection']);
  });
});

describe('the projected HISTORY, not only its tip (126 FR-011 R2, as a one-time assertion)', () => {
  const specs = keepSpecsFrom(TREE);

  it('is silent when every path the projection ever held is one the record keeps', () => {
    expect(
      historicalDisclosureFindings(
        ['backend/a.ts', 'specs/conventions/a.md', 'backend/deleted-long-ago.ts'],
        specs,
        [],
      ),
    ).toEqual([]);
  });

  it('refuses a private path that survives in an older commit, which the tip cannot show', () => {
    // The file is gone from the tip and present in the history, which is the
    // whole reason a path filter is run rather than a deletion commit. An
    // assertion over `HEAD` alone reports this tree clean.
    const findings = historicalDisclosureFindings(
      ['backend/a.ts', 'specs/080-x/spec.md'],
      specs,
      [],
    );
    expect(findings.map((f) => f.kind)).toEqual(['private-path-in-history']);
    expect(findings[0]?.subject).toBe('specs/080-x/spec.md');
  });

  it('refuses an excluded module that survives in an older commit (D-246)', () => {
    const findings = historicalDisclosureFindings(
      ['packages/modules/paid/src/index.ts'],
      [{ kind: 'literal', value: 'packages', source: 'packages' }, ...specs],
      ['packages/modules/paid'],
    );
    expect(findings.map((f) => f.kind)).toEqual(['private-path-in-history']);
  });
});

describe('no message changes except the declared ones (FR-010)', () => {
  const original = new Map([
    ['a'.repeat(40), 'a subject\n\ncosted at N days\n'],
    ['b'.repeat(40), 'untouched\n'],
  ]);
  const document: MessageReplacementDocument = {
    version: 1,
    commits: [
      {
        sha: 'a'.repeat(40),
        class: 'C1',
        label: 'x',
        reason: 'y',
        replacements: [{ literal: 'costed at N days', replacement: 'costed' }],
      },
    ],
  };

  it('passes when every surviving message is its original with the declared replacements applied', () => {
    expect(
      messageIdentityFindings({
        original,
        projected: new Map([
          ['a'.repeat(40), 'a subject\n\ncosted\n'],
          ['b'.repeat(40), 'untouched\n'],
        ]),
        document,
      }),
    ).toEqual([]);
  });

  it('refuses a message the filter changed that nothing declared', () => {
    const findings = messageIdentityFindings({
      original,
      projected: new Map([
        ['a'.repeat(40), 'a subject\n\ncosted\n'],
        ['b'.repeat(40), 'untouched, and a hash rewritten\n'],
      ]),
      document,
    });
    expect(findings.map((f) => f.kind)).toEqual(['undeclared-message-change']);
  });

  it('refuses a payload that survived into the projection', () => {
    const findings = messageIdentityFindings({
      original,
      projected: new Map([
        ['a'.repeat(40), 'a subject\n\ncosted at N days\n'],
        ['b'.repeat(40), 'untouched\n'],
      ]),
      document,
    });
    expect(findings.map((f) => f.kind)).toContain('payload-survived');
  });
});

describe('a short or empty walk is exit 2, not a beautiful empty report', () => {
  const full = {
    pathsRead: 100,
    commitsRead: 50,
    survivingCommits: 40,
    reconciledMessages: 40,
    projectedPathsRead: 900,
    commitMapEntries: 50,
    dispositionsRead: 5,
    replacementsRead: 7,
  };

  it('is silent on a walk that read everything it claims to have read', () => {
    expect(vacuousReason(full)).toBeNull();
  });

  it('refuses a walk that read no path, no commit, or produced no survivor', () => {
    expect(vacuousReason({ ...full, pathsRead: 0 })).toMatch(/path/);
    expect(vacuousReason({ ...full, commitsRead: 0 })).toMatch(/commit/);
    expect(vacuousReason({ ...full, survivingCommits: 0 })).toMatch(/surviv/);
  });

  it('refuses a commit map shorter than the walk that produced it', () => {
    expect(vacuousReason({ ...full, commitMapEntries: 49 })).toMatch(/commit map/);
  });

  it('refuses a record it read nothing from', () => {
    expect(vacuousReason({ ...full, dispositionsRead: 0 })).toMatch(/disposition/);
  });

  it('refuses a walk over the projected history that read no path', () => {
    // The assertion that the filtered history holds nothing private is worth
    // exactly as much as the walk behind it, and that walk is over a repository
    // this run created seconds earlier — the one place an empty result reads as
    // a clean one.
    expect(vacuousReason({ ...full, projectedPathsRead: 0 })).toMatch(/projected history/);
  });

  it('refuses a message reconciliation shorter than the projection it claims to have read', () => {
    // The assertion that no message changed except the declared ones is worth
    // exactly as much as the number of messages it reached. Left unguarded, a
    // commit map that failed to line up with the projection turns the whole of
    // `messageIdentityFindings` into a green over an empty set.
    expect(vacuousReason({ ...full, reconciledMessages: 39 })).toMatch(/message/);
    expect(vacuousReason({ ...full, reconciledMessages: 0 })).toMatch(/message/);
  });
});
