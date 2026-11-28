import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { CustomerNotification } from '../entities/customer-notification.entity.js';
import { CustomerNotificationOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T052 — `customer_notifications` in an Organization merge: the
 * loser's in-app notifications are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `customer_notification.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-customer_notifications-4711';

describe('customer_notifications — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'notifications',
        phase: 'records',
        references: [{ entity: 'CustomerNotification', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new CustomerNotificationOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(CustomerNotification, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, title: SENTINEL });
        }
        w.insert(CustomerNotification, { id: 's-0', organizationId: survivorId, title: SENTINEL });
        w.insert(CustomerNotification, { id: 'x-0', organizationId: 'another-organization', title: SENTINEL });
      },
      snapshot: async () => w.rows(CustomerNotification).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'customer_notification.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(CustomerNotification).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
