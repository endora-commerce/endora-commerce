import {
  ERROR_CODES,
  isUuidShape,
  type CouponCreateSingleHookData,
  type CouponCreateSingleOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';

/**
 * `coupon.create_single` — an operator adds one specified coupon to a
 * promotion (feature 045, US3; a Command since issue #1844, the write
 * `CouponService.createSingle` made by hand with a co-transactional audit row
 * until then).
 *
 * Recorded against the **promotion**, as that row always was
 * (`objectType: 'promotion'`, `objectId` the promotion's id), with the code as
 * its after-state — a coupon is a platform-global record
 * (`specs/conventions/audit-state.md` §5). A code another coupon already has
 * is refused `409 PROMOTION_COUPON_CODE_TAKEN`; the `code` UNIQUE constraint is
 * the backstop.
 *
 * Hookable (`PROMOTION_HOOKABLE_ACTIONS.createCoupon`): a `beforeCommit` hook is
 * handed the code; the stored `afterCommit` row is not. Not reversible.
 */
export function makeCreateCouponCommand(params: {
  promotionId: string;
  code: string;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}): Command<PromotionCoupon> {
  const { promotionId, code } = params;
  return {
    action: 'coupon.create_single',
    objectType: 'promotion',
    objectId: promotionId,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: (coupon): CouponCreateSingleHookData => ({
      promotionId: coupon.promotionId,
      couponId: coupon.id,
      code: coupon.code,
      limitScope: coupon.limitScope,
    }),
    outboxData: (coupon): CouponCreateSingleOutbox => ({
      promotionId: coupon.promotionId,
      couponId: coupon.id,
      limitScope: coupon.limitScope,
    }),
    run: async ({ em }) => {
      const notFound = (): HttpError =>
        new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${promotionId} not found.`);
      if (!isUuidShape(promotionId)) throw notFound();
      const promotion = await em.findOne(Promotion, { id: promotionId });
      if (!promotion) throw notFound();
      const existing = await em.findOne(PromotionCoupon, { code });
      if (existing) {
        // The coupon's code travels as `couponCode`: `details.code` is the
        // envelope's refusal-token slot (issue #628).
        throw new HttpError(409, ERROR_CODES.PROMOTION_COUPON_CODE_TAKEN, `The coupon code ${code} is already in use.`, {
          couponCode: code,
        });
      }
      const coupon = em.create(PromotionCoupon, {
        promotionId,
        batchId: null,
        code,
        limitScope: 'per_coupon',
        isActive: true,
      });
      await em.persist(coupon).flush();
      return { result: coupon, before: null, after: { code } };
    },
  };
}
