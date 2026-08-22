import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SESSION_COOKIE_NAME,
  customerLoginRequestSchema,
  emailVerificationRequestSchema,
  normalizeEmailAddress,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerOrganizationRequestSchema,
  type CartMergeOutcome,
  type CartMergeOutcomePublic,
  type CustomerAccountRecord,
  type CustomerAuthPort,
  type CustomerPasswordResetPort,
  type EmailMailerPort,
} from '@endora-commerce/contracts';
import { currentSalesChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { RegistrationService } from './services/registration-service.js';
import type { EmailVerificationService } from './services/email-verification-service.js';
import { buildVerificationEmail } from './email-templates/verification.js';
import type { OrgTemplateEmail } from './services/org-template-email.js';

/**
 * Anonymous endpoints: registration, email verification, customer login /
 * logout. These are the entry points for a new buyer's journey.
 */

export interface OrganizationsPublicDeps {
  registrationService: RegistrationService;
  verificationService: EmailVerificationService;
  customerAuthService: CustomerAuthPort;
  passwordResetService: CustomerPasswordResetPort;
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
    /** Null for no-org Customer accounts (feature 026 US2). */
    organizationId: string | null;
    anonymousCartToken?: string;
    anonymousCompareToken?: string;
  }) => Promise<{ cartMerge?: CartMergeOutcome }>;
  /** Dispatches verification email after registration. */
  mailer: EmailMailerPort;
  /** Feature 047 — optional admin-editable template path. */
  templateEmail?: OrgTemplateEmail;
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
        const message = buildVerificationEmail({
          customerAccountId: result.customerAccount.id,
          rawToken: result.verificationToken,
          recipientEmail: result.customerAccount.email,
          organizationName: result.organization.name,
          storefrontBaseUrl: deps.storefrontBaseUrl,
        });
        const verifyUrl = (message.meta as { verifyUrl?: string } | undefined)?.verifyUrl ?? '';
        const sentViaTemplate = deps.templateEmail
          ? await deps.templateEmail.trySend({
              code: 'email_verification',
              to: result.customerAccount.email,
              messageId: message.messageId,
              variables: { organizationName: result.organization.name, verifyUrl },
              meta: message.meta,
            })
          : false;
        // The flag is in the response body, so it answers what the transport
        // answered rather than "we reached this line" (D-59).
        const outcome = sentViaTemplate
          ? ({ status: 'sent' } as const)
          : await deps.mailer.send(message);
        emailVerificationSent = outcome.status === 'sent';
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
      const channelId = currentSalesChannel()?.id ?? null;
      const result = await customerAuthService.login({
        email: body.email,
        password: body.password,
        salesChannelId: channelId,
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
      });
      // Feature 042 — two-step login. The MFA cases carry no session cookie;
      // the client completes the second step at the MFA verify endpoint.
      if (result.status === 'mfaRequired') {
        return { data: { status: 'mfaRequired', challengeId: result.challengeId } };
      }
      if (result.status === 'mfaSetupRequired') {
        return { data: { status: 'mfaSetupRequired', setupTicket: result.setupTicket } };
      }
      setSessionCookie(reply, result.sessionCookieValue, result.sessionExpiresAt);
      // Merge any anonymous cart the caller was carrying into the authenticated
      // cart (feature 027 R-09 / feature 037-cart-merge-on-login). The hook is
      // best-effort: a thrown error MUST NOT break login (037 FR-007/FR-008).
      let cartMerge: CartMergeOutcome | undefined;
      if (deps.onLogin) {
        const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
        const anon = cookies?.['b2b_cart_anon'];
        const compareAnon = cookies?.['compare_token'];
        try {
          const hookResult = await deps.onLogin({
            customerAccountId: result.customerAccount.id,
            organizationId: result.customerAccount.organizationId ?? null,
            ...(anon ? { anonymousCartToken: anon } : {}),
            ...(compareAnon ? { anonymousCompareToken: compareAnon } : {}),
          });
          cartMerge = hookResult.cartMerge;
        } catch (err) {
          request.log.error(
            {
              err,
              customerAccountId: result.customerAccount.id,
              hadAnonToken: Boolean(anon),
            },
            'cart_merge_on_login_failed',
          );
        }
      }
      // Clear the stale anon-cart cookie when the source token has been
      // consumed (adopted/merged) or pointed at an empty cart (noop_empty).
      // Failure and noop_no_anon both leave the cookie alone — failure so the
      // buyer can retry on the next login, noop_no_anon because there was
      // nothing to clear in the first place. See spec R-06.
      if (cartMerge && cartMerge.outcome !== 'noop_no_anon') {
        reply.clearCookie('b2b_cart_anon', { path: '/' });
      }
      return {
        data: {
          status: 'authenticated',
          customerAccount: serializeCustomerAccount(result.customerAccount),
          ...(cartMerge ? { cartMerge: narrowCartMergeForHttp(cartMerge) } : {}),
        },
      };
    },
  );

  app.post(
    '/api/v1/auth/password-reset/request',
    { schema: { body: passwordResetRequestSchema } },
    async (request, reply) => {
      const body = passwordResetRequestSchema.parse(request.body);
      // The address is handed over as typed — the port folds it, as every
      // other lookup on that table does. The probe key below is the one place
      // the folded form is needed here, and it uses the same function so the
      // key cannot drift from what the lookup matched.
      const result = await passwordResetService.requestReset(body.email);
      if (deps.latestTokenByEmail && result.rawToken) {
        deps.latestTokenByEmail.set(`reset:${normalizeEmailAddress(body.email)}`, result.rawToken);
        deps.latestTokenByEmail.set('__latest_reset__', result.rawToken);
      }
      // Always 202 — defends against account enumeration.
      return reply.status(202).send();
    },
  );

  app.post(
    '/api/v1/auth/password-reset/confirm',
    { schema: { body: passwordResetConfirmSchema } },
    async (request, reply) => {
      const body = passwordResetConfirmSchema.parse(request.body);
      await passwordResetService.confirmReset(body.token, body.newPassword);
      return reply.status(200).send({ data: { ok: true } });
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
    return reply.status(204).send();
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

function serializeCustomerAccount(c: CustomerAccountRecord) {
  return {
    id: c.id,
    organizationId: c.organizationId ?? null,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
    role: c.role,
    emailVerifiedAt: c.emailVerifiedAt?.toISOString() ?? null,
    // The record already answers this; the entity carried the secret's
    // confirmation timestamp and every caller derived the same boolean from it.
    twoFactorEnabled: c.twoFactorEnabled,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Collapse the internal `CartMergeOutcome` (with the two `noop_*` variants
 * and the line-count diagnostics) into the storefront-facing shape that
 * exposes only `outcome ∈ {adopted, merged, noop}` and the destination
 * cart id. See specs/037-cart-merge-on-login/contracts/cart-merge.md § 1.
 */
function narrowCartMergeForHttp(internal: CartMergeOutcome): CartMergeOutcomePublic {
  const outcome =
    internal.outcome === 'noop_empty' || internal.outcome === 'noop_no_anon'
      ? 'noop'
      : internal.outcome;
  return { outcome, destinationCartId: internal.destinationCartId };
}
