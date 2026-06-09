import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { ModulePlugin } from '../../http/server.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
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
import type { OAuthProviderPort } from './services/oauth-provider-service.js';
import { SecretCipher } from './services/secret-cipher.js';
import { registerMfaPublicRoutes } from './routes.public.js';
import { registerMfaSelfServiceRoutes } from './routes.self-service.js';
import { registerMfaAdminRoutes } from './routes.admin.js';
import { registerMfaOrgRoutes } from './routes.org.js';
import { registerMfaOAuthRoutes } from './routes.oauth.js';

type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

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
  auditLogService: AuditLogService;
  sessionService: SessionService;
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
  plugin: ModulePlugin;
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
    ? new MfaEnrolmentService(options.emFactory, cipher)
    : null;

  const loginService = new MfaLoginService(
    options.emFactory,
    challengeStore,
    policyResolver,
    enrolmentService ?? undefined,
  );
  const orgPolicyService = new MfaOrgPolicyService(options.emFactory);

  const plugin: ModulePlugin = async (app) => {
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
