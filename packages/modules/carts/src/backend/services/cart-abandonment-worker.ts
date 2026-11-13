import type { EntityManager } from '@mikro-orm/postgresql';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type { CartAuditService } from './cart-audit-service.js';
import { withSystemScope } from '@endora-commerce/platform/tenancy';

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
 *
 * ## The sweep works in batches (issue #152)
 *
 * It used to load every eligible cart at once and then, per cart, run one
 * `em.find(CartItem)` and one `CartAuditService.record()` — which flushed. Over
 * an identity map that kept every cart and every audit row it had already
 * touched, so each flush re-examined the whole run: 500 carts cost 8.4 s
 * (16.8 ms each) and 2000 cost 132.0 s (66.0 ms each). Four times the carts,
 * sixteen times the time. At the 50 000 the spec states its target over, the
 * benchmark timed out rather than reporting a number, which is why it was
 * excluded from the perf schedules.
 *
 * Three things changed, and only together do they make the cost linear:
 *
 *  1. **Eligible carts are read a batch at a time.** The flip removes a cart
 *     from the eligibility filter, so the same query paginates itself; nothing
 *     holds 50 000 entities.
 *  2. **Line counts are one aggregate per batch**, not one query per cart.
 *  3. **Audit rows land with the flip**, in one flush per batch, through
 *     {@link CartAuditService.recordWithin}.
 *
 * and `em.clear()` at the end of each batch keeps the identity map the size of
 * one batch rather than the size of the run.
 *
 * ## What a failure mid-sweep now costs
 *
 * Each batch commits its status flip and its audit rows in the same flush, so
 * a batch is atomic: never an `abandoned` cart whose audit row is missing.
 * Before, the whole eligible set was flipped and committed **first** and the
 * audit rows followed one at a time, so a crash left every cart the sweep had
 * not reached yet flipped-but-unaudited — permanently, since
 * `abandonment_notified_at` had already been set and the next tick skips those
 * carts. The window that used to be "the rest of the run" is now "nothing".
 *
 * Batches before the failure are complete and durable; batches after it are
 * untouched and eligible for the next tick. The notification e-mail is the one
 * thing that stays best-effort — it is dispatched after the batch is durable,
 * exactly as it was after the per-cart write before.
 *
 * ## Orphaned working baskets (issue #602)
 *
 * A working basket (`status = 'working'`, issue #169) is the cart an order is
 * placed from when the request names the lines; it lives for the length of one
 * placement, which completes it or discards it. A process that dies between
 * the two leaves it behind, and nothing ever reads it again. Each sweep removes
 * the working baskets created more than {@link ORPHANED_WORKING_BASKET_MINUTES}
 * ago, lines and audit rows with them (both `on delete cascade`).
 *
 * The predicate is `status = 'working'` and nothing else, so no buyer's basket
 * — active, abandoned, completed or rejected — can match it, however old. It
 * runs whether or not the abandonment threshold is enabled: that setting is a
 * business choice about buyers' baskets, and this is housekeeping of rows no
 * buyer can see.
 */

/**
 * Age after which a working basket is taken to be orphaned. A placement reads
 * and completes its working basket inside the request that created it, so a
 * live one is seconds old; an hour leaves a wide margin over any request.
 */
export const ORPHANED_WORKING_BASKET_MINUTES = 60;

/**
 * Eligible carts read, flipped, audited and flushed per round trip.
 *
 * Chosen for the flush rather than the query: 500 carts is 500 updates plus
 * 1000 audit inserts in one transaction, which PostgreSQL takes in a few
 * multi-row statements, while the memory held between two `em.clear()` calls
 * stays bounded by this number rather than by the corpus. Overridable per
 * instance so a test can cross a batch boundary with a handful of carts.
 */
export const DEFAULT_SWEEP_BATCH_SIZE = 500;

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
  /** Defaults to {@link DEFAULT_SWEEP_BATCH_SIZE}. */
  batchSize?: number;
}

export interface CartAbandonmentSweepResult {
  abandonedCount: number;
  notifiedCount: number;
  /** Orphaned working baskets removed by this sweep (issue #602). */
  workingBasketsRemoved: number;
}

export class CartAbandonmentWorker {
  constructor(private readonly deps: CartAbandonmentWorkerDeps) {}

  async sweep(now: Date = new Date()): Promise<CartAbandonmentSweepResult> {
    // Feature 050 — system-wide sweep across all customers; run under a system
    // scope so the Cart reads/writes carry a tenant context (fail-closed guard).
    return withSystemScope('cart-abandonment sweep', async () => {
      const em = this.deps.emFactory();
      const workingBasketsRemoved = await this.removeOrphanedWorkingBaskets(em, now);

      const inactivityMinutes = await this.deps.resolveInactivityMinutes();
      if (!Number.isFinite(inactivityMinutes) || inactivityMinutes <= 0) {
        return { abandonedCount: 0, notifiedCount: 0, workingBasketsRemoved };
      }

      const cutoff = new Date(now.getTime() - inactivityMinutes * 60_000);
      const batchSize = Math.max(1, this.deps.batchSize ?? DEFAULT_SWEEP_BATCH_SIZE);

      let abandonedCount = 0;
      let notifiedCount = 0;
      /** Read once, on the first batch that has work — as it was per sweep. */
      let recipient: string | null = null;

      for (;;) {
        const batch = await em.find(
          Cart,
          {
            status: 'active',
            lastActivityAt: { $lt: cutoff },
            abandonmentNotifiedAt: null,
          },
          { limit: batchSize },
        );
        if (batch.length === 0) break;

        if (recipient === null) recipient = await this.deps.resolveNotificationRecipient();
        const shouldNotify =
          recipient.trim().length > 0 && Boolean(this.deps.dispatchNotification);

        const lineCounts = await this.countLines(
          em,
          batch.map((c) => c.id),
        );

        for (const cart of batch) {
          cart.status = 'abandoned';
          cart.abandonmentNotifiedAt = now;
        }
        this.deps.cartAuditService.recordWithin(
          em,
          batch.map((cart) => ({
            cartId: cart.id,
            actorType: 'sweep' as const,
            action: 'abandonment_swept' as const,
            fromState: 'active',
            toState: 'abandoned',
            metadata: { lineCount: lineCounts.get(cart.id) ?? 0, inactivityMinutes },
          })),
        );
        // One flush, one transaction: the flip and the rows auditing it.
        await em.flush();
        abandonedCount += batch.length;

        // Notification fan-out happens AFTER the batch is durable so a failure
        // in the e-mail dispatch cannot leave status in a transient state.
        if (shouldNotify && this.deps.dispatchNotification) {
          notifiedCount += await this.dispatchFor(batch, recipient, lineCounts);
        }

        // The identity map is the other half of the old superlinear cost: every
        // later flush walked the carts and audit rows of every earlier batch.
        // Nothing above this line survives the batch, so dropping it is free.
        em.clear();

        if (batch.length < batchSize) break;
      }

      return { abandonedCount, notifiedCount, workingBasketsRemoved };
    });
  }

  /**
   * Delete the working baskets older than {@link ORPHANED_WORKING_BASKET_MINUTES}
   * (issue #602). One statement; lines and audit rows go with each cart through
   * their `on delete cascade` foreign keys.
   */
  private async removeOrphanedWorkingBaskets(em: EntityManager, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ORPHANED_WORKING_BASKET_MINUTES * 60_000);
    // command-coverage-ignore: removes the transient working state of a
    // placement that never finished; nothing was placed and nothing is recorded.
    return em.nativeDelete(Cart, { status: 'working', createdAt: { $lt: cutoff } });
  }

  /**
   * Lines per cart for a whole batch, as one grouped count.
   *
   * Executed through `em.execute` rather than awaited on the knex builder, so
   * it runs on the EntityManager's transaction context — a bare knex call would
   * take its own connection and, inside a wrapping transaction, would not see
   * the rows the caller has written but not committed.
   */
  private async countLines(
    em: EntityManager,
    cartIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (cartIds.length === 0) return new Map();
    const knex = em.getKnex();
    // The table name comes from the entity's own metadata rather than a
    // literal, so a rename stays a one-file change.
    const table = em.getMetadata().get(CartItem).tableName;
    const rows = await em.execute<Array<{ cart_id: string; line_count: string | number }>>(
      knex(table)
        .select('cart_id')
        .count({ line_count: '*' })
        .whereIn('cart_id', [...cartIds])
        .groupBy('cart_id'),
    );
    return new Map(rows.map((r) => [r.cart_id, Number(r.line_count)]));
  }

  /** Returns how many notifications were dispatched for this batch. */
  private async dispatchFor(
    batch: readonly Cart[],
    recipient: string,
    lineCounts: ReadonlyMap<string, number>,
  ): Promise<number> {
    const dispatch = this.deps.dispatchNotification;
    if (!dispatch) return 0;

    let sent = 0;
    for (const cart of batch) {
      const lineCount = lineCounts.get(cart.id) ?? 0;
      // Empty-cart suppression — no buyer signal worth e-mailing.
      if (lineCount === 0) continue;
      try {
        await dispatch({
          recipientEmail: recipient,
          cartId: cart.id,
          ownerDisplayName: cart.customerAccountId ?? null,
          lineCount,
          organizationId: cart.organizationId ?? null,
        });
        sent += 1;
      } catch (err) {
        // Notification failure must not roll back the status flip.
        // The audit trail records the abandonment; an oncall who
        // notices the e-mail never arrived can replay manually.
        console.error('[cart-abandonment-worker] notification failed', err);
      }
    }
    return sent;
  }
}
