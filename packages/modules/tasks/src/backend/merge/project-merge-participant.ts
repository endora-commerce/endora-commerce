import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeTaskMergeMoveContextCommand, taskProjectMergeCounts } from '../commands/task-merge-move-context.command.js';

/**
 * The `tasks` participant of a Project merge (`specs/192-organization-merge/`
 * US6, T084, `contracts/merge-participant.md`): the loser's Tasks move to the
 * survivor's context, without their Stage, and references naming the loser
 * name the survivor — in the `records` phase, through `task.merge_move_context`.
 *
 * No permission and no presence check: the host's start was the gate, and the
 * runner never calls a participant whose module is off — while `tasks` is off
 * its step is deferred and caught up when it is back (D-299).
 */
export interface TasksProjectMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export const TASKS_PROJECT_MERGE_PARTICIPATION_KEY = 'project-tasks';

export class TasksProjectMergeParticipant implements MergeParticipant<'project'> {
  readonly host = 'project' as const;

  constructor(private readonly deps: TasksProjectMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await taskProjectMergeCounts(this.deps.emFactory().fork({ clear: true }), input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeTaskMergeMoveContextCommand(input));
    return { moved };
  }
}
