import { ADMIN_PERMISSION_WILDCARD, type PermissionReadPort } from '@endora-commerce/contracts';
import { actingAdminUserId } from './task-access.js';
import { isSystemActor } from './task-visibility.js';

/**
 * What a referenced or linked record shows is its owner's data, and
 * `tasks:read` is not a permission to read it (`specs/165-task-management/`
 * research R-5, R-16 — a copy of Projects' `owner-read-permissions.ts`, not an
 * import: the platform surface is deliberately narrow and the shape is a few
 * lines).
 *
 * An Order is named only to a caller who also holds `orders:read`, a Product
 * to one holding `catalog:read`, a Quote Request to one holding `rfqs:handle`
 * (that module's one code, which gates its reads too), an Opportunity to one
 * holding `crm:read` and a Project to one holding `projects:read`. Anybody else
 * sees that a record is referenced, and no more. The system actor — a worker —
 * is nobody's session and is not narrowed; any other caller without an
 * administrator behind it is answered no.
 *
 * **Asked by a service, after the owner's presence is decided** — never as a
 * `requireAdmin` on a route for a switchable owner: while that module is off
 * its code cannot be granted to anybody, and a route gate naming it would
 * answer 403 where the contract says 503 (D-173).
 */

export const ORDERS_READ_PERMISSION = 'orders:read';
export const CATALOG_READ_PERMISSION = 'catalog:read';
export const QUOTE_REQUESTS_READ_PERMISSION = 'rfqs:handle';
export const CRM_READ_PERMISSION = 'crm:read';
export const PROJECTS_READ_PERMISSION = 'projects:read';
/**
 * This module's own read code. `TaskVisibility` leaves it to the routes, so a
 * question asked behind another module's gate — which Tasks the asset library
 * may show a file of (`specs/166-asset-reference-visibility/` FR-002) — asks it
 * here: a reader without it sees no Task.
 */
export const TASKS_READ_PERMISSION = 'tasks:read';
/** `custom_fields`' read permission: a Task's custom-field values in its history (#470, feature 162 P2 = a). */
export const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

/** Whether whoever is behind the request may read what one other module owns. */
export type OwnerReadCheck = () => Promise<boolean>;

/** The checks a service that renders another module's data is handed. */
export interface OwnerReadChecks {
  orders: OwnerReadCheck;
  products: OwnerReadCheck;
  quoteRequests: OwnerReadCheck;
  opportunities: OwnerReadCheck;
  projects: OwnerReadCheck;
  customFields: OwnerReadCheck;
}

/**
 * One check. A function rather than a literal at the composition site:
 * `check:port-catches` follows the port through the value.
 */
export function createOwnerReadCheck(permissions: PermissionReadPort, permission: string): OwnerReadCheck {
  return async () => {
    const adminUserId = actingAdminUserId();
    if (adminUserId === null) return isSystemActor();
    const held = await permissions.listPermissions(adminUserId);
    return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(permission);
  };
}

export function createOwnerReadChecks(permissions: PermissionReadPort): OwnerReadChecks {
  return {
    orders: createOwnerReadCheck(permissions, ORDERS_READ_PERMISSION),
    products: createOwnerReadCheck(permissions, CATALOG_READ_PERMISSION),
    quoteRequests: createOwnerReadCheck(permissions, QUOTE_REQUESTS_READ_PERMISSION),
    opportunities: createOwnerReadCheck(permissions, CRM_READ_PERMISSION),
    projects: createOwnerReadCheck(permissions, PROJECTS_READ_PERMISSION),
    customFields: createOwnerReadCheck(permissions, CUSTOM_FIELDS_READ_PERMISSION),
  };
}
