import { randomInt } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type GenerateCouponsRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';
import { CouponBatch } from '../entities/coupon-batch.entity.js';

/** Hard cap on a single generated batch (avoids a speculative queue, Principle X). */
export const COUPON_BATCH_MAX = 50_000;

const ALPHABETS: Record<GenerateCouponsRequest['format'], string> = {
  // Crockford-ish alphabet — no ambiguous I/O/0/1.
  alnum: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  digits: '0123456789',
  letters: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
};

function randomBody(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function insertDashes(body: string, every: number): string {
  if (!every || every <= 0) return body;
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += every) parts.push(body.slice(i, i + every));
  return parts.join('-');
}

export function buildCouponCode(req: GenerateCouponsRequest): string {
  const body = insertDashes(randomBody(req.length, ALPHABETS[req.format]), req.dashEvery ?? 0);
  return `${req.prefix ?? ''}${body}${req.suffix ?? ''}`;
}

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

  /**
   * Generate a batch of unique coupon codes (US4). Uniqueness is guaranteed
   * in-batch via a Set and cross-batch via a DB existence check + regenerate;
   * the `code` UNIQUE constraint is the final backstop.
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
    const em = this.emFactory();
    const promotion = await em.findOne(Promotion, { id: promotionId });
    if (!promotion) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Promotion ${promotionId} not found.`);
    }

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
        ERROR_CODES.VALIDATION_FAILED,
        'coupon_space_exhausted: increase length or widen the format',
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
    await em.persistAndFlush(batch);
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
    return { batch, generated: candidates.length };
  }

  async listBatchCodes(batchId: string): Promise<string[]> {
    const rows = await this.emFactory().find(
      PromotionCoupon,
      { batchId },
      { orderBy: { createdAt: 'asc' } },
    );
    return rows.map((r) => r.code);
  }
}
