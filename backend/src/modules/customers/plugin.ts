import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '../../kernel/ports/audit.js';
import { CustomerRegistrationService } from './services/customer-registration-service.js';
import { CustomerAddressService } from './services/customer-address-service.js';
import { CustomerDefaultsService } from './services/customer-defaults-service.js';
import {
  CustomerAuthorityService,
  type SalesRepVisibility,
} from './services/customer-authority-service.js';
import { CustomerModerationService } from './services/customer-moderation-service.js';
import { CustomerAdminQueryService } from './services/customer-admin-query-service.js';
import { CustomerOrgAssignmentService } from './services/customer-org-assignment-service.js';
import { CustomerDeletionService } from './services/customer-deletion-service.js';
import { CustomerPresenceService } from './services/customer-presence-service.js';
import { AnonymizationSweepWorker } from './workers/anonymization-sweep-worker.js';
import type {
  AddressReadPort,
  AuthSessionPort,
  AuthSessionReadPort,
  CartQueryPort,
  CustomFieldValuePort,
  CustomerAccountAdminSearchPort,
  CustomerAccountLifecycleWritePort,
  CustomerAccountReadPort,
  CustomerAuthPort,
  CustomerGroupReadPort,
  CustomerPasswordResetPort,
  DefaultPreferencePort,
  EmailMailerPort,
  ImpersonationPort,
  OrderListPort,
  OrganizationDetailsPort,
  PersonalOrganizationPort,
  RfqCustomerPort,
  VatValidator,
} from '@endora-commerce/contracts';
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
 * The attach function this module hands its composition root.
 *
 * Typed on `fastify`'s own `FastifyInstance` rather than on the platform's
 * `ModulePlugin`, which `contracts/host-package.md` §1.4g classifies **A**: the
 * host does not publish it, so a packaged module cannot name it. The
 * already-packaged `quote_requests` types its attach function the same way.
 */
type ModuleAttach = (app: FastifyInstance) => Promise<void>;

/**
 * Customers module composition root (feature 040).
 *
 * Orchestrates the customer-lifecycle surfaces over the existing data
 * modules. Sibling services are injected from `composition.ts` so the module
 * never imports another module's internals (Constitution Principle I).
 */
export interface CustomersModuleOptions {
  /**
   * Feature 072 (T094) — `customer_accounts` owns these now. Injected rather
   * than built here, because this host and `organizations` each built their own and the
   * MFA argument differed between them.
   */
  customerAuthService: CustomerAuthPort;
  passwordResetService: CustomerPasswordResetPort;
  emFactory: () => EntityManager;
  /**
   * `auth`'s published session port, resolved under the name the contract
   * publishes (D-98.2 / issue #196). It used to be the `SessionService`
   * class, resolved as `sessionService`: the three calls this host makes —
   * `createSession`, `destroyAllForCustomer`, `listRecentlyActiveCustomers`
   * — are all on {@link AuthSessionPort}, so nothing needed the class.
   *
   * It was one of two options over the same port until this module's Phase-C
   * cut: the duplicate existed only to feed the `ImpersonationService` this
   * host built itself, and that instance is now `admin_users`' port.
   */
  sessionService: AuthSessionPort;
  /**
   * `admin_users`' published impersonation seam (feature 075). This host used
   * to construct a **second** `ImpersonationService` from an import of that
   * module's directory, over the port `admin_users`' own Phase-C cut published
   * for it — so the machinery ran here whether its owner was present or not.
   * The port is gated: a switched-off `admin_users` answers 503
   * `MODULE_DISABLED` at the seam instead of minting a session.
   */
  impersonationPort: ImpersonationPort;
  /**
   * `auth`'s published read over the session table, for the online-customers
   * panel. The panel *reports* on sessions rather than managing them, which is
   * why it is a separate port from {@link AuthSessionPort} — and why this
   * module no longer needs `Session` to answer "when was this account last
   * seen".
   */
  authSessionReadPort: AuthSessionReadPort;
  customerAccountReadPort: CustomerAccountReadPort;
  /**
   * Feature 075, Phase C — the rest of `customer_accounts`' published surface
   * this module's own screens run on: the lifecycle writes it used to perform
   * by mutating that module's entity, the admin list's query, and the group
   * names beside it.
   */
  customerAccountLifecycleWritePort: CustomerAccountLifecycleWritePort;
  customerAccountAdminSearchPort: CustomerAccountAdminSearchPort;
  customerGroupReadPort: CustomerGroupReadPort;
  /**
   * `organizations`' published surface: the row-level read the admin list and
   * the assignment screen ask for names and existence with, and the personal
   * organisation a B2C registration provisions — which is also what the
   * retention sweep cascades onto.
   */
  organizationDetailsPort: OrganizationDetailsPort;
  personalOrganizationPort: PersonalOrganizationPort;
  /** `addresses`' published read: the org-shared book a customer may pick from. */
  addressReadPort: AddressReadPort;
  /**
   * Which organizations the acting staff member may see —
   * `organizations`' `organizationSalesRepScopePort` (issue #108).
   *
   * Injected rather than built here. This module used to construct its own
   * `SalesRepAssignmentService` from an entity-manager factory and an audit log,
   * and that class's third argument — the feature-056 subtree deps — is
   * optional, so omitting it compiled and quietly reverted every
   * staff-authority decision to the flat pre-056 rule: a rep holding
   * `organizations:rollup` could not act on a customer belonging to a
   * descendant of an organization assigned to them.
   */
  salesRepVisibility: SalesRepVisibility;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerActor: ResolveCustomerActor;
  /** Reads `customers.allow_registration_without_organization`. */
  resolveAllowRegistrationWithoutOrganization: () => Promise<boolean>;
  /**
   * `orders`' published list, which the self-service history panel and the
   * admin customer-detail orders panel both read (feature 075). It replaces
   * `Pick<OrderListService, 'list'>` over a late-bound accessor: the port keeps
   * the accessor's timing, because `orders` builds the service inside its
   * plugin body, and answers a call made before that with a 503 rather than a
   * `null` two route files had to remember to check.
   */
  orderList: OrderListPort;
  rfqService: RfqCustomerPort;
  auditLogService: AuditPort;
  /**
   * `quick_order`'s ordering defaults, which the customer-detail screen and
   * self-service profile render and edit (issue #216).
   *
   * A **binding** dependency: the port's own contract says the seam fails
   * closed when `quick_order` is off, and this module used to answer the same
   * question out of a second instance it constructed itself — which read the
   * table whether the owner was present or not.
   */
  defaultPreferencePort: DefaultPreferencePort;
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  /** VAT/NIP validator port (VIES / Biała lista in production). */
  vatValidator: VatValidator;
  mailer: EmailMailerPort;
  /**
   * `carts`' reporting read: the account's current cart and its abandoned ones,
   * for the customer-detail panel. This host used to build a second
   * `CartQueryService` from an import of that module's directory (feature 075).
   */
  cartQueryPort: CartQueryPort;
  /** Base URL for the storefront set-password link in reset emails. */
  storefrontBaseUrl: string;
  /** Reads `customers.deletion_retention_days`. */
  resolveDeletionRetentionDays: () => Promise<number>;
  /** Reads `customers.presence_freshness_minutes`. */
  resolvePresenceFreshnessMinutes: () => Promise<number>;
  /**
   * Feature 055 — validates Customer custom-field values on the admin edit
   * path. The persistence is `customer_accounts`': its lifecycle port runs the
   * Command and takes this validator as the merge (feature 075).
   */
  customFieldValues?: CustomFieldValuePort;
}

export interface CustomersModuleHandle {
  registrationService: CustomerRegistrationService;
  anonymizationSweepWorker: AnonymizationSweepWorker;
  /**
   * Exposed so the sales-rep scope this module *uses* can be asserted (issue
   * #108). The defect it closes was invisible to `tsc` and to every route test,
   * because a flat scope answers plausibly — just not with the roll-up.
   */
  authorityService: CustomerAuthorityService;
}

export function customersModule(options: CustomersModuleOptions): {
  plugin: ModuleAttach;
  handle: () => CustomersModuleHandle;
} {
  const customerAuthService = options.customerAuthService;
  const registrationService = new CustomerRegistrationService({
    accounts: options.customerAccountLifecycleWritePort,
    sessionService: options.sessionService,
    resolveAllowRegistrationWithoutOrganization:
      options.resolveAllowRegistrationWithoutOrganization,
    personalOrganizations: options.personalOrganizationPort,
  });
  const customerAddressService = new CustomerAddressService(
    options.emFactory,
    options.addressReadPort,
    options.auditLogService,
  );
  const customerDefaultsService = new CustomerDefaultsService(
    options.emFactory,
    options.defaultPreferencePort,
    customerAddressService,
  );
  const authorityService = new CustomerAuthorityService(options.salesRepVisibility);
  const moderationService = new CustomerModerationService(
    options.customerAccountReadPort,
    options.customerAccountLifecycleWritePort,
    authorityService,
    {
      destroyAllForCustomer: (customerAccountId) =>
        options.sessionService.destroyAllForCustomer(customerAccountId),
    },
  );
  const queryService = new CustomerAdminQueryService(options.emFactory, customerDefaultsService, {
    accounts: options.customerAccountReadPort,
    accountSearch: options.customerAccountAdminSearchPort,
    organizations: options.organizationDetailsPort,
    customerGroups: options.customerGroupReadPort,
  });
  const orgAssignmentService = new CustomerOrgAssignmentService(
    options.customerAccountReadPort,
    options.customerAccountLifecycleWritePort,
    options.organizationDetailsPort,
    authorityService,
  );
  const deletionService = new CustomerDeletionService(
    options.customerAccountReadPort,
    options.customerAccountLifecycleWritePort,
    options.personalOrganizationPort,
    authorityService,
    {
      destroyAllForCustomer: (customerAccountId) =>
        options.sessionService.destroyAllForCustomer(customerAccountId),
    },
  );
  const presenceService = new CustomerPresenceService(
    {
      listRecentlyActiveCustomers: (windowMinutes) =>
        options.sessionService.listRecentlyActiveCustomers(windowMinutes),
    },
    options.authSessionReadPort,
    options.resolvePresenceFreshnessMinutes,
    options.customerAccountReadPort,
  );
  const passwordResetService = options.passwordResetService;
  const anonymizationSweepWorker = new AnonymizationSweepWorker(
    deletionService,
    options.resolveDeletionRetentionDays,
  );

  const plugin: ModuleAttach = async (app) => {
    await registerCustomersRegisterRoutes(app, { registrationService });
    await registerCustomersSelfRoutes(app, {
      accounts: options.customerAccountReadPort,
      requireCustomer: options.requireCustomer,
      resolveCustomerActor: options.resolveCustomerActor,
      customerAuthService,
      orderList: options.orderList,
      rfqService: options.rfqService,
      customerAddressService,
      customerDefaultsService,
    });
    await registerCustomersAdminRoutes(app, {
      accounts: options.customerAccountReadPort,
      accountWrites: options.customerAccountLifecycleWritePort,
      requireAdmin: options.requireAdmin,
      resolveModerationActor: options.resolveModerationActor,
      moderationService,
      queryService,
      orgAssignmentService,
      addressService: customerAddressService,
      cartQueryService: options.cartQueryPort,
      orderList: options.orderList,
      rfqService: options.rfqService,
      vatValidator: options.vatValidator,
      impersonationService: options.impersonationPort,
      deletionService,
      presenceService,
      passwordResetService,
      mailer: options.mailer,
      auditLogService: options.auditLogService,
      storefrontBaseUrl: options.storefrontBaseUrl,
      ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
    });
  };

  return {
    plugin,
    handle: () => ({ registrationService, anonymizationSweepWorker, authorityService }),
  };
}
