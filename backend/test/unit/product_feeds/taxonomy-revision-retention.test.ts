import { describe, expect, it } from 'vitest';
import {
  selectPurgeableRevisions,
  type RetentionCandidate,
} from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-revision-retention.service.js';

/**
 * Feature 067 Phase 11 / T122 — the retention selector (FR-097,
 * data-model §8).
 *
 * Retention is bounded, but three classes of revision are never eligible
 * whatever the count is set to, and the third is the one worth guarding: a
 * mapping stores a provider node id and no revision reference (deliberately —
 * FR-085 makes a mapping survive revision installs), so a **stale** mapping's
 * human-readable label exists only in the older revision it was chosen from.
 * Purging that revision turns the review list into bare numeric ids at exactly
 * the moment the operator needs to read a path.
 */

function revision(overrides: Partial<RetentionCandidate> & { id: string }): RetentionCandidate {
  return {
    isCurrent: false,
    promotedAt: null,
    installedAt: new Date('2026-01-01T00:00:00Z'),
    isNewestHolderOfMappedNode: false,
    ...overrides,
  };
}

/** Newest first, as the selector receives them. */
function series(): RetentionCandidate[] {
  return [
    revision({ id: 'r5', installedAt: new Date('2026-05-01T00:00:00Z') }),
    revision({ id: 'r4', installedAt: new Date('2026-04-01T00:00:00Z'), promotedAt: new Date('2026-04-02T00:00:00Z') }),
    revision({ id: 'r3', installedAt: new Date('2026-03-01T00:00:00Z'), promotedAt: new Date('2026-03-02T00:00:00Z') }),
    revision({ id: 'r2', installedAt: new Date('2026-02-01T00:00:00Z'), promotedAt: new Date('2026-02-02T00:00:00Z') }),
    revision({ id: 'r1', installedAt: new Date('2026-01-01T00:00:00Z'), promotedAt: new Date('2026-01-02T00:00:00Z') }),
  ];
}

describe('selectPurgeableRevisions', () => {
  it('keeps the newest N and purges the rest', () => {
    expect(selectPurgeableRevisions(series(), 3).sort()).toEqual(['r1', 'r2']);
  });

  it('never purges the revision in force, however old it is', () => {
    const rows = series().map((row) => (row.id === 'r1' ? { ...row, isCurrent: true } : row));
    expect(selectPurgeableRevisions(rows, 3)).toEqual(['r2']);
  });

  it('never purges the newest revision nobody has decided about (FR-097)', () => {
    // `promoted_at is null` is the pending-candidate predicate. A fetched
    // revision sitting inactive is exactly what an operator has not decided
    // about yet, and deleting it under them would be the worst possible moment.
    const rows = [
      revision({ id: 'pending', installedAt: new Date('2025-06-01T00:00:00Z') }),
      ...series().slice(0, 4).map((row) => ({ ...row, promotedAt: new Date('2026-06-01T00:00:00Z') })),
    ];
    const purged = selectPurgeableRevisions(rows, 2);
    expect(purged).not.toContain('pending');
  });

  it('never purges the newest revision a surviving mapping’s node lives in', () => {
    const rows = series().map((row) =>
      row.id === 'r1' ? { ...row, isNewestHolderOfMappedNode: true } : row,
    );
    expect(selectPurgeableRevisions(rows, 3)).toEqual(['r2']);
  });

  it('purges nothing when everything is protected', () => {
    const rows = [
      revision({ id: 'current', isCurrent: true, installedAt: new Date('2026-01-01T00:00:00Z') }),
      revision({ id: 'pending', installedAt: new Date('2026-02-01T00:00:00Z') }),
      revision({
        id: 'label-source',
        promotedAt: new Date('2025-01-02T00:00:00Z'),
        installedAt: new Date('2025-01-01T00:00:00Z'),
        isNewestHolderOfMappedNode: true,
      }),
    ];
    expect(selectPurgeableRevisions(rows, 1)).toEqual([]);
  });

  it('clamps a misconfigured retention count to a floor of one', () => {
    // A `0` in settings must not purge everything that is not otherwise
    // protected — the artefact retention sweep takes the same precaution.
    const rows = [
      revision({ id: 'newest', promotedAt: new Date('2026-05-02T00:00:00Z'), installedAt: new Date('2026-05-01T00:00:00Z') }),
      revision({ id: 'older', promotedAt: new Date('2026-04-02T00:00:00Z'), installedAt: new Date('2026-04-01T00:00:00Z') }),
    ];
    expect(selectPurgeableRevisions(rows, 0)).toEqual(['older']);
  });

  it('is order-independent — the caller may hand rows over in any order', () => {
    const shuffled = [...series()].reverse();
    expect(selectPurgeableRevisions(shuffled, 3).sort()).toEqual(['r1', 'r2']);
  });
});
