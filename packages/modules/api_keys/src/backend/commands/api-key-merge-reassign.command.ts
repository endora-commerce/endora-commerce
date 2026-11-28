import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { ApiKey } from '../entities/api-key.entity.js';

/**
 * `api_key.merge_reassign` (`specs/192-organization-merge/` T055,
 * `contracts/merge-participant.md` §2) — one batch of this module's part of an
 * Organization merge: at most `batchSize` bound API keys still naming the loser
 * are re-pointed to the survivor. Re-pointing consumes the loser side, so a
 * re-run finds only what is left (research R-3).
 *
 * Irreversible, no event; the audit names the survivor and records ids only.
 */
export interface ApiKeyMergeReassignResult {
  readonly moved: number;
}

export const API_KEY_MERGE_REASSIGN_ACTION = 'api_key.merge_reassign';

export function makeApiKeyMergeReassignCommand(input: MergeStepInput): Command<ApiKeyMergeReassignResult> {
  return {
    action: API_KEY_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.find(
        ApiKey,
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
