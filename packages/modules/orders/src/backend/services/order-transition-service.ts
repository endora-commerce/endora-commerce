import { randomUUID } from 'crypto';
import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import {
  rethrowIfModuleDisabled,
  type AuditPort,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import { effectsOwedByStatusTransition } from '../domain/transition-effects.js';
import { Order } from '../entities/order.entity.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import type { OrderTransitionEffectService } from './order-transition-effect-service.js';
import {
  emitOrderStatusAfter,
  orderStatusBeforeEventNames,
  OrderTransitionVetoError,
  type OrderStatusActor,
  type OrderStatusEvent,
} from '../events/order-status-events.js';

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

/** A registered guard fires before a matching transition and may veto it. */
type TransitionGuard = (e: OrderStatusEvent) => void | Promise<void>;
interface GuardEntry {
  match: { from?: string; to?: string };
  guard: TransitionGuard;
}

/**
 * How often `apply` re-evaluates a transition whose order moved underneath it
 * between the read and the locked write. Once: a second concurrent mover in
 * the same instant is refused rather than chased.
 */
const MAX_REEVALUATIONS = 1;

/**
 * OrderTransitionService — feature 038 (US1, T024);
 * `specs/142-order-transition-atomicity/` (D5, D7).
 *
 * Applies a status transition against the configurable graph and emits the four
 * templated business events (FR-007). The two `.before` events are dispatched
 * synchronously through a dedicated guard registry that propagates a thrown
 * `OrderTransitionVetoError` to abort the transition (FR-008) — the shared
 * EventBus isolates handler errors and cannot express a veto. The two `.after`
 * events are emitted on the EventBus once the status write has committed;
 * handler failures there are isolated and never roll the transition back.
 *
 * **What a transition owes is written with it.** The new status, its audit
 * entry and one row per follow-up the transition owes — the stock release and
 * the credit release of a cancellation — commit in one transaction, with the
 * order row locked. The follow-ups are then attempted at once, in this call,
 * and whatever does not complete stays recorded and is retried by the sweep.
 * So nothing after the commit can refuse the transition any more: every
 * refusal — an unknown status, a missing edge, a terminal source, a guard's
 * veto — happens before anything is written, and once the status is committed
 * the caller is told it was applied.
 *
 * That is what the side-effects hook this replaces could not do. It ran after
 * the flush and could throw, which left a status committed, a caller told the
 * transition had failed, the `.after` events never emitted and — because
 * repeating a transition to the status an order already has is a no-op — a
 * release that nothing would ever run.
 */
export class OrderTransitionService {
  private readonly guards: GuardEntry[] = [];

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: EventBus,
    private readonly graphService: OrderStatusGraphService,
    /**
     * Records and runs the follow-ups a transition owes.
     *
     * Optional only so that a transition engine can be built over a graph alone
     * — and it fails closed rather than open: a transition that **owes** a
     * follow-up is refused, before anything is written, when there is nowhere
     * to record it. An omitted collaborator that silently dropped the stock and
     * credit release of a cancellation is the defect this parameter exists to
     * remove.
     */
    private readonly effects?: OrderTransitionEffectService,
    /**
     * Feature 054 — the status write is audited co-transactionally (one entry
     * per applied transition, `stateBefore`/`stateAfter` = {status}). Recorded
     * on the same transaction as the status; the event orchestration around it
     * is unchanged (before-guards, before/after bus emits keep their ordering),
     * so this does not route through the Command Bus's own scope.
     */
    private readonly auditLog?: AuditPort,
    private readonly log?: PlatformLogger,
  ) {}

  /**
   * Register a before-transition guard. `match` narrows by from/to status code
   * (omit a field to match any). The guard may throw `OrderTransitionVetoError`
   * to abort. Returns an unsubscribe function.
   */
  onOrderTransitionGuard(match: { from?: string; to?: string }, guard: TransitionGuard): () => void {
    const entry: GuardEntry = { match, guard };
    this.guards.push(entry);
    return () => {
      const idx = this.guards.indexOf(entry);
      if (idx >= 0) this.guards.splice(idx, 1);
    };
  }

  /**
   * Transition `orderId` to status code `to`. Throws 404 if the order is
   * missing, 409 if the transition is not permitted by the graph (no edge or a
   * terminal source), and 409 if a guard vetoes it. Every one of those is
   * decided before anything is written.
   *
   * Two concurrent transitions of one order serialise on the order row: the
   * second finds the status moved, abandons its write, and is evaluated again
   * as a fresh call would be — which for the same target answers the order
   * unchanged, exactly as a repeat does.
   */
  async apply(
    orderId: string,
    to: string,
    actor: OrderStatusActor,
    reason?: string | null,
  ): Promise<Order> {
    for (let evaluation = 0; ; evaluation += 1) {
      const em = this.emFactory();
      const order = await em.findOne(Order, { id: orderId });
      if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

      const from = order.status;
      if (from === to) return order;

      const graph = await this.graphService.loadGraph();
      if (!graph.has(to)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Unknown order status "${to}".`);
      }
      if (!graph.canTransition(from, to)) {
        throw new HttpError(
          409,
          ERROR_CODES.INVALID_TRANSITION,
          `Cannot transition from "${from}" to "${to}".`,
        );
      }

      const event: OrderStatusEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        orderId: order.id,
        organizationId: order.organizationId,
        salesChannelId: order.salesChannelId,
        from,
        to,
        actor,
        reason: reason ?? null,
      };

      // --- before: veto-capable guard dispatch (synchronous, in-flight) ------
      await this.runBeforeGuards(event);
      // Mirror the before-event names onto the bus for passive (non-veto) observers.
      for (const name of orderStatusBeforeEventNames(from, to)) {
        this.events.emit(name, event);
      }

      // --- apply: status, audit entry and what the status owes, together -----
      const applied = await em.transactional(async (tx) => {
        // The row lock is what makes "at most one outstanding follow-up per
        // order and effect" a rule this code keeps rather than a constraint it
        // trips. `refresh` because the entity is already in the identity map:
        // without it the lock would be taken and the stale status kept.
        const locked = await tx.findOne(
          Order,
          { id: orderId },
          { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
        );
        if (!locked) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');
        // Somebody moved the order between the read above and this lock.
        // Nothing has been written; the caller re-evaluates from the top.
        if (locked.status !== from) return null;

        const owed = effectsOwedByStatusTransition(locked, to);
        if (owed.length > 0 && !this.effects) {
          throw new Error(
            `OrderTransitionService: the transition to "${to}" owes ${owed
              .map((o) => o.effect)
              .join(' and ')}, and no effect service was supplied to record it. ` +
              'Refusing rather than committing a status whose follow-up would be lost.',
          );
        }

        locked.status = to;
        if (this.auditLog) {
          this.auditLog.recordWithin(tx, {
            action: ORDER_STATUS_TRANSITION_ACTION,
            objectType: 'order',
            objectId: locked.id,
            actorAdminUserId: actor.kind === 'admin' ? (actor.adminUserId ?? null) : null,
            impersonatedCustomerAccountId:
              actor.kind === 'customer' ? (actor.customerAccountId ?? null) : null,
            stateBefore: { status: from },
            stateAfter: { status: to },
          });
        }
        if (this.effects && owed.length > 0) {
          await this.effects.record(tx, locked, owed, 'transition');
        }
        return locked;
      });

      if (applied === null) {
        if (evaluation < MAX_REEVALUATIONS) continue;
        throw new HttpError(
          409,
          ERROR_CODES.INVALID_TRANSITION,
          'The order changed status while this transition was being applied. Retry.',
        );
      }

      // --- after the commit: run what is owed, then announce -----------------
      //
      // The announcement is in a `finally`: invoicing, webhooks and push
      // subscribe to it, and it used to be suppressed whenever a release threw.
      // The order — run the follow-ups, then announce — is kept, so a
      // subscriber that reads stock in its handler sees what it always saw.
      try {
        await this.drainAfterCommit(applied.id);
      } finally {
        emitOrderStatusAfter(this.events, {
          orderId: applied.id,
          organizationId: applied.organizationId,
          salesChannelId: applied.salesChannelId,
          from,
          to,
          actor,
          reason: reason ?? null,
          // Feature 062 — webhook receivers get the human-readable order number.
          businessId: applied.businessId,
        });
      }

      return applied;
    }
  }

  /**
   * The immediate attempt at what the committed transition owes.
   *
   * A follow-up that fails or waits is a value inside the drain, not a throw.
   * What can still be thrown out of it is the drain itself failing — the
   * database refusing the claim — and that is tolerated here on purpose: the
   * status is committed and its follow-ups are recorded, so the truthful
   * answer to the caller is "applied", and the sweep runs what this attempt
   * could not. The one thing not tolerated is a module switched off in the
   * instant between a handler's presence answer and its port call: that is a
   * statement about the platform, never swallowed, and it surfaces as the 503
   * it is — with nothing stranded, because the row is recorded and the next
   * sweep finds it waiting on its owner.
   */
  private async drainAfterCommit(orderId: string): Promise<void> {
    if (!this.effects) return;
    try {
      await this.effects.drainForOrder(orderId);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      this.log?.warn(
        { orderId, error: error instanceof Error ? error.message : String(error) },
        'orders: the immediate attempt at an order transition`s follow-ups failed; the sweep retries them',
      );
    }
  }

  private async runBeforeGuards(event: OrderStatusEvent): Promise<void> {
    for (const entry of this.guards) {
      if (entry.match.from !== undefined && entry.match.from !== event.from) continue;
      if (entry.match.to !== undefined && entry.match.to !== event.to) continue;
      try {
        await entry.guard(event);
      } catch (err) {
        if (err instanceof OrderTransitionVetoError) {
          throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, err.message);
        }
        throw err;
      }
    }
  }
}
