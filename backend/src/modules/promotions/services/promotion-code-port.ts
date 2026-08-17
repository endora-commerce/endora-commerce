import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromotionCodePort, ResolvedPromotionCode } from '@b2b/contracts';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';

/**
 * The coupon-resolution port `promotions` publishes (feature 075, Phase P).
 *
 * `carts` reaches both entity classes for exactly one question — "is this code
 * live, and which promotion is it?" — across a three-step lookup: the legacy
 * `promotions.code` column first, then the `promotion_coupons` table, then the
 * promotion behind the coupon, each filtered on `isActive`. That order and
 * those filters are this module's business, and reproducing them in `carts`
 * meant reproducing them correctly.
 *
 * The answer is four fields rather than the thirty-column row, because four is
 * what the question needs.
 */
export class PromotionCodeService implements PromotionCodePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolveByCode(code: string): Promise<ResolvedPromotionCode | null> {
    const em = this.emFactory();

    // Legacy inline code on the promotion itself.
    const legacy = await em.findOne(Promotion, { code, isActive: true });
    if (legacy) {
      return { promotionId: legacy.id, couponId: null, name: legacy.name, isActive: true };
    }

    const coupon = await em.findOne(PromotionCoupon, { code, isActive: true });
    if (!coupon) return null;

    // A live coupon whose promotion is not live is not a live code. Answering
    // the coupon alone would let a cart accept a code that discounts nothing.
    const promotion = await em.findOne(Promotion, { id: coupon.promotionId, isActive: true });
    if (!promotion) return null;

    return {
      promotionId: promotion.id,
      couponId: coupon.id,
      name: promotion.name,
      isActive: true,
    };
  }
}
