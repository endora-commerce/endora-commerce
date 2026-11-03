import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  createOrganizationRoleRequestSchema,
  deleteOrganizationRoleRequestSchema,
  supportedLanguageOf,
  updateOrganizationRoleRequestSchema,
  type OrganizationPermissionPort,
  type OrganizationPermissionSubject,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { OrganizationRoleService } from './services/organization-role-service.js';

/**
 * The storefront role routes (`specs/170-organization-roles/`,
 * `contracts/storefront-api.md` §2; FR-004, FR-005, FR-008, FR-010, FR-010a,
 * FR-058).
 *
 * Every route but `GET …/mine/role` is the administrator's: role management is
 * a **reserved capability**, asked as `organizationPermissionPort.isAdministrator`
 * and refused with the existing `403 FORBIDDEN`, never a permission code
 * (research R-20; data-model §6). The gate is a `preHandler` after
 * `requireCustomer`, so a refused caller is answered before the body is
 * validated. The Organization is always the caller's own: there is no
 * Organization id in these paths, and another Organization's role id is `404`.
 * A personal Organization answers `404` (spec *Edge Cases*).
 */
export interface OrganizationRoleRoutesDeps {
  readonly roleService: OrganizationRoleService;
  /** This module's own port, resolved per request. */
  readonly organizationPermissions: () => OrganizationPermissionPort;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

const roleParamsSchema = z.object({ id: z.string().uuid() });

/** The member being judged: the request's customer, with the role id its actor carries. */
export function subjectOf(
  request: FastifyRequest,
  resolveCustomerContext: OrganizationRoleRoutesDeps['resolveCustomerContext'],
): OrganizationPermissionSubject {
  const ctx = resolveCustomerContext(request);
  const actor = (request as FastifyRequest & { actor?: { kind?: string; organizationRoleId?: string | null } }).actor;
  return {
    customerAccountId: ctx.customerAccountId,
    organizationId: ctx.organizationId,
    organizationRoleId: actor?.kind === 'customer' ? (actor.organizationRoleId ?? null) : null,
  };
}

export async function registerOrganizationRoleRoutes(
  app: FastifyInstance,
  deps: OrganizationRoleRoutesDeps,
): Promise<void> {
  const { roleService, requireCustomer, resolveCustomerContext } = deps;

  const requireOrganizationAdministrator = async (request: FastifyRequest): Promise<void> => {
    if (!(await deps.organizationPermissions().isAdministrator(subjectOf(request, resolveCustomerContext)))) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator required.');
    }
  };
  const administrator = [requireCustomer, requireOrganizationAdministrator];
  const language = async (request: FastifyRequest) => supportedLanguageOf(await request.responseLanguage());

  app.get('/api/v1/organizations/mine/roles', { preHandler: administrator }, async (request) => {
    const { organizationId } = resolveCustomerContext(request);
    return { data: await roleService.list(organizationId, await language(request)) };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/roles/:id',
    { preHandler: administrator, schema: { params: roleParamsSchema } },
    async (request) => {
      const { organizationId } = resolveCustomerContext(request);
      const { id } = roleParamsSchema.parse(request.params);
      return { data: await roleService.get(organizationId, id, await language(request)) };
    },
  );

  app.post(
    '/api/v1/organizations/mine/roles',
    { preHandler: administrator, schema: { body: createOrganizationRoleRequestSchema } },
    async (request, reply) => {
      const { organizationId } = resolveCustomerContext(request);
      const body = createOrganizationRoleRequestSchema.parse(request.body);
      const role = await roleService.create(organizationId, body, await language(request));
      reply.status(201);
      return { data: role };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/roles/:id',
    { preHandler: administrator, schema: { params: roleParamsSchema, body: updateOrganizationRoleRequestSchema } },
    async (request) => {
      const { organizationId } = resolveCustomerContext(request);
      const { id } = roleParamsSchema.parse(request.params);
      const body = updateOrganizationRoleRequestSchema.parse(request.body);
      return { data: await roleService.update(organizationId, id, body, await language(request)) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/mine/roles/:id',
    { preHandler: administrator, schema: { params: roleParamsSchema, body: deleteOrganizationRoleRequestSchema } },
    async (request) => {
      const { organizationId } = resolveCustomerContext(request);
      const { id } = roleParamsSchema.parse(request.params);
      const body = deleteOrganizationRoleRequestSchema.parse(request.body);
      return { data: await roleService.delete(organizationId, id, body) };
    },
  );

  app.get('/api/v1/organizations/mine/permission-catalogue', { preHandler: administrator }, async (request) => {
    return { data: await roleService.permissionCatalogue(await language(request)) };
  });

  // FR-058 — every member may read their own role.
  app.get('/api/v1/organizations/mine/role', { preHandler: requireCustomer }, async (request) => {
    return {
      data: await roleService.ownRole(subjectOf(request, resolveCustomerContext), await language(request)),
    };
  });
}
