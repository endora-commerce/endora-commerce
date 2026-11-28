import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormEntryOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T052 — `forms` in an Organization merge: the
 * loser's form entries attributed to it are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `form_entry.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-forms-4711';

describe('forms — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'form-entries',
        phase: 'records',
        references: [{ entity: 'FormEntry', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new FormEntryOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(FormEntry, { id: `l-${i}`, organizationId: loserId, customerAccountId: `c-${i}`, submitterEmail: SENTINEL });
        }
        w.insert(FormEntry, { id: 's-0', organizationId: survivorId, submitterEmail: SENTINEL });
        w.insert(FormEntry, { id: 'x-0', organizationId: 'another-organization', submitterEmail: SENTINEL });
      },
      snapshot: async () => w.rows(FormEntry).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'form_entry.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(FormEntry).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });
});
