import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { anyRowExists as crmAnyRowExists } from '../../../../packages/modules/crm/src/backend/services/scheduled-work-probe.js';
import { anyRowExists as ordersAnyRowExists } from '../../../../packages/modules/orders/src/backend/services/scheduled-work-probe.js';
import { anyRowExists as priceListsAnyRowExists } from '../../../../packages/modules/price_lists/src/backend/services/scheduled-work-probe.js';
import { anyRowExists as productFeedsAnyRowExists } from '../../../../packages/modules/product_feeds/src/backend/services/scheduled-work-probe.js';
import { anyRowExists as quoteRequestsAnyRowExists } from '../../../../packages/modules/quote_requests/src/backend/services/scheduled-work-probe.js';

/**
 * Issue #120 — the question a scheduled tick asks **outside any tenant scope**
 * can only answer yes or no.
 *
 * A probe runs with no tenant context, so nothing it reads reaches the
 * escape-hatch audit; that is legitimate only while it learns one bit. The
 * rule was prose. This file is what holds it:
 *
 *  1. every probe goes through `anyRowExists`, whose return type is `boolean`
 *     and which writes the select list itself, and performs **no read of its
 *     own** — so a later edit cannot make a probe return ids, rows or counts
 *     without failing here;
 *  2. the per-module copies of that helper are byte-identical — it is a copy
 *     per module because one shared export would be a new name on the
 *     platform's published surface;
 *  3. the helper itself returns nothing but `true` or `false`, whatever the
 *     driver hands back.
 *
 * **Adding a scheduled probe means adding it to {@link PROBES}.** The list is
 * checked against the tree in the other direction too: every file under
 * `packages/modules` that calls `anyRowExists` must be listed, and so must
 * every copy of the helper. What this cannot see is a probe that never touches
 * the helper at all — a tick that runs a raw statement before its scope under
 * some other name; that one is for review, and the page says so.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const MODULES = join(REPO_ROOT, 'packages', 'modules');

/** Module → the file and method that hold its probe. */
const PROBES = [
  { module: 'orders', file: 'services/order-transition-effect-service.ts', method: 'hasSweepWork' },
  { module: 'crm', file: 'services/event-reminder-service.ts', method: 'hasSweepWork' },
  { module: 'product_feeds', file: 'services/feed-run-reaper.service.ts', method: 'hasClaimedRuns' },
  { module: 'price_lists', file: 'services/price-list-status-worker.ts', method: 'hasDueTransitions' },
  { module: 'quote_requests', file: 'services/rfq-expiry-worker.ts', method: 'hasExpirable' },
] as const;

const HELPER = 'services/scheduled-work-probe.ts';

const read = (module: string, file: string): string =>
  readFileSync(join(MODULES, module, 'src', 'backend', file), 'utf8');

/** The text of one class method: from its signature to the closing brace at method indentation. */
function methodBody(source: string, method: string): string {
  const start = source.indexOf(`  async ${method}(`);
  if (start === -1) throw new Error(`no method ${method}`);
  const end = source.indexOf('\n  }\n', start);
  if (end === -1) throw new Error(`method ${method} does not end`);
  return source.slice(start, end);
}

/** Every spelling of a read a probe could perform on its own. */
const OWN_READ = /\.(?:execute|find|findOne|findOneOrFail|findAll|count|findAndCount|getConnection|createQueryBuilder|qb|getKnex|populate|nativeUpdate|nativeDelete)\s*\(/u;

describe('scheduled work probes answer one bit (issue #120)', () => {
  it.each(PROBES)('$module: $method goes through anyRowExists and reads nothing itself', ({ module, file, method }) => {
    const body = methodBody(read(module, file), method);

    expect(body).toContain(`async ${method}(`);
    expect(body).toMatch(/\): Promise<boolean> \{/u);
    expect(body).toContain('return anyRowExists(');
    expect(body.match(OWN_READ), `${module}: ${method} performs a read of its own`).toBeNull();
    // No select list of its own either: a row source starts at `from`.
    expect(body).not.toMatch(/\bselect\b/iu);
  });

  it('every caller of anyRowExists in the module tree is a listed probe, and calls it once', () => {
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !full.endsWith(HELPER)) {
          const calls = readFileSync(full, 'utf8').split('anyRowExists(').length - 1;
          // One call site per file — the probe — so a second use of the helper
          // cannot hide behind the listed one.
          if (calls > 0) callers.push(`${relative(MODULES, full).split(sep).join('/')} x${calls}`);
        }
      }
    };
    walk(MODULES);

    expect(callers.sort()).toEqual(
      PROBES.map((probe) => `${probe.module}/src/backend/${probe.file} x1`).sort(),
    );
  });

  it('the helper exists only where a probe uses it', () => {
    const copies = readdirSync(MODULES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(MODULES, entry.name, 'src', 'backend', HELPER)))
      .map((entry) => entry.name);

    expect(copies.sort()).toEqual(PROBES.map((probe) => probe.module).sort());
  });

  it('the per-module copies of the helper are identical', () => {
    const [first, ...rest] = PROBES.map((probe) => read(probe.module, HELPER));
    for (const copy of rest) expect(copy).toBe(first);
  });

  // Each copy is the code that ships in its module, so each is exercised — the
  // byte comparison above says they are the same text, this says what it does.
  describe.each([
    ['orders', ordersAnyRowExists],
    ['crm', crmAnyRowExists],
    ['product_feeds', productFeedsAnyRowExists],
    ['price_lists', priceListsAnyRowExists],
    ['quote_requests', quoteRequestsAnyRowExists],
  ] as const)('anyRowExists (%s)', (_module, anyRowExists) => {
    const emAnswering = (rows: unknown) => ({ execute: vi.fn(async () => rows) });

    it('builds the select list itself: one exists(…) per row source, parameters in order', async () => {
      const em = emAnswering([{ has_work: true }]);

      await anyRowExists(em, [
        { from: 'from "a" where "x" = ?', params: [1] },
        { from: 'from "b" where "y" < ? and "z" = ?', params: [2, 3] },
      ]);

      expect(em.execute).toHaveBeenCalledTimes(1);
      expect(em.execute).toHaveBeenCalledWith(
        'select (exists(select 1 from "a" where "x" = ?) or exists(select 1 from "b" where "y" < ? and "z" = ?)) as "has_work"',
        [1, 2, 3],
      );
    });

    it.each([
      ['true', [{ has_work: true }], true],
      ['false', [{ has_work: false }], false],
      ['no row', [], false],
      ['a count', [{ has_work: 3 }], false],
      ['a string', [{ has_work: 't' }], false],
      ['a row of data', [{ has_work: { id: 'an-order', organization_id: 'an-organization' } }], false],
      ['extra columns beside it', [{ has_work: true, id: 'an-order' }], true],
    ])('answers a boolean and nothing else when the driver returns %s', async (_what, rows, expected) => {
      const answer = await anyRowExists(emAnswering(rows), [{ from: 'from "a"', params: [] }]);

      expect(answer).toBe(expected);
      expect(typeof answer).toBe('boolean');
    });

    it('asks nothing when there is nothing to ask about', async () => {
      const em = emAnswering([{ has_work: true }]);

      expect(await anyRowExists(em, [])).toBe(false);
      expect(em.execute).not.toHaveBeenCalled();
    });
  });
});
