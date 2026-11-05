import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '@endora-commerce/platform/events';
import type { AuditPort, PlatformLogger } from '@endora-commerce/platform/kernel';
import type {
  AdminUserReadPort,
  BuyerLinePricePort,
  CartWritePort,
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldListFilterPort,
  CustomFieldValuePort,
  OrderReadPort,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import { RfqService, type RfqEventBus, type RfqServiceDeps } from './services/rfq-service.js';
import { createQuoteRequestBusinessIdGenerator } from './services/quote-request-business-id-generator.js';
import { RfqAdminService } from './services/rfq-admin-service.js';
import { RfqEventService } from './services/rfq-event-service.js';
import { RfqRevisionService } from './services/rfq-revision-service.js';
import { RfqNotificationService } from './services/rfq-notification-service.js';
import { RfqExpiryWorker, type RfqExpiryRule } from './services/rfq-expiry-worker.js';
import { QuoteRequestListViewService } from './services/quote-request-list-view-service.js';
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
import { registerQuoteRequestsSalesRepRoutes } from './routes.sales-reps.js';
import { registerQuoteRequestDocumentRoutes } from './routes.document.js';
import type { QuoteRequestDocumentService } from './document/document-service.js';
import { registerQuoteRequestsNegotiationRoutes } from './routes.negotiation.js';
import type { NegotiationPolicyService } from './services/negotiation-policy-service.js';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { RequireAdminAnyFactory, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';

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
  /** Reads `quote_requests.expiry_days` for every sales channel (issue #239). */
  resolveExpiryRule: () => Promise<RfqExpiryRule>;
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
  auditLog?: AuditPort;
  /** Feature 055 — validates + reads RFQ custom-field values on the admin edit path. */
  customFieldValues?: CustomFieldValuePort;
  /** Feature 157 — the admin list's custom-field filters. */
  customFieldListFilter?: CustomFieldListFilterPort;
  /**
   * Feature 075, Phase C — the five owners this module reads, and the one it
   * writes. Each replaces an `em.find` against another module's table, which
   * deactivation cannot reach; each owner is a binding dependency of this
   * manifest, so every one of them fails closed.
   */
  catalogProducts: CatalogProductReadPort;
  /**
   * The sanctioned bridge accessor (Constitution XII), for the assortment gate
   * a quote line owes (issue #259). Kernel-registered, so it is not one of the
   * six module edges above.
   */
  channelMembership: SalesChannelMembershipPort;
  /** Feature 163 — `catalog`'s availability answer for every quote-line seam. */
  catalogAvailability: Pick<
    CatalogProductAvailabilityPort,
    'filterAvailable' | 'effectiveTexts' | 'effectivePackagingUnitNames' | 'effectiveOrderRules'
  >;
  customerAccounts: CustomerAccountReadPort;
  organizations: OrganizationDetailsPort;
  adminUsers: AdminUserReadPort;
  orders: OrderReadPort;
  /**
   * How the completion reactor looks again for an order whose commit was still
   * in flight when `order.created.v1` reached it
   * (`specs/143-crm-sales-opportunities/`, FR-104): `deferAfterCommit` runs the
   * later reads off the bus's chain in a scope of their own, and
   * `isStillPresent` is asked before each of them.
   */
  deferAfterCommit: (work: () => Promise<void>) => Promise<void>;
  isStillPresent: () => boolean;
  carts: CartWritePort;
  /**
   * Feature 146 — `price_lists`' buyer line price, the reference a quote line
   * stores at every customer write (FR-001; research R2).
   */
  buyerLinePrices: BuyerLinePricePort;
  /**
   * Feature 146, US4 — the request owner's price-negotiation lock, enforced
   * on customer create and draft edit (FR-022; research R11).
   */
  negotiationPolicy: RfqServiceDeps['negotiationPolicy'];
  /**
   * Feature 146, US4 — the lock's display read, for the admin panels and the
   * buyer's own read (coordinator ruling D-3V: never the system-scoped
   * enforcement read). Resolved per call.
   */
  negotiationDisplay: () => Pick<NegotiationPolicyService, 'displayFor'>;
  /** Feature 146, US4 — the audited path of the two policy writes (Principle XIII). */
  commandBus: Pick<CommandBus, 'run'>;
  /** Feature 146, US4 — the any-of gate the policy reads open with (`customers:read` or `customers:manage`). */
  requireAdminAny: RequireAdminAnyFactory;
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
  /**
   * Feature 153 — the quote PDF's service (choices, remembered template,
   * download, e-mail), resolved when the routes are mounted. Absent: the four
   * quote PDF routes are not registered.
   */
  documentService?: () => QuoteRequestDocumentService;
  /**
   * The module's logger. The saved-view service writes its actor-≠-owner trail
   * through it (`specs/147-saved-views/` research R-18, S-11).
   */
  log?: PlatformLogger;
  /**
   * `organizations`' permission port, resolved per call
   * (`specs/170-organization-roles/`): the customer routes' guards (FR-040)
   * and the *Administrator*-only Organization-wide visibility (R-30).
   */
  organizationPermissions: () => OrganizationPermissionPort;
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
  // `specs/147-saved-views/` (US3) — the Quote Request list's saved views.
  const listViewService = new QuoteRequestListViewService(options.emFactory, options.log);
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
    channelMembership: options.channelMembership,
    catalogAvailability: options.catalogAvailability,
    customerAccounts: options.customerAccounts,
    adminUsers: options.adminUsers,
    carts: options.carts,
    buyerLinePrices: options.buyerLinePrices,
    negotiationPolicy: options.negotiationPolicy,
    businessId: businessIdGenerator,
    resolveTaxRate: options.resolveTaxRate,
    organizationPermissions: options.organizationPermissions,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
    ...(options.log ? { log: options.log } : {}),
  });

  const adminService = new RfqAdminService({
    emFactory: options.emFactory,
    channelMembership: options.channelMembership,
    events: options.eventBus as RfqEventBus,
    rfqService,
    eventService,
    revisionService,
    notificationService,
    salesRepAssignment,
    catalogProducts: options.catalogProducts,
    catalogAvailability: options.catalogAvailability,
    customerAccounts: options.customerAccounts,
    organizations: options.organizations,
    adminUsers: options.adminUsers,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.customFieldValues ? { customFieldValues: options.customFieldValues } : {}),
    ...(options.customFieldListFilter ? { customFieldListFilter: options.customFieldListFilter } : {}),
  });

  const expiryWorker = new RfqExpiryWorker({
    emFactory: options.emFactory,
    events: options.eventBus as RfqEventBus,
    eventService,
    notificationService,
    salesRepAssignment,
    adminUsers: options.adminUsers,
    resolveExpiryRule: options.resolveExpiryRule,
  });

  // US5 — the `order.created.v1` reactor. `backend.ts` registers it through
  // `ctx.subscribe`, so a switched-off module completes no quote request.
  const orderCompletionReactor = createOrderCompletionReactor({
    emFactory: options.emFactory,
    orders: options.orders,
    eventService,
    notificationService,
    defer: options.deferAfterCommit,
    stillPresent: options.isStillPresent,
  });

  return {
    register: async (app: FastifyInstance): Promise<void> => {
      await registerQuoteRequestsCustomerRoutes(app, {
        rfqService,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
        organizationPermissions: options.organizationPermissions,
        ...(options.assertOrganizationCanTransact
          ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
          : {}),
      });
      await registerQuoteRequestsAdminRoutes(app, {
        adminService,
        requireAdmin: options.requireAdmin,
        resolveAdminContext: options.resolveAdminContext,
        listViewService,
      });
      // D-166 — this module's one endpoint of the sales-rep pair, in this
      // module's own file. It used to `import()` `organizations`' route file
      // and register all four of its endpoints, which is what put a
      // `quote_requests` gate on the assignment screen and an entry in each
      // module's cross-module-import shard. The three endpoints that qualify an
      // organisation are registered by `organizations` from its own
      // `backend.ts` now, under a code that module declares.
      // Feature 146, US4 — the price-negotiation lock's controls and the
      // buyer's own read (`contracts/price-negotiation-api.md` §1 – §3).
      await registerQuoteRequestsNegotiationRoutes(app, {
        emFactory: options.emFactory,
        commandBus: options.commandBus,
        requireAdmin: options.requireAdmin,
        requireAdminAny: options.requireAdminAny,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
        customerAccounts: options.customerAccounts,
        organizations: options.organizations,
        salesRepAssignment,
        negotiationPolicy: options.negotiationDisplay,
      });
      if (options.documentService) {
        await registerQuoteRequestDocumentRoutes(app, {
          service: options.documentService(),
          requireAdmin: options.requireAdmin,
          resolveAdminContext: options.resolveAdminContext,
        });
      }
      await registerQuoteRequestsSalesRepRoutes(app, {
        emFactory: options.emFactory,
        requireAdmin: options.requireAdmin,
        salesRepAssignment,
        organizations: options.organizations,
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
