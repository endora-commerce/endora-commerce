import type { RecordMergeRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';

/**
 * `organization.merge.resume` (`specs/192-organization-merge/` FR-008):
 * `needs_attention` → `running`, the failed step back to pending; the runner
 * skips every finished step. `409 RECORD_MERGE_NOT_RESUMABLE` for any other
 * state.
 */
export function makeMergeResumeCommand(
  deps: { readonly recordMerge: () => RecordMergeService },
  input: { readonly mergeId: string; readonly survivorId: string; readonly loserId: string; readonly expectedVersion: number },
): Command<RecordMergeRecord> {
  return {
    action: 'organization.merge.resume',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const record = await deps.recordMerge().resume(em, input.mergeId, input.expectedVersion);
      return {
        result: record,
        before: { mergeId: input.mergeId, state: 'needs_attention' },
        after: { mergeId: input.mergeId, loserId: input.loserId, state: record.state, version: record.version },
      };
    },
  };
}
