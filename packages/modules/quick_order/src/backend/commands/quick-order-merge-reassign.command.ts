import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { QuickOrderDefaultPreference } from '../entities/quick-order-default-preference.entity.js';

/**
 * `quick_order.merge_reassign` (`specs/192-organization-merge/` T054,
 * `contracts/merge-participant.md` §2) — this module's part of an
 * Organization merge. The Organization-scoped default preference is *survivor
 * wins with fill gaps* (FR-034, research R-3): when the survivor has no row,
 * the loser's is adopted by re-pointing its `scopeId`; when the survivor has
 * one, it wins and the loser's stays on the archived loser, untouched.
 *
 * One row per Organization (`(scope, scope_id)` is unique), so a batch moves at
 * most one. Irreversible, no event; the audit records ids only.
 */
export interface QuickOrderMergeReassignResult {
  readonly moved: number;
}

export const QUICK_ORDER_MERGE_REASSIGN_ACTION = 'quick_order.merge_reassign';

/** The loser's Organization-scoped row, when the survivor has none to win with. */
export async function quickOrderPreferenceToAdopt(
  em: Pick<EntityManager, 'findOne'>,
  survivorId: string,
  loserId: string,
): Promise<QuickOrderDefaultPreference | null> {
  const loser = await em.findOne(QuickOrderDefaultPreference, { scope: 'organization', scopeId: loserId });
  if (loser === null) return null;
  const survivor = await em.findOne(QuickOrderDefaultPreference, { scope: 'organization', scopeId: survivorId });
  return survivor === null ? loser : null;
}

export function makeQuickOrderMergeReassignCommand(input: MergeStepInput): Command<QuickOrderMergeReassignResult> {
  return {
    action: QUICK_ORDER_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const adopted = await quickOrderPreferenceToAdopt(em, input.survivorId, input.loserId);
      if (adopted === null) return { result: { moved: 0 }, skipAudit: true };
      adopted.scopeId = input.survivorId;
      await em.flush();
      return {
        result: { moved: 1 },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: 1, ids: [adopted.id] },
      };
    },
  };
}
