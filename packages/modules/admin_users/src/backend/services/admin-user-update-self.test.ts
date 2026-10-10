/**
 * An administrator changing their own password proves they know the current
 * one, and a refused change leaves the account exactly as it was — its
 * sessions included. An accepted one revokes every session but the caller's,
 * before the new hash is written, and is audited as a password change.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminRolePort,
  AuthResolvedSession,
  AuthSessionPort,
  MfaLoginPort,
} from '@endora-commerce/contracts';
import {
  hashPassword,
  verifyPassword,
  type AuditPort,
} from '@endora-commerce/platform/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminUserService } from './admin-user-service.js';

const CURRENT = 'the-current-pass-123!';
const NEXT = 'a-new-strong-pass-456!';

let currentHash: string;

interface AuditRecord {
  action: string;
  objectId: string;
  stateBefore: unknown;
  stateAfter: unknown;
}

interface Harness {
  service: AdminUserService;
  flushes: () => number;
  /** Every step in the order the service performed it. */
  steps: string[];
  audit: AuditRecord[];
}

/** The cookie values the stub session port resolves, and to what. */
const COOKIES: Record<string, { kind: string; adminUserId: string; id: string }> = {
  'own-cookie': { kind: 'admin', adminUserId: 'a1', id: 's-own' },
  'someone-elses-cookie': { kind: 'admin', adminUserId: 'a2', id: 's-other-admin' },
  'impersonation-cookie': { kind: 'impersonation', adminUserId: 'a1', id: 's-impersonation' },
};

function serviceOver(existing: AdminUser): Harness {
  let flushes = 0;
  const steps: string[] = [];
  const audit: AuditRecord[] = [];
  const em = {
    findOne: async () => existing,
    flush: async () => {
      flushes += 1;
      steps.push('flush');
    },
  } as unknown as EntityManager;
  const sessions = {
    loadSession: async (cookieValue: string) => {
      const found = COOKIES[cookieValue];
      if (!found) return null;
      return {
        kind: found.kind,
        session: { id: found.id, adminUserId: found.adminUserId },
      } as unknown as AuthResolvedSession;
    },
    destroyAllForAdmin: async (adminUserId: string, options?: { exceptSessionId?: string }) => {
      steps.push(`revoke:${adminUserId}:except=${options?.exceptSessionId ?? 'none'}`);
    },
  } as unknown as AuthSessionPort;
  const auditLog = {
    recordWithin: (_em: EntityManager, input: AuditRecord) => {
      audit.push(input);
    },
  } as unknown as AuditPort;
  const mfa = {
    invalidatePending: async (subject: { subjectType: string; subjectId: string }) => {
      steps.push(`mfa:${subject.subjectType}:${subject.subjectId}`);
    },
  } as unknown as MfaLoginPort;
  return {
    service: new AdminUserService(() => em, {} as AdminRolePort, sessions, auditLog, () => mfa),
    flushes: () => flushes,
    steps,
    audit,
  };
}

function account(): AdminUser {
  return Object.assign(new AdminUser(), {
    id: 'a1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    passwordHash: currentHash,
    status: 'active',
  });
}

describe('AdminUserService.updateSelf', () => {
  beforeAll(async () => {
    currentHash = await hashPassword(CURRENT);
  });

  it('edits the name without any password', async () => {
    const existing = account();
    const { service, flushes, steps, audit } = serviceOver(existing);
    await service.updateSelf('a1', { firstName: 'Augusta' }, { sessionCookieValue: 'own-cookie' });
    expect(existing.firstName).toBe('Augusta');
    expect(existing.passwordHash).toBe(currentHash);
    expect(flushes()).toBe(1);
    // A name is not a credential: no session is touched.
    expect(steps).toEqual(['flush']);
    expect(audit.map((entry) => entry.action)).toEqual(['admin_user.update']);
  });

  it.each([
    ['no current password', undefined],
    ['a wrong current password', 'not-the-current-password'],
    ['an empty current password', ''],
  ])('refuses a new password with %s and writes nothing', async (_label, currentPassword) => {
    const existing = account();
    const { service, flushes, steps, audit } = serviceOver(existing);
    await expect(
      service.updateSelf(
        'a1',
        { firstName: 'Augusta', lastName: 'King', password: NEXT, currentPassword },
        { sessionCookieValue: 'own-cookie' },
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CURRENT_PASSWORD_INVALID' });
    // Nothing was revoked and nothing was audited.
    expect(steps).toEqual([]);
    expect(audit).toEqual([]);
    expect(existing).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordHash: currentHash,
    });
    expect(flushes()).toBe(0);
  });

  it('stores the new password, and the rest of the request, when the current one is right', async () => {
    const existing = account();
    const { service, flushes } = serviceOver(existing);
    await service.updateSelf('a1', { lastName: 'King', password: NEXT, currentPassword: CURRENT });
    expect(existing.lastName).toBe('King');
    expect(await verifyPassword(existing.passwordHash, NEXT)).toBe(true);
    expect(await verifyPassword(existing.passwordHash, CURRENT)).toBe(false);
    expect(flushes()).toBe(1);
  });

  it('ignores a current password sent without a new one', async () => {
    const existing = account();
    const { service } = serviceOver(existing);
    await service.updateSelf('a1', { firstName: 'Augusta', currentPassword: 'anything' });
    expect(existing.firstName).toBe('Augusta');
    expect(existing.passwordHash).toBe(currentHash);
  });

  it('withdraws every session but the caller\'s, and the pending logins, after the new hash is written', async () => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.updateSelf(
      'a1',
      { password: NEXT, currentPassword: CURRENT },
      { sessionCookieValue: 'own-cookie' },
    );
    expect(steps).toEqual(['flush', 'revoke:a1:except=s-own', 'mfa:admin:a1']);
  });

  it.each([
    ['no cookie', undefined],
    ['a cookie that resolves to nothing', 'forged-cookie'],
    ['another administrator\'s session', 'someone-elses-cookie'],
    ['an impersonation session', 'impersonation-cookie'],
  ])('spares no session when the request carries %s', async (_label, sessionCookieValue) => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.updateSelf(
      'a1',
      { password: NEXT, currentPassword: CURRENT },
      { sessionCookieValue },
    );
    expect(steps).toEqual(['flush', 'revoke:a1:except=none', 'mfa:admin:a1']);
  });

  it('reports a refusal from the revocation instead of a success', async () => {
    const existing = account();
    const refusing = {
      loadSession: async () => null,
      destroyAllForAdmin: async () => {
        throw new Error('auth is not here');
      },
    } as unknown as AuthSessionPort;
    const em = { findOne: async () => existing, flush: async () => {} } as unknown as EntityManager;
    const failing = new AdminUserService(() => em, {} as AdminRolePort, refusing);
    await expect(
      failing.updateSelf('a1', { lastName: 'King', password: NEXT, currentPassword: CURRENT }),
    ).rejects.toThrow('auth is not here');
  });

  it('changes the password without a second factor module to tell', async () => {
    const existing = account();
    const sessions = {
      loadSession: async () => null,
      destroyAllForAdmin: async () => {},
    } as unknown as AuthSessionPort;
    const em = { findOne: async () => existing, flush: async () => {} } as unknown as EntityManager;
    // `mfa` absent: the accessor answers nothing, and nothing is asked.
    const service = new AdminUserService(() => em, {} as AdminRolePort, sessions, undefined, () => undefined);
    await service.updateSelf('a1', { password: NEXT, currentPassword: CURRENT });
    expect(await verifyPassword(existing.passwordHash, NEXT)).toBe(true);
  });

  it('audits a password change as one, marked self-service, with no secret in it', async () => {
    const existing = account();
    const { service, audit } = serviceOver(existing);
    await service.updateSelf(
      'a1',
      { password: NEXT, currentPassword: CURRENT },
      { sessionCookieValue: 'own-cookie' },
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'admin_user.change_password',
      objectId: 'a1',
      stateAfter: { via: 'self_service' },
    });
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain(NEXT);
    expect(serialised).not.toContain(CURRENT);
    expect(serialised).not.toContain('$argon2');
  });

  it('audits a request that changes the name and the password as both', async () => {
    const existing = account();
    const { service, audit } = serviceOver(existing);
    await service.updateSelf('a1', {
      lastName: 'King',
      password: NEXT,
      currentPassword: CURRENT,
    });
    expect(audit.map((entry) => entry.action)).toEqual([
      'admin_user.change_password',
      'admin_user.update',
    ]);
  });
});

describe('AdminUserService.updateSelf — a new password equal to the current one', () => {
  beforeAll(async () => {
    currentHash = await hashPassword(CURRENT);
  });

  it('is refused, and nothing is written, revoked or audited', async () => {
    const existing = account();
    const { service, flushes, steps, audit } = serviceOver(existing);
    await expect(
      service.updateSelf(
        'a1',
        { lastName: 'King', password: CURRENT, currentPassword: CURRENT },
        { sessionCookieValue: 'own-cookie' },
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NEW_PASSWORD_UNCHANGED' });
    expect(existing).toMatchObject({ lastName: 'Lovelace', passwordHash: currentHash });
    expect(flushes()).toBe(0);
    expect(steps).toEqual([]);
    expect(audit).toEqual([]);
  });

  it('is told apart from a wrong current password, which is checked first', async () => {
    // Both fields carry the same string, and it is not the current password:
    // the caller has proved nothing, so they are not told the two match.
    const existing = account();
    const { service } = serviceOver(existing);
    await expect(
      service.updateSelf('a1', { password: NEXT, currentPassword: NEXT }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CURRENT_PASSWORD_INVALID' });
  });
});

describe('AdminUserService.update — the generic edit sets no password', () => {
  beforeAll(async () => {
    currentHash = await hashPassword(CURRENT);
  });

  it('ignores a password handed to it past the type', async () => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.update('a1', {
      firstName: 'Augusta',
      password: NEXT,
    } as unknown as Parameters<AdminUserService['update']>[1]);
    expect(existing.firstName).toBe('Augusta');
    expect(existing.passwordHash).toBe(currentHash);
    expect(steps).toEqual(['flush']);
  });
});

describe('AdminUserService — withdrawing an account', () => {
  beforeAll(async () => {
    currentHash = await hashPassword(CURRENT);
  });

  it('withdraws every session and pending login when the account is deactivated, after the write', async () => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.update('a1', { status: 'inactive' });
    expect(existing.status).toBe('inactive');
    expect(steps).toEqual(['flush', 'revoke:a1:except=none', 'mfa:admin:a1']);
  });

  it('revokes nothing on an edit that leaves the account active', async () => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.update('a1', { firstName: 'Augusta', status: 'active' });
    expect(steps).toEqual(['flush']);
  });

  it('withdraws every session and pending login when the account is deleted, after the write', async () => {
    const existing = account();
    const { service, steps } = serviceOver(existing);
    await service.softDelete('a1');
    expect(existing.deletedAt).toBeInstanceOf(Date);
    expect(steps).toEqual(['flush', 'revoke:a1:except=none', 'mfa:admin:a1']);
  });
});
