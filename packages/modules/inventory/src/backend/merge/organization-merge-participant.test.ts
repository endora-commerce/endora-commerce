import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { AvailabilityNotificationOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T051 — `inventory` in an Organization merge: the
 * loser's back-in-stock notification requests are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `availability_notification.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-inventory-4711';

describe('inventory — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'availability-notifications',
        phase: 'records',
        references: [{ entity: 'AvailabilityNotification', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new AvailabilityNotificationOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(AvailabilityNotification, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, email: SENTINEL });
        }
        w.insert(AvailabilityNotification, { id: 's-0', organizationId: survivorId, email: SENTINEL });
        w.insert(AvailabilityNotification, { id: 'x-0', organizationId: 'another-organization', email: SENTINEL });
      },
      snapshot: async () => w.rows(AvailabilityNotification).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'availability_notification.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(AvailabilityNotification).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
