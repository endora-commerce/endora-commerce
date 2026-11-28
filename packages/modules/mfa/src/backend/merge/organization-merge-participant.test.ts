import { describe, expect, it } from 'vitest';
import { createMemoryMergeWorld, expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { manifest } from '../../manifest.js';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';
import { MfaOrganizationMergeParticipant } from './organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T054 — `mfa` in an Organization merge: the
 * customer MFA policy takes the stricter of the two (FR-034, research R-3). A
 * survivor without a policy adopts the loser's; a survivor whose policy is
 * weaker is raised to enforcement; the loser's row otherwise stays on the
 * archived loser.
 */
const step = { mergeId: 'm', hostType: 'organization' as const, survivorId: 'S', loserId: 'L', hostContext: {}, batchSize: 10 };

function world() {
  const w = createMemoryMergeWorld();
  return { w, participant: new MfaOrganizationMergeParticipant({ emFactory: w.emFactory, commandBus: w.commandBus }) };
}

describe('mfa — Organization merge participant', () => {
  it('declares the policy as stricter in the configuration phase', () => {
    expect(manifest.merge?.participates).toEqual([
      {
        host: 'organization',
        key: 'organization-policy',
        phase: 'configuration',
        references: [{ entity: 'MfaOrganizationPolicy', property: 'organizationId', disposition: 'stricter' }],
      },
    ]);
  });

  it('conforms: a survivor without a policy adopts the loser\'s', async () => {
    const { w, participant } = world();
    await expectMergeParticipant({
      participant,
      seed: async ({ loserId }) => {
        w.insert(MfaOrganizationPolicy, { id: 'p-l', organizationId: loserId, enforceTotp: true });
      },
      snapshot: async () => w.rows(MfaOrganizationPolicy).map((row) => `${row.id}:${row.organizationId}:${row.enforceTotp}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries },
      injectFailure: w.injectFailure,
    });
    expect(w.rows(MfaOrganizationPolicy).map((row) => row.organizationId)).not.toContain(undefined);
  });

  it('conforms: a weaker survivor policy is raised, and the loser\'s stays', async () => {
    const { w, participant } = world();
    const result = await expectMergeParticipant({
      participant,
      seed: async ({ survivorId, loserId }) => {
        w.insert(MfaOrganizationPolicy, { id: 'p-s', organizationId: survivorId, enforceTotp: false });
        w.insert(MfaOrganizationPolicy, { id: 'p-l', organizationId: loserId, enforceTotp: true });
      },
      snapshot: async () => w.rows(MfaOrganizationPolicy).map((row) => `${row.id}:${row.organizationId}:${row.enforceTotp}`).sort(),
      events: w.events,
      audit: { entries: w.audit.entries },
      injectFailure: w.injectFailure,
    });
    expect(result.moved).toBe(1);
    const byId = Object.fromEntries(w.rows(MfaOrganizationPolicy).map((row) => [row.id, row]));
    expect(byId['p-s']?.enforceTotp).toBe(true);
    expect(byId['p-l']?.enforceTotp).toBe(true);
    expect(w.audit.entries()[0]?.stateAfter).toMatchObject({ moved: 1, ids: ['p-s'], enforceTotp: true });
  });

  it('writes nothing when the survivor is already at least as strict', async () => {
    const { w, participant } = world();
    w.insert(MfaOrganizationPolicy, { id: 'p-s', organizationId: 'S', enforceTotp: true });
    w.insert(MfaOrganizationPolicy, { id: 'p-l', organizationId: 'L', enforceTotp: false });
    expect((await participant.preview(step)).counts).toEqual({ 'MfaOrganizationPolicy.organizationId': 0 });
    expect(await participant.applyBatch(step)).toEqual({ moved: 0 });
    expect(w.audit.entries()).toEqual([]);
    expect(w.rows(MfaOrganizationPolicy).find((row) => row.id === 'p-s')?.enforceTotp).toBe(true);
  });
});
