import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { mergeSql } from '../../helpers/organization-merge-conformance.js';
import { expectComposedProjectParticipant } from '../../helpers/project-merge-participants.js';
import { createStageTask } from '../projects/helpers.js';

/**
 * `specs/192-organization-merge/` US6, T084 — the `tasks` participant of a
 * Project merge over a real database: the Tasks in the loser's context move to
 * the survivor's, the one of a loser's Stage with no Stage (FR-092), and the
 * references naming the loser in Tasks' texts name the survivor (FR-093),
 * through `task.merge_move_context`, held to `expectMergeParticipant` with
 * batches smaller than the rows.
 */
describe('Project merge — the tasks participant', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves the loser’s Tasks without their Stage and re-points references to it (conformance)', async () => {
    const outcome = await expectComposedProjectParticipant(h, {
      moduleId: 'tasks',
      key: 'project-tasks',
      action: 'task.merge_move_context',
      batchSize: 2,
      seed: async ({ survivorId, loserId }) => {
        const [stage] = await mergeSql<Array<{ id: string }>>(h, `select "id" from "project_stages" where "project_id" = ?`, [loserId]);
        // Three in a Stage of the loser (a Task of a Project with Stages always
        // has one), one of them mentioning it; one of the survivor.
        await createStageTask(h, loserId, stage!.id, { title: 'In a Stage', description: `See [[project:${loserId}]]` });
        await createStageTask(h, loserId, stage!.id, { title: 'In a Stage too' });
        await createStageTask(h, loserId, stage!.id, { title: 'And a third' });
        const [survivorStage] = await mergeSql<Array<{ id: string }>>(
          h,
          `select "id" from "project_stages" where "project_id" = ?`,
          [survivorId],
        );
        await createStageTask(h, survivorId, survivorStage!.id, { title: 'The survivor’s' });
      },
      snapshot: async ({ survivorId, loserId }) => ({
        tasks: await mergeSql(
          h,
          `select "id","context_id","context_group_id" from "tasks" where "context_type" = 'project' and "context_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
        references: await mergeSql(
          h,
          `select "id","target_id" from "task_references" where "target_type" = 'project' and "target_id" in (?, ?) order by "id"`,
          [survivorId, loserId],
        ),
      }),
      failOn: { table: 'tasks', on: 'UPDATE', when: (loserId) => `OLD."context_id" = '${loserId}'` },
    });
    // Three Tasks and one reference.
    expect(outcome.moved).toBe(4);
    const moved = await mergeSql<Array<{ context_id: string; context_group_id: string | null }>>(
      h,
      `select "context_id","context_group_id" from "tasks" where "context_type" = 'project' and "context_id" = ? and "title" <> 'The survivor’s'`,
      [outcome.survivorId],
    );
    expect(moved).toHaveLength(3);
    expect(moved.every((task) => task.context_group_id === null)).toBe(true);
    await mergeSql(h, `delete from "tasks" where "context_type" = 'project' and "context_id" in (?, ?)`, [
      outcome.survivorId,
      outcome.loserId,
    ]);
    await mergeSql(h, `delete from "projects" where "id" in (?, ?)`, [outcome.survivorId, outcome.loserId]);
  });
});
