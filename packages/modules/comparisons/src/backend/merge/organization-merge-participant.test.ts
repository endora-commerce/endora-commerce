import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { Comparison } from '../entities/comparison.entity.js';
import { ComparisonOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T051 — `comparisons` in an Organization merge: the
 * loser's comparisons are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `comparison.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-comparisons-4711';

describe('comparisons — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'comparisons',
        phase: 'records',
        references: [{ entity: 'Comparison', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new ComparisonOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(Comparison, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, shareToken: SENTINEL });
        }
        w.insert(Comparison, { id: 's-0', organizationId: survivorId, shareToken: SENTINEL });
        w.insert(Comparison, { id: 'x-0', organizationId: 'another-organization', shareToken: SENTINEL });
      },
      snapshot: async () => w.rows(Comparison).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'comparison.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(Comparison).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
