import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  EmailMailerPort,
} from '@endora-commerce/contracts';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { restockDisposition } from './restock-product-state.js';
import { backInStockNames } from './back-in-stock-names.js';
import { sendBackInStockEmail } from './back-in-stock-email.js';
import type { InventoryTemplateEmailPort } from './low-stock-alert-service.js';
import { withSystemScope } from '@endora-commerce/platform/tenancy';

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
 *   2. For each subscriber, sends the `availability_back_in_stock`
 *      template in the subscription's channel and language (issue #1256),
 *      through `transactional_emails`' `templateEmailPort`.
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
    /**
     * `catalogProductAvailabilityPort`, owned by `catalog` — the effective product name at each
     * subscription's (channel, language) (issue #696). Required: `catalog` is non-deactivatable
     * and a declared dependency, and an optional reader is a composition that silently falls
     * back to the Global name.
     */
    private readonly catalogTexts: Pick<CatalogProductAvailabilityPort, 'effectiveTexts'>,
    /**
     * `templateEmailPort`, owned by `transactional_emails` — the operator-editable
     * back-in-stock template, rendered in each subscription's channel and language (issue
     * #1256). Required for the reason `catalogTexts` is: the owner is non-deactivatable and a
     * declared dependency, and an optional sender is a composition that silently sends the
     * fixed English text. {@link mailer} carries that text only when the template path answers
     * that no definition exists.
     */
    private readonly templateEmail: InventoryTemplateEmailPort,
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
    // The wider read (no `liveOnly`), so a deleted product resolves and is told apart from an
    // archived or switched-off one.
    const product = await this.catalogProducts.findById(input.productId);
    const now = new Date();
    // Issue #468 — asked once, before any subscriber is mailed. `hold` leaves every row as it
    // is, for a later restock to send once the product is for sale again.
    const disposition = restockDisposition(product, now);
    if (disposition === 'hold') return { notified: 0 };

    const where: Record<string, unknown> = {
      productId: input.productId,
      // A row the customer or an admin cancelled keeps `notifiedAt` null, so the status is what
      // keeps it from being mailed (issue #468).
      status: 'queued',
      notifiedAt: null,
    };
    if (input.variantId === undefined || input.variantId === null) {
      where['variantId'] = null;
    } else {
      where['variantId'] = input.variantId;
    }
    const subscriptions = await em.find(AvailabilityNotification, where);
    if (subscriptions.length === 0) return { notified: 0 };

    if (disposition === 'cancel' || product === null) {
      // A deleted or missing product is not coming back: close the subscriptions, the same
      // treatment `AvailabilityNotificationService.processRestockedFanOut` gives them.
      for (const sub of subscriptions) {
        sub.status = 'cancelled';
        sub.notifiedAt = now;
      }
      await em.flush();
      return { notified: 0 };
    }

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

    // Issue #696 — each subscriber is told the product's effective name at the scope they
    // subscribed in; a subscription with none (written before #696) keeps the Global name.
    const productNames = await backInStockNames(subscriptions, product, this.catalogTexts);

    for (const sub of subscriptions) {
      const productName = productNames.get(sub.id) ?? (product.name || product.sku);
      // Feature 010: subscriptions can carry an `email` directly
      // (anonymous path). Prefer that; otherwise fall back to the
      // customer-account email.
      const to = sub.email ?? (sub.customerAccountId ? emailById.get(sub.customerAccountId) : null);
      if (!to) {
        // Customer was deleted; mark consumed anyway so we stop retrying.
        sub.notifiedAt = now;
        continue;
      }
      await sendBackInStockEmail(
        { templateEmail: this.templateEmail, mailer: this.mailer },
        {
          notificationId: sub.id,
          to,
          productName,
          salesChannelId: sub.salesChannelId ?? null,
          languageCode: sub.languageCode ?? null,
          meta: {
            productId: input.productId,
            variantId: input.variantId ?? null,
            notificationId: sub.id,
          },
        },
      );
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
