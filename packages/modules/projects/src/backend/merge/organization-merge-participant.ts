import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeProjectMergeReassignOrganizationCommand,
  projectOrganizationMergeCounts,
} from '../commands/project-merge-reassign-organization.command.js';

/**
 * The `projects` participant of an Organization merge
 * (`specs/192-organization-merge/` T066, `contracts/merge-participant.md`):
 * the survivor joins every Project the loser took part in (union), the records
 * linked under the loser follow it, and the loser leaves the Project — in the
 * `records` phase, through `projects.project.merge_reassign_organization`.
 *
 * No permission and no presence check: the host's start was the gate, and the
 * runner never calls a participant whose module is off.
 */
export interface ProjectsMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export const PROJECTS_MERGE_PARTICIPATION_KEY = 'organization-projects';

export class ProjectsOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: ProjectsMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await projectOrganizationMergeCounts(this.deps.emFactory().fork({ clear: true }), input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeProjectMergeReassignOrganizationCommand(input));
    return { moved };
  }
}
