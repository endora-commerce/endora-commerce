import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { Organization } from './entities/organization.entity.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Admin /admin/organizations surface (T122).
 *   - GET list with filter[status], filter[vatStatus], q (name/taxId LIKE)
 *   - GET /:id detail (org + members)
 *   - PATCH /:id status|vatStatus
 */

const listQuerySchema = z.object({
  'filter[status]': z.enum(['pending_verification', 'active', 'suspended']).optional(),
  'filter[vatStatus]': z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']).optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  vatStatus: z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']).optional(),
  status: z.enum(['pending_verification', 'active', 'suspended']).optional(),
});

export interface AdminOrgsDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export async function registerOrganizationsAdminRoutes(
  app: FastifyInstance,
  deps: AdminOrgsDeps,
): Promise<void> {
  const { requireAdmin, emFactory } = deps;

  app.get(
    '/api/v1/admin/organizations',
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const em = emFactory();
      const where: Record<string, unknown> = { deletedAt: null };
      if (query['filter[status]']) where['status'] = query['filter[status]'];
      if (query['filter[vatStatus]']) where['vatStatus'] = query['filter[vatStatus]'];
      if (query.q) {
        where['$or'] = [
          { name: { $ilike: `%${query.q}%` } },
          { taxId: { $ilike: `%${query.q}%` } },
        ];
      }
      const orgs = await em.find(Organization, where, {
        limit: query.limit,
        orderBy: { createdAt: 'desc' },
      });
      return {
        data: orgs.map(serializeOrg),
        pagination: { cursor: null, hasMore: false, limit: query.limit },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id',
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const em = emFactory();
      const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      const members = await em.find(CustomerAccount, {
        organizationId: org.id,
        deletedAt: null,
      });
      return {
        data: {
          ...serializeOrg(org),
          members: members.map((m) => ({
            id: m.id,
            email: m.email,
            firstName: m.firstName,
            lastName: m.lastName,
            role: m.role,
            emailVerifiedAt: m.emailVerifiedAt?.toISOString() ?? null,
            twoFactorEnabled: !!m.twoFactorConfirmedAt,
          })),
        },
      };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id',
    {
      preHandler: requireAdmin('customers:manage'),
      schema: { body: updateOrganizationSchema },
    },
    async (request) => {
      const em = emFactory();
      const body = updateOrganizationSchema.parse(request.body);
      const org = await em.findOne(Organization, { id: request.params.id, deletedAt: null });
      if (!org) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      }
      if (body.name !== undefined) org.name = body.name;
      if (body.vatStatus !== undefined) org.vatStatus = body.vatStatus;
      if (body.status !== undefined) org.status = body.status;
      await em.flush();
      return { data: serializeOrg(org) };
    },
  );
}

function serializeOrg(o: Organization): Record<string, unknown> {
  return {
    id: o.id,
    name: o.name,
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    registeredAddress: o.registeredAddress,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// Silence unused imports if listQuery isn't referenced in a generated body
// type — they're consumed via Zod parsing.
void (null as FastifyRequest | null);
