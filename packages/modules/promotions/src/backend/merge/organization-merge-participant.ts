import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  makePromotionMergeReassignCommand,
  organizationCounterSuffix,
} from '../commands/promotion-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const PROMOTIONS_MERGE_PARTICIPATION_KEY = 'promotions';

export interface PromotionMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `promotions` participant of the Organization merge
 * (`specs/192-organization-merge/` T049): promotions and usages re-pointed,
 * per-Organization counters summed, in the `records` phase. It checks no
 * permission and no presence (`contracts/merge-participant.md` §2).
 */
export class PromotionOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: PromotionMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.deps.emFactory().execute<Array<{ promotions: number; usages: number; counters: number }>>(
      `select (select count(*) from "promotions" where "organization_id" = ?)::int as "promotions",
              (select count(*) from "promotion_usages" where "organization_id" = ?)::int as "usages",
              (select count(*) from "promotion_usage_counters" where "scope_type" = 'organization' and "scope_key" like ?)::int as "counters"`,
      [input.loserId, input.loserId, organizationCounterSuffix(input.loserId)],
    );
    return {
      counts: {
        'Promotion.organizationId': row?.promotions ?? 0,
        'PromotionUsage.organizationId': row?.usages ?? 0,
        'PromotionUsageCounter.scopeKey': row?.counters ?? 0,
      },
      conflicts: [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makePromotionMergeReassignCommand(input));
    return { moved };
  }
}
