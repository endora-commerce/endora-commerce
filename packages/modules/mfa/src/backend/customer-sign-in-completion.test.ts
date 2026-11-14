import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type {
  AuthSessionPort,
  AuthSessionRecord,
  CustomerSignInCompletion,
  CustomerSignInCompletionInput,
} from '@endora-commerce/contracts';
import { registerMfaPublicRoutes, type MfaPublicDeps } from './routes.public.js';

/**
 * Issue #368 — a sign-in that needs a second step is completed here, not by the
 * password route, so this is where the customer's session is established. The
 * signed-out basket used to be merged only by the password route's post-sign-in
 * step, which returns before it runs whenever a second step is required: a
 * customer with two-step verification never got the basket they had filled.
 *
 * Both customer routes that issue a session — the second-step verify and the
 * enforced-enrolment completion — now hand the request's cookies to
 * `organizations`' sign-in completion port, answer its `cartMerge`, and drop the
 * anonymous basket's cookie when the port says it was consumed. The admin
 * surface has no basket and never calls it.
 */

const CART_ID = '4f0c8e8a-5b8e-4d4a-9a39-2f8d9d6f7a10';
const ANON_TOKEN = 'anon-7f3c2a9e';

const RECORD: AuthSessionRecord = {
  id: 'session-1',
  kind: 'customer',
  customerAccountId: 'customer-1',
  adminUserId: null,
  impersonatorAdminUserId: null,
  expiresAt: new Date('2026-12-01T00:00:00.000Z'),
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  lastSeenAt: null,
  ipAddress: null,
  userAgent: null,
};

async function buildApp(
  subjectType: 'customer' | 'admin',
  answer: CustomerSignInCompletion,
): Promise<{ app: FastifyInstance; calls: CustomerSignInCompletionInput[] }> {
  const calls: CustomerSignInCompletionInput[] = [];
  const sessionService = {
    createSession: async () => ({
      cookieValue: 'session-1.raw-token',
      expiresAt: RECORD.expiresAt,
      session: RECORD,
    }),
  } as unknown as AuthSessionPort;
  const loginService = {
    verifyChallenge: async () => ({
      ok: true as const,
      subject: { subjectType, subjectId: `${subjectType}-1` },
      factor: 'totp' as const,
      salesChannelId: 'channel-1',
    }),
  } as unknown as MfaPublicDeps['loginService'];
  const challengeStore = {
    getSetupTicket: async () => ({ subjectType, subjectId: `${subjectType}-1`, salesChannelId: 'channel-1' }),
    consumeSetupTicket: async () => undefined,
  } as unknown as MfaPublicDeps['challengeStore'];
  const enrolmentService = {
    activate: async () => ({ recoveryCodes: ['r-1'] }),
  } as unknown as MfaPublicDeps['enrolmentService'];

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  await registerMfaPublicRoutes(app, {
    loginService,
    sessionService,
    challengeStore,
    enrolmentService,
    auditLogService: { record: async () => undefined } as unknown as MfaPublicDeps['auditLogService'],
    adminAuthenticationThrottle: { issueKnownDevice: async () => null },
    customerAuthenticationThrottle: { issueKnownDevice: async () => null },
    customerChannelAccess: { assertAccountMayUse: async () => undefined },
    customerSignInCompletion: {
      complete: async (input) => {
        calls.push(input);
        return answer;
      },
    },
  });
  await app.ready();
  return { app, calls };
}

const MERGED: CustomerSignInCompletion = {
  cartMerge: { outcome: 'merged', destinationCartId: CART_ID },
  clearAnonymousCartCookie: true,
};

function clearsAnonCookie(res: { cookies: Array<{ name: string; value: string; maxAge?: number; expires?: Date }> }): boolean {
  return res.cookies.some(
    (c) =>
      c.name === 'b2b_cart_anon' &&
      c.value === '' &&
      (c.maxAge === 0 || (c.expires !== undefined && c.expires.getTime() <= Date.now())),
  );
}

const ROUTES = [
  {
    name: 'the second-step verify',
    url: '/api/v1/auth/customer/mfa/verify',
    payload: { challengeId: 'challenge-1', code: '123456' },
    extra: {},
  },
  {
    name: 'the enforced-enrolment completion',
    url: '/api/v1/auth/customer/mfa/setup-ticket/complete',
    payload: { setupTicket: 'ticket-1', code: '123456' },
    extra: { recoveryCodes: ['r-1'] },
  },
] as const;

describe('mfa customer sign-in — the post-sign-in step runs where the session is established', () => {
  for (const route of ROUTES) {
    it(`${route.name} hands the request's cookies to the completion port and answers its merge`, async () => {
      const { app, calls } = await buildApp('customer', MERGED);

      const res = await app.inject({
        method: 'POST',
        url: route.url,
        payload: route.payload,
        cookies: { b2b_cart_anon: ANON_TOKEN, compare_token: 'cmp-1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: {
          status: 'authenticated',
          ...route.extra,
          cartMerge: { outcome: 'merged', destinationCartId: CART_ID },
        },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.customerAccountId).toBe('customer-1');
      expect(calls[0]!.cookies['b2b_cart_anon']).toBe(ANON_TOKEN);
      expect(calls[0]!.cookies['compare_token']).toBe('cmp-1');
      expect(clearsAnonCookie(res)).toBe(true);
      // The session is still issued beside the merge.
      expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBe('session-1.raw-token');

      await app.close();
    });

    it(`${route.name} keeps the anonymous cookie and answers no merge when the port merged nothing`, async () => {
      const { app } = await buildApp('customer', { cartMerge: null, clearAnonymousCartCookie: false });

      const res = await app.inject({ method: 'POST', url: route.url, payload: route.payload });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: { status: 'authenticated', ...route.extra } });
      expect(res.cookies.some((c) => c.name === 'b2b_cart_anon')).toBe(false);

      await app.close();
    });
  }

  it('the admin surface never calls the customer completion port', async () => {
    const { app, calls } = await buildApp('admin', MERGED);

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/verify',
      payload: { challengeId: 'challenge-1', code: '123456' },
      cookies: { b2b_cart_anon: ANON_TOKEN },
    });
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/complete',
      payload: { setupTicket: 'ticket-1', code: '123456' },
      cookies: { b2b_cart_anon: ANON_TOKEN },
    });

    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ data: { status: 'authenticated' } });
    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toEqual({ data: { status: 'authenticated', recoveryCodes: ['r-1'] } });
    expect(calls).toEqual([]);
    expect(clearsAnonCookie(verify)).toBe(false);

    await app.close();
  });
});
