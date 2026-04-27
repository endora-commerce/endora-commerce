import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { StockLevel } from '../entities/stock-level.entity.js';

/**
 * AvailabilityNotification subscription service (T072).
 *
 * Customer subscribes to "notify when in stock" for a Product (or specific
 * Variant). Idempotent — duplicate subscribe by the same customer for the
 * same (product, variant) returns the existing row. Returns 422
 * PRODUCT_IN_STOCK if the product currently has on_hand > reserved.
 */
export class AvailabilityNotificationService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async subscribe(input: {
    customerAccountId: string;
    productId: string;
    variantId?: string | null;
  }): Promise<AvailabilityNotification> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: input.productId });
    if (!product || product.deletedAt) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const stock = await em.findOne(StockLevel, {
      productId: input.productId,
      variantId: input.variantId ?? null,
    });
    if (stock && stock.onHand - stock.reserved > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.PRODUCT_IN_STOCK,
        'Product is currently in stock — no notification needed.',
      );
    }

    const existing = await em.findOne(AvailabilityNotification, {
      customerAccountId: input.customerAccountId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      notifiedAt: null,
    });
    if (existing) {
      throw new HttpError(
        409,
        ERROR_CODES.ALREADY_SUBSCRIBED,
        'You are already subscribed for this product.',
      );
    }

    const subscription = em.create(AvailabilityNotification, {
      customerAccountId: input.customerAccountId,
      productId: input.productId,
      ...(input.variantId !== undefined && input.variantId !== null
        ? { variantId: input.variantId }
        : {}),
    });
    await em.persistAndFlush(subscription);
    return subscription;
  }
}
