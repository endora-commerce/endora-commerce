import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuthSessionPort, MfaLoginPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/kernel/crypto/password-hasher.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { CustomerAuthService } from '../../../src/modules/customer_accounts/services/customer-auth-service.js';

/**
 * Feature 075, Phase C — `customer_accounts` states what it needs from `auth`.
 *
 * Eight import sites, three answers, and the answers differ because the
 * questions do (FR-013):
 *
 *   - **sessions** are behaviour over a table `auth` owns, so they come over
 *     `AuthSessionPort`. Switching `auth` off must refuse a login, not issue a
 *     session nothing can validate;
 *   - the **MFA seam** is a shape `auth` declares and `mfa` implements, so it
 *     is a contract type and neither module is imported for it;
 *   - **hashing** is a pure function over its arguments. It relocated to
 *     `src/kernel/crypto/`, because a gated port answering 503
 *     `MODULE_DISABLED` to "hash this string" would be a bug and not a
 *     degrade. This bullet named the **TOTP primitives** on the same footing
 *     until 2026-08-25; `customer_accounts` no longer uses them at all — the
 *     enrolment service went with the superseded `/api/v1/me/two-factor/*`
 *     path, `mfa` owns customer 2FA, and the kernel primitive itself was
 *     deleted once it had no callers.
 *
 * The `EntityManager` below throws on any entity this module does not own, so
 * a read that goes around a port reads as "`customer_accounts` queried someone
 * else's table directly" rather than as a silent pass.
 */

function ownTablesOnly(account: CustomerAccount | null): {
  em: () => EntityManager;
  flushes: () => number;
} {
  let flushes = 0;
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== CustomerAccount) {
        throw new Error(
          `customer_accounts queried an entity it does not own: ${String(
            (entity as { name?: string }).name ?? entity,
          )}`,
        );
      }
      if (account === null) return null;
      if (where['email'] !== undefined && where['email'] !== account.email) return null;
      if (where['id'] !== undefined && where['id'] !== account.id) return null;
      return account;
    },
    flush: async () => {
      flushes += 1;
    },
  } as unknown as EntityManager;
  return { em: () => em, flushes: () => flushes };
}

async function makeAccount(password: string): Promise<CustomerAccount> {
  return {
    id: 'c-1',
    email: 'buyer@example.test',
    passwordHash: await hashPassword(password),
    organizationId: 'org-1',
    deletedAt: null,
    blockedAt: null,
    lastLoginAt: null,
  } as unknown as CustomerAccount;
}

/** Only the methods `AuthSessionPort` publishes — never `auth`'s class. */
function sessionPort(record: { cookieValue: string; expiresAt: Date }): {
  port: AuthSessionPort;
  destroyed: () => string[];
} {
  const destroyed: string[] = [];
  const port: AuthSessionPort = {
    createSession: async (input) => ({
      cookieValue: record.cookieValue,
      expiresAt: record.expiresAt,
      session: {
        id: 's-1',
        kind: input.kind,
        customerAccountId: input.customerAccountId ?? null,
        adminUserId: null,
        impersonatorAdminUserId: null,
        expiresAt: record.expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSeenAt: null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    }),
    loadSession: async () => null,
    destroySession: async (sessionId) => {
      destroyed.push(sessionId);
    },
    destroyAllForCustomer: async () => {},
    destroyAllForAdmin: async () => {},
    touchLastSeen: async () => {},
    listRecentlyActiveCustomers: async () => [],
  };
  return { port, destroyed: () => destroyed };
}

describe('customer_accounts — sessions over a port, MFA over a contract, crypto from the kernel', () => {
  it('mints a session through AuthSessionPort alone', async () => {
    const account = await makeAccount('a-very-strong-pass');
    const { em, flushes } = ownTablesOnly(account);
    const expiresAt = new Date(Date.now() + 3_600_000);
    const { port } = sessionPort({ cookieValue: 'cookie-value', expiresAt });

    const service = new CustomerAuthService(em, port);
    const outcome = await service.login({
      email: 'buyer@example.test',
      password: 'a-very-strong-pass',
    });

    if (outcome.status !== 'authenticated') throw new Error('expected an authenticated login');
    expect(outcome.sessionCookieValue).toBe('cookie-value');
    expect(outcome.sessionExpiresAt).toBe(expiresAt);
    // `lastLoginAt` is stamped and flushed on this module's own row.
    expect(account.lastLoginAt).toBeInstanceOf(Date);
    expect(flushes()).toBe(1);
  });

  it('short-circuits on the MFA seam without a session, from the contract type alone', async () => {
    const account = await makeAccount('a-very-strong-pass');
    const { em } = ownTablesOnly(account);
    const { port } = sessionPort({ cookieValue: 'cookie-value', expiresAt: new Date() });

    const seen: Array<{ subjectId: string; organizationId: string | null | undefined }> = [];
    // The shape is `auth`'s and the implementation is `mfa`'s — this stub is
    // neither, which is the whole point of publishing it in `@endora-commerce/contracts`.
    const mfa: MfaLoginPort = {
      beginLogin: async (subject, ctx) => {
        seen.push({ subjectId: subject.subjectId, organizationId: ctx.organizationId });
        return { kind: 'challenge', challengeId: 'ch-1' };
      },
    };

    const service = new CustomerAuthService(em, port, () => mfa);
    const outcome = await service.login({
      email: 'buyer@example.test',
      password: 'a-very-strong-pass',
      salesChannelId: null,
    });

    expect(outcome).toEqual({ status: 'mfaRequired', challengeId: 'ch-1' });
    expect(seen).toEqual([{ subjectId: 'c-1', organizationId: 'org-1' }]);
  });

  it('logs out through the port rather than the Session entity', async () => {
    const account = await makeAccount('a-very-strong-pass');
    const { em } = ownTablesOnly(account);
    const { port, destroyed } = sessionPort({
      cookieValue: 'cookie-value',
      expiresAt: new Date(),
    });

    await new CustomerAuthService(em, port).logout('s-1');
    expect(destroyed()).toEqual(['s-1']);
  });

  it('rehashes a changed password with the kernel hasher, no port involved', async () => {
    const account = await makeAccount('a-very-strong-pass');
    const { em } = ownTablesOnly(account);
    const { port } = sessionPort({ cookieValue: 'cookie-value', expiresAt: new Date() });

    const service = new CustomerAuthService(em, port);
    await service.changePassword('c-1', 'a-very-strong-pass', 'an-even-stronger-pass');

    // The relocation is the same function: what this module writes is what the
    // kernel's verifier accepts, and the old secret stops working.
    expect(await verifyPassword(account.passwordHash, 'an-even-stronger-pass')).toBe(true);
    expect(await verifyPassword(account.passwordHash, 'a-very-strong-pass')).toBe(false);
  });
});
