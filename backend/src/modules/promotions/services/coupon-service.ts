import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';

/**
 * Feature 045 (US3/US4) — coupon management. Single specified coupons land
 * here with a globally-unique `code`; the generator (US4) bulk-inserts into
 * the same table. The engine and the cart coupon flow resolve a presented
 * code to its promotion through `findByCode`.
 */
export class CouponService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listForPromotion(promotionId: string): Promise<PromotionCoupon[]> {
    return this.emFactory().find(
      PromotionCoupon,
      { promotionId },
      { orderBy: { createdAt: 'asc' } },
    );
  }

  async findByCode(code: string): Promise<PromotionCoupon | null> {
    return this.emFactory().findOne(PromotionCoupon, { code, isActive: true });
  }

  /** Create a single specified coupon for a promotion. Rejects duplicates. */
  async createSingle(promotionId: string, code: string): Promise<PromotionCoupon> {
    const em = this.emFactory();
    const promotion = await em.findOne(Promotion, { id: promotionId });
    if (!promotion) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${promotionId} not found.`);
    }
    const existing = await em.findOne(PromotionCoupon, { code });
    if (existing) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `coupon_code_taken: ${code}`);
    }
    const coupon = em.create(PromotionCoupon, {
      promotionId,
      batchId: null,
      code,
      limitScope: 'per_coupon',
      isActive: true,
    });
    await em.persistAndFlush(coupon);
    return coupon;
  }
}
