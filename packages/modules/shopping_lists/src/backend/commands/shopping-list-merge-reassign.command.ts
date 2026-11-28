import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { ShoppingList } from '../entities/shopping-list.entity.js';

/**
 * `shopping_list.merge_reassign` (`specs/192-organization-merge/` T051,
 * `contracts/merge-participant.md` §2) — one batch of this module's part of an
 * Organization merge: at most `batchSize` lists still held by the loser are
 * re-pointed to the survivor. Re-pointing consumes the loser side, so a re-run
 * finds only what is left (research R-3).
 *
 * "One default list per (organization, customer)" is kept: a moved list stays
 * its customer's default only when that customer has no default on the
 * survivor already.
 *
 * Irreversible, no event; the audit names the survivor and records ids only.
 */
export interface ShoppingListMergeReassignResult {
  readonly moved: number;
}

export const SHOPPING_LIST_MERGE_REASSIGN_ACTION = 'shopping_list.merge_reassign';

export function makeShoppingListMergeReassignCommand(input: MergeStepInput): Command<ShoppingListMergeReassignResult> {
  return {
    action: SHOPPING_LIST_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const lists = await em.find(
        ShoppingList,
        { organizationId: input.loserId },
        { orderBy: { id: 'asc' }, limit: Math.max(1, input.batchSize) },
      );
      if (lists.length === 0) return { result: { moved: 0 }, skipAudit: true };

      const defaults = lists.filter((list) => list.isDefault);
      if (defaults.length > 0) {
        const survivorDefaults = await em.find(ShoppingList, {
          organizationId: input.survivorId,
          customerAccountId: { $in: defaults.map((list) => list.customerAccountId) },
          isDefault: true,
        });
        const covered = new Set(survivorDefaults.map((list) => list.customerAccountId));
        for (const list of defaults) if (covered.has(list.customerAccountId)) list.isDefault = false;
      }
      for (const list of lists) list.organizationId = input.survivorId;
      await em.flush();

      const ids = lists.map((list) => list.id);
      return {
        result: { moved: ids.length },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
