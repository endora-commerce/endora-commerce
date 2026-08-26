import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createAdminUserRequestSchema,
  resetAdminUserPasswordRequestSchema,
  updateAdminUserRequestSchema,
  updateAdminUserSelfRequestSchema,
  upsertAdminRoleRequestSchema,
  type AdminRolePort,
  type AdminRoleRecord,
  type PermissionCataloguePort,
  type PermissionReadPort,
} from '@endora-commerce/contracts';
import type { AdminUserService } from './services/admin-user-service.js';
import type { AdminUser } from './entities/admin-user.entity.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin user + role CRUD (T193 / FR-080..FR-083). All gated by
 * `admin_users:manage`. The wildcard `*` is intentionally not exposed
 * by this surface — bootstrap-only.
 */

export interface AdminUsersAdminDeps {
  adminUserService: AdminUserService;
  adminRolePort: AdminRolePort;
  permissionCataloguePort: PermissionCataloguePort;
  permissionService: PermissionReadPort;
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
    adminRolePort,
    permissionCataloguePort,
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
      // No `.catch(() => null)` around the port call (feature 075, Phase C,
      // FR-032): it would swallow `ModuleDisabledError` and answer "this admin
      // has no role" for "`admin_roles` is not here", which is the fail-open
      // the gate exists to prevent. Nothing is lost by dropping it —
      // `admin_users_admin_role_fk` is `on delete restrict`
      // (`migrations/20260425T053028_admin_users_init.ts:41`), so a non-null
      // `adminRoleId` always names a live role.
      const role = adminUser.adminRoleId
        ? await adminRolePort.getById(adminUser.adminRoleId)
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
    async () => ({ data: permissionCataloguePort.listAssignable() }),
  );

  // --- Admin users -----------------------------------------------------------
  app.get(
    '/api/v1/admin/admin-users',
    { preHandler: requireAdmin('admin_users:manage') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const search = q['q']?.trim();
      const result = await adminUserService.list({
        ...(search ? { q: search } : {}),
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
      });
      return {
        data: result.items.map(serializeAdminUser),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          cursor: null,
          hasMore: (result.page + 1) * result.pageSize < result.total,
          limit: result.items.length,
        },
      };
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

  // --- Peer password reset (issue #252) ---------------------------------------
  //
  // The capability `admin_users`' manifest has always promised. Gated by
  // `admin_users:manage`, the same code that already gates creating an admin
  // user and assigning it any role — including the role holding `*`. A
  // narrower code would be absent from every role on every deployment that
  // exists today, so shipping one would leave the lockout it closes open until
  // somebody with `*` edited the roles, which is the bootstrap problem again.
  //
  // An operator holding the code may target themselves. There is no role
  // hierarchy here to rank a reset against, and the same code already assigns
  // any role including the one holding `*`, so a self-target guard would close
  // nothing — while making this route disagree with the e-mail-keyed flow that
  // follows, which is self-targeted by construction.
  //
  // Own path rather than a `password` field on the PATCH: setting a password
  // has its own audit action and revokes the target's sessions, and a request
  // that renamed and reset in one call would have to answer for both.
  // `/password-reset` is deliberately left free for the e-mail-keyed flow that
  // follows, so the two never collide on one verb — this one **sets** a
  // password, that one will **send** a link, exactly as
  // `POST /api/v1/admin/customers/:id/password-reset` already does.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/admin-users/:id/password',
    {
      preHandler: requireAdmin('admin_users:manage'),
      schema: { body: resetAdminUserPasswordRequestSchema },
    },
    async (request) => {
      const body = resetAdminUserPasswordRequestSchema.parse(request.body);
      const user = await adminUserService.resetPassword(request.params.id, body.password);
      return { data: serializeAdminUser(user) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/admin-users/:id',
    { preHandler: requireAdmin('admin_users:manage') },
    async (request, reply) => {
      await adminUserService.softDelete(request.params.id);
      return reply.status(204).send();
    },
  );

  // --- Admin roles -----------------------------------------------------------
  app.get(
    '/api/v1/admin/admin-roles',
    { preHandler: requireAdmin('admin_users:manage') },
    async () => {
      const rows = await adminRolePort.list();
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
      const role = await adminRolePort.upsertByCode({
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
      await adminRolePort.remove(request.params.id);
      return reply.status(204).send();
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
    // Feature 019: surface the per-user Admin UI language preference so the
    // SPA's TranslationProvider can seed itself without a separate fetch.
    preferredLanguage: u.preferredLanguage ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function serializeAdminRole(r: AdminRoleRecord) {
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
