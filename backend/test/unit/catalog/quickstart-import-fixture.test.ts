import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeCsvScopedCell } from '@endora-commerce/contracts';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T024): the import-ready CSV that
 * `quickstart.md` §3 imports onto the demo catalogue. The importer is US4's, so at C1 this holds
 * the file to the contract it will be read against — `contracts/import-profiles-and-csv.md` §2.1
 * (one anchored header grammar) and `contracts/write-encoding.md` §3 (cells) — and to the demo it
 * names: the demo's two channel codes, the languages they offer, the demo's SKUs.
 */
const FIXTURE = fileURLToPath(
  new URL('../../../../specs/172-product-editor-scope-switcher/fixtures/demo-scoped-import.csv', import.meta.url),
);

/** The demo's channels (`@endora-commerce/demo-composition`'s foundation) and their languages. */
const DEMO_CHANNEL_LANGUAGES: Record<string, readonly string[]> = {
  pl_retail: ['pl-PL', 'en-US'],
  pl_b2b_vip: ['pl-PL', 'en-US'],
};

/** The profile quickstart §3 creates: `pl_PL` → both channels × pl-PL; Global from `en_US`. */
const QUICKSTART_PROFILE = {
  sourceLanguageForGlobal: 'en_US',
  localeMapping: { pl_PL: ['pl_retail/pl-PL', 'pl_b2b_vip/pl-PL'] } as Record<string, readonly string[]>,
};

const FIELD = '(name|description|urlKey|status|attribute:[a-z][a-z0-9_]*)';
const CODE = '[A-Za-z0-9_.-]{1,100}';
const SCOPE_COLUMN = new RegExp(`^${FIELD}@(${CODE})(?:/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*))?$`);
const LOCALE_COLUMN = new RegExp(`^${FIELD}\\[([a-z]{2}_[A-Z]{2})(?:\\|(${CODE}))?\\]$`);
const GLOBAL_COLUMN = new RegExp(`^${FIELD}$`);

const lines = readFileSync(FIXTURE, 'utf8').trimEnd().split('\n');
const header = lines[0]!.split(',');
const rows = lines.slice(1).map((line) => line.split(','));

/** The (field, scope) a column writes under the quickstart profile; `[]` for an unmapped locale. */
function targetsOf(column: string): string[] {
  const scoped = SCOPE_COLUMN.exec(column);
  if (scoped) return [`${scoped[1]}@${scoped[2]}${scoped[3] ? `/${scoped[3]}` : ''}`];
  const locale = LOCALE_COLUMN.exec(column);
  if (locale) {
    if (locale[2] === QUICKSTART_PROFILE.sourceLanguageForGlobal) return [`${locale[1]}@global`];
    return (QUICKSTART_PROFILE.localeMapping[locale[2]!] ?? []).map((scope) => `${locale[1]}@${scope}`);
  }
  return [`${column}@global`];
}

describe('quickstart §3 import fixture (feature 172, T024)', () => {
  it('keys every row by sku, and every row has the header width (no quoted cell)', () => {
    expect(header[0]).toBe('sku');
    expect(lines.join('\n')).not.toMatch(/"/);
    for (const row of rows) expect(row).toHaveLength(header.length);
  });

  it('writes only headers of the one grammar, on the demo channels and their languages', () => {
    for (const column of header.slice(1)) {
      const scoped = SCOPE_COLUMN.exec(column);
      if (scoped) {
        expect(Object.keys(DEMO_CHANNEL_LANGUAGES), column).toContain(scoped[2]);
        if (scoped[3] !== undefined) expect(DEMO_CHANNEL_LANGUAGES[scoped[2]!], column).toContain(scoped[3]);
        continue;
      }
      expect(LOCALE_COLUMN.test(column) || GLOBAL_COLUMN.test(column), column).toBe(true);
    }
    expect(new Set(header).size).toBe(header.length);
  });

  it('has per-scope columns at Channel and at Channel × language, and one unmapped locale', () => {
    const scopes = header.map((column) => SCOPE_COLUMN.exec(column)).filter((match) => match !== null);
    expect(scopes.some((match) => match[3] === undefined)).toBe(true);
    expect(scopes.some((match) => match[3] !== undefined)).toBe(true);
    const unmapped = header.filter((column) => LOCALE_COLUMN.test(column) && targetsOf(column).length === 0);
    expect(unmapped).toEqual(['name[de_DE]']);
  });

  it('lands no two columns on one (field, scope) under the quickstart profile (no IMPORT_CELL_CONFLICT)', () => {
    const targets = header.slice(1).flatMap(targetsOf);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("names the demo's SKUs, Drill X first", () => {
    expect(rows[0]![0]).toBe('DEMO-DRILL-X');
    for (const row of rows) expect(row[0]).toMatch(/^DEMO-(DRILL-X|[A-Z]+-\d{4})$/);
  });

  it('uses every cell form: empty, NULL, INHERIT, an escaped token and text', () => {
    const decoded = rows.flatMap((row) => row.slice(1).map((cell) => decodeCsvScopedCell(cell, { column: 'text' })));
    const kinds = new Set(decoded.map((cell) => cell.kind));
    expect([...kinds].sort()).toEqual(['empty', 'inherit', 'no_change', 'text']);
    expect(decoded).toContainEqual({ kind: 'text', text: 'NULL' });
  });

  it('puts no INHERIT on a Global column (inherit_at_global)', () => {
    header.forEach((column, index) => {
      if (index === 0 || !targetsOf(column).some((target) => target.endsWith('@global'))) return;
      for (const row of rows) expect(row[index], `${row[0]} ${column}`).not.toBe('INHERIT');
    });
  });
});
