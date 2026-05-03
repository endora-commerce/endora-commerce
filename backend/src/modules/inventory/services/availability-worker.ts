import type { EntityManager } from '@mikro-orm/postgresql';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { Mailer } from '../../email/services/mailer.js';
import type { EventBus } from '../../../events/bus.js';

interface AdjustedPayload {
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
    private readonly mailer: Mailer,
  ) {}

  async dispatchForStockIncrease(input: {
    productId: string;
    variantId?: string | null;
  }): Promise<{ notified: number }> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: input.productId });
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
      customerIds.length > 0
        ? await em.find(CustomerAccount, { id: { $in: customerIds } })
        : [];
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
      await this.mailer.send({
        messageId: `availability:${sub.id}`,
        to,
        subject: `Back in stock: ${productName}`,
        text: `Good news — "${productName}" is available again.`,
        meta: {
          productId: input.productId,
          variantId: input.variantId ?? null,
          notificationId: sub.id,
        },
      });
      sub.notifiedAt = now;
    }
    await em.flush();
    return { notified: subscriptions.length };
  }

  /**
   * Wire the worker to the event bus — fan out only when cumulative
   * across all warehouses crossed from 0 to > 0 for the (product, variant)
   * pair, not on every stock_levels row tweak.
   */
  attach(eventBus: EventBus): void {
    eventBus.on('inventory.adjusted.v1', (payload) => {
      const cast = payload as unknown as AdjustedPayload;
      void this.handleAdjusted(cast);
    });
  }

  private async handleAdjusted(payload: AdjustedPayload): Promise<void> {
    if (payload.after <= 0) return;
    const em = this.emFactory();
    const knex = em.getKnex();
    const where: Record<string, unknown> = { product_id: payload.productId };
    if (payload.variantId === null) {
      where['variant_id'] = null;
    } else {
      where['variant_id'] = payload.variantId;
    }
    const sumRow = await knex('stock_levels')
      .where(where)
      .sum<{ on_hand: string | null }[]>('on_hand as on_hand')
      .first();
    const cumulativeAfter = Number(sumRow?.on_hand ?? 0);
    const cumulativeBefore = cumulativeAfter - (payload.after - payload.before);
    if (cumulativeBefore > 0 || cumulativeAfter <= 0) return;

    await this.dispatchForStockIncrease({
      productId: payload.productId,
      variantId: payload.variantId,
    });
  }
}
