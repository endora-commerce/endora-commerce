import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createOrganizationRoleRequestSchema,
  deleteOrganizationRoleRequestSchema,
  supportedLanguageOf,
  updateOrganizationRoleRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminAnyFactory, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OrganizationRoleService } from './services/organization-role-service.js';

/**
 * The operator role routes (`specs/170-organization-roles/`,
 * `contracts/operator-api.md` §1–§2; owner ruling OR-7; FR-060, FR-061).
 *
 * `organizations:read-roles` (or `organizations:manage-roles`) reads, and
 * `organizations:manage-roles` writes. The same Commands the storefront runs
 * serve these routes: the bus takes the actor from the ambient context, so the
 * audit entry names the operator (R-10, R-21). The Organization is read in the
 * request's tenant scope, so a scoped operator outside its reach — like an
 * unknown or a personal Organization — gets `404` (Principle XI).
 */
export interface OrganizationAdminRoleRoutesDeps {
  readonly roleService: OrganizationRoleService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireAdminAny: RequireAdminAnyFactory;
}

const organizationParamsSchema = z.object({ id: z.string().uuid() });
const roleParamsSchema = z.object({ id: z.string().uuid(), roleId: z.string().uuid() });

export async function registerOrganizationAdminRoleRoutes(
  app: FastifyInstance,
  deps: OrganizationAdminRoleRoutesDeps,
): Promise<void> {
  const { roleService, requireAdmin, requireAdminAny } = deps;
  const readRoles = requireAdminAny(['organizations:read-roles', 'organizations:manage-roles']);
  const manageRoles = requireAdmin('organizations:manage-roles');
  const language = async (request: FastifyRequest) => supportedLanguageOf(await request.responseLanguage());

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/roles',
    { preHandler: readRoles, schema: { params: organizationParamsSchema } },
    async (request) => {
      const { id } = organizationParamsSchema.parse(request.params);
      return { data: await roleService.list(id, await language(request)) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/permission-catalogue',
    { preHandler: readRoles, schema: { params: organizationParamsSchema } },
    async (request) => {
      const { id } = organizationParamsSchema.parse(request.params);
      // The catalogue is platform-wide; the Organization is checked so the path
      // answers 404 exactly where the roles list does.
      await roleService.assertCompanyOrganization(id);
      return { data: await roleService.permissionCatalogue(await language(request)) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/roles',
    { preHandler: manageRoles, schema: { params: organizationParamsSchema, body: createOrganizationRoleRequestSchema } },
    async (request, reply) => {
      const { id } = organizationParamsSchema.parse(request.params);
      const body = createOrganizationRoleRequestSchema.parse(request.body);
      const role = await roleService.create(id, body, await language(request));
      reply.status(201);
      return { data: role };
    },
  );

  app.patch<{ Params: { id: string; roleId: string } }>(
    '/api/v1/admin/organizations/:id/roles/:roleId',
    { preHandler: manageRoles, schema: { params: roleParamsSchema, body: updateOrganizationRoleRequestSchema } },
    async (request) => {
      const { id, roleId } = roleParamsSchema.parse(request.params);
      const body = updateOrganizationRoleRequestSchema.parse(request.body);
      return { data: await roleService.update(id, roleId, body, await language(request)) };
    },
  );

  app.delete<{ Params: { id: string; roleId: string } }>(
    '/api/v1/admin/organizations/:id/roles/:roleId',
    { preHandler: manageRoles, schema: { params: roleParamsSchema, body: deleteOrganizationRoleRequestSchema } },
    async (request) => {
      const { id, roleId } = roleParamsSchema.parse(request.params);
      const body = deleteOrganizationRoleRequestSchema.parse(request.body);
      return { data: await roleService.delete(id, roleId, body) };
    },
  );
}
