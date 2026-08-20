import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminRolePort, AuthSessionPort } from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import type { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { hashPassword, verifyPassword } from '../../../src/kernel/crypto/password-hasher.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminUserService } from '../../../src/modules/admin_users/services/admin-user-service.js';

/**
 * Issue #252 — the peer password-reset seam, on its three claims:
 *
 *   1. the target's sessions are revoked **before** the new hash is flushed,
 *      so a refusal at the seam leaves the account exactly as it was rather
 *      than pairing a new password with the old password's sessions;
 *   2. the audit row names the action and the route taken and carries neither
 *      the password nor its hash;
 *   3. nothing catches a refusal from `auth` — the reset fails closed instead
 *      of reporting a success it did not achieve.
 */

const OLD_PASSWORD = 'the-original-strong-pass';
const NEW_PASSWORD = 'the-replacement-strong-pass';

interface AuditRecord {
  action: string;
  objectType: string;
  objectId: string;
  stateBefore: unknown;
  stateAfter: unknown;
}

async function makeAdmin(): Promise<AdminUser> {
  return {
    id: 'a-1',
    email: 'operator@example.test',
    firstName: 'Ada',
    lastName: 'Operator',
    passwordHash: await hashPassword(OLD_PASSWORD),
    adminRoleId: 'r-1',
    status: 'active',
    deletedAt: null,
    lastLoginAt: null,
  } as unknown as AdminUser;
}

/** Records every step in the one order the caller performed them in. */
function tracingEm(
  admin: AdminUser | null,
  steps: string[],
): () => EntityManager {
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AdminUser) throw new Error('unexpected entity');
      if (admin === null) return null;
      if (where['id'] !== undefined && where['id'] !== admin.id) return null;
      return admin;
    },
    flush: async () => {
      steps.push('flush');
    },
  } as unknown as EntityManager;
  return () => em;
}

function recordingAuditLog(entries: AuditRecord[]): AuditLogService {
  return {
    recordWithin: (_em: EntityManager, input: AuditRecord) => {
      entries.push(input);
    },
  } as unknown as AuditLogService;
}

const rolePort = {} as unknown as AdminRolePort;

describe('admin_users — peer password reset', () => {
  it('revokes the target sessions before flushing the new hash', async () => {
    const admin = await makeAdmin();
    const steps: string[] = [];
    const entries: AuditRecord[] = [];
    const sessions = {
      destroyAllForAdmin: async (adminUserId: string) => {
        steps.push(`revoke:${adminUserId}`);
      },
    } as unknown as AuthSessionPort;

    const service = new AdminUserService(
      tracingEm(admin, steps),
      rolePort,
      sessions,
      recordingAuditLog(entries),
    );

    const updated = await service.resetPassword('a-1', NEW_PASSWORD);

    expect(steps).toEqual(['revoke:a-1', 'flush']);
    expect(await verifyPassword(updated.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(updated.passwordHash, OLD_PASSWORD)).toBe(false);
  });

  it('audits the change without recording the password or its hash', async () => {
    const admin = await makeAdmin();
    const steps: string[] = [];
    const entries: AuditRecord[] = [];
    const sessions = {
      destroyAllForAdmin: async () => {},
    } as unknown as AuthSessionPort;

    const service = new AdminUserService(
      tracingEm(admin, steps),
      rolePort,
      sessions,
      recordingAuditLog(entries),
    );
    const updated = await service.resetPassword('a-1', NEW_PASSWORD);

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.action).toBe('admin_user.change_password');
    expect(entry.objectType).toBe('admin_user');
    expect(entry.objectId).toBe('a-1');
    expect(entry.stateAfter).toMatchObject({ via: 'peer_reset' });

    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain(NEW_PASSWORD);
    expect(serialised).not.toContain(OLD_PASSWORD);
    expect(serialised).not.toContain(updated.passwordHash);
    expect(serialised).not.toContain('$argon2');
  });

  it('fails closed when the session seam refuses, leaving the password alone', async () => {
    const admin = await makeAdmin();
    const originalHash = admin.passwordHash;
    const steps: string[] = [];
    const entries: AuditRecord[] = [];
    const sessions = {
      destroyAllForAdmin: async () => {
        throw new Error('MODULE_DISABLED');
      },
    } as unknown as AuthSessionPort;

    const service = new AdminUserService(
      tracingEm(admin, steps),
      rolePort,
      sessions,
      recordingAuditLog(entries),
    );

    await expect(service.resetPassword('a-1', NEW_PASSWORD)).rejects.toThrow('MODULE_DISABLED');
    expect(admin.passwordHash).toBe(originalHash);
    expect(steps).not.toContain('flush');
    expect(entries).toHaveLength(0);
  });

  it('404s on an admin user that is not there', async () => {
    const steps: string[] = [];
    const sessions = {
      destroyAllForAdmin: async () => {
        steps.push('revoke');
      },
    } as unknown as AuthSessionPort;

    const service = new AdminUserService(
      tracingEm(null, steps),
      rolePort,
      sessions,
      recordingAuditLog([]),
    );

    await expect(service.resetPassword('a-missing', NEW_PASSWORD)).rejects.toThrow(
      'Admin user not found.',
    );
    expect(steps).toEqual([]);
  });
});
