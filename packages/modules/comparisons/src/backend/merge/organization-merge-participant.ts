import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeComparisonMergeReassignCommand } from '../commands/comparison-merge-reassign.command.js';
import { Comparison } from '../entities/comparison.entity.js';

/**
 * `comparisons` in an Organization merge (`specs/192-organization-merge/` T051): the
 * loser's comparisons are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'comparisons', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface ComparisonMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class ComparisonOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: ComparisonMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(Comparison, { organizationId: input.loserId });
    return { counts: { 'Comparison.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeComparisonMergeReassignCommand(input));
    return { moved };
  }
}
