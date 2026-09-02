import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OrderStatusActor,
  type OrderTransitionOutcome,
  type OrderTransitionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { Order } from '../entities/order.entity.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import type { OrderTransitionService } from './order-transition-service.js';

/**
 * The lifecycle write `orders` publishes (feature 085, Phase B).
 *
 * `OrderTransitionService` is the seam itself; this is the shape it is
 * published in — no `Order` entity, no `EntityManager`, no `EventBus`, and a
 * refusal expressed as a value. The two settlement handlers that will call it
 * are answering a payment service provider, so a thrown refusal would become a
 * non-2xx callback the PSP retries forever.
 *
 * **The graph is consulted before `apply`, not after it.** `apply` raises one
 * 409 `INVALID_TRANSITION` for a missing edge and another for a vetoed
 * transition, so the two are indistinguishable once thrown — a port that only
 * translated exceptions would have to report both as the same thing. Deciding
 * `unknown_status` and `not_permitted` against the graph up front leaves the
 * `catch` with exactly one meaning left.
 */
export class OrderTransitionPortService implements OrderTransitionPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Both services are built in the plugin body, so these are resolved per
     * call rather than captured: before route registration there is genuinely
     * nothing to call, and the accessors answer that with a 503.
     *
     * Named for what they hand back rather than `transitionService` /
     * `graphService` — a choice this file makes on its own merits now. It
     * used to be forced: `check:port-catches` aliased a constructor argument
     * by its parameter name across the whole owning module, so `transitionService`
     * here made an unrelated local of that spelling in `prompt-tools.ts` read
     * as this port. Issue #278 scoped a parameter alias to the file that
     * declares it, which is where the binding actually is, so a generic name
     * costs nothing any more. Do not re-derive that constraint from this
     * comment; it is history.
     */
    private readonly orderTransitions: () => OrderTransitionService,
    private readonly orderStatusGraph: () => OrderStatusGraphService,
  ) {}

  async applyStatus(input: {
    orderId: string;
    to: string;
    actor: OrderStatusActor;
    reason?: string | null;
  }): Promise<OrderTransitionOutcome> {
    const { orderId, to, actor } = input;
    const reason = input.reason ?? null;

    const order = await this.emFactory().findOne(Order, { id: orderId });
    if (!order) {
      return {
        applied: false,
        reason: 'not_found',
        from: null,
        detail: `No order ${orderId}.`,
      };
    }

    // Read before the write: `apply` returns the order it has already moved,
    // so `from` is only knowable here.
    const from = order.status;
    if (from === to) return { applied: false, reason: 'already_there', from };

    const graph = await this.orderStatusGraph().loadGraph();
    if (!graph.has(to)) {
      return {
        applied: false,
        reason: 'unknown_status',
        from,
        detail: `"${to}" is not a configured order status.`,
      };
    }
    if (!graph.canTransition(from, to)) {
      return {
        applied: false,
        reason: 'not_permitted',
        from,
        detail: graph.isTerminal(from)
          ? `"${from}" is terminal, so no transition can leave it.`
          : `The configured lifecycle has no edge from "${from}" to "${to}".`,
      };
    }

    try {
      await this.orderTransitions().apply(orderId, to, actor, reason);
    } catch (error) {
      // The narrow tolerance this port exists for, and the only one: with the
      // graph already consulted above, a 409 left here is a before-guard's
      // veto — a decision some other module made about this order, which the
      // caller must be able to see and report to its provider as a success.
      // `rethrowIfModuleDisabled` comes first because `ModuleDisabledError` is
      // itself an `HttpError`: a module switched off underneath the guards is
      // not a veto, and swallowing it would turn fail-closed into fail-open.
      rethrowIfModuleDisabled(error);
      if (error instanceof HttpError && error.code === ERROR_CODES.INVALID_TRANSITION) {
        return { applied: false, reason: 'vetoed', from, detail: error.message };
      }
      throw error;
    }

    return { applied: true, from, to };
  }

  async isTerminal(orderId: string): Promise<boolean | null> {
    const order = await this.emFactory().findOne(Order, { id: orderId });
    if (!order) return null;
    // Asked of the graph, never of a status code this file recognises: the set
    // is operator-configurable and a deployment may add terminal statuses of
    // its own.
    return (await this.orderStatusGraph().loadGraph()).isTerminal(order.status);
  }
}
