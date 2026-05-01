import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  customerLoginRequestSchema,
  emailVerificationRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerOrganizationRequestSchema,
} from '@b2b/contracts';
import type { RegistrationService } from './services/registration-service.js';
import type { EmailVerificationService } from './services/email-verification-service.js';
import type { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import type { PasswordResetService } from '../customer_accounts/services/password-reset-service.js';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { Mailer } from '../email/services/mailer.js';
import { buildVerificationEmail } from './email-templates/verification.js';

/**
 * Anonymous endpoints: registration, email verification, customer login /
 * logout. These are the entry points for a new buyer's journey.
 */

export interface OrganizationsPublicDeps {
  registrationService: RegistrationService;
  verificationService: EmailVerificationService;
  customerAuthService: CustomerAuthService;
  passwordResetService: PasswordResetService;
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
   * Optional post-login hook — the commerce module merges anonymous carts
   * (`b2b_cart_anon`) and the comparisons module adopts the anonymous
   * Comparison (`compare_token`) into the authenticated identity.
   */
  onLogin?: (ctx: {
    customerAccountId: string;
    organizationId: string;
    anonymousCartToken?: string;
    anonymousCompareToken?: string;
  }) => Promise<void>;
  /** Dispatches verification email after registration. */
  mailer: Mailer;
  /** Storefront URL for verify link in the email body. */
  storefrontBaseUrl: string;
}

export async function registerOrganizationsPublicRoutes(
  app: FastifyInstance,
  deps: OrganizationsPublicDeps,
): Promise<void> {
  const { registrationService, verificationService, customerAuthService, passwordResetService } =
    deps;

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
      let emailVerificationSent = false;
      try {
        await deps.mailer.send(
          buildVerificationEmail({
            customerAccountId: result.customerAccount.id,
            rawToken: result.verificationToken,
            recipientEmail: result.customerAccount.email,
            organizationName: result.organization.name,
            storefrontBaseUrl: deps.storefrontBaseUrl,
          }),
        );
        emailVerificationSent = true;
      } catch (err) {
        request.log.error({ err }, 'Failed to send verification email');
      }
      reply.status(201);
      return {
        data: {
          organization: serializeOrganization(result.organization),
          customerAccount: serializeCustomerAccount(result.customerAccount),
          emailVerificationSent,
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
        const compareAnon = cookies?.['compare_token'];
        await deps.onLogin({
          customerAccountId: result.customerAccount.id,
          organizationId: result.customerAccount.organizationId,
          ...(anon ? { anonymousCartToken: anon } : {}),
          ...(compareAnon ? { anonymousCompareToken: compareAnon } : {}),
        });
      }
      return { data: { customerAccount: serializeCustomerAccount(result.customerAccount) } };
    },
  );

  app.post(
    '/api/v1/auth/password-reset/request',
    { schema: { body: passwordResetRequestSchema } },
    async (request, reply) => {
      const body = passwordResetRequestSchema.parse(request.body);
      const result = await passwordResetService.requestReset(body.email.toLowerCase());
      if (deps.latestTokenByEmail && result.rawToken) {
        deps.latestTokenByEmail.set(`reset:${body.email.toLowerCase()}`, result.rawToken);
        deps.latestTokenByEmail.set('__latest_reset__', result.rawToken);
      }
      // Always 202 — defends against account enumeration.
      reply.status(202).send();
    },
  );

  app.post(
    '/api/v1/auth/password-reset/confirm',
    { schema: { body: passwordResetConfirmSchema } },
    async (request, reply) => {
      const body = passwordResetConfirmSchema.parse(request.body);
      await passwordResetService.confirmReset(body.token, body.newPassword);
      reply.status(200).send({ data: { ok: true } });
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
