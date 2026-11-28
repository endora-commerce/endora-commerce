import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import {
  RELATED_PAYERS_HOOKABLE_ACTIONS,
  RELATED_PAYERS_SETTING_CODES,
  relatedPayerApprovalModeSchema,
  relatedPayerDailyRequestLimitSchema,
  relatedPayerRequestTtlDaysSchema,
  relatedPayerUnregisteredModeSchema,
  type AddressReadPort,
  type AdminNotificationRecordPort,
  type CustomerNotificationRecordPort,
  type OrganizationDetailsPort,
  type OrganizationPermissionPort,
  type OrganizationRestrictionPort,
  type CreditAvailabilityReadPort,
  type CustomerAccountReadPort,
  type EmailDefaultsRegistryPort,
  type OrderReadPort,
  type TransactionalEmailSender,
  type InvoicePdfPort,
  type PaidOrderReadPort,
  type OrganizationWritePort,
  type RelatedPayerPolicyPort,
  type RelatedPayerWritePort,
  type SettingWriteValidatorRegistryPort,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  effectiveState,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SalesChannelResolutionPort,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { RelatedPayerLink } from './entities/related-payer-link.entity.js';
import { RelatedPayerRequest } from './entities/related-payer-request.entity.js';
import { registerRelatedPayersAdminRoutes } from './routes.admin.js';
import { registerRelatedPayersRequestAdminRoutes } from './routes.admin.requests.js';
import { RequestExpiryService } from './services/request-expiry.js';
import { RelatedPayerRequestNotifications } from './services/request-notifications.js';
import { startRequestExpirySweep } from './workers/request-expiry-sweep-worker.js';
import {
  RELATED_PAYER_LINK_REVOKED_DEFAULT,
  RELATED_PAYER_LINK_REVOKED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_DECIDED_DEFAULT,
  RELATED_PAYER_REQUEST_DECIDED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_EXPIRED_DEFAULT,
  RELATED_PAYER_REQUEST_EXPIRED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_RECEIVED_DEFAULT,
  RELATED_PAYER_REQUEST_RECEIVED_EMAIL_CODE,
} from './email-templates/request-defaults.js';
import { RelatedPayerLinkCache } from './services/link-cache.js';
import { LinkReadService } from './services/link-service.js';
import { LinkWriteService } from './services/link-write-service.js';
import { RelatedPayerWritePortService } from './services/related-payer-write-port.js';
import { RelatedPayerPolicyService, type CachedLink } from './services/related-payer-policy.js';
import { registerRelatedPayersCustomerRoutes } from './routes.customer.js';
import { registerRelatedPayersRequestRoutes } from './routes.requests.js';
import { RelatedPayerRequestService } from './services/request-service.js';
import { createRelatedPayersTimeZoneValidator, storeTimeZoneOf } from './services/store-time-zone.js';
import { RelatedPayerInvitationDelivery } from './services/invitation-delivery.js';
import { createStorefrontOriginResolver } from './services/storefront-origin.js';
import {
  RELATED_PAYER_INVITATION_RECEIVED_DEFAULT,
  RELATED_PAYER_INVITATION_RECEIVED_EMAIL_CODE,
  RELATED_PAYER_INVITATION_TO_REGISTER_DEFAULT,
  RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE,
} from './email-templates/invitation-defaults.js';
import { sendPayerOrderEmails, type PayerOrderEmailCode } from './services/payer-order-emails.js';
import {
  RELATED_PAYER_ORDER_CANCELLED_DEFAULT,
  RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE,
  RELATED_PAYER_ORDER_PLACED_DEFAULT,
  RELATED_PAYER_ORDER_PLACED_EMAIL_CODE,
} from './email-templates/payer-order-defaults.js';
import {
  RELATED_PAYERS_MERGE_PARTICIPATION_KEY,
  RelatedPayerOrganizationMergeParticipant,
} from './merge/organization-merge-participant.js';

/**
 * `related_payers` — composition root (`specs/182-related-payers/`).
 *
 * The payer link — its Commands, the operator routes on the organization card, the
 * automation port and the per-process link cache (US1, US8); the policy port that
 * `orders`, `payment_methods` and `carts` read (US2, US9); the payer's view of the orders
 * it pays for (US3); payer requests — the customer routes, the operator queue, the
 * after-commit notifications and the expiry sweep (US4, US7); and the payer without an account
 * and the payer's invitation of a buyer (US5, US6).
 */
export interface RelatedPayersCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (request: FastifyRequest) => { adminUserId: string };
  readonly redis: Redis;
  readonly redisSubscriber: Redis;
  readonly requireCustomer: (request: FastifyRequest, reply: unknown) => Promise<void>;
  readonly customerContextResolver: (request: FastifyRequest) => { customerAccountId: string; organizationId: string };
  readonly relatedPayerLinkCache: RelatedPayerLinkCache<CachedLink>;
  readonly relatedPayerLinkReads: LinkReadService;
  readonly relatedPayerLinkWrites: LinkWriteService;
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  readonly relatedPayerRequests: RelatedPayerRequestService;
  readonly relatedPayerRequestExpiry: RequestExpiryService;
  readonly relatedPayerRequestNotifications: RelatedPayerRequestNotifications;
  readonly relatedPayerInvitations: RelatedPayerInvitationDelivery;
  /** The deployment's storefront origin, the fallback of a channel's `sales_channels.storefront_url`. */
  readonly storefrontBaseUrl: string;
  readonly salesChannelResolutionPort: SalesChannelResolutionPort;
  /** Whether this process consumes queues (`BACKEND_ROLE`), and the connection to build a consumer on. */
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
}

export function registerModule(ctx: ModuleContext): void {
  // Other modules' ports — lazy, resolved per call, never captured.
  const organizations = lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort');
  const addresses = lazyPort<AddressReadPort>(ctx, 'addressReadPort');
  const organizationWrites = lazyPort<OrganizationWritePort>(ctx, 'organizationWritePort');
  const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
  const permissions = lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort');

  ctx.di.register({
    relatedPayerLinkCache: ctx
      .asFunction(
        ({ redis }: RelatedPayersCradle) =>
          new RelatedPayerLinkCache<CachedLink>(redis, undefined, () => ctx.cradle<RelatedPayersCradle>().redisSubscriber),
      )
      .singleton(),
    relatedPayerLinkReads: ctx
      .asFunction(({ emFactory }: RelatedPayersCradle) => new LinkReadService({ emFactory, organizations }))
      .singleton(),
    relatedPayerLinkWrites: ctx
      .asFunction(
        ({ emFactory, commandBus, relatedPayerLinkCache }: RelatedPayersCradle) =>
          new LinkWriteService({
            emFactory,
            commandBus,
            organizations,
            addresses,
            // Research R-9 — after every committed link write, here and in every process.
            onLinksChanged: (buyerOrganizationId) => relatedPayerLinkCache.publishDrop(buyerOrganizationId),
          }),
      )
      .singleton(),
  });

  // `specs/182-related-payers/` FR-040 – FR-047 — payer requests and their decisions.
  ctx.di.register({
    relatedPayerRequests: ctx
      .asFunction(
        ({ emFactory, commandBus, relatedPayerLinkCache }: RelatedPayersCradle) =>
          new RelatedPayerRequestService({
            emFactory,
            commandBus,
            organizations,
            permissions,
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            settings: async (salesChannelId) => ({
              approvalMode: await settings.get(RELATED_PAYERS_SETTING_CODES.APPROVAL_MODE, salesChannelId, relatedPayerApprovalModeSchema),
              unregisteredMode: await settings.get(
                RELATED_PAYERS_SETTING_CODES.UNREGISTERED_PAYER_MODE,
                salesChannelId,
                relatedPayerUnregisteredModeSchema,
              ),
              ttlDays: await settings.get(RELATED_PAYERS_SETTING_CODES.REQUEST_TTL_DAYS, salesChannelId, relatedPayerRequestTtlDaysSchema),
              dailyLimit: await settings.get(
                RELATED_PAYERS_SETTING_CODES.DAILY_REQUEST_LIMIT,
                salesChannelId,
                relatedPayerDailyRequestLimitSchema,
              ),
            }),
            // FR-046, RP-20 (a) — "today" starts at midnight in the default store's time zone.
            timeZone: storeTimeZoneOf({
              defaultChannelId: async () =>
                (await lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort').getSystemDefault()).id,
              read: (code, salesChannelId) => settings.get(code, salesChannelId, z.string()),
            }),
            onLinksChanged: (buyerOrganizationId) => relatedPayerLinkCache.publishDrop(buyerOrganizationId),
          }),
      )
      .singleton(),
  });

  // FR-045, FR-102 — the expiry sweep's pass; FR-025, FR-042, FR-045, FR-050 — what the
  // outbox rows of the request and revoke Commands deliver.
  ctx.di.register({
    relatedPayerRequestExpiry: ctx
      .asFunction(({ emFactory, commandBus }: RelatedPayersCradle) => new RequestExpiryService({ emFactory, commandBus }))
      .singleton(),
    relatedPayerRequestNotifications: ctx
      .asFunction(
        ({ emFactory }: RelatedPayersCradle) =>
          new RelatedPayerRequestNotifications({
            emFactory,
            organizations,
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            permissions,
            sender: () => ctx.cradle<RelatedPayersCradle>().transactionalEmailSenderAccessor(),
            language: async (salesChannelId) => {
              const channels = lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort');
              const channel = salesChannelId ? await channels.getById(salesChannelId) : await channels.getSystemDefault();
              return channel?.defaultLanguage ?? 'en-US';
            },
            // Both owners are switchable and only degrade this module: presence is asked in front
            // of each port, never caught behind it (D-60).
            centre: () =>
              effectiveState.isPresent('customer_notifications')
                ? lazyPort<CustomerNotificationRecordPort>(ctx, 'customerNotificationRecordPort')
                : null,
            bell: () =>
              effectiveState.isPresent('admin_notifications')
                ? lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort')
                : null,
            log: (message, context) => ctx.log.warn(context, message),
          }),
      )
      .singleton(),
  });

  // US5 (FR-044) — the invitation to register: its token, its e-mail, and the lookup that
  // pre-fills the registration form.
  const channelEnabled = (salesChannelId: string) => settings.get(RELATED_PAYERS_SETTING_CODES.ENABLED, salesChannelId, z.boolean());
  ctx.di.register({
    relatedPayerInvitations: ctx
      .asFunction(
        ({ emFactory, commandBus }: RelatedPayersCradle) =>
          new RelatedPayerInvitationDelivery({
            emFactory,
            commandBus,
            organizations,
            sender: () => ctx.cradle<RelatedPayersCradle>().transactionalEmailSenderAccessor(),
            language: async (salesChannelId) =>
              (await lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort').getById(salesChannelId))
                ?.defaultLanguage ?? 'en-US',
            storefrontOrigin: (salesChannelId) =>
              createStorefrontOriginResolver(
                (channelId) => settings.get('sales_channels.storefront_url', channelId, z.string()),
                ctx.cradle<RelatedPayersCradle>().storefrontBaseUrl,
              )(salesChannelId),
            channelEnabled,
            log: (message, context) => ctx.log.warn(context, message),
          }),
      )
      .singleton(),
  });

  // Research R-8 — nothing a request's routing sends happens inside the request: the Commands
  // write an outbox row each, and these handlers deliver it after commit, at least once. The drain
  // pins a handler to the row's Organization (the sender, or the link's buyer); the people told
  // are the other side's too, so each delivery widens to a system scope of its own and re-reads
  // the request or link by id (research R-5: constrained to the one record the row names).
  const notifications = () => ctx.cradle<RelatedPayersCradle>().relatedPayerRequestNotifications;
  const deliver = (run: () => Promise<void>) => withSystemScope('related_payers: tell both parties of a payer request or link', run);
  ctx.commandHooks([
    {
      // A request naming a tax ID with no account under `invite` becomes an invitation to register
      // (FR-044); any other tells its counterparty or the operators (FR-042, FR-025).
      id: 'notify-request-created',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.requestCreate,
      phase: 'afterCommit',
      handler: ({ data }) =>
        deliver(() =>
          data.routing === 'awaiting_registration'
            ? ctx.cradle<RelatedPayersCradle>().relatedPayerInvitations.send(data.requestId, 'routing')
            : notifications().requestCreated(data.requestId, data),
        ),
    },
    {
      // US5 — a request routed after its creation (assigned, attached on registration) is told
      // like a new one.
      id: 'notify-request-routed',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.requestRoute,
      phase: 'afterCommit',
      handler: ({ data }) => deliver(() => notifications().requestCreated(data.requestId, data)),
    },
    {
      id: 'notify-request-accepted',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.requestAccept,
      phase: 'afterCommit',
      handler: ({ data }) => deliver(() => notifications().requestDecided(data.requestId, data)),
    },
    {
      id: 'notify-request-rejected',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.requestReject,
      phase: 'afterCommit',
      handler: ({ data }) => deliver(() => notifications().requestDecided(data.requestId, data)),
    },
    {
      // RP-20 (c) — the requester hears its request expired; a withdrawal tells nobody.
      id: 'notify-request-expired',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.requestExpire,
      phase: 'afterCommit',
      handler: ({ data }) => deliver(() => notifications().requestExpired(data.requestId, data)),
    },
    {
      id: 'notify-link-revoked',
      on: RELATED_PAYERS_HOOKABLE_ACTIONS.linkRevoke,
      phase: 'afterCommit',
      handler: ({ data }) => deliver(() => notifications().linkRevoked(data.linkId, data.revokedByKind)),
    },
  ] as const);

  // FR-012, FR-060, FR-063 — the one answer to "may this person name this payer now?",
  // read by `orders` (placement, preview) and `payment_methods` (the payer's methods).
  ctx.di.providePort<RelatedPayerPolicyPort>(
    'relatedPayerPolicyPort',
    ctx
      .asFunction(
        ({ emFactory, relatedPayerLinkCache }: RelatedPayersCradle) =>
          new RelatedPayerPolicyService({
            emFactory,
            now: () => new Date(),
            cache: relatedPayerLinkCache,
            channelEnabled: (salesChannelId) =>
              settings.get(RELATED_PAYERS_SETTING_CODES.ENABLED, salesChannelId, z.boolean()),
            permissions,
            organizations,
            addresses,
          }),
      )
      .singleton(),
  );

  // FR-030 — the automation port; gated on this module's presence (503 while off).
  ctx.di.providePort<RelatedPayerWritePort>(
    'relatedPayerWritePort',
    ctx
      .asFunction(() => new RelatedPayerWritePortService(() => ctx.cradle<RelatedPayersCradle>().relatedPayerLinkWrites))
      .singleton(),
  );

  ctx.routes(async (app) => {
    const { requireAdmin, relatedPayerLinkReads, relatedPayerLinkWrites } = ctx.cradle<RelatedPayersCradle>();
    await registerRelatedPayersAdminRoutes(app, {
      requireAdmin,
      reads: relatedPayerLinkReads,
      writes: relatedPayerLinkWrites,
      organizations,
      organizationWrites,
      resolveAdminUserId: (request) => ctx.cradle<RelatedPayersCradle>().adminContextResolver(request).adminUserId,
    });
  });

  ctx.routes(async (app) => {
    const { requireCustomer, customerContextResolver } = ctx.cradle<RelatedPayersCradle>();
    await registerRelatedPayersCustomerRoutes(app, {
      requireCustomer,
      customerContextResolver,
      policy: lazyPort<RelatedPayerPolicyPort>(ctx, 'relatedPayerPolicyPort'),
      organizationRestriction: lazyPort<OrganizationRestrictionPort>(ctx, 'organizationRestrictionPort'),
      channelEnabled: (salesChannelId) =>
        settings.get(RELATED_PAYERS_SETTING_CODES.ENABLED, salesChannelId, z.boolean()),
      creditAvailability: () =>
        effectiveState.isPresent('credit_limits')
          ? lazyPort<CreditAvailabilityReadPort>(ctx, 'creditAvailabilityReadPort')
          : null,
      paidOrders: lazyPort<PaidOrderReadPort>(ctx, 'paidOrderReadPort'),
      invoicePdf: () => (effectiveState.isPresent('invoices') ? lazyPort<InvoicePdfPort>(ctx, 'invoicePdfPort') : null),
      permissions,
    });
  });

  // FR-023 — the operator queue of payer requests.
  ctx.routes(async (app) => {
    const { requireAdmin } = ctx.cradle<RelatedPayersCradle>();
    await registerRelatedPayersRequestAdminRoutes(app, {
      requireAdmin,
      requests: () => ctx.cradle<RelatedPayersCradle>().relatedPayerRequests,
      invitations: () => ctx.cradle<RelatedPayersCradle>().relatedPayerInvitations,
      organizationWrites,
      resolveAdminUserId: (request) => ctx.cradle<RelatedPayersCradle>().adminContextResolver(request).adminUserId,
    });

    // FR-102 — the clock of the request expiry: a Job Scheduler and its consumer, attached through
    // `ctx.worker` so it stops with the module. Built only where the host says this process
    // consumes queues; the shared test server says neither and drives the tick directly.
    const cradle = ctx.cradle<RelatedPayersCradle>();
    await startRequestExpirySweep({
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      expiry: cradle.relatedPayerRequestExpiry,
      isPresent: () => effectiveState.isPresent('related_payers'),
      log: ctx.log,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => {
        app.addHook('onClose', close);
      },
    });
  });

  ctx.routes(async (app) => {
    const { requireCustomer, customerContextResolver } = ctx.cradle<RelatedPayersCradle>();
    await registerRelatedPayersRequestRoutes(app, {
      requireCustomer,
      customerContextResolver,
      permissions: () => permissions,
      requests: () => ctx.cradle<RelatedPayersCradle>().relatedPayerRequests,
      reads: () => ctx.cradle<RelatedPayersCradle>().relatedPayerLinkReads,
      writes: () => ctx.cradle<RelatedPayersCradle>().relatedPayerLinkWrites,
      channelEnabled,
      payerMayInviteBuyers: (salesChannelId) =>
        settings.get(RELATED_PAYERS_SETTING_CODES.PAYER_MAY_INVITE_BUYERS, salesChannelId, z.boolean()),
      invitations: () => ctx.cradle<RelatedPayersCradle>().relatedPayerInvitations,
    });
  });

  // Research R-9 — either party's status change may make any cached link unusable. FR-044,
  // US5-4 — an Organization that became `active` (its registration approved) takes the requests
  // still awaiting the registration of its tax ID.
  ctx.subscribe('organization.status_changed.v1', async (payload) => {
    ctx.cradle<RelatedPayersCradle>().relatedPayerLinkCache.onOrganizationStatusChanged();
    const { organizationId, newStatus } = payload as { organizationId?: unknown; newStatus?: unknown };
    if (newStatus !== 'active' || typeof organizationId !== 'string') return;
    await withSystemScope('related_payers: attach payer requests to a newly approved organization', () =>
      ctx.cradle<RelatedPayersCradle>().relatedPayerRequests.attachRegistered(organizationId),
    );
  });

  // FR-074, RP-17 (b) — the payer's people hear of an order billed to them, placed or
  // cancelled, when the link says so. `orders` emits after the write committed; nothing here can
  // undo it, and nothing raised here reaches it: `sendPayerOrderEmails` logs what did not go out.
  const payerOrderEmail = (orderId: string, code: PayerOrderEmailCode) =>
    withSystemScope('related_payers: tell the payer of an order billed to it', () =>
      sendPayerOrderEmails(
        {
          sender: () => ctx.cradle<RelatedPayersCradle>().transactionalEmailSenderAccessor(),
          orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          notifiesPayer: async (buyerOrganizationId, payerOrganizationId) =>
            (await ctx.cradle<RelatedPayersCradle>().relatedPayerLinkReads.listAsBuyer(buyerOrganizationId)).some(
              (link) => link.payerOrganizationId === payerOrganizationId && link.notifyPayerOnOrders,
            ),
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          organizations,
          permissions,
          channelLanguage: async (salesChannelId) =>
            (await lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort').getById(salesChannelId))
              ?.defaultLanguage ?? null,
          log: (message, context) => ctx.log.warn(context, message),
        },
        orderId,
        code,
      ),
    );
  const orderIdOf = (payload: unknown): string | null => {
    const orderId = (payload as { orderId?: unknown }).orderId;
    return typeof orderId === 'string' ? orderId : null;
  };
  ctx.subscribe('order.created.v1', async (payload) => {
    const orderId = orderIdOf(payload);
    if (orderId) await payerOrderEmail(orderId, RELATED_PAYER_ORDER_PLACED_EMAIL_CODE);
  });
  ctx.subscribe('order.cancelled.v1', async (payload) => {
    const orderId = orderIdOf(payload);
    if (orderId) await payerOrderEmail(orderId, RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE);
  });

  // The default subjects and bodies, pushed into `transactional_emails`' registry, which reads
  // it once at its boot reconciliation (the `carts` precedent).
  ctx.onBoot(() => {
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register(RELATED_PAYER_ORDER_PLACED_EMAIL_CODE, RELATED_PAYER_ORDER_PLACED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_ORDER_CANCELLED_EMAIL_CODE, RELATED_PAYER_ORDER_CANCELLED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_REQUEST_RECEIVED_EMAIL_CODE, RELATED_PAYER_REQUEST_RECEIVED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_REQUEST_DECIDED_EMAIL_CODE, RELATED_PAYER_REQUEST_DECIDED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_LINK_REVOKED_EMAIL_CODE, RELATED_PAYER_LINK_REVOKED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_REQUEST_EXPIRED_EMAIL_CODE, RELATED_PAYER_REQUEST_EXPIRED_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE, RELATED_PAYER_INVITATION_TO_REGISTER_DEFAULT, 'related_payers');
    defaults.register(RELATED_PAYER_INVITATION_RECEIVED_EMAIL_CODE, RELATED_PAYER_INVITATION_RECEIVED_DEFAULT, 'related_payers');
  });

  // RP-20 (a) — `related_payers.time_zone` must be a zone the runtime knows: a contribution into
  // `settings`' validator registry, which filters contributors by presence when it is read.
  ctx.onBoot(() => {
    lazyPort<SettingWriteValidatorRegistryPort>(ctx, 'settingWriteValidatorRegistry').register(
      createRelatedPayersTimeZoneValidator(),
    );
  });
  /**
   * `specs/192-organization-merge/` T047 — this module's part of an
   * Organization merge, in the `records` phase, through
   * `related_payer.merge_reassign`: links and requests follow the survivor, a
   * link between the two (or duplicating the survivor's) is revoked, a pending
   * request between them is closed. Cached links are dropped after each batch.
   * Registration only; the platform's runner calls it.
   */
  ctx.merge.participate(
    'organization',
    RELATED_PAYERS_MERGE_PARTICIPATION_KEY,
    new RelatedPayerOrganizationMergeParticipant({
      emFactory: () => ctx.cradle<RelatedPayersCradle>().emFactory(),
      commandBus: () => ctx.cradle<RelatedPayersCradle>().commandBus,
      onLinksChanged: (buyerOrganizationId) =>
        ctx.cradle<RelatedPayersCradle>().relatedPayerLinkCache.publishDrop(buyerOrganizationId),
    }),
  );
}

/** The module's persisted entity classes (D-168). */
export const entities = [RelatedPayerLink, RelatedPayerRequest];
