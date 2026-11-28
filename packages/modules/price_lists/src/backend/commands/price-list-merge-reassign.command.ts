import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const PRICE_LIST_MERGE_REASSIGN_ACTION = 'price_list.merge_reassign';

export interface PriceListMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
  /** The price books whose audience changed — the participant's surface change after the commit. */
  readonly bookIds: readonly string[];
  /** Whether the loser's display-mode override filled the survivor's gap. */
  readonly displayModeMoved: boolean;
}

/**
 * `price_list.merge_reassign` — one batch of the `price_lists` participant
 * (`specs/192-organization-merge/` T048), in the `configuration` phase:
 *
 *  1. **audiences, union** — at most `batchSize` of the loser's audience
 *     memberships: the survivor's twin is inserted (nothing when it is already
 *     a member) and the loser's row deleted, in one statement;
 *  2. **display mode, survivor wins with fill gaps** — the loser's
 *     Organization override moves to the survivor only when the survivor has
 *     none; otherwise it stays on the archived loser.
 *
 * Deleting or moving the loser's row consumes its state (R-3), so a re-run
 * finds nothing. Organization-specific matrix prices do not exist on the
 * price-book model (a matrix entry names no Organization). Irreversible, no
 * event; the audit names the merge and the ids only.
 */
export function makePriceListMergeReassignCommand(input: MergeStepInput): Command<PriceListMergeReassignResult> {
  return {
    action: PRICE_LIST_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const members = await em.execute<Array<{ id: string; price_list_id: string }>>(
        `with "picked" as (
           select "id", "price_list_id" from "price_list_audience_members"
            where "organization_id" = ? order by "id" limit ? for update),
         "added" as (
           insert into "price_list_audience_members" ("id", "price_list_id", "organization_id", "customer_group_id")
           select gen_random_uuid(), "price_list_id", ?, null from "picked"
           on conflict do nothing
           returning 1)
         delete from "price_list_audience_members" where "id" in (select "id" from "picked")
         returning "id", "price_list_id"`,
        [input.loserId, Math.max(1, input.batchSize), input.survivorId],
      );
      const ids = members.map((row) => row.id);
      let displayModeMoved = false;
      if (ids.length < Math.max(1, input.batchSize)) {
        const moved = await em.execute<Array<{ target_id: string }>>(
          `update "price_display_mode_overrides" set "target_id" = ?, "updated_at" = now()
            where "scope" = 'organization' and "target_id" = ?
              and not exists (select 1 from "price_display_mode_overrides" where "scope" = 'organization' and "target_id" = ?)
            returning "target_id"`,
          [input.survivorId, input.loserId, input.survivorId],
        );
        displayModeMoved = moved.length > 0;
        if (displayModeMoved) ids.push(input.survivorId);
      }
      const bookIds = [...new Set(members.map((row) => row.price_list_id))];
      if (ids.length === 0) return { result: { moved: 0, ids, bookIds, displayModeMoved }, skipAudit: true };
      return {
        result: { moved: ids.length, ids, bookIds, displayModeMoved },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
