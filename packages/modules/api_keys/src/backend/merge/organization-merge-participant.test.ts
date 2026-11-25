import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { ApiKey } from '../entities/api-key.entity.js';
import { API_KEY_MERGE_REPOINTED_WARNING, ApiKeyOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T055 — `api_keys` in an Organization merge: the
 * loser's bound API keys are re-pointed to the survivor
 * (`participant-dispositions.md` §A), in `api_key.merge_reassign`.
 */
const SENTINEL = 'SENTINEL-api_keys-4711';

describe('api_keys — Organization merge participant', () => {
  it('declares its re-point', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'bound-keys',
        phase: 'records',
        references: [{ entity: 'ApiKey', property: 'organizationId', disposition: 're_point' }],
      },
    ]);
  });

  it('conforms to the merge-participant contract (re-point)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new ApiKeyOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        for (let i = 0; i < 5; i += 1) {
          w.insert(ApiKey, { id: `l-${i}`, organizationId: loserId, lastFour: '0000', name: SENTINEL });
        }
        w.insert(ApiKey, { id: 's-0', organizationId: survivorId, name: SENTINEL });
        w.insert(ApiKey, { id: 'x-0', organizationId: 'another-organization', name: SENTINEL });
      },
      snapshot: async () => w.rows(ApiKey).map((row) => `${row.id}:${row.organizationId}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries, sentinels: [SENTINEL] },
      injectFailure: w.injectFailure,
    });
    const entries = w.audit.entries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === 'api_key.merge_reassign' && entry.objectType === 'organization')).toBe(true);
    expect(w.rows(ApiKey).find((row) => row.id === 'x-0')?.organizationId).toBe('another-organization');
  });

  it('lists the bound keys it will re-point as a preview warning (OQ-9)', async () => {
    const w = createMemoryMergeWorld();
    const participant = new ApiKeyOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus });
    w.insert(ApiKey, { id: 'k-2', organizationId: 'L', name: 'two' });
    w.insert(ApiKey, { id: 'k-1', organizationId: 'L', name: 'one' });
    w.insert(ApiKey, { id: 'k-s', organizationId: 'S', name: 'survivor' });
    const preview = await participant.preview({ hostType: 'organization', survivorId: 'S', loserId: 'L', hostContext: {} });
    expect(preview.warnings).toEqual([{ code: API_KEY_MERGE_REPOINTED_WARNING, details: { count: 2, ids: ['k-1', 'k-2'] } }]);
    expect(preview.refusals).toEqual([]);
  });
});
