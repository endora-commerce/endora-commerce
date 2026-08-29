import { describe, expect, it } from 'vitest';
import type { ComparisonAttributeRow } from '@endora-commerce/contracts';
import { filterRowsByMode } from '../components/ComparisonTable';

/**
 * Feature 044 / US6 — the "show only differences" toggle on the mobile compare
 * view. The table fetches on mount (device-verified end-to-end), so the row
 * filter that backs the toggle is unit-tested here directly.
 */

const rows = [
  { key: 'common-attr', label: { 'en-US': 'Common' }, valueType: 'text', values: ['1', '1'], rowClass: 'common' },
  { key: 'diff-attr', label: { 'en-US': 'Diff' }, valueType: 'text', values: ['1', '2'], rowClass: 'different' },
] as unknown as ComparisonAttributeRow[];

describe('filterRowsByMode', () => {
  it("'all' keeps every row", () => {
    expect(filterRowsByMode(rows, 'all')).toHaveLength(2);
  });

  it("'differences' hides rows whose values match across products", () => {
    const result = filterRowsByMode(rows, 'differences');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('diff-attr');
  });

  it("'common' keeps only the matching rows", () => {
    const result = filterRowsByMode(rows, 'common');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('common-attr');
  });
});
