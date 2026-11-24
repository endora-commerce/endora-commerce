import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type GenerateCouponsRequest, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';
import type { CouponBatch } from '../entities/coupon-batch.entity.js';
import { recordAuditFromContext, type CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { makeCreateCouponCommand } from '../commands/create-coupon.command.js';
import { makeGenerateCouponBatchCommand } from '../commands/generate-coupon-batch.command.js';
import { COUPON_BATCH_MAX } from './coupon-codes.js';

export { COUPON_BATCH_MAX, buildCouponCode } from './coupon-codes.js';

/**
 * Feature 045 (US3/US4) — coupon management. Single specified coupons land
 * here with a globally-unique `code`; the generator (US4) bulk-inserts into
 * the same table. The engine and the cart coupon flow resolve a presented
 * code to its promotion through `findByCode`.
 */
export class CouponService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Issue #1844 — the two coupon creates are Commands (Principle XIII) and
     * hookable (`PROMOTION_HOOKABLE_ACTIONS`), so they run through the bus,
     * which records their one audit entry and runs the hooks on their
     * transaction. Only `run` is asked of it.
     */
    private readonly commandBus: Pick<CommandBus, 'run'>,
    /** The co-transactional audit sink of the one write that is not a Command yet: `setActiveBulk`. */
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'promotion',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  async listForPromotion(promotionId: string): Promise<PromotionCoupon[]> {
    if (!isUuidShape(promotionId)) return [];
    return this.emFactory().find(
      PromotionCoupon,
      { promotionId },
      { orderBy: { createdAt: 'asc' } },
    );
  }

  async findByCode(code: string): Promise<PromotionCoupon | null> {
    return this.emFactory().findOne(PromotionCoupon, { code, isActive: true });
  }

  /**
   * Bulk activate/deactivate coupons by id, scoped to a promotion so an id from
   * another promotion can never be flipped. Returns the number of rows updated.
   */
  async setActiveBulk(
    promotionId: string,
    couponIds: string[],
    isActive: boolean,
  ): Promise<number> {
    if (couponIds.length === 0) return 0;
    const em = this.emFactory();
    const coupons = await em.find(PromotionCoupon, {
      id: { $in: couponIds },
      promotionId,
    });
    for (const c of coupons) c.isActive = isActive;
    this.#audit(em, 'coupon.set_active_bulk', promotionId, { isActive, count: coupons.length });
    await em.flush();
    return coupons.length;
  }

  /**
   * Create a single specified coupon for a promotion. Rejects duplicates.
   * The `coupon.create_single` Command.
   */
  async createSingle(promotionId: string, code: string): Promise<PromotionCoupon> {
    return this.commandBus.run(makeCreateCouponCommand({ promotionId, code }));
  }

  /**
   * Generate a batch of unique coupon codes (US4) — the `coupon.generate_batch`
   * Command. A batch over the bound is refused before the Command runs.
   */
  async generateBatch(
    promotionId: string,
    req: GenerateCouponsRequest,
  ): Promise<{ batch: CouponBatch; generated: number }> {
    if (req.count > COUPON_BATCH_MAX) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `batch_too_large: max ${COUPON_BATCH_MAX} per batch`,
      );
    }
    const { batch, generated } = await this.commandBus.run(
      makeGenerateCouponBatchCommand({ promotionId, request: req }),
    );
    return { batch, generated };
  }

  async listBatchCodes(batchId: string): Promise<string[]> {
    if (!isUuidShape(batchId)) return [];
    const rows = await this.emFactory().find(
      PromotionCoupon,
      { batchId },
      { orderBy: { createdAt: 'asc' } },
    );
    return rows.map((r) => r.code);
  }
}
