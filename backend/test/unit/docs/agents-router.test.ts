import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  analyseRouter,
  APPENDIX_MARKER,
  bodyLineCount,
  CONVENTIONS_DIR,
  normaliseHeading,
  pointersIn,
  readRouterInputs,
  ROUTER_BODY_CEILING,
  ROUTER_FILE,
  routingRows,
  vacuousRouterPopulation,
  type RouterFindingKind,
  type RouterInputs,
} from '../../helpers/agents-router.js';

/**
 * `AGENTS.md` is a router, and this is what holds it to that shape.
 *
 * The reasoning, the two independent derivations and what this cannot see are in
 * `backend/test/helpers/agents-router.ts`' own header. What is here is the run
 * over the real tree, one red proof per finding kind over fixtures that enter at
 * the top of the analysis, and the second `describe` — the wiring the split must
 * not break, which nothing else in the estate asks about.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

function inputs(router: string, documents: Record<string, string>): RouterInputs {
  return { routerText: router, documents: new Map(Object.entries(documents)) };
}

/** A router text that is valid in every respect, so a fixture changes one thing. */
function goodRouter(rows: readonly [string, string, string][]): string {
  const table = rows
    .map(([when, subject, target]) => `| ${when} | ${subject} | \`${CONVENTIONS_DIR}/${target}\` |`)
    .join('\n');
  return [
    '# Router',
    '',
    '## Where the rest of it lives',
    '',
    '| When | Subject | Read |',
    '| --- | --- | --- |',
    table,
    '',
    '---',
    '',
    `${APPENDIX_MARKER} by speckit. -->`,
    '',
    '## Active Technologies',
  ].join('\n');
}

const ONE_ROW: readonly [string, string, string][] = [
  ['Writing a migration, or wondering which number to use', 'Migrations', 'module-migrations.md'],
];

function kinds(findings: readonly { kind: RouterFindingKind }[]): readonly RouterFindingKind[] {
  return findings.map((f) => f.kind);
}

describe('AGENTS.md is a router — the real tree', () => {
  const real = readRouterInputs(REPO_ROOT);

  it('has something to judge in both derivations', () => {
    // The refusal, and it is the assertion this file would be worthless without:
    // with no document every pointer dangles and with no pointer every document
    // is unrouted, so "no findings" over an empty walk is a claim about the walk.
    expect(vacuousRouterPopulation(real), 'the router population is vacuous').toBeNull();
    expect(real.documents.size).toBeGreaterThan(1);
    expect(pointersIn(real.routerText).length).toBeGreaterThan(1);
  });

  it('routes every document exactly once, to a file that is there', () => {
    const analysis = analyseRouter(real);
    // eslint-disable-next-line no-console
    console.log(
      `[agents-router] documents=${real.documents.size} ` +
        `pointers=${pointersIn(real.routerText).length} rows=${analysis.rows.length} ` +
        `body=${analysis.bodyLines}/${ROUTER_BODY_CEILING} headings=${analysis.headingCount}`,
    );
    expect(analysis.findings.map((f) => `${f.kind}: ${f.subject} — ${f.detail}`)).toEqual([]);
  });

  it('gives every routed document a heading the router does not also carry', () => {
    // The router's *Subject* column keeps the old section names on purpose, so an
    // `AGENTS.md § Migrations` citation written elsewhere in the tree still
    // resolves. A cell is not a heading, which is why this compares headings.
    const subjects = routingRows(real.routerText).map((r) => r.subject);
    expect(subjects).toContain('Migrations');
    expect(subjects).toContain('Composition');
    const routerHeadings = new Set(
      real.routerText.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map(normaliseHeading),
    );
    expect(routerHeadings.has('migrations')).toBe(false);
  });

  it('keeps the body under the ceiling', () => {
    expect(bodyLineCount(real.routerText)).toBeLessThanOrEqual(ROUTER_BODY_CEILING);
  });

  it('declares in each document that it is the single home', () => {
    // Cheap, and it is the sentence a reader who arrived without the router needs.
    // Whitespace is normalised because the phrase wraps across a line in half of
    // them, and a raw `toContain` would pass for one spelling and fail the other.
    for (const [name, text] of real.documents) {
      expect(text.split('\n')[0], `${name} must open with a title`).toMatch(/^# \S/);
      expect(text.replace(/\s+/g, ' '), `${name} must say it is the single home`).toContain(
        'single home',
      );
      expect(text.replace(/\s+/g, ' '), `${name} must say when to open it`).toMatch(
        /\*\*Open this (before|when)/,
      );
    }
  });
});

describe('AGENTS.md is a router — one red proof per finding', () => {
  it('refuses a directory with no document', () => {
    expect(vacuousRouterPopulation(inputs(goodRouter(ONE_ROW), {}))).toMatch(/no document/);
  });

  it('refuses a router with no routing table', () => {
    const router = ['# Router', '', `${APPENDIX_MARKER} -->`].join('\n');
    expect(vacuousRouterPopulation(inputs(router, { 'a.md': '# A\nsingle home\n' }))).toMatch(
      /no row/,
    );
  });

  it('refuses a router with no appendix marker, because the body cannot be measured', () => {
    const router = goodRouter(ONE_ROW).replace(`${APPENDIX_MARKER} by speckit. -->`, '');
    expect(
      vacuousRouterPopulation(inputs(router, { 'module-migrations.md': '# M\nsingle home\n' })),
    ).toMatch(/appendix marker/);
  });

  it('refuses an empty router', () => {
    expect(vacuousRouterPopulation(inputs('   ', { 'a.md': '# A\n' }))).toMatch(/empty/);
  });

  it('reports unrouted-document', () => {
    const analysis = analyseRouter(
      inputs(goodRouter(ONE_ROW), {
        'module-migrations.md': '# Migrations\nsingle home\n',
        'module-i18n.md': '# i18n\nsingle home\n',
      }),
    );
    expect(kinds(analysis.findings)).toEqual(['unrouted-document']);
    expect(analysis.findings[0]!.subject).toBe('module-i18n.md');
  });

  it('reports dangling-pointer', () => {
    const analysis = analyseRouter(inputs(goodRouter(ONE_ROW), { 'other.md': '# Other\nsingle home\n' }));
    expect([...kinds(analysis.findings)].sort()).toEqual(['dangling-pointer', 'unrouted-document']);
  });

  it('reports duplicate-pointer', () => {
    const router = `${goodRouter(ONE_ROW)}\n\nAlso see \`${CONVENTIONS_DIR}/module-migrations.md\`.\n`;
    const analysis = analyseRouter(inputs(router, { 'module-migrations.md': '# Migrations\nsingle home\n' }));
    expect(kinds(analysis.findings)).toEqual(['duplicate-pointer']);
  });

  it('reports relocated-heading', () => {
    const router = goodRouter(ONE_ROW).replace('## Where the rest', '## Migrations\n\n## Where the rest');
    const analysis = analyseRouter(inputs(router, { 'module-migrations.md': '# Migrations\nsingle home\n' }));
    expect(kinds(analysis.findings)).toEqual(['relocated-heading']);
    expect(analysis.findings[0]!.detail).toContain('Relocation is not duplication');
  });

  it('reports relocated-heading through two spellings of one subject', () => {
    // `## Migrations` and `## **`Migrations`**` are the same claim; a comparison
    // of raw lines would call them different and let the copy stand.
    const router = goodRouter(ONE_ROW).replace(
      '## Where the rest',
      '## **`Migrations`**\n\n## Where the rest',
    );
    const analysis = analyseRouter(inputs(router, { 'module-migrations.md': '# Migrations\nsingle home\n' }));
    expect(kinds(analysis.findings)).toEqual(['relocated-heading']);
  });

  it('reports duplicate-subject', () => {
    const rows: readonly [string, string, string][] = [
      ...ONE_ROW,
      ['Shipping any user-facing string at all', 'i18n', 'module-i18n.md'],
    ];
    const analysis = analyseRouter(
      inputs(goodRouter(rows), {
        'module-migrations.md': '# Migrations\nsingle home\n\n## Scaffolding\n',
        'module-i18n.md': '# i18n\nsingle home\n\n## Scaffolding\n',
      }),
    );
    expect(kinds(analysis.findings)).toEqual(['duplicate-subject']);
  });

  it('reports routeless-row', () => {
    const analysis = analyseRouter(
      inputs(goodRouter([['See', 'Migrations', 'module-migrations.md']]), {
        'module-migrations.md': '# Migrations\nsingle home\n',
      }),
    );
    expect(kinds(analysis.findings)).toEqual(['routeless-row']);
    expect(analysis.findings[0]!.detail).toContain('does not say when');
  });

  it('reports oversized-router', () => {
    const filler = Array.from({ length: ROUTER_BODY_CEILING + 5 }, () => 'padding').join('\n');
    const router = goodRouter(ONE_ROW).replace('## Where the rest', `${filler}\n\n## Where the rest`);
    const analysis = analyseRouter(inputs(router, { 'module-migrations.md': '# Migrations\nsingle home\n' }));
    expect(kinds(analysis.findings)).toEqual(['oversized-router']);
  });

  it('does not count the speckit appendix toward the ceiling', () => {
    // The appendix grows on its own, so a ceiling over the whole file would go
    // red on a `/speckit.plan` run through no fault of whoever triggered it.
    const appendix = Array.from({ length: ROUTER_BODY_CEILING + 50 }, () => '- a technology').join('\n');
    const router = `${goodRouter(ONE_ROW)}\n${appendix}\n`;
    const analysis = analyseRouter(inputs(router, { 'module-migrations.md': '# Migrations\nsingle home\n' }));
    expect(kinds(analysis.findings)).toEqual([]);
  });
});

describe('the wiring the split must not break', () => {
  const router = readFileSync(join(REPO_ROOT, ROUTER_FILE), 'utf8');

  it('leaves update-agent-context.sh pinned to AGENTS.md, with both its anchors', () => {
    const script = readFileSync(
      join(REPO_ROOT, '.specify', 'scripts', 'bash', 'update-agent-context.sh'),
      'utf8',
    );
    expect(script).toContain('AGENTS_FILE="$REPO_ROOT/AGENTS.md"');
    // It appends by finding these two headings; losing either sends the appendix
    // somewhere else, silently.
    expect(script).toContain('^## Active Technologies');
    expect(script).toContain('^## Recent Changes');
    expect(router).toMatch(/^## Active Technologies$/m);
    expect(router).toMatch(/^## Recent Changes$/m);
    expect(router).toContain(APPENDIX_MARKER);
  });

  it('leaves CLAUDE.md a pointer that imports AGENTS.md and states nothing of its own', () => {
    const claude = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('@AGENTS.md');
    expect(claude).toContain('Do not copy content from `AGENTS.md` into this file');
  });

  it('leaves the Cursor rule a pointer to AGENTS.md', () => {
    const cursor = readFileSync(join(REPO_ROOT, '.cursor', 'rules', 'specify-rules.mdc'), 'utf8');
    expect(cursor).toContain('AGENTS.md');
    expect(cursor).toContain('Do not copy content from `AGENTS.md` into this rule');
  });

  it('keeps the routed directory free of a second index', () => {
    // An index here would be a second enumeration of what `ls` already answers,
    // and the routing table is the one index (D-100).
    const { documents } = readRouterInputs(REPO_ROOT);
    expect([...documents.keys()].filter((n) => /^(readme|index)\.md$/i.test(n))).toEqual([]);
  });
});
