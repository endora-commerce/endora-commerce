import { describe, expect, it, vi } from 'vitest';
import {
  customersModule,
  type CustomersModuleOptions,
} from '../../../src/modules/customers/plugin.js';
import type { SalesRepVisibility } from '../../../src/modules/customers/services/customer-authority-service.js';

/**
 * Issue #108 — `customers` must not build its own sales-rep scope.
 *
 * The module used to construct `new SalesRepAssignmentService(emFactory,
 * auditLogService)`. That class takes a **third, optional** argument — the
 * feature-056 subtree deps (the organization tree plus the
 * `organizations:rollup` capability check) — so omitting it compiles, and
 * `CustomerAuthorityService` then applied the flat pre-056 rule: a sales rep
 * holding the roll-up capability could not act on a customer belonging to a
 * descendant of an organization assigned to them. `tsc` cannot see an optional
 * argument nobody passed; only a test that watches the collaborator can, which
 * is what this one does.
 *
 * The scope is `organizations`' `organizationSalesRepScopePort` — one
 * implementation, resolved by both composition roots and by this module, in
 * place of a fourth private copy of the wiring. Here it is a recording double:
 * if the module ever goes back to building its own, nothing reaches the double
 * and this fails.
 *
 * No database: `customersModule` only constructs services at call time.
 */

function options(salesRepVisibility: SalesRepVisibility): CustomersModuleOptions {
  const nothing = (): unknown => undefined;
  return {
    salesRepVisibility,
    emFactory: nothing,
    sessionService: {
      destroyAllForCustomer: nothing,
      listRecentlyActiveCustomers: nothing,
    },
    customerAuthService: {},
    passwordResetService: {},
    requireCustomer: nothing,
    resolveCustomerActor: nothing,
    resolveAllowRegistrationWithoutOrganization: async () => false,
    getOrderListService: nothing,
    rfqService: {},
    auditLogService: {},
    requireAdmin: () => nothing,
    resolveModerationActor: nothing,
    vatValidator: {},
    mailer: {},
    storefrontBaseUrl: 'https://shop.example.com',
    resolveDeletionRetentionDays: async () => 365,
    resolvePresenceFreshnessMinutes: async () => 10,
  } as unknown as CustomersModuleOptions;
}

describe('customers — the staff-authority check uses the injected sales-rep scope (#108)', () => {
  it('delegates canSeeOrganization to the injected scope, roll-up rule included', async () => {
    // The subtree-aware answer: this rep is assigned an ancestor, not the org
    // itself, so only a roll-up-aware scope says yes. A flat service built
    // inside the module would query the assignment table and say no.
    const canSeeOrganization = vi.fn().mockResolvedValue(true);
    const { handle } = customersModule(options({ canSeeOrganization }));

    await expect(
      handle().authorityService.canManageCustomer({
        isPlatformAdmin: false,
        adminUserId: 'rep-1',
        customerOrganizationId: 'org-descendant',
      }),
    ).resolves.toBe(true);

    expect(canSeeOrganization).toHaveBeenCalledTimes(1);
    expect(canSeeOrganization).toHaveBeenCalledWith('rep-1', 'org-descendant');
  });

  it('refuses when the injected scope refuses', async () => {
    const canSeeOrganization = vi.fn().mockResolvedValue(false);
    const { handle } = customersModule(options({ canSeeOrganization }));

    await expect(
      handle().authorityService.canManageCustomer({
        isPlatformAdmin: false,
        adminUserId: 'rep-2',
        customerOrganizationId: 'org-9',
      }),
    ).resolves.toBe(false);
  });
});
