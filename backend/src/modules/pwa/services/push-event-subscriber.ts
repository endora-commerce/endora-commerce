import type { EventBus } from '../../../events/bus.js';
import type { PushMessageService } from './push-message-service.js';

/**
 * Target resolved for an auto-triggered push. Returning null (or no customer)
 * means "no push" — anonymous orders / unsubscribed customers are skipped.
 */
export interface PushEventTarget {
  salesChannelId: string;
  customerAccountId: string;
  title: string;
  body: string;
  url?: string;
}

export interface PushEventSubscriberDeps {
  eventBus: EventBus;
  messageService: PushMessageService;
  /** Resolve an order-status event into a push target (channel + customer + copy). */
  resolveOrderTarget?: (payload: {
    orderId: string;
    salesChannelId: string;
    from: string;
    to: string;
  }) => Promise<PushEventTarget | null>;
  /** Resolve a quote-request event into a push target. */
  resolveQuoteTarget?: (payload: {
    quoteRequestId: string;
    sourceEventId: string;
  }) => Promise<PushEventTarget | null>;
  /** Gate: is push enabled for this channel? */
  isPushEnabled: (salesChannelId: string) => Promise<boolean>;
}

/**
 * Wires auto-triggered push (FR-024). Subscribes to order-status and
 * quote-request events on the in-process EventBus and enqueues one push message
 * per event (idempotent on the event id). The subscriber is a producer only — it
 * never sends inline (Principle X). Every handler is wrapped so a push failure
 * never breaks the originating business transaction.
 */
export function setupPushEventSubscriber(deps: PushEventSubscriberDeps): void {
  const { eventBus, messageService } = deps;

  // order.status_changed.v1 (orders, feature 038)
  eventBus.on(
    'order.status_changed.v1' as never,
    (async (payload: {
      eventId: string;
      orderId: string;
      salesChannelId: string;
      from: string;
      to: string;
    }) => {
      try {
        if (!deps.resolveOrderTarget) return;
        if (!(await deps.isPushEnabled(payload.salesChannelId))) return;
        const target = await deps.resolveOrderTarget(payload);
        if (!target) return;
        await messageService.createAndEnqueue({
          salesChannelId: target.salesChannelId,
          title: target.title,
          body: target.body,
          ...(target.url ? { url: target.url } : {}),
          audience: { kind: 'customers', customerAccountIds: [target.customerAccountId] },
          trigger: 'order_status',
          sourceEventId: payload.eventId,
        });
      } catch (err) {
        console.warn('[pwa] order-status push enqueue failed', err);
      }
    }) as never,
  );

  // quote-request update events (quote_requests, feature 008)
  eventBus.on(
    'quote_request.updated.v1' as never,
    (async (payload: { eventId: string; quoteRequestId: string; salesChannelId?: string }) => {
      try {
        if (!deps.resolveQuoteTarget) return;
        const target = await deps.resolveQuoteTarget({
          quoteRequestId: payload.quoteRequestId,
          sourceEventId: payload.eventId,
        });
        if (!target) return;
        if (!(await deps.isPushEnabled(target.salesChannelId))) return;
        await messageService.createAndEnqueue({
          salesChannelId: target.salesChannelId,
          title: target.title,
          body: target.body,
          ...(target.url ? { url: target.url } : {}),
          audience: { kind: 'customers', customerAccountIds: [target.customerAccountId] },
          trigger: 'quote_request',
          sourceEventId: payload.eventId,
        });
      } catch (err) {
        console.warn('[pwa] quote-request push enqueue failed', err);
      }
    }) as never,
  );
}
