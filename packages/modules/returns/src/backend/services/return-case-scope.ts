import type { OrganizationPermissionPort } from '@endora-commerce/contracts';

/**
 * The organization permission that widens a buyer's case scope from the cases
 * they filed to every case of their Organization
 * (`specs/170-organization-roles/` FR-053, owner ruling OR-11). Declared in
 * this module's manifest; *Administrator* holds it implicitly, *Member* does
 * not by default.
 */
const RETURNS_VIEW_ORGANIZATION = 'returns.view_organization';

/**
 * Who is asking, on a buyer route. Read off the request's customer actor:
 * `organizationRoleId` saves the permission port a read when the auth hook
 * stamped it (research R-15). `organizationId` is `null` for an account that
 * presents without an Organization; such a caller holds no organization
 * permission and reaches no order, so it keeps exactly its own cases.
 */
export interface ReturnCustomerContext {
  readonly customerAccountId: string;
  readonly organizationId: string | null;
  readonly organizationRoleId?: string | null;
}

/**
 * ReturnCaseScope — the single home, inside this module, of the buyer's case
 * scoping rule (research R-41 item 3). It is `orders`' `OrderAccessService`
 * rule applied to cases, and the two must not disagree:
 *
 *   - a buyer whose role holds `returns.view_organization` sees every case of
 *     their Organization. No Organization predicate is added: the always-on
 *     tenant filter draws that line — single-org for a normal login, the
 *     subtree for a roll-up head-office login — so roll-up widens *where* the
 *     permission reaches and never adds the permission itself;
 *   - anyone else sees only the cases they filed, which is every buyer's reach
 *     before feature 170.
 *
 * It answers a `where` clause rather than rows, so an out-of-scope case is "no
 * row" and the caller's `404 NOT_FOUND`, never a `403` (Principle XI).
 *
 * It scopes the **list and the read** only. The follow-up actions on a case —
 * comments, attachments, the return delivery method, cancelling — stay the
 * filer's and keep their `{ id, customerAccountId }` lookups (owner's answer
 * to Q-R2: A).
 */
export class ReturnCaseScope {
  /**
   * `organizationPermissions` is the port `organizations` publishes, reached
   * through `lazyPort` by the composition and never captured as a resolved
   * value (`contracts/organization-permission-port.md` §1). It fails closed: a
   * role it cannot find holds nothing, so the buyer is pinned to their own.
   */
  constructor(private readonly organizationPermissions: OrganizationPermissionPort) {}

  async where(
    customer: ReturnCustomerContext,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (await this.viewsOrganization(customer)) return { ...extra };
    return { ...extra, customerAccountId: customer.customerAccountId };
  }

  private async viewsOrganization(customer: ReturnCustomerContext): Promise<boolean> {
    if (!customer.organizationId) return false;
    return this.organizationPermissions.can(
      {
        customerAccountId: customer.customerAccountId,
        organizationId: customer.organizationId,
        organizationRoleId: customer.organizationRoleId ?? null,
      },
      RETURNS_VIEW_ORGANIZATION,
    );
  }
}
