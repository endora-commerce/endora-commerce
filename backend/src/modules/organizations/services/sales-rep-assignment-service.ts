import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { HttpError } from '../../../http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { OrganizationTreeService } from './organization-tree-service.js';

/**
 * Feature 056 US2 — optional roll-up wiring. When present, a sales-rep whose
 * actor holds the `organizations:rollup` capability has their assignment scope
 * expanded to the subtree of each assigned node (with per-descendant override,
 * FR-011). Absent (flat deployments / no capability), behavior is byte-for-byte
 * the pre-feature flat set.
 */
export interface SalesRepSubtreeDeps {
  readonly treeService: OrganizationTreeService;
  readonly hasRollupCapability: (adminUserId: string) => Promise<boolean>;
}

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
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
    private readonly subtree?: SalesRepSubtreeDeps,
  ) {}

  /**
   * Returns true when the admin user is allowed to see the
   * organization's RFQs based on the assignment table.
   *
   * Feature 056 — when the actor holds the roll-up capability, the rule is
   * "nearest assignment on the ancestor-or-self chain wins" (FR-011): the org
   * is visible iff the nearest ancestor-or-self carrying any assignment row
   * assigns it to this rep. An org whose entire chain has zero assignments is
   * visible to any rep (unassigned-org fallback, preserved). Without the
   * capability, the legacy exact-assignment + fallback rule applies.
   */
  async canSeeOrganization(adminUserId: string, organizationId: string): Promise<boolean> {
    const em = this.emFactory();

    if (this.subtree && (await this.subtree.hasRollupCapability(adminUserId))) {
      // Nearest-first chain: self, then ancestors up to the root.
      const chain = [organizationId, ...(await this.subtree.treeService.ancestorIds(organizationId))];
      const rows = await em.find(OrganizationSalesRepAssignment, {
        organizationId: { $in: chain },
      });
      const repsByOrg = this.#repsByOrg(rows);
      for (const orgId of chain) {
        const reps = repsByOrg.get(orgId);
        if (reps) return reps.has(adminUserId);
      }
      return true; // no assignment anywhere on the chain → unassigned-org fallback
    }

    const isAssigned = await em.findOne(OrganizationSalesRepAssignment, {
      adminUserId,
      organizationId,
    });
    if (isAssigned) return true;

    const orgHasAnyRep = await em.count(OrganizationSalesRepAssignment, { organizationId });
    return orgHasAnyRep === 0; // unassigned-org fallback
  }

  /**
   * Returns the list of organization IDs the admin user can act on.
   *
   * Feature 056 — when the actor holds the roll-up capability, each assigned
   * node expands to its subtree MINUS any descendant subtree governed by its
   * own (nearer) assignment (FR-011). Without the capability, returns the flat
   * assigned rows (pre-feature behavior).
   */
  async listAssignedOrganizationIds(adminUserId: string): Promise<string[]> {
    const em = this.emFactory();
    const rows = await em.find(OrganizationSalesRepAssignment, { adminUserId });
    const rawAssigned = rows.map((r) => r.organizationId);
    if (!this.subtree || rawAssigned.length === 0) return rawAssigned;
    if (!(await this.subtree.hasRollupCapability(adminUserId))) return rawAssigned;

    // All assignment rows (small table) → org → set of reps, for the override rule.
    const allRows = await em.find(OrganizationSalesRepAssignment, {});
    const repsByOrg = this.#repsByOrg(allRows);

    const result = new Set<string>();
    for (const nodeId of new Set(rawAssigned)) {
      const nodes = await this.subtree.treeService.subtreeNodes(nodeId);
      const parentOf = new Map<string, string | null>();
      for (const n of nodes) parentOf.set(n.id, n.parentId);
      for (const n of nodes) {
        // Walk up to the nearest ancestor-or-self carrying an assignment; the
        // assigned root (nodeId, assigned to this rep) always terminates it.
        let cur: string | null = n.id;
        while (cur) {
          const reps = repsByOrg.get(cur);
          if (reps) {
            if (reps.has(adminUserId)) result.add(n.id);
            break;
          }
          cur = parentOf.get(cur) ?? null;
        }
      }
    }
    return [...result];
  }

  #repsByOrg(rows: readonly OrganizationSalesRepAssignment[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      let set = map.get(r.organizationId);
      if (!set) {
        set = new Set<string>();
        map.set(r.organizationId, set);
      }
      set.add(r.adminUserId);
    }
    return map;
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
    em.persist(row);
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.sales_rep_assign',
        objectType: 'organization',
        objectId: input.organizationId,
        stateBefore: null,
        stateAfter: { adminUserId: input.adminUserId },
      });
    }
    await em.flush();
    return row;
  }

  async unassign(input: { organizationId: string; adminUserId: string }): Promise<boolean> {
    const em = this.emFactory();
    const existing = await em.findOne(OrganizationSalesRepAssignment, {
      organizationId: input.organizationId,
      adminUserId: input.adminUserId,
    });
    if (!existing) return false;
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.sales_rep_unassign',
        objectType: 'organization',
        objectId: input.organizationId,
        stateBefore: { adminUserId: input.adminUserId },
        stateAfter: null,
      });
    }
    await em.removeAndFlush(existing);
    return true;
  }

  async listForOrganization(organizationId: string): Promise<OrganizationSalesRepAssignment[]> {
    const em = this.emFactory();
    return em.find(OrganizationSalesRepAssignment, { organizationId });
  }
}
