import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Order } from '../entities/order.entity.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import {
  emitOrderStatusAfter,
  orderStatusBeforeEventNames,
  OrderTransitionVetoError,
  type OrderStatusActor,
  type OrderStatusEvent,
} from '../events/order-status-events.js';

/** A registered guard fires before a matching transition and may veto it. */
type TransitionGuard = (e: OrderStatusEvent) => void | Promise<void>;
interface GuardEntry {
  match: { from?: string; to?: string };
  guard: TransitionGuard;
}

/** Side-effects applied within the transition (e.g. release stock on cancel). */
export type OrderTransitionSideEffects = (e: {
  order: Order;
  from: string;
  to: string;
}) => Promise<void>;

/**
 * OrderTransitionService — feature 038 (US1, T024).
 *
 * Applies a status transition against the configurable graph and emits the four
 * templated business events (FR-007). The two `.before` events are dispatched
 * synchronously through a dedicated guard registry that propagates a thrown
 * `OrderTransitionVetoError` to abort the transition (FR-008) — the shared
 * EventBus isolates handler errors and cannot express a veto. The two `.after`
 * events are emitted on the EventBus once the status write has flushed; handler
 * failures there are isolated and never roll the transition back.
 */
export class OrderTransitionService {
  private readonly guards: GuardEntry[] = [];

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: EventBus,
    private readonly graphService: OrderStatusGraphService,
    private readonly sideEffects?: OrderTransitionSideEffects,
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
   * terminal source), and 409 if a guard vetoes it.
   */
  async apply(
    orderId: string,
    to: string,
    actor: OrderStatusActor,
    reason?: string | null,
  ): Promise<Order> {
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

    // --- before: veto-capable guard dispatch (synchronous, in-flight) --------
    await this.runBeforeGuards(event);
    // Mirror the before-event names onto the bus for passive (non-veto) observers.
    for (const name of orderStatusBeforeEventNames(from, to)) {
      this.events.emit(name, event);
    }

    // --- apply ---------------------------------------------------------------
    order.status = to;
    await em.flush();
    if (this.sideEffects) await this.sideEffects({ order, from, to });

    // --- after: fire-and-forget on the bus (isolated) ------------------------
    emitOrderStatusAfter(this.events, {
      orderId: order.id,
      organizationId: order.organizationId,
      salesChannelId: order.salesChannelId,
      from,
      to,
      actor,
      reason: reason ?? null,
    });

    return order;
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
