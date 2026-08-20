import {
  ModuleDisabledError,
  type WorkerLogger,
} from '../../../kernel/lifecycle/plugin-helpers.js';
import type { PushMessageService } from './push-message-service.js';

/**
 * Where a skipped or failed auto-trigger push is written down.
 *
 * The structured-logger surface the kernel already defines for a queue
 * consumer, for the same reason: these two handlers run outside any request,
 * so `request.log` does not exist and the line has to carry its own context.
 */
export type PushEventLogger = WorkerLogger;

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
  /**
   * Read per line rather than captured, because the logger these handlers
   * should be writing to does not exist yet when they are built: composition
   * runs before `buildServer`, so `ctx.log` is whatever the root could offer
   * that early, and the application's own logger only arrives when the module's
   * routes are registered. `plugin.ts` moves the holder along; the handlers ask
   * for it at the moment they have something to say.
   */
  log: () => PushEventLogger;
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
 *
 * ## Why the `catch` stays, and what it is no longer allowed to hide
 *
 * `PushMessageService` reaches `customer_accounts` and `organizations` through
 * gated ports (feature 075, Phase C), so a rule-targeted send can raise
 * `ModuleDisabledError` here. `rethrowIfModuleDisabled` — the usual remedy —
 * is the wrong one at this seam: an EventBus subscriber has no caller to answer.
 * `EventBus.dispatch` isolates each handler in its own `try` and turns a throw
 * into one `console.warn` line naming neither the module nor the trigger, so
 * re-throwing would hand the presence answer to a place that discards it, and a
 * probe before the work would make `pwa` name the two owners the port exists to
 * hide.
 *
 * So the presence answer is **decided here, by name** — the third of the four
 * shapes `check-port-catches` accepts — and it is decided into a different
 * sentence from a failure. The outcome is the same for both (no push, the
 * announcing transaction untouched, per FR-024); the record is not, because an
 * operator's own switch doing what it says and a broken enqueue are not one
 * event. That is the rule under Principle XVII item 3: where nothing can catch
 * the throw, a genuine failure and a switched-off module must not share one
 * silent no-op.
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
        // Decided at the site, not delegated: the identifier below is the whole
        // of what tells an operator's switch from an incident, and a helper
        // holding it would let a later edit lose the distinction silently.
        if (err instanceof ModuleDisabledError) {
          deps.log().warn(
            { module: err.moduleId, trigger: 'order_status', eventId: payload.eventId },
            'pwa.push_skipped_module_disabled',
          );
          return;
        }
        deps
          .log()
          .error(
            { err, trigger: 'order_status', eventId: payload.eventId },
            'pwa.push_enqueue_failed',
          );
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
        // See the order-status twin above — same decision, same two sentences.
        if (err instanceof ModuleDisabledError) {
          deps.log().warn(
            { module: err.moduleId, trigger: 'quote_request', eventId: payload.eventId },
            'pwa.push_skipped_module_disabled',
          );
          return;
        }
        deps
          .log()
          .error(
            { err, trigger: 'quote_request', eventId: payload.eventId },
            'pwa.push_enqueue_failed',
          );
      }
    },
  };
}
