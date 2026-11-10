import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { HttpError } from '@endora-commerce/platform/http';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { SalesRepAssignmentPort, SalesRepAssignmentRow } from '@endora-commerce/contracts';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { OrganizationTreeService } from './organization-tree-service.js';
import { reachFromAggregate, type ReachAggregateRow, type SalesRepReach } from './sales-rep-reach.js';

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
  /**
   * Issue #305 (ruling Q1 on PR #954) — told once per `reachOf` that met a
   * governing organization whose stored tree path cannot be read, naming them.
   * The reach is still answered, by the one-id rule; this is how the data
   * defect gets found.
   */
  readonly warn?: (fields: { organizationIds: string[] }, message: string) => void;
}

/**
 * The sales-rep assignment relation as **other modules** see it:
 * `organizations`' `organizationSalesRepScopePort` (T143a, widened for issue
 * #108).
 *
 * One implementation, five questions. Before this port existed, every consumer
 * built its own `SalesRepAssignmentService`, and each build was free to omit the
 * optional third constructor argument — which `customers` did, so
 * `CustomerAuthorityService` applied the flat pre-056 rule and the roll-up was
 * skipped for every block / unblock / delete / org-assign decision. `tsc` cannot
 * see an omitted optional argument; a single port removes the chance to omit it.
 *
 * Structural rather than the entity type on purpose: a consumer wants the reps,
 * not `organizations`' ORM rows.
 *
 * Both declarations moved to `@endora-commerce/contracts` in feature 075's Phase P, so the
 * two consuming modules can name a package rather than this file. Re-exported
 * here for the length of Phase P, which cuts no consumer.
 */
export type { SalesRepAssignmentPort, SalesRepAssignmentRow };

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
 *
 * Issue #305 (owner ruling 2026-11-07): this is the **one** reach rule, on
 * every surface. `canSeeOrganization` answers it for one id; {@link reachOf}
 * answers it for the whole platform as its complement — the organizations
 * governed by somebody else — which is what the tenant scope filters by. An
 * integration property holds the two equal for every node.
 */
export class SalesRepAssignmentService implements SalesRepAssignmentPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
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
   * The organizations the representative is assigned, roll-up expanded: each
   * assigned node's subtree minus any descendant governed by its own (nearer)
   * assignment (FR-011). Without the capability, the flat assigned rows.
   *
   * Since issue #305 this is **not** the representative's reach — an
   * unassigned organization is in reach too — but "mine": ranking, `scope=mine`
   * filters, the assignment report. It is the `assignedOrganizationIds` half of
   * {@link reachOf}, from the same statement.
   */
  async listAssignedOrganizationIds(adminUserId: string): Promise<string[]> {
    if (!isUuidShape(adminUserId)) return [];
    return (await this.reachOf(adminUserId)).assignedOrganizationIds;
  }

  /**
   * Issue #305 — the representative's reach for the tenant scope, in one
   * statement: the organizations governed by somebody else
   * (`excludedOrganizationIds`, never reachable) and the ones the
   * representative governs (`assignedOrganizationIds`). An organization in
   * neither list is governed by nobody and is in every representative's reach.
   *
   * Not on `SalesRepAssignmentPort`: its one consumer is this module's
   * `adminTenantScopePort`. It does not catch: a failure of the statement
   * reaches the port, which answers `unresolved` (no organization, the refusal
   * deferred to the first tenant-scoped read). An empty excluded list is a real answer — nobody else holds an
   * assignment — and is never produced by an error.
   */
  /**
   * Whether the representative's reach is answered under roll-up
   * (`organizations:rollup`) — the flag `adminTenantScopePort` puts into the
   * tenant filter's subquery without computing the reach (issue #955 Phase 2).
   * The same question `reachOf` asks, through the same dependency.
   */
  async hasRollupCapability(adminUserId: string): Promise<boolean> {
    return this.subtree !== undefined && (await this.subtree.hasRollupCapability(adminUserId));
  }

  async reachOf(adminUserId: string): Promise<SalesRepReach> {
    // `em.execute`, not the bare connection: the statement must see the rows of
    // the transaction the caller is in, as every other read of this service does.
    const em = this.emFactory();
    // An id that is not uuid-shaped is nobody's: bound as null, it matches no row.
    const rep = isUuidShape(adminUserId) ? adminUserId : null;
    const rollup = await this.hasRollupCapability(adminUserId);
    // Issue #955 (architect ruling, Q2) — both lists come from
    // `organizations_reach_split`, in one scan; the tenant filter's subquery
    // reads `organizations_reach_excluded`, which is that split's `not mine`
    // half, so the list and the filter cannot drift. Both halves read the
    // materialised governor table (each organization's nearest assigned
    // ancestor-or-self, maintained in the transaction of every write that can
    // move it — migration `20261109T144721`); flat reads its self-rows, since an
    // organization governs itself exactly when it carries an assignment. The
    // roll-up reach used to be one path probe per governing organization, ~73 ms
    // at 3 000 of them.
    //
    // The third column, roll-up only, names the governing organizations whose
    // own stored path cannot be read: the `materialized` CTE pins it to a scan
    // of a partial index that is empty unless the data is damaged (left to
    // itself the planner probed that index once per assignment, 10 ms at 3 000).
    const rows = (await em.execute(
      `with "unreadable" as materialized (
         select "o"."id" from "organizations" "o"
          where ?::boolean and not "organizations_tree_path_readable"("o"."path", "o"."id")
       )
       select string_agg("s"."organization_id"::text, ',') filter (where not "s"."mine") as "excluded",
              string_agg("s"."organization_id"::text, ',') filter (where "s"."mine") as "assigned",
              (select string_agg("u"."id"::text, ',')
                 from "unreadable" "u"
                where exists (select 1 from "organization_sales_rep_assignments" "a" where "a"."organization_id" = "u"."id")
              ) as "unreadable"
         from "organizations_reach_split"(?::uuid, ?::boolean) "s"`,
      [rollup, rep, rollup],
    )) as Array<ReachAggregateRow & { unreadable: string | null }>;
    const row = rows[0];
    if (row?.unreadable) {
      this.subtree?.warn?.(
        { organizationIds: row.unreadable.split(',') },
        'organizations: a governing organization has a stored tree position that cannot be read; ' +
          'the sales-representative reach resolves it by its own assignments and the paths that name it',
      );
    }
    return reachFromAggregate(row, rollup);
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
    if (!isUuidShape(input.organizationId) || !isUuidShape(input.adminUserId)) return false;
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
