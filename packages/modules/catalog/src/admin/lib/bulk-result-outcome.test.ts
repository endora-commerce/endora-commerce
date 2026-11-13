import { describe, expect, it } from 'vitest';

import { isUnchangedResult, unchangedResultCount } from './bulk-result-outcome.js';

/**
 * Issue #501, item 2 (ruling B: no contract change) — a product already in the requested
 * state succeeds with nothing changed. The bulk edit dialog and the bulk operation detail
 * page read that through this one rule, so the two screens cannot disagree about it.
 */
describe('a bulk result that changed nothing', () => {
  it('is a succeeded row with no changed fields', () => {
    expect(isUnchangedResult({ status: 'succeeded', changedFields: [] })).toBe(true);
    expect(isUnchangedResult({ status: 'succeeded' })).toBe(true);
    expect(isUnchangedResult({ status: 'succeeded', changedFields: ['archivedAt'] })).toBe(false);
  });

  it('is never a skipped or failed row, whatever its fields', () => {
    expect(isUnchangedResult({ status: 'skipped', changedFields: [] })).toBe(false);
    expect(isUnchangedResult({ status: 'failed' })).toBe(false);
  });

  it('counts only those rows', () => {
    expect(
      unchangedResultCount([
        { status: 'succeeded', changedFields: [] },
        { status: 'succeeded', changedFields: ['archivedAt'] },
        { status: 'skipped', changedFields: [] },
        { status: 'succeeded' },
      ]),
    ).toBe(2);
  });
});
