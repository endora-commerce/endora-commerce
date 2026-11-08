import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { HttpError } from '@endora-commerce/platform/http';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { SalesRepAssignmentPort, SalesRepAssignmentRow } from '@endora-commerce/contracts';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { OrganizationTreeService } from './organization-tree-service.js';
import {
  decideSalesRepReach,
  type DescendantNode,
  type GoverningNode,
  type SalesRepReach,
} from './sales-rep-reach.js';

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
   * `adminTenantScopePort`. It does not catch: a failure of the statement fails
   * the request. An empty excluded list is a real answer — nobody else holds an
   * assignment — and is never produced by an error.
   */
  async reachOf(adminUserId: string): Promise<SalesRepReach> {
    // `em.execute`, not the bare connection: the statement must see the rows of
    // the transaction the caller is in, as every other read of this service does.
    const em = this.emFactory();
    // Compared as text so an id that is not uuid-shaped is simply nobody's.
    const rollup = this.subtree !== undefined && (await this.subtree.hasRollupCapability(adminUserId));
    if (!rollup) {
      const rows = (await em.execute(
        `select "organization_id"::text as "id", bool_or("admin_user_id"::text = ?) as "mine"
           from "organization_sales_rep_assignments"
          group by "organization_id"`,
        [adminUserId],
      )) as Array<{ id: string; mine: boolean }>;
      return decideSalesRepReach({
        rollup: false,
        governors: rows.map((r) => ({ organizationId: r.id, path: null, mine: r.mine })),
        descendants: [],
      });
    }
    // Roll-up: every governing node with its path, then every node below one
    // of them — which is every node whose own path names it, since that path is
    // the chain `canSeeOrganization` walks. For a governing node whose stored
    // path is readable that is a prefix scan on the `text_pattern_ops` index
    // (`organizations_path_prefix_idx`; the range compare is the index's, `like`
    // rechecks it; paths hold only `/`, hex digits and `-`, which `~` sorts
    // after). For one whose path cannot be read (`isReadableTreePath`'s rule:
    // a data defect the create hook and the repair migration exist to prevent)
    // the prefix would be a guess, so its descendants are found by the segment
    // their own paths carry — a scan, paid only while such a row exists. Either
    // way the answer is the one-id rule's, never wider.
    //
    // Every CTE is `materialized` and every per-node read is a `lateral ...
    // offset 0`, which pins the plan to "one index probe per governing node".
    // Left to itself the planner flattened the scan for unreadable paths into
    // a nested loop over every organization × every governing node, and turned
    // on JIT for the cost it then estimated: 11.5 s at 50 000 organizations and
    // 3 000 assignments, for a branch that had no row to visit.
    //
    // JIT is switched off for the statement (`set local`, inside its own
    // transaction or savepoint): the planner cannot know that the unreadable
    // branch visits nothing, prices it in the millions, and then spends half
    // a second compiling a statement that runs in tens of milliseconds
    // (measured at 50 000 organizations: 448 ms of JIT for a 45 ms execution).
    const rows = (await em.transactional(async (tx) => {
      await tx.execute('set local jit = off');
      return tx.execute(
        `with "gov" as materialized (
           select "organization_id" as "id", bool_or("admin_user_id"::text = ?) as "mine"
             from "organization_sales_rep_assignments"
            group by "organization_id"
         ), "g" as materialized (
           select "gov"."id", "gov"."mine", coalesce("o"."path", '') as "path"
             from "gov"
             left join lateral (select "path" from "organizations" where "id" = "gov"."id" offset 0) "o" on true
         ), "r" as materialized (
           select "g"."id", "g"."mine", "g"."path",
                  ("g"."path" like '/%/' and "g"."path" not like '%//%' and "g"."path" !~ '[%_\\\\]'
                   and "g"."path" like '%/' || "g"."id"::text || '/') as "readable"
             from "g"
         )
         select 'g' as "kind", "r"."id"::text as "id", "r"."path", "r"."mine" from "r"
         union all
         select 'd', "d"."id"::text, "d"."path", null
           from "r"
           cross join lateral (
             select "x"."id", "x"."path" from "organizations" "x"
              where "x"."path" ~>=~ "r"."path"
                and "x"."path" ~<~ ("r"."path" || '~')
                and "x"."path" like "r"."path" || '%'
                and "x"."id" <> "r"."id"
             offset 0
           ) "d"
          where "r"."readable"
         union all
         select 'd', "d"."id"::text, "d"."path", null
           from "r"
           cross join lateral (
             select "x"."id", "x"."path" from "organizations" "x"
              where "x"."path" like '%/' || "r"."id"::text || '/%' and "x"."id" <> "r"."id"
             offset 0
           ) "d"
          where not "r"."readable"`,
        [adminUserId],
      );
    })) as Array<{ kind: 'g' | 'd'; id: string; path: string | null; mine: boolean | null }>;
    const governors: GoverningNode[] = [];
    const descendants: DescendantNode[] = [];
    for (const r of rows) {
      if (r.kind === 'g') governors.push({ organizationId: r.id, path: r.path, mine: r.mine === true });
      else descendants.push({ id: r.id, path: r.path });
    }
    return decideSalesRepReach({ rollup: true, governors, descendants });
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
