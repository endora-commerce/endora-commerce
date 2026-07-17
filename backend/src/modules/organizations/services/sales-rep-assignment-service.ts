import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { HttpError } from '../../../http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';

/**
 * Centralised visibility predicate for the sales-rep ↔ organization
 * relation. Every endpoint that lists or operates on Quote Requests
 * (and any future module that wants the same scoping) MUST go through
 * this service so the rule is implemented exactly once.
 *
 * Rules (research §R2):
 *   - A platform admin sees every organization (decided by the caller —
 *     we only check assignment, not platform-admin role).
 *   - An admin user with an explicit assignment row sees that org.
 *   - An organization with ZERO assignment rows is in
 *     "unassigned-org fallback" mode and is visible to every sales rep.
 */
export class SalesRepAssignmentService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Returns true when the admin user is allowed to see the
   * organization's RFQs based purely on the assignment table.
   * Platform-admin override is the caller's responsibility.
   */
  async canSeeOrganization(adminUserId: string, organizationId: string): Promise<boolean> {
    const em = this.emFactory();
    const isAssigned = await em.findOne(OrganizationSalesRepAssignment, {
      adminUserId,
      organizationId,
    });
    if (isAssigned) return true;

    const orgHasAnyRep = await em.count(OrganizationSalesRepAssignment, { organizationId });
    return orgHasAnyRep === 0; // unassigned-org fallback
  }

  /**
   * Returns the list of organization IDs the admin user can act on
   * directly (assigned rows). Combine with `listUnassignedOrganizationIds`
   * if you need the full visibility set including the fallback orgs.
   */
  async listAssignedOrganizationIds(adminUserId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = await em.find(OrganizationSalesRepAssignment, { adminUserId });
    return rows.map((r) => r.organizationId);
  }

  /** Inserts an assignment if not already present. Returns the row. */
  async assign(input: {
    organizationId: string;
    adminUserId: string;
    assignedByAdminUserId?: string | null;
  }): Promise<OrganizationSalesRepAssignment> {
    const em = this.emFactory();
    // Feature 051 — sales reps manage company organizations, not individuals'
    // personal (B2C) orgs.
    const org = await em.findOne(Organization, { id: input.organizationId });
    if (org?.isPersonal) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A sales representative cannot be assigned to a personal (individual) organization.',
      );
    }
    const existing = await em.findOne(OrganizationSalesRepAssignment, {
      organizationId: input.organizationId,
      adminUserId: input.adminUserId,
    });
    if (existing) return existing;
    const row = em.create(OrganizationSalesRepAssignment, {
      organizationId: input.organizationId,
      adminUserId: input.adminUserId,
      assignedByAdminUserId: input.assignedByAdminUserId ?? null,
    });
    await em.persistAndFlush(row);
    return row;
  }

  async unassign(input: { organizationId: string; adminUserId: string }): Promise<boolean> {
    const em = this.emFactory();
    const existing = await em.findOne(OrganizationSalesRepAssignment, {
      organizationId: input.organizationId,
      adminUserId: input.adminUserId,
    });
    if (!existing) return false;
    await em.removeAndFlush(existing);
    return true;
  }

  async listForOrganization(organizationId: string): Promise<OrganizationSalesRepAssignment[]> {
    const em = this.emFactory();
    return em.find(OrganizationSalesRepAssignment, { organizationId });
  }
}
