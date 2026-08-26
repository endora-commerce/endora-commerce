import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressServicePort,
  CartMergeOutcome,
  CustomFieldValuePort,
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
  CustomerAuthPort,
  CustomerPasswordResetPort,
  CustomerRolePort,
  EmailMailerPort,
} from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import type { OrganizationModerationService } from './services/organization-moderation-service.js';
import type { OrganizationRestrictionService } from './services/organization-restriction-service.js';
import type { OrganizationEffectivePriceListsService } from './services/organization-effective-pricelists-service.js';
import type { OrganizationTaxIdValidationService } from './services/organization-tax-id-validation-service.js';
import {
  RegistrationService,
  type OrganizationEventBus,
} from './services/registration-service.js';
import { EmailVerificationService } from './services/email-verification-service.js';
import { InvitationService } from './services/invitation-service.js';
import { noopOrgTemplateEmail, type OrgTemplateEmail } from './services/org-template-email.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { registerOrganizationsPublicRoutes } from './routes.public.js';
import { registerOrganizationsCustomerRoutes } from './routes.customer.js';
import { registerOrganizationsStorefrontRoutes } from './routes.storefront.js';
import { OrganizationContextService } from './services/organization-context-service.js';
import { registerMembersRoutes } from './routes.members.js';
import { registerOrganizationsAdminRoutes } from './routes.admin.js';
import { OrganizationTreeService } from './services/organization-tree-service.js';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { RequireAdminAnyFactory } from '@endora-commerce/platform/kernel';
import type { DictionaryValidator } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Composition root for the organizations + customer_accounts + addresses
 * module family. One plugin registers all three because their routes share
 * the same auth flow and serializers.
 */

export interface OrganizationsModuleOptions {
  /**
   * Feature 072 (T094) — `customer_accounts` owns these now. Injected rather
   * than built here, because this host and `customers` each built their own and the
   * MFA argument differed between them.
   */
  customerAuthService: CustomerAuthPort;
  passwordResetService: CustomerPasswordResetPort;
  customerRoleService: CustomerRolePort;
  /**
   * `customer_accounts`' published read and member write (feature 075, Phase
   * C). Registration, invitation accept, the member panel, `GET /me` and the
   * Org-Admin gate all reached this module's entity directly before the cut.
   */
  customerAccountRead: CustomerAccountReadPort;
  customerAccountWrite: CustomerAccountMemberWritePort;
  emFactory: () => EntityManager;
  eventBus: EventBus;
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
  /**
   * Transport for the invitation and verification e-mails.
   *
   * Required since feature 075's Phase C. It defaulted to `new ConsoleMailer()`
   * — a value import of `email`'s driver — and the default has had no reachable
   * caller since the container started resolving `emailMailer` for every
   * composition: an omitted mailer would mean an e-mail nobody receives and a
   * registration that reports it as sent.
   */
  mailer: EmailMailerPort;
  /**
   * Feature 047 / 072 (T120) — the template-routed sender, supplied by
   * `transactional_emails` through `templateEmailPort`. Absent, every
   * template-routed send falls back to the legacy in-code builder.
   */
  templateEmail?: OrgTemplateEmail;
  // `resolveScopeSalesChannelId` and `resolveSalesChannelLanguage` were here
  // until T120. They existed only to feed the template adapter this module used
  // to assemble; `transactional_emails` resolves both inside the one adapter it
  // now owns.
  /** Storefront base URL for the invitation accept link. */
  storefrontBaseUrl?: string;
  /** Required when `requireAdmin` is set — audit trail for admin org mutations. */
  auditLogService?: AuditPort;
  dictionaryValidator?: DictionaryValidator;
  /** Resolved from the container since feature 072 (T090) — one instance, always armed. */
  addressService: AddressServicePort;
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
  /** Feature 055 — validates + reads organization custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 056 — Command Bus for the org-hierarchy tree mutations
   * (`organization.set_parent` / `organization.move`). When present alongside
   * `requireAdmin`, the hierarchy admin endpoints are mounted (Principle XIII).
   */
  commandBus?: CommandBus;
}

export function organizationsModule(options: OrganizationsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const mailer = options.mailer;
    // Feature 072 (T120) — supplied rather than assembled. This used to build
    // its own adapter from three options; `transactional_emails` owns the
    // implementation now and every module that sends template-routed mail
    // resolves the same one.
    const orgTemplateEmail = options.templateEmail ?? noopOrgTemplateEmail;
    const storefrontBaseUrl = options.storefrontBaseUrl ?? 'http://localhost:3000';
    const latestTokenByEmail = new Map<string, string>();
    const accountPorts = {
      read: options.customerAccountRead,
      write: options.customerAccountWrite,
    };
    const registrationService = new RegistrationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
      accountPorts,
      options.dictionaryValidator,
      options.auditLogService,
    );
    const verificationService = new EmailVerificationService(
      options.emFactory,
      options.eventBus as OrganizationEventBus,
      accountPorts,
      options.auditLogService,
    );
    const customerAuthService = options.customerAuthService;
    const invitationService = new InvitationService(
      options.emFactory,
      accountPorts,
      mailer,
      { acceptBaseUrl: storefrontBaseUrl },
      options.eventBus as OrganizationEventBus,
      orgTemplateEmail,
      options.auditLogService,
    );
    const roleService = options.customerRoleService;
    const passwordResetService = options.passwordResetService;
    const addressService = options.addressService;
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
      customerAccountRead: options.customerAccountRead,
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
      customerAccountRead: options.customerAccountRead,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      exposeTestProbe: options.exposeTestProbe ?? false,
      latestInvitationToken,
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
        customerAccountRead: options.customerAccountRead,
        customerAccountWrite: options.customerAccountWrite,
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
        ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
        ...(options.commandBus
          ? {
              commandBus: options.commandBus,
              treeService: new OrganizationTreeService(options.emFactory),
            }
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
