import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort } from '@b2b/contracts';

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
  constructor(private readonly customerAccountRead: CustomerAccountReadPort) {}

  async scopedWhere(
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const isAdmin = await this.isOrganizationAdmin(ctx.customerAccountId);
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
   * The variant `OrderService` calls from inside its own transaction.
   *
   * The `EntityManager` is no longer read (feature 075): the role lives in
   * `customer_accounts`' table and is asked for through
   * `customerAccountReadPort`, which runs on the owner's manager. The parameter
   * stays so the two call shapes keep their names — deleting it would touch
   * every caller for no behaviour — and the read it saved was of a row this
   * transaction never writes, so nothing depended on sharing the fork.
   */
  async scopedWhereWithEm(
    _em: EntityManager,
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const isAdmin = await this.isOrganizationAdmin(ctx.customerAccountId);
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

  private async isOrganizationAdmin(customerAccountId: string): Promise<boolean> {
    const customer = await this.customerAccountRead.findById(customerAccountId);
    return customer?.role === 'organization_admin';
  }
}
