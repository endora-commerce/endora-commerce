import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Payment } from '../entities/payment.entity.js';
import type { PaymentOpened, PaymentPlacementApplyPort } from '@endora-commerce/mod-orders/ports';

/**
 * `paymentPlacementApplyPort` — the payment row an order is placed with,
 * written on the caller's `EntityManager` (feature 080, T048; D-169, D-179).
 *
 * `orders` held this module's `Payment` class for it until T048 and did the
 * `tx.create` itself — the last cross-module entity-class reach in the tree, and
 * the one thing standing between `orders` and `payments` and their packaging.
 * D-168 leaves a packaged `payments` no entity class for `orders` to name, so
 * the reach had to go before either module moves; the transaction it runs in did
 * not change, and `payments_order_fk` is untouched. The port's own doc block
 * states the constraint.
 *
 * **Every default the row carries is this module's**, and that is the second
 * thing the conversion moved. `status` (`awaiting_payment`), `attemptNo` (1) and
 * `refundedAmount` (`0`) are entity defaults `orders` inherited by constructing
 * the row; they are now inherited by the module that owns the vocabulary, which
 * is what makes `deferred` — the one value a placement ever overrides — a named
 * method below rather than a string crossing a boundary.
 */
export class PaymentPlacementApplyService implements PaymentPlacementApplyPort {
  async openForOrder(
    em: EntityManager,
    input: {
      orderId: string;
      paymentMethodId: string;
      amount: string;
      currency: string;
    },
  ): Promise<PaymentOpened> {
    // command-coverage-ignore: the payment row an audited order placement opens,
    // inside that placement's own transaction. `orders` records the placement as
    // one operation through its own Command; a second audit entry for the row it
    // opened would record the same decision twice.
    const payment = em.create(Payment, {
      orderId: input.orderId,
      paymentMethodId: input.paymentMethodId,
      amount: input.amount,
      currency: input.currency,
    });
    await em.persistAndFlush(payment);
    return recordOf(payment);
  }

  async markDeferred(
    em: EntityManager,
    input: { paymentId: string },
  ): Promise<PaymentOpened> {
    const payment = await em.findOne(Payment, { id: input.paymentId });
    if (!payment) {
      // Not a tolerance and not a degrade: the one caller opened this row on the
      // very transaction it is handing back, so an absent row means the two
      // calls are not on one unit of work — which is precisely the mistake the
      // required `EntityManager` exists to make impossible. Refuse loudly rather
      // than leave a credit-limit order recorded as awaiting a payment nobody
      // will make.
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Payment row to defer does not exist on this transaction.',
      );
    }
    payment.status = 'deferred';
    // command-coverage-ignore: the same placement operation as `openForOrder`
    // above, one branch further in — the credit-limit order whose reservation
    // this transaction has just taken. Audited once, by `orders`' own Command.
    await em.flush();
    return recordOf(payment);
  }
}

/** A published record, never the managed entity (D-77's first narrowing). */
function recordOf(payment: Payment): PaymentOpened {
  return {
    id: payment.id,
    orderId: payment.orderId,
    paymentMethodId: payment.paymentMethodId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  };
}
