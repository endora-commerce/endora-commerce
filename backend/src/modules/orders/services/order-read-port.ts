import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderItemRecord, OrderReadPort, OrderRecord } from '@b2b/contracts';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';

/**
 * The row-level read model `orders` publishes (feature 075, Phase P).
 *
 * Thirty-three of this module's 42 inbound import sites are the same lookup —
 * `em.findOne(Order, { id })` — written out once each in four payment
 * gateways, `invoices`, `shipments`, `quote_requests`, `autopay` and the
 * export adapter. The port is that lookup, plus the two shapes around it.
 *
 * The money columns stay strings across the boundary. They are
 * `decimal(14,2)`, the entity carries them as strings because a `number`
 * cannot round-trip a monetary value, and four of the consumers forward the
 * figure straight to a payment provider.
 */
export class OrderReadService implements OrderReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<OrderRecord | null> {
    const order = await this.emFactory().findOne(Order, { id });
    return order ? toOrderRecord(order) : null;
  }

  async findByIds(ids: readonly string[]): Promise<OrderRecord[]> {
    if (ids.length === 0) return [];
    const orders = await this.emFactory().find(Order, { id: { $in: [...ids] } });
    return orders.map(toOrderRecord);
  }

  async listAll(): Promise<OrderRecord[]> {
    const orders = await this.emFactory().find(Order, {}, { orderBy: { placedAt: 'desc' } });
    return orders.map(toOrderRecord);
  }

  async listItems(orderId: string): Promise<OrderItemRecord[]> {
    const items = await this.emFactory().find(
      OrderItem,
      { orderId },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return items.map(toOrderItemRecord);
  }
}

export function toOrderRecord(order: Order): OrderRecord {
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryAddress: order.deliveryAddress,
    billingAddress: order.billingAddress,
    deliveryMethodId: order.deliveryMethodId,
    deliveryMethodSnapshot: order.deliveryMethodSnapshot,
    paymentMethodId: order.paymentMethodId,
    paymentMethodSnapshot: order.paymentMethodSnapshot,
    sourceQuoteRequestId: order.sourceQuoteRequestId ?? null,
    subtotal: order.subtotal,
    taxTotal: order.taxTotal,
    discountTotal: order.discountTotal,
    deliveryTotal: order.deliveryTotal,
    total: order.total,
    currency: order.currency,
    promotionCode: order.promotionCode ?? null,
    customerNote: order.customerNote ?? null,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customFieldValues: order.customFieldValues ?? {},
  };
}

export function toOrderItemRecord(item: OrderItem): OrderItemRecord {
  return {
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    productSnapshot: item.productSnapshot,
    variantId: item.variantId ?? null,
    variantSnapshot: item.variantSnapshot ?? null,
    packagingUnitSnapshot: item.packagingUnitSnapshot ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    lineTotal: item.lineTotal,
    createdAt: item.createdAt,
  };
}
