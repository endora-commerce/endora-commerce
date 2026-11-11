import type { EntityManager } from '@mikro-orm/postgresql';
import { ORDER_STATUS_COMPLETED } from '../domain/order-status-graph.js';
import { Order } from '../entities/order.entity.js';
import type { OrderReturnContext, OrderReturnContextPort } from '@endora-commerce/contracts';
import { loadArrangedOrderLines } from './order-line-order.js';
import { decimalDifference, decimalSum, quotientHalfUp, roundHalfUp, isUuidShape } from '@endora-commerce/contracts';

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
 * The fulfilment-completing anchor is the moment the order entered its
 * completing status (`completed`), stored once as `orders.completed_at` (issue
 * #905). It used to be the order's `updatedAt`, which any later edit moved
 * forward; the interface did not change. A completed row without the stamp —
 * not expected, since the migration backfilled every one and the entity stamps
 * every new one — reports `null`, never a moment that drifts. Nothing here reads
 * `shipments`, so that module's off-state changes nothing about the anchor.
 */

export class OrderReturnContextProvider implements OrderReturnContextPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async getReturnContext(orderId: string): Promise<OrderReturnContext | null> {
    const em = this.emFactory();
    if (!isUuidShape(orderId)) return null;
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
    | 'completedAt'
    | 'placedAt'
    | 'paymentMethodId'
    | 'subtotal'
    | 'taxTotal'
    | 'discountTotal'
  > & {
    vatMethod?: 'per_rate' | null | undefined;
    /** Issue #876 — absent on a caller that predates it: read as no delivery. */
    deliveryTotal?: string | undefined;
    paymentMethodSnapshot?: { additionalPrice?: number | string | undefined } | null | undefined;
  },
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
  const completing = order.status === ORDER_STATUS_COMPLETED;
  return {
    salesChannelId: order.salesChannelId,
    customerAccountId: order.placedByCustomerAccountId,
    organizationId: order.organizationId ?? null,
    currency: order.currency,
    completingStatusEnteredAt: completing ? (order.completedAt ?? null) : null,
    // `specs/177-tax-id-scope/` FR-040 — `returns` compares it with the
    // organization's `convertedToCompanyAt`.
    placedAt: order.placedAt,
    // Issue #905 — the refund of a consumer's withdrawal proposes it.
    paymentMethodId: order.paymentMethodId ?? null,
    vatMethod: order.vatMethod ?? null,
    // The order's discount is taken off its gross, without tax of its own (the
    // invoice carries it as a 0 % line): the products were charged their net
    // plus VAT less the discount. Delivery and the surcharge are not products.
    productsPaidTotal: roundHalfUp(decimalDifference(decimalSum(order.subtotal, order.taxTotal), order.discountTotal ?? '0')),
    discountTotal: roundHalfUp(order.discountTotal ?? '0'),
    // Issue #876 — what the order charged beside its products, as stored: a
    // consumer's withdrawal from the whole sale refunds both (Directive
    // 2011/83 art. 13(1)). The surcharge is the one captured at placement
    // (feature 034), which the invoice itemises the same way.
    deliveryTotal: roundHalfUp(order.deliveryTotal ?? '0'),
    paymentSurcharge: roundHalfUp(order.paymentMethodSnapshot?.additionalPrice ?? 0),
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
