import { LockMode } from '@mikro-orm/core';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ORDER_STATUS_COMPLETED } from '../domain/order-status-graph.js';
import { effectsOwedByStatusTransition } from '../domain/transition-effects.js';
import { Order } from '../entities/order.entity.js';
import type { OrderTransitionEffectService } from '../services/order-transition-effect-service.js';

/**
 * The audit action every applied status transition is recorded under.
 *
 * Exported since issue #284, which gave the entries a **reader**: the buyer's
 * cancellability predicate asks who wrote an order's current status, and a
 * reader looking for one spelling of this string while the writer used another
 * would find no history and refuse every held order — silently, and in the
 * safe direction, which is the worst way for a defect like that to fail.
 */
export const ORDER_STATUS_TRANSITION_ACTION = 'order.status_transition';

/**
 * The order moved between the transition's unlocked read and this Command's
 * row lock. Nothing was written (the bus rolls back); the caller re-evaluates
 * the transition from the top, as a fresh call would.
 */
export class OrderStatusMovedError extends Error {
  constructor(
    readonly orderId: string,
    readonly expected: string,
  ) {
    super(`Order ${orderId} left status "${expected}" while a transition was being applied.`);
    this.name = 'OrderStatusMovedError';
  }
}

export interface OrderStatusTransitionCommandDeps {
  /**
   * Records what the transition owes on the Command's transaction. Absent, a
   * transition that owes a follow-up is refused before anything is written —
   * an omitted collaborator that silently dropped the stock and credit release
   * of a cancellation is the defect `specs/142-order-transition-atomicity/`
   * removed.
   */
  readonly effects?: Pick<OrderTransitionEffectService, 'record'> | undefined;
}

export interface OrderStatusTransitionCommandInput {
  readonly orderId: string;
  /** The status the caller's unlocked read saw, and validated the edge from. */
  readonly from: string;
  readonly to: string;
}

/**
 * `order.status_transition` (`specs/186-aggregate-ports/` US4, T058) — the
 * write half of `OrderTransitionService.apply`, the one Command every status
 * change runs: the admin route, the bulk action, the assistant tool, the
 * buyer's cancellation and `orderCommandPort.applyStatus` alike.
 *
 * Validation against the graph and the before-guards run in the service
 * before this, on an unlocked read, because a veto must be decided before
 * anything is written; what this does is the locked write. The order row is
 * locked `for update` (`refresh`, so the identity map's stale status is not
 * kept), and if it has moved on since the service read it the Command throws
 * {@link OrderStatusMovedError} and the bus rolls back. Otherwise the status,
 * the `completedAt` anchor of the first `completed` (issue #905), the audit
 * entry and one row per follow-up the transition owes commit together.
 *
 * The entry is `{ status }` before and after — a code (audit-state.md list 1);
 * the caller's `reason` is free text and stays out of it.
 */
export function makeOrderStatusTransitionCommand(
  deps: OrderStatusTransitionCommandDeps,
  input: OrderStatusTransitionCommandInput,
): Command<Order> {
  const { orderId, from, to } = input;
  return {
    action: ORDER_STATUS_TRANSITION_ACTION,
    objectType: 'order',
    objectId: orderId,
    run: async ({ em }) => {
      const locked = await em.findOne(
        Order,
        { id: orderId },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      );
      if (!locked) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
      if (locked.status !== from) throw new OrderStatusMovedError(orderId, from);

      const owed = effectsOwedByStatusTransition(locked, to);
      if (owed.length > 0 && !deps.effects) {
        throw new Error(
          `OrderTransitionService: the transition to "${to}" owes ${owed
            .map((o) => o.effect)
            .join(' and ')}, and no effect service was supplied to record it. ` +
            'Refusing rather than committing a status whose follow-up would be lost.',
        );
      }

      locked.status = to;
      // Issue #905 — the first entry into `completed` is the anchor of the
      // return window and the consumer's withdrawal period. Stamped once, in
      // the transaction that writes the status, and never rewritten.
      if (to === ORDER_STATUS_COMPLETED && locked.completedAt == null) {
        locked.completedAt = new Date();
      }
      if (deps.effects && owed.length > 0) {
        await deps.effects.record(em, locked, owed, 'transition');
      }
      return { result: locked, before: { status: from }, after: { status: to } };
    },
  };
}
