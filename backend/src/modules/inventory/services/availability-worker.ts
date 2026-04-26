import type { EntityManager } from '@mikro-orm/postgresql';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import type { Mailer } from '../../email/services/mailer.js';

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
      new Set(subscriptions.map((s) => s.customerAccountId)),
    );
    const customers = await em.find(CustomerAccount, { id: { $in: customerIds } });
    const emailById = new Map(customers.map((c) => [c.id, c.email]));

    const productName = product.name['en-US'] ?? Object.values(product.name)[0] ?? product.sku;
    const now = new Date();

    for (const sub of subscriptions) {
      const to = emailById.get(sub.customerAccountId);
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
}
