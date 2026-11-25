import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  expectOrganizationParticipantConforms,
  insertOrganizationPair,
} from '../../helpers/organization-merge-conformance.js';
import { seedAnalyticsOpportunity } from '../../helpers/seed-crm-analytics.js';
import { CrmOpportunityMergeParticipant } from '../../../../packages/modules/crm/src/backend/merge/organization-merge-participant.js';

/**
 * `specs/192-organization-merge/` T062 — the `crm` participant of an
 * Organization merge over a real database: the loser's Opportunities are
 * re-pointed through `crm.opportunity.merge_reassign`, held to
 * `expectMergeParticipant`.
 */
describe('Organization merge — the crm participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const opportunity = (organizationId: string) =>
    seedAnalyticsOpportunity(h.em().fork(), {
      organizationId,
      statuses: [['new', new Date().toISOString()]],
    });

  it('re-points the loser’s Opportunities (conformance)', async () => {
    const ids = await insertOrganizationPair(h);
    const outcome = await expectOrganizationParticipantConforms({
      h,
      moduleId: 'crm',
      key: 'organization-opportunities',
      ids,
      build: (commandBus: Pick<CommandBus, 'run'>) => new CrmOpportunityMergeParticipant({ emFactory: () => h.em(), commandBus }),
      seed: async ({ survivorId, loserId }) => {
        await opportunity(loserId);
        await opportunity(loserId);
        await opportunity(loserId);
        await opportunity(survivorId);
      },
      snapshot: ({ survivorId, loserId }) =>
        h
          .em()
          .fork()
          .getConnection()
          .execute(`select "id","organization_id" from "crm_opportunities" where "organization_id" in (?, ?) order by "id"`, [
            survivorId,
            loserId,
          ]),
    });
    expect(outcome.moved).toBe(3);
  });
});
