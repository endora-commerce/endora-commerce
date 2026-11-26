import type { EntityManager } from '@mikro-orm/postgresql';
import { projectMergeStageMap, type MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * The context type a Project's Tasks carry — the `project` context `projects`
 * registers (`PROJECT_TASK_CONTEXT_TYPE`). This module names no context owner
 * anywhere else; a merge of the `project` record type is the one place it must
 * say which of its rows hold a Project, as the manifest's polymorphic
 * declaration does (`specs/192-organization-merge/` FR-045).
 */
export const PROJECT_CONTEXT_TYPE = 'project';

/**
 * `task.merge_move_context` (`specs/192-organization-merge/` US6, FR-092,
 * FR-093; `contracts/participant-dispositions.md` §B) — one batch of the
 * `tasks` participant of a Project merge, as one Command of this module:
 *
 *  1. the Tasks in the loser's context move to the survivor's context, each
 *     into the survivor's Stage (its context group) the host context maps its
 *     Stage to — the survivor's Stage of the same name, else its current
 *     Stage, which `projects` worked out in the `structure` phase. A loser's
 *     Stage never becomes one of the survivor's, and a Task of a Project with
 *     Stages always has one, so the Project's screens show it (FR-092);
 *  2. the references naming the loser in a Task's description or comments now
 *     name the survivor. The texts are never rewritten: a `[[project:<loser>]]`
 *     token resolves to the survivor when rendered (FR-093).
 *
 * Both updates consume loser-side state (R-3), so a re-run finds only what is
 * left. At most `batchSize` rows per batch. Irreversible, no event, no Task
 * notification (R-13). Audit: `objectType` = `project`, `objectId` = the
 * survivor, `stateAfter = { mergeId, loserId, moved, ids }`.
 *
 * Published for server code as `taskCommandPort.moveContext` once that port
 * exists (#1829).
 */
export async function taskProjectMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const [row] = await em.execute<Array<{ tasks: number; references: number }>>(
    `select
       (select count(*)::int from "tasks" where "context_type" = ? and "context_id" = ?) as "tasks",
       (select count(*)::int from "task_references" where "target_type" = ? and "target_id" = ?) as "references"`,
    [PROJECT_CONTEXT_TYPE, loserId, PROJECT_CONTEXT_TYPE, loserId],
  );
  return {
    'Task.contextId': Number(row?.tasks ?? 0),
    'TaskReference.targetId': Number(row?.references ?? 0),
  };
}

export interface TaskMergeMoveContextResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeTaskMergeMoveContextCommand(input: MergeStepInput): Command<TaskMergeMoveContextResult> {
  return {
    action: 'task.merge_move_context',
    objectType: 'project',
    objectId: input.survivorId,
    run: async ({ em }) => {
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      const { stageMap, fallbackStageId } = projectMergeStageMap(input.hostContext);
      const tasks = await em.execute<Array<{ id: string }>>(
        `update "tasks" set "context_id" = ?,
                "context_group_id" = coalesce((?::jsonb ->> "context_group_id"::text)::uuid, ?::uuid),
                "updated_at" = now()
          where "id" in (
           select "id" from "tasks" where "context_type" = ? and "context_id" = ? order by "id" limit ? for update)
         returning "id"`,
        [input.survivorId, JSON.stringify(stageMap), fallbackStageId, PROJECT_CONTEXT_TYPE, input.loserId, budget],
      );
      for (const row of tasks) ids.push(row.id);
      budget -= tasks.length;
      if (budget > 0) {
        const references = await em.execute<Array<{ id: string }>>(
          `update "task_references" set "target_id" = ? where "id" in (
             select "id" from "task_references" where "target_type" = ? and "target_id" = ? order by "id" limit ? for update)
           returning "id"`,
          [input.survivorId, PROJECT_CONTEXT_TYPE, input.loserId, budget],
        );
        for (const row of references) ids.push(row.id);
      }
      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return { result, before: null, after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids } };
    },
  };
}
