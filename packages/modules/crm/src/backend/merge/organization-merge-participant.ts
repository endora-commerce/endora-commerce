import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  crmOpportunityMergeCounts,
  makeCrmOpportunityMergeReassignCommand,
} from '../commands/crm-opportunity-merge-reassign.command.js';

/**
 * The `crm` participant of an Organization merge (`specs/192-organization-merge/`
 * T062, `contracts/merge-participant.md`): the loser's Opportunities follow the
 * survivor in the `records` phase, through `crm.opportunity.merge_reassign`.
 *
 * No permission and no presence check: the host's start was the gate, and the
 * runner never calls a participant whose module is off — while `crm` is off its
 * step is deferred and caught up when it is back (D-299 OQ-4).
 */
export interface CrmMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export const CRM_MERGE_PARTICIPATION_KEY = 'organization-opportunities';

export class CrmOpportunityMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: CrmMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await crmOpportunityMergeCounts(this.deps.emFactory().fork({ clear: true }), input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeCrmOpportunityMergeReassignCommand(input));
    return { moved };
  }
}
