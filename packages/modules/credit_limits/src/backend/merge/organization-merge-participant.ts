import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  limitIdOf,
  makeCreditLimitMergeReassignCommand,
  type CreditLimitMergePart,
} from '../commands/credit-limit-merge-reassign.command.js';

/** The manifest keys of this module's two Organization participations. */
export const CREDIT_LIMIT_MERGE_PARTICIPATION_KEY = 'credit-limit';
export const CREDIT_EXPOSURE_MERGE_PARTICIPATION_KEY = 'credit-exposure';

/** Both Organizations have a limit: the survivor's is kept, the loser's stays on the archived loser. */
export const CREDIT_LIMIT_MERGE_SURVIVOR_KEPT = 'CREDIT_LIMIT_MERGE_SURVIVOR_KEPT';
/** After the merge the survivor's active reservations exceed its limit (OQ-8: warned, not refused). */
export const CREDIT_LIMIT_MERGE_OVER_LIMIT = 'CREDIT_LIMIT_MERGE_OVER_LIMIT';

export interface CreditLimitMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `credit_limits` participants of the Organization merge
 * (`specs/192-organization-merge/` T046, OQ-8): `limit` runs in the
 * `configuration` phase (the survivor keeps its limit or takes the loser's),
 * `exposure` in `records` (reservations and return top-ups follow the
 * survivor). They check no permission and no presence
 * (`contracts/merge-participant.md` §2).
 */
export class CreditLimitOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(
    private readonly part: CreditLimitMergePart,
    private readonly deps: CreditLimitMergeParticipantDeps,
  ) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    return this.part === 'limit' ? this.#previewLimit(input) : this.#previewExposure(input);
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makeCreditLimitMergeReassignCommand(this.part, input));
    return { moved };
  }

  async #previewLimit(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory();
    const [survivorLimit, loserLimit] = [await limitIdOf(em, input.survivorId), await limitIdOf(em, input.loserId)];
    const moves = loserLimit !== null && survivorLimit === null;
    return {
      counts: { 'CreditLimit.organizationId': moves ? 1 : 0 },
      conflicts:
        loserLimit !== null && survivorLimit !== null
          ? [{ code: CREDIT_LIMIT_MERGE_SURVIVOR_KEPT, resolution: 'survivor', details: { creditLimitId: survivorLimit } }]
          : [],
      warnings: [],
      refusals: [],
    };
  }

  async #previewExposure(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const em = this.deps.emFactory();
    const survivorLimit = await limitIdOf(em, input.survivorId);
    const loserLimit = survivorLimit === null ? null : await limitIdOf(em, input.loserId);
    const [row] = await em.execute<Array<{ reservations: number; topups: number }>>(
      `select (select count(*) from "credit_limit_reservations" where "reserving_organization_id" = ? or "credit_limit_id" = ?::uuid)::int as "reservations",
              (select count(*) from "credit_limit_return_topups" where "organization_id" = ?)::int as "topups"`,
      [input.loserId, loserLimit, input.loserId],
    );
    const warnings: MergeParticipantPreview['warnings'][number][] = [];
    if (survivorLimit !== null) {
      // The survivor's exposure after the merge: what is on its limit now, plus
      // what moves onto it. Compared, never recorded: no amount leaves here.
      const [exposure] = await em.execute<Array<{ over: boolean }>>(
        `select coalesce(sum("amount"), 0) > (select "granted_amount" from "credit_limits" where "id" = ?) as "over"
           from "credit_limit_reservations"
          where "status" = 'active' and ("credit_limit_id" = ? or "credit_limit_id" = ?::uuid or "reserving_organization_id" = ?)`,
        [survivorLimit, survivorLimit, loserLimit, input.loserId],
      );
      if (exposure?.over) warnings.push({ code: CREDIT_LIMIT_MERGE_OVER_LIMIT, details: { creditLimitId: survivorLimit } });
    }
    return {
      counts: {
        'CreditLimitReservation.reservingOrganizationId': row?.reservations ?? 0,
        'CreditLimitReturnTopup.organizationId': row?.topups ?? 0,
      },
      conflicts: [],
      warnings,
      refusals: [],
    };
  }
}
