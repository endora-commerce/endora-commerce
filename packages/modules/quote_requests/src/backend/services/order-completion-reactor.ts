import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';

export interface OrderCompletionReactorDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 075, Phase C — the order row the event names, read over `orders`'
   * published port instead of `em.findOne(Order, …)` against its table.
   * Deactivation drops no tables, so the reactor kept completing quote requests
   * from a module an operator had switched off; over the port the read fails
   * closed, and `orders` is a binding dependency of this manifest.
   */
  orders: OrderReadPort;
  eventService: RfqEventService;
  notificationService: RfqNotificationService;
  /**
   * Runs `work` off the bus's dispatch chain, in a scope of its own, and never
   * rejects. Supplied by the composition; see {@link COMMIT_WAIT_PAUSES}.
   */
  defer: (work: () => Promise<void>) => Promise<void>;
  /** Whether this module is still present — asked before every deferred read. */
  stillPresent: () => boolean;
  /** Injected so a test does not wait; `setTimeout` in the composed module. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * How long the reactor looks for an order its event has announced: the pauses
 * between reads, in milliseconds — a little over two seconds in all.
 *
 * `orders` announces `order.created.v1` from **inside** the transaction that
 * places the order, and the bus runs a handler at once, so a read on a
 * connection of its own races the commit: measured through the storefront
 * route, the first placement of a process is not found and is found
 * milliseconds later (`specs/143-crm-sales-opportunities/research.md`, N-E7 and
 * N-QS3). While nothing wrote `orders.source_quote_request_id` the lost race
 * cost nothing, because there was never a request to complete. Now there is,
 * and an order read once and not found would leave its request `Approved` —
 * convertible a second time — for ever.
 *
 * The same pauses `crm` uses for the same event, and for the same reason not
 * awaited on the bus: `EventBus.dispatch` runs subscribers one after another,
 * so a handler that slept here would hold every later subscriber for as long.
 * An order still missing after the last pause was rolled back.
 */
const COMMIT_WAIT_PAUSES = [10, 25, 75, 150, 250, 500, 1000] as const;

/**
 * US5 — when an order is created carrying `sourceQuoteRequestId`, flip the
 * originating RFQ to Completed and notify both parties (FR-007 + FR-028).
 *
 * The order-creation flow lives in `orders`, so this observes `order.created.v1`
 * rather than coupling the two modules. The **subscription** lives in this
 * module's `backend.ts` and goes through `ctx.subscribe` (issue #107): it was a
 * bare `eventBus.on` in the plugin body, which meant a switched-off
 * `quote_requests` still completed quote requests, appended an event row and
 * enqueued a customer notification.
 */
export function createOrderCompletionReactor(deps: OrderCompletionReactorDeps): {
  onOrderCreated: (payload: unknown) => Promise<void>;
  /** Resolves once no deferred look is still running — for a test, or a shutdown, to wait on. */
  idle: () => Promise<void>;
} {
  const deferred = new Set<Promise<void>>();
  const sleep =
    deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const complete = async (order: OrderRecord): Promise<void> => {
    // command-coverage-ignore: **this marker is new; the write is not.** It
    // appears only because issue #107 lifted this handler out of a plugin-body
    // closure, where `check-command-coverage` could not see it — the same
    // completion has been written on every quote-to-order conversion since
    // US5. Read it as a write becoming visible, not as a new unaudited one.
    //
    // The disposition: a system reaction to an already-committed order, not an
    // operator-initiated write. The placement that emits the event runs
    // through the Command Bus, and the completion is appended to the RFQ's own
    // event timeline below with `actor: System`, which is this module's audit
    // trail — the same reasoning as its four sibling markers
    // (`rfq-expiry-worker`, `rfq-event-service`, `rfq-revision-service`,
    // `rfq-notification-service`).
    if (!order.sourceQuoteRequestId) return;
    const em = deps.emFactory();
    const rfq = await em.findOne(QuoteRequest, { id: order.sourceQuoteRequestId });
    if (!rfq || rfq.status === 'Completed') return;
    // Constitution XI. `orders` vouches for the source before it stamps it, and
    // this is the same question asked by the module that owns the answer: an
    // order of one Organization never completes a request of another, whoever
    // wrote the column.
    if (rfq.organizationId !== order.organizationId) return;
    rfq.status = 'Completed';
    rfq.completedAt = new Date();
    rfq.convertedOrderId = order.id;
    rfq.version += 1;
    await em.flush();
    const evt = await deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'completed',
      actor: { roleLabel: 'System' },
      payload: { type: 'completed', orderId: order.id },
    });
    await deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });
  };

  return {
    async onOrderCreated(payload: unknown): Promise<void> {
      const orderId = (payload as { orderId: string }).orderId;
      const order = await deps.orders.findById(orderId);
      if (order) {
        await complete(order);
        return;
      }
      // Not readable yet: its commit may still be in flight. Look again off
      // the dispatch chain, and answer the bus now.
      const looking = deps.defer(async () => {
        for (const pause of COMMIT_WAIT_PAUSES) {
          await sleep(pause);
          // Off behaves as if never installed: nothing is read, nothing completed.
          if (!deps.stillPresent()) return;
          const found = await deps.orders.findById(orderId);
          if (found) {
            await complete(found);
            return;
          }
        }
      });
      deferred.add(looking);
      void looking.then(() => deferred.delete(looking));
    },
    async idle(): Promise<void> {
      while (deferred.size > 0) await Promise.all([...deferred]);
    },
  };
}
