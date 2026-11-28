import type { EntityManager } from '@mikro-orm/core';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeFormEntryMergeReassignCommand } from '../commands/form-entry-merge-reassign.command.js';
import { FormEntry } from '../entities/form-entry.entity.js';

/**
 * `forms` in an Organization merge (`specs/192-organization-merge/` T052): the
 * loser's form entries attributed to it are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'form-entries', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface FormEntryMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class FormEntryOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: FormEntryMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(FormEntry, { organizationId: input.loserId });
    return { counts: { 'FormEntry.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeFormEntryMergeReassignCommand(input));
    return { moved };
  }
}
