import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeStepInput } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';

/**
 * `order.merge_reassign` (`specs/192-organization-merge/` T058,
 * `contracts/participant-dispositions.md` §A) — one batch of the `orders`
 * participant of an Organization merge, as one Command: at most `batchSize`
 * references still naming the loser are re-pointed at the survivor.
 *
 * Every reference is a plain re-point (R-3): the update **is** the loser-side
 * consume, so a re-run finds only what is left. A placement intent moves only
 * once it settled — an unsettled one refuses the start in the preview
 * (`RECORD_MERGE_BUSY`, R-20), and is left where it is here so the finalize
 * sweep sees it rather than an intent being retargeted mid-placement.
 *
 * Irreversible, no event (R-13). Audit: `objectType` = `organization`,
 * `objectId` = the survivor, `stateAfter = { mergeId, loserId, moved, ids }`
 * — ids only (`specs/conventions/audit-state.md`).
 */

/** One reference this module holds, keyed as the preview counts it (`Entity.property`). */
interface OrderMergeTarget {
  readonly reference: string;
  readonly table: string;
  readonly column: string;
  /** Rows of the loser this step leaves alone (counted apart, see {@link ORDER_MERGE_PENDING_INTENTS}). */
  readonly movable?: string;
}

export const ORDER_MERGE_TARGETS: readonly OrderMergeTarget[] = [
  { reference: 'Order.organizationId', table: 'orders', column: 'organization_id' },
  { reference: 'Order.payerOrganizationId', table: 'orders', column: 'payer_organization_id' },
  { reference: 'OrderExternalReference.organizationId', table: 'order_external_references', column: 'organization_id' },
  { reference: 'OrderTransitionEffect.organizationId', table: 'order_transition_effects', column: 'organization_id' },
  {
    reference: 'OrderPlacementIntent.organizationId',
    table: 'order_placement_intents',
    column: 'organization_id',
    movable: `"status" <> 'pending'`,
  },
];

/** The loser's placement intents still being placed — the step never moves them. */
export const ORDER_MERGE_PENDING_INTENTS = `select count(*)::int as "count" from "order_placement_intents" where "organization_id" = ? and "status" = 'pending'`;

/**
 * A gateway payment still at the provider (R-20): an order paid through a
 * `gateway` method, awaiting payment, placed within this window. An older
 * one is an abandoned attempt — the provider's session has expired, and a late
 * settlement still finds the order by its id after the merge.
 */
export const ORDER_MERGE_PENDING_PAYMENT_WINDOW_HOURS = 24;

export const ORDER_MERGE_PENDING_PAYMENTS =
  `select count(*)::int as "count" from "orders" where ("organization_id" = ? or "payer_organization_id" = ?) ` +
  `and "payment_status" = 'awaiting_payment' and "payment_method_snapshot" ->> 'kind' = 'gateway' ` +
  `and "placed_at" > now() - make_interval(hours => ${ORDER_MERGE_PENDING_PAYMENT_WINDOW_HOURS})`;

/** Remaining references of the loser, per `Entity.property` — the preview's counts. */
export async function orderMergeCounts(em: EntityManager, loserId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const target of ORDER_MERGE_TARGETS) {
    const rows = await em.execute<Array<{ count: number }>>(
      `select count(*)::int as "count" from "${target.table}" where "${target.column}" = ?`,
      [loserId],
    );
    counts[target.reference] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

export interface OrderMergeReassignResult {
  readonly moved: number;
  readonly ids: readonly string[];
}

export function makeOrderMergeReassignCommand(input: MergeStepInput): Command<OrderMergeReassignResult> {
  return {
    action: 'order.merge_reassign',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }) => {
      let budget = Math.max(1, input.batchSize);
      const ids: string[] = [];
      for (const target of ORDER_MERGE_TARGETS) {
        if (budget <= 0) break;
        const rows = await em.execute<Array<{ id: string }>>(
          `update "${target.table}" set "${target.column}" = ? where "id" = any(array(` +
            `select "id" from "${target.table}" where "${target.column}" = ?` +
            `${target.movable ? ` and ${target.movable}` : ''} order by "id" limit ? for update)) returning "id"`,
          [input.survivorId, input.loserId, budget],
        );
        for (const row of rows) ids.push(row.id);
        budget -= rows.length;
      }
      const result = { moved: ids.length, ids };
      if (ids.length === 0) return { result, skipAudit: true };
      return {
        result,
        before: null,
        after: { mergeId: input.mergeId, loserId: input.loserId, moved: ids.length, ids },
      };
    },
  };
}
