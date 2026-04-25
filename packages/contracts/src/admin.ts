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
  twoFactorCode: z.string().optional(),
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
