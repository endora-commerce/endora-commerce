import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkFixtureSubstitution,
  filesReadingTheDatabase,
  findDefaultedReads,
  keyOf,
  DEFAULTED_FIXTURE_READS,
} from '../../../scripts/check-fixture-substitution.js';

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Companion test for `check-fixture-substitution.ts` (issue #159).
 *
 * The check's claim is narrow and every clause of it is asserted here, because a
 * checker that quietly stops matching one spelling reports zero and reads
 * exactly like a clean tree:
 *
 *   - it sees the two shapes a defaulted read is written in (two-step, inline),
 *     through a `const`, a `let` and a plain assignment, and through an index;
 *   - it sees the fabricating fallbacks and **only** those — `null` and
 *     `undefined` keep the absence in the type and are not reported;
 *   - it does not see an `expect(x ?? null)` normalisation, a `findOneOrFail`, a
 *     fallback that creates the fixture, or a `??` over something that never
 *     touched the database;
 *   - it does not measure its own seam.
 */

const sourcesOf = (file: string, text: string): { sources: Map<string, string> } => ({
  sources: new Map([[file, text]]),
});

/** The block six files had grown, verbatim (issue #159). */
const SIX_COPIES = [
  'beforeAll(async () => {',
  '  db = await setupTestDb();',
  '  const tmpEm = db.orm.em.fork();',
  '  const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });',
  "  systemDefaultChannelId = ch?.id ?? '';",
  '});',
].join('\n');

describe('check-fixture-substitution sees a defaulted database read', () => {
  it('reports the two-step shape the six carts files carried', () => {
    const found = findDefaultedReads(
      sourcesOf('integration/carts/cart-abandonment-worker.integration.test.ts', SIX_COPIES),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.shape).toBe('two-step');
    expect(found[0]?.holder).toBe('ch');
    expect(found[0]?.operator).toBe('??');
    expect(found[0]?.fallback).toBe("''");
    expect(found[0]?.line).toBe(5);
  });

  it('reports the inline shape, where the read is never bound to a name', () => {
    const source =
      "const id = (await em.findOne(SalesChannel, { systemDefault: true }))?.id ?? '';";
    const found = findDefaultedReads(sourcesOf('integration/x.test.ts', source));
    expect(found).toHaveLength(1);
    expect(found[0]?.shape).toBe('inline');
    expect(found[0]?.holder).toBe('(inline)');
  });

  it('reports a read bound by plain assignment, not only by declaration', () => {
    const source = [
      'let rows;',
      "rows = await em.execute('select id from sales_channels');",
      "const id = rows[0]?.id ?? '';",
    ].join('\n');
    const found = findDefaultedReads(sourcesOf('integration/x.test.ts', source));
    expect(found.map((f) => f.holder)).toEqual(['rows']);
    expect(found[0]?.shape).toBe('two-step');
  });

  it('reports `||` as well as `??` — the substitution is the same', () => {
    const source = [
      'const ch = await em.findOne(SalesChannel, {});',
      "const id = ch?.id || 'default';",
    ].join('\n');
    const found = findDefaultedReads(sourcesOf('integration/x.test.ts', source));
    expect(found.map((f) => f.operator)).toEqual(['||']);
    expect(found[0]?.fallback).toBe("'default'");
  });

  it('reports `randomUUID()` — an id that matches no row is the worst placeholder', () => {
    const source = [
      "const admins = await em.execute('select id from admin_users limit 1');",
      'const actorId = admins[0]?.id ?? randomUUID();',
    ].join('\n');
    const found = findDefaultedReads(sourcesOf('integration/x.test.ts', source));
    expect(found.map((f) => f.fallback)).toEqual(['randomUUID()']);
  });

  it('reports a numeric fabrication, which reads as a real quantity', () => {
    const source = [
      'const stockBefore = await em.findOne(StockLevel, { productId });',
      'const reservedBefore = stockBefore?.reserved ?? 0;',
    ].join('\n');
    const found = findDefaultedReads(sourcesOf('contract/orders/external-intake.test.ts', source));
    expect(found.map((f) => f.fallback)).toEqual(['0']);
  });
});

describe('check-fixture-substitution leaves the honest shapes alone', () => {
  it('does not report `?? null` — the absence stays in the type', () => {
    const source = [
      'const ch = await em.findOne(SalesChannel, {});',
      'const id = ch?.id ?? null;',
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not report an `expect(x ?? null)` normalisation', () => {
    const source = [
      'const remaining = await em.find(AvailabilityNotification, {});',
      "expect(remaining[0]?.variantId ?? 'none').toBe('none');",
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not report a fallback inside a chained matcher argument', () => {
    const source = [
      'const rows = await em.execute("select count(*) as c from t");',
      "expect(String(rows[0]?.c ?? '0')).toBe('0');",
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not report `findOneOrFail`, which already fails on absence', () => {
    const source = [
      'const ch = await em.findOneOrFail(SalesChannel, {});',
      "const id = ch.id ?? '';",
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not report a fallback that creates the fixture', () => {
    const source = [
      'const ch = await em.findOne(SalesChannel, {});',
      'const id = ch?.id ?? (await createDefaultChannel()).id;',
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not report a `??` over something that never touched the database', () => {
    const source = "const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';";
    expect(findDefaultedReads(sourcesOf('integration/x.test.ts', source))).toEqual([]);
  });

  it('does not measure its own seam', () => {
    const source = [
      'const ch = await orm.em.fork().findOne(SalesChannel, { systemDefault: true });',
      "const id = ch?.id ?? '';",
    ].join('\n');
    expect(findDefaultedReads(sourcesOf('helpers/test-db.ts', source))).toEqual([]);
    expect(findDefaultedReads(sourcesOf('global-setup.ts', source))).toEqual([]);
  });
});

describe('check-fixture-substitution ratchets in both directions', () => {
  const source = [
    'const ch = await em.findOne(SalesChannel, {});',
    "const id = ch?.id ?? '';",
  ].join('\n');

  it('fails on an unledgered defaulted read', () => {
    const result = checkFixtureSubstitution(sourcesOf('integration/x.test.ts', source), {});
    expect(result.violations).toHaveLength(1);
    expect(result.stale).toEqual([]);
  });

  it('accepts a ledgered one, keyed by file and holder', () => {
    const result = checkFixtureSubstitution(sourcesOf('integration/x.test.ts', source), {
      'integration/x.test.ts:ch': 'a reason',
    });
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
    expect(keyOf(result.ledgered[0]!)).toBe('integration/x.test.ts:ch');
  });

  it('fails on a ledger entry that no longer describes one', () => {
    const result = checkFixtureSubstitution(sourcesOf('integration/x.test.ts', 'const a = 1;'), {
      'integration/x.test.ts:ch': 'a reason',
    });
    expect(result.stale).toEqual(['integration/x.test.ts:ch']);
  });
});

describe('the shipped ledger', () => {
  it('carries a reason for every entry', () => {
    for (const [key, reason] of Object.entries(DEFAULTED_FIXTURE_READS)) {
      expect(reason.length, `${key} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe('over the real tree', () => {
  const sources = readTree(join(BACKEND_ROOT, 'test'));

  it('reads a tree big enough for a green to mean something', () => {
    expect(sources.size, 'no sources found under test/ — a vacuous pass').toBeGreaterThan(500);
    // The second guard, exercised rather than described: a green over a tree in
    // which the read detection matches nothing is the quiet way to report
    // nothing (issue #113).
    expect(
      filesReadingTheDatabase({ sources }),
      'no test file reads the database — the read detection has gone blind',
    ).toBeGreaterThan(100);
  });

  it('finds no unledgered defaulted read, and no stale entry', () => {
    const result = checkFixtureSubstitution({ sources }, DEFAULTED_FIXTURE_READS);
    expect(
      result.violations.map((v) => `${v.file}:${v.line} ${v.holder} ${v.operator} ${v.fallback}`),
    ).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('names its vacuous-pass guard and exits 2 rather than 0 on an unread tree', () => {
    const script = readFileSync(
      join(BACKEND_ROOT, 'scripts/check-fixture-substitution.ts'),
      'utf8',
    );
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
