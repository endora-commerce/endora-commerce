import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { AnalyticsEvent } from '../entities/analytics-event.entity.js';
import { AnalyticsEventOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T056 — `analytics` in an Organization merge: the
 * loser's analytics events are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `analytics.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-analytics-4711';

describe('analytics — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'events',
        phase: 'records',
        trailing: true,
        batchSize: 500,
        references: [{ entity: 'AnalyticsEvent', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new AnalyticsEventOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(AnalyticsEvent, { id: `l-${i}`, organizationId: loserId, type: 'page_view', sessionId: SENTINEL });
        }
        w.insert(AnalyticsEvent, { id: 's-0', organizationId: survivorId, sessionId: SENTINEL });
        w.insert(AnalyticsEvent, { id: 'x-0', organizationId: 'another-organization', sessionId: SENTINEL });
      },
      snapshot: async () => w.rows(AnalyticsEvent).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'analytics.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(AnalyticsEvent).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
