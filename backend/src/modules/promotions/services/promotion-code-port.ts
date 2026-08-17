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
 * The answer is eight fields rather than the thirty-column row, because eight
 * is what the question needs: which promotion, and — when the buyer may not
 * use it — why not. The four eligibility fields joined the record in feature
 * 075's `carts` cut; without them the caller could only answer `invalid_code`
 * where it answers `expired`, `wrong_organization` and `below_min_spend`.
 */
export class PromotionCodeService implements PromotionCodePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolveByCode(code: string): Promise<ResolvedPromotionCode | null> {
    const em = this.emFactory();

    // Legacy inline code on the promotion itself.
    const legacy = await em.findOne(Promotion, { code, isActive: true });
    if (legacy) return toResolvedCode(legacy, null);

    const coupon = await em.findOne(PromotionCoupon, { code, isActive: true });
    if (!coupon) return null;

    // A live coupon whose promotion is not live is not a live code. Answering
    // the coupon alone would let a cart accept a code that discounts nothing.
    const promotion = await em.findOne(Promotion, { id: coupon.promotionId, isActive: true });
    if (!promotion) return null;

    return toResolvedCode(promotion, coupon.id);
  }
}

function toResolvedCode(promotion: Promotion, couponId: string | null): ResolvedPromotionCode {
  return {
    promotionId: promotion.id,
    couponId,
    name: promotion.name,
    isActive: true,
    validFrom: promotion.validFrom ?? null,
    validUntil: promotion.validUntil ?? null,
    organizationId: promotion.organizationId ?? null,
    minCartSubtotal: promotion.minCartSubtotal ?? null,
  };
}
