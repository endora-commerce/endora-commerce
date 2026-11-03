// `reply.setCookie` / `reply.clearCookie` are not on `FastifyReply`: they are a
// declaration-merging augmentation `@fastify/cookie` contributes. Inside
// `backend/src` that augmentation arrived ambiently, through the host's own
// dependency and its `types` graph — so nothing in this module ever named it. A
// package compiles against its own manifest, where an unnamed dependency does
// not exist, and the property simply is not there (TS2339). The import is
// type-only, so it loads the declarations and emits nothing: registering the
// plugin stays the host's job, exactly as before.
import type {} from '@fastify/cookie';
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
  type OrganizationPermissionPort,
  type OrganizationRoleReadPort,
} from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import { firstLanguageTag, storefrontPagePathFor } from '@endora-commerce/contracts';
import type { RegistrationService } from './services/registration-service.js';
import type { EmailVerificationService } from './services/email-verification-service.js';
import { readCustomerKnownDevice, rememberCustomerKnownDevice } from './known-device-cookie.js';
import { buildVerificationEmail } from './email-templates/verification.js';
import type { OrgTemplateEmail } from './services/org-template-email.js';
import { memberSessionRole } from './services/member-role-views.js';

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
  /**
   * `specs/170-organization-roles/` WP-03 — the signed-in member's role and
   * effective permissions on the login answer (FR-056, FR-073), in place of
   * the legacy `role`.
   */
  organizationRoles: Pick<OrganizationRoleReadPort, 'roleRef'>;
  organizationPermissions: () => Pick<OrganizationPermissionPort, 'effective'>;
}

export async function registerOrganizationsPublicRoutes(
  app: FastifyInstance,
  deps: OrganizationsPublicDeps,
): Promise<void> {
  const { registrationService, verificationService, customerAuthService, passwordResetService } =
    deps;
  /** An account as a public answer shows it: its role, not the legacy enum (FR-056, FR-073). */
  const accountView = async (account: CustomerAccountRecord, language: string) => ({
    ...serializeCustomerAccount(account),
    ...(await memberSessionRole(deps.organizationRoles, deps.organizationPermissions(), account, language)),
  });

  app.post(
    '/api/v1/organizations/register',
    // Feature 154 — reachable whatever the sales-channel access rule decides: a
    // business may apply on a store closed to anonymous visitors (feature 154, Q2).
    { schema: { body: registerOrganizationRequestSchema }, config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const body = registerOrganizationRequestSchema.parse(request.body);
      // Feature 154 (D6) — the store registered on becomes the Organization's channel.
      const result = await registrationService.registerOrganization(body, {
        salesChannelId: currentSalesChannel()?.id ?? null,
      });
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
          // Feature 167 — under the language prefix of the language the visitor
          // registered in (the request's), else the channel default.
          pagePath: (path) =>
            storefrontPagePathFor({
              path,
              channel: currentSalesChannel(),
              requestedLanguage: firstLanguageTag(request.headers['accept-language']),
            }),
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
          customerAccount: await accountView(result.customerAccount, await request.responseLanguage()),
          emailVerificationSent,
        },
      };
    },
  );

  app.post(
    '/api/v1/auth/email-verification/verify',
    // Feature 154 — reachable whatever the sales-channel access rule decides.
    { schema: { body: emailVerificationRequestSchema }, config: { salesChannelAccess: 'open' } },
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
    // Feature 154 — reachable whatever the sales-channel access rule decides:
    // signing in is how a visitor of a closed store gets in.
    { schema: { body: customerLoginRequestSchema }, config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const body = customerLoginRequestSchema.parse(request.body);
      const channelId = currentSalesChannel()?.id ?? null;
      // The storefront forwards the browser's known-device cookie with the
      // sign-in, so a shopper's own device keeps its own attempt budget.
      const knownDevice = readCustomerKnownDevice(request);
      const result = await customerAuthService.login({
        email: body.email,
        password: body.password,
        salesChannelId: channelId,
        ...(knownDevice !== undefined ? { knownDevice } : {}),
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
      rememberCustomerKnownDevice(reply, result.knownDevice ?? null);
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
      // nothing to clear in the first place. See spec R-06. So does
      // skipped_permission (`specs/170-organization-roles/` owner ruling PR-12,
      // FR-030a): the member's role lacks `carts.create`, the guest basket was
      // left unmerged and unchanged, and its cookie still points at it.
      if (cartMerge && !ANON_CART_COOKIE_KEPT.has(cartMerge.outcome)) {
        reply.clearCookie('b2b_cart_anon', { path: '/' });
      }
      return {
        data: {
          status: 'authenticated',
          customerAccount: await accountView(result.customerAccount, await request.responseLanguage()),
          ...(cartMerge ? { cartMerge: narrowCartMergeForHttp(cartMerge) } : {}),
        },
      };
    },
  );

  app.post(
    '/api/v1/auth/password-reset/request',
    // Feature 154 — reachable whatever the sales-channel access rule decides.
    { schema: { body: passwordResetRequestSchema }, config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const body = passwordResetRequestSchema.parse(request.body);
      // The address is handed over as typed — the port folds it, as every
      // other lookup on that table does. The probe key below is the one place
      // the folded form is needed here, and it uses the same function so the
      // key cannot drift from what the lookup matched.
      // Counted per address in the customer authentication throttle; 429
      // `CUSTOMER_AUTHENTICATION_THROTTLED` once the address has asked too
      // often, whether or not an account has it.
      const knownDevice = readCustomerKnownDevice(request);
      const result = await passwordResetService.requestReset(
        body.email,
        knownDevice !== undefined ? { knownDevice } : {},
      );
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
    // Feature 154 — reachable whatever the sales-channel access rule decides.
    { schema: { body: passwordResetConfirmSchema }, config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const body = passwordResetConfirmSchema.parse(request.body);
      await passwordResetService.confirmReset(body.token, body.newPassword);
      return reply.status(200).send({ data: { ok: true } });
    },
  );

  // Feature 154 — reachable whatever the sales-channel access rule decides:
  // a customer may always sign out, on any store (FR-011).
  app.post(
    '/api/v1/auth/customer/logout',
    { config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
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
    },
  );

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

/** The merge outcomes after which the guest basket still exists, so its cookie is kept. */
const ANON_CART_COOKIE_KEPT: ReadonlySet<CartMergeOutcome['outcome']> = new Set(['noop_no_anon', 'skipped_permission']);

function serializeCustomerAccount(c: CustomerAccountRecord) {
  return {
    id: c.id,
    organizationId: c.organizationId ?? null,
    email: c.email,
    firstName: c.firstName,
    lastName: c.lastName,
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
  // `skipped_permission` (owner ruling PR-12, `specs/170-organization-roles/`)
  // changed nothing the buyer sees in their own basket, so it is a `noop` here.
  const outcome =
    internal.outcome === 'noop_empty' ||
    internal.outcome === 'noop_no_anon' ||
    internal.outcome === 'skipped_permission'
      ? 'noop'
      : internal.outcome;
  return { outcome, destinationCartId: internal.destinationCartId };
}
