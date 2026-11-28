import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeWebhookMergeReassignCommand } from '../commands/webhook-merge-reassign.command.js';
import { Webhook } from '../entities/webhook.entity.js';

/**
 * `webhooks` in an Organization merge (`specs/192-organization-merge/` T055): the
 * loser's Organization-bound webhooks are re-pointed to the survivor, in the
 * `records` phase — before the host's finalize — so `organization.merged.v1`,
 * published at finalize with the survivor's id, reaches them (FR-054). Registered with
 * `ctx.merge.participate('organization', 'bound-webhooks', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface WebhookMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class WebhookOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: WebhookMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(Webhook, { organizationId: input.loserId });
    return { counts: { 'Webhook.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeWebhookMergeReassignCommand(input));
    return { moved };
  }
}
