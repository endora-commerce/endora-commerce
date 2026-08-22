import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  CustomerAccountReadPort,
  EmailMailerPort,
} from '@endora-commerce/contracts';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { withSystemScope } from '../../../tenancy/escape-hatch.js';

export interface AdjustedPayload {
  productId: string;
  warehouseId: string;
  variantId: string | null;
  before: number;
  after: number;
}

/**
 * Availability worker (T136 / FR-061).
 *
 * Call `dispatchForStockIncrease({ productId, variantId? })` after any
 * stock-mutation path that raises a (product, variant) row's onHand. The
 * worker:
 *
 *   1. Loads every AvailabilityNotification for that (productId, variantId)
 *      that hasn't yet been notified.
 *   2. For each subscriber, sends a back-in-stock email via the injected
 *      Mailer.
 *   3. Marks the notification consumed (`notifiedAt = now`) inside one
 *      flush so a worker crash mid-batch doesn't double-send (the next
 *      run re-loads only un-notified rows).
 *
 * Production composition can swap synchronous dispatch for a BullMQ job
 * by binding a queue producer to the same method signature.
 */
export class AvailabilityWorker {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly mailer: EmailMailerPort,
    /** `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). */
    private readonly catalogProducts: CatalogProductReadPort,
    /** `customerAccountReadPort`, owned by `customer_accounts` (feature 075). */
    private readonly customerAccounts: CustomerAccountReadPort,
  ) {}

  async dispatchForStockIncrease(input: {
    productId: string;
    variantId?: string | null;
  }): Promise<{ notified: number }> {
    // command-coverage-ignore: background restock fan-out — stamps notifiedAt on
    // subscriptions as it sends, delivery bookkeeping (not an audited domain write).
    // Feature 050 — triggered off a stock-increase event; may run detached, so
    // scope the AvailabilityNotification reads under a system context.
    return withSystemScope('availability stock-increase', async () => {
    const em = this.emFactory();
    const product = await this.catalogProducts.findById(input.productId);
    if (!product) return { notified: 0 };

    const where: Record<string, unknown> = {
      productId: input.productId,
      notifiedAt: null,
    };
    if (input.variantId === undefined || input.variantId === null) {
      where['variantId'] = null;
    } else {
      where['variantId'] = input.variantId;
    }
    const subscriptions = await em.find(AvailabilityNotification, where);
    if (subscriptions.length === 0) return { notified: 0 };

    const customerIds = Array.from(
      new Set(
        subscriptions
          .map((s) => s.customerAccountId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    );
    const customers =
      customerIds.length > 0 ? await this.customerAccounts.findByIds(customerIds) : [];
    const emailById = new Map(customers.map((c) => [c.id, c.email]));

    const productName = product.name['en-US'] ?? Object.values(product.name)[0] ?? product.sku;
    const now = new Date();

    for (const sub of subscriptions) {
      // Feature 010: subscriptions can carry an `email` directly
      // (anonymous path). Prefer that; otherwise fall back to the
      // customer-account email.
      const to = sub.email ?? (sub.customerAccountId ? emailById.get(sub.customerAccountId) : null);
      if (!to) {
        // Customer was deleted; mark consumed anyway so we stop retrying.
        sub.notifiedAt = now;
        continue;
      }
      const outcome = await this.mailer.send({
        messageId: `availability:${sub.id}`,
        to,
        subject: `Back in stock: ${productName}`,
        text: `Good news — "${productName}" is available again.`,
        kind: 'availability_back_in_stock',
        meta: {
          productId: input.productId,
          variantId: input.variantId ?? null,
          notificationId: sub.id,
        },
      });
      if (outcome.status !== 'sent') {
        // The subscription is still consumed: the one suppression a transport
        // performs is an already-accepted `messageId`, which means this
        // subscriber was notified by an earlier run. Re-sending it is the
        // duplicate the idempotency key exists to prevent.
        console.warn('[inventory] the back-in-stock e-mail was not sent', {
          notificationId: sub.id,
          reason: outcome.reason,
        });
      }
      sub.notifiedAt = now;
    }
    await em.flush();
    return { notified: subscriptions.length };
    });
  }

  /**
   * `inventory.adjusted.v1` — fan out only when cumulative on-hand across all
   * warehouses crossed from 0 to > 0 for the (product, variant) pair, not on
   * every `stock_levels` row tweak.
   *
   * The subscription lives in this module's `backend.ts` and goes through
   * `ctx.subscribe`, so a switched-off `inventory` sends no back-in-stock mail
   * (issue #107). It used to be a bare `eventBus.on` here.
   */
  async handleAdjusted(payload: AdjustedPayload): Promise<void> {
    if (payload.after <= 0) return;
    const em = this.emFactory();
    // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
    // connection, so a caller that raised this event from inside a transaction
    // would have the sum answered from outside it (issue #207).
    const variantClause =
      payload.variantId === null ? 'variant_id is null' : 'variant_id = ?';
    const variantParams = payload.variantId === null ? [] : [payload.variantId];
    const sumRows = (await em.execute(
      `select sum(on_hand) as on_hand
         from stock_levels
        where product_id = ? and ${variantClause}`,
      [payload.productId, ...variantParams],
    )) as Array<{ on_hand: string | null }>;
    const cumulativeAfter = Number(sumRows[0]?.on_hand ?? 0);
    const cumulativeBefore = cumulativeAfter - (payload.after - payload.before);
    if (cumulativeBefore > 0 || cumulativeAfter <= 0) return;

    await this.dispatchForStockIncrease({
      productId: payload.productId,
      variantId: payload.variantId,
    });
  }
}
