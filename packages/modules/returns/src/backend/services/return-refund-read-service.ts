import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReturnRefund, OrderReturnedQuantity, ReturnRefundReadPort } from '@endora-commerce/contracts';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { Refund } from '../entities/refund.entity.js';

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
   */
  async listReturnedQuantities(orderId: string): Promise<OrderReturnedQuantity[]> {
    const em = this.emFactory();
    const cases = await em.find(ReturnCase, {
      orderId,
      kind: 'return',
      resolutionType: { $in: ['refund', 'credit'] },
    });
    if (cases.length === 0) return [];
    const items = await em.find(
      ReturnCaseItem,
      { returnCaseId: { $in: cases.map((c) => c.id) } },
      { orderBy: { orderItemId: 'asc', id: 'asc' } },
    );
    const byLine = new Map<string, number>();
    for (const item of items) {
      byLine.set(item.orderItemId, (byLine.get(item.orderItemId) ?? 0) + item.quantity);
    }
    return [...byLine]
      .filter(([, quantity]) => quantity > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  }
}
