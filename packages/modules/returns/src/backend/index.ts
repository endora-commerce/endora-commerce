import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  RETURN_CASE_CREATED_EVENT,
  supportedLanguageOf,
  type CustomerAccountAnonymizedEventV1,
} from '@endora-commerce/contracts';
import { ReturnErasureService } from './services/return-erasure-service.js';
import {
  RETURNS_ERASURE_SCOPE_REASON,
  RETURNS_UPLOAD_SWEEP_SCOPE_REASON,
  startReturnsMaintenance,
  type ReturnsMaintenanceJobDeps,
} from './workers/returns-maintenance-worker.js';
import type {
  AdminI18nTranslatePort,
  AdminNotificationRecordPort,
  AdminUserReadPort,
  CatalogProductAvailabilityPort,
  ObjectStoragePort,
  ReturnCaseCreatedEventV1,
  TransactionalEmailStatePort,
  CorrectiveInvoicePort,
  CreditTopupPort,
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  EmailMailerPort,
  OrderReadPort,
  OrderReturnContextPort,
  OrganizationDetailsPort,
  OrganizationPermissionPort,
  PaymentRefundPort,
  PermissionReadPort,
  ReturnRefundReadPort,
  SettingWriteValidatorRegistryPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { configuredAdminBaseUrl, effectiveState, lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { returnsModule, type ReturnsModuleOptions } from './plugin.js';
import { ReturnEmailNotifier } from './services/return-email-notifier.js';
import { ReturnRefundReadService } from './services/return-refund-read-service.js';
import { createReturnsTimeZoneValidator } from './services/time-zone-validator.js';
import {
  createChannelLanguageResolver,
  createCustomerEmailResolver,
} from './services/notification-context.js';
import {
  RETURN_AUTHORIZED_DEFAULT,
  RETURN_COMMENT_ADDED_DEFAULT,
  RETURN_NEW_CASE_DEFAULT,
  RETURN_REJECTED_DEFAULT,
  RETURN_STATUS_ENTERED_DEFAULT,
  RETURN_SUBMITTED_DEFAULT,
} from './email-templates/transactional-defaults.js';
import { RETURNS_DEFAULT_TIME_ZONE, RETURNS_SETTING_CODES } from '../manifest.js';
import { isKnownTimeZone } from './services/time-zone-validator.js';
import { createAdminBell } from './services/notifications/admin-bell.js';
import { ReturnsNotificationDispatch, type ReturnsNotificationJob } from './services/notifications/dispatch.js';
import { createNewCaseRecipientResolver } from './services/notifications/recipients.js';
import { createNotificationStore } from './services/notifications/store.js';
import {
  createReturnsNotificationProducer,
  returnsNotificationProcessor,
  startReturnsNotifications,
  type ReturnsNotificationJobLike,
  type ReturnsNotificationProducer,
} from './workers/returns-notifications-worker.js';
import { Refund } from './entities/refund.entity.js';
import { ReturnCaseAttachment } from './entities/return-case-attachment.entity.js';
import { ReturnCaseClause } from './entities/return-case-clause.entity.js';
import { ReturnCaseComment } from './entities/return-case-comment.entity.js';
import { ReturnCaseItem } from './entities/return-case-item.entity.js';
import { ReturnCase } from './entities/return-case.entity.js';
import { ReturnDeliveryMethod } from './entities/return-delivery-method.entity.js';
import { ReturnListSavedView } from './entities/return-list-saved-view.entity.js';
import { ReturnReason } from './entities/return-reason.entity.js';
import { ReturnShipment } from './entities/return-shipment.entity.js';
import { ReturnStatusTransition } from './entities/return-status-transition.entity.js';
import { ReturnStatus } from './entities/return-status.entity.js';
import { ReturnWithdrawalStatement } from './entities/return-withdrawal-statement.entity.js';

/**
 * `returns` — four settlement ports and a dead callback (feature 072, wave 2,
 * T109).
 *
 * The settlement ports are the interesting part. Authorising a return can move
 * money four ways — refund a payment, issue a corrective invoice, top up a
 * credit limit, and read the order it came from — and each is a port its owning
 * module publishes: `orderReturnContextPort`, `paymentRefundPort`,
 * `correctiveInvoicePort` and `creditTopupPort`.
 *
 * **T118c retired the bridge that used to carry them.** They arrived as one
 * `returnsBridge` object a composition root assembled, on the argument that a
 * composition supplies all of them or none. That argument was about the days
 * when the four were *adapters a root constructed*; since T143c each has been a
 * forwarder onto its owner's port, and forwarding through a root left the edge
 * undeclared — `payments`, `invoices` and `credit_limits` appeared in no
 * manifest of this module's, so nothing could tell an operator what switching
 * one of them off costs. This module resolves the four itself now and says so in
 * its manifest. The bridge's other four members went the same way: the two actor
 * resolvers are the platform's own contributions, and the address and the
 * language are in `services/notification-context.ts`.
 *
 * **`exposeServices` is deleted rather than converted.** It was a callback for
 * handing the transition services back to a composition — declared, called, and
 * supplied by nobody. Its comment said "e.g. for settlement guards", which is a
 * use that never arrived. A conversion is the right moment to notice that: the
 * option survived because reading a factory's signature does not tell you
 * whether anything passes a given argument, and the container makes that
 * visible by refusing to register a name nothing provides.
 *
 * `auditLog` stops being optional. FR-041 requires status changes *and*
 * settlement to be recorded, and settlement is where the money moved.
 */

/**
 * What this module reads out of the composition, now that `returnsBridge` is
 * gone (`specs/110-instance-repository/` T118c).
 *
 * The bridge held eight members and none of them was a composition's answer to
 * give. The four settlement adapters are the ports `orders`, `payments`,
 * `invoices` and `credit_limits` publish, resolved below with `lazyPort`; the
 * recipient's address is `customer_accounts`' published record; the channel's
 * language is a read of the platform's own entity. What is left here is the pair
 * only a composition can answer — *who is asking* — and both are names the
 * platform contributes for every module that takes one (`compose-app.ts`, the
 * actor-shaped nine of T118b), not a shape this module invents.
 */
export interface ReturnsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditPort;
  /** The platform's Command Bus: the consent writes run through it (issue #905). */
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: ReturnsModuleOptions['settingsService'];
  /**
   * How this composition names the calling customer, for the customer-facing RMA
   * routes. It asserts a customer session and nothing more — a return is
   * submitted by an account with or without an Organization, which is why this is
   * `customerAccountIdResolver` and not `customerContextResolver`.
   */
  readonly customerAccountIdResolver: ReturnsModuleOptions['resolveCustomerAccountId'];
  /** How this composition names the acting admin; root-shaped, like the above. */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  /**
   * `transactional_emails`' late-bound sender, read per send. It answers
   * `undefined` until that module announces it, which is later than this module
   * composes — the reason it is an accessor rather than the sender itself.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** The factory returns a bare plugin, not a `{ plugin, handle }` pair. */
  readonly returns: ReturnType<typeof returnsModule>;
  // --- Notifications (`specs/180-off-platform-complaints/` research R-2) ---
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  /** Where a customer's case page lives: `<storefrontBaseUrl>/returns/<id>` (R-5). */
  readonly storefrontBaseUrl: string;
  readonly returnsNotificationProducer: ReturnsNotificationProducer;
  readonly returnsNotificationDispatch: ReturnsNotificationDispatch;
  readonly returnsNotificationProcessor: (job: ReturnsNotificationJobLike) => Promise<unknown>;
  // --- Erasure and maintenance (180 research R-15) ---
  readonly returnsErasureService: ReturnErasureService;
  readonly returnsMaintenanceDeps: ReturnsMaintenanceJobDeps;
}

/**
 * Hand one notification job to the queue after the write it announces committed
 * (`specs/180-off-platform-complaints/` research R-2). A failure to enqueue is
 * logged and goes no further: the action it follows has already been answered
 * (FR-A50). This is the accepted loss window R-2 states.
 */
function enqueueAfterCommit(
  ctx: ModuleContext,
  producer: () => ReturnsNotificationProducer,
): (job: ReturnsNotificationJob) => Promise<void> {
  return async (job) => {
    try {
      await producer().enqueue(job);
    } catch (error) {
      ctx.log.warn(
        { kind: job.kind, error: error instanceof Error ? error.message : String(error) },
        '[returns] a notification job could not be enqueued',
      );
    }
  };
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    returns: ctx
      .asFunction(({ emFactory, eventBus, auditLogService, commandBus }: ReturnsCradle) => {
        const cradle = (): ReturnsCradle => ctx.cradle<ReturnsCradle>();
        /**
         * The customer notification, built here rather than handed in (T143c).
         *
         * It is this module's own class, and a root that constructs its own
         * class builds it slightly differently in each root — which is what
         * happened: the two spellings differed in the mailer they passed and in
         * nothing that made the difference visible. The mailer is resolved per
         * send, so a composition that contributes one later (the harness does)
         * is not a race, and the sender accessor stays late-bound because
         * `transactional_emails` announces it after this module composes.
         *
         * T118c — its two remaining inputs are this module's own now. The
         * address comes from `customer_accounts`' published record and the
         * language from the case's channel; both were `returnsBridge` closures a
         * root wrote twice, and both live in `services/notification-context.ts`
         * so the mapping and its fallbacks are testable with nothing composed.
         */
        const notifier = new ReturnEmailNotifier(
          lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
          createCustomerEmailResolver(
            lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          ),
          {
            getTransactionalEmailSender: () => cradle().transactionalEmailSenderAccessor(),
            resolveLanguage: createChannelLanguageResolver(emFactory),
          },
        );
        return returnsModule({
          emFactory,
          eventBus,
          log: ctx.log,
          auditLog: auditLogService,
          settingsService: lazyPort<ReturnsModuleOptions['settingsService']>(
            ctx,
            'settingsReadPort',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            cradle().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) => cradle().requireCustomer(req, reply),
          resolveCustomerAccountId: (req) => cradle().customerAccountIdResolver(req),
          resolveAdminUserId: (req) => cradle().adminContextResolver(req).adminUserId,
          // The four settlement adapters, resolved here since T118c. Each was a
          // forwarder a composition root built onto the owning module's port and
          // handed over as a `returnsBridge` member, which meant the edge into
          // `payments`, `invoices` and `credit_limits` appeared in no manifest:
          // a root's resolution is nobody's declared dependency, so an operator
          // switching one of the three off was told nothing about what stops.
          // The `lazyPort` proxy resolves per call, so the gate still answers at
          // the settlement it is about rather than at composition.
          orderContext: lazyPort<OrderReturnContextPort>(ctx, 'orderReturnContextPort'),
          // `specs/170-organization-roles/` OR-11 (research R-41). `orders`'
          // customer-scoped reader judges the order a return is started from,
          // and `organizations`' permission port the two `returns` codes. Both
          // are `lazyPort` proxies resolved per call, never captured.
          orderReadPort: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          organizationPermissions: lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort'),
          // Issue #905 — whether a return is a consumer withdrawal turns on the
          // Organization being personal, and so does whether a withdrawal refunds
          // the delivery and the surcharge (issue #876); `organizations` is a
          // binding dependency and `nonDeactivatable`.
          organizationDetails: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          commandBus,
          paymentRefund: lazyPort<PaymentRefundPort>(ctx, 'paymentRefundPort'),
          correctiveInvoice: lazyPort<CorrectiveInvoicePort>(ctx, 'correctiveInvoicePort'),
          creditTopup: lazyPort<CreditTopupPort>(ctx, 'creditTopupPort'),
          notifier,
          // `specs/180-off-platform-complaints/` research R-2: filing, a notifying
          // comment and a transition into a marked status each enqueue a job.
          enqueueNotification: enqueueAfterCommit(ctx, () => cradle().returnsNotificationProducer),
          adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          // 180 phase B — a no-order line's product (R-17) and the attachments' bytes
          // (R-12). Both owners are non-deactivatable.
          catalog: lazyPort<CatalogProductAvailabilityPort>(ctx, 'catalogProductAvailabilityPort'),
          objectStorage: lazyPort<ObjectStoragePort>(ctx, 'objectStoragePort'),
          // 180 D-11 — the confirmation e-mail's state, from its owner (a binding dependency).
          emailState: lazyPort<TransactionalEmailStatePort>(ctx, 'transactionalEmailStatePort'),
          // The CSV export's wording, from this module's own bundle in the
          // request's language (`_i18n`, non-deactivatable).
          translate: (key, language) =>
            lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService').translate(
              'returns',
              key,
              supportedLanguageOf(language),
            ),
        });
      })
      .singleton(),
  });

  ctx.routes(async (app) => {
    await ctx.cradle<ReturnsCradle>().returns(app);
  });

  // --- Notifications (`specs/180-off-platform-complaints/` research R-2 – R-5) -----
  // The four e-mails and the bell, sent from the `returns-notifications` queue. The
  // producer is built on the host's queue connection (none on the shared test
  // server, which enqueues nothing); the dispatch is the worker's body, and the
  // processor is it inside the system scope — what the worker runs, and what a test
  // drives. Modelled on `forms`' notifications.
  ctx.di.register({
    returnsNotificationProducer: ctx
      .asFunction(({ moduleQueueRedis }: ReturnsCradle) => createReturnsNotificationProducer(moduleQueueRedis))
      .singleton(),
    returnsNotificationDispatch: ctx
      .asFunction(({ emFactory, storefrontBaseUrl }: ReturnsCradle) => {
        const settings = lazyPort<ReturnsModuleOptions['settingsService']>(ctx, 'settingsReadPort');
        return new ReturnsNotificationDispatch({
          isPresent: () => effectiveState.isPresent('returns'),
          store: createNotificationStore(emFactory),
          sender: () => ctx.cradle<ReturnsCradle>().transactionalEmailSenderAccessor(),
          customers: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          language: createChannelLanguageResolver(emFactory),
          // The zone the filing date is shown in; an unknown value falls back to the
          // manifest default, as the return windows do.
          timeZone: async (salesChannelId) => {
            try {
              const value = await settings.get(RETURNS_SETTING_CODES.TIME_ZONE, salesChannelId, z.string());
              return isKnownTimeZone(value) ? value : RETURNS_DEFAULT_TIME_ZONE;
            } catch {
              return RETURNS_DEFAULT_TIME_ZONE;
            }
          },
          newCaseRecipients: createNewCaseRecipientResolver({ settings }),
          bell: createAdminBell({
            // `degrades-without` (R-3): asked first, never caught as a refusal.
            isPresent: () => effectiveState.isPresent('admin_notifications'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            notifications: lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort'),
          }),
          storefrontBaseUrl,
          adminBaseUrl: configuredAdminBaseUrl(),
          log: (message, context) => ctx.log.warn(context, message),
        });
      })
      .singleton(),
    returnsNotificationProcessor: ctx
      .asFunction(({ returnsNotificationDispatch }: ReturnsCradle) =>
        returnsNotificationProcessor(returnsNotificationDispatch),
      )
      .singleton(),
  });

  // Every filed case asks for its notifications (`specs/180-off-platform-complaints/`
  // T060, research R-2): `return_case.created.v1` is dispatched by the bus after the
  // `return_case.create` Command commits — a refused filing emits nothing. A failure to
  // enqueue is logged and never reaches the customer, whose answer was already written.
  // `ctx.subscribe` stops it with the module.
  ctx.subscribe(RETURN_CASE_CREATED_EVENT, (payload) =>
    enqueueAfterCommit(ctx, () => ctx.cradle<ReturnsCradle>().returnsNotificationProducer)({
      kind: 'case_submitted',
      returnCaseId: (payload as ReturnCaseCreatedEventV1).returnCaseId,
    }),
  );

  // The consumer: attached where `app.log` exists and through `ctx.worker`, which
  // stops it with the module and puts back a job taken while it is off. Built only
  // where the host says this process consumes queues and offers a connection.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<ReturnsCradle>();
    app.addHook('onClose', () => cradle.returnsNotificationProducer.close());
    startReturnsNotifications({
      dispatch: cradle.returnsNotificationDispatch,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
    });
  });
  // --- end of Notifications -----------------------------------------------------------

  // --- Erasure and the maintenance clock (`specs/180-off-platform-complaints/` R-15) ---
  // The anonymisation erases the cases' personal data at once; the daily
  // `returns-maintenance` tick deletes unclaimed uploads and catches an anonymisation
  // missed while the module was off. Both stop with the module (`ctx.subscribe`,
  // `ctx.worker`).
  ctx.di.register({
    returnsErasureService: ctx
      .asFunction(
        ({ emFactory, commandBus }: ReturnsCradle) =>
          new ReturnErasureService({
            emFactory,
            commandBus,
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            storage: lazyPort<ObjectStoragePort>(ctx, 'objectStoragePort'),
          }),
      )
      .singleton(),
    returnsMaintenanceDeps: ctx
      .asFunction(
        ({ returnsErasureService }: ReturnsCradle): ReturnsMaintenanceJobDeps => ({
          isPresent: () => effectiveState.isPresent('returns'),
          uploads: {
            scopeReason: RETURNS_UPLOAD_SWEEP_SCOPE_REASON,
            hasWork: async () => true,
            run: (now) => returnsErasureService.sweepExpiredUploads(now),
          },
          erasure: {
            scopeReason: RETURNS_ERASURE_SCOPE_REASON,
            hasWork: () => returnsErasureService.hasWork(),
            run: () => returnsErasureService.reconcile(),
          },
          log: ctx.log,
        }),
      )
      .singleton(),
  });

  ctx.subscribe(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, async (payload) => {
    const { customerAccountId } = payload as CustomerAccountAnonymizedEventV1;
    await ctx.cradle<ReturnsCradle>().returnsErasureService.eraseForAccount(customerAccountId);
  });

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<ReturnsCradle>();
    await startReturnsMaintenance({
      deps: cradle.returnsMaintenanceDeps,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });
  // --- end of Erasure and maintenance --------------------------------------------------

  /**
   * What an order's settled return cases refunded (issue #428), for the invoice
   * that states what was paid for the order: a refund an operator transferred
   * by hand, or a credit-limit top-up, never passes through `payments`.
   */
  ctx.di.providePort<ReturnRefundReadPort>(
    'returnRefundReadPort',
    ctx.asFunction(({ emFactory }: ReturnsCradle) => new ReturnRefundReadService(emFactory)).singleton(),
  );

  /**
   * The default subject and content for the 6 transactional emails this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('return_authorized', RETURN_AUTHORIZED_DEFAULT, 'returns');
    defaults.register('return_rejected', RETURN_REJECTED_DEFAULT, 'returns');
    defaults.register('return_new_case', RETURN_NEW_CASE_DEFAULT, 'returns');
    defaults.register('return_submitted', RETURN_SUBMITTED_DEFAULT, 'returns');
    defaults.register('return_comment_added', RETURN_COMMENT_ADDED_DEFAULT, 'returns');
    defaults.register('return_status_entered', RETURN_STATUS_ENTERED_DEFAULT, 'returns');
  });

  /**
   * `returns.time_zone` must be a zone the runtime knows (issue #905) — a
   * **contribution** into `settings`' validator registry, which filters
   * contributors by presence when it is read, so the hook carries no probe.
   */
  ctx.onBoot(() => {
    lazyPort<SettingWriteValidatorRegistryPort>(ctx, 'settingWriteValidatorRegistry').register(
      createReturnsTimeZoneValidator(),
    );
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  Refund,
  ReturnCaseAttachment,
  ReturnCaseClause,
  ReturnCaseComment,
  ReturnCaseItem,
  ReturnCase,
  ReturnDeliveryMethod,
  ReturnListSavedView,
  ReturnReason,
  ReturnShipment,
  ReturnStatusTransition,
  ReturnStatus,
  ReturnWithdrawalStatement,
];
