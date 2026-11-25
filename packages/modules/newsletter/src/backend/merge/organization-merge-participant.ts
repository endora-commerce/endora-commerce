import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeNewsletterSubscriberMergeReassignCommand } from '../commands/newsletter-subscriber-merge-reassign.command.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';

/**
 * `newsletter` in an Organization merge (`specs/192-organization-merge/` T052): the
 * loser's newsletter subscribers attributed to it are re-pointed to the survivor. Registered with
 * `ctx.merge.participate('organization', 'subscribers', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface NewsletterSubscriberMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class NewsletterSubscriberOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: NewsletterSubscriberMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(NewsletterSubscriber, { organizationId: input.loserId });
    return { counts: { 'NewsletterSubscriber.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeNewsletterSubscriberMergeReassignCommand(input));
    return { moved };
  }
}
