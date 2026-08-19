import { describe, expect, it, vi } from 'vitest';
import { createAdminUserRequestSchema } from '@b2b/contracts';
import { SocialIdentityService } from '../../../src/modules/mfa/services/social-identity-service.js';
import type { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Issue #222 — why `admin_users` gets no `passwordSetAt` column.
 *
 * The customer side needed one because federated sign-in *creates* accounts and
 * gives them a password nobody is told, so `password_hash is not null` answers
 * a different question from "can the holder sign in with a password". Neither
 * half of that is true of an admin:
 *
 *   1. every path that creates an `AdminUser` takes a caller-supplied password,
 *      and the request schema makes it mandatory rather than optional; and
 *   2. the admin branch of federated sign-in matches an existing admin and
 *      refuses when there is none — it never creates one.
 *
 * So "this admin has a password a person chose" is structurally true, and
 * `SocialLinkService` answers it without a read. This test is what stops that
 * premise from rotting silently: make the password optional, or teach the admin
 * branch to auto-create, and the answer stops being free.
 */
describe('the admin arm needs no passwordSetAt (issue #222)', () => {
  it('refuses to create an admin user without a password', () => {
    const withoutPassword = {
      email: 'new-admin@example.test',
      firstName: 'New',
      lastName: 'Admin',
    };
    expect(createAdminUserRequestSchema.safeParse(withoutPassword).success).toBe(false);
    expect(
      createAdminUserRequestSchema.safeParse({
        ...withoutPassword,
        password: 'a-strong-admin-pass',
      }).success,
    ).toBe(true);
  });

  it('never auto-creates an admin from a federated sign-in', async () => {
    const em = { findOne: vi.fn(), create: vi.fn(), persist: vi.fn(), flush: vi.fn() };
    const auditLog = { record: vi.fn() } as unknown as AuditLogService;
    const resolveAdminByEmail = vi.fn(async () => null);

    const service = new SocialIdentityService(
      () => em as unknown as EntityManager,
      {
        resolveCustomerByEmail: async () => null,
        autoCreateCustomer: async () => ({ id: 'never-reached' }),
        resolveAdminByEmail,
      },
      auditLog,
    );

    const result = await service.signInAdmin({
      provider: 'google',
      sub: 'google-sub-222',
      email: 'stranger@example.test',
      emailVerified: true,
    });

    expect(result).toEqual({ ok: false, reason: 'no_account' });
    expect(resolveAdminByEmail).toHaveBeenCalledOnce();
    // Nothing was written: no row, no link, no audit entry. There is no
    // "auto-create an admin" seam for one to have gone through.
    expect(em.create).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
