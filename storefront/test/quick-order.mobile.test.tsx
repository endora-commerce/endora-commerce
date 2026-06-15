import { describe, expect, it } from 'vitest';
import { summarizeQuickOrderPreview } from '../lib/quick-order-preview';

/**
 * Feature 044 / US7 — mobile Quick Order summary.
 *
 * The summary pills and the sticky bottom bar are driven by this pure helper:
 * recognised / invalid counts and total units. The end-to-end paste → validate
 * → add-to-cart flow is device-verified; this locks the arithmetic.
 */
describe('summarizeQuickOrderPreview', () => {
  it('counts recognised lines, invalid lines, and sums units', () => {
    const preview = {
      recognized: [
        { quantity: 50 },
        { quantity: 12 },
        { quantity: 24 },
      ],
      rejected: [{ line: 4 }, { line: 5 }],
    };
    expect(summarizeQuickOrderPreview(preview)).toEqual({
      recognised: 3,
      invalid: 2,
      units: 86,
    });
  });

  it('reports zeros for an empty preview', () => {
    expect(summarizeQuickOrderPreview({ recognized: [], rejected: [] })).toEqual({
      recognised: 0,
      invalid: 0,
      units: 0,
    });
  });

  it('ignores non-finite quantities when summing units', () => {
    const preview = {
      recognized: [{ quantity: 10 }, { quantity: Number.NaN }],
      rejected: [],
    };
    expect(summarizeQuickOrderPreview(preview).units).toBe(10);
  });
});
