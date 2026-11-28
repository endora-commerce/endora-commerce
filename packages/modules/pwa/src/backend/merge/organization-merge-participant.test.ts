import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { PushNotificationPreference } from '../entities/push-notification-preference.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';
import { PwaOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T053 — `pwa` in an Organization merge: the
 * loser's push subscriptions and push preferences are re-pointed to the
 * survivor, in `pwa.merge_reassign`. A preference is unique per customer
 * account (`push_notification_preferences_customer_account_id_unique`), never
 * per Organization, so re-pointing cannot meet a twin and there is nothing to
 * de-duplicate.
 */
const SENTINEL = 'SENTINEL-push-endpoint-4711';

describe('pwa — Organization merge participant', () => {
  it('declares both references as a re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'push',
        phase: 'records',
        references: [
          { entity: 'PushSubscription', property: 'organizationId', disposition: 're_point' },
          { entity: 'PushNotificationPreference', property: 'organizationId', disposition: 're_point' },
        ],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point, both tables)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new PwaOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    const result = await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 3; i += 1) {
          w.insert(PushSubscription, { id: `sub-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, endpoint: `${SENTINEL}-${i}` });
          w.insert(PushNotificationPreference, { id: `pref-${i}`, organizationId: loserId, customerAccountId: `c-${i}` });
        }
        w.insert(PushSubscription, { id: 'sub-s', organizationId: survivorId, customerAccountId: 'c-s', endpoint: SENTINEL });
        w.insert(PushNotificationPreference, { id: 'pref-s', organizationId: survivorId, customerAccountId: 'c-s' });
      },
      snapshot: async () => ({
        subscriptions: w.rows(PushSubscription).map((row) => `${row.id}:${row.organizationId}`).sort(),
        preferences: w.rows(PushNotificationPreference).map((row) => `${row.id}:${row.organizationId}:${row.customerAccountId}`).sort(),
      }),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    expect(result.moved).toBe(6);
    expect(w.audit.entries().every((entry) => entry.action === 'pwa.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    // Still one preference per account.
    const accounts = w.rows(PushNotificationPreference).map((row) => row.customerAccountId);
    expect(new Set(accounts).size).toBe(accounts.length);
  });
});
