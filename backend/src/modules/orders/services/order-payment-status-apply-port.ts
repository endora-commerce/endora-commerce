import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderPaymentStatus } from '@endora-commerce/contracts';
import { Order } from '../entities/order.entity.js';
import type {
  OrderPaymentStatusApplied,
  OrderPaymentStatusApplyPort,
} from '../ports/index.js';

/**
 * `orderPaymentStatusApplyPort` — the money axis of an order, written on the
 * caller's `EntityManager` (feature 080, T048; D-169).
 *
 * `payments` used to hold `Order` itself and write `order.paymentStatus` on its
 * own settlement transaction. That is the coupling D-168 leaves no supported
 * spelling for once `orders` is a package, and the reason it stood is stated in
 * this module's `ports/index.ts`: `payments_order_fk` holds the payment row and
 * this column together, so the write has to happen inside the settlement
 * transaction and a port opening its own could only commit half of it.
 *
 * What changed is who owns the statement. What did not change is the
 * transaction it runs in: the `EntityManager` is the caller's, required rather
 * than optional, and this file writes no other column.
 *
 * **No audit entry here, deliberately.** The lifecycle move a settlement asks
 * for goes through `orderTransitionPort` after the commit, and that port
 * records the `order.status_transition` entry co-transactionally with the
 * status it writes. The admin-driven twin of this write —
 * `OrderService.transitionPaymentStatus` — does audit, because there an
 * operator decided; here a provider callback did, and the settlement's own
 * `command-coverage-ignore` marker in `receive-payment-handler.ts` states that
 * reasoning in full.
 */
export class OrderPaymentStatusApplyService implements OrderPaymentStatusApplyPort {
  async applyPaymentStatus(
    em: EntityManager,
    input: { orderId: string; paymentStatus: OrderPaymentStatus },
  ): Promise<OrderPaymentStatusApplied | null> {
    const order = await em.findOne(Order, { id: input.orderId });
    if (!order) return null;
    order.paymentStatus = input.paymentStatus;
    // A published record, never the managed entity (D-77's first narrowing).
    // Handing `payments` the live `Order` would hand it the ability to move any
    // column of this module's aggregate on a transaction it happens to hold,
    // which is precisely what this conversion removes.
    return {
      orderId: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
    };
  }
}
