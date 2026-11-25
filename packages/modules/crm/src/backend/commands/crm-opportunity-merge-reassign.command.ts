import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `crm.opportunity.merge_reassign` (`specs/192-organization-merge/` T062,
 * `contracts/participant-dispositions.md` §A) — one batch of the `crm`
 * participant of an Organization merge, as one Command: at most `batchSize`
 * Opportunities of the loser re-pointed at the survivor. The update is the
 * loser-side consume (R-3), so a re-run finds only what is left.
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `organization`,
 * `objectId` = the survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 */
export async function crmOpportunityMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const rows = await em.execute<Array<{ count: number }>>(
    `select count(*)::int as "count" from "crm_opportunities" where "organization_id" = ?`,
    [loserId],
  );
  return { 'CrmOpportunity.organizationId': Number(rows[0]?.count ?? 0) };
}

export interface CrmOpportunityMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeCrmOpportunityMergeReassignCommand(input: MergeStepInput): Command<CrmOpportunityMergeReassignResult> {
  return {
    action: 'crm.opportunity.merge_reassign',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ id: string }>>(
        `update "crm_opportunities" set "organization_id" = ?, "updated_at" = now() where "id" in (` +
          `select "id" from "crm_opportunities" where "organization_id" = ? order by "id" limit ? for update) returning "id"`,
        [input.survivorId, input.loserId, Math.max(1, input.batchSize)],
      );
      const ids = rows.map((row) => row.id);
      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return {
        result,
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
