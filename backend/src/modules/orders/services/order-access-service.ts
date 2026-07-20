import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';

/**
 * OrderAccessService (T145).
 *
 * Single home for the Regular User / Organization Admin / Admin User
 * scoping rule from FR-042 / US3. Every read path that needs to filter
 * Orders by who's allowed to see them goes through one of:
 *
 *   - `scopedWhere(ctx)` — partial MikroORM `where` clause that the
 *     caller composes into its own `findOne` / `find` query.
 *   - `assertVisible(em, orderId, ctx)` — narrowing assertion used when
 *     the caller already has an Order and needs to confirm visibility
 *     before mutating it.
 *
 * Out-of-scope reads return *no rows* rather than 403 so the caller can
 * raise 404 — avoids leaking the existence of orders the caller can't
 * see.
 */

export interface OrderScopeContext {
  customerAccountId: string;
  organizationId: string;
}

export class OrderAccessService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async scopedWhere(
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const em = this.emFactory();
    const isAdmin = await this.isOrganizationAdmin(em, ctx.customerAccountId);
    if (isAdmin) {
      // Feature 056 (T032) — an Organization Admin sees "their org(s)". The org
      // predicate is enforced by the always-on tenant filter (feature 050): it
      // resolves to single-org for a normal login and to the org SUBTREE for a
      // roll-up-enabled head-office login. Relying on the ambient filter here
      // (instead of pinning `ctx.organizationId`) preserves single-org behavior
      // byte-for-byte and lets roll-up widen without a second scoping path.
      return { ...extra };
    }
    return {
      ...extra,
      organizationId: ctx.organizationId,
      placedByCustomerAccountId: ctx.customerAccountId,
    };
  }

  /**
   * Convenience for the OrderService inline path that already has an EM
   * fork — saves a second fork and a redundant CustomerAccount lookup
   * when invoked inside an existing transaction.
   */
  async scopedWhereWithEm(
    em: EntityManager,
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const isAdmin = await this.isOrganizationAdmin(em, ctx.customerAccountId);
    if (isAdmin) {
      // Feature 056 (T032) — an Organization Admin sees "their org(s)". The org
      // predicate is enforced by the always-on tenant filter (feature 050): it
      // resolves to single-org for a normal login and to the org SUBTREE for a
      // roll-up-enabled head-office login. Relying on the ambient filter here
      // (instead of pinning `ctx.organizationId`) preserves single-org behavior
      // byte-for-byte and lets roll-up widen without a second scoping path.
      return { ...extra };
    }
    return {
      ...extra,
      organizationId: ctx.organizationId,
      placedByCustomerAccountId: ctx.customerAccountId,
    };
  }

  private async isOrganizationAdmin(
    em: EntityManager,
    customerAccountId: string,
  ): Promise<boolean> {
    const customer = await em.findOne(CustomerAccount, { id: customerAccountId });
    return customer?.role === 'organization_admin';
  }
}
