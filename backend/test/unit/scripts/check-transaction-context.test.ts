import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkTransactionContext,
  findTransactionEscapes,
  keyOf,
  CONNECTION_LEVEL_SQL_IN_TRANSACTIONS,
  type TransactionEscape,
} from '../../../scripts/check-transaction-context.js';

/**
 * Companion test for `check-transaction-context.ts` (issue #200).
 *
 * The check's claim has two halves and both are asserted here, because a
 * checker that quietly stops matching one spelling reports zero and reads
 * exactly like a clean tree:
 *
 *   - it sees a connection-level statement written inside a transaction — the
 *     two shapes (`getKnex()`, a short `getConnection().execute`), through the
 *     receiver spellings the tree actually writes, in both scopes that carry a
 *     transaction with them;
 *   - it sees nothing else — an `em.execute`, an `execute` that passes the
 *     transaction context, and the same connection-level call written outside a
 *     transaction are all deliberately out of the population, and each is proven
 *     as a *discrimination* against a sibling fixture that does go red, since
 *     "no finding" cannot go red on its own.
 */

const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const analyse = (text: string): TransactionEscape[] =>
  findTransactionEscapes({ sources: new Map([['modules/blog/services/x.ts', text]]) });

const wrapped = (body: string): string =>
  ['await em.transactional(async (tx) => {', body, '});'].join('\n');

const command = (body: string): string =>
  [
    'const cmd = {',
    "  action: 'product.delete',",
    "  objectType: 'product',",
    '  run: async ({ em }) => {',
    body,
    '  },',
    '};',
  ].join('\n');

describe('check-transaction-context sees a statement that escapes its transaction', () => {
  it('a knex instance taken inside a transactional callback', () => {
    const found = analyse(wrapped("const knex = tx.getKnex();\nawait knex('orders').del();"));
    expect(found.map((f) => f.shape)).toEqual(['knex-instance']);
    expect(found[0]?.scope).toBe('transactional-callback');
  });

  it('a connection-level execute with no transaction context', () => {
    const found = analyse(
      wrapped("await tx.getConnection().execute('delete from blog_posts where id = ?', [id]);"),
    );
    expect(found.map((f) => f.shape)).toEqual(['connection-execute']);
    expect(found[0]?.direction).toBe('write');
  });

  it('a connection bound to a local, which is how most of them are written', () => {
    const found = analyse(
      wrapped(
        [
          'const conn = tx.getConnection();',
          "await conn.execute('insert into blog_tags (id) values (?)', [id]);",
        ].join('\n'),
      ),
    );
    expect(found.map((f) => f.shape)).toEqual(['connection-execute']);
    expect(found[0]?.direction).toBe('write');
  });

  it("a Command's run body, where the Command Bus supplies the transaction", () => {
    const found = analyse(
      command("await em.getConnection().execute('select id from products where sku = ?', [sku]);"),
    );
    expect(found.map((f) => f.scope)).toEqual(['command-run']);
    expect(found[0]?.direction).toBe('read');
  });
});

describe('check-transaction-context leaves alone what carries its context', () => {
  /**
   * Each of these is paired with a fixture that differs only in the part under
   * test, so "found nothing" is a discrimination rather than a checker that has
   * stopped looking (issue #130).
   */
  it('an execute handed the transaction context — the house pattern', () => {
    const escaping = wrapped(
      "await tx.getConnection().execute('update orders set status = ?', [s]);",
    );
    const correct = wrapped(
      "await tx.getConnection().execute('update orders set status = ?', [s], 'run', tx.getTransactionContext());",
    );
    expect(analyse(escaping)).toHaveLength(1);
    expect(analyse(correct)).toHaveLength(0);
  });

  it("the EntityManager's own execute, which fills the context in", () => {
    const escaping = wrapped("await tx.getConnection().execute('delete from cms_pages', []);");
    const correct = wrapped("await tx.execute('delete from cms_pages', []);");
    expect(analyse(escaping)).toHaveLength(1);
    expect(analyse(correct)).toHaveLength(0);
  });

  it('the same connection-level call outside any transaction', () => {
    const inside = wrapped("await em.getConnection().execute('select 1 from orders', []);");
    const outside = "await em.getConnection().execute('select 1 from orders', []);";
    expect(analyse(inside)).toHaveLength(1);
    expect(analyse(outside)).toHaveLength(0);
  });

  it('a `run` that is not a Command — no action, no transaction to escape', () => {
    const cmd = command("await em.getConnection().execute('select 1 from orders', []);");
    const worker = cmd.replace("  action: 'product.delete',\n", '');
    expect(analyse(cmd)).toHaveLength(1);
    expect(analyse(worker)).toHaveLength(0);
  });
});

describe('check-transaction-context over the tree', () => {
  const sources = readTree(join(BACKEND_ROOT, 'src'));

  it('reads the tree it claims to read', () => {
    // The count is the vacuous-pass guard in test form: zero findings over zero
    // sources is indistinguishable from a clean tree.
    expect(sources.size, 'no sources found under src/ — a vacuous pass').toBeGreaterThan(1000);
    const opensTransactions = [...sources].filter(([, text]) => text.includes('transactional('));
    expect(opensTransactions.length, 'no file opens a transaction').toBeGreaterThan(20);
  });

  it('finds no statement escaping the transaction it is written inside', () => {
    const result = checkTransactionContext({ sources }, CONNECTION_LEVEL_SQL_IN_TRANSACTIONS);
    expect(result.violations.map((v) => `${v.file}:${v.line} ${v.statement}`)).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it('refuses a ledger entry that no longer describes an escape', () => {
    const result = checkTransactionContext(
      { sources: new Map([['modules/blog/services/x.ts', 'const a = 1;']]) },
      { 'modules/blog/services/x.ts#knex-instance#tx.getKnex()': 'retired long ago' },
    );
    expect(result.stale).toEqual(['modules/blog/services/x.ts#knex-instance#tx.getKnex()']);
  });

  it('a ledgered site is not a violation, and its key is the site itself', () => {
    const text = wrapped('const knex = tx.getKnex();');
    const [escape] = findTransactionEscapes({
      sources: new Map([['modules/blog/services/x.ts', text]]),
    });
    expect(escape).toBeDefined();
    const result = checkTransactionContext(
      { sources: new Map([['modules/blog/services/x.ts', text]]) },
      { [keyOf(escape!)]: 'an advisory lock that must outlive this transaction' },
    );
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
  });

  it('names its vacuous-pass guard and exits 2 rather than 0 on an unread tree', () => {
    const script = readFileSync(join(BACKEND_ROOT, 'scripts/check-transaction-context.ts'), 'utf8');
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
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        sources.set(`${prefix}${name}`, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root, '');
  return sources;
}
