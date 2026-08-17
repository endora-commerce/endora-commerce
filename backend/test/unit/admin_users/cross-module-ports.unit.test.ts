import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminRolePort,
  AdminRoleRecord,
  AuthSessionPort,
  CustomerAccountReadPort,
  CustomerAccountRecord,
} from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import type { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { hashPassword } from '../../../src/kernel/crypto/password-hasher.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminAuthService } from '../../../src/modules/admin_users/services/admin-auth-service.js';
import { AdminUserService } from '../../../src/modules/admin_users/services/admin-user-service.js';
import { ImpersonationService } from '../../../src/modules/admin_users/services/impersonation-service.js';

/**
 * Feature 075, Phase C — `admin_users` states what it needs from `auth`,
 * `admin_roles` and `customer_accounts`.
 *
 * Twenty-two import sites, four answers, and the answers differ because the
 * questions do (FR-013):
 *
 *   - **sessions** are behaviour over a table `auth` owns, so they come over
 *     `AuthSessionPort` — an admin login that cannot mint a checkable session
 *     must refuse rather than issue one;
 *   - **roles** are `admin_roles`' rows, so "does this role exist?" is its
 *     question over `AdminRolePort` and not a second `em.findOne` against its
 *     table;
 *   - the **impersonation target** is `customer_accounts`' row, read through
 *     `CustomerAccountReadPort.findInOrganization`, which is the membership
 *     check and the identity read in one call;
 *   - **hashing** is a pure function over its argument and relocated to
 *     `src/kernel/crypto/`, because a gated port answering 503
 *     `MODULE_DISABLED` to "hash this string" would be a bug, not a degrade.
 *
 * The `EntityManager` below throws on any entity this module does not own, so
 * a read that goes around a port reads as "`admin_users` queried someone
 * else's table directly" rather than as a silent pass.
 */

function ownTablesOnly(admin: AdminUser | null): {
  em: () => EntityManager;
  flushes: () => number;
} {
  let flushes = 0;
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== AdminUser) {
        throw new Error(
          `admin_users queried an entity it does not own: ${String(
            (entity as { name?: string }).name ?? entity,
          )}`,
        );
      }
      if (admin === null) return null;
      if (where['email'] !== undefined && where['email'] !== admin.email) return null;
      if (where['id'] !== undefined && where['id'] !== admin.id) return null;
      return admin;
    },
    create: (entity: unknown, data: Record<string, unknown>) => {
      if (entity !== AdminUser) {
        throw new Error(
          `admin_users created an entity it does not own: ${String(
            (entity as { name?: string }).name ?? entity,
          )}`,
        );
      }
      return { id: 'a-new', ...data } as unknown as AdminUser;
    },
    persistAndFlush: async () => {
      flushes += 1;
    },
    flush: async () => {
      flushes += 1;
    },
  } as unknown as EntityManager;
  return { em: () => em, flushes: () => flushes };
}

async function makeAdmin(password: string): Promise<AdminUser> {
  return {
    id: 'a-1',
    email: 'operator@example.test',
    firstName: 'Ada',
    lastName: 'Operator',
    passwordHash: await hashPassword(password),
    adminRoleId: 'r-1',
    status: 'active',
    deletedAt: null,
    lastLoginAt: null,
  } as unknown as AdminUser;
}

const ROLE: AdminRoleRecord = {
  id: 'r-1',
  code: 'platform_admin',
  name: 'Platform Admin',
  permissions: ['*'],
  requiresTwoFactor: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Only the five methods `AdminRolePort` publishes — never `admin_roles`' class. */
function rolePort(known: readonly AdminRoleRecord[]): {
  port: AdminRolePort;
  lookups: () => string[];
} {
  const lookups: string[] = [];
  const port: AdminRolePort = {
    list: async () => [...known],
    getById: async (id) => {
      lookups.push(id);
      const found = known.find((r) => r.id === id);
      // The same 404 the `em.findOne(AdminRole, …)` this replaced raised, now
      // raised by the module that owns the row.
      if (!found) throw new Error('Admin role not found.');
      return found;
    },
    findByCode: async (code) => known.find((r) => r.code === code) ?? null,
    upsertByCode: async () => ROLE,
    remove: async () => {},
  };
  return { port, lookups: () => lookups };
}

function sessionPort(record: { cookieValue: string; expiresAt: Date }): {
  port: AuthSessionPort;
  created: () => string[];
} {
  const created: string[] = [];
  const port: AuthSessionPort = {
    createSession: async (input) => {
      created.push(input.kind);
      return {
        cookieValue: record.cookieValue,
        expiresAt: record.expiresAt,
        session: {
          id: 's-1',
          kind: input.kind,
          customerAccountId: input.customerAccountId ?? null,
          adminUserId: input.adminUserId ?? null,
          impersonatorAdminUserId: input.impersonatorAdminUserId ?? null,
          expiresAt: record.expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSeenAt: null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      };
    },
    loadSession: async () => null,
    destroySession: async () => {},
    destroyAllForCustomer: async () => {},
    touchLastSeen: async () => {},
    listRecentlyActiveCustomers: async () => [],
  };
  return { port, created: () => created };
}

const TARGET: CustomerAccountRecord = {
  id: 'c-1',
  organizationId: 'org-1',
  email: 'buyer@example.test',
  firstName: 'Bo',
  lastName: 'Buyer',
  role: 'regular_user',
  emailVerifiedAt: null,
  twoFactorEnabled: false,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  customFieldValues: {},
  deletedAt: null,
  customerGroupId: null,
  subtreeRollupEnabled: false,
  blockedAt: null,
  blockReason: null,
  blockSource: null,
  blockedByAdminUserId: null,
  blockedByCustomerAccountId: null,
  deletionRequestedByAdminUserId: null,
  anonymizedAt: null,
};

/** Only the methods this module calls, answered as `customer_accounts` would. */
function accountReadPort(): {
  port: CustomerAccountReadPort;
  scopedLookups: () => Array<{ id: string; organizationId: string }>;
} {
  const scopedLookups: Array<{ id: string; organizationId: string }> = [];
  const port = {
    findById: async (id: string) => (id === TARGET.id ? TARGET : null),
    findInOrganization: async (id: string, organizationId: string) => {
      scopedLookups.push({ id, organizationId });
      return id === TARGET.id && organizationId === TARGET.organizationId ? TARGET : null;
    },
  } as unknown as CustomerAccountReadPort;
  return { port, scopedLookups: () => scopedLookups };
}

function recordingAuditLog(): { log: AuditLogService; actions: () => string[] } {
  const actions: string[] = [];
  const log = {
    record: async (input: { action: string }) => {
      actions.push(input.action);
    },
  } as unknown as AuditLogService;
  return { log, actions: () => actions };
}

describe('admin_users — sessions, roles and the impersonation target over ports', () => {
  it('mints the admin session through AuthSessionPort alone', async () => {
    const admin = await makeAdmin('a-very-strong-pass');
    const { em, flushes } = ownTablesOnly(admin);
    const expiresAt = new Date(Date.now() + 3_600_000);
    const { port, created } = sessionPort({ cookieValue: 'cookie-value', expiresAt });

    const outcome = await new AdminAuthService(em, port).login({
      email: 'operator@example.test',
      password: 'a-very-strong-pass',
    });

    if (outcome.status !== 'authenticated') throw new Error('expected an authenticated login');
    expect(outcome.sessionCookieValue).toBe('cookie-value');
    expect(created()).toEqual(['admin']);
    // `lastLoginAt` is stamped and flushed on this module's own row.
    expect(admin.lastLoginAt).toBeInstanceOf(Date);
    expect(flushes()).toBe(1);
  });

  it('asks admin_roles whether a role exists instead of querying its table', async () => {
    const { em } = ownTablesOnly(null);
    const { port, lookups } = rolePort([ROLE]);

    const created = await new AdminUserService(em, port).create({
      email: 'New.Operator@example.test',
      password: 'a-very-strong-pass',
      firstName: 'Nia',
      lastName: 'Operator',
      adminRoleId: 'r-1',
    });

    expect(lookups()).toEqual(['r-1']);
    expect(created.email).toBe('new.operator@example.test');
  });

  it('refuses an unknown role without falling back to a local read', async () => {
    const { em } = ownTablesOnly(null);
    const { port } = rolePort([]);

    await expect(
      new AdminUserService(em, port).create({
        email: 'new.operator@example.test',
        password: 'a-very-strong-pass',
        firstName: 'Nia',
        lastName: 'Operator',
        adminRoleId: 'r-missing',
      }),
    ).rejects.toThrow('Admin role not found.');
  });

  it('resolves the impersonation target through the organisation-scoped read', async () => {
    const admin = await makeAdmin('a-very-strong-pass');
    const { em } = ownTablesOnly(admin);
    const { port: sessions } = sessionPort({
      cookieValue: 'impersonation-cookie',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const { port: accounts, scopedLookups } = accountReadPort();
    const { log, actions } = recordingAuditLog();

    const started = await new ImpersonationService(em, sessions, accounts, log).start({
      adminUserId: 'a-1',
      adminSessionCookieValue: 'admin-cookie',
      customerAccountId: 'c-1',
      organizationId: 'org-1',
    });

    expect(scopedLookups()).toEqual([{ id: 'c-1', organizationId: 'org-1' }]);
    expect(started.impersonatedCustomerAccount.email).toBe('buyer@example.test');
    expect(started.adminShadowSessionCookieValue).toBe('admin-cookie');
    // Audit before the cookie is minted (T179) survives the cut.
    expect(actions()).toEqual(['impersonation.start']);
  });

  it('refuses a target outside the organisation named in the route', async () => {
    const admin = await makeAdmin('a-very-strong-pass');
    const { em } = ownTablesOnly(admin);
    const { port: sessions } = sessionPort({
      cookieValue: 'impersonation-cookie',
      expiresAt: new Date(),
    });
    const { port: accounts } = accountReadPort();
    const { log, actions } = recordingAuditLog();

    await expect(
      new ImpersonationService(em, sessions, accounts, log).start({
        adminUserId: 'a-1',
        adminSessionCookieValue: 'admin-cookie',
        customerAccountId: 'c-1',
        organizationId: 'org-2',
      }),
    ).rejects.toThrow('Target customer not found.');
    expect(actions()).toEqual([]);
  });
});
