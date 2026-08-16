import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../../orders/entities/order.entity.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';

export interface OrderCompletionReactorDeps {
  emFactory: () => EntityManager;
  eventService: RfqEventService;
  notificationService: RfqNotificationService;
}

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
} {
  return {
    async onOrderCreated(payload: unknown): Promise<void> {
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
      const em = deps.emFactory();
      const orderId = (payload as { orderId: string }).orderId;
      const order = await em.findOne(Order, { id: orderId });
      if (!order || !order.sourceQuoteRequestId) return;
      const rfq = await em.findOne(QuoteRequest, { id: order.sourceQuoteRequestId });
      if (!rfq || rfq.status === 'Completed') return;
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
    },
  };
}
