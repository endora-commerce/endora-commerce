import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReturnContext } from '@endora-commerce/contracts';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import {
  entersKeptState,
  entersKeptStateProvisionally,
  refundsOutsideKeptState,
  VOID_STATUS_CODES,
} from '../domain/kept-state.js';
import { approvedAmount, effectiveDefaultRefunds, type RefundOrder } from '../domain/refund-math.js';
import { isLineReturnable } from './return-eligibility.js';

/**
 * The default refund of a case's lines, from the order and its other cases
 * (issues #874 and #875) — one reading for case creation, the settlement and
 * the settlement prefill, so the three never disagree on which cases count.
 *
 * - **`settled`**, at settlement under the order's lock and in the prefill: the
 *   cases already settled. The kept state is the `return` cases settled with a
 *   refund or a credit; a case rejected, replaced or repaired takes nothing
 *   off it, so it leaves no cent behind.
 * - **`provisional`**, at creation: the live returns not settled yet count as
 *   well, so a second case opened before the first is settled is shown what it
 *   will refund when the cases are settled in the order they were opened. The
 *   settlement recomputes it.
 *
 * On either basis a complaint settled with money is outside the kept state: it
 * counts against what is left paid and against the line it names (the line
 * ceiling, {@link effectiveDefaultRefunds}).
 */

/** An order's cases and their lines, as one read. */
export interface OrderCases {
  cases: readonly ReturnCase[];
  items: readonly ReturnCaseItem[];
}

export type KeptStateBasis = 'settled' | 'provisional';

/** Every case of the order, with its lines, in the caller's tenant scope. */
export async function loadOrderCases(em: EntityManager, orderId: string): Promise<OrderCases> {
  const cases = await em.find(ReturnCase, { orderId });
  if (cases.length === 0) return { cases, items: [] };
  const items = await em.find(ReturnCaseItem, { returnCaseId: { $in: cases.map((c) => c.id) } }, { orderBy: { id: 'asc' } });
  return { cases, items };
}

/** The lines of the order's live (not rejected, not cancelled) cases: what takes up returnable quantity. */
export function liveItems(history: OrderCases): ReturnCaseItem[] {
  const live = new Set(history.cases.filter((c) => !VOID_STATUS_CODES.has(c.statusCode)).map((c) => c.id));
  return history.items.filter((it) => live.has(it.returnCaseId));
}

/** The order facts the refund rule reads, from what the order stored. */
export function refundOrderOf(context: OrderReturnContext): RefundOrder {
  return {
    vatMethod: context.vatMethod,
    productsPaidTotal: context.productsPaidTotal,
    discountTotal: context.discountTotal,
    orderLines: context.lines.map((l) => ({
      orderItemId: l.orderItemId,
      unitNetPrice: l.unitNetPrice,
      taxRate: l.taxRate,
      purchasedQty: l.purchasedQty,
      paidLineAmount: approvedAmount(l.paidLineAmount),
      returnable: isLineReturnable(l.returnableAtPurchase),
    })),
  };
}

/**
 * The default refund, its discount, the effective default the line ceiling
 * leaves and the ceiling itself, for each of `current`, in its order.
 * `excludeCaseId` is the case being settled, which is never its own history.
 */
export function caseDefaults(input: {
  context: OrderReturnContext;
  history: OrderCases;
  basis: KeptStateBasis;
  excludeCaseId?: string;
  kind: 'return' | 'complaint';
  current: ReadonlyArray<{ orderItemId: string; quantity: number }>;
}): ReturnType<typeof effectiveDefaultRefunds> {
  const counts = input.basis === 'settled' ? entersKeptState : entersKeptStateProvisionally;
  const others = input.history.cases.filter((c) => c.id !== input.excludeCaseId);
  const kept = new Set(others.filter(counts).map((c) => c.id));
  const outside = new Set(others.filter(refundsOutsideKeptState).map((c) => c.id));
  return effectiveDefaultRefunds({
    ...refundOrderOf(input.context),
    earlier: input.history.items
      .filter((it) => kept.has(it.returnCaseId))
      .map((it) => ({
        orderItemId: it.orderItemId,
        quantity: it.quantity,
        defaultRefundAmount: it.defaultRefundAmount,
        defaultDiscountAmount: it.defaultDiscountAmount,
      })),
    complaints: input.history.items
      .filter((it) => outside.has(it.returnCaseId))
      .map((it) => ({ orderItemId: it.orderItemId, amount: approvedAmount(it.approvedRefundAmount) })),
    kind: input.kind,
    current: input.current,
  });
}
