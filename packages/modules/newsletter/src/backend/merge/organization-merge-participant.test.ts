import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSubscriberOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T052 — `newsletter` in an Organization merge: the
 * loser's newsletter subscribers attributed to it are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `newsletter_subscriber.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-newsletter-4711';

describe('newsletter — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'subscribers',
        phase: 'records',
        references: [{ entity: 'NewsletterSubscriber', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new NewsletterSubscriberOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(NewsletterSubscriber, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, email: SENTINEL });
        }
        w.insert(NewsletterSubscriber, { id: 's-0', organizationId: survivorId, email: SENTINEL });
        w.insert(NewsletterSubscriber, { id: 'x-0', organizationId: 'another-organization', email: SENTINEL });
      },
      snapshot: async () => w.rows(NewsletterSubscriber).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'newsletter_subscriber.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(NewsletterSubscriber).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
