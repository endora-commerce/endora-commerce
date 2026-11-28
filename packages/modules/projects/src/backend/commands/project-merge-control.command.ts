import type { EntityManager } from '@mikro-orm/postgresql';
import type { RecordMergeRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';

/**
 * `projects.project.merge.cancel` and `projects.project.merge.resume`
 * (`specs/192-organization-merge/` FR-008, FR-011; `contracts/project-merge.md`
 * §2) — as for Organizations. Cancel is allowed only while no step has started,
 * which the platform decides under a lock on the merge row
 * (`409 RECORD_MERGE_NOT_CANCELLABLE`); it releases the locks, and the freeze is
 * lifted after the commit. Resume takes a merge that needs attention back to
 * running (`409 RECORD_MERGE_NOT_RESUMABLE` otherwise); the runner skips every
 * finished step. Both are irreversible and audited against the survivor.
 */
export interface ProjectMergeControlInput {
  readonly mergeId: string;
  readonly survivorId: string;
  readonly loserId: string;
  readonly expectedVersion: number;
}

export function makeProjectMergeCancelCommand(
  deps: { readonly recordMerge: () => RecordMergeService },
  input: ProjectMergeControlInput,
): Command<RecordMergeRecord> {
  return {
    action: 'projects.project.merge.cancel',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const record = await deps.recordMerge().cancel(em as EntityManager, input.mergeId, input.expectedVersion);
      return {
        result: record,
        before: { mergeId: input.mergeId, state: 'running' },
        after: { mergeId: input.mergeId, loserId: input.loserId, state: record.state, version: record.version },
      };
    },
  };
}

export function makeProjectMergeResumeCommand(
  deps: { readonly recordMerge: () => RecordMergeService },
  input: ProjectMergeControlInput,
): Command<RecordMergeRecord> {
  return {
    action: 'projects.project.merge.resume',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      const record = await deps.recordMerge().resume(em as EntityManager, input.mergeId, input.expectedVersion);
      return {
        result: record,
        before: { mergeId: input.mergeId, state: 'needs_attention' },
        after: { mergeId: input.mergeId, loserId: input.loserId, state: record.state, version: record.version },
      };
    },
  };
}
