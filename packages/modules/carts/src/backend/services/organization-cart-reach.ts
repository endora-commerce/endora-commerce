import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isOrgInScope, withSystemScope } from '@endora-commerce/platform/tenancy';

/**
 * The one way an Organization administrator reads the carts of their
 * Organization's members (issue #619).
 *
 * `Cart` is `@CustomerScoped`: under a signed-in customer's `single-org`
 * context the tenant filter is `customerAccountId = <the caller>`, so the
 * administrator's list, detail, approve and reject read only the carts the
 * administrator owns, and a member's cart — the one the approval screen is for
 * — answered 404. Principle XI makes the Organization the tenant, and a
 * member's cart is inside it; the customer axis of the filter is narrower than
 * the administrator's authority, not a boundary of it.
 *
 * The widening is the sanctioned crossing (`withSystemScope`, feature 050
 * FR-005), audited per call, and it is narrow by construction:
 *
 *  - the caller has already been proven an `organization_admin` of
 *    `organizationId` by the route, out of `customer_accounts`' `@OrgScoped`
 *    read model;
 *  - the Organization is re-checked against the **ambient** tenant context
 *    (`isOrgInScope`) before anything widens, so the crossing can never reach
 *    an Organization the request itself is not scoped to — that refusal is the
 *    same 404 a foreign cart gets, never a 403 (anti-enumeration);
 *  - every statement `fn` runs names `organizationId` in its own `where`, so
 *    the widening adds the Organization's other members and nothing else.
 *
 * Only the read is widened. A caller mutates what it read and flushes in its
 * own context, so the write is attributed to the administrator and not to the
 * system.
 */
export function readOrganizationCarts<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  if (!isOrgInScope(organizationId)) {
    return Promise.reject(new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found'));
  }
  return withSystemScope(
    `carts: an organization administrator reads the member carts of organization ${organizationId}`,
    fn,
  );
}
