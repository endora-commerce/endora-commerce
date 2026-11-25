import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeCustomerNotificationMergeReassignCommand } from '../commands/customer-notification-merge-reassign.command.js';
import { CustomerNotification } from '../entities/customer-notification.entity.js';

/**
 * `customer_notifications` in an Organization merge (`specs/192-organization-merge/` T052): the
 * loser's in-app notifications are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'notifications', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface CustomerNotificationMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class CustomerNotificationOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: CustomerNotificationMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(CustomerNotification, { organizationId: input.loserId });
    return { counts: { 'CustomerNotification.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeCustomerNotificationMergeReassignCommand(input));
    return { moved };
  }
}
