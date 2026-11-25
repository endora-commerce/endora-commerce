import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { makeCartMergeReassignCommand } from '../commands/cart-merge-reassign.command.js';

/** The manifest key of this module's Organization participation. */
export const CARTS_MERGE_PARTICIPATION_KEY = 'carts';

/** A cart *Buying for* the other Organization of the pair: after the merge it would buy for itself. */
export const CART_MERGE_BUYING_FOR_CLEARED = 'CART_MERGE_BUYING_FOR_CLEARED';

export interface CartMergeParticipantDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: () => Pick<CommandBus, 'run'>;
  /** Drop a cart's pricing-recompute cache, so its next read reprices it. */
  readonly reprice: (cartId: string) => Promise<void>;
}

/**
 * The `carts` participant of the Organization merge
 * (`specs/192-organization-merge/` T043): the loser's carts, and carts *Buying
 * for* it, move to the survivor in the `records` phase — after `configuration`,
 * so the repricing sees the survivor's price-book audiences (R-11). It checks
 * no permission and no presence (`contracts/merge-participant.md` §2).
 */
export class CartOrganizationMergeParticipant implements MergeParticipant<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: CartMergeParticipantDeps) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const [row] = await this.deps.emFactory().execute<Array<{ own: number; buyingFor: number; cleared: number }>>(
      `select (count(*) filter (where "organization_id" = ?))::int as "own",
              (count(*) filter (where "buying_for_organization_id" = ? and "organization_id" is distinct from ?))::int as "buyingFor",
              (count(*) filter (where ("organization_id" = ? and "buying_for_organization_id" = ?)
                                   or ("organization_id" = ? and "buying_for_organization_id" = ?)))::int as "cleared"
         from "carts" where "organization_id" = ? or "buying_for_organization_id" = ?`,
      [
        input.loserId,
        input.loserId,
        input.loserId,
        input.loserId,
        input.survivorId,
        input.survivorId,
        input.loserId,
        input.loserId,
        input.loserId,
      ],
    );
    const cleared = row?.cleared ?? 0;
    return {
      counts: { 'Cart.organizationId': row?.own ?? 0, 'Cart.buyingForOrganizationId': row?.buyingFor ?? 0 },
      conflicts: cleared > 0 ? [{ code: CART_MERGE_BUYING_FOR_CLEARED, resolution: 'cleared', details: { count: cleared } }] : [],
      warnings: [],
      refusals: [],
    };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved, ids } = await this.deps.commandBus().run(makeCartMergeReassignCommand(input));
    // After the commit (R-17): each moved cart is repriced on its next read.
    for (const id of ids) await this.deps.reprice(id);
    return { moved };
  }
}
