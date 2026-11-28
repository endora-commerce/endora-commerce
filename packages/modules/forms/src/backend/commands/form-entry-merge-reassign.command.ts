import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { FormEntry } from '../entities/form-entry.entity.js';

/**
 * `form_entry.merge_reassign` (`specs/192-organization-merge/` T052,
 * `contracts/merge-participant.md` §2) — one batch of this module's part of an
 * Organization merge: at most `batchSize` form entries attributed to it still naming the loser
 * are re-pointed to the survivor. Re-pointing consumes the loser side, so a
 * re-run finds only what is left (research R-3).
 *
 * Irreversible, no event; the audit names the survivor and records ids only.
 */
export interface FormEntryMergeReassignResult {
  readonly moved: number;
}

export const FORM_ENTRY_MERGE_REASSIGN_ACTION = 'form_entry.merge_reassign';

export function makeFormEntryMergeReassignCommand(input: MergeStepInput): Command<FormEntryMergeReassignResult> {
  return {
    action: FORM_ENTRY_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.find(
        FormEntry,
        { organizationId: input.loserId },
        { orderBy: { id: 'asc' }, limit: Math.max(1, input.batchSize) },
      );
      if (rows.length === 0) return { result: { moved: 0 }, skipAudit: true };
      for (const row of rows) row.organizationId = input.survivorId;
      await em.flush();

      const ids = rows.map((row) => row.id);
      return {
        result: { moved: ids.length },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
