import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModulePlugin } from '../../http/server.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { OrderListService } from '../orders/services/order-list-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { CommandBus } from '../../commands/index.js';
import type { CustomFieldValueService } from '../custom_fields/services/custom-field-value.service.js';
import type { OrganizationRestrictionService } from '../organizations/services/organization-restriction-service.js';
import { CustomerAuthService } from '../customer_accounts/services/customer-auth-service.js';
import { DefaultPreferenceService } from '../quick_order/services/default-preference-service.js';
import { SalesRepAssignmentService } from '../organizations/services/sales-rep-assignment-service.js';
import { ImpersonationService } from '../admin_users/services/impersonation-service.js';
import { CustomerRegistrationService } from './services/customer-registration-service.js';
import { PersonalOrganizationService } from '../organizations/services/personal-organization-service.js';
import { CustomerAddressService } from './services/customer-address-service.js';
import { CustomerDefaultsService } from './services/customer-defaults-service.js';
import { CustomerAuthorityService } from './services/customer-authority-service.js';
import { CustomerModerationService } from './services/customer-moderation-service.js';
import { CustomerAdminQueryService } from './services/customer-admin-query-service.js';
import { CustomerOrgAssignmentService } from './services/customer-org-assignment-service.js';
import { CustomerDeletionService } from './services/customer-deletion-service.js';
import { CustomerPresenceService } from './services/customer-presence-service.js';
import { CartQueryService } from '../carts/services/cart-query-service.js';
import { AnonymizationSweepWorker } from './workers/anonymization-sweep-worker.js';
import { PasswordResetService } from '../customer_accounts/services/password-reset-service.js';
import type { VatValidator } from '../organizations/services/vat-validator-port.js';
import type { Mailer } from '../email/services/mailer.js';
import { registerCustomersRegisterRoutes } from './routes.register.js';
import {
  registerCustomersSelfRoutes,
  type RequireCustomerGuard,
  type ResolveCustomerActor,
} from './routes.self.js';
import {
  registerCustomersAdminRoutes,
  type RequireAdminGuard,
  type ResolveModerationActor,
} from './routes.admin.js';

/**
 * Customers module composition root (feature 040).
 *
 * Orchestrates the customer-lifecycle surfaces over the existing data
 * modules. Sibling services are injected from `composition.ts` so the module
 * never imports another module's internals (Constitution Principle I).
 */
export interface CustomersModuleOptions {
  emFactory: () => EntityManager;
  sessionService: SessionService;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerActor: ResolveCustomerActor;
  /** Reads `customers.allow_registration_without_organization`. */
  resolveAllowRegistrationWithoutOrganization: () => Promise<boolean>;
  /** Lazy — OrderListService is bound during the orders plugin registration. */
  getOrderListService: () => OrderListService;
  rfqService: RfqService;
  auditLogService: AuditLogService;
  /** Org allow-list port for default-preference eligibility (optional). */
  organizationRestrictionService?: OrganizationRestrictionService;
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  /** VAT/NIP validator port (VIES / Biała lista in production). */
  vatValidator: VatValidator;
  mailer: Mailer;
  /** Base URL for the storefront set-password link in reset emails. */
  storefrontBaseUrl: string;
  /** Reads `customers.deletion_retention_days`. */
  resolveDeletionRetentionDays: () => Promise<number>;
  /** Reads `customers.presence_freshness_minutes`. */
  resolvePresenceFreshnessMinutes: () => Promise<number>;
  /** Feature 055 — validates + persists Customer custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValueService;
  /** Feature 054/055 — audits the custom-field write co-transactionally when provided. */
  commandBus?: CommandBus;
}

export interface CustomersModuleHandle {
  registrationService: CustomerRegistrationService;
  anonymizationSweepWorker: AnonymizationSweepWorker;
}

export function customersModule(options: CustomersModuleOptions): {
  plugin: ModulePlugin;
  handle: () => CustomersModuleHandle;
} {
  const customerAuthService = new CustomerAuthService(
    options.emFactory,
    options.sessionService,
    undefined, // getMfaLoginPort — not wired in the customers composition
    options.auditLogService,
  );
  const personalOrganizationService = new PersonalOrganizationService(options.emFactory);
  const registrationService = new CustomerRegistrationService({
    emFactory: options.emFactory,
    sessionService: options.sessionService,
    resolveAllowRegistrationWithoutOrganization:
      options.resolveAllowRegistrationWithoutOrganization,
    personalOrganizationService,
    auditLog: options.auditLogService,
  });
  const customerAddressService = new CustomerAddressService(options.emFactory, options.auditLogService);
  const defaultPreferenceService = new DefaultPreferenceService(
    options.emFactory,
    options.auditLogService,
    options.organizationRestrictionService,
  );
  const customerDefaultsService = new CustomerDefaultsService(
    options.emFactory,
    defaultPreferenceService,
    customerAddressService,
  );
  const authorityService = new CustomerAuthorityService(
    new SalesRepAssignmentService(options.emFactory, options.auditLogService),
  );
  const moderationService = new CustomerModerationService(
    options.emFactory,
    authorityService,
    options.auditLogService,
    {
      destroyAllForCustomer: (customerAccountId) =>
        options.sessionService.destroyAllForCustomer(customerAccountId),
    },
  );
  const impersonationService = new ImpersonationService(
    options.emFactory,
    options.sessionService,
    options.auditLogService,
  );
  const queryService = new CustomerAdminQueryService(
    options.emFactory,
    customerDefaultsService,
  );
  const orgAssignmentService = new CustomerOrgAssignmentService(
    options.emFactory,
    authorityService,
    options.auditLogService,
  );
  const cartQueryService = new CartQueryService(options.emFactory);
  const deletionService = new CustomerDeletionService(
    options.emFactory,
    authorityService,
    options.auditLogService,
    {
      destroyAllForCustomer: (customerAccountId) =>
        options.sessionService.destroyAllForCustomer(customerAccountId),
    },
  );
  const presenceService = new CustomerPresenceService(
    options.emFactory,
    {
      listRecentlyActiveCustomers: (windowMinutes) =>
        options.sessionService.listRecentlyActiveCustomers(windowMinutes),
    },
    options.resolvePresenceFreshnessMinutes,
  );
  const passwordResetService = new PasswordResetService(options.emFactory, options.auditLogService);
  const anonymizationSweepWorker = new AnonymizationSweepWorker(
    deletionService,
    options.resolveDeletionRetentionDays,
  );

  const plugin: ModulePlugin = async (app) => {
    await registerCustomersRegisterRoutes(app, { registrationService });
    await registerCustomersSelfRoutes(app, {
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerActor: options.resolveCustomerActor,
      customerAuthService,
      getOrderListService: options.getOrderListService,
      rfqService: options.rfqService,
      customerAddressService,
      customerDefaultsService,
    });
    await registerCustomersAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      resolveModerationActor: options.resolveModerationActor,
      moderationService,
      queryService,
      orgAssignmentService,
      addressService: customerAddressService,
      cartQueryService,
      getOrderListService: options.getOrderListService,
      rfqService: options.rfqService,
      vatValidator: options.vatValidator,
      impersonationService,
      deletionService,
      presenceService,
      passwordResetService,
      mailer: options.mailer,
      auditLogService: options.auditLogService,
      storefrontBaseUrl: options.storefrontBaseUrl,
      ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
      ...(options.commandBus ? { commandBus: options.commandBus } : {}),
    });
  };

  return {
    plugin,
    handle: () => ({ registrationService, anonymizationSweepWorker }),
  };
}
