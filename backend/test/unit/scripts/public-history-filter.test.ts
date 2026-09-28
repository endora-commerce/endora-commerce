/**
 * The one-time disclosure filter — one red proof per shape it refuses, and the
 * three assertions that are about the **projected** tree rather than about the
 * working tree it was derived from
 * (`specs/129-github-canonical-migration/` T020 – T025; FR-010 – FR-013,
 * FR-020; D-240 as amended, D-246, D-247).
 *
 * ## Why every fixture here is synthetic
 *
 * The messages this filter replaces carry the C1, C2 and C4 payloads the
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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  byteIdentityFindings,
  commitMapAfterSecondPass,
  completenessFindings,
  historicalDisclosureFindings,
  historicalRootsDroppedBy,
  composeCommitMaps,
  type DispositionDocument,
  keepSpecsFrom,
  literalCensus,
  type MessageReplacementDocument,
  messageIdentityFindings,
  moduleExclusionLines,
  parseCommitMap,
  patternAudit,
  projectionOf,
  readModuleHistory,
  renderPathsFile,
  renderReplaceMessageFile,
  renderReplaceTextFile,
  replaceTextLocationRefusal,
  resolveModuleExclusions,
  type TextReplacementDocument,
  type TextReplacementRule,
  textReplacementFindings,
  tipResidueFindings,
  tipResolvedPaths,
  translateMatch,
  vacuousReason,
  validateReplacements,
  validateTextReplacements,
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

// --- 134 T091: the resolution is over the history, not over the tip ---------
//
// Every case below builds a throwaway repository and reads it through the same
// function the run uses, because the defect T091 exists about was a resolver
// that read the *working tree* while the path filter it fed applied to *every
// commit*. A test over a hand-written list of packages cannot tell those apart.

interface Fixture {
  readonly root: string;
  commit(files: Record<string, string | null>, message?: string): void;
}

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

function fixtureRepo(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'endora-history-filter-'));
  fixtures.push(root);
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', root], { stdio: 'ignore' });
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'commit.gpgsign', 'false');
  let n = 0;
  return {
    root,
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) {
        const full = join(root, path);
        if (content === null) {
          git('rm', '--quiet', '-r', path);
          continue;
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
        git('add', path);
      }
      n += 1;
      git('commit', '--quiet', '--allow-empty', '-m', message ?? `fixture commit ${n}`);
    },
  };
}

function manifestOf(id: string): string {
  return (
    "import { defineModuleManifest } from '@endora-commerce/platform/modules';\n\n" +
    `export const manifest = defineModuleManifest({\n  id: '${id}',\n  version: '0.1.0',\n});\n`
  );
}

function resolve(fixture: Fixture, ids: readonly string[]) {
  return resolveModuleExclusions(ids, readModuleHistory('HEAD', fixture.root));
}

describe('the module-id exclusion resolves over the history (129 FR-011 as amended, 134 T091)', () => {
  it('case 1: a moved module resolves to every root it ever occupied, not only the tip’s', () => {
    const repo = fixtureRepo();
    repo.commit({
      'backend/src/modules/demo_mod/manifest.ts': manifestOf('demo_mod'),
      'backend/src/modules/demo_mod/service.ts': 'export const a = 1;\n',
      'backend/src/core.ts': 'export const core = 1;\n',
    });
    repo.commit({
      'backend/src/modules/demo_mod/manifest.ts': null,
      'backend/src/modules/demo_mod/service.ts': null,
      'packages/modules/demo_mod/src/manifest.ts': manifestOf('demo_mod'),
      'packages/modules/demo_mod/src/service.ts': 'export const a = 1;\n',
    });
    repo.commit({ 'packages/modules/demo_mod/src/extra.ts': 'export const b = 2;\n' });

    const resolved = resolve(repo, ['demo_mod']);
    expect(resolved.findings).toEqual([]);
    expect(resolved.paths).toEqual(['backend/src/modules/demo_mod', 'packages/modules/demo_mod']);
    expect(resolved.perId).toEqual([
      {
        moduleId: 'demo_mod',
        roots: ['backend/src/modules/demo_mod', 'packages/modules/demo_mod'],
        files: 5,
      },
    ]);
  });

  it('resolves an id to the directory its own manifest declares, not to its name', () => {
    const repo = fixtureRepo();
    repo.commit({ 'packages/modules/rfq/src/manifest.ts': manifestOf('quotes') });
    const resolved = resolve(repo, ['quotes']);
    expect(resolved.paths).toEqual(['packages/modules/rfq']);
    expect(resolved.findings).toEqual([]);
  });

  it('case 2: an id gone from the tip but present in history resolves, and does not refuse', () => {
    // Migration day's normal case: the extraction removes the module from the
    // tip *before* the filter runs (134 FR-043), so a tip-resolved id would
    // refuse the only correct ordering.
    const repo = fixtureRepo();
    repo.commit({
      'packages/modules/gone_mod/src/manifest.ts': manifestOf('gone_mod'),
      'packages/modules/gone_mod/src/index.ts': 'export {};\n',
      'README.md': 'core\n',
    });
    repo.commit({ 'packages/modules/gone_mod': null });

    const resolved = resolve(repo, ['gone_mod']);
    expect(resolved.findings.map((f) => f.kind)).not.toContain('unresolved-module-id');
    expect(resolved.findings).toEqual([]);
    expect(resolved.paths).toEqual(['packages/modules/gone_mod']);
  });

  it('case 3: an id no manifest declared at any commit refuses, naming it — the typo guard', () => {
    const repo = fixtureRepo();
    repo.commit({ 'packages/modules/quotes/src/manifest.ts': manifestOf('quotes') });
    const resolved = resolve(repo, ['quote']);
    expect(resolved.findings.map((f) => [f.kind, f.subject])).toEqual([
      ['unresolved-module-id', 'quote'],
    ]);
    expect(resolved.findings[0]!.detail).toMatch(/any commit/);
    expect(resolved.paths).toEqual([]);
  });

  it('case 4: an empty list proceeds silently, and the report says it is legitimate (FR-012)', () => {
    const repo = fixtureRepo();
    repo.commit({ 'packages/modules/quotes/src/manifest.ts': manifestOf('quotes') });
    const resolved = resolve(repo, []);
    expect(resolved).toEqual({ paths: [], perId: [], findings: [] });
    expect(moduleExclusionLines([], [])).toEqual([
      '[public-history-filter] module ids excluded: 0 (an empty list is legitimate — D-246, FR-012)',
    ]);
  });

  it('prints one line per excluded id — a file count and the roots, never the paths (FR-020)', () => {
    const lines = moduleExclusionLines(
      ['demo_mod'],
      [{ moduleId: 'demo_mod', roots: ['a/demo_mod', 'b/demo_mod'], files: 12 }],
    );
    expect(lines).toEqual([
      '[public-history-filter] module ids excluded: 1',
      '  - demo_mod files=12 roots=a/demo_mod, b/demo_mod',
    ]);
  });

  it('case 5: the core-owned satellites travel with the id, in both spellings', () => {
    const repo = fixtureRepo();
    repo.commit({
      'packages/modules/pim_unopim/src/manifest.ts': manifestOf('pim_unopim'),
      'backend/test/unit/pim_unopim/a.test.ts': 'x\n',
      'backend/test/contract/pim_unopim/b.test.ts': 'x\n',
      'backend/test/integration/pim_unopim/c.test.ts': 'x\n',
      'backend/test/perf/pim_unopim/d.test.ts': 'x\n',
      'admin/test/modules/pim-unopim/e.test.tsx': 'x\n',
      'admin/src/modules/pim-unopim/index.tsx': 'x\n',
      'backend/scripts/ledgers/cross-module-imports/pim_unopim.ts': 'x\n',
      'packages/contracts/src/pim-unopim.ts': 'x\n',
      // Carries no id as a segment or a stem, so it is nobody's satellite.
      'backend/test/helpers/scripted-pim-unopim-client.ts': 'x\n',
    });
    // Satellites deleted before the tip still resolve for the commits that held them.
    repo.commit({ 'backend/test/perf/pim_unopim': null, 'admin/src/modules/pim-unopim': null });

    const resolved = resolve(repo, ['pim_unopim']);
    expect(resolved.findings).toEqual([]);
    expect(resolved.paths).toEqual([
      'admin/src/modules/pim-unopim',
      'admin/test/modules/pim-unopim',
      'backend/scripts/ledgers/cross-module-imports/pim_unopim.ts',
      'backend/test/contract/pim_unopim',
      'backend/test/integration/pim_unopim',
      'backend/test/perf/pim_unopim',
      'backend/test/unit/pim_unopim',
      'packages/contracts/src/pim-unopim.ts',
      'packages/modules/pim_unopim',
    ]);
    expect(resolved.perId[0]!.files).toBe(9);
  });

  it('case 6: an id-bearing path the resolution did not cover refuses, printed — segment and stem', () => {
    // Both are shapes this repository's own history holds: a request-fixture
    // directory named in the kebab spelling under `backend/test/fixtures/`, and
    // a module documentation page whose stem is the id. Neither is a satellite
    // convention, so a resolver that trusted its conventions would publish them.
    const repo = fixtureRepo();
    repo.commit({
      'packages/modules/comarch_xl/src/manifest.ts': manifestOf('comarch_xl'),
      'packages/modules/ksef/src/manifest.ts': manifestOf('ksef'),
      'backend/test/fixtures/comarch-xl/request.xml': '<x/>\n',
      'docs/docs/modules/ksef.md': '# page\n',
      'backend/test/helpers/scripted-ksef-client.ts': 'x\n',
      'docs/docs/modules/blog.md': '# page\n',
    });
    const history = readModuleHistory('HEAD', repo.root);
    const resolved = resolveModuleExclusions(['comarch_xl', 'ksef'], history);
    expect(resolved.findings).toEqual([]);

    const refused = completenessFindings(history.paths, ['comarch_xl', 'ksef'], resolved.paths);
    expect(refused.map((f) => [f.kind, f.subject])).toEqual([
      ['uncovered-module-path', 'backend/test/fixtures/comarch-xl/request.xml'],
      ['uncovered-module-path', 'docs/docs/modules/ksef.md'],
    ]);
    expect(refused[0]!.detail).toContain('comarch_xl');
  });

  it('case 6: is silent when every id-bearing path is covered, and when the list is empty', () => {
    expect(
      completenessFindings(
        ['packages/modules/ksef/src/manifest.ts', 'docs/docs/modules/blog.md'],
        ['ksef'],
        ['packages/modules/ksef'],
      ),
    ).toEqual([]);
    expect(completenessFindings(['docs/docs/modules/ksef.md'], [], [])).toEqual([]);
  });

  it('case 7: the same id twice still refuses, because the second entry is invisible', () => {
    const repo = fixtureRepo();
    repo.commit({ 'packages/modules/blog/src/manifest.ts': manifestOf('blog') });
    const resolved = resolve(repo, ['blog', 'blog']);
    expect(resolved.findings.map((f) => f.kind)).toEqual(['duplicate-module-id']);
    expect(resolved.paths).toEqual([]);
  });

  it('refuses a history that holds no manifest at all, rather than excluding nothing', () => {
    const repo = fixtureRepo();
    repo.commit({ 'README.md': 'core\n' });
    const resolved = resolve(repo, ['blog']);
    expect(resolved.findings.map((f) => f.kind)).toEqual(['no-module-packages']);
    expect(resolved.paths).toEqual([]);
  });

  it('reads a path that only a merge resolution ever held (first-parent merge diffs)', () => {
    const repo = fixtureRepo();
    repo.commit({ 'README.md': 'core\n' });
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repo.root, ...args], { encoding: 'utf8' });
    git('checkout', '--quiet', '-b', 'side');
    repo.commit({ 'side.txt': 'side\n' });
    git('checkout', '--quiet', 'main');
    repo.commit({ 'main.txt': 'main\n' });
    git('merge', '--quiet', '--no-commit', 'side');
    mkdirSync(join(repo.root, 'backend/test/unit/demo_mod'), { recursive: true });
    writeFileSync(join(repo.root, 'backend/test/unit/demo_mod/born-in-merge.test.ts'), 'x\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'merge side');
    repo.commit({ 'backend/test/unit/demo_mod': null });

    expect(readModuleHistory('HEAD', repo.root).paths).toContain(
      'backend/test/unit/demo_mod/born-in-merge.test.ts',
    );
  });
});

describe('an excluded id still at the tip refuses (136 FR-050, GAP-6)', () => {
  // The tip is where the module still *is*: excluding its history while its
  // source sits in the projected tip would publish it anyway, or — through the
  // second pass — publish a tip that no longer builds. Either way the
  // extraction is incomplete, and the run says so rather than guessing.
  const tip = [
    { moduleId: 'blog', dir: 'packages/modules/blog' },
    { moduleId: 'quotes', dir: 'packages/modules/rfq' },
    { moduleId: 'wishlist', dir: 'packages/modules/wishlist' },
  ];

  it('is silent when the list is empty (FR-012)', () => {
    const residue = tipResidueFindings([], tip, { allowTipResidue: false, apply: false });
    expect(residue).toEqual({ findings: [], allowed: [] });
  });

  it('is silent for an id that has already left the tip', () => {
    const residue = tipResidueFindings(['gone'], tip, { allowTipResidue: false, apply: false });
    expect(residue).toEqual({ findings: [], allowed: [] });
  });

  it('refuses every excluded id still declared at the tip, naming the id and its tip root', () => {
    const residue = tipResidueFindings(['gone', 'quotes', 'wishlist'], tip, {
      allowTipResidue: false,
      apply: false,
    });
    expect(residue.allowed).toEqual([]);
    expect(residue.findings.map((f) => [f.kind, f.subject])).toEqual([
      ['excluded-id-at-tip', 'quotes'],
      ['excluded-id-at-tip', 'wishlist'],
    ]);
    expect(residue.findings[0]!.detail).toContain('packages/modules/rfq');
    expect(residue.findings[1]!.detail).toContain('packages/modules/wishlist');
    expect(residue.findings[0]!.detail).toContain('--allow-tip-residue');
  });

  it('refuses an id whose history-resolved path is still at the tip, naming the tip path', () => {
    // With the resolver on the history, "resolves at the tip" is any resolved
    // path the tip still holds — a satellite included. Left alone, the second
    // pass would take that file out of the published tip silently.
    const atTip = tipResolvedPaths(
      [{ moduleId: 'gone', roots: ['packages/modules/gone', 'packages/contracts/src/gone.ts'], files: 9 }],
      ['packages/contracts/src/gone.ts', 'packages/contracts/src/index.ts'],
    );
    expect(atTip).toEqual(new Map([['gone', ['packages/contracts/src/gone.ts']]]));
    const residue = tipResidueFindings(['gone'], tip, { allowTipResidue: false, apply: false }, atTip);
    expect(residue.findings.map((f) => [f.kind, f.subject])).toEqual([['excluded-id-at-tip', 'gone']]);
    expect(residue.findings[0]!.detail).toContain('packages/contracts/src/gone.ts');
  });

  it('lets a rehearsal through with --allow-tip-residue, reporting what it let through', () => {
    const residue = tipResidueFindings(['quotes'], tip, { allowTipResidue: true, apply: false });
    expect(residue.findings).toEqual([]);
    expect(residue.allowed.map((f) => [f.kind, f.subject])).toEqual([
      ['excluded-id-at-tip', 'quotes'],
    ]);
  });

  it('never lets the final run through: --allow-tip-residue with --apply still refuses', () => {
    const residue = tipResidueFindings(['quotes'], tip, { allowTipResidue: true, apply: true });
    expect(residue.allowed).toEqual([]);
    expect(residue.findings.map((f) => [f.kind, f.subject])).toEqual([
      ['excluded-id-at-tip', 'quotes'],
    ]);
    expect(residue.findings[0]!.detail).toContain('--apply');
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

  it('takes a cumulative second map as it stands, rather than composing it twice', () => {
    // `git-filter-repo` keeps a **cumulative** map when it is run twice on the
    // same repository: the second run's `commit-map` is still keyed by the
    // ORIGINAL ids, not by the first pass's. Composing it again looks up a
    // first-pass id in a map keyed by originals, misses, and falls through to
    // the first-pass id — which exists in no repository anybody will ever hold.
    // Measured, not theorised: it reconciled 2676 of 4275 surviving commits on
    // the first end-to-end run with a non-empty exclusion list, and the walk
    // guard is what caught it.
    const first = new Map([
      ['a'.repeat(40), '1'.repeat(40)],
      ['b'.repeat(40), '2'.repeat(40)],
    ]);
    const cumulative = new Map([
      ['a'.repeat(40), '9'.repeat(40)],
      ['b'.repeat(40), '0'.repeat(40)],
    ]);
    expect(commitMapAfterSecondPass(first, cumulative)).toEqual(cumulative);
  });

  it('composes when the second map is keyed by the first pass, which is the other shape', () => {
    const first = new Map([['a'.repeat(40), '1'.repeat(40)]]);
    const chained = new Map([['1'.repeat(40), '9'.repeat(40)]]);
    expect(commitMapAfterSecondPass(first, chained).get('a'.repeat(40))).toBe('9'.repeat(40));
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

// --- 136 W2.4: `--replace-text`, historical-only blobs (O-3) --------------------
//
// Everything below is invented. A rule's literal is the payload it removes, and
// this file is public: a test quoting a real one would publish it in the merge
// request that removes it.

describe('the text-replacement record is validated before it is used (136 O-3)', () => {
  function rule(over: Partial<TextReplacementRule> = {}): TextReplacementRule {
    return {
      class: 'C2',
      ref: 'fixture-1',
      literal: 'an invented sentence about a counterparty',
      replacement: '[removed]',
      reason: 'an invented C2 sentence for this test',
      ...over,
    };
  }
  const record = (rules: readonly unknown[]): TextReplacementDocument =>
    ({ version: 1, rules }) as TextReplacementDocument;

  it('accepts a complete S, C2 or C3 rule', () => {
    expect(
      validateTextReplacements(
        record([
          rule(),
          rule({ class: 'C3', ref: 'fixture-2', literal: 'another invented phrase' }),
          rule({ class: 'S', ref: 'fixture-3', literal: 'not-a-real-value-0000' }),
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses every class O-3 does not admit — C4 in history stays accepted', () => {
    const kinds = ['C1', 'C4', 'H', 'P', 'L', 'R', ''].map(
      (cls, n) =>
        validateTextReplacements(record([rule({ class: cls as 'S', ref: `r${n}` })]))[0]?.kind,
    );
    expect(kinds).toEqual(Array(7).fill('disallowed-replacement-class'));
  });

  it('refuses the shapes a line-oriented file cannot express or that leave the payload', () => {
    const findings = validateTextReplacements(
      record([
        rule({ ref: 'a', literal: 'two\nlines' }),
        rule({ ref: 'b', literal: 'has ==> separator' }),
        rule({ ref: 'c', literal: 'same', replacement: 'still same' }),
        rule({ ref: 'd', literal: '' }),
        rule({ ref: 'e', literal: 'dup literal' }),
        rule({ ref: 'f', literal: 'dup literal' }),
      ]),
    );
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([
      ['unusable-literal', 'a'],
      ['unusable-literal', 'b'],
      ['self-referential-replacement', 'c'],
      ['unusable-literal', 'd'],
      ['duplicate-literal', 'f'],
    ]);
  });

  it('refuses a rule with no ref, a short reason, a repeated ref, or a field the record does not define', () => {
    const findings = validateTextReplacements(
      record([
        rule({ ref: '' }),
        rule({ ref: 'x', literal: 'one', reason: 'short' }),
        rule({ ref: 'y', literal: 'two' }),
        rule({ ref: 'y', literal: 'three' }),
        { ...rule({ ref: 'z', literal: 'four' }), note: 'extra' },
      ]),
    );
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([
      ['invalid-replacement-rule', '(no ref)'],
      ['unreasoned-replacement', 'x'],
      ['invalid-replacement-rule', 'y'],
      ['invalid-replacement-rule', 'z'],
    ]);
  });

  it('refuses a record that is not one', () => {
    expect(validateTextReplacements({} as TextReplacementDocument).map((f) => f.kind)).toEqual([
      'invalid-replacement-rule',
    ]);
  });

  it('renders one literal line per rule, in the format git-filter-repo parses', () => {
    expect(
      renderReplaceTextFile(record([rule(), rule({ ref: 'b', literal: 'x y', replacement: '' })])),
    ).toBe('literal:an invented sentence about a counterparty==>[removed]\nliteral:x y==>\n');
  });

  it('refuses a replacement file inside the repository — the payload is never committed', () => {
    expect(replaceTextLocationRefusal('/repo/specs/x.json', '/repo')).toMatch(/inside/);
    expect(replaceTextLocationRefusal('/repo', '/repo')).toMatch(/inside/);
    expect(replaceTextLocationRefusal('/elsewhere/rules.json', '/repo')).toBeNull();
    expect(replaceTextLocationRefusal('/repository-sibling/rules.json', '/repo')).toBeNull();
  });
});

describe('a text replacement reaches only blobs absent from the tip (136 W2.4, 129 SC-004)', () => {
  const rules: TextReplacementRule[] = [
    { class: 'C2', ref: 'hist', literal: 'OLD PHRASE', replacement: 'new', reason: 'invented phrase' },
    { class: 'S', ref: 'tip', literal: 'TIP-VALUE', replacement: 'x', reason: 'invented value' },
    { class: 'C3', ref: 'none', literal: 'NOWHERE', replacement: 'x', reason: 'invented phrase' },
  ];
  const blob = (id: string, text: string) => ({ id, data: Buffer.from(text) });
  const tip = new Map([
    ['docs/current.md', 'b-tip'],
    ['src/config.ts', 'b-cfg'],
  ]);
  const blobs = [
    blob('b-old1', 'a line with OLD PHRASE in it'),
    blob('b-old2', 'OLD PHRASE twice: OLD PHRASE'),
    blob('b-tip', 'the current text'),
    blob('b-cfg', 'const k = "TIP-VALUE";'),
  ];

  it('counts historical blobs per rule and names the tip paths a literal is in', () => {
    const census = literalCensus({ blobs, tip, rules });
    expect(census.get('hist')).toEqual({ historyBlobs: 2, tipPaths: [] });
    expect(census.get('tip')).toEqual({ historyBlobs: 0, tipPaths: ['src/config.ts'] });
    expect(census.get('none')).toEqual({ historyBlobs: 0, tipPaths: [] });
  });

  it('refuses a rule whose literal is at the tip, and one that reaches no blob at all', () => {
    const before = literalCensus({ blobs, tip, rules });
    const findings = textReplacementFindings({ rules, before, after: null });
    expect(findings.map((f) => [f.kind, f.subject])).toEqual([
      ['replacement-reaches-tip', 'tip'],
      ['inert-text-replacement', 'none'],
    ]);
    expect(findings[0]!.detail).toContain('src/config.ts');
    // The report names the rule by its ref; the literal is the payload.
    for (const f of findings) {
      expect(`${f.subject} ${f.detail}`).not.toMatch(/TIP-VALUE|NOWHERE/);
    }
  });

  it('refuses a literal that survived the rewrite in any blob', () => {
    const only = [rules[0]!];
    const before = literalCensus({ blobs, tip, rules: only });
    const after = literalCensus({
      blobs: [blob('b-old1', 'a line with new in it'), blob('bin', 'OLD PHRASE\0binary')],
      tip,
      rules: only,
    });
    expect(textReplacementFindings({ rules: only, before, after }).map((f) => f.kind)).toEqual([
      'text-payload-survived',
    ]);
  });

  it('is silent when each rule reached history only and nothing survived', () => {
    const only = [rules[0]!];
    const before = literalCensus({ blobs, tip, rules: only });
    const after = literalCensus({ blobs: [blob('b-new', 'new')], tip, rules: only });
    expect(textReplacementFindings({ rules: only, before, after })).toEqual([]);
  });
});
