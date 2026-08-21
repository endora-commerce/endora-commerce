import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  ORDER_STATUS_CANCELLED,
  type OrderTransitionPort,
  type PaymentMethodReadPort,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Order } from '../entities/order.entity.js';
import { isBuyerCancellable } from '../domain/customer-cancellation.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';

export interface CustomerOrderCancellationDeps {
  emFactory: () => EntityManager;
  /**
   * The lifecycle write, as this module publishes it. Cancelling through the
   * seam is the whole point: the transition's side-effects hook releases the
   * stock allocations and frees the credit-limit reservation, and the audit
   * entry is written co-transactionally with the status. A cancellation that
   * assigned `order.status` would do none of that — which is the defect
   * feature 085 Phase D removed from the settlement path, and this is its first
   * customer-facing caller.
   */
  transitions: OrderTransitionPort;
  /** The configured graph, for the initial status the predicate compares to. */
  graphService: OrderStatusGraphService;
  /**
   * The payment-method catalogue, for the method's configured
   * `statusOnFailure`. An accessor because `payment_methods` is deactivatable
   * and this module declares the edge `degrades-without`: `null` means the
   * failure status cannot be read, and the predicate then rests on the initial
   * status alone (see `shopHasNotStarted`).
   */
  paymentMethodRead: () => PaymentMethodReadPort | null;
}

/**
 * A buyer cancelling an order they placed (feature 085 Phase F, User Story 3).
 *
 * The owner ruled that a customer may cancel only an unpaid order — *"beyond
 * that the order is being processed and only a platform administrator may
 * cancel it"* — and that the customer **cancels**: there is no approval step,
 * no pending-cancellation state and no staff queue.
 *
 * Ownership is a **scoped find**, mirroring `ReturnCaseService.cancelByCustomer`:
 * a foreign order id answers 404 rather than 403, so the route does not
 * disclose that somebody else's order exists (FR-016). It is scoped to the
 * placing account and not to the Organization — an Organization Admin may
 * *read* a colleague's order and may not cancel it — which follows the two
 * customer-facing surfaces that already scope this way, the return withdrawal
 * and the payment retry. That narrowing is one predicate term if it is ever
 * widened, and is recorded in the spec's Assumptions so it is visible rather
 * than accidental.
 */
export class CustomerOrderCancellationService {
  constructor(private readonly deps: CustomerOrderCancellationDeps) {}

  /**
   * Cancel `orderId` on behalf of the account that placed it.
   *
   * @throws 404 when there is no such order **for this buyer**.
   * @throws 409 when the platform would not accept the cancellation — the money
   *         is not the buyer's to owe any more, or the shop has started.
   */
  async cancelByCustomer(orderId: string, customerAccountId: string): Promise<Order> {
    const em = this.deps.emFactory();
    const order = await em.findOne(Order, { id: orderId, placedByCustomerAccountId: customerAccountId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

    // Cancelling an order the buyer already cancelled changes nothing and says
    // nothing about a failure (US3 scenario 6). Checked before the predicate,
    // which refuses a cancelled order — correctly, since `cancelled` is neither
    // the initial status nor a failure status — and would otherwise turn the
    // buyer's second click into an error about their own first one.
    if (order.status === ORDER_STATUS_CANCELLED) return order;

    if (!(await this.isCancellableByCustomer(order, customerAccountId))) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'This order can no longer be cancelled here. Please contact us and we will help.',
      );
    }

    const outcome = await this.deps.transitions.applyStatus({
      orderId: order.id,
      to: ORDER_STATUS_CANCELLED,
      actor: { kind: 'customer', customerAccountId },
      reason: 'Cancelled by the customer.',
    });
    if (!outcome.applied && outcome.reason !== 'already_there') {
      // The predicate passed and the graph refused anyway: a configured edge
      // was removed, or a guard another module registered vetoed this order.
      // Reported rather than swallowed — the buyer is told the shop has to do
      // it, which is true.
      throw new HttpError(
        409,
        ERROR_CODES.INVALID_TRANSITION,
        'This order could not be cancelled. Please contact us and we will help.',
      );
    }

    // The seam holds its own EntityManager, so the instance read above is stale
    // by exactly the column the call moved.
    return this.deps.emFactory().findOneOrFail(Order, { id: order.id }, { refresh: true });
  }

  /**
   * Whether `customerAccountId` may cancel `order` — the capability the buyer's
   * surface renders its control from (FR-018).
   *
   * The ownership term is part of the answer, not a precondition of asking: a
   * colleague reading a peer's order must be told `false` rather than shown a
   * control the server will 404.
   */
  async isCancellableByCustomer(order: Order, customerAccountId: string): Promise<boolean> {
    return (await this.cancellableOrderIds([order], customerAccountId)).has(order.id);
  }

  /**
   * The same answer for a page of orders, with one catalogue read for all of
   * them. The graph is cached in-process; the method rows are fetched by id in
   * one call rather than per row.
   */
  async cancellableOrderIds(orders: Order[], customerAccountId: string): Promise<Set<string>> {
    const own = orders.filter((o) => o.placedByCustomerAccountId === customerAccountId);
    if (own.length === 0) return new Set();

    const graph = await this.deps.graphService.loadGraph();
    const initialStatusCode = graph.initialCode();

    const methodRead = this.deps.paymentMethodRead();
    const failureStatusById = new Map<string, string>();
    if (methodRead) {
      const methods = await methodRead.findByIds([...new Set(own.map((o) => o.paymentMethodId))]);
      for (const m of methods) failureStatusById.set(m.id, m.statusOnFailure);
    }

    const cancellable = new Set<string>();
    for (const order of own) {
      const permitted = isBuyerCancellable({
        paymentStatus: order.paymentStatus,
        status: order.status,
        initialStatusCode,
        statusOnFailure: failureStatusById.get(order.paymentMethodId) ?? null,
      });
      // The graph has the last word on whether the move is possible at all, so
      // the control is never offered for an order the seam would refuse. The
      // universal `→ cancelled` edges make this true for every non-terminal
      // status in the shipped graph; an operator who removes one gets a
      // consistent answer rather than a control that errors.
      if (permitted && graph.canTransition(order.status, ORDER_STATUS_CANCELLED)) {
        cancellable.add(order.id);
      }
    }
    return cancellable;
  }
}
