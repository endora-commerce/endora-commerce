import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The reference type a Project mention is stored under (`RECORD_REFERENCE_TYPES`). */
const PROJECT_TARGET_TYPE = 'project';

/**
 * `crm.opportunity_reference.merge_reassign` (`specs/192-organization-merge/`
 * US6, T085, FR-093; `contracts/participant-dispositions.md` §B) — one batch
 * of the `crm` participant of a Project merge, as one Command: at most
 * `batchSize` references naming the loser in an Opportunity's description or
 * comments now name the survivor. These are derived rows — the index of who
 * mentions what — and the texts are never rewritten: the token resolves to
 * the survivor when rendered. The update is the loser-side consume (R-3).
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `project`, `objectId` =
 * the survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 */
export async function crmProjectReferenceMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const rows = await em.execute<Array<{ count: number }>>(
    `select count(*)::int as "count" from "crm_opportunity_references" where "target_type" = ? and "target_id" = ?`,
    [PROJECT_TARGET_TYPE, loserId],
  );
  return { 'CrmOpportunityReference.targetId': Number(rows[0]?.count ?? 0) };
}

export interface CrmOpportunityReferenceMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeCrmOpportunityReferenceMergeReassignCommand(
  input: MergeStepInput,
): Command<CrmOpportunityReferenceMergeReassignResult> {
  return {
    action: 'crm.opportunity_reference.merge_reassign',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ id: string }>>(
        `update "crm_opportunity_references" set "target_id" = ? where "id" in (
           select "id" from "crm_opportunity_references" where "target_type" = ? and "target_id" = ?
            order by "id" limit ? for update) returning "id"`,
        [input.survivorId, PROJECT_TARGET_TYPE, input.loserId, Math.max(1, input.batchSize)],
      );
      const ids = rows.map((row) => row.id);
      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return { result, before: null, after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids } };
    },
  };
}
