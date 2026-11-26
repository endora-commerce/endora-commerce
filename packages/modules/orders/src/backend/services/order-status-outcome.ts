import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isUuidShape,
  type OrderStatusActor,
  type OrderTransitionOutcome,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import type { CallerOptions } from '../commands/caller-options.js';
import { Order } from '../entities/order.entity.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import type { OrderTransitionService } from './order-transition-service.js';

/**
 * A status change answered as an {@link OrderTransitionOutcome} rather than
 * thrown — the shape `orderCommandPort.applyStatus` publishes (and the
 * deprecated `orderTransitionPort.applyStatus` before it), and the one the
 * buyer's own cancellation reads (feature 085; `specs/186-aggregate-ports/` US4).
 *
 * Module-internal, so the buyer's cancellation — a customer-session route,
 * which never resolves the aggregate port (research R-7, R-17.5) — runs the
 * same Command by the same path as the port without going through it.
 *
 * **The graph is consulted before `apply`, not after it.** `apply` raises one
 * 409 `INVALID_TRANSITION` for a missing edge and another for a vetoed
 * transition, so the two are indistinguishable once thrown — deciding
 * `unknown_status` and `not_permitted` against the graph up front leaves the
 * `catch` with exactly one meaning left: a before-guard's veto. Every refusal
 * is decided before anything is written, so a refusal writes and audits
 * nothing, and `already_there` records nothing either.
 */
export interface OrderStatusOutcomeDeps {
  readonly emFactory: () => EntityManager;
  readonly transitions: () => Pick<OrderTransitionService, 'apply'>;
  readonly graph: () => Pick<OrderStatusGraphService, 'loadGraph'>;
}

export async function applyStatusAsOutcome(
  deps: OrderStatusOutcomeDeps,
  input: {
    orderId: string;
    to: string;
    actor: OrderStatusActor;
    reason: string | null;
    caller?: CallerOptions;
  },
): Promise<OrderTransitionOutcome> {
  const { orderId, to, actor, reason } = input;
  const notFound: OrderTransitionOutcome = {
    applied: false,
    reason: 'not_found',
    from: null,
    detail: `No order ${orderId}.`,
  };
  if (!isUuidShape(orderId)) return notFound;
  const order = await deps.emFactory().findOne(Order, { id: orderId });
  if (!order) return notFound;

  // Read before the write: `apply` returns the order it has already moved,
  // so `from` is only knowable here.
  const from = order.status;
  if (from === to) return { applied: false, reason: 'already_there', from };

  const graph = await deps.graph().loadGraph();
  if (!graph.has(to)) {
    return { applied: false, reason: 'unknown_status', from, detail: `"${to}" is not a configured order status.` };
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
    await deps.transitions().apply(orderId, to, actor, reason, input.caller ?? {});
  } catch (error) {
    // The narrow tolerance this shape exists for, and the only one: with the
    // graph already consulted above, a 409 left here is a before-guard's veto
    // — a decision some other module made about this order, which the caller
    // must be able to see and report to its provider as a success.
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

/** The `source` codes {@link OrderStatusActor} can carry on the status events. */
const EVENT_SOURCES: ReadonlySet<string> = new Set(['payment', 'shipment', 'reorder', 'checkout']);

/**
 * The actor the `order.status.*` events carry for a port call, derived from
 * the ambient TenantContext — never from input (Principle XIII): an
 * administrator (also one acting through `withSystemScopeActingFor`) is
 * `admin`, a customer `customer`, anything else `system` with the caller's
 * `source` when it is one the event vocabulary names.
 */
export function ambientOrderStatusActor(source: string | undefined): OrderStatusActor {
  const ctx = getTenantContext();
  if (ctx?.impersonation) {
    return { kind: 'customer', customerAccountId: ctx.impersonation.impersonatedCustomerAccountId };
  }
  if (ctx?.actor.kind === 'admin' && ctx.actor.id) return { kind: 'admin', adminUserId: ctx.actor.id };
  if (ctx?.actor.kind === 'customer') {
    const customerAccountId = ctx.actor.id ?? ctx.customerAccountId;
    return customerAccountId ? { kind: 'customer', customerAccountId } : { kind: 'customer' };
  }
  return source !== undefined && EVENT_SOURCES.has(source)
    ? { kind: 'system', source: source as NonNullable<OrderStatusActor['source']> }
    : { kind: 'system' };
}
