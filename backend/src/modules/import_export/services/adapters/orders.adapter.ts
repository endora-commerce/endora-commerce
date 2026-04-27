import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../../orders/entities/order.entity.js';
import type { ImportExportAdapter } from '../adapter.js';

/**
 * Orders: export only.
 *
 * Orders are produced by the checkout flow; importing historical orders
 * into a running system would bypass stock reservation, payment tracking,
 * audit logging, and the credit-limit reservation lifecycle.
 */
export const ordersAdapter: ImportExportAdapter = {
  name: 'orders',
  exportHeader: [
    'id',
    'placed_at',
    'organization_id',
    'placed_by_customer_account_id',
    'status',
    'payment_status',
    'currency',
    'subtotal',
    'tax_total',
    'discount_total',
    'delivery_total',
    'total',
  ] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const orders = await em.find(Order, {}, { orderBy: { placedAt: 'desc' } });
    return orders.map((o) => [
      o.id,
      o.placedAt.toISOString(),
      o.organizationId,
      o.placedByCustomerAccountId,
      o.status,
      o.paymentStatus,
      o.currency,
      o.subtotal,
      o.taxTotal,
      o.discountTotal,
      o.deliveryTotal,
      o.total,
    ]);
  },
};
