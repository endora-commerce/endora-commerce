import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  assignSalesRepRequestSchema,
  type AdminUserReadPort,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import { Organization } from './entities/organization.entity.js';
import type { SalesRepAssignmentPort } from './services/sales-rep-assignment-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Sales-rep ↔ organization assignment routes (feature 008 / T077).
 *
 * Owned **and registered** by `organizations` since D-166. Three of the four
 * endpoints this file used to hold are here; the fourth —
 * `GET /admin/sales-reps/:adminUserId/organizations`, the only one that reads a
 * `QuoteRequest` — moved to `quote_requests/routes.sales-reps.ts`, which is the
 * module that owns the fact it reports.
 *
 * The split is what makes the gate honest, and it is a consequence rather than
 * a preference. The whole file used to be registered by `quote_requests`
 * through a dynamic `import()`, so all four endpoints were gated by *that*
 * module's effective state and permissioned `rfqs:handle`. Neither half of that
 * arrangement survives inspection: assigning a sales representative qualifies an
 * organisation and has nothing to do with quote requests, so switching quote
 * requests off must not take the assignment screen with it — and registering the
 * file here without splitting it would be worse, because `rfqs:handle` is
 * declared `module: 'quote_requests'` and `organizations` is `nonDeactivatable`,
 * which leaves a permanently mounted screen behind a permission that disappears
 * from `/admin-roles` the moment quote requests is switched off. The gate travels
 * with the routes.
 *
 * `organizations:assign-sales-rep` is the code, and it is the one this file has
 * proposed in its own comment since feature 008 — the placeholder note said
 * "a follow-up can add a dedicated `organizations:assign-sales-rep` permission",
 * and this is that follow-up.
 *
 * Admins are read through `adminUserReadPort` rather than through the
 * `AdminUser` entity, which is what retires this file's two entries in
 * `organizations`' cross-module-import shard: the reads were always
 * `findById`/`findByIds`, both published, and the only thing stopping the port
 * from being injected was that another module built this file's `deps`.
 */

export interface SalesRepRoutesDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  salesRepAssignment: SalesRepAssignmentPort;
  adminUsers: AdminUserReadPort;
}

export async function registerOrganizationsSalesRepRoutes(
  app: FastifyInstance,
  deps: SalesRepRoutesDeps,
): Promise<void> {
  const { emFactory, requireAdmin, salesRepAssignment, adminUsers } = deps;
  const guard = requireAdmin('organizations:assign-sales-rep');

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
      const admins = adminIds.length > 0 ? await adminUsers.findByIds(adminIds) : [];
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
      const adminUser = await adminUsers.findById(body.adminUserId);
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
}
