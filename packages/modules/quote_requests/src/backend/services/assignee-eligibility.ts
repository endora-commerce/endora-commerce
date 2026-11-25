import {
  ERROR_CODES,
  isUuidShape,
  type AdminTenantScopePort,
  type AdminUserReadPort,
  type PermissionReadPort,
  type SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { holdsRfqHandle, isActiveAdministrator } from './notifications/recipients.js';

/**
 * Issue #1906 — whether an administrator may be made the assignee of a quote
 * request of `organizationId`. **One rule for every path that names an
 * assignee**: a command hook on the buyer's create or resubmit
 * (`QuoteRequestCreateHookData.assign`), the admin route
 * `POST …/:id/assign` and `quoteRequestCommandPort.assign`, and the list of
 * representatives the admin's assignee picker offers. Answers a boolean;
 * {@link assertAssigneeEligible} refuses.
 */
export type AssigneeEligibility = (adminUserId: string, organizationId: string) => Promise<boolean>;

export interface AssigneeEligibilityDeps {
  readonly adminUsers: Pick<AdminUserReadPort, 'findById'>;
  readonly permissions: Pick<PermissionReadPort, 'listPermissions'>;
  /** `organizations`' answer to "which Organizations do this administrator's requests reach". */
  readonly adminTenantScope: Pick<AdminTenantScopePort, 'resolveForAdmin'>;
  readonly salesRepAssignment: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
}

/**
 * Three conditions, each one somebody already applies to this administrator:
 *
 *  1. **active and not deleted** — the operator side of the notifications keeps
 *     no one else (`notifications/recipients.ts`);
 *  2. **holds `rfqs:handle`** (or the wildcard) — the permission the quote
 *     request screens open with, and the operator side's second filter, so an
 *     assignee is someone the "new quote request" notification is sent to;
 *  3. **reaches the request's Organization** — the reach the admin routes apply
 *     to whoever opens the request: the administrator's own tenant scope, from
 *     `adminTenantScopePort` (every Organization, a named set, or — for a sales
 *     representative — the representative reach rule, which is
 *     `canSeeOrganization`'s, roll-up and the unassigned fallback included). An
 *     assignee who would be answered `404` for the request is no assignee.
 *
 * A scope that could not be resolved (`unresolved`: no role) reaches nothing.
 */
export function createAssigneeEligibility(deps: AssigneeEligibilityDeps): AssigneeEligibility {
  return async (adminUserId, organizationId) => {
    const admin = await deps.adminUsers.findById(adminUserId, { activeOnly: true });
    if (!isActiveAdministrator(admin ?? undefined)) return false;
    if (!(await holdsRfqHandle(deps.permissions, adminUserId))) return false;
    const scope = await deps.adminTenantScope.resolveForAdmin(adminUserId);
    if (scope.allowAll) return true;
    if (scope.unresolved) return false;
    if ('reach' in scope) return deps.salesRepAssignment.canSeeOrganization(adminUserId, organizationId);
    return scope.allowedOrganizationIds.includes(organizationId);
  };
}

/**
 * Where an assignee is named: by an operator or a port caller (`assign`), or by
 * a command hook inside a buyer's submission (`submission`), whose refusal
 * reaches the buyer and is worded for them (`errors.RFQ_ASSIGNEE_NOT_ELIGIBLE.submission`).
 */
export type AssigneeRefusalContext = 'assign' | 'submission';

/** The refusal every assignee path answers with (`422 RFQ_ASSIGNEE_NOT_ELIGIBLE`). */
export function assigneeNotEligible(context: AssigneeRefusalContext = 'assign'): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.RFQ_ASSIGNEE_NOT_ELIGIBLE,
    'The assignee must be an active administrator who holds rfqs:handle and reaches the request’s organization.',
    ...(context === 'submission' ? [{ code: 'submission' }] : []),
  );
}

/**
 * Refuse `adminUserId` as the assignee of a request of `organizationId` unless
 * {@link AssigneeEligibility} accepts it. A malformed id is refused before
 * anything is asked. Clearing the assignee (`null`) is not this function's
 * question: its callers do not ask it.
 */
export async function assertAssigneeEligible(
  eligibility: AssigneeEligibility,
  adminUserId: string,
  organizationId: string,
  context: AssigneeRefusalContext = 'assign',
): Promise<void> {
  if (!isUuidShape(adminUserId)) throw assigneeNotEligible(context);
  if (!(await eligibility(adminUserId, organizationId))) throw assigneeNotEligible(context);
}
