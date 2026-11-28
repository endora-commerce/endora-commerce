import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge steps (`specs/192-organization-merge/` R-12). */
export const CREDIT_LIMIT_MERGE_REASSIGN_ACTION = 'credit_limit.merge_reassign';

/** Which of this module's two Organization participations a batch belongs to. */
export type CreditLimitMergePart = 'limit' | 'exposure';

export interface CreditLimitMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

/** The id of an Organization's own limit row (at most one, `credit_limits_one_per_organization`). */
export async function limitIdOf(em: EntityManager, organizationId: string): Promise<string | null> {
  const [row] = await em.execute<Array<{ id: string }>>(`select "id" from "credit_limits" where "organization_id" = ?`, [organizationId]);
  return row?.id ?? null;
}

/** `limit`: S+f — the loser's limit moves only when the survivor has none. */
async function moveLimit(em: EntityManager, input: MergeStepInput): Promise<string[]> {
  const rows = await em.execute<Array<{ id: string }>>(
    `update "credit_limits" set "organization_id" = ?, "updated_at" = now()
      where "organization_id" = ? and not exists (select 1 from "credit_limits" where "organization_id" = ?)
      returning "id"`,
    [input.survivorId, input.loserId, input.survivorId],
  );
  return rows.map((row) => row.id);
}

/**
 * `exposure`: R — reservations the loser drew, and every reservation held on
 * the loser's limit when the survivor has a limit of its own, move onto the
 * survivor (and its limit); then the loser's return top-ups.
 */
async function moveExposure(em: EntityManager, input: MergeStepInput, limit: number): Promise<string[]> {
  const survivorLimit = await limitIdOf(em, input.survivorId);
  const loserLimit = survivorLimit === null ? null : await limitIdOf(em, input.loserId);
  const reservations = await em.execute<Array<{ id: string }>>(
    `update "credit_limit_reservations" as "r"
        set "reserving_organization_id" = case when "r"."reserving_organization_id" = ? then ?::uuid else "r"."reserving_organization_id" end,
            "credit_limit_id" = case when "r"."credit_limit_id" = ?::uuid then ?::uuid else "r"."credit_limit_id" end,
            "updated_at" = now()
      where "r"."id" = any(array(
        select "id" from "credit_limit_reservations"
         where "reserving_organization_id" = ? or "credit_limit_id" = ?::uuid
         order by "id" limit ? for update))
      returning "r"."id"`,
    [input.loserId, input.survivorId, loserLimit, survivorLimit, input.loserId, loserLimit, limit],
  );
  const ids = reservations.map((row) => row.id);
  if (ids.length < limit) {
    const topups = await em.execute<Array<{ id: string }>>(
      `update "credit_limit_return_topups" set "organization_id" = ?
        where "id" = any(array(select "id" from "credit_limit_return_topups" where "organization_id" = ? order by "id" limit ? for update))
        returning "id"`,
      [input.survivorId, input.loserId, limit - ids.length],
    );
    ids.push(...topups.map((row) => row.id));
  }
  return ids;
}

/**
 * `credit_limit.merge_reassign` — one batch of either `credit_limits`
 * participant (`specs/192-organization-merge/` T046, OQ-8). The survivor's
 * limit is never raised: the exposure moves, even past the limit, and the
 * preview warns. A sum of the two limits would grant new credit silently.
 *
 * Moving a row consumes the loser's state (R-3); a loser limit the survivor
 * out-ranks stays on the archived loser and is not counted again. Irreversible,
 * no event; the audit names the merge and the ids only, never an amount.
 */
export function makeCreditLimitMergeReassignCommand(
  part: CreditLimitMergePart,
  input: MergeStepInput,
): Command<CreditLimitMergeReassignResult> {
  return {
    action: CREDIT_LIMIT_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const ids = part === 'limit' ? await moveLimit(em, input) : await moveExposure(em, input, Math.max(1, input.batchSize));
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, part, moved: ids.length, ids },
      };
    },
  };
}
