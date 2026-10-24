import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../entities/order.entity.js';
import type { OrderReturnContext, OrderReturnContextPort } from '@endora-commerce/contracts';
import { loadArrangedOrderLines } from './order-line-order.js';
import { decimalSum, quotientHalfUp, roundHalfUp } from '@endora-commerce/contracts';

/**
 * Orders-side implementation of `OrderReturnContextPort` (feature 046, R4).
 * Exposes the order facts the returns module needs through a single documented
 * interface, so the returns module never reads `orders` tables directly.
 *
 * The interface itself is published in `@endora-commerce/contracts` (feature 075, Phase P);
 * `returns` declares the shape it needs and this module implements it, which is
 * the direction the port was designed in and the reason it can be named from
 * both sides without either module importing the other.
 *
 * MVP note: the fulfilment-completing anchor uses the orders default completing
 * status (`completed`) and the order's `updatedAt` as the entered-at timestamp.
 * A precise per-status timestamp (an additive `orders.completed_at` column) is a
 * planned refinement (research R4) and does not change this interface.
 */
const COMPLETING_STATUS = 'completed';

export class OrderReturnContextProvider implements OrderReturnContextPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async getReturnContext(orderId: string): Promise<OrderReturnContext | null> {
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: orderId });
    if (!order) return null;
    // Feature 159 — the lines in the order's display order.
    const items = (await loadArrangedOrderLines(em, orderId)).lines;

    return returnContextFrom(order, items);
  }
}

/**
 * The return context of an order from **what it stored**, never recomputed
 * (issue #417, review of PR #423): each line's stored gross, the stored
 * subtotal plus tax total as what the products were charged, and the VAT method
 * the order was placed under — so a return of an order placed before 0.108.0
 * refunds what that order actually charged.
 */
export function returnContextFrom(
  order: Pick<
    Order,
    | 'salesChannelId'
    | 'placedByCustomerAccountId'
    | 'organizationId'
    | 'currency'
    | 'status'
    | 'updatedAt'
    | 'subtotal'
    | 'taxTotal'
  > & { vatMethod?: 'per_rate' | null | undefined },
  items: ReadonlyArray<{
    id: string;
    productId: string;
    productSnapshot: { name: string };
    quantity: number;
    unitPrice: string;
    taxRate: string;
    lineTotal: string;
    returnableAtPurchase?: boolean | null | undefined;
  }>,
): OrderReturnContext {
  const completing = order.status === COMPLETING_STATUS;
  return {
    salesChannelId: order.salesChannelId,
    customerAccountId: order.placedByCustomerAccountId,
    organizationId: order.organizationId ?? null,
    currency: order.currency,
    completingStatusEnteredAt: completing ? order.updatedAt : null,
    vatMethod: order.vatMethod ?? null,
    productsPaidTotal: roundHalfUp(decimalSum(order.subtotal, order.taxTotal)),
    lines: items.map((it) => ({
      orderItemId: it.id,
      productId: it.productId,
      name: it.productSnapshot.name,
      purchasedQty: it.quantity,
      // Two-place decimals read as numbers losslessly; the unit amount is informational.
      paidUnitAmount: Number(quotientHalfUp(it.lineTotal, it.quantity || 1, 4)),
      paidLineAmount: Number(roundHalfUp(it.lineTotal)),
      unitNetPrice: it.unitPrice,
      taxRate: it.taxRate,
      // Feature 155 (FR-016a) — the stamp placement recorded, reported as
      // it is: `null` only on a line placed before the feature. What `null`
      // means for a return (FR-025) is `returns`' policy, not this port's.
      returnableAtPurchase: it.returnableAtPurchase ?? null,
    })),
  };
}
