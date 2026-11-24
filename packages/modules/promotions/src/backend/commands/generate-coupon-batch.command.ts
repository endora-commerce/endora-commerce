import {
  ERROR_CODES,
  isUuidShape,
  type CouponGenerateBatchHookData,
  type CouponGenerateBatchOutbox,
  type GenerateCouponsRequest,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CouponBatch } from '../entities/coupon-batch.entity.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';
import { buildCouponCode } from '../services/coupon-codes.js';

export interface GenerateCouponBatchResult {
  readonly batch: CouponBatch;
  /** How many coupons the batch inserted. */
  readonly generated: number;
  /** The inserted codes, in insertion order. */
  readonly codes: readonly string[];
}

/**
 * `coupon.generate_batch` — an operator generates a batch of unique coupon
 * codes for a promotion (feature 045, US4; a Command since issue #1844, the
 * write `CouponService.generateBatch` made by hand with a co-transactional
 * audit row until then).
 *
 * Uniqueness is guaranteed in-batch via a Set and cross-batch via a database
 * existence check and regeneration; the `code` UNIQUE constraint is the final
 * backstop. Recorded against the **promotion**, with the batch id and the count
 * as its after-state, as it always was. The batch bound (`COUPON_BATCH_MAX`) is
 * checked by `CouponService` before the Command runs.
 *
 * Hookable (`PROMOTION_HOOKABLE_ACTIONS.generateCouponBatch`): a `beforeCommit`
 * hook is handed the codes; the stored `afterCommit` row carries the batch id,
 * the count and the limit scope only. Not reversible.
 */
export function makeGenerateCouponBatchCommand(params: {
  promotionId: string;
  request: GenerateCouponsRequest;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}): Command<GenerateCouponBatchResult> {
  const { promotionId, request: req } = params;
  return {
    action: 'coupon.generate_batch',
    objectType: 'promotion',
    objectId: promotionId,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: ({ batch, generated, codes }): CouponGenerateBatchHookData => ({
      promotionId: batch.promotionId,
      batchId: batch.id,
      generated,
      limitScope: batch.limitScope,
      codes: [...codes],
    }),
    outboxData: ({ batch, generated }): CouponGenerateBatchOutbox => ({
      promotionId: batch.promotionId,
      batchId: batch.id,
      generated,
      limitScope: batch.limitScope,
    }),
    run: async ({ em }) => {
      const notFound = (): HttpError =>
        new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${promotionId} not found.`);
      if (!isUuidShape(promotionId)) throw notFound();
      const promotion = await em.findOne(Promotion, { id: promotionId });
      if (!promotion) throw notFound();

      // Generate unique-within-batch codes.
      const codes = new Set<string>();
      let guard = 0;
      const maxAttempts = req.count * 20 + 100;
      while (codes.size < req.count && guard < maxAttempts) {
        codes.add(buildCouponCode(req));
        guard += 1;
      }
      if (codes.size < req.count) {
        throw new HttpError(
          400,
          ERROR_CODES.PROMOTION_COUPON_SPACE_EXHAUSTED,
          `Only ${codes.size} of ${req.count} unique codes fit this length and format.`,
          { requested: req.count, generated: codes.size },
        );
      }

      // Drop any that already exist in the DB, then regenerate replacements.
      let candidates = [...codes];
      const existing = await em.find(PromotionCoupon, { code: { $in: candidates } });
      if (existing.length > 0) {
        const taken = new Set(existing.map((c) => c.code));
        const fresh = new Set(candidates.filter((c) => !taken.has(c)));
        while (fresh.size < req.count && guard < maxAttempts) {
          const c = buildCouponCode(req);
          if (!taken.has(c)) fresh.add(c);
          guard += 1;
        }
        candidates = [...fresh];
      }

      const batch = em.create(CouponBatch, {
        promotionId,
        count: req.count,
        length: req.length,
        format: req.format,
        prefix: req.prefix ?? null,
        suffix: req.suffix ?? null,
        dashEvery: req.dashEvery ?? 0,
        limitScope: req.limitScope,
      });
      // Flush the batch first so the coupons' batch_id FK is satisfied (the
      // coupon entity has no ORM relation, so insert order isn't inferred).
      await em.persist(batch).flush();
      for (const code of candidates) {
        em.persist(
          em.create(PromotionCoupon, {
            promotionId,
            batchId: batch.id,
            code,
            limitScope: req.limitScope,
            isActive: true,
          }),
        );
      }
      await em.flush();
      return {
        result: { batch, generated: candidates.length, codes: candidates },
        before: null,
        after: { batchId: batch.id, generated: candidates.length },
      };
    },
  };
}
