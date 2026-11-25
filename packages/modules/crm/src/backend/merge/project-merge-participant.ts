import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  crmProjectReferenceMergeCounts,
  makeCrmOpportunityReferenceMergeReassignCommand,
} from '../commands/crm-opportunity-reference-merge-reassign.command.js';

/**
 * The `crm` participant of a Project merge (`specs/192-organization-merge/`
 * US6, T085, `contracts/merge-participant.md`): references naming the loser in
 * Opportunities' texts name the survivor, in the `records` phase, through
 * `crm.opportunity_reference.merge_reassign`. No port is involved: the rows
 * are this module's own derived index, and no aggregate operation exists for
 * them.
 *
 * No permission and no presence check: the host's start was the gate, and the
 * runner never calls a participant whose module is off.
 */
export interface CrmProjectMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export const CRM_PROJECT_MERGE_PARTICIPATION_KEY = 'project-references';

export class CrmProjectReferenceMergeParticipant implements MergeParticipant<'project'> {
  readonly host = 'project' as const;

  constructor(private readonly deps: CrmProjectMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await crmProjectReferenceMergeCounts(this.deps.emFactory().fork({ clear: true }), input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeCrmOpportunityReferenceMergeReassignCommand(input));
    return { moved };
  }
}
