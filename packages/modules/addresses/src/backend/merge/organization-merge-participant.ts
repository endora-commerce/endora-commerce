import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeAddressMergeReassignCommand } from '../commands/address-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const ADDRESSES_MERGE_PARTICIPATION_KEY = 'addresses';

/** A loser default of a kind the survivor has a default for: it moves, and stops being a default. */
export const ADDRESS_MERGE_DEFAULT_KEPT = 'ADDRESS_MERGE_SURVIVOR_DEFAULT_KEPT';

export interface AddressMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The `addresses` participant of the Organization merge
 * (`specs/192-organization-merge/` T042): the loser's addresses are
 * re-pointed in the `addresses` phase, the survivor's defaults kept. It checks
 * no permission and no presence (`contracts/merge-participant.md` §2).
 */
export class AddressOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: AddressMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.deps.emFactory().execute<Array<{ moved: number; defaults: number }>>(
      `select count(*)::int as "moved",
              (count(*) filter (where "a"."is_default" and "a"."deleted_at" is null and exists (
                 select 1 from "addresses" as "s"
                  where "s"."organization_id" = ? and "s"."kind" = "a"."kind" and "s"."is_default" and "s"."deleted_at" is null)))::int as "defaults"
         from "addresses" as "a" where "a"."organization_id" = ?`,
      [input.survivorId, input.loserId],
    );
    const defaults = row?.defaults ?? 0;
    return {
      counts: { 'Address.organizationId': row?.moved ?? 0 },
      conflicts: defaults > 0 ? [{ code: ADDRESS_MERGE_DEFAULT_KEPT, resolution: 'survivor', details: { count: defaults } }] : [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus().run(makeAddressMergeReassignCommand(input));
    return { moved };
  }
}
