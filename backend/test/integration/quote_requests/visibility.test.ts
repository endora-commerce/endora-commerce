import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { OrganizationSalesRepAssignment } from '../../../src/modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { SalesRepAssignmentService } from '../../../src/modules/organizations/services/sales-rep-assignment-service.js';

/**
 * T024 — `SalesRepAssignmentService.canSeeOrganization` covers:
 *   1. assigned admin → true
 *   2. unassigned admin on an organization that HAS at least one
 *      assignment → false
 *   3. any admin on an organization with ZERO assignments →
 *      "unassigned-org fallback" → true
 */
describe('SalesRepAssignmentService.canSeeOrganization (T024)', () => {
  let db: TestDb;
  let svc: SalesRepAssignmentService;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await db.beginTx();
    svc = new SalesRepAssignmentService(() => db.em());
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns true when the admin is explicitly assigned to the organization', async () => {
    const adminUserId = randomUUID();
    const organizationId = randomUUID();
    db.em().create(OrganizationSalesRepAssignment, { adminUserId, organizationId });
    await db.em().flush();

    expect(await svc.canSeeOrganization(adminUserId, organizationId)).toBe(true);
  });

  it('returns false when the org has assignments but the admin is not on the list', async () => {
    const otherAdminId = randomUUID();
    const requestingAdminId = randomUUID();
    const organizationId = randomUUID();
    db.em().create(OrganizationSalesRepAssignment, {
      adminUserId: otherAdminId,
      organizationId,
    });
    await db.em().flush();

    expect(await svc.canSeeOrganization(requestingAdminId, organizationId)).toBe(false);
  });

  it('returns true for any admin when the organization has no assignments (fallback)', async () => {
    const adminUserId = randomUUID();
    const organizationId = randomUUID();
    // No rows in organization_sales_rep_assignments → fallback applies.

    expect(await svc.canSeeOrganization(adminUserId, organizationId)).toBe(true);
  });

  it('listAssignedOrganizationIds returns only the admin-specific assignments', async () => {
    const adminA = randomUUID();
    const adminB = randomUUID();
    const orgA = randomUUID();
    const orgB = randomUUID();
    const orgC = randomUUID();
    db.em().create(OrganizationSalesRepAssignment, { adminUserId: adminA, organizationId: orgA });
    db.em().create(OrganizationSalesRepAssignment, { adminUserId: adminA, organizationId: orgB });
    db.em().create(OrganizationSalesRepAssignment, { adminUserId: adminB, organizationId: orgC });
    await db.em().flush();

    const ids = await svc.listAssignedOrganizationIds(adminA);
    expect(ids.sort()).toEqual([orgA, orgB].sort());
  });
});
