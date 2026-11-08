import type { EntityManager } from '@mikro-orm/postgresql';
import { moneySum, type OrderReturnRefund, type OrderReturnedQuantity, type ReturnRefundReadPort } from '@endora-commerce/contracts';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { carriedDiscount } from '../domain/refund-math.js';
import { MONEY_RESOLUTIONS, entersKeptState } from '../domain/kept-state.js';

/**
 * `returnRefundReadPort` — what the order's settled return cases refunded
 * (issue #428), and what of the order came back with them (issue #435). Every
 * money-moving settlement writes one `Refund` row, so the first is a read of
 * those rows over the order's cases, in the caller's tenant scope (`ReturnCase`
 * is organisation-scoped). The reader decides which of them `payments` already
 * reports.
 */
export class ReturnRefundReadService implements ReturnRefundReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listForOrder(orderId: string): Promise<OrderReturnRefund[]> {
    const em = this.emFactory();
    const cases = await em.find(ReturnCase, { orderId });
    if (cases.length === 0) return [];
    const refunds = await em.find(
      Refund,
      { returnCaseId: { $in: cases.map((c) => c.id) } },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return refunds.map((refund) => ({
      resolutionType: refund.resolutionType,
      amount: refund.amount,
      settlementState: refund.settlementState,
    }));
  }

  /**
   * The quantity of each order line given back for money (product-owner ruling
   * of 2026-11-07): the lines of the order's `return`-kind cases settled with a
   * refund or a credit, whether or not the money has been paid out yet — the
   * money side is the reader's, through {@link listForOrder}. A case's
   * `resolutionType` is written only by the settlement, so a case without one
   * has not been settled. A replacement and a repair send goods back to the
   * buyer, and a complaint is not a withdrawal from the sale, so none counts.
   * It is the kept state the default refund is computed on (`kept-state.ts`,
   * issues #874 and #875), so the invoice and the refunds count the same cases.
   */
  async listReturnedQuantities(orderId: string): Promise<OrderReturnedQuantity[]> {
    const em = this.emFactory();
    const cases = (
      await em.find(ReturnCase, { orderId, kind: 'return', resolutionType: { $in: [...MONEY_RESOLUTIONS] } })
    ).filter(entersKeptState);
    if (cases.length === 0) return [];
    const items = await em.find(
      ReturnCaseItem,
      { returnCaseId: { $in: cases.map((c) => c.id) } },
      { orderBy: { orderItemId: 'asc', id: 'asc' } },
    );
    const byLine = new Map<string, { quantity: number; discounts: string[] }>();
    for (const item of items) {
      const line = byLine.get(item.orderItemId) ?? { quantity: 0, discounts: [] };
      line.quantity += item.quantity;
      // The discount the settled refund carried — the figure the settlement
      // hands a correction for the invoice's discount line (product-owner
      // ruling Q3 of 2026-11-07), from what the case line recorded.
      line.discounts.push(carriedDiscount(item.defaultDiscountAmount, item.defaultRefundAmount, item.approvedRefundAmount));
      byLine.set(item.orderItemId, line);
    }
    return [...byLine]
      .filter(([, line]) => line.quantity > 0)
      .map(([orderItemId, line]) => ({ orderItemId, quantity: line.quantity, discount: moneySum(line.discounts) }));
  }
}
