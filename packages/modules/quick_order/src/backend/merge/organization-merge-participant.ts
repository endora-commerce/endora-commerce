import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makeQuickOrderMergeReassignCommand,
  quickOrderPreferenceToAdopt,
} from '../commands/quick-order-merge-reassign.command.js';

/**
 * `quick_order` in an Organization merge (`specs/192-organization-merge/`
 * T054): the Organization-scoped default preference, *survivor wins with fill
 * gaps*. The remaining count is the loser's row only while the survivor has
 * none — a row left to the survivor's win is not remaining (research R-3), so
 * the count reaches zero either way. Registered with
 * `ctx.merge.participate('organization', 'default-preferences', …)`. Nothing is
 * cached by Organization, so a batch has nothing to refresh (R-17).
 */
export interface QuickOrderMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class QuickOrderOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: QuickOrderMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const adopted = await quickOrderPreferenceToAdopt(em, input.survivorId, input.loserId);
    return {
      counts: { 'QuickOrderDefaultPreference.scopeId': adopted === null ? 0 : 1 },
      conflicts: [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeQuickOrderMergeReassignCommand(input));
    return { moved };
  }
}
