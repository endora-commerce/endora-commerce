import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Promotion } from '../entities/promotion.entity.js';
import { PromotionCoupon } from '../entities/promotion-coupon.entity.js';

/**
 * Feature 045 (US5) — usage-limit enforcement.
 *
 * `filterExhausted` is the soft, best-effort gate used during cart pricing.
 * `finalize` is the hard, atomic gate run INSIDE the order-placement
 * transaction: counters are bumped with `UPDATE ... WHERE count < limit`, so
 * two carts racing for the final use can never both succeed (SC-005). It also
 * appends the `promotion_usages` rows that feed the statistics aggregates.
 */

export interface UsageContext {
  organizationId: string | null;
  customerAccountId: string | null;
  customerGroupId: string | null;
  /**
   * The channel the order was placed through. Non-nullable (D-48): the one
   * caller is `placeOrder`, which stamps the same id onto the order, and
   * `promotion_usages.sales_channel_id` is `uuid not null`. It used to be
   * `string | null` with a `?? randomUUID()` at the insert — issue #85's shape,
   * one table over: a fabricated id in a column the statistics aggregates
   * group by, so a usage row could never be joined back to a channel.
   */
  salesChannelId: string;
}

export interface FinalizeAppliedPromotion {
  promotionId: string;
  couponId: string | null;
  amount: number;
}

interface CounterGuard {
  scopeType: 'global' | 'organization' | 'customer' | 'coupon' | 'batch';
  scopeKey: string;
  limit: number;
}

function buildGuards(
  p: Promotion,
  coupon: PromotionCoupon | null,
  ctx: UsageContext,
): CounterGuard[] {
  const guards: CounterGuard[] = [];
  if (p.usageLimitGlobal != null) {
    // The per-coupon vs shared-batch choice scopes the global pool (FR-028).
    if (coupon && coupon.limitScope === 'per_coupon') {
      guards.push({ scopeType: 'coupon', scopeKey: coupon.id, limit: p.usageLimitGlobal });
    } else if (coupon && coupon.limitScope === 'shared_batch') {
      guards.push({ scopeType: 'batch', scopeKey: coupon.batchId ?? coupon.id, limit: p.usageLimitGlobal });
    } else {
      guards.push({ scopeType: 'global', scopeKey: p.id, limit: p.usageLimitGlobal });
    }
  }
  if (p.usageLimitPerOrganization != null && ctx.organizationId) {
    guards.push({
      scopeType: 'organization',
      scopeKey: `${p.id}:${ctx.organizationId}`,
      limit: p.usageLimitPerOrganization,
    });
  }
  if (p.usageLimitPerCustomer != null && ctx.customerAccountId) {
    guards.push({
      scopeType: 'customer',
      scopeKey: `${p.id}:${ctx.customerAccountId}`,
      limit: p.usageLimitPerCustomer,
    });
  }
  return guards;
}

export class PromotionUsageService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Soft check (best-effort) — returns the set of promotion ids whose
   * promotion-level limits are already met for this context, so the resolver
   * can exclude them. The authoritative gate is `finalize`.
   */
  async filterExhausted(
    candidates: Promotion[],
    ctx: { organizationId: string | null; customerAccountId: string | null },
  ): Promise<Set<string>> {
    const exhausted = new Set<string>();
    const withLimits = candidates.filter(
      (p) =>
        p.usageLimitGlobal != null ||
        p.usageLimitPerOrganization != null ||
        p.usageLimitPerCustomer != null,
    );
    if (withLimits.length === 0) return exhausted;
    const knex = this.emFactory().getKnex();
    for (const p of withLimits) {
      const keys: Array<{ type: string; key: string; limit: number }> = [];
      if (p.usageLimitGlobal != null) keys.push({ type: 'global', key: p.id, limit: p.usageLimitGlobal });
      if (p.usageLimitPerOrganization != null && ctx.organizationId) {
        keys.push({
          type: 'organization',
          key: `${p.id}:${ctx.organizationId}`,
          limit: p.usageLimitPerOrganization,
        });
      }
      if (p.usageLimitPerCustomer != null && ctx.customerAccountId) {
        keys.push({
          type: 'customer',
          key: `${p.id}:${ctx.customerAccountId}`,
          limit: p.usageLimitPerCustomer,
        });
      }
      for (const k of keys) {
        const row = (await knex('promotion_usage_counters')
          .where({ scope_type: k.type, scope_key: k.key })
          .first()) as { count: number } | undefined;
        if (row && row.count >= k.limit) {
          exhausted.add(p.id);
          break;
        }
      }
    }
    return exhausted;
  }

  /**
   * Hard gate — call INSIDE the order-placement transaction (`em` is the tx
   * EntityManager). Atomically bumps each scope counter; throws 409 if any cap
   * is hit so the surrounding transaction rolls back. Appends usage rows.
   */
  async finalize(
    em: EntityManager,
    input: { orderId: string; currency: string; ctx: UsageContext; applied: FinalizeAppliedPromotion[] },
  ): Promise<void> {
    if (input.applied.length === 0) return;
    const knex = em.getKnex();
    const promoIds = input.applied.map((a) => a.promotionId);
    const promos = await em.find(Promotion, { id: { $in: promoIds } });
    const promoById = new Map(promos.map((p) => [p.id, p]));
    const couponIds = input.applied.map((a) => a.couponId).filter((c): c is string => !!c);
    const coupons = couponIds.length > 0 ? await em.find(PromotionCoupon, { id: { $in: couponIds } }) : [];
    const couponById = new Map(coupons.map((c) => [c.id, c]));

    for (const a of input.applied) {
      const p = promoById.get(a.promotionId);
      if (!p) continue;
      const coupon = a.couponId ? (couponById.get(a.couponId) ?? null) : null;
      for (const g of buildGuards(p, coupon, input.ctx)) {
        await knex('promotion_usage_counters')
          .insert({ id: randomUUID(), scope_type: g.scopeType, scope_key: g.scopeKey, count: 0 })
          .onConflict(['scope_type', 'scope_key'])
          .ignore();
        const affected = await knex('promotion_usage_counters')
          .where({ scope_type: g.scopeType, scope_key: g.scopeKey })
          .andWhere('count', '<', g.limit)
          .increment('count', 1);
        if (affected === 0) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            `promotion_unavailable: usage limit reached for ${a.promotionId}`,
          );
        }
      }
      await knex('promotion_usages')
        .insert({
          id: randomUUID(),
          promotion_id: a.promotionId,
          coupon_id: a.couponId ?? null,
          order_id: input.orderId,
          customer_account_id: input.ctx.customerAccountId ?? null,
          organization_id: input.ctx.organizationId ?? null,
          customer_group_id: input.ctx.customerGroupId ?? null,
          sales_channel_id: input.ctx.salesChannelId,
          discount_amount: a.amount.toFixed(2),
          currency: input.currency,
          created_at: new Date(),
        })
        .onConflict(['order_id', 'promotion_id'])
        .ignore();
    }
  }
}
