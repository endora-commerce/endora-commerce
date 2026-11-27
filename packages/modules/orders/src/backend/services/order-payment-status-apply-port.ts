import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { OrderPaymentStatus } from '@endora-commerce/contracts';
import { Order } from '../entities/order.entity.js';
import type {
  OrderPaymentStatusApplied,
  OrderPaymentStatusApplyPort,
} from '../../ports/index.js';
import { isUuidShape } from '@endora-commerce/contracts';
import { decidePaymentStatusChange } from '../domain/payment-status-transition.js';
import { effectsOwedByPaymentStatusChange } from '../domain/transition-effects.js';
import type { OrderTransitionEffectService } from './order-transition-effect-service.js';

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
 * for goes through `orderCommandPort` after the commit, and that port
 * records the `order.status_transition` entry co-transactionally with the
 * status it writes. The admin-driven twin of this write —
 * `OrderService.transitionPaymentStatus` — does audit, because there an
 * operator decided; here a provider callback did, and the settlement's own
 * `command-coverage-ignore` marker in `receive-payment-handler.ts` states that
 * reasoning in full.
 */
export class OrderPaymentStatusApplyService implements OrderPaymentStatusApplyPort {
  constructor(private readonly transitionEffects: OrderTransitionEffectService) {}

  async applyPaymentStatus(
    em: EntityManager,
    input: { orderId: string; paymentStatus: OrderPaymentStatus },
  ): Promise<OrderPaymentStatusApplied | null> {
    if (!isUuidShape(input.orderId)) return null;
    // Decide on the refreshed, locked row, as the admin payment-status path does.
    const order = await em.findOne(
      Order,
      { id: input.orderId },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    if (!order) return null;
    // Issue #1574 — settlement respects the money axis's graph. A refused move
    // is answered, not thrown, so the caller's settlement transaction still
    // commits the payment row it is recording.
    const decision = decidePaymentStatusChange(order.paymentStatus, input.paymentStatus, 'settlement');
    const outcome = decision.kind === 'apply' ? 'applied' : decision.kind;
    let owesEffects = false;
    if (outcome === 'applied') {
      order.paymentStatus = input.paymentStatus;
      const owed = effectsOwedByPaymentStatusChange(order, input.paymentStatus);
      if (owed.length > 0) {
        await this.transitionEffects.record(em, order, owed, 'transition');
        owesEffects = true;
      }
    }
    // A published record, never the managed entity (D-77's first narrowing).
    // Handing `payments` the live `Order` would hand it the ability to move any
    // column of this module's aggregate on a transaction it happens to hold,
    // which is precisely what this conversion removes.
    return {
      orderId: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      outcome,
      owesEffects,
    };
  }
}
