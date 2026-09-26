import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AttributeValueKeyError, AttributeValueKeyService } from './attribute-value-key.service.js';

/**
 * `catalog` renames a value key across the two places it stores one by string
 * (`specs/134-paid-module-extraction/research.md` D12, *Ergonode fallback
 * boundary*): the `products.attribute_values` JSONB map, keyed by the attribute
 * key, and `product_value_overrides.attribute_key`. Everything else in the
 * catalogue points at an attribute by id and needs nothing.
 *
 * What this file pins is the seam's contract rather than the SQL's effect —
 * that is on a real Postgres in
 * `backend/test/integration/catalog/attribute-value-key.test.ts`: every
 * statement runs on the **caller's** transaction, the destination is read and
 * locked first, `refuse` writes nothing when it is occupied, `displace` removes
 * and returns what is there before the key moves, and a key the seam must not
 * move is refused before a statement is issued
 * (`specs/134-paid-module-extraction/research.md` D12, *what a rename does to
 * data already under its destination*).
 */

interface Call {
  sql: string;
  params: unknown[];
  method: string;
  ctx: unknown;
}

interface Destination {
  values?: Array<{ product_id: string; value: unknown }>;
  overrides?: Array<{
    product_id: string;
    channel_id: string;
    language_code: string | null;
    value: unknown;
  }>;
}

/**
 * A connection that answers the two destination reads from `destination` and
 * every write with an affected-row count, recording what was asked of it.
 */
function fakeEm(
  destination: Destination = {},
  affected: { products?: number; overrides?: number } = {},
) {
  const tx = { transaction: 'caller' };
  const calls: Call[] = [];
  const em = {
    getTransactionContext: () => tx,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[], method: string, ctx: unknown) => {
        calls.push({ sql, params, method, ctx });
        if (/^\s*select/i.test(sql) && sql.includes('"products"')) return destination.values ?? [];
        if (/^\s*select/i.test(sql)) return destination.overrides ?? [];
        if (/^\s*delete/i.test(sql)) return destination.overrides ?? [];
        if (sql.includes('- ?::text') && !sql.includes('||')) {
          return { affectedRows: destination.values?.length ?? 0 };
        }
        if (sql.includes('"products"')) return { affectedRows: affected.products ?? 0 };
        return { affectedRows: affected.overrides ?? 0 };
      },
    }),
  };
  return { em: em as unknown as EntityManager, calls, tx };
}

const writes = (calls: Call[]) => calls.filter((c) => !/^\s*select/i.test(c.sql));

describe('AttributeValueKeyService.renameValueKey', () => {
  it('moves the key in products and in channel overrides, on the caller transaction', async () => {
    const { em, calls, tx } = fakeEm({}, { products: 3, overrides: 2 });

    const moved = await new AttributeValueKeyService().renameValueKey(
      em,
      'ergonode_kod__cznika',
      'ergonode_kod_lacznika',
      { occupied: 'refuse' },
    );

    expect(moved).toEqual({
      products: 3,
      overrides: 2,
      displaced: { values: [], overrides: [] },
    });
    expect(writes(calls).map((c) => c.sql.match(/update "(\w+)"/)?.[1])).toEqual([
      'products',
      'product_value_overrides',
    ]);
    for (const call of calls) {
      expect(call.ctx).toBe(tx);
      // Bound, never interpolated.
      expect(call.sql).not.toContain('ergonode_kod');
    }
  });

  it('locks the destination rows it reads', async () => {
    const { em, calls } = fakeEm();

    await new AttributeValueKeyService().renameValueKey(em, 'from_key', 'to_key', {
      occupied: 'refuse',
    });

    const reads = calls.filter((c) => /^\s*select/i.test(c.sql));
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.sql).toMatch(/for update/i);
      expect(read.params).toContain('to_key');
    }
  });

  it('refuses an occupied destination with both counts, before any write', async () => {
    const { em, calls } = fakeEm({
      values: [{ product_id: 'p1', value: 'dormant' }],
      overrides: [
        { product_id: 'p1', channel_id: 'c1', language_code: null, value: { v: 'x' } },
        { product_id: 'p2', channel_id: 'c1', language_code: 'pl', value: { v: 'y' } },
      ],
    });

    const failure = await new AttributeValueKeyService()
      .renameValueKey(em, 'from_key', 'to_key', { occupied: 'refuse' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AttributeValueKeyError);
    expect((failure as AttributeValueKeyError).code).toBe('target_occupied');
    expect((failure as Error).message).toMatch(/to_key.*1.*2/s);
    expect(writes(calls)).toEqual([]);
  });

  it('displaces what is under the destination, returns it, then moves the key', async () => {
    const values = [{ product_id: 'p1', value: 'dormant' }];
    const overrides = [
      { product_id: 'p1', channel_id: 'c1', language_code: null, value: { v: 'x' } },
    ];
    const { em, calls } = fakeEm({ values, overrides }, { products: 1, overrides: 1 });

    const moved = await new AttributeValueKeyService().renameValueKey(em, 'from_key', 'to_key', {
      occupied: 'displace',
    });

    expect(moved.displaced).toEqual({
      values: [{ productId: 'p1', value: 'dormant' }],
      overrides: [{ productId: 'p1', channelId: 'c1', languageCode: null, value: { v: 'x' } }],
    });
    // Strip and delete first, the two moves after — so the move can never meet
    // the destination, whichever products hold it.
    const order = writes(calls).map((c) =>
      /^\s*delete/i.test(c.sql)
        ? 'delete overrides'
        : c.sql.includes('||')
          ? 'move values'
          : c.sql.includes('"products"')
            ? 'strip values'
            : 'move overrides',
    );
    expect(order).toEqual(['strip values', 'delete overrides', 'move values', 'move overrides']);
  });

  it('issues nothing when the key does not change', async () => {
    const { em, calls } = fakeEm();

    const moved = await new AttributeValueKeyService().renameValueKey(em, 'same_key', 'same_key', {
      occupied: 'refuse',
    });

    expect(moved).toEqual({ products: 0, overrides: 0, displaced: { values: [], overrides: [] } });
    expect(calls).toEqual([]);
  });

  it.each([
    ['a system attribute as the source', 'name', 'custom_name'],
    ['a system attribute as the target', 'custom_description', 'description'],
    ['a key outside the attribute grammar', 'valid_key', 'Not A Key'],
  ])('refuses %s before issuing a statement', async (_label, from, to) => {
    const { em, calls } = fakeEm();

    await expect(
      new AttributeValueKeyService().renameValueKey(em, from, to, { occupied: 'displace' }),
    ).rejects.toBeInstanceOf(AttributeValueKeyError);
    expect(calls).toEqual([]);
  });
});
