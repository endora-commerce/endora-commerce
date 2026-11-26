import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape, type AdminUserReadPort } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';

/**
 * Sales-representative assignment as Commands (feature 008;
 * `specs/186-aggregate-ports/` research R-16.7): `organization.sales_rep_assign`
 * and `organization.sales_rep_unassign`, the action strings the hand audit in
 * `SalesRepAssignmentService` recorded, with the same state — `stateAfter`
 * (assign) or `stateBefore` (unassign) `{ adminUserId }`.
 *
 * An idempotent repeat — assigning an administrator already assigned, removing
 * an assignment that is not there — changes nothing and answers `skipAudit`, as
 * the hand audit recorded nothing for it. The admin routes, the service's
 * published `assign` / `unassign` and `organizationCommandPort` run these
 * factories. The D-260 refusal of a scoped administrator is not here: it is the
 * caller's gate (FR-009), and the admin routes keep it.
 */

export interface SalesRepAssignmentCommandInput {
  readonly organizationId: string;
  readonly adminUserId: string;
}

export interface AssignSalesRepCommandInput extends SalesRepAssignmentCommandInput {
  /** Who assigned; absent, the ambient administrator (`null` for the system actor). */
  readonly assignedByAdminUserId?: string | null | undefined;
}

export interface AssignSalesRepCommandDeps {
  /**
   * When given, an administrator id that names nobody is refused
   * `404 NOT_FOUND` ('Admin user not found.'), as the admin route refuses it.
   */
  readonly adminUsers?: Pick<AdminUserReadPort, 'findById'> | undefined;
}

/** What assign answers: the assignment row, and whether this call created it. */
export interface AssignSalesRepOutcome {
  readonly assignment: OrganizationSalesRepAssignment;
  readonly created: boolean;
}

export function makeAssignSalesRepCommand(
  deps: AssignSalesRepCommandDeps,
  input: AssignSalesRepCommandInput,
): Command<AssignSalesRepOutcome> {
  return {
    action: 'organization.sales_rep_assign',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em, actor }) => {
      const org = isUuidShape(input.organizationId)
        ? await em.findOne(Organization, { id: input.organizationId })
        : null;
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      if (deps.adminUsers && !(isUuidShape(input.adminUserId) && (await deps.adminUsers.findById(input.adminUserId)))) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
      }
      const outcome = await writeSalesRepAssignment(em, {
        organization: org,
        adminUserId: input.adminUserId,
        assignedByAdminUserId:
          input.assignedByAdminUserId !== undefined ? input.assignedByAdminUserId : actor.actorAdminUserId,
      });
      if (!outcome.created) return { result: outcome, skipAudit: true };
      return { result: outcome, before: null, after: { adminUserId: input.adminUserId } };
    },
  };
}

/** Answers whether an assignment was removed; `false` (nothing there) records nothing. */
export function makeUnassignSalesRepCommand(input: SalesRepAssignmentCommandInput): Command<boolean> {
  return {
    action: 'organization.sales_rep_unassign',
    objectType: 'organization',
    objectId: input.organizationId,
    run: async ({ em }) => {
      const removed = await deleteSalesRepAssignment(em, input);
      if (!removed) return { result: false, skipAudit: true };
      return { result: true, before: { adminUserId: input.adminUserId }, after: null };
    },
  };
}

/**
 * The assignment row write, on the caller's unit of work. A sales
 * representative manages company Organizations, never a personal (B2C) one
 * (feature 051): `422 ORGANIZATION_PERSONAL`.
 */
export async function writeSalesRepAssignment(
  em: EntityManager,
  input: { organization: Organization | null; adminUserId: string; assignedByAdminUserId: string | null },
): Promise<AssignSalesRepOutcome> {
  const org = input.organization;
  if (org?.isPersonal) {
    // Issue #629 (#86) — the organization refuses a well-formed request: a
    // code of its own, the token naming the action.
    throw new HttpError(
      422,
      ERROR_CODES.ORGANIZATION_PERSONAL,
      'A sales representative cannot be assigned to a personal (individual) organization.',
      { code: 'sales_rep', organizationId: org.id, organizationName: org.name },
    );
  }
  const organizationId = org?.id;
  if (organizationId === undefined) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  const existing = await em.findOne(OrganizationSalesRepAssignment, { organizationId, adminUserId: input.adminUserId });
  if (existing) return { assignment: existing, created: false };
  const row = em.create(OrganizationSalesRepAssignment, {
    organizationId,
    adminUserId: input.adminUserId,
    assignedByAdminUserId: input.assignedByAdminUserId,
  });
  em.persist(row);
  await em.flush();
  return { assignment: row, created: true };
}

/** Removes the assignment row on the caller's unit of work; `false` when there is none. */
export async function deleteSalesRepAssignment(
  em: EntityManager,
  input: SalesRepAssignmentCommandInput,
): Promise<boolean> {
  if (!isUuidShape(input.organizationId) || !isUuidShape(input.adminUserId)) return false;
  const existing = await em.findOne(OrganizationSalesRepAssignment, {
    organizationId: input.organizationId,
    adminUserId: input.adminUserId,
  });
  if (!existing) return false;
  await em.remove(existing).flush();
  return true;
}
