import { commerceAbilities } from '../commerce-permissions';
import type { OrganizationPermissionSession } from '../organization-permissions';

/**
 * The order detail's two "order again" actions (`specs/170-organization-roles/` WP-16; FR-030,
 * FR-040, FR-057), judged by what each builds, as the backend's guards judge them
 * (`contracts/storefront-api.md` §5): the reorder replaces the active cart (`carts.create`), the
 * clone creates a quote request (`quote_requests.create`). The rules are `commerceAbilities`' —
 * the same flags the cart and the quote-request buttons read elsewhere.
 *
 * `null` is a session `/api/v1/me` did not answer for: both stay offered, as before roles, and
 * the server is the gate.
 */
export interface OrderBuyerActions {
  /** *Order again → cart* — `carts.create`. */
  readonly reorder: boolean;
  /** *Order again → quote request* — `quote_requests.create`. */
  readonly cloneToQuote: boolean;
}

export function orderBuyerActions(session: OrganizationPermissionSession | null | undefined): OrderBuyerActions {
  const abilities = commerceAbilities(session);
  return { reorder: abilities.editCart, cloneToQuote: abilities.requestQuote };
}
