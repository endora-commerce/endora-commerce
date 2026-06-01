import { describe, expect, it, vi } from 'vitest';
import {
  CustomerAuthorityService,
  type SalesRepVisibility,
} from '../../../src/modules/customers/services/customer-authority-service.js';

/**
 * Pure unit test for the staff-authority matrix (spec FR-037, research §R2).
 * No DB — the sales-rep visibility dependency is stubbed so the branching
 * logic is exercised in isolation.
 */
describe('CustomerAuthorityService.canManageCustomer', () => {
  const makeStub = (canSee: boolean): SalesRepVisibility & {
    calls: Array<[string, string]>;
  } => {
    const calls: Array<[string, string]> = [];
    return {
      calls,
      async canSeeOrganization(adminUserId, organizationId) {
        calls.push([adminUserId, organizationId]);
        return canSee;
      },
    };
  };

  it('platform admin may act on any customer (no assignment lookup)', async () => {
    const stub = makeStub(false);
    const svc = new CustomerAuthorityService(stub);

    await expect(
      svc.canManageCustomer({
        isPlatformAdmin: true,
        adminUserId: 'admin-1',
        customerOrganizationId: 'org-1',
      }),
    ).resolves.toBe(true);
    // Platform admin short-circuits — the assignment table is never consulted.
    expect(stub.calls).toHaveLength(0);
  });

  it('any salesperson may act on a standalone (org-less) customer', async () => {
    const stub = makeStub(false);
    const svc = new CustomerAuthorityService(stub);

    await expect(
      svc.canManageCustomer({
        isPlatformAdmin: false,
        adminUserId: 'rep-1',
        customerOrganizationId: null,
      }),
    ).resolves.toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it('org-bound customer: authorized when the rep is assigned to the org', async () => {
    const stub = makeStub(true);
    const svc = new CustomerAuthorityService(stub);

    await expect(
      svc.canManageCustomer({
        isPlatformAdmin: false,
        adminUserId: 'rep-1',
        customerOrganizationId: 'org-9',
      }),
    ).resolves.toBe(true);
    expect(stub.calls).toEqual([['rep-1', 'org-9']]);
  });

  it('org-bound customer: refused when the rep is not assigned to the org', async () => {
    const stub = makeStub(false);
    const svc = new CustomerAuthorityService(stub);

    await expect(
      svc.canManageCustomer({
        isPlatformAdmin: false,
        adminUserId: 'rep-2',
        customerOrganizationId: 'org-9',
      }),
    ).resolves.toBe(false);
    expect(stub.calls).toEqual([['rep-2', 'org-9']]);
  });

  it('delegates to the real visibility dependency exactly once for org-bound', async () => {
    const canSee = vi.fn().mockResolvedValue(true);
    const svc = new CustomerAuthorityService({ canSeeOrganization: canSee });

    await svc.canManageCustomer({
      isPlatformAdmin: false,
      adminUserId: 'rep-3',
      customerOrganizationId: 'org-3',
    });
    expect(canSee).toHaveBeenCalledTimes(1);
    expect(canSee).toHaveBeenCalledWith('rep-3', 'org-3');
  });
});
