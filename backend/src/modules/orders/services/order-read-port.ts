import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderItemRecord, OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
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

  async findIdsByBusinessIdLike(fragment: string, limit: number): Promise<string[]> {
    const trimmed = fragment.trim();
    if (!trimmed) return [];
    const orders = await this.emFactory().find(
      Order,
      { businessId: { $ilike: `%${trimmed}%` } },
      { fields: ['id'], orderBy: { placedAt: 'desc' }, limit },
    );
    return orders.map((order) => order.id);
  }

  async salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]> {
    const orders = await this.emFactory().find(
      Order,
      { placedByCustomerAccountId: customerAccountId },
      { fields: ['salesChannelId'], orderBy: { placedAt: 'desc' } },
    );
    // Distinct, newest first: the first row a channel appears in is that
    // customer's latest order on it, so first-appearance order *is* the
    // ordering the contract promises. `customers` used to take the raw rows
    // and dedupe them itself, which left the order undefined.
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const order of orders) {
      if (seen.has(order.salesChannelId)) continue;
      seen.add(order.salesChannelId);
      ids.push(order.salesChannelId);
    }
    return ids;
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
    deliveryPointSnapshot: order.deliveryPointSnapshot ?? null,
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
