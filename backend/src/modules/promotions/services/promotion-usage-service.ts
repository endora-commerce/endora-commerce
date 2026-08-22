import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
    // `em.execute`, not `em.getKnex()`: a knex handle carries no transaction
    // context, and this soft check is the read half of the counter its own
    // `finalize` increments inside the placement transaction (D-94). Read on a
    // pooled connection it cannot see an increment the caller's transaction has
    // already made, so a limit met earlier in the same order would not exclude
    // the promotion here (issue #207).
    const em = this.emFactory();
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
        const rows = (await em.execute(
          `select "count" from "promotion_usage_counters"
            where "scope_type" = ? and "scope_key" = ?`,
          [k.type, k.key],
        )) as Array<{ count: number }>;
        const row = rows[0];
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
    /**
     * Every statement below runs on the **caller's** transaction, and since
     * D-94.1 it has to.
     *
     * This used to be `em.getKnex()`, which hands back the raw knex instance —
     * `SqlEntityManager.getKnex()` is `getConnection().getKnex()` and carries
     * no transaction context — so the counter increments and the
     * `promotion_usages` rows were committed the moment they ran, outside the
     * placement transaction that produced them. The method's own doc comment
     * has always said "MUST run inside the order-placement transaction", and
     * only the `throw` honoured it: a cap hit rolled the *order* back and left
     * the counter incremented and a redemption row against an order that never
     * existed. Which is one of the ways the orphans D-94.2 remedy 2 describes
     * came to be, and it stopped being invisible the day
     * `promotion_usages_order_fk` landed — the insert cannot see the
     * uncommitted order and Postgres refuses it.
     *
     * `getConnection().execute(sql, params, method, em.getTransactionContext())`
     * is the house pattern for this (`sales-channels.service.ts`), so the
     * statements are spelled out rather than built with a knex builder that
     * would need binding by hand.
     */
    const conn = em.getConnection();
    const trx = em.getTransactionContext();
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
        await conn.execute(
          `insert into "promotion_usage_counters" ("id", "scope_type", "scope_key", "count")
             values (?, ?, ?, 0)
             on conflict ("scope_type", "scope_key") do nothing`,
          [randomUUID(), g.scopeType, g.scopeKey],
          'run',
          trx,
        );
        // `update … where count < limit` is the race gate (SC-005): two carts
        // going for the last use cannot both affect a row.
        const bumped = await conn.execute<{ affectedRows: number }>(
          `update "promotion_usage_counters"
              set "count" = "count" + 1
            where "scope_type" = ? and "scope_key" = ? and "count" < ?`,
          [g.scopeType, g.scopeKey, g.limit],
          'run',
          trx,
        );
        const affected = bumped.affectedRows;
        if (affected === 0) {
          throw new HttpError(
            409,
            ERROR_CODES.VALIDATION_FAILED,
            `promotion_unavailable: usage limit reached for ${a.promotionId}`,
          );
        }
      }
      await conn.execute(
        `insert into "promotion_usages"
           ("id", "promotion_id", "coupon_id", "order_id", "customer_account_id",
            "organization_id", "customer_group_id", "sales_channel_id",
            "discount_amount", "currency", "created_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict ("order_id", "promotion_id") do nothing`,
        [
          randomUUID(),
          a.promotionId,
          a.couponId ?? null,
          input.orderId,
          input.ctx.customerAccountId ?? null,
          input.ctx.organizationId ?? null,
          input.ctx.customerGroupId ?? null,
          input.ctx.salesChannelId,
          a.amount.toFixed(2),
          input.currency,
          new Date(),
        ],
        'run',
        trx,
      );
    }
  }
}
