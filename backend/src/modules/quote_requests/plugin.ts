import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type {
  AdminUserReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldValuePort,
  OrderReadPort,
  OrganizationDetailsPort,
  SalesRepAssignmentPort,
} from '@b2b/contracts';
import { RfqService, type RfqEventBus } from './services/rfq-service.js';
import { createQuoteRequestBusinessIdGenerator } from './services/quote-request-business-id-generator.js';
import { RfqAdminService } from './services/rfq-admin-service.js';
import { RfqEventService } from './services/rfq-event-service.js';
import { RfqRevisionService } from './services/rfq-revision-service.js';
import { RfqNotificationService } from './services/rfq-notification-service.js';
import { RfqExpiryWorker } from './services/rfq-expiry-worker.js';
import { createOrderCompletionReactor } from './services/order-completion-reactor.js';
import {
  registerQuoteRequestsCustomerRoutes,
  type CustomerContextResolver,
  type RequireCustomerGuard,
} from './routes.customer.js';
import {
  registerQuoteRequestsAdminRoutes,
  type AdminContextResolver,
} from './routes.admin.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { ModuleDisabledError } from '../../kernel/lifecycle/plugin-helpers.js';

/**
 * Conditions the storefront flag handler has already reported (D-43). Per
 * process: these two flags are read on every product card render, so one line
 * per condition is what makes a settings outage findable and one line per read
 * is what buries it.
 */
const storefrontFlagWarned = new Set<string>();

export interface QuoteRequestsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: RequireCustomerGuard;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: CustomerContextResolver;
  resolveAdminContext: AdminContextResolver;
  /** Reads the current `quote_requests.expiry_days` from the settings module. */
  resolveExpiryDays: () => Promise<number>;
  /** Reads the storefront-visibility flags from settings. */
  resolveBoolSetting: (key: 'show_add_to_quote_on_card' | 'show_add_to_quote_on_pdp') => Promise<boolean>;
  /**
   * Reads the business Quote Request ID prefix/suffix from settings
   * (`quote_requests.business_id.*`). Optional — when omitted, generated IDs
   * are the bare sequence number.
   */
  resolveBusinessIdPrefix?: () => Promise<string>;
  resolveBusinessIdSuffix?: () => Promise<string>;
  /**
   * Feature 026 — refuses RFQ submission when the Customer's Organization is
   * not `active`.
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
  /**
   * Resolves the VAT rate (fraction, e.g. `0.23`) applied to a quote's net
   * prices for the given Organization. Supplied by composition (reads the
   * Organization VAT status + tax rules).
   *
   * Required since issue #124: omitting it quoted every organization at 0% VAT
   * and called that a price, which is indistinguishable from a deployment whose
   * rules genuinely say 0%. An absent `taxes` module now reaches the caller as
   * the 503 `MODULE_DISABLED` envelope through this resolver.
   */
  resolveTaxRate: (organizationId: string) => Promise<number>;
  /** Feature 054 — audits RFQ lifecycle writes co-transactionally when provided. */
  auditLog?: AuditLogService;
  /** Feature 055 — validates + reads RFQ custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValuePort;
  /**
   * Feature 075, Phase C — the five owners this module reads, and the one it
   * writes. Each replaces an `em.find` against another module's table, which
   * deactivation cannot reach; each owner is a binding dependency of this
   * manifest, so every one of them fails closed.
   */
  catalogProducts: CatalogProductReadPort;
  customerAccounts: CustomerAccountReadPort;
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
  orders: OrderReadPort;
  carts: CartWritePort;
  /**
   * `organizations`' sales-rep assignment port (issue #108).
   *
   * This used to be `salesRepSubtree`, the feature-056 deps out of which this
   * module built its **own** `SalesRepAssignmentService`. One class, assembled
   * in three places — its owner and two consumers — and the assembly here was
   * complete; the one in `customers` omitted the optional argument that carries
   * the roll-up, which is what a copy makes possible. The scope is
   * `organizations`', so it is resolved, not rebuilt.
   */
  salesRepAssignment: SalesRepAssignmentPort;
}

export interface QuoteRequestsModuleHandle {
  /** US5 reactor; `backend.ts` owns its subscription. */
  orderCompletionReactor: ReturnType<typeof createOrderCompletionReactor>;
  expiryWorker: RfqExpiryWorker;
  rfqService: RfqService;
  adminService: RfqAdminService;
  salesRepAssignment: SalesRepAssignmentPort;
}

export function quoteRequestsModule(options: QuoteRequestsModuleOptions): {
  register: (app: FastifyInstance) => Promise<void>;
  handle: () => QuoteRequestsModuleHandle;
} {
  const eventService = new RfqEventService(options.emFactory);
  const revisionService = new RfqRevisionService(options.emFactory);
  const notificationService = new RfqNotificationService(options.emFactory);
  const salesRepAssignment = options.salesRepAssignment;

  // Business Quote Request ID generator — adapts the composition-wired
  // prefix/suffix resolver closures (SettingsService-backed) to the
  // generator's settings port; the generator itself draws the sequence.
  const businessIdGenerator = createQuoteRequestBusinessIdGenerator(
    options.resolveBusinessIdPrefix || options.resolveBusinessIdSuffix
      ? {
          resolvePrefix: () => options.resolveBusinessIdPrefix?.() ?? Promise.resolve(''),
          resolveSuffix: () => options.resolveBusinessIdSuffix?.() ?? Promise.resolve(''),
        }
      : undefined,
  );

  const rfqService = new RfqService({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    eventService,
    revisionService,
    notificationService,
    salesRepAssignment,
    catalogProducts: options.catalogProducts,
    customerAccounts: options.customerAccounts,
    adminUsers: options.adminUsers,
    carts: options.carts,
    businessId: businessIdGenerator,
    resolveTaxRate: options.resolveTaxRate,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });

  const adminService = new RfqAdminService({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    rfqService,
    eventService,
    revisionService,
    notificationService,
    salesRepAssignment,
    catalogProducts: options.catalogProducts,
    customerAccounts: options.customerAccounts,
    organizations: options.organizations,
    adminUsers: options.adminUsers,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
  });

  const expiryWorker = new RfqExpiryWorker({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    eventService,
    notificationService,
    salesRepAssignment,
    adminUsers: options.adminUsers,
    resolveExpiryDays: options.resolveExpiryDays,
  });

  // US5 — the `order.created.v1` reactor. `backend.ts` registers it through
  // `ctx.subscribe`, so a switched-off module completes no quote request.
  const orderCompletionReactor = createOrderCompletionReactor({
    emFactory: options.emFactory,
    orders: options.orders,
    eventService,
    notificationService,
  });

  return {
    register: async (app: FastifyInstance): Promise<void> => {
      await registerQuoteRequestsCustomerRoutes(app, {
        rfqService,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
        ...(options.assertOrganizationCanTransact
          ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
          : {}),
      });
      await registerQuoteRequestsAdminRoutes(app, {
        adminService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
      });
      const { registerOrganizationsSalesRepRoutes } = await import(
        '../organizations/routes.sales-reps.js'
      );
      await registerOrganizationsSalesRepRoutes(app, {
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        salesRepAssignment,
      });

      // Storefront-public Quote Requests settings (FR-032 / FR-033) so the
      // storefront can show/hide "Add to quote" buttons without going through
      // the admin-gated settings endpoint. Reads through `resolveBoolSetting`,
      // supplied by `backend.ts`, which already routes the two conditions D-43
      // allows to the module default.
      //
      // The policy — a settings outage must not hide "Add to quote" — is right
      // and stays. What was wrong is that a bare `catch` answered `true` for a
      // **switched-off module** too, which Constitution XVII rule 5 forbids: a
      // module that is off contributes no storefront element. So
      // `ModuleDisabledError` is re-thrown, and anything else is reported once
      // before the fail-open, because a fail-open nobody can see is the defect
      // this whole cluster is about.
      app.get('/api/v1/storefront/settings/quote-requests', async (_request, reply) => {
        reply.header('cache-control', 'public, max-age=60');
        try {
          const card = await options.resolveBoolSetting('show_add_to_quote_on_card');
          const pdp = await options.resolveBoolSetting('show_add_to_quote_on_pdp');
          return { data: { showAddToQuoteOnCard: card, showAddToQuoteOnPdp: pdp } };
        } catch (error) {
          if (error instanceof ModuleDisabledError) throw error;
          const name = (error as { name?: string }).name ?? 'Error';
          if (!storefrontFlagWarned.has(name)) {
            storefrontFlagWarned.add(name);
            app.log.warn(
              { err: error },
              '[quote_requests] storefront flag settings unreadable — showing the ' +
                'quote affordances (logged once per condition per process)',
            );
          }
          return { data: { showAddToQuoteOnCard: true, showAddToQuoteOnPdp: true } };
        }
      });
    },
    handle: (): QuoteRequestsModuleHandle => ({
      orderCompletionReactor,
      expiryWorker,
      rfqService,
      adminService,
      salesRepAssignment,
    }),
  };
}

export type { CustomerContextResolver, AdminContextResolver, RequireCustomerGuard, FastifyRequest };
