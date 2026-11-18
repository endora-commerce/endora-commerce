import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type {
  AdminUserReadPort,
  CatalogProductAvailabilityPort,
  CorrectiveInvoicePort,
  ObjectStoragePort,
  TransactionalEmailStatePort,
  CreditTopupPort,
  OrderReadPort,
  OrderReturnContextPort,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
  PaymentRefundPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { PlatformLogger, SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { RETURNS_SETTING_CODES, RETURNS_DEFAULT_TIME_ZONE } from '../manifest.js';
import { isKnownTimeZone } from './services/time-zone-validator.js';
import { ReturnStatusGraphService } from './services/return-status-graph-service.js';
import { ReturnTransitionService } from './services/return-transition-service.js';
import { ReturnCaseService, organizationWasConsumerAt } from './services/return-case-service.js';
import { ReturnCaseScope } from './services/return-case-scope.js';
import { ReturnCommentService } from './services/return-comment-service.js';
import { ReturnSettlementService } from './services/return-settlement-service.js';
import { ReturnConsentService } from './services/return-consent-service.js';
import { ReturnDeliveryMethodService } from './services/return-delivery-method-service.js';
import { ReturnShipmentService } from './services/return-shipment-service.js';
import { ReturnReasonService } from './services/return-reason-service.js';
import { ReturnAttachmentService } from './services/return-attachment-service.js';
import { ReturnClauseService } from './services/return-clause-service.js';
import { dayIn } from './services/case-lines.js';
import { RETURN_ATTACHMENT_LIMITS } from '@endora-commerce/contracts';
import { ReturnsSeeder } from './services/returns-seeder.js';
import { ReturnListService } from './services/return-list-service.js';
import { ReturnListViewService } from './services/return-list-view-service.js';
import { ReturnExportService } from './services/return-export-service.js';
import { ReturnAuthorizationService } from './services/return-authorization-service.js';
import type { ReturnNotifier } from './services/return-transition-service.js';
import type { ReturnsNotificationJob } from './services/notifications/dispatch.js';
import { newCaseRecipientHealth } from './services/notifications/health.js';
import { createNewCaseRecipientResolver } from './services/notifications/recipients.js';
import { createRmaNumberGenerator } from './services/rma-number-generator.js';
import { registerReturnsCustomerRoutes } from './routes.customer.js';
import { registerReturnsAdminRoutes } from './routes.admin.js';

/** Default free-return window when the setting cannot be resolved (manifest default). */
const DEFAULT_FREE_RETURN_DAYS = 14;

export interface ReturnsModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  settingsService: SettingsReadPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  resolveAdminUserId: (req: FastifyRequest) => string;
  orderContext: OrderReturnContextPort;
  /**
   * `orders`' customer-scoped order reader: the order a buyer starts a return
   * from must be one they may read (`specs/170-organization-roles/` FR-054).
   */
  orderReadPort: OrderReadPort;
  /**
   * `organizations`' permission port, a `lazyPort` proxy resolved per call:
   * `returns.create` gates opening a case, `returns.view_organization` widens
   * the buyer's case list and read (`specs/170-organization-roles/` OR-11).
   */
  organizationPermissions: OrganizationPermissionPort;
  /**
   * `organizations`' record reader, a `lazyPort` proxy resolved per call:
   * whether a return is a consumer withdrawal turns on the Organization being
   * personal (issue #905), and so does whether a withdrawal refunds the
   * delivery and the surcharge (issue #876).
   */
  organizationDetails: Pick<OrganizationDetailsPort, 'findById'>;
  /** The Command Bus the consent writes run through (issue #905, Principle XIII). */
  commandBus: Pick<CommandBus, 'run'>;
  /** Settlement ports (US5). Money refunds, corrective invoices, credit top-up. */
  paymentRefund: PaymentRefundPort;
  correctiveInvoice: CorrectiveInvoicePort;
  creditTopup: CreditTopupPort;
  /** Audit-log writer (FR-041); status changes + settlement are recorded. */
  auditLog: AuditPort;
  /** Best-effort customer notifications on authorize/reject. */
  notifier?: ReturnNotifier;
  /**
   * `specs/180-off-platform-complaints/` research R-2 — hand a notification job to
   * the `returns-notifications` queue after the write it announces committed. Never
   * throws (a failure to enqueue is logged by the composition). Absent: nothing is
   * enqueued.
   */
  enqueueNotification?: (job: ReturnsNotificationJob) => Promise<void>;
  /**
   * `admin_users`' reader: who authorized a case, named at read
   * (`specs/180-off-platform-complaints/` FR-A41).
   */
  adminUsers: Pick<AdminUserReadPort, 'findByIds'>;
  /** A sentence of this module's bundle in a language (the CSV export, 180 FR-A41). */
  translate: (key: string, language: string) => Promise<string>;
  /** `catalog`'s availability and texts: a no-order line's product (180 research R-17). */
  catalog: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveTexts'>;
  /** `assets_library`'s object store: the attachments' bytes (180 research R-12). */
  objectStorage: Pick<ObjectStoragePort, 'getActive' | 'getForBackend'>;
  /** `transactional_emails`' state read: is the confirmation e-mail on (180 D-11)? */
  emailState: Pick<TransactionalEmailStatePort, 'isActive'>;
  /**
   * The module's logger. The saved-view service writes its actor-≠-owner trail
   * through it (`specs/147-saved-views/` research R-18, S-11; #312).
   */
  log?: PlatformLogger;
}

/**
 * Composition root for the returns module (feature 046). Builds the workflow
 * engine, RMA numbering, and the case + authorization services, then registers
 * the customer (US1) and admin (US2/US3) routes. Returns a Fastify plugin in
 * the `module(options) => async (app) => {}` shape used across the codebase.
 */
export function returnsModule(
  options: ReturnsModuleOptions,
): (app: FastifyInstance) => Promise<void> {
  return async (app: FastifyInstance): Promise<void> => {
  const { emFactory, eventBus, settingsService, orderContext } = options;

  // Self-healing default seed (no-op when the migration already seeded).
  await new ReturnsSeeder(emFactory).ensureDefaults();

  const graphService = new ReturnStatusGraphService(emFactory, options.auditLog);

  const rmaGenerator = createRmaNumberGenerator({
    resolvePrefix: (sc) =>
      settingsService.get(RETURNS_SETTING_CODES.RMA_NUMBER_PREFIX, sc, z.string()),
    resolveSuffix: (sc) =>
      settingsService.get(RETURNS_SETTING_CODES.RMA_NUMBER_SUFFIX, sc, z.string()),
  });

  // Entering `authorized` or `rejected` has its dedicated effects on every path
  // (`specs/180-off-platform-complaints/` research R-7.3): the transition owns the
  // RMA number, the authorizer and the dedicated e-mail.
  const transitions = new ReturnTransitionService(emFactory, eventBus, graphService, options.auditLog, {
    rmaGenerator,
    ...(options.notifier ? { notifier: options.notifier } : {}),
    ...(options.enqueueNotification ? { enqueueNotification: options.enqueueNotification } : {}),
  });

  const resolveFreeReturnDays = async (salesChannelId: string): Promise<number> => {
    try {
      return await settingsService.get(
        RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
        salesChannelId,
        z.number(),
      );
    } catch {
      return DEFAULT_FREE_RETURN_DAYS;
    }
  };

  // Issue #905 — the zone the windows count calendar days in. A value the
  // runtime does not know (written around the validator, straight into the
  // table) falls back to the manifest default rather than refusing every return.
  const resolveTimeZone = async (salesChannelId: string): Promise<string> => {
    try {
      const value = await settingsService.get(RETURNS_SETTING_CODES.TIME_ZONE, salesChannelId, z.string());
      return isKnownTimeZone(value) ? value : RETURNS_DEFAULT_TIME_ZONE;
    } catch {
      return RETURNS_DEFAULT_TIME_ZONE;
    }
  };

  // 180 FR-B01, FR-B21 — the channel's no-order toggles; off when unreadable.
  const readFlag = async (code: string, salesChannelId: string): Promise<boolean> => {
    try {
      return await settingsService.get(code, salesChannelId, z.boolean());
    } catch {
      return false;
    }
  };

  const resolveDefaultCostBearer = async (salesChannelId: string): Promise<'customer' | 'shop'> => {
    try {
      const value = await settingsService.get(
        RETURNS_SETTING_CODES.DEFAULT_COST_BEARER_OUTSIDE_WINDOW,
        salesChannelId,
        z.enum(['customer', 'shop']),
      );
      return value;
    } catch {
      return 'customer';
    }
  };

  // Issue #876 — a consumer (B2C) is a personal Organization; an order without one is not a consumer's.
  // `specs/177-tax-id-scope/` FR-040 — given the order's placement time, an Organization converted
  // to a company after it still counts as the consumer it was.
  const isPersonalOrganization = async (organizationId: string | null, placedAt?: Date): Promise<boolean> => {
    if (!organizationId) return false;
    const organization = await options.organizationDetails.findById(organizationId);
    return placedAt ? organizationWasConsumerAt(organization, placedAt) : (organization?.isPersonal ?? false);
  };

  const caseScope = new ReturnCaseScope(options.organizationPermissions);
  const attachmentService = new ReturnAttachmentService({
    emFactory,
    storage: options.objectStorage,
    commandBus: options.commandBus,
    graphService,
    scope: caseScope,
  });

  const clauseService = new ReturnClauseService({ emFactory, commandBus: options.commandBus });

  const caseService = new ReturnCaseService({
    emFactory,
    graphService,
    transitions,
    orderContext,
    orderRead: options.orderReadPort,
    scope: caseScope,
    attachments: attachmentService,
    clauses: clauseService,
    organizationDetails: options.organizationDetails,
    resolveFreeReturnDays,
    isPersonalOrganization,
    resolveTimeZone,
    adminUsers: options.adminUsers,
    commandBus: options.commandBus,
    catalog: options.catalog,
    offPlatformFlags: {
      enabled: (sc) => readFlag(RETURNS_SETTING_CODES.OFF_PLATFORM_COMPLAINTS_ENABLED, sc),
      proofOfPurchaseRequired: (sc) => readFlag(RETURNS_SETTING_CODES.PROOF_OF_PURCHASE_REQUIRED, sc),
    },
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });

  const deliveryMethodService = new ReturnDeliveryMethodService({
    emFactory,
    graphService,
    resolveDefaultCostBearer,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });

  const shipmentService = new ReturnShipmentService({
    emFactory,
    transitions,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });
  const reasonService = new ReturnReasonService(emFactory, options.auditLog);
  const listService = new ReturnListService({ emFactory, graphService, transitions, adminUsers: options.adminUsers });
  const listViewService = new ReturnListViewService(emFactory, options.log);
  const exportService = new ReturnExportService(listService);

  const authorizationService = new ReturnAuthorizationService({ emFactory, transitions });

  const commentService = new ReturnCommentService({
    emFactory,
    graphService,
    ...(options.enqueueNotification ? { enqueueNotification: options.enqueueNotification } : {}),
  });

  const settlementService = new ReturnSettlementService({
    emFactory,
    events: eventBus,
    transitions,
    graphService,
    paymentRefund: options.paymentRefund,
    correctiveInvoice: options.correctiveInvoice,
    creditTopup: options.creditTopup,
    orderContext,
    isPersonalOrganization,
    resolveTimeZone,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });
  const consentService = new ReturnConsentService({ commandBus: options.commandBus, graphService });

  await registerReturnsCustomerRoutes(app, {
    caseService,
    commentService,
    deliveryMethodService,
    reasonService,
    attachmentService,
    requireCustomer: options.requireCustomer,
    resolveCustomerAccountId: options.resolveCustomerAccountId,
    organizationPermissions: () => options.organizationPermissions,
    // 180 §C1 (research R-21): the toggles, whether the confirmation is on (D-11), the
    // shop's day (D-12), the clauses `filing` will expect (D-1) and the limits.
    formConfig: async ({ salesChannelId, language, kind, orderId, customer }) => {
      const consumerWithdrawal = await caseService.consumerWithdrawalFor(kind, orderId, customer);
      const [offPlatformComplaintsEnabled, proofOfPurchaseRequired, confirmationEmailEnabled, timeZone, clauses] =
        await Promise.all([
          readFlag(RETURNS_SETTING_CODES.OFF_PLATFORM_COMPLAINTS_ENABLED, salesChannelId),
          readFlag(RETURNS_SETTING_CODES.PROOF_OF_PURCHASE_REQUIRED, salesChannelId),
          options.emailState.isActive('return_submitted'),
          resolveTimeZone(salesChannelId),
          clauseService.forForm({ salesChannelId, kind, consumerWithdrawal, language }),
        ]);
      return {
        offPlatformComplaintsEnabled,
        proofOfPurchaseRequired,
        confirmationEmailEnabled,
        today: dayIn(new Date(), timeZone),
        clauses,
        attachmentLimits: {
          maxFileBytes: RETURN_ATTACHMENT_LIMITS.maxFileBytes,
          maxSubmissionBytes: RETURN_ATTACHMENT_LIMITS.maxSubmissionBytes,
          maxFilesPerCase: RETURN_ATTACHMENT_LIMITS.maxFilesPerCase,
          acceptedMimeTypes: [...RETURN_ATTACHMENT_LIMITS.acceptedMimeTypes],
        },
      };
    },
  });

  await registerReturnsAdminRoutes(app, {
    caseService,
    authorizationService,
    commentService,
    settlementService,
    consentService,
    deliveryMethodService,
    shipmentService,
    reasonService,
    listService,
    listViewService,
    exportService,
    transitions,
    graphService,
    translate: options.translate,
    attachmentService,
    clauseService,
    notificationHealth: () =>
      newCaseRecipientHealth({
        emFactory,
        recipients: createNewCaseRecipientResolver({ settings: settingsService }),
      }),
    requireAdmin: options.requireAdmin,
    resolveAdminUserId: options.resolveAdminUserId,
  });
  };
}
