import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/** The batch Command of this module's Organization merge step (`specs/192-organization-merge/` R-12). */
export const CART_MERGE_REASSIGN_ACTION = 'cart.merge_reassign';

export interface CartMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

/**
 * `cart.merge_reassign` — one batch of the `carts` participant
 * (`specs/192-organization-merge/` T043): at most `batchSize` carts that are
 * the loser's, or are *Buying for* the loser, are re-pointed to the survivor.
 * A *Buying for* that would then name the cart's own Organization is cleared
 * with its terms (182 FR-110: *Buying for* is another Organization's terms), and
 * the cart's version moves, so a buyer's stale write cannot land on it.
 *
 * Prices are not touched here: the participant drops each moved cart's
 * recompute cache after the commit, so the cart is repriced in the survivor's
 * context on its next read (spec § Edge cases, *Carts*).
 *
 * Moving the row consumes the loser's state (R-3). Irreversible, no event; the
 * audit names the merge and the ids only.
 */
export function makeCartMergeReassignCommand(input: MergeStepInput): Command<CartMergeReassignResult> {
  return {
    action: CART_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ id: string }>>(
        `with "picked" as (
           select "id" from "carts" where "organization_id" = ? or "buying_for_organization_id" = ?
            order by "id" limit ? for update),
         "mapped" as (
           select "c"."id",
                  case when "c"."organization_id" = ? then ?::uuid else "c"."organization_id" end as "org",
                  case when "c"."buying_for_organization_id" = ? then ?::uuid else "c"."buying_for_organization_id" end as "bf"
             from "carts" as "c" join "picked" as "p" on "p"."id" = "c"."id")
         update "carts" as "c"
            set "organization_id" = "m"."org",
                "buying_for_organization_id" = case when "m"."bf" = "m"."org" then null else "m"."bf" end,
                "buying_for_terms" = case when "m"."bf" is null or "m"."bf" = "m"."org" then null else "c"."buying_for_terms" end,
                "version" = "c"."version" + 1,
                "updated_at" = now()
           from "mapped" as "m"
          where "m"."id" = "c"."id"
          returning "c"."id"`,
        [
          input.loserId,
          input.loserId,
          Math.max(1, input.batchSize),
          input.loserId,
          input.survivorId,
          input.loserId,
          input.survivorId,
        ],
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
