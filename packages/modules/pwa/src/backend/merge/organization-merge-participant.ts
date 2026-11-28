import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makePwaMergeReassignCommand } from '../commands/pwa-merge-reassign.command.js';
import { PushNotificationPreference } from '../entities/push-notification-preference.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';

/**
 * `pwa` in an Organization merge (`specs/192-organization-merge/` T053): the
 * loser's push subscriptions and push preferences are re-pointed to the
 * survivor. Registered with `ctx.merge.participate('organization', 'push', …)`;
 * the runner calls it inside the merge's own system scope and never while the
 * module is off. Nothing this module caches or indexes is keyed by
 * Organization, so a batch has nothing to refresh (R-17).
 */
export interface PwaMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class PwaOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: PwaMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const subscriptions = await em.count(PushSubscription, { organizationId: input.loserId });
    const preferences = await em.count(PushNotificationPreference, { organizationId: input.loserId });
    return {
      counts: {
        'PushSubscription.organizationId': subscriptions,
        'PushNotificationPreference.organizationId': preferences,
      },
      conflicts: [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makePwaMergeReassignCommand(input));
    return { moved };
  }
}
