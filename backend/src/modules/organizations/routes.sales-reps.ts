import type { FastifyInstance } from 'fastify';
import { ERROR_CODES, assignSalesRepRequestSchema } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import { AdminUser } from '../admin_users/entities/admin-user.entity.js';
import { Organization } from './entities/organization.entity.js';
import { QuoteRequest } from '../quote_requests/entities/quote-request.entity.js';
import type { SalesRepAssignmentService } from './services/sales-rep-assignment-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Sales-rep ↔ organization assignment routes (feature 008 / T077).
 * Owned by the organizations module since the relation qualifies an
 * organization, not the admin user (research §R9).
 *
 * All four endpoints require platform_admin (FR-014). The routes
 * intentionally use `rfqs:handle` for now because that's the existing
 * admin permission slot for RFQ-adjacent work; a follow-up can add a
 * dedicated `organizations:assign-sales-rep` permission.
 */

export interface SalesRepRoutesDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  salesRepAssignment: SalesRepAssignmentService;
}

export async function registerOrganizationsSalesRepRoutes(
  app: FastifyInstance,
  deps: SalesRepRoutesDeps,
): Promise<void> {
  const { emFactory, requireAdmin, salesRepAssignment } = deps;
  const guard = requireAdmin('rfqs:handle');

  // GET /api/v1/admin/organizations/:organizationId/sales-reps
  app.get<{ Params: { organizationId: string } }>(
    '/api/v1/admin/organizations/:organizationId/sales-reps',
    { preHandler: guard },
    async (request) => {
      const em = emFactory();
      const org = await em.findOne(Organization, { id: request.params.organizationId });
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      const assignments = await salesRepAssignment.listForOrganization(org.id);
      const adminIds = assignments.map((a) => a.adminUserId);
      const admins =
        adminIds.length > 0 ? await em.find(AdminUser, { id: { $in: adminIds } }) : [];
      const adminById = new Map(admins.map((a) => [a.id, a]));
      return {
        data: assignments.map((a) => {
          const u = adminById.get(a.adminUserId);
          return {
            id: a.id,
            organizationId: a.organizationId,
            adminUserId: a.adminUserId,
            displayName: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
            email: u?.email ?? '',
            assignedAt: a.createdAt.toISOString(),
            assignedByAdminUserId: a.assignedByAdminUserId ?? null,
          };
        }),
      };
    },
  );

  // POST /api/v1/admin/organizations/:organizationId/sales-reps
  app.post<{ Params: { organizationId: string } }>(
    '/api/v1/admin/organizations/:organizationId/sales-reps',
    { preHandler: guard, schema: { body: assignSalesRepRequestSchema } },
    async (request, reply) => {
      const body = assignSalesRepRequestSchema.parse(request.body);
      const em = emFactory();
      const org = await em.findOne(Organization, { id: request.params.organizationId });
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      const adminUser = await em.findOne(AdminUser, { id: body.adminUserId });
      if (!adminUser) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin user not found.');
      }
      const actor = (request as { actor?: { kind?: string; adminUserId?: string }; testActor?: { kind?: string; adminUserId?: string } });
      const assignedBy =
        actor.actor?.kind === 'admin'
          ? actor.actor.adminUserId ?? null
          : actor.testActor?.kind === 'admin'
            ? actor.testActor.adminUserId ?? null
            : null;
      const created = await salesRepAssignment.assign({
        organizationId: org.id,
        adminUserId: adminUser.id,
        assignedByAdminUserId: assignedBy,
      });
      reply.code(201);
      return {
        data: {
          id: created.id,
          organizationId: created.organizationId,
          adminUserId: created.adminUserId,
          displayName: `${adminUser.firstName} ${adminUser.lastName}`,
          email: adminUser.email,
          assignedAt: created.createdAt.toISOString(),
          assignedByAdminUserId: created.assignedByAdminUserId ?? null,
        },
      };
    },
  );

  // DELETE /api/v1/admin/organizations/:organizationId/sales-reps/:adminUserId
  app.delete<{ Params: { organizationId: string; adminUserId: string } }>(
    '/api/v1/admin/organizations/:organizationId/sales-reps/:adminUserId',
    { preHandler: guard },
    async (request, reply) => {
      const removed = await salesRepAssignment.unassign({
        organizationId: request.params.organizationId,
        adminUserId: request.params.adminUserId,
      });
      if (!removed) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Assignment not found.');
      }
      reply.code(204);
      return null;
    },
  );

  // GET /api/v1/admin/sales-reps/:adminUserId/organizations
  app.get<{ Params: { adminUserId: string } }>(
    '/api/v1/admin/sales-reps/:adminUserId/organizations',
    { preHandler: guard },
    async (request) => {
      const em = emFactory();
      const orgIds = await salesRepAssignment.listAssignedOrganizationIds(
        request.params.adminUserId,
      );
      const orgs =
        orgIds.length > 0 ? await em.find(Organization, { id: { $in: orgIds } }) : [];
      const counts = orgIds.length > 0
        ? await em.find(QuoteRequest, {
            organizationId: { $in: orgIds },
            status: { $in: ['Pending', 'Created from admin', 'Approved'] },
          })
        : [];
      const countByOrg = new Map<string, number>();
      for (const r of counts) {
        countByOrg.set(r.organizationId, (countByOrg.get(r.organizationId) ?? 0) + 1);
      }
      return {
        data: orgs.map((o) => ({
          organizationId: o.id,
          name: o.name,
          openRfqCount: countByOrg.get(o.id) ?? 0,
          assignedAt: o.createdAt.toISOString(),
        })),
      };
    },
  );

}
