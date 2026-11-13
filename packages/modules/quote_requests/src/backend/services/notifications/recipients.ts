import type {
  AdminUserReadPort,
  AdminUserRecord,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationRoleReadPort,
  PermissionReadPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import type { NotificationRecipientResolver } from '../rfq-notification-service.js';

/** The admin permission a quote request's operator screens open with. */
export const RFQ_HANDLE_PERMISSION = 'rfqs:handle';

/**
 * The Organization roles whose holders see **every** quote request of that
 * Organization — `specs/179-rfq-and-customer-notifications/` research R-3.
 *
 * One function, two callers: the storefront's visibility check
 * (`RfqService#seesOrganization`) and the customer-side recipient rule below.
 * Telling a member about a request they get a `404` for would disclose it, so
 * the two must never drift apart. Until `specs/170-organization-roles/` P3 it
 * is the Organization's predefined *Administrator* role; P3 re-points it at
 * `organizationPermissionPort.rolesHolding(organizationId, 'quote_requests.approve')`
 * (research R-22), here and nowhere else.
 */
export async function orgWideViewerRoleIds(
  roles: Pick<OrganizationRoleReadPort, 'predefinedRoleId'>,
  organizationId: string,
): Promise<readonly string[]> {
  return [await roles.predefinedRoleId(organizationId, 'administrator')];
}

/** {@link orgWideViewerRoleIds} bound to its port — the shape both callers receive. */
export type OrgWideViewerRoleIds = (organizationId: string) => Promise<readonly string[]>;

export interface RecipientResolverDeps {
  orgWideViewerRoleIds: OrgWideViewerRoleIds;
  customerAccounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  salesRepAssignment: Pick<SalesRepAssignmentPort, 'listForOrganization'>;
  adminUsers: Pick<AdminUserReadPort, 'findByIds' | 'listAll'>;
  permissions: Pick<PermissionReadPort, 'listPermissions'>;
}

/** A customer account that can still be told anything: not deleted, blocked or anonymised. */
function isLiveAccount(account: CustomerAccountRecord): boolean {
  return account.deletedAt === null && account.blockedAt === null && account.anonymizedAt === null;
}

/** An administrator who may act at all: `active` and not deleted. */
function isActiveAdministrator(admin: AdminUserRecord | undefined): admin is AdminUserRecord {
  return admin !== undefined && admin.status === 'active' && admin.deletedAt === null;
}

/**
 * Who stands on each side of a quote request when a change commits —
 * `specs/179-rfq-and-customer-notifications/` FR-004, FR-005, matrix rules 1
 * and 4. Every read goes through a published port of its owner
 * (`customer_accounts`, `organizations`, `admin_users`, `admin_roles`).
 *
 * **Customer side** (research R-3, owner ruling Q3): the requester and every
 * member of the request's Organization whose role is one of
 * {@link orgWideViewerRoleIds}, each kept only while their account is live. The
 * requester counts only while still a member of the request's Organization —
 * the storefront would no longer show it to them otherwise. A personal
 * Organization therefore answers the requester alone.
 *
 * **Operator side** (research R-5, owner ruling Q6): the request's assignee and
 * the Organization's assigned representatives, each kept only while active
 * and holding `rfqs:handle` (the wildcard role included, as `requireAdmin`
 * judges it); when none remains, every active administrator holding it.
 *
 * Both answers are de-duplicated and in a stable order: the requester first,
 * then members as `listByOrganization` orders them; the assignee first, then
 * representatives in assignment order.
 */
export function createRecipientResolver(deps: RecipientResolverDeps): NotificationRecipientResolver {
  const holdsHandle = async (adminUserId: string): Promise<boolean> => {
    const held = await deps.permissions.listPermissions(adminUserId);
    return held.includes('*') || held.includes(RFQ_HANDLE_PERMISSION);
  };

  const handlers = async (admins: readonly AdminUserRecord[]): Promise<string[]> => {
    const kept: string[] = [];
    for (const admin of admins) {
      if (isActiveAdministrator(admin) && (await holdsHandle(admin.id))) kept.push(admin.id);
    }
    return kept;
  };

  return {
    async customerSide(rfq) {
      const [members, viewerRoles] = await Promise.all([
        deps.customerAccounts.listByOrganization(rfq.organizationId, { activeOnly: true }),
        deps.orgWideViewerRoleIds(rfq.organizationId),
      ]);
      const live = members.filter((member) => member.organizationId === rfq.organizationId && isLiveAccount(member));
      const recipients: string[] = [];
      if (live.some((member) => member.id === rfq.customerAccountId)) recipients.push(rfq.customerAccountId);
      for (const member of live) {
        if (member.id === rfq.customerAccountId) continue;
        if (viewerRoles.includes(member.organizationRoleId)) recipients.push(member.id);
      }
      return recipients;
    },

    async operatorSide(rfq) {
      const assignments = await deps.salesRepAssignment.listForOrganization(rfq.organizationId);
      const candidates = [rfq.assignedAdminUserId, ...assignments.map((assignment) => assignment.adminUserId)].filter(
        (id, index, all): id is string => typeof id === 'string' && all.indexOf(id) === index,
      );
      if (candidates.length > 0) {
        const byId = new Map(
          (await deps.adminUsers.findByIds(candidates, { activeOnly: true })).map((admin) => [admin.id, admin]),
        );
        const kept = await handlers(
          candidates.map((id) => byId.get(id)).filter((admin): admin is AdminUserRecord => admin !== undefined),
        );
        if (kept.length > 0) return kept;
      }
      return handlers(await deps.adminUsers.listAll({ activeOnly: true }));
    },
  };
}
