import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createAdminUserRequestSchema,
  updateAdminUserRequestSchema,
  updateAdminUserSelfRequestSchema,
  upsertAdminRoleRequestSchema,
  PERMISSION_CATALOGUE,
} from '@b2b/contracts';
import type { AdminUserService } from './services/admin-user-service.js';
import type { AdminRoleService } from '../admin_roles/services/admin-role-service.js';
import type { PermissionService } from '../admin_roles/services/permission-service.js';
import type { AdminUser } from './entities/admin-user.entity.js';
import type { AdminRole } from '../admin_roles/entities/admin-role.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Admin user + role CRUD (T193 / FR-080..FR-083). All gated by
 * `admin_users:manage`. The wildcard `*` is intentionally not exposed
 * by this surface — bootstrap-only.
 */

export interface AdminUsersAdminDeps {
  adminUserService: AdminUserService;
  adminRoleService: AdminRoleService;
  permissionService: PermissionService;
  requireAdmin: RequireAdminFactory;
  /** Resolves the current admin's id — reads `request.actor` in production
   *  and `request.testActor` under the test harness. */
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

export async function registerAdminUsersAdminRoutes(
  app: FastifyInstance,
  deps: AdminUsersAdminDeps,
): Promise<void> {
  const {
    adminUserService,
    adminRoleService,
    permissionService,
    requireAdmin,
    resolveAdminContext,
  } = deps;

  // --- Current admin (for the UI auth gate) ---------------------------------
  app.get(
    '/api/v1/admin/me',
    { preHandler: requireAdmin() },
    async (request) => {
      const ctx = resolveAdminContext(request);
      const adminUser = await adminUserService.getById(ctx.adminUserId);
      const permissions = await permissionService.listPermissions(adminUser.id);
      const role = adminUser.adminRoleId
        ? await adminRoleService.getById(adminUser.adminRoleId).catch(() => null)
        : null;
      return {
        data: {
          adminUser: serializeAdminUser(adminUser),
          role: role ? serializeAdminRole(role) : null,
          permissions,
        },
      };
    },
  );

  // --- Self profile edit ------------------------------------------------------
  // Any authenticated admin can edit their own first/last name and rotate
  // their password without holding `admin_users:manage`. Role + status
  // changes are intentionally NOT exposed here.
  app.patch(
    '/api/v1/admin/me',
    {
      preHandler: requireAdmin(),
      schema: { body: updateAdminUserSelfRequestSchema },
    },
    async (request) => {
      const ctx = resolveAdminContext(request);
      const body = updateAdminUserSelfRequestSchema.parse(request.body);
      const user = await adminUserService.update(ctx.adminUserId, {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.password !== undefined ? { password: body.password } : {}),
      });
      return { data: serializeAdminUser(user) };
    },
  );

  // --- Permissions catalogue -------------------------------------------------
  app.get(
    '/api/v1/admin/permissions',
    { preHandler: requireAdmin('admin_users:manage') },
    async () => ({ data: PERMISSION_CATALOGUE }),
  );

  // --- Admin users -----------------------------------------------------------
  app.get(
    '/api/v1/admin/admin-users',
    { preHandler: requireAdmin('admin_users:manage') },
    async () => {
      const rows = await adminUserService.list();
      return { data: rows.map(serializeAdminUser) };
    },
  );

  app.post(
    '/api/v1/admin/admin-users',
    {
      preHandler: requireAdmin('admin_users:manage'),
      schema: { body: createAdminUserRequestSchema },
    },
    async (request, reply) => {
      const body = createAdminUserRequestSchema.parse(request.body);
      const user = await adminUserService.create({
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        ...(body.adminRoleId !== undefined ? { adminRoleId: body.adminRoleId } : {}),
      });
      reply.status(201);
      return { data: serializeAdminUser(user) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/admin-users/:id',
    {
      preHandler: requireAdmin('admin_users:manage'),
      schema: { body: updateAdminUserRequestSchema },
    },
    async (request) => {
      const body = updateAdminUserRequestSchema.parse(request.body);
      const user = await adminUserService.update(request.params.id, {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.adminRoleId !== undefined ? { adminRoleId: body.adminRoleId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      });
      return { data: serializeAdminUser(user) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/admin-users/:id',
    { preHandler: requireAdmin('admin_users:manage') },
    async (request, reply) => {
      await adminUserService.softDelete(request.params.id);
      reply.status(204).send();
    },
  );

  // --- Admin roles -----------------------------------------------------------
  app.get(
    '/api/v1/admin/admin-roles',
    { preHandler: requireAdmin('admin_users:manage') },
    async () => {
      const rows = await adminRoleService.list();
      return { data: rows.map(serializeAdminRole) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/admin-roles/:code',
    {
      preHandler: requireAdmin('admin_users:manage'),
      schema: { body: upsertAdminRoleRequestSchema },
    },
    async (request) => {
      const body = upsertAdminRoleRequestSchema.parse(request.body);
      const role = await adminRoleService.upsertByCode({
        code: request.params.code,
        name: body.name,
        permissions: body.permissions,
        ...(body.requiresTwoFactor !== undefined
          ? { requiresTwoFactor: body.requiresTwoFactor }
          : {}),
      });
      return { data: serializeAdminRole(role) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/admin-roles/:id',
    { preHandler: requireAdmin('admin_users:manage') },
    async (request, reply) => {
      await adminRoleService.remove(request.params.id);
      reply.status(204).send();
    },
  );
}

function serializeAdminUser(u: AdminUser) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    adminRoleId: u.adminRoleId ?? null,
    twoFactorEnabled: !!u.twoFactorConfirmedAt,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function serializeAdminRole(r: AdminRole) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    permissions: r.permissions,
    requiresTwoFactor: r.requiresTwoFactor,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
