import type { PermissionReadPort } from '@endora-commerce/contracts';
import { actingAdminUserId } from './opportunity-assignment-service.js';

/** The permission `orders` gates its own read surface with (its manifest's `orders:read`). */
export const ORDERS_READ_PERMISSION = 'orders:read';

/** Whether whoever is behind the request may read Orders. */
export type OrdersReadCheck = () => Promise<boolean>;

/**
 * What a linked Order shows is `orders`' data, and `crm:read` is not a
 * permission to read it (`specs/143-crm-sales-opportunities/research.md`
 * N-R3): number, status and total are rendered only for a caller who also
 * holds `orders:read`; anybody else sees that a document is linked, and no
 * more. The system — a subscriber, a worker — is nobody's session and is not
 * narrowed.
 *
 * A function rather than a literal at the composition site, as the notifier is
 * and for its reason: `check:port-catches` follows the port through the value.
 */
export function createOrdersReadCheck(permissions: PermissionReadPort): OrdersReadCheck {
  return async () => {
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) return true;
    const held = await permissions.listPermissions(adminUserId);
    return held.includes('*') || held.includes(ORDERS_READ_PERMISSION);
  };
}
