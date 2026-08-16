import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeSource, collectTsxFiles } from '../../../scripts/i18n-hardcoded-strings.js';

/**
 * The hard-coded-string rule's own test (issue #113).
 *
 * The walk was reachable only through `main`, so nothing exercised it, and the
 * default root was `admin/src` resolved against the working directory — which
 * from `backend/` (where the documented `pnpm --filter backend run
 * i18n:hardcoded` runs) matches nothing. The check read zero files, reported
 * "0 finding(s) across 0 file(s)" and exited 0 for as long as it has existed.
 *
 * So two things are proved here: the analysis goes **red** on each shape the
 * header claims to flag, and the default root is a real directory with `.tsx`
 * files under it.
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
