import type { EntityManager } from '@mikro-orm/postgresql';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type { CartAuditService } from './cart-audit-service.js';

/**
 * CartAbandonmentWorker — feature 027 US5.
 *
 * Periodic sweep that transitions `active` carts inactive past the
 * configured threshold to `abandoned`. Mirrors the RfqExpiryWorker
 * pattern from feature 008: public `sweep()` is a plain async function
 * so tests can drive it directly without Redis/BullMQ.
 *
 * Idempotency: the eligibility filter excludes carts that already have
 * `abandonment_notified_at` set. The sweep cycle thus fires the
 * notification at most once per abandonment episode; reactivation
 * (CartService.touch / any owner-driven write) clears the column so
 * the next episode can re-notify.
 *
 * Empty-cart suppression: per the spec's edge case, empty carts still
 * transition to `abandoned` by status, but the notification e-mail is
 * suppressed (no buyer-side signal worth notifying anyone about).
 */

export interface CartAbandonmentWorkerDeps {
  emFactory: () => EntityManager;
  cartAuditService: CartAuditService;
  /** Resolves the current `carts.abandonment.inactivity_minutes` from settings.
   * `0` disables the sweep entirely. */
  resolveInactivityMinutes: () => Promise<number>;
  /** Resolves the current `carts.abandonment.notification_recipient`
   * from settings. Empty string = no notification e-mail. */
  resolveNotificationRecipient: () => Promise<string>;
  /** Outbound e-mail dispatch. Implementation lives in composition so
   * the worker stays decoupled from the email module. */
  dispatchNotification?: (input: {
    recipientEmail: string;
    cartId: string;
    ownerDisplayName: string | null;
    lineCount: number;
    organizationId: string | null;
  }) => Promise<void>;
}

export interface CartAbandonmentSweepResult {
  abandonedCount: number;
  notifiedCount: number;
}

export class CartAbandonmentWorker {
  constructor(private readonly deps: CartAbandonmentWorkerDeps) {}

  async sweep(now: Date = new Date()): Promise<CartAbandonmentSweepResult> {
    const inactivityMinutes = await this.deps.resolveInactivityMinutes();
    if (!Number.isFinite(inactivityMinutes) || inactivityMinutes <= 0) {
      return { abandonedCount: 0, notifiedCount: 0 };
    }

    const em = this.deps.emFactory();
    const cutoff = new Date(now.getTime() - inactivityMinutes * 60_000);

    const eligible = await em.find(Cart, {
      status: 'active',
      lastActivityAt: { $lt: cutoff },
      abandonmentNotifiedAt: null,
    });
    if (eligible.length === 0) {
      return { abandonedCount: 0, notifiedCount: 0 };
    }

    const recipient = await this.deps.resolveNotificationRecipient();
    const shouldNotify = recipient.trim().length > 0 && Boolean(this.deps.dispatchNotification);

    let notifiedCount = 0;
    for (const cart of eligible) {
      cart.status = 'abandoned';
      cart.abandonmentNotifiedAt = now;
    }
    await em.flush();

    // Audit + (optional) notification fan-out happens AFTER the bulk
    // flip so a partial failure in the email dispatch doesn't leave
    // status in a transient state.
    for (const cart of eligible) {
      const items = await em.find(CartItem, { cartId: cart.id });
      const lineCount = items.length;

      await this.deps.cartAuditService.record({
        cartId: cart.id,
        actorType: 'sweep',
        action: 'abandonment_swept',
        fromState: 'active',
        toState: 'abandoned',
        metadata: { lineCount, inactivityMinutes },
      });

      // Empty-cart suppression — no buyer signal worth e-mailing.
      if (shouldNotify && lineCount > 0 && this.deps.dispatchNotification) {
        try {
          await this.deps.dispatchNotification({
            recipientEmail: recipient,
            cartId: cart.id,
            ownerDisplayName: cart.customerAccountId ?? null,
            lineCount,
            organizationId: cart.organizationId ?? null,
          });
          notifiedCount += 1;
        } catch (err) {
          // Notification failure must not roll back the status flip.
          // The audit trail records the abandonment; an oncall who
          // notices the e-mail never arrived can replay manually.
          // eslint-disable-next-line no-console
          console.error('[cart-abandonment-worker] notification failed', err);
        }
      }
    }

    return { abandonedCount: eligible.length, notifiedCount };
  }
}
