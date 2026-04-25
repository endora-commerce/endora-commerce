import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  customerLoginRequestSchema,
  emailVerificationRequestSchema,
  registerOrganizationRequestSchema,
} from '@b2b/contracts';
import type { RegistrationService } from './services/registration-service.js';
import type { EmailVerificationService } from './services/email-verification-service.js';
import type { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';

/**
 * Anonymous endpoints: registration, email verification, customer login /
 * logout. These are the entry points for a new buyer's journey.
 */

export interface OrganizationsPublicDeps {
  registrationService: RegistrationService;
  verificationService: EmailVerificationService;
  customerAuthService: CustomerAuthService;
  /**
   * Exposes the latest raw verification token for the test-only probe endpoint.
   * Not wired outside of test mode — production keeps this undefined so the
   * route is never registered.
   */
  exposeTestProbe?: boolean;
  /**
   * Transport-facing token cache. When a token is issued by the registration
   * service we stash the raw value here keyed by email; the probe endpoint
   * returns the most recent one. Pure in-memory; cleared on process restart.
   */
  latestTokenByEmail?: Map<string, string>;
  /**
   * Optional post-login hook — the commerce module registers one to merge an
   * anonymous cart (cookie `b2b_cart_anon`) into the authenticated cart.
   */
  onLogin?: (ctx: {
    customerAccountId: string;
    organizationId: string;
    anonymousCartToken?: string;
  }) => Promise<void>;
}

export async function registerOrganizationsPublicRoutes(
  app: FastifyInstance,
  deps: OrganizationsPublicDeps,
): Promise<void> {
  const { registrationService, verificationService, customerAuthService } = deps;

  app.post(
    '/api/v1/organizations/register',
    { schema: { body: registerOrganizationRequestSchema } },
    async (request, reply) => {
      const body = registerOrganizationRequestSchema.parse(request.body);
      const result = await registrationService.registerOrganization(body);
      // Stash the raw token for the test-only probe so integration tests can
      // complete the verify step without reading the mail.
      if (deps.latestTokenByEmail) {
        deps.latestTokenByEmail.set(result.customerAccount.email, result.verificationToken);
        deps.latestTokenByEmail.set('__latest__', result.verificationToken);
      }
      reply.status(201);
      return {
        data: {
          organization: serializeOrganization(result.organization),
          customerAccount: serializeCustomerAccount(result.customerAccount),
          emailVerificationSent: true,
        },
      };
    },
  );

  app.post(
    '/api/v1/auth/email-verification/verify',
    { schema: { body: emailVerificationRequestSchema } },
    async (request) => {
      const body = emailVerificationRequestSchema.parse(request.body);
      const result = await verificationService.verify(body.token);
      return {
        data: {
          organizationId: result.organizationId,
          customerAccountId: result.customerAccountId,
          verifiedAt: result.verifiedAt.toISOString(),
        },
      };
    },
  );

  app.post(
    '/api/v1/auth/customer/login',
    { schema: { body: customerLoginRequestSchema } },
    async (request, reply) => {
      const body = customerLoginRequestSchema.parse(request.body);
      const result = await customerAuthService.login({
        email: body.email,
        password: body.password,
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
      });
      setSessionCookie(reply, result.sessionCookieValue, result.sessionExpiresAt);
      // Merge any anonymous cart the caller was carrying into the authenticated
      // cart (R-09, T125).
      if (deps.onLogin) {
        const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
        const anon = cookies?.['b2b_cart_anon'];
        await deps.onLogin({
          customerAccountId: result.customerAccount.id,
          organizationId: result.customerAccount.organizationId,
          ...(anon ? { anonymousCartToken: anon } : {}),
        });
      }
      return { data: { customerAccount: serializeCustomerAccount(result.customerAccount) } };
    },
  );

  app.post('/api/v1/auth/customer/logout', async (request, reply) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.[SESSION_COOKIE_NAME];
    if (raw) {
      const dot = raw.indexOf('.');
      if (dot !== -1) {
        const sessionId = raw.slice(0, dot);
        if (sessionId) {
          await customerAuthService.logout(sessionId);
        }
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204).send();
  });

  // Test-only probe for the register→verify integration test.
  if (deps.exposeTestProbe && deps.latestTokenByEmail) {
    app.get('/api/v1/_test/latest-verification-token', async () => {
      const token = deps.latestTokenByEmail!.get('__latest__');
      if (!token) return { token: null };
      return { token };
    });
  }
}

function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}

function serializeOrganization(o: {
  id: string;
  name: string;
  taxId: string;
  status: string;
  vatStatus: string;
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: o.id,
    name: o.name,
    taxId: o.taxId,
    status: o.status,
    vatStatus: o.vatStatus,
    registeredAddress: o.registeredAddress,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

function serializeCustomerAccount(c: {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerifiedAt?: Date | null;
  twoFactorConfirmedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    organizationId: c.organizationId,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    role: c.role,
    emailVerifiedAt: c.emailVerifiedAt?.toISOString() ?? null,
    twoFactorEnabled: !!c.twoFactorConfirmedAt,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
