import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { operatorLineProducts } from './operator-line-products.js';

/**
 * Feature 163, checkpoint F (B-3) — an operator's create or edit naming an archived
 * product answers `409 PRODUCT_ARCHIVED` with catalog's sentence. The edit sends every
 * line, so a quote holding one archived line refuses any edit: the refusal names the
 * archived products in `details.productIds`, the sentence stays catalog's.
 */
const LIVE = '00000000-0000-4000-8000-000000000001';
const GONE_A = '00000000-0000-4000-8000-000000000002';
const GONE_B = '00000000-0000-4000-8000-000000000003';
const archivedAt = new Date('2026-10-01T00:00:00Z');

describe('operatorLineProducts (163 B-3)', () => {
  it('names every archived product, once, in details.productIds', () => {
    const records = [
      { id: LIVE, archivedAt: null },
      { id: GONE_A, archivedAt },
      { id: GONE_B, archivedAt },
    ];
    let thrown: unknown;
    try {
      operatorLineProducts(records, [LIVE, GONE_A, GONE_B, GONE_A]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRODUCT_ARCHIVED,
      message: 'Product is archived.',
      details: { productIds: [GONE_A, GONE_B] },
    });
  });

  it('answers the products by id when none is archived, and 404 for an absent id', () => {
    const records = [{ id: LIVE, archivedAt: null }];
    expect(operatorLineProducts(records, [LIVE, LIVE]).get(LIVE)).toEqual(records[0]);
    expect(() => operatorLineProducts(records, [LIVE, GONE_A])).toThrowError(
      expect.objectContaining({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND }),
    );
  });
});
