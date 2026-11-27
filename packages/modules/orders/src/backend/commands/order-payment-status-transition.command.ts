import { LockMode } from '@mikro-orm/core';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { decidePaymentStatusChange } from '../domain/payment-status-transition.js';
import { effectsOwedByPaymentStatusChange } from '../domain/transition-effects.js';
import { Order } from '../entities/order.entity.js';
import type { OrderTransitionEffectService } from '../services/order-transition-effect-service.js';

/** The audit action an operator's payment-status change is recorded under. */
export const ORDER_PAYMENT_STATUS_TRANSITION_ACTION = 'order.payment_status_transition';

export interface OrderPaymentStatusTransitionCommandDeps {
  /** As on the status transition: absent, a change that owes a follow-up is refused before any write. */
  readonly effects?: Pick<OrderTransitionEffectService, 'record'> | undefined;
}

/** What the Command answers: the order, and whether a follow-up was recorded for the drain. */
export interface OrderPaymentStatusTransitionResult {
  readonly order: Order;
  readonly owes: boolean;
}

/**
 * `order.payment_status_transition` (`specs/186-aggregate-ports/` US4, T058) —
 * the operator's change of the money axis, run by
 * `POST /api/v1/admin/orders/:id/payment-status` and by
 * `orderCommandPort.applyPaymentStatus` through `OrderService.transitionPaymentStatus`.
 *
 * Decided on the **locked** row (issue #1574): an order already at the target
 * answers `skipAudit` and records nothing — not even a second `credit.release`
 * — and a move that is not one of `PAYMENT_STATUS_TRANSITIONS`' operator edges
 * is refused `409 ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED` with nothing
 * written. The new status, its entry (`{ paymentStatus }`, a code) and the
 * credit release it owes commit together; the release is attempted by the
 * caller after the commit.
 *
 * Not the settlement's write: a provider callback moves the column on its own
 * transaction through `orderPaymentStatusApplyPort`, judged for the
 * `settlement` actor, and is audited by the lifecycle move it asks for after
 * (research R-18.1).
 */
export function makeOrderPaymentStatusTransitionCommand(
  deps: OrderPaymentStatusTransitionCommandDeps,
  input: { readonly orderId: string; readonly to: 'paid' | 'refunded' },
): Command<OrderPaymentStatusTransitionResult> {
  const { orderId, to } = input;
  return {
    action: ORDER_PAYMENT_STATUS_TRANSITION_ACTION,
    objectType: 'order',
    objectId: orderId,
    run: async ({ em }) => {
      const locked = await em.findOne(
        Order,
        { id: orderId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      );
      if (!locked) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

      const paymentBefore = locked.paymentStatus;
      const decision = decidePaymentStatusChange(paymentBefore, to, 'operator');
      if (decision.kind === 'unchanged') return { result: { order: locked, owes: false }, skipAudit: true };
      if (decision.kind === 'refused') {
        throw new HttpError(
          409,
          ERROR_CODES.ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED,
          `The payment status cannot change from "${paymentBefore}" to "${to}".`,
          {
            ...(decision.token ? { code: decision.token } : {}),
            from: paymentBefore,
            to,
          },
        );
      }

      const owed = effectsOwedByPaymentStatusChange(locked, to);
      if (owed.length > 0 && !deps.effects) {
        throw new Error(
          `OrderService: marking an order "${to}" owes ${owed.map((o) => o.effect).join(' and ')}, ` +
            'and no effect service was supplied to record it. Refusing rather than committing ' +
            'a payment status whose follow-up would be lost.',
        );
      }

      locked.paymentStatus = to;
      if (deps.effects && owed.length > 0) {
        await deps.effects.record(em, locked, owed, 'transition');
      }
      return {
        result: { order: locked, owes: owed.length > 0 },
        before: { paymentStatus: paymentBefore },
        after: { paymentStatus: to },
      };
    },
  };
}
