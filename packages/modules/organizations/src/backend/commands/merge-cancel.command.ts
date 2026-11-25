import type { RecordMergeRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';

/**
 * `organization.merge.cancel` (`specs/192-organization-merge/` FR-011): allowed
 * only while no step has started, which the platform decides under a lock on
 * the merge row (`409 RECORD_MERGE_NOT_CANCELLABLE` otherwise). It releases the
 * locks; the freeze is lifted after the commit. Irreversible like every merge
 * Command — a cancelled merge is started again, never un-cancelled.
 */
export function makeMergeCancelCommand(
  deps: { readonly recordMerge: () => RecordMergeService },
  input: { readonly mergeId: string; readonly survivorId: string; readonly loserId: string; readonly expectedVersion: number },
): Command<RecordMergeRecord> {
  return {
    action: 'organization.merge.cancel',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const record = await deps.recordMerge().cancel(em, input.mergeId, input.expectedVersion);
      return {
        result: record,
        before: { mergeId: input.mergeId, state: 'running' },
        after: { mergeId: input.mergeId, loserId: input.loserId, state: record.state, version: record.version },
      };
    },
  };
}
