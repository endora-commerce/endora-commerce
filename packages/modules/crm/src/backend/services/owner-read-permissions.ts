import { ERROR_CODES, type PermissionReadPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { actingAdminUserId } from './opportunity-assignment-service.js';

/** The permission `orders` gates its own read surface with (its manifest's `orders:read`). */
export const ORDERS_READ_PERMISSION = 'orders:read';

/**
 * The permission `quote_requests` gates its admin list and detail with. That
 * module declares one code, the right to handle quotes, and reads are behind
 * it too — so it is what "may read a Quote Request" means.
 */
export const QUOTE_REQUESTS_READ_PERMISSION = 'rfqs:handle';

/** The permission `catalog` gates its admin product reads with. */
export const CATALOG_READ_PERMISSION = 'catalog:read';

/** Whether whoever is behind the request may read what one other module owns. */
export type OwnerReadCheck = () => Promise<boolean>;

/** The checks a service that renders another module's data is handed. */
export interface OwnerReadChecks {
  /** `orders:read` — an Order's number, status, total and currency. */
  orders: OwnerReadCheck;
  /** `rfqs:handle` — a Quote Request's number, status and amount. */
  quoteRequests: OwnerReadCheck;
  /** `catalog:read` — a Product's name. */
  products: OwnerReadCheck;
}

/**
 * What a linked or mentioned document shows is its owner's data, and
 * `crm:read` is not a permission to read it
 * (`specs/143-crm-sales-opportunities/research.md` N-R3, N-R13): the number,
 * status and total of an Order are rendered only for a caller who also holds
 * `orders:read`, those of a Quote Request for one who holds `rfqs:handle`, and
 * a Product's name for one who holds `catalog:read`. Anybody else sees that a
 * document is linked, or that something is mentioned, and no more. The system —
 * a subscriber, a worker — is nobody's session and is not narrowed.
 *
 * Functions rather than literals at the composition site, as the notifier is
 * and for its reason: `check:port-catches` follows the port through the value.
 */
export function createOwnerReadCheck(permissions: PermissionReadPort, permission: string): OwnerReadCheck {
  return async () => {
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) return true;
    const held = await permissions.listPermissions(adminUserId);
    return held.includes('*') || held.includes(permission);
  };
}

/**
 * 403 for a caller who asks for something of a Quote Request without the code
 * that module reads one with.
 *
 * **Asked by a service, after `quote_requests`' presence is decided — never by
 * a `requireAdmin` on a route.** That module can be switched off, and while it
 * is off its code cannot be granted to anybody: a route gate naming it would
 * answer 403 where the contract says 503 `MODULE_DISABLED`, and is the shape
 * the platform's foreign-gate sweep refuses (D-173). `orders` cannot be
 * switched off, so its code is asked on the route.
 */
export async function assertMayReadQuoteRequests(check: OwnerReadCheck): Promise<void> {
  if (await check()) return;
  throw new HttpError(
    403,
    ERROR_CODES.FORBIDDEN,
    'This needs the permission to handle quote requests as well.',
  );
}

export function createOwnerReadChecks(permissions: PermissionReadPort): OwnerReadChecks {
  return {
    orders: createOwnerReadCheck(permissions, ORDERS_READ_PERMISSION),
    quoteRequests: createOwnerReadCheck(permissions, QUOTE_REQUESTS_READ_PERMISSION),
    products: createOwnerReadCheck(permissions, CATALOG_READ_PERMISSION),
  };
}
