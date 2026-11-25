import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const RETURN_CASE_MERGE_REASSIGN_ACTION = 'return_case.merge_reassign';

/** This module's tables holding an Organization id, in the order a batch moves them. */
export const RETURNS_MERGE_TABLES = [
  { table: 'return_cases', reference: 'ReturnCase.organizationId' },
  { table: 'return_case_attachments', reference: 'ReturnCaseAttachment.organizationId' },
  { table: 'return_withdrawal_statements', reference: 'ReturnWithdrawalStatement.organizationId' },
] as const;

export interface ReturnCaseMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

async function repoint(em: EntityManager, table: string, input: MergeStepInput, limit: number): Promise<string[]> {
  const rows = await em.execute<Array<{ id: string }>>(
    `update "${table}" set "organization_id" = ?
      where "id" in (select "id" from "${table}" where "organization_id" = ? order by "id" limit ? for update)
      returning "id"`,
    [input.survivorId, input.loserId, limit],
  );
  return rows.map((row) => row.id);
}

/**
 * `return_case.merge_reassign` — one batch of the `returns` participant
 * (`specs/192-organization-merge/` T050): at most `batchSize` rows of the
 * loser's return cases, their attachments and its withdrawal statements are
 * re-pointed to the survivor, in that order. Stored files keep their keys: an
 * attachment's locator is where the file is, not whose it is.
 *
 * Moving the row consumes the loser's state (R-3). Irreversible, no event; the
 * audit names the merge and the ids only.
 */
export function makeReturnCaseMergeReassignCommand(input: MergeStepInput): Command<ReturnCaseMergeReassignResult> {
  return {
    action: RETURN_CASE_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const ids: string[] = [];
      for (const { table } of RETURNS_MERGE_TABLES) {
        const budget = Math.max(1, input.batchSize) - ids.length;
        if (budget <= 0) break;
        ids.push(...(await repoint(em, table, input, budget)));
      }
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
