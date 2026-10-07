import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CRM_EVENTS,
  ERROR_CODES,
  type AdminUserReadPort,
  type AdminUserRecord,
  type OpportunityAssignedEvent,
  type SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import { pickDefaultAssignee } from '../domain/default-assignee.js';
import type { AdminReach } from './admin-reach.js';
import { crmNotificationText, tellAfterCommit, type CrmNotifier } from './crm-notifier.js';
import { loadOpportunity } from './opportunity-access.js';

export interface OpportunityAssignmentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  salesReps: SalesRepAssignmentPort;
  adminUsers: AdminUserReadPort;
  notifier: CrmNotifier;
  /** Whether another administrator may reach an Organization. */
  canReach: AdminReach;
}

/** An administrator who may hold an Opportunity: known, not deleted, not deactivated. */
export function isActiveAdministrator(admin: AdminUserRecord | null | undefined): admin is AdminUserRecord {
  return Boolean(admin) && admin!.status === 'active' && admin!.deletedAt === null;
}

/** The administrator behind the current request, or `null` for the system. */
export function actingAdminUserId(): string | null {
  const actor = getTenantContext()?.actor;
  return actor?.kind === 'admin' && actor.id ? actor.id : null;
}

export function assignedEvent(change: {
  opportunityId: string;
  organizationId: string;
  assignedAdminUserId: string | null;
  previousAdminUserId: string | null;
}): { eventName: string; payload: OpportunityAssignedEvent } {
  return {
    eventName: CRM_EVENTS.ASSIGNED,
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), ...change },
  };
}

/**
 * Who holds an Opportunity (`contracts/admin-api.md` §5; research R-9).
 *
 * Any active administrator may be the assignee. **The assignee decides nothing
 * about visibility** — that is the tenant scope's — so assigning an Opportunity
 * to somebody who cannot reach its Organization does not show it to them.
 *
 * The Sales Reps of an Organization are `organizations`' relation, read through
 * its port; this module keeps no copy of it.
 */
export class OpportunityAssignmentService {
  constructor(private readonly deps: OpportunityAssignmentServiceDeps) {}

  /**
   * The assignee a new Opportunity of `organizationId` gets when the request
   * names none: see {@link pickDefaultAssignee}.
   */
  async resolveDefault(organizationId: string, creatorAdminUserId: string | null): Promise<string | null> {
    const assignments = await this.deps.salesReps.listForOrganization(organizationId);
    if (assignments.length === 0) return null;
    const admins = await this.deps.adminUsers.findByIds([
      ...new Set(assignments.map((assignment) => assignment.adminUserId)),
    ]);
    return pickDefaultAssignee({
      assignments,
      activeAdminUserIds: new Set(admins.filter(isActiveAdministrator).map((admin) => admin.id)),
      creatorAdminUserId,
    });
  }

  /**
   * 422 `CRM_ASSIGNEE_INVALID` unless `adminUserId` names an active
   * administrator who may reach `organizationId` — an Opportunity is not given
   * to somebody who cannot open it.
   */
  async assertAssignable(adminUserId: string, organizationId: string): Promise<void> {
    const admin = await this.deps.adminUsers.findById(adminUserId);
    if (!isActiveAdministrator(admin) || !(await this.deps.canReach(adminUserId, organizationId))) {
      throw new HttpError(
        422,
        ERROR_CODES.CRM_ASSIGNEE_INVALID,
        'The assignee is not an active administrator of this platform.',
      );
    }
  }

  /**
   * Assign, reassign or (with `null`) unassign. One Command, announced once
   * with the previous assignee; naming the assignee the Opportunity already has
   * writes nothing. The new assignee is told afterwards.
   */
  async assign(opportunityId: string, adminUserId: string | null): Promise<void> {
    // The parent first: an Opportunity the caller cannot see is a 404 before
    // the assignee is looked at.
    const visible = await loadOpportunity(this.deps.emFactory(), opportunityId);
    if (adminUserId !== null) await this.assertAssignable(adminUserId, visible.organizationId);

    const change = await this.deps.commandBus.run({
      action: 'crm.opportunity.assign',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId, {
          lockMode: LockMode.PESSIMISTIC_WRITE,
        });
        const previousAdminUserId = opportunity.assignedAdminUserId ?? null;
        if (previousAdminUserId === adminUserId) return { result: null, skipAudit: true };
        opportunity.assignedAdminUserId = adminUserId;
        opportunity.version += 1;
        return {
          result: {
            opportunityId: opportunity.id,
            organizationId: opportunity.organizationId,
            number: opportunity.number,
            title: opportunity.title,
            assignedAdminUserId: adminUserId,
            previousAdminUserId,
          },
          before: { assignedAdminUserId: previousAdminUserId },
          after: { assignedAdminUserId: adminUserId },
        };
      },
      event: (result) => (result ? assignedEvent(result) : undefined),
    });
    if (change) await this.notifyAssigned(change);
  }

  /**
   * Tell the new assignee — after the commit that made them the assignee.
   * Nobody is told about taking an Opportunity themselves, or about one that
   * was left without an assignee — and nobody who cannot reach its
   * Organization. The entry names the Opportunity by its number alone: a bell
   * is read outside the tenant scope.
   */
  async notifyAssigned(assignment: {
    opportunityId: string;
    organizationId: string;
    number: string;
    assignedAdminUserId: string | null;
  }): Promise<void> {
    const assignee = assignment.assignedAdminUserId;
    if (assignee === null || assignee === actingAdminUserId()) return;
    await tellAfterCommit(assignment.opportunityId, async () => {
      if (!(await this.deps.canReach(assignee, assignment.organizationId))) return;
      await this.deps.notifier.notify({
        kind: 'crm.opportunity.assigned',
        targetAdminUserId: assignee,
        opportunityId: assignment.opportunityId,
        ...crmNotificationText.assigned(assignment.number),
      });
    });
  }
}
