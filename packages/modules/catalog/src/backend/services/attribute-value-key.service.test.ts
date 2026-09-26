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
 * `backend/test/integration/pim_ergonode/key-repair.test.ts`: every statement
 * runs on the **caller's** transaction, never on a connection of its own, and
 * a key the seam must not move is refused before a statement is issued.
 */

interface Call {
  sql: string;
  params: unknown[];
  ctx: unknown;
}

function fakeEm(affected: number[] = [0, 0]): { em: EntityManager; calls: Call[]; tx: object } {
  const tx = { transaction: 'caller' };
  const calls: Call[] = [];
  let index = 0;
  const em = {
    getTransactionContext: () => tx,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[], _method: string, ctx: unknown) => {
        calls.push({ sql, params, ctx });
        return { affectedRows: affected[index++] ?? 0 };
      },
    }),
  };
  return { em: em as unknown as EntityManager, calls, tx };
}

describe('AttributeValueKeyService.renameValueKey', () => {
  it('moves the key in products and in channel overrides, on the caller transaction', async () => {
    const { em, calls, tx } = fakeEm([3, 2]);

    const moved = await new AttributeValueKeyService().renameValueKey(
      em,
      'ergonode_kod__cznika',
      'ergonode_kod_lacznika',
    );

    expect(moved).toEqual({ products: 3, overrides: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).toContain('update "products"');
    expect(calls[1]!.sql).toContain('update "product_value_overrides"');
    for (const call of calls) {
      expect(call.ctx).toBe(tx);
      // Bound, never interpolated.
      expect(call.sql).not.toContain('ergonode_kod');
      expect(call.params).toContain('ergonode_kod__cznika');
    }
  });

  it('issues nothing when the key does not change', async () => {
    const { em, calls } = fakeEm();

    const moved = await new AttributeValueKeyService().renameValueKey(em, 'same_key', 'same_key');

    expect(moved).toEqual({ products: 0, overrides: 0 });
    expect(calls).toEqual([]);
  });

  it.each([
    ['a system attribute as the source', 'name', 'custom_name'],
    ['a system attribute as the target', 'custom_description', 'description'],
    ['a key outside the attribute grammar', 'valid_key', 'Not A Key'],
  ])('refuses %s before issuing a statement', async (_label, from, to) => {
    const { em, calls } = fakeEm();

    await expect(
      new AttributeValueKeyService().renameValueKey(em, from, to),
    ).rejects.toBeInstanceOf(AttributeValueKeyError);
    expect(calls).toEqual([]);
  });
});
