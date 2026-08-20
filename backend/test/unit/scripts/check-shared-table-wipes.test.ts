import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkSharedTableWipes,
  compareToBaseline,
  countByFile,
  filesDeletingRows,
  findUnscopedWipes,
  truncatedTables,
  unfilteredDeleteTable,
  UNSCOPED_WIPES_BASELINE,
} from '../../../scripts/check-shared-table-wipes.js';

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Companion test for `check-shared-table-wipes.ts` (issue #166).
 *
 * The check's claim is that it sees a whole-table wipe in a test in every
 * spelling the tree writes one, and that it sees nothing else — both halves
 * matter, because a checker that stops matching a spelling reports zero and
 * reads exactly like a drained tree, and one that over-matches turns every
 * scoped cleanup in `test/` into a baseline entry nobody can act on.
 *
 *   - it sees the three spellings: `nativeDelete(Entity, {})`, a `truncate`, and
 *     a `delete from` with no `where`;
 *   - it sees them wherever they sit — a hook, a test body, a module-level
 *     helper — and says which;
 *   - it does not see a delete that carries a filter, in either spelling;
 *   - it does not measure the harness, which owns the truncate it implements;
 *   - the baseline ratchets both ways.
 */

const sourcesOf = (file: string, text: string): { sources: Map<string, string> } => ({
  sources: new Map([[file, text]]),
});

/** The block all eight comparison files carried, verbatim (issue #166). */
const EIGHT_COPIES = [
  'beforeEach(async () => {',
  '  const em = h.em();',
  '  await em.nativeDelete(ComparisonProduct, {});',
  '  await em.nativeDelete(Comparison, {});',
  '});',
].join('\n');

describe('check-shared-table-wipes sees a whole-table wipe', () => {
  it('reports the ORM shape the eight comparison files carried', () => {
    const found = findUnscopedWipes(
      sourcesOf('contract/comparisons/public-pdf.contract.test.ts', EIGHT_COPIES),
    );
    expect(found.map((w) => w.table)).toEqual(['ComparisonProduct', 'Comparison']);
    expect(found.every((w) => w.kind === 'orm')).toBe(true);
    expect(found[0]?.site).toBe('hook');
    expect(found[0]?.enclosing).toBe('beforeEach');
    expect(found[0]?.line).toBe(3);
  });

  it('reports a raw truncate, every table in the statement', () => {
    const source = [
      'beforeEach(async () => {',
      '  await h.em().getConnection().execute(',
      '    `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,',
      '  );',
      '});',
    ].join('\n');
    const found = findUnscopedWipes(sourcesOf('integration/price_lists/x.test.ts', source));
    expect(found.map((w) => w.table)).toEqual([
      'price_list_price_brackets',
      'price_list_products',
      'price_lists',
    ]);
    expect(found.every((w) => w.kind === 'sql-truncate')).toBe(true);
  });

  it('reports an unfiltered `delete from`', () => {
    const source = [
      'beforeAll(async () => {',
      '  await conn.execute(`delete from "dictionary_translations"`);',
      '});',
    ].join('\n');
    const found = findUnscopedWipes(sourcesOf('unit/dictionaries/x.test.ts', source));
    expect(found.map((w) => w.kind)).toEqual(['sql-delete']);
    expect(found[0]?.table).toBe('dictionary_translations');
  });

  it('reports a wipe hidden in a module-level helper, not only in a hook', () => {
    const source = [
      'async function mintCookie(h) {',
      '  const em = h.em();',
      '  await em.nativeDelete(Comparison, {});',
      '  return cookie;',
      '}',
    ].join('\n');
    const found = findUnscopedWipes(sourcesOf('integration/comparisons/x.test.ts', source));
    expect(found.map((w) => w.site)).toEqual(['helper']);
    expect(found[0]?.enclosing).toBe('mintCookie');
  });

  it('reports a wipe inside a test body', () => {
    const source = [
      "it('does a thing', async () => {",
      "  await conn.execute('truncate table promotions cascade');",
      '});',
    ].join('\n');
    const found = findUnscopedWipes(sourcesOf('integration/promotions/x.test.ts', source));
    expect(found.map((w) => w.site)).toEqual(['body']);
    expect(found[0]?.enclosing).toBe('it');
  });
});

describe('check-shared-table-wipes leaves the scoped shapes alone', () => {
  it('does not report a `nativeDelete` that carries a filter', () => {
    const source = 'await em.nativeDelete(ModuleAction, { moduleId: TEST_MODULE_ID });';
    expect(findUnscopedWipes(sourcesOf('contract/x.test.ts', source))).toEqual([]);
  });

  it('does not report a `delete from` that carries a where', () => {
    const source = [
      'beforeEach(async () => {',
      "  await conn.execute(`delete from assets where id = ?`, [assetId]);",
      '});',
    ].join('\n');
    expect(findUnscopedWipes(sourcesOf('contract/blog/x.test.ts', source))).toEqual([]);
  });

  it('does not report a select that merely mentions a table', () => {
    const source = "const rows = await conn.execute('select id from comparisons');";
    expect(findUnscopedWipes(sourcesOf('contract/x.test.ts', source))).toEqual([]);
  });

  it('does not measure the harness, which owns the truncate it implements', () => {
    const source = 'await conn.execute(`truncate table "carts", "cart_items" cascade`);';
    expect(findUnscopedWipes(sourcesOf('helpers/test-server.ts', source))).toEqual([]);
    expect(findUnscopedWipes(sourcesOf('global-setup.ts', source))).toEqual([]);
  });
});

describe('the SQL readers', () => {
  it('reads every truncate spelling the tree writes', () => {
    expect(truncatedTables('truncate table promotions cascade')).toEqual(['promotions']);
    expect(truncatedTables('truncate blog_posts, blog_tags cascade')).toEqual([
      'blog_posts',
      'blog_tags',
    ]);
    expect(
      truncatedTables('truncate table "product_attributes" restart identity cascade'),
    ).toEqual(['product_attributes']);
    expect(truncatedTables('select 1')).toBeNull();
  });

  it('separates an unfiltered delete from a filtered one', () => {
    expect(unfilteredDeleteTable('delete from "countries"')).toBe('countries');
    expect(unfilteredDeleteTable('delete from countries where code = ?')).toBeNull();
    expect(unfilteredDeleteTable('insert into countries values (1)')).toBeNull();
  });
});

describe('check-shared-table-wipes ratchets in both directions', () => {
  const source = [
    'beforeEach(async () => {',
    '  await em.nativeDelete(Comparison, {});',
    '});',
  ].join('\n');

  it('fails on a wipe in a file the baseline does not list', () => {
    const result = checkSharedTableWipes(sourcesOf('integration/x.test.ts', source), {});
    expect(result.regressions).toEqual([
      { file: 'integration/x.test.ts', baseline: 0, actual: 1 },
    ]);
    expect(result.drained).toEqual([]);
  });

  it('accepts a file at its baseline', () => {
    const result = checkSharedTableWipes(sourcesOf('integration/x.test.ts', source), {
      'integration/x.test.ts': 1,
    });
    expect(result.regressions).toEqual([]);
    expect(result.drained).toEqual([]);
  });

  it('fails on a file that grew past its baseline', () => {
    const grown = [source, "await conn.execute('truncate table promotions cascade');"].join('\n');
    const result = checkSharedTableWipes(sourcesOf('integration/x.test.ts', grown), {
      'integration/x.test.ts': 1,
    });
    expect(result.regressions.map((d) => d.actual)).toEqual([2]);
  });

  it('fails on a baseline left standing after the wipes under it were scoped', () => {
    const result = checkSharedTableWipes(sourcesOf('integration/x.test.ts', 'const a = 1;'), {
      'integration/x.test.ts': 1,
    });
    expect(result.drained).toEqual([
      { file: 'integration/x.test.ts', baseline: 1, actual: 0 },
    ]);
  });

  it('counts per file, so one file draining does not pay for another growing', () => {
    const counts = countByFile(findUnscopedWipes(sourcesOf('integration/x.test.ts', source)));
    const verdict = compareToBaseline(counts, {
      'integration/x.test.ts': 0,
      'integration/y.test.ts': 3,
    });
    expect(verdict.regressions.map((d) => d.file)).toEqual(['integration/x.test.ts']);
    expect(verdict.drained.map((d) => d.file)).toEqual(['integration/y.test.ts']);
  });
});

describe('over the real tree', () => {
  const sources = readTree(join(BACKEND_ROOT, 'test'));

  it('reads a tree big enough for a green to mean something', () => {
    expect(sources.size, 'no sources found under test/ — a vacuous pass').toBeGreaterThan(500);
    // The second guard, exercised rather than described: a green over a tree
    // whose delete statements the detector no longer recognises is the quiet
    // way to report nothing (issue #113).
    expect(
      filesDeletingRows({ sources }),
      'no test file deletes rows — the detection has gone blind',
    ).toBeGreaterThan(50);
  });

  it('finds no file over its baseline and none drained below it', () => {
    const result = checkSharedTableWipes({ sources }, UNSCOPED_WIPES_BASELINE);
    expect(result.regressions.map((d) => `${d.file}: ${d.actual} > ${d.baseline}`)).toEqual([]);
    expect(result.drained.map((d) => `${d.file}: ${d.actual} < ${d.baseline}`)).toEqual([]);
  });

  it('lists no file at zero — a zero is an invitation to write the shape back', () => {
    for (const file of Object.keys(UNSCOPED_WIPES_BASELINE)) {
      expect(UNSCOPED_WIPES_BASELINE[file], `${file} is listed at zero`).toBeGreaterThan(0);
    }
  });

  it('holds the fix: nothing in `test/` empties the comparisons tables', () => {
    // The eighteen wipes issue #166 was filed over. One comparisons file stays
    // in the baseline — `comparison-price-source` rebuilds the platform's single
    // default price list — so the invariant is about the tables, not the folder.
    expect(
      findUnscopedWipes({ sources })
        .filter((w) => w.table.toLowerCase().startsWith('comparison'))
        .map((w) => `${w.file}:${w.line} ${w.table}`),
    ).toEqual([]);
  });

  it('names its vacuous-pass guard and exits 2 rather than 0 on an unread tree', () => {
    const script = readFileSync(join(BACKEND_ROOT, 'scripts/check-shared-table-wipes.ts'), 'utf8');
    expect(script).toMatch(/vacuous/);
    expect(script).toMatch(/process\.exit\(2\)/);
  });
});

function readTree(root: string): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full, `${prefix}${name}/`);
      } else if (name.endsWith('.ts')) {
        sources.set(`${prefix}${name}`, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root, '');
  return sources;
}
