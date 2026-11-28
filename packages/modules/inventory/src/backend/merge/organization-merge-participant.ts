import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeAvailabilityNotificationMergeReassignCommand } from '../commands/availability-notification-merge-reassign.command.js';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';

/**
 * `inventory` in an Organization merge (`specs/192-organization-merge/` T051): the
 * loser's back-in-stock notification requests are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'availability-notifications', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface AvailabilityNotificationMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class AvailabilityNotificationOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: AvailabilityNotificationMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(AvailabilityNotification, { organizationId: input.loserId });
    return { counts: { 'AvailabilityNotification.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeAvailabilityNotificationMergeReassignCommand(input));
    return { moved };
  }
}
