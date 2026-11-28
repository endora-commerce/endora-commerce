import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { Webhook } from '../entities/webhook.entity.js';
import { WebhookOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T055 — `webhooks` in an Organization merge: the
 * loser's Organization-bound webhooks are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `webhook.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-webhooks-4711';

describe('webhooks — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'bound-webhooks',
        phase: 'records',
        references: [{ entity: 'Webhook', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new WebhookOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(Webhook, { id: `l-${i}`, organizationId: loserId, name: `w-${i}`, url: SENTINEL });
        }
        w.insert(Webhook, { id: 's-0', organizationId: survivorId, url: SENTINEL });
        w.insert(Webhook, { id: 'x-0', organizationId: 'another-organization', url: SENTINEL });
      },
      snapshot: async () => w.rows(Webhook).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'webhook.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(Webhook).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
