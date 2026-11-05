import { can, isAdministrator, type OrganizationPermissionSession } from '../organization-permissions';

/**
 * Where a completed Organization cart's order link points, if the viewer may
 * follow it (owner ruling on PR #760, issue #751). `null` keeps the empty cell.
 *
 * The order page answers the order's own buyer and a role holding
 * `orders.view_organization` (the Administrator among them); anyone else gets
 * "not found", so the link is offered only to those (FR-049). Presentation
 * only: the order API is the boundary.
 */
export function orgCartOrderHref(
  cart: { readonly status: string; readonly orderId: string | null; readonly ownerCustomerAccountId: string | null },
  viewer: OrganizationPermissionSession & { readonly id: string },
): string | null {
  if (cart.status !== 'completed' || !cart.orderId) return null;
  const opens =
    isAdministrator(viewer) ||
    can(viewer, 'orders.view_organization') ||
    cart.ownerCustomerAccountId === viewer.id;
  return opens ? `/orders/${encodeURIComponent(cart.orderId)}` : null;
}
