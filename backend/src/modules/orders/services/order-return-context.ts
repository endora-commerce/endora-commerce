import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import type {
  OrderReturnContext,
  OrderReturnContextPort,
} from '../../returns/ports/order-return-context.port.js';

/**
 * Orders-side implementation of the returns module's `OrderReturnContextPort`
 * (feature 046, R4). Exposes the order facts the returns module needs through a
 * single documented interface, so the returns module never reads `orders` tables
 * directly.
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
    const items = await em.find(OrderItem, { orderId });

    const completing = order.status === COMPLETING_STATUS;
    const lines = items.map((it) => {
      const unitPaid = round2(Number(it.unitPrice) * (1 + Number(it.taxRate)));
      return {
        orderItemId: it.id,
        productId: it.productId,
        name: it.productSnapshot.name,
        purchasedQty: it.quantity,
        paidUnitAmount: unitPaid,
        paidLineAmount: round2(unitPaid * it.quantity),
      };
    });

    return {
      salesChannelId: order.salesChannelId,
      customerAccountId: order.placedByCustomerAccountId,
      organizationId: order.organizationId ?? null,
      currency: order.currency,
      completingStatusEnteredAt: completing ? order.updatedAt : null,
      lines,
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
