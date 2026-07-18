import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartMergeOutcome } from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { MfaLoginPort } from '../auth/services/mfa-login-port.js';
import type { OrganizationModerationService } from './services/organization-moderation-service.js';
import type { OrganizationRestrictionService } from './services/organization-restriction-service.js';
import type { OrganizationEffectivePriceListsService } from './services/organization-effective-pricelists-service.js';
import type { OrganizationTaxIdValidationService } from './services/organization-tax-id-validation-service.js';
import {
  RegistrationService,
  type OrganizationEventBus,
} from './services/registration-service.js';
import { EmailVerificationService } from './services/email-verification-service.js';
import { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import { AddressService } from '../addresses/services/address-service.js';
import { InvitationService } from './services/invitation-service.js';
import { makeOrgTemplateEmail } from './services/org-template-email.js';
import { RoleService } from '../customer_accounts/services/role-service.js';
import { PasswordResetService } from '../customer_accounts/services/password-reset-service.js';
import { TotpEnrolmentService } from '../customer_accounts/services/totp-enrolment-service.js';
import { ConsoleMailer, type Mailer } from '../email/services/mailer.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { registerOrganizationsPublicRoutes } from './routes.public.js';
import { registerOrganizationsCustomerRoutes } from './routes.customer.js';
import { registerOrganizationsStorefrontRoutes } from './routes.storefront.js';
import { OrganizationContextService } from './services/organization-context-service.js';
import { registerMembersRoutes } from './routes.members.js';
import { registerOrganizationsAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { RequireAdminAnyFactory } from '../../http/require-admin-any.js';
import type { DictionaryValidator } from '@b2b/contracts';

/**
 * Composition root for the organizations + customer_accounts + addresses
 * module family. One plugin registers all three because their routes share
 * the same auth flow and serializers.
 */

export interface OrganizationsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  sessionService: SessionService;
  /** Feature 042 — lazily resolved MFA login port (absent ⇒ password-only). */
  getMfaLoginPort?: () => MfaLoginPort | undefined;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /** Expose the /api/v1/_test/latest-verification-token probe (test-only). */
  exposeTestProbe?: boolean;
  /**
   * Optional post-login hook — the commerce module uses this to merge
   * carts; the comparisons module uses it to adopt the customer's
   * anonymous Comparison (R-2). Each token is extracted from the request
   * cookies if present and forwarded to the hook. The optional
   * `cartMerge` return field carries the outcome of the cart-merge step
   * back to the login route so it can serialise the result for the
   * storefront (feature 037-cart-merge-on-login).
   */
  onLogin?: (ctx: {
    customerAccountId: string;
    /** Null for no-org Customer accounts (feature 026 US2). */
    organizationId: string | null;
    anonymousCartToken?: string;
    /** `compare_token` cookie value, if the caller was building an anonymous comparison. */
    anonymousCompareToken?: string;
  }) => Promise<{ cartMerge?: CartMergeOutcome }>;
  /** Admin gate for /admin/organizations routes. */
  requireAdmin?: RequireAdminFactory;
  /** Read-only org routes accept `customers:read` OR `customers:manage`. */
  requireAdminAny?: RequireAdminAnyFactory;
  /** Mailer used to dispatch invitation + verification emails. Defaults to ConsoleMailer. */
  mailer?: Mailer;
  /** Feature 047 — late-bound transactional-email sender (admin-editable templates). */
  getTransactionalEmailSender?: () => import('@b2b/contracts').TransactionalEmailSender | undefined;
  /** Feature 047 — resolves the scope channel for org emails (system-default). */
  resolveScopeSalesChannelId?: () => Promise<string | null>;
  /** Feature 047 — resolves the email language for a sales channel. */
  resolveSalesChannelLanguage?: (salesChannelId: string) => Promise<string>;
  /** Storefront base URL for the invitation accept link. */
  storefrontBaseUrl?: string;
  /** Required when `requireAdmin` is set — audit trail for admin org mutations. */
  auditLogService?: AuditLogService;
  dictionaryValidator?: DictionaryValidator;
  /**
   * Feature 026 — moderation service that owns approve / reject / block /
   * unblock. When provided alongside `requireAdmin`, the matching admin
   * endpoints are mounted; otherwise only the legacy PATCH endpoint runs.
   */
  moderationService?: OrganizationModerationService;
  /**
   * Feature 026 US4 — restriction service that owns the per-Organization
   * payment / delivery / warehouse allow-lists. When provided alongside
   * `requireAdmin`, the matching admin endpoints are mounted.
   */
  restrictionService?: OrganizationRestrictionService;
  /**
   * Feature 026 US5 — service returning the Price Lists currently
   * applicable to an Organization. Mounts the
   * `/applicable-price-lists` admin endpoint when provided.
   */
  effectivePriceListsService?: OrganizationEffectivePriceListsService;
  /**
   * Feature 026 US7 — service that runs VAT-ID validation via VIES /
   * Ministerstwo Finansów. Mounts the `/vat-validations` admin endpoints
   * when provided.
   */
  taxIdValidationService?: OrganizationTaxIdValidationService;
}

export function organizationsModule(options: OrganizationsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const mailer = options.mailer ?? new ConsoleMailer();
    const orgTemplateEmail = makeOrgTemplateEmail({
      ...(options.getTransactionalEmailSender ? { getSender: options.getTransactionalEmailSender } : {}),
      ...(options.resolveScopeSalesChannelId
        ? { resolveScopeSalesChannelId: options.resolveScopeSalesChannelId }
        : {}),
      ...(options.resolveSalesChannelLanguage
        ? { resolveLanguage: options.resolveSalesChannelLanguage }
        : {}),
    });
    const storefrontBaseUrl = options.storefrontBaseUrl ?? 'http://localhost:3000';
    const latestTokenByEmail = new Map<string, string>();
    const registrationService = new RegistrationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
      options.dictionaryValidator,
      options.auditLogService,
    );
    const verificationService = new EmailVerificationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
      options.auditLogService,
    );
    const customerAuthService = new CustomerAuthService(
      options.emFactory,
      options.sessionService,
      options.getMfaLoginPort,
      options.auditLogService,
    );
    const addressService = new AddressService(options.emFactory, options.dictionaryValidator, options.auditLogService);
    const invitationService = new InvitationService(
      options.emFactory,
      mailer,
      { acceptBaseUrl: storefrontBaseUrl },
      options.eventBus as OrganizationEventBus,
      orgTemplateEmail,
      options.auditLogService,
    );
    const roleService = new RoleService(options.emFactory, options.auditLogService);
    const passwordResetService = new PasswordResetService(options.emFactory, options.auditLogService);
    const totpEnrolmentService = new TotpEnrolmentService(options.emFactory, options.auditLogService);
    const latestInvitationToken: { value: string | null } = { value: null };

    await registerOrganizationsPublicRoutes(app, {
      registrationService,
      verificationService,
      customerAuthService,
      passwordResetService,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestTokenByEmail,
      mailer,
      templateEmail: orgTemplateEmail,
      storefrontBaseUrl,
      ...(options.onLogin ? { onLogin: options.onLogin } : {}),
    });
    await registerOrganizationsCustomerRoutes(app, {
      customerAuthService,
      addressService,
      totpEnrolmentService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      resolveCustomerActorOptionalOrg: resolveOptionalOrgContext,
      emFactory: options.emFactory,
    });
    if (options.restrictionService) {
      await registerOrganizationsStorefrontRoutes(app, {
        contextService: new OrganizationContextService(options.emFactory),
        restrictionService: options.restrictionService,
        requireCustomer: options.requireCustomer,
        // The preflight endpoint must accept no-org Customers (they receive
        // platform defaults). We read the actor decoration directly rather
        // than going through `resolveCustomerContext`, which throws 422 for
        // no-org callers — that behavior is correct for order placement and
        // RFQ submission but wrong here.
        resolveCustomerContext: resolveOptionalOrgContext,
      });
    }
    await registerMembersRoutes(app, {
      invitationService,
      roleService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestInvitationToken,
      emFactory: options.emFactory,
    });
    if (options.requireAdmin) {
      if (!options.auditLogService) {
        throw new Error('organizationsModule: auditLogService is required when requireAdmin is set');
      }
      if (!options.requireAdminAny) {
        throw new Error('organizationsModule: requireAdminAny is required when requireAdmin is set');
      }
      await registerOrganizationsAdminRoutes(app, {
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        requireAdminAny: options.requireAdminAny,
        invitationService,
        roleService,
        auditLogService: options.auditLogService,
        eventBus: options.eventBus as OrganizationEventBus,
        addressService,
        ...(options.moderationService ? { moderationService: options.moderationService } : {}),
        ...(options.restrictionService ? { restrictionService: options.restrictionService } : {}),
        ...(options.effectivePriceListsService
          ? { effectivePriceListsService: options.effectivePriceListsService }
          : {}),
        ...(options.taxIdValidationService
          ? { taxIdValidationService: options.taxIdValidationService }
          : {}),
      });
    }
  };
}

/**
 * Reads the customer context from whichever actor decoration is present —
 * `request.actor` in production, `request.testActor` in the test harness.
 * Returns `organizationId: null` for no-org Customer accounts (feature 026
 * US2). Used by the storefront preflight endpoint which must accept both
 * org-bound and no-org Customers.
 */
function resolveOptionalOrgContext(
  request: FastifyRequest,
): {
  customerAccountId: string;
  organizationId: string | null;
  impersonatorAdminUserId?: string | null;
} {
  const r = request as FastifyRequest & {
    testActor?: {
      kind: string;
      customerAccountId?: string;
      organizationId?: string | null;
      impersonatorAdminUserId?: string | null;
    };
    actor?: {
      kind: string;
      customerAccountId?: string;
      organizationId?: string | null;
      impersonatorAdminUserId?: string | null;
    };
  };
  if (r.testActor?.kind === 'customer' && r.testActor.customerAccountId) {
    return {
      customerAccountId: r.testActor.customerAccountId,
      organizationId: r.testActor.organizationId ?? null,
      impersonatorAdminUserId: r.testActor.impersonatorAdminUserId ?? null,
    };
  }
  if (r.actor?.kind === 'customer' && r.actor.customerAccountId) {
    return {
      customerAccountId: r.actor.customerAccountId,
      organizationId: r.actor.organizationId ?? null,
      impersonatorAdminUserId: r.actor.impersonatorAdminUserId ?? null,
    };
  }
  throw new Error(
    'resolveOptionalOrgContext: no Customer actor on the request — requireCustomer preHandler should have rejected.',
  );
}
