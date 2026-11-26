import { describe, expect, it, vi } from 'vitest';
import type { AdminTenantScope, AdminUserRecord } from '@endora-commerce/contracts';
import { createAssigneeEligibility } from './assignee-eligibility.js';

/**
 * Issue #1906 — who a command hook on the buyer's create may make the
 * request's assignee: an active administrator holding `rfqs:handle` whose own
 * tenant scope reaches the request's Organization.
 */

const ADMIN_ID = '00000000-0000-4000-8000-000000190611';
const ORG_ID = '00000000-0000-4000-8000-000000190612';
const OTHER_ORG_ID = '00000000-0000-4000-8000-000000190613';

function admin(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return { id: ADMIN_ID, status: 'active', deletedAt: null, ...overrides } as AdminUserRecord;
}

function eligibility(options: {
  admin?: AdminUserRecord | null;
  permissions?: string[];
  scope?: AdminTenantScope;
  repReach?: boolean;
}) {
  const canSeeOrganization = vi.fn(async () => options.repReach ?? false);
  const check = createAssigneeEligibility({
    adminUsers: { findById: async () => (options.admin === undefined ? admin() : options.admin) },
    permissions: { listPermissions: async () => options.permissions ?? ['rfqs:handle'] },
    adminTenantScope: { resolveForAdmin: async () => options.scope ?? { allowAll: true } },
    salesRepAssignment: { canSeeOrganization },
  });
  return { check, canSeeOrganization };
}

const excluding = (): AdminTenantScope => ({
  allowAll: false,
  reach: 'excluding',
  excludedOrganizationsQuery: { sql: 'select 1', params: [] },
  loadReach: async () => ({ excludedOrganizationIds: [], assignedOrganizationIds: [] }),
});

describe('assignee eligibility (issue #1906)', () => {
  it('accepts an active administrator holding rfqs:handle whose scope reaches every Organization', async () => {
    expect(await eligibility({}).check(ADMIN_ID, ORG_ID)).toBe(true);
  });

  it('accepts the wildcard role', async () => {
    expect(await eligibility({ permissions: ['*'] }).check(ADMIN_ID, ORG_ID)).toBe(true);
  });

  it('refuses an unknown, a deleted and an inactive administrator', async () => {
    expect(await eligibility({ admin: null }).check(ADMIN_ID, ORG_ID)).toBe(false);
    expect(await eligibility({ admin: admin({ deletedAt: new Date() }) }).check(ADMIN_ID, ORG_ID)).toBe(false);
    expect(await eligibility({ admin: admin({ status: 'inactive' } as Partial<AdminUserRecord>) }).check(ADMIN_ID, ORG_ID)).toBe(false);
  });

  it('refuses an administrator without rfqs:handle', async () => {
    expect(await eligibility({ permissions: ['orders:read'] }).check(ADMIN_ID, ORG_ID)).toBe(false);
  });

  it('asks the representative reach rule for a sales representative', async () => {
    const reaching = eligibility({ scope: excluding(), repReach: true });
    expect(await reaching.check(ADMIN_ID, ORG_ID)).toBe(true);
    expect(reaching.canSeeOrganization).toHaveBeenCalledWith(ADMIN_ID, ORG_ID);
    expect(await eligibility({ scope: excluding(), repReach: false }).check(ADMIN_ID, ORG_ID)).toBe(false);
  });

  it('holds a named set to its members, and an unresolved scope reaches nothing', async () => {
    const named: AdminTenantScope = { allowAll: false, allowedOrganizationIds: [ORG_ID] };
    expect(await eligibility({ scope: named }).check(ADMIN_ID, ORG_ID)).toBe(true);
    expect(await eligibility({ scope: named }).check(ADMIN_ID, OTHER_ORG_ID)).toBe(false);
    const unresolved: AdminTenantScope = { allowAll: false, allowedOrganizationIds: [ORG_ID], unresolved: new Error('no role') };
    expect(await eligibility({ scope: unresolved }).check(ADMIN_ID, ORG_ID)).toBe(false);
  });
});
