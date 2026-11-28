import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';

import { EXAMPLE_ERP_KEYS_TABLE } from './manifest.js';

/** The manifest key of this module's Organization merge participation. */
export const EXAMPLE_ERP_KEYS_MERGE_KEY = 'erp-keys';

/** The batch Command of that participation (`specs/192-organization-merge/` R-12). */
export const EXAMPLE_ERP_KEYS_MERGE_REASSIGN_ACTION = 'example_erp_keys.merge_reassign';

/**
 * The preview warning naming a loser's key that stays on the archived loser,
 * because the survivor already has one (`survivor_wins_fill_gaps`).
 */
export const EXAMPLE_ERP_KEY_KEPT = 'EXAMPLE_ERP_KEY_KEPT';

/** The survivor has no key of its own: the only case in which the loser's key moves. */
const SURVIVOR_HAS_NO_KEY = `not exists (select 1 from "${EXAMPLE_ERP_KEYS_TABLE}" as "s" where "s"."organization_id" = ?)`;

export interface ExampleErpKeysMergeReassignResult {
  readonly moved: number;
}

/**
 * `example_erp_keys.merge_reassign` — the Organization merge step of this
 * module (`specs/192-organization-merge/` FR-045, disposition
 * `survivor_wins_fill_gaps`).
 *
 * A key names one Organization in the ERP, so an Organization has at most one
 * (the table is keyed by `organization_id`), and a key is unique across the
 * shop. Two outcomes follow:
 *
 *  - **The survivor has no key.** The loser's key moves to the survivor. It is
 *    the same row re-pointed, so the key stays unique.
 *  - **The survivor has a key.** The survivor's key wins. The loser's stays on
 *    the archived loser, and the preview lists it (`EXAMPLE_ERP_KEY_KEPT`).
 *    Reconciling it in the ERP, for instance merging the two ERP customers
 *    there, is the integrator's job: the platform cannot know which ERP record
 *    should survive.
 *
 * One row at most per loser, so one batch always finishes the step. The audit
 * entry names the merge and the loser, never the key: the key is an external
 * identifier, and audit state carries names, not values.
 */
export function makeExampleErpKeysMergeReassignCommand(input: MergeStepInput): Command<ExampleErpKeysMergeReassignResult> {
  return {
    action: EXAMPLE_ERP_KEYS_MERGE_REASSIGN_ACTION,
    objectType: input.hostType,
    objectId: input.survivorId,
    run: async ({ em }) => {
      const rows = await em.execute<Array<{ organization_id: string }>>(
        `update "${EXAMPLE_ERP_KEYS_TABLE}" set "organization_id" = ?
          where "organization_id" = ? and ${SURVIVOR_HAS_NO_KEY}
          returning "organization_id"`,
        [input.survivorId, input.loserId, input.survivorId],
      );
      if (rows.length === 0) return { result: { moved: 0 }, skipAudit: true };
      return {
        result: { moved: rows.length },
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: rows.length },
      };
    },
  };
}

export interface ExampleErpKeysMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
}

/**
 * The participant `registerModule` hands to `ctx.merge.participate`. Like every
 * participant it checks no permission and no presence: the merge does both
 * (`specs/192-organization-merge/contracts/merge-participant.md` §2).
 */
export class ExampleErpKeysOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  readonly #deps: ExampleErpKeysMergeParticipantDeps;

  constructor(deps: ExampleErpKeysMergeParticipantDeps) {
    this.#deps = deps;
  }

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.#deps.emFactory().execute<Array<{ moves: boolean }>>(
      `select ${SURVIVOR_HAS_NO_KEY} as "moves" from "${EXAMPLE_ERP_KEYS_TABLE}" where "organization_id" = ?`,
      [input.survivorId, input.loserId],
    );
    const moves = row?.moves === true;
    return {
      counts: { 'ExampleErpOrganizationKey.organizationId': moves ? 1 : 0 },
      conflicts: [],
      warnings: row !== undefined && !moves ? [{ code: EXAMPLE_ERP_KEY_KEPT, details: { loserId: input.loserId } }] : [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.#deps.commandBus().run(makeExampleErpKeysMergeReassignCommand(input));
    return { moved };
  }
}
