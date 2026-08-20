import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

/**
 * Orders: export only.
 *
 * Orders are produced by the checkout flow; importing historical orders
 * into a running system would bypass stock reservation, payment tracking,
 * audit logging, and the credit-limit reservation lifecycle.
 *
 * Feature 075 / D-74 — `OrderReadPort.listAll` was published by Phase P with
 * "for the bulk export adapter" in its own doc comment. This is that adapter.
 */
export function ordersAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'orders',
    owners: ['orders'],
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

    async exportRows(): Promise<string[][]> {
      const orders = await ports.orders.listAll();
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
}
