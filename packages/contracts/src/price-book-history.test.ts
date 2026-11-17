import { describe, expect, it } from 'vitest';
import {
  priceBookHistoryChangesResponseSchema,
  priceBookHistoryLinesResponseSchema,
  priceBookHistoryProductLinesResponseSchema,
  priceBookHistoryQuerySchema,
} from './price-books.js';

/**
 * Issue #470 stage 3 — the shapes of a price book's price-change history
 * (`GET /api/v1/admin/price-books/:id/price-history…`), defined before the
 * routes (Principle II). Keyset pages, `{ data, pagination }`; amounts are the
 * stored decimal strings, never rounded.
 */

const ID = '00000000-0000-4000-8000-000000000001';
const CHANGE = '00000000-0000-4000-8000-000000000002';
const P = '00000000-0000-4000-8000-000000000003';
const V = '00000000-0000-4000-8000-000000000004';
const ORG = '00000000-0000-4000-8000-000000000005';
const AT = '2026-11-17T10:15:30.123Z';
const page = { cursor: null, hasMore: false, limit: 50 };

const line = {
  seq: 0,
  kind: 'changed',
  selection: { variantId: V, productId: P, categoryId: null, attributeKey: null, attributeValue: null },
  minQuantity: 1,
  maxQuantity: null,
  before: { type: 'fixed', amount: '0.0125' },
  after: { type: 'amount', amount: '-1.2345' },
};

describe('price-book history query', () => {
  it('defaults the limit to 50 and caps it at 200', () => {
    expect(priceBookHistoryQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(priceBookHistoryQuerySchema.parse({ limit: '200', cursor: 'abc' })).toEqual({ limit: 200, cursor: 'abc' });
    expect(priceBookHistoryQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(priceBookHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });
});

describe('price-book history changes', () => {
  it('carries the actor, the changed header values and the line count; no totalCount', () => {
    const parsed = priceBookHistoryChangesResponseSchema.parse({
      data: [
        {
          id: CHANGE,
          action: 'price_list.update',
          actor: { kind: 'admin', id: ID, name: 'Ada Admin' },
          at: AT,
          headerBefore: { name: 'A', audience: { kind: 'organizations', memberIds: [ORG], withheldMemberCount: 2 } },
          headerAfter: { name: 'B', audience: { kind: 'organizations', memberIds: [] } },
          lineCount: 0,
        },
        {
          id: ID,
          action: 'price_list.duplicate',
          actor: { kind: 'system', id: null, name: null },
          at: AT,
          headerBefore: null,
          headerAfter: { name: 'Copy', priority: 0, audience: { kind: 'everyone', memberIds: [] }, amountMultiplier: '1.5' },
          lineCount: 5000,
        },
      ],
      pagination: { cursor: 'eyJ9', hasMore: true, limit: 2 },
    });
    expect(parsed.data[0]!.headerBefore?.audience?.withheldMemberCount).toBe(2);
    expect(parsed).not.toHaveProperty('meta');
  });

  it('refuses an actor kind the Command Bus does not know', () => {
    const bad = {
      data: [{ id: CHANGE, action: 'x', actor: { kind: 'robot', id: null, name: null }, at: AT, headerBefore: null, headerAfter: null, lineCount: 0 }],
      pagination: page,
    };
    expect(priceBookHistoryChangesResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('price-book history lines', () => {
  it('keeps sub-cent amounts and signed adjustments as the stored strings', () => {
    const parsed = priceBookHistoryLinesResponseSchema.parse({ data: [line], pagination: page });
    expect(parsed.data[0]!.before).toEqual({ type: 'fixed', amount: '0.0125' });
    expect(parsed.data[0]!.after).toEqual({ type: 'amount', amount: '-1.2345' });
  });

  it('has no before side on an added line and no after side on a removed one', () => {
    expect(
      priceBookHistoryLinesResponseSchema.safeParse({
        data: [
          { ...line, kind: 'added', before: null, after: { type: 'percent', percent: '12.50' } },
          { ...line, seq: 1, kind: 'removed', before: { type: 'percent', percent: '-7.00' }, after: null },
        ],
        pagination: page,
      }).success,
    ).toBe(true);
  });

  it('a product history line names its change, its time, action and actor', () => {
    const parsed = priceBookHistoryProductLinesResponseSchema.parse({
      data: [{ ...line, changeId: CHANGE, at: AT, action: 'price_list.rows_replace', actor: { kind: 'api_key', id: null, name: null } }],
      pagination: page,
    });
    expect(parsed.data[0]!.changeId).toBe(CHANGE);
    expect(
      priceBookHistoryProductLinesResponseSchema.safeParse({ data: [line], pagination: page }).success,
    ).toBe(false);
  });
});
