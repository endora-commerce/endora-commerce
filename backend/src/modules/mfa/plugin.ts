import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { AuthSessionPort, CustomerPasswordStatePort, MfaLoginPort } from '@endora-commerce/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { CommandBus } from '../../commands/index.js';
import { ChallengeStore } from './services/challenge-store.js';
import {
  MfaPolicyResolver,
  type SettingsReader,
} from './services/mfa-policy-resolver.js';
import { MfaLoginService } from './services/mfa-login-service.js';
import { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import { MfaOrgPolicyService } from './services/mfa-org-policy-service.js';
import {
  SocialIdentityService,
  type SocialIdentityDeps,
} from './services/social-identity-service.js';
import { SocialLinkService } from './services/social-link-service.js';
import type { OAuthProviderPort } from './services/oauth-provider-service.js';
import { SecretCipher } from './services/secret-cipher.js';
import { registerMfaPublicRoutes } from './routes.public.js';
import { registerMfaSelfServiceRoutes } from './routes.self-service.js';
import { registerMfaAdminRoutes } from './routes.admin.js';
import { registerMfaOrgRoutes } from './routes.org.js';
import { registerMfaOAuthRoutes } from './routes.oauth.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * The attach function this module hands its composition root.
 *
 * Typed on `fastify`'s own `FastifyInstance` rather than on the platform's
 * `ModulePlugin`, which `contracts/host-package.md` §1.4g classifies **A**: the
 * host does not publish it, so a packaged module cannot name it. The
 * already-packaged `quote_requests` types its attach function the same way.
 */
type ModuleAttach = (app: FastifyInstance) => Promise<void>;

/**
 * MFA module composition root (feature 042).
 *
 * Owns 2FA enrolment, recovery codes, federated sign-in (later stories),
 * policy resolution, and admin reset (later stories). Sibling services are
 * injected so the module never imports another module's internals
 * (Constitution Principle I). Exposes its `MfaLoginPort` via the handle for
 * the per-surface login services.
 *
 * Enrolment requires `secretEncryptionKey`; when it is absent the module still
 * composes and `beginLogin` works (password-only), but the enrolment + verify
 * routes are not registered.
 */
export interface MfaModuleOptions {
  emFactory: () => EntityManager;
  redis: Redis;
  settingsService: SettingsReader;
  auditLogService: AuditPort;
  /** Constitution XIII — the unlink is a security-relevant, audited write. */
  commandBus: CommandBus;
  /**
   * Issue #222 — whether a customer account has a password on record, which is
   * what decides whether its last federated identity may be severed. Mandatory:
   * a composition without it would have to guess, and the two guesses are "lock
   * the holder out" and "refuse forever".
   */
  customerPasswordState: CustomerPasswordStatePort;
  sessionService: AuthSessionPort;
  /** Resolves the system-default sales-channel id for global setting reads. */
  resolveDefaultChannelId?: () => Promise<string | null>;
  /** base64 32-byte AES key for TOTP secrets at rest. */
  secretEncryptionKey?: string | undefined;
  /** Storefront customer guard + actor resolver (for self-service routes). */
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerActor: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string | null;
  };
  /** Admin guard factory + actor resolver (admin self-service US2 + reset US6). */
  requireAdmin?: RequireAdminFactory;
  resolveAdminActor?: (req: FastifyRequest) => { adminUserId: string };
  /** Lists an organization's customer-account ids (US6 bulk reset). */
  resolveOrganizationCustomerIds?: (organizationId: string) => Promise<string[]>;
  /** Resolves an org-admin customer's org + asserts the role (US3 storefront). */
  resolveOrgAdmin?: (
    req: FastifyRequest,
  ) => Promise<{ organizationId: string; actor: string }>;
  /** Federated sign-in (US4/US5) — provider port + account resolvers + URLs. */
  oauthProvider?: OAuthProviderPort;
  socialAccountResolvers?: SocialIdentityDeps;
  backendBaseUrl?: string;
  storefrontBaseUrl?: string;
  adminBaseUrl?: string;
  resolveAccountEmail?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
  ) => Promise<string | null>;
  verifyAccountPassword?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
    password: string,
  ) => Promise<boolean>;
}

export interface MfaModuleHandle {
  mfaLoginPort: MfaLoginPort;
  challengeStore: ChallengeStore;
  policyResolver: MfaPolicyResolver;
  enrolmentService: MfaEnrolmentService | null;
}

export function mfaModule(options: MfaModuleOptions): {
  plugin: ModuleAttach;
  handle: () => MfaModuleHandle;
} {
  const challengeStore = new ChallengeStore(options.redis);
  const policyResolver = new MfaPolicyResolver(
    options.settingsService,
    options.emFactory,
    options.resolveDefaultChannelId ?? (async () => null),
  );

  const cipher = options.secretEncryptionKey
    ? new SecretCipher(options.secretEncryptionKey)
    : null;
  const enrolmentService = cipher
    ? new MfaEnrolmentService(options.emFactory, cipher, options.auditLogService)
    : null;

  const loginService = new MfaLoginService(
    options.emFactory,
    challengeStore,
    policyResolver,
    enrolmentService ?? undefined,
  );
  const orgPolicyService = new MfaOrgPolicyService(options.emFactory, options.auditLogService);
  // Deliberately not behind the `oauthProvider` check below: the links an
  // account already holds stay listable and severable after an operator turns
  // a provider off, which is precisely when somebody goes looking for them.
  const socialLinkService = new SocialLinkService(
    options.emFactory,
    options.commandBus,
    options.customerPasswordState,
  );

  const plugin: ModuleAttach = async (app) => {
    if (!enrolmentService) return; // enrolment disabled without an encryption key
    await registerMfaPublicRoutes(app, {
      loginService,
      sessionService: options.sessionService,
      challengeStore,
      enrolmentService,
      auditLogService: options.auditLogService,
    });
    const emailOpt = options.resolveAccountEmail
      ? { resolveAccountEmail: options.resolveAccountEmail }
      : {};
    const pwdOpt = options.verifyAccountPassword
      ? { verifyAccountPassword: options.verifyAccountPassword }
      : {};
    // Storefront customer self-service (US1).
    await registerMfaSelfServiceRoutes(app, {
      pathPrefix: '/api/v1/account/mfa',
      subjectType: 'customer',
      auditObjectType: 'customer_account',
      requireGuard: options.requireCustomer,
      resolveSubjectId: (req) => options.resolveCustomerActor(req).customerAccountId,
      resolveOrganizationId: (req) => options.resolveCustomerActor(req).organizationId,
      enrolmentService,
      policyResolver,
      socialLinkService,
      auditLogService: options.auditLogService,
      ...emailOpt,
      ...pwdOpt,
    });
    // Federated sign-in (US4 customer / US5 admin).
    if (options.oauthProvider && options.socialAccountResolvers) {
      const socialIdentityService = new SocialIdentityService(
        options.emFactory,
        options.socialAccountResolvers,
        options.auditLogService,
      );
      await registerMfaOAuthRoutes(app, {
        oauthProvider: options.oauthProvider,
        challengeStore,
        policyResolver,
        socialIdentityService,
        sessionService: options.sessionService,
        backendBaseUrl: options.backendBaseUrl ?? 'http://localhost:8080',
        storefrontBaseUrl: options.storefrontBaseUrl ?? 'http://localhost:3000',
        adminBaseUrl: options.adminBaseUrl ?? 'http://localhost:3002',
      });
    }
    // Storefront org-admin enforcement (US3).
    if (options.resolveOrgAdmin) {
      await registerMfaOrgRoutes(app, {
        orgPolicyService,
        auditLogService: options.auditLogService,
        requireCustomer: options.requireCustomer,
        resolveOrgAdmin: options.resolveOrgAdmin,
      });
    }
    // Admin user self-service (US2) + admin reset (US6) + org enforcement (US3).
    const { requireAdmin, resolveAdminActor } = options;
    if (requireAdmin && resolveAdminActor) {
      await registerMfaSelfServiceRoutes(app, {
        pathPrefix: '/api/v1/admin/account/mfa',
        subjectType: 'admin',
        auditObjectType: 'admin_user',
        requireGuard: requireAdmin(),
        resolveSubjectId: (req) => resolveAdminActor(req).adminUserId,
        enrolmentService,
        policyResolver,
        socialLinkService,
        auditLogService: options.auditLogService,
        ...emailOpt,
        ...pwdOpt,
      });
      await registerMfaAdminRoutes(app, {
        enrolmentService,
        orgPolicyService,
        auditLogService: options.auditLogService,
        requireAdmin,
        resolveAdminActor,
        resolveOrganizationCustomerIds:
          options.resolveOrganizationCustomerIds ?? (async () => []),
      });
    }
  };

  return {
    plugin,
    handle: () => ({
      mfaLoginPort: loginService,
      challengeStore,
      policyResolver,
      enrolmentService,
    }),
  };
}
