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
 * The two auto-trigger handlers (FR-024). One push message per event,
 * idempotent on the event id; producer only — nothing is sent inline
 * (Principle X), and every handler absorbs its own failure so a push problem
 * never breaks the business transaction that announced itself.
 *
 * The subscriptions live in this module's `backend.ts` and go through
 * `ctx.subscribe` (issue #107). They were two bare `eventBus.on` calls here, so
 * a switched-off `pwa` still wrote a `push_messages` row and still delivered a
 * notification to a customer's device — the most visible of the writes that
 * survived their module.
 */
export function createPushEventHandlers(deps: PushEventSubscriberDeps): {
  onOrderStatusChanged: (payload: unknown) => Promise<void>;
  onQuoteRequestUpdated: (payload: unknown) => Promise<void>;
} {
  const { messageService } = deps;

  return {
    // order.status_changed.v1 (orders, feature 038)
    async onOrderStatusChanged(raw: unknown): Promise<void> {
      const payload = raw as {
        eventId: string;
        orderId: string;
        salesChannelId: string;
        from: string;
        to: string;
      };
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
    },

    // quote-request update events (quote_requests, feature 008)
    async onQuoteRequestUpdated(raw: unknown): Promise<void> {
      const payload = raw as {
        eventId: string;
        quoteRequestId: string;
        salesChannelId?: string;
      };
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
    },
  };
}
