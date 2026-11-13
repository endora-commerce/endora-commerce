import { describe, expect, it, vi } from 'vitest';
import { RfqService } from './rfq-service.js';
import { createRecipientResolver } from './notifications/recipients.js';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-03 (T022, research R-3) — the
 * storefront's "who sees every quote request of the Organization" and the
 * customer-side recipient rule are **one** function, `orgWideViewerRoleIds`.
 * Telling a member about a request the storefront answers them `404` for would
 * disclose it, so the two must move together when `specs/170-organization-roles/`
 * P3 re-points the rule at `quote_requests.approve`.
 */

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ADMIN_ROLE = '00000000-0000-4000-8000-0000000000f1';
const MEMBER_ROLE = '00000000-0000-4000-8000-0000000000f2';
const REQUESTER = '00000000-0000-4000-8000-0000000000c1';
const COLLEAGUE = '00000000-0000-4000-8000-0000000000c2';
const RFQ = '00000000-0000-4000-8000-0000000000b1';

function rig() {
  const orgWideViewerRoleIds = vi.fn(async (_organizationId: string) => [ADMIN_ROLE] as readonly string[]);
  const find = vi.fn(async () => []);
  const findOne = vi.fn(async () => ({ id: RFQ, organizationId: ORG, customerAccountId: COLLEAGUE }));
  const findInOrganization = vi.fn(async (id: string) => ({
    id,
    organizationId: ORG,
    organizationRoleId: id === REQUESTER ? MEMBER_ROLE : ADMIN_ROLE,
  }));
  const service = new RfqService({
    emFactory: () => ({ find, findOne }),
    customerAccounts: { findInOrganization },
    orgWideViewerRoleIds,
  } as never);
  const resolver = createRecipientResolver({
    orgWideViewerRoleIds,
    customerAccounts: {
      listByOrganization: async () => [
        { id: REQUESTER, organizationId: ORG, organizationRoleId: MEMBER_ROLE, deletedAt: null, blockedAt: null, anonymizedAt: null },
      ],
    },
    salesRepAssignment: { listForOrganization: async () => [] },
    adminUsers: { findByIds: async () => [], listAll: async () => [] },
    permissions: { listPermissions: async () => [] },
  } as never);
  return { service, resolver, orgWideViewerRoleIds, find, findInOrganization };
}

describe('one rule, two callers — #seesOrganization and the customer-side recipients', () => {
  it('both ask orgWideViewerRoleIds of the Organization', async () => {
    const { service, resolver, orgWideViewerRoleIds } = rig();
    await service.listVisibleForCustomer({ customerAccountId: COLLEAGUE, organizationId: ORG, organizationRoleId: ADMIN_ROLE });
    await resolver.customerSide({ id: RFQ, organizationId: ORG, customerAccountId: REQUESTER, assignedAdminUserId: null });
    expect(orgWideViewerRoleIds).toHaveBeenCalledTimes(2);
    expect(orgWideViewerRoleIds.mock.calls).toEqual([[ORG], [ORG]]);
  });

  it('a role the rule names sees the whole Organization; any other sees only its own requests', async () => {
    const { service, find } = rig();
    await service.listVisibleForCustomer({ customerAccountId: COLLEAGUE, organizationId: ORG, organizationRoleId: ADMIN_ROLE });
    expect(find).toHaveBeenLastCalledWith(expect.anything(), {}, expect.anything());
    await service.listVisibleForCustomer({ customerAccountId: REQUESTER, organizationId: ORG, organizationRoleId: MEMBER_ROLE });
    expect(find).toHaveBeenLastCalledWith(expect.anything(), { customerAccountId: REQUESTER }, expect.anything());
  });

  it('a caller whose context carries no role is judged by its account’s role in that Organization', async () => {
    const { service, findInOrganization } = rig();
    await expect(
      service.getForCustomer(RFQ, { customerAccountId: REQUESTER, organizationId: ORG }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(findInOrganization).toHaveBeenCalledWith(REQUESTER, ORG);
  });

  it('a role of another Organization is not a viewer role here', async () => {
    const { service, find } = rig();
    await service.listVisibleForCustomer({
      customerAccountId: COLLEAGUE,
      organizationId: ORG,
      organizationRoleId: '00000000-0000-4000-8000-0000000000f9',
    });
    expect(find).toHaveBeenLastCalledWith(expect.anything(), { customerAccountId: COLLEAGUE }, expect.anything());
  });
});
