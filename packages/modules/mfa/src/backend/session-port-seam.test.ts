import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  type AuthCreateSessionInput,
  type AuthSessionPort,
  type AuthSessionRecord,
} from '@endora-commerce/contracts';
import {
  registerMfaPublicRoutes,
  type MfaPublicDeps,
} from './routes.public.js';

/**
 * Feature 075, Phase C — `mfa` mints its post-second-factor session over
 * `auth`'s published port (FR-010, FR-011).
 *
 * The second step of a login ends with `mfa` asking for a session, and it used
 * to ask by holding `auth`'s `SessionService` class: an import across the module
 * boundary whose `createSession` hands back the `Session` **ORM entity**. That
 * made `mfa` uncompilable without `auth`'s source and put a row of somebody
 * else's table on `mfa`'s route surface, where the only two fields it ever read
 * were the cookie value and its expiry.
 *
 * The assertion is about the **shape the routes accept**: the stub below is a
 * plain object literal implementing `AuthSessionPort` and returning an
 * `AuthSessionRecord`. It could not have satisfied `SessionService` — a class
 * with private members is not structurally implementable — so a stub that is
 * enough here is a boundary that is real.
 *
 * `auth` declares `nonDeactivatable`, so this edge has no off-state to test:
 * the gate `providePort` puts on `authSessionPort` can never close, which is
 * the `OWNER LOCKED` classification the port checks derive from the manifest.
 * What is testable is that nothing of `auth`'s beyond the published record
 * crosses, and that is what this file pins.
 */

const RECORD: AuthSessionRecord = {
  id: 'session-1',
  kind: 'customer',
  customerAccountId: 'customer-1',
  adminUserId: null,
  impersonatorAdminUserId: null,
  expiresAt: new Date('2026-09-01T00:00:00.000Z'),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  lastSeenAt: null,
  ipAddress: null,
  userAgent: null,
};

function refusing(name: string): () => never {
  return () => {
    throw new Error(`the MFA verify path must not call ${name}`);
  };
}

async function buildApp(): Promise<{ app: FastifyInstance; created: AuthCreateSessionInput[] }> {
  const created: AuthCreateSessionInput[] = [];
  const sessionService: AuthSessionPort = {
    async createSession(input) {
      created.push(input);
      return {
        cookieValue: 'session-1.raw-token',
        expiresAt: RECORD.expiresAt,
        session: RECORD,
      };
    },
    loadSession: refusing('loadSession'),
    destroySession: refusing('destroySession'),
    destroyAllForCustomer: refusing('destroyAllForCustomer'),
    destroyAllForAdmin: refusing('destroyAllForAdmin'),
    touchLastSeen: refusing('touchLastSeen'),
    listRecentlyActiveCustomers: refusing('listRecentlyActiveCustomers'),
  };

  const loginService = {
    verifyChallenge: async () => ({
      ok: true as const,
      subject: { subjectType: 'customer' as const, subjectId: 'customer-1' },
      factor: 'totp' as const,
    }),
  } as unknown as MfaPublicDeps['loginService'];

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await registerMfaPublicRoutes(app, {
    loginService,
    sessionService,
    challengeStore: {} as unknown as MfaPublicDeps['challengeStore'],
    enrolmentService: {} as unknown as MfaPublicDeps['enrolmentService'],
    auditLogService: { record: async () => undefined } as unknown as MfaPublicDeps['auditLogService'],
  });
  await app.ready();
  return { app, created };
}

describe('mfa public routes — the session comes from auth’s published port', () => {
  it('issues the storefront cookie from the port’s plain record', async () => {
    const { app, created } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: 'challenge-1', code: '123456' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'authenticated' } });
    expect(created).toEqual([
      {
        kind: 'customer',
        customerAccountId: 'customer-1',
        ipAddress: '127.0.0.1',
        userAgent: 'lightMyRequest',
      },
    ]);

    const setCookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(setCookie?.value).toBe('session-1.raw-token');
    expect(setCookie?.expires?.toISOString()).toBe(RECORD.expiresAt.toISOString());

    await app.close();
  });
});
