import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const ADDRESS_MERGE_REASSIGN_ACTION = 'address.merge_reassign';

export interface AddressMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

/**
 * `address.merge_reassign` — one batch of the `addresses` participant
 * (`specs/192-organization-merge/` T042, `participant-dispositions.md` §A):
 * at most `batchSize` of the loser's addresses are re-pointed to the survivor.
 * A moved address that is the loser's default of a kind the survivor already
 * has a default for stops being a default, so the survivor's defaults are kept
 * and `addresses_one_default_per_kind` holds.
 *
 * Moving the row is what consumes the loser's state (R-3), so a re-run finds
 * nothing. Irreversible, no event; the audit names the merge and the ids only.
 */
export function makeAddressMergeReassignCommand(input: MergeStepInput): Command<AddressMergeReassignResult> {
  return {
    action: ADDRESS_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ id: string }>>(
        `update "addresses" as "a"
            set "organization_id" = ?,
                "is_default" = "a"."is_default" and not exists (
                  select 1 from "addresses" as "s"
                   where "s"."organization_id" = ? and "s"."kind" = "a"."kind" and "s"."is_default" and "s"."deleted_at" is null),
                "updated_at" = now()
          where "a"."id" in (select "id" from "addresses" where "organization_id" = ? order by "id" limit ? for update)
          returning "a"."id"`,
        [input.survivorId, input.survivorId, input.loserId, Math.max(1, input.batchSize)],
      );
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) return { result: { moved: 0, ids }, skipAudit: true };
      return {
        result: { moved: ids.length, ids },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
