import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { AuditLogEntry, AuditLogEntryResponse, auditLogEntrySchema } from './admin.js';
import {
  adminMeResponseSchema,
  updateAdminUserRequestSchema,
  updateAdminUserSelfRequestSchema,
} from './admin.js';
import { ADMIN_PREFERENCES_DEFAULTS } from './admin-preferences.js';

/**
 * `PATCH /api/v1/admin/me` — the self-update payload.
 *
 * A new password is a credential change, so the payload that carries one has
 * to carry the current password too. The rule is on the schema because the
 * schema is the published request shape: an API client reads it there.
 */
describe('updateAdminUserSelfRequestSchema', () => {
  it('accepts a profile-only update without any password', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({ firstName: 'Ada' });
    expect(parsed.success).toBe(true);
  });

  it('accepts a new password accompanied by the current one', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      password: 'a-new-strong-pass-123!',
      currentPassword: 'whatever-it-was',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a new password without the current one, and names the field', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      firstName: 'Ada',
      password: 'a-new-strong-pass-123!',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['currentPassword']]);
  });

  it('refuses an empty current password', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({
      password: 'a-new-strong-pass-123!',
      currentPassword: '',
    });
    expect(parsed.success).toBe(false);
  });

  it('still refuses fields the self-update does not expose', () => {
    const parsed = updateAdminUserSelfRequestSchema.safeParse({ email: 'other@example.com' });
    expect(parsed.success).toBe(false);
  });
});

describe('updateAdminUserRequestSchema', () => {
  // The generic edit of somebody else's account carries no password. Setting
  // one is `POST /api/v1/admin/admin-users/:id/password`, which revokes the
  // target's sessions and has its own audit action; a `password` accepted here
  // would be a password write that does neither.
  it.each(['password', 'currentPassword', 'newPassword', 'passwordHash'])(
    'refuses `%s`',
    (field) => {
      const result = updateAdminUserRequestSchema.safeParse({
        firstName: 'Ada',
        [field]: 'a-new-strong-pass-456!',
      });
      expect(result.success).toBe(false);
    },
  );

  it('accepts the fields it is for', () => {
    expect(
      updateAdminUserRequestSchema.safeParse({ firstName: 'Ada', status: 'inactive' }).success,
    ).toBe(true);
  });
});

/**
 * `GET /api/v1/admin/me` carries the admin's own preferences (feature 164, FR-016),
 * `null` when the server could not read them (FR-018). The server always sends
 * the key.
 */
describe('adminMeResponseSchema — preferences', () => {
  const me = {
    adminUser: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      adminRoleId: null,
      twoFactorEnabled: false,
      status: 'active',
      lastLoginAt: null,
      createdAt: '2026-10-27T00:00:00.000Z',
      updatedAt: '2026-10-27T00:00:00.000Z',
    },
    role: null,
    permissions: [],
    idleLogoutMinutes: null,
  };

  it('accepts a full preferences document', () => {
    const parsed = adminMeResponseSchema.safeParse({
      ...me,
      preferences: { ...ADMIN_PREFERENCES_DEFAULTS, sidebarPins: ['/orders'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts `null` preferences', () => {
    expect(adminMeResponseSchema.safeParse({ ...me, preferences: null }).success).toBe(true);
  });

  it('refuses a response without the key', () => {
    expect(adminMeResponseSchema.safeParse(me).success).toBe(false);
  });
});

/**
 * The audit-log row as the API returns it (issue #84). `@endora-commerce/platform/kernel`
 * publishes `AuditLogEntry` as the MikroORM entity of an `audit_logs` row, so the
 * contract's type carries the package's `…Response` suffix instead. `AuditLogEntry`
 * stays for one minor release as a deprecated alias of the same type.
 */
describe('AuditLogEntryResponse', () => {
  it('is the shape inferred from `auditLogEntrySchema`', () => {
    expectTypeOf<AuditLogEntryResponse>().toEqualTypeOf<z.infer<typeof auditLogEntrySchema>>();
  });

  it('keeps the deprecated `AuditLogEntry` as an alias of it', () => {
    expectTypeOf<AuditLogEntry>().toEqualTypeOf<AuditLogEntryResponse>();
  });
});
