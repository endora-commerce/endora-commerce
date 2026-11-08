import { describe, expect, it } from 'vitest';
import type { QuickOrderPreview } from '@endora-commerce/contracts';
import { collapseOverflow, previewLineCount, refusesGrowth } from './preview-limits.js';

/**
 * PO ruling of 2026-11-08 on PR #942 (issue #809): the preview's line cap is the effective
 * `quick_order.import_max_rows`; only rows the import read count; the rows past its limit are kept
 * as one `overflowCount`; and a write that adds no line is accepted above a cap lowered since.
 */

const PRODUCT = '00000000-0000-4000-8000-00000000f001';

function preview(recognized: number, rejected: number, overflow: number): QuickOrderPreview {
  return {
    recognized: Array.from({ length: recognized }, (_, index) => ({
      line: index + 2,
      sku: `SKU-${index}`,
      productId: PRODUCT,
      variantId: null,
      quantity: 1,
    })),
    rejected: [
      ...Array.from({ length: rejected }, (_, index) => ({
        line: recognized + index + 2,
        raw: `NOPE-${index},1`,
        reason: 'product_not_found' as const,
      })),
      ...Array.from({ length: overflow }, (_, index) => ({
        line: recognized + rejected + index + 2,
        raw: `LATE-${index},1`,
        reason: 'row_limit_exceeded' as const,
      })),
    ],
    summary: { recognizedCount: recognized, rejectedCount: rejected + overflow, mergedCount: 0, truncated: overflow > 0 },
  };
}

describe('collapseOverflow', () => {
  it('keeps the rows past the limit as one count, with the limit they were past', () => {
    const collapsed = collapseOverflow(preview(3, 1, 4), 4);
    expect(collapsed.rejected.map((row) => row.reason)).toEqual(['product_not_found']);
    expect(collapsed.summary).toMatchObject({ overflowCount: 4, rowLimit: 4, truncated: true, rejectedCount: 1 });
  });

  it('adds to a count the preview already carries, and keeps the limit it was read under', () => {
    const once = collapseOverflow(preview(3, 0, 2), 3);
    const again = collapseOverflow({ ...once, rejected: [...once.rejected, ...preview(0, 0, 1).rejected] }, 9);
    expect(again.summary).toMatchObject({ overflowCount: 3, rowLimit: 3 });
  });

  it('leaves a preview without overflow as it was', () => {
    const plain = preview(2, 1, 0);
    expect(collapseOverflow(plain, 10)).toEqual(plain);
  });
});

describe('previewLineCount', () => {
  it('counts recognised and rejected rows the import read, never the overflow', () => {
    expect(previewLineCount(preview(3, 2, 7))).toBe(5);
  });
});

describe('refusesGrowth', () => {
  it('refuses a preview over the cap that grew', () => {
    expect(refusesGrowth({ lines: 1_001, previousLines: 1_000, cap: 1_000 })).toBe(true);
    expect(refusesGrowth({ lines: 1_001, previousLines: 0, cap: 1_000 })).toBe(true);
  });

  it('accepts one at or under the cap', () => {
    expect(refusesGrowth({ lines: 1_000, previousLines: 0, cap: 1_000 })).toBe(false);
  });

  it('accepts a write that adds no line above a cap lowered since', () => {
    expect(refusesGrowth({ lines: 2_999, previousLines: 3_000, cap: 1_000 })).toBe(false);
    expect(refusesGrowth({ lines: 3_000, previousLines: 3_000, cap: 1_000 })).toBe(false);
    expect(refusesGrowth({ lines: 3_001, previousLines: 3_000, cap: 1_000 })).toBe(true);
  });
});
