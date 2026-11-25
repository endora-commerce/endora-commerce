import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { QuickOrderDefaultPreference } from '../entities/quick-order-default-preference.entity.js';
import { QuickOrderOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T054 — `quick_order` in an Organization
 * merge: the Organization-scoped default preference is *survivor wins with fill
 * gaps* (FR-034, research R-3). The loser's row is adopted only when the
 * survivor has none; otherwise it stays on the archived loser and is not
 * counted as remaining.
 */
const SENTINEL = 'SENTINEL-payment-method-4711';
const step = { mergeId: 'm', hostType: 'organization' as const, survivorId: 'S', loserId: 'L', hostContext: {}, batchSize: 10 };

function world() {
  const w = createMemoryMergeWorld();
  return { w, participant: new QuickOrderOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus }) };
}

describe('quick_order — Organization merge participant', () => {
  it('declares the polymorphic preference as survivor-wins-fill-gaps in the configuration phase', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'default-preferences',
        phase: 'configuration',
        references: [
          {
            entity: 'QuickOrderDefaultPreference',
            property: 'scopeId',
            polymorphic: { discriminator: 'scope', value: 'organization' },
            disposition: 'survivor_wins_fill_gaps',
          },
        ],
      },
    ]);
  });

  it('conforms to the merge-participant contract: the survivor has no row, so the loser\'s is adopted', async () => {
    const { w, participant } = world();
    await expectMergeParticipant({
      participant,
      seed: async ({ loserId }) => {
        w.insert(QuickOrderDefaultPreference, { id: 'p-l', scope: 'organization', scopeId: loserId, defaultPaymentMethodId: SENTINEL });
        // A customer-scoped row with the same id value is not an Organization reference.
        w.insert(QuickOrderDefaultPreference, { id: 'p-c', scope: 'customer', scopeId: loserId });
      },
      snapshot: async () => w.rows(QuickOrderDefaultPreference).map((row) => `${row.id}:${row.scope}:${row.scopeId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    expect(w.rows(QuickOrderDefaultPreference).find((row) => row.id === 'p-c')?.scope).toBe('customer');
    expect(w.audit.entries().map((entry) => entry.action)).toEqual(['quick_order.merge_reassign']);
  });

  it('keeps the survivor\'s row and leaves the loser\'s on the archived loser', async () => {
    const { w, participant } = world();
    w.insert(QuickOrderDefaultPreference, { id: 'p-s', scope: 'organization', scopeId: 'S', defaultPaymentMethodId: 'pm-s' });
    w.insert(QuickOrderDefaultPreference, { id: 'p-l', scope: 'organization', scopeId: 'L', defaultPaymentMethodId: 'pm-l' });
    expect((await participant.preview(step)).counts).toEqual({ 'QuickOrderDefaultPreference.scopeId': 0 });
    expect(await participant.applyBatch(step)).toEqual({ moved: 0 });
    expect(w.rows(QuickOrderDefaultPreference).map((row) => `${row.id}:${row.scopeId}:${row.defaultPaymentMethodId}`).sort()).toEqual([
      'p-l:L:pm-l',
      'p-s:S:pm-s',
    ]);
    expect(w.audit.entries()).toEqual([]);
  });
});
