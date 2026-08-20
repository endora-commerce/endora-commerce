import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  collectTsxFiles,
  compareToBaseline,
  countByFile,
  HARDCODED_STRINGS_BASELINE,
  type Finding,
} from '../../../scripts/i18n-hardcoded-strings.js';

/**
 * The hard-coded-string rule's own test (issue #113, issue #116).
 *
 * The walk was reachable only through `main`, so nothing exercised it, and the
 * default root was `admin/src` resolved against the working directory — which
 * from `backend/` (where the documented `pnpm --filter backend run
 * i18n:hardcoded` runs) matches nothing. The check read zero files, reported
 * "0 finding(s) across 0 file(s)" and exited 0 for as long as it has existed.
 *
 * Fixing that revealed 274 findings across 47 files, which is why the check ran
 * in no CI job even after it could see anything: strict would have failed on
 * history. It runs against a per-file baseline now, and the half of that which
 * rots is the second one — so both directions are driven here, on counts the
 * repository does not contain.
 */

const FILE = '/repo/admin/src/pages/orders/order-list.tsx';

describe('analyzeSource — the shapes it claims to flag', () => {
  it('flags a JSX text node', () => {
    const findings = analyzeSource('export const A = () => <Button>Save changes</Button>;\n', FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'jsx-text', text: 'Save changes', line: 1 });
  });

  it('flags each user-visible attribute', () => {
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      const source = `export const A = () => <input ${attr}="Search orders" />;\n`;
      expect(analyzeSource(source, FILE).map((f) => f.kind), attr).toEqual(['jsx-attr']);
    }
  });

  it('ignores an attribute nobody reads out loud', () => {
    expect(analyzeSource('export const A = () => <div className="flex gap-2" />;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a translated string — it is an expression, not a text node', () => {
    expect(analyzeSource('export const A = () => <Button>{t("orders.save")}</Button>;\n', FILE)).toEqual(
      [],
    );
  });

  it('ignores a code-shaped token and a technical identifier in <code>', () => {
    expect(analyzeSource('export const A = () => <span>order_id</span>;\n', FILE)).toEqual([]);
    expect(analyzeSource('export const A = () => <code>ctx.subscribe</code>;\n', FILE)).toEqual([]);
  });

  it('reports the line and column, so a finding points at the string', () => {
    const source = ['export const A = () => (', '  <p>Nothing here yet</p>', ');', ''].join('\n');
    expect(analyzeSource(source, FILE)[0]).toMatchObject({ line: 2, column: 6 });
  });
});

describe('the default scan root', () => {
  it('exists and holds .tsx files — the check read none of them for its whole life', () => {
    const adminSrc = fileURLToPath(new URL('../../../../admin/src', import.meta.url));
    expect(existsSync(adminSrc), `${adminSrc} is the default root`).toBe(true);
    const files: string[] = [];
    collectTsxFiles(adminSrc, files);
    expect(files.length).toBeGreaterThan(100);
  });
});

describe('countByFile', () => {
  it('groups findings by a path relative to the scan root', () => {
    const findings: Finding[] = [
      { filePath: '/repo/admin/src/pages/a.tsx', line: 1, column: 1, text: 'A', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/pages/a.tsx', line: 2, column: 1, text: 'B', kind: 'jsx-text' },
      { filePath: '/repo/admin/src/b.tsx', line: 1, column: 1, text: 'C', kind: 'jsx-attr' },
    ];
    expect([...countByFile(findings, '/repo/admin/src')]).toEqual([
      ['pages/a.tsx', 2],
      ['b.tsx', 1],
    ]);
  });
});

describe('the baseline ratchet goes red in BOTH directions', () => {
  const baseline = { 'pages/orders.tsx': 3 } as const;

  it('flags a file that gained a hard-coded string', () => {
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 4]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 4 }]);
    expect(verdict.drained).toEqual([]);
  });

  it('flags a file the ledger never mentioned', () => {
    const verdict = compareToBaseline(new Map([['pages/new-screen.tsx', 1]]), baseline);
    expect(verdict.regressions).toEqual([{ file: 'pages/new-screen.tsx', baseline: 0, actual: 1 }]);
  });

  it('flags a ledger entry that describes a debt already paid', () => {
    // The half that rots. A number left standing after the strings were
    // translated is a claim the tree stopped backing, which is the whole of
    // what makes an allow-list rather than a ratchet.
    const verdict = compareToBaseline(new Map([['pages/orders.tsx', 1]]), baseline);
    expect(verdict.drained).toEqual([{ file: 'pages/orders.tsx', baseline: 3, actual: 1 }]);
    expect(verdict.regressions).toEqual([]);
  });

  it('flags a ledger entry whose file is clean or gone', () => {
    expect(compareToBaseline(new Map(), baseline).drained).toEqual([
      { file: 'pages/orders.tsx', baseline: 3, actual: 0 },
    ]);
  });

  it('is silent when the tree matches the ledger exactly', () => {
    expect(compareToBaseline(new Map([['pages/orders.tsx', 3]]), baseline)).toEqual({
      regressions: [],
      drained: [],
    });
  });
});

describe('the tree itself (what CI asserts)', () => {
  it('matches HARDCODED_STRINGS_BASELINE exactly — no new string, no stale entry', () => {
    const adminSrc = fileURLToPath(new URL('../../../../admin/src', import.meta.url));
    const files: string[] = [];
    collectTsxFiles(adminSrc, files);
    const findings = files.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
    const verdict = compareToBaseline(countByFile(findings, adminSrc), HARDCODED_STRINGS_BASELINE);
    expect(verdict.regressions).toEqual([]);
    expect(verdict.drained).toEqual([]);
  });
});
