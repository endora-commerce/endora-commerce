import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';

/**
 * The organization permission that widens a buyer's order scope from the
 * orders they placed to every order of their Organization
 * (`specs/170-organization-roles/` FR-049, owner ruling OR-5). Declared in this
 * module's manifest; *Administrator* holds it implicitly, *Member* does not by
 * default.
 */
const ORDERS_VIEW_ORGANIZATION = 'orders.view_organization';

/**
 * OrderAccessService (T145).
 *
 * Single home for the buyer's order scoping rule. Every read path that needs
 * to filter Orders by who's allowed to see them goes through one of the
 * methods below — the list, the detail, reorder, clone to a quote request,
 * and `OrderReadPort.findByIdForCustomer`, which `invoices` serves an order's
 * documents through:
 *
 *   - `scopedWhere(ctx)` — partial MikroORM `where` clause that the
 *     caller composes into its own `findOne` / `find` query.
 *   - `scopedWhereWithEm(em, ctx)` — the same, for a caller inside its own
 *     transaction.
 *
 * The rule (FR-049): a buyer whose role holds `orders.view_organization`
 * sees every order of their Organization; anyone else sees only the orders
 * they placed. The question goes to `organizationPermissionPort`, which fails
 * closed — a role it cannot find holds nothing, so the buyer is pinned.
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
  /**
   * `organizationPermissions` is the port `organizations` publishes, reached
   * through `lazyPort` by the composition root and never captured as a
   * resolved value (`contracts/organization-permission-port.md` §1).
   */
  constructor(private readonly organizationPermissions: OrganizationPermissionPort) {}

  async scopedWhere(
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (await this.viewsOrganization(ctx)) {
      // Feature 056 (T032) — a holder sees "their org(s)". The org
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
   * The `EntityManager` is no longer read (feature 075): the permission is
   * asked of `organizationPermissionPort`, which reads on its owner's
   * manager. The parameter
   * stays so the two call shapes keep their names — deleting it would touch
   * every caller for no behaviour — and the read it saved was of a row this
   * transaction never writes, so nothing depended on sharing the fork.
   */
  async scopedWhereWithEm(
    _em: EntityManager,
    ctx: OrderScopeContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (await this.viewsOrganization(ctx)) {
      // Feature 056 (T032) — a holder sees "their org(s)". The org
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
   * Roll-up never adds a permission: the subject is the buyer's own account in
   * their own Organization; roll-up widens only the tenant filter's reach.
   */
  private viewsOrganization(ctx: OrderScopeContext): Promise<boolean> {
    return this.organizationPermissions.can(
      { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId },
      ORDERS_VIEW_ORGANIZATION,
    );
  }
}
