import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeParticipant, MergeParticipantPreview, MergePreviewInput, MergeStepInput } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeAnalyticsEventMergeReassignCommand } from '../commands/analytics-event-merge-reassign.command.js';
import { AnalyticsEvent } from '../entities/analytics-event.entity.js';

/**
 * `analytics` in an Organization merge (`specs/192-organization-merge/` T056): the
 * loser's analytics events are re-pointed to the survivor (OQ-12), so
 * per-Organization reports show one history. The step is declared `trailing`
 * with batches of 500 (R-16): it may finish after finalize and does not hold
 * the merge's completion, because this table can outgrow every other one. Registered with
 * `ctx.merge.participate('organization', 'events', …)`; the runner calls it
 * inside the merge's own system scope and never while the module is off.
 * No cache or search index of this module is keyed by Organization, so a batch
 * has nothing to refresh (R-17).
 */
export interface AnalyticsEventMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
}

export class AnalyticsEventOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: AnalyticsEventMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const remaining = await em.count(AnalyticsEvent, { organizationId: input.loserId });
    return { counts: { 'AnalyticsEvent.organizationId': remaining }, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeAnalyticsEventMergeReassignCommand(input));
    return { moved };
  }
}
