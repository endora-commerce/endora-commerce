import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Admin module contracts (US4) — AdminUser, AdminRole, Impersonation,
 * AuditLogEntry. Source of truth per Principle V.
 *
 * Permission strings are screaming-snake or `module:action` (e.g.
 * `catalog:write`, `orders:read`, `customers:impersonate`). The matrix is
 * stored on AdminRole as a JSONB array.
 */

export const adminUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  adminRoleId: uuidSchema.nullable(),
  twoFactorEnabled: z.boolean(),
  status: z.enum(['active', 'inactive']),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminRoleSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  requiresTwoFactor: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const impersonationRequestSchema = z.object({
  customerAccountId: uuidSchema,
  reason: z.string().max(2000).optional(),
});
export type ImpersonationRequest = z.infer<typeof impersonationRequestSchema>;

export const impersonationStartResponseSchema = z.object({
  impersonationSessionId: uuidSchema,
  impersonatedCustomerAccount: z.object({
    id: uuidSchema,
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(['organization_admin', 'regular_user']),
  }),
});
export type ImpersonationStartResponse = z.infer<typeof impersonationStartResponseSchema>;

// --- Admin user CRUD --------------------------------------------------------

export const createAdminUserRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(256),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  adminRoleId: uuidSchema.nullable().optional(),
});
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;

export const updateAdminUserRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    adminRoleId: uuidSchema.nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>;

/**
 * Self-update payload — every authenticated admin can edit their own
 * first/last name and rotate their password without needing the
 * `admin_users:manage` permission. Role and status are intentionally
 * NOT exposed here.
 */
export const updateAdminUserSelfRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    password: z.string().min(12).max(120).optional(),
  })
  .strict();
export type UpdateAdminUserSelfRequest = z.infer<typeof updateAdminUserSelfRequestSchema>;

/**
 * Peer password reset (issue #252) — one operator sets another operator's
 * password. Deliberately its own payload rather than a `password` field on
 * `updateAdminUserRequestSchema`: setting a password is not an edit to a field
 * alongside a name change. It has its own audit action and its own side effect
 * (every session the target holds is revoked), and a request that renamed and
 * reset in one call would have to answer for both.
 *
 * The bound matches `createAdminUserRequestSchema` — the same password, made
 * by the same operator, on the same account.
 */
export const resetAdminUserPasswordRequestSchema = z
  .object({
    password: z.string().min(12).max(256),
  })
  .strict();
export type ResetAdminUserPasswordRequest = z.infer<typeof resetAdminUserPasswordRequestSchema>;

// --- Admin role CRUD --------------------------------------------------------

export const upsertAdminRoleRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  permissions: z.array(z.string().min(1).max(120)),
  requiresTwoFactor: z.boolean().optional(),
});
export type UpsertAdminRoleRequest = z.infer<typeof upsertAdminRoleRequestSchema>;

/** Optional per-module permission declaration on `ModuleManifest.permissions`. */
export const modulePermissionDeclarationSchema = z.object({
  code: z.string().min(1).max(120),
  module: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
});
export type ModulePermissionDeclaration = z.infer<typeof modulePermissionDeclarationSchema>;

/** Row shape returned by `GET /admin/permissions`. */
export const permissionCatalogueEntrySchema = z.object({
  code: z.string().min(1).max(120),
  module: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
});
export type PermissionCatalogueEntry = z.infer<typeof permissionCatalogueEntrySchema>;

/**
 * Canonical permission catalogue exposed by `GET /admin/permissions`.
 * The matrix UI groups by `module`; the wildcard `*` is intentionally not
 * in the catalogue (it's only granted to the bootstrap "platform_admin").
 */
export const PERMISSION_CATALOGUE = [
  { code: 'catalog:read', module: 'catalog', label: 'View catalog' },
  { code: 'catalog:write', module: 'catalog', label: 'Edit catalog' },
  { code: 'orders:read', module: 'orders', label: 'View orders' },
  { code: 'orders:write', module: 'orders', label: 'Edit orders / change status' },
  { code: 'rfqs:handle', module: 'quote_requests', label: 'Handle quote requests' },
  { code: 'customers:read', module: 'customers', label: 'View customers' },
  { code: 'customers:impersonate', module: 'customers', label: 'Impersonate customers' },
  // Shared gate for the API-keys and webhooks admin surfaces. The name predates
  // the removal of the `integrations` module; renaming it would need a data
  // migration on every admin role's permission list.
  { code: 'integrations:manage', module: 'api_keys', label: 'Manage API keys + webhooks' },
  // Feature 072, T017 — the module id is `audit_logs`. It said `audit_log`,
  // which matches no module, so the role matrix grouped this permission under a
  // phantom module. The CODE keeps its historical spelling: it is persisted in
  // every admin role's permission list and renaming it would need a data migration.
  { code: 'audit_log:read', module: 'audit_logs', label: 'View audit log' },
  { code: 'admin_users:manage', module: 'admin_users', label: 'Manage admin users + roles' },
  { code: 'credit_limits:manage', module: 'credit_limits', label: 'Grant + adjust credit limits' },
  { code: 'customers:manage', module: 'customers', label: 'Manage customer organizations' },
  {
    code: 'organizations:rollup',
    module: 'organizations',
    label: 'Act across organization descendants',
  },
  { code: 'blog.read', module: 'blog', label: 'View blog content' },
  { code: 'blog.write', module: 'blog', label: 'Author + publish blog content' },
] as const;

// --- Audit log --------------------------------------------------------------

export const auditLogEntrySchema = z.object({
  id: uuidSchema,
  actorAdminUserId: uuidSchema.nullable(),
  impersonatedCustomerAccountId: uuidSchema.nullable(),
  actedAt: isoDateTimeSchema,
  action: z.string(),
  objectType: z.string(),
  objectId: z.string(),
  stateBefore: z.record(z.string(), z.unknown()).nullable(),
  stateAfter: z.record(z.string(), z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
