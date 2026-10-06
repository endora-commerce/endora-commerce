import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminNotificationRecordPort,
  AdminTenantScopePort,
  AdminUserReadPort,
  AssetReadPort,
  AssetReferenceRegistryPort,
  AssetsLibraryPort,
  AuditReferenceRegistryPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldValuePort,
  OpportunityReadPort,
  OpportunityTransitionPort,
  OrderReadPort,
  OrderTransitionPort,
  OrganizationDetailsPort,
  QuoteRequestReadPort,
  SalesChannelAttributionRegistryPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import { CRM_WEBHOOK_EVENT_TYPES, type WebhookEventRegistryPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { Redis } from 'ioredis';
import {
  effectiveState,
  enterSystemScope,
  lazyPort,
  type ModuleContext,
  type AuditPort,
  type RequireAdminFactory,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { registerCrmAnalyticsRoutes } from './routes/routes.analytics.js';
import { registerCrmAssignmentRoutes } from './routes/routes.assignment.js';
import { registerCrmAttachmentUploadRoutes } from './routes/routes.attachment-upload.js';
import { registerCrmAttachmentRoutes } from './routes/routes.attachments.js';
import { registerCrmBoardRoutes } from './routes/routes.board.js';
import { registerCrmCommentRoutes } from './routes/routes.comments.js';
import { registerCrmDocumentRoutes } from './routes/routes.documents.js';
import { registerCrmDocumentLookupRoutes } from './routes/routes.document-lookups.js';
import { registerCrmHistoryRoutes } from './routes/routes.history.js';
import { registerCrmLinkRoutes } from './routes/routes.links.js';
import { registerCrmLookupRoutes } from './routes/routes.lookups.js';
import { registerCrmOpportunityRoutes } from './routes/routes.opportunities.js';
import { registerCrmTagRoutes } from './routes/routes.tags.js';
import { registerCrmTransitionRoutes } from './routes/routes.transitions.js';
import { registerCrmWorkflowRoutes } from './routes/routes.workflow.js';
import { AnalyticsService } from './services/analytics-service.js';
import { BoardService } from './services/board-service.js';
import { registerCrmAssetReferences } from './services/crm-asset-references.js';
import { registerCrmAuditReferences } from './services/crm-audit-references.js';
import { CrmDocumentLookupService } from './services/crm-document-lookup-service.js';
import { CrmLookupService } from './services/crm-lookup-service.js';
import { createCrmNotifier, type CrmNotifier } from './services/crm-notifier.js';
import { createCrmQuoteRequests, type CrmQuoteRequests } from './services/crm-quote-requests.js';
import { DocumentOpportunityService } from './services/document-opportunity-service.js';
import { OpportunityAssignmentService } from './services/opportunity-assignment-service.js';
import { OpportunityAttachmentService } from './services/opportunity-attachment-service.js';
import { OpportunityAttachmentUploadService } from './services/opportunity-attachment-upload-service.js';
import { OpportunityAutoCreateService } from './services/opportunity-auto-create-service.js';
import { OpportunityCommentService } from './services/opportunity-comment-service.js';
import { OpportunityHistoryService } from './services/opportunity-history-service.js';
import { OpportunityLinkService } from './services/opportunity-link-service.js';
import { OpportunityOriginLinkService, readEventOrigin } from './services/opportunity-origin-link-service.js';
import { OpportunityReadPortService } from './services/opportunity-read-port.js';
import { OpportunityTransitionPortService } from './services/opportunity-transition-port.js';
import { OpportunityService } from './services/opportunity-service.js';
import { OpportunityTransitionGuardRegistry } from './services/opportunity-transition-guard-registry.js';
import { OpportunityTransitionService } from './services/opportunity-transition-service.js';
import { OpportunityValueService } from './services/opportunity-value-service.js';
import { ReferenceService } from './services/reference-service.js';
import {
  OrderStatusPropagationService,
  type OrderStatusChange,
} from './services/order-status-propagation-service.js';
import { registerOpportunitySalesChannelAttributions } from './services/sales-channel-attributions.js';
import { TagService } from './services/tag-service.js';
import { WorkflowConfigService } from './services/workflow-config-service.js';
import { WorkflowReadService } from './services/workflow-read-service.js';
import {
  createValueRecalculationProducer,
  startValueRecalculation,
  type ValueRecalculationProducer,
} from './workers/value-recalculation-worker.js';
import { CrmOpportunity } from './entities/crm-opportunity.entity.js';
import { CrmOpportunityAttachment } from './entities/crm-opportunity-attachment.entity.js';
import { CrmOpportunityComment } from './entities/crm-opportunity-comment.entity.js';
import { CrmOpportunityLink } from './entities/crm-opportunity-link.entity.js';
import { CrmOpportunityReference } from './entities/crm-opportunity-reference.entity.js';
import { CrmOpportunityStatus } from './entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusHistory } from './entities/crm-opportunity-status-history.entity.js';
import { CrmOpportunityStatusTransition } from './entities/crm-opportunity-status-transition.entity.js';
import { CrmOpportunityTag } from './entities/crm-opportunity-tag.entity.js';
import { CrmOrderStatusMapping } from './entities/crm-order-status-mapping.entity.js';
import { CrmStatusPropagation } from './entities/crm-status-propagation.entity.js';
import { CrmTag } from './entities/crm-tag.entity.js';
import { CrmValueCountingStatus } from './entities/crm-value-counting-status.entity.js';

/**
 * `crm` — composed by the kernel container.
 *
 * **One file, deliberately.** The plan drew one `compose/<area>.ts` per area,
 * each handed this `ModuleContext`. `check:port-dependencies` reads a module's
 * registrations from the file that exports `registerModule` and from no other:
 * a `ctx.di.register` in a helper file is reported as a name no module
 * registers, and a `ctx.di.providePort` there would not read as a gated port at
 * all — which is the fail-open direction. So every registration, route,
 * subscriber, worker and boot hook of this module is written in this file, one
 * section per area, and a story adds a section rather than a file
 * (`specs/143-crm-sales-opportunities/research.md`, Implementation notes N-6).
 *
 * The cross-module names are declared structurally, here, per section.
 */

/** What this module reads from the container: the platform's services and its own. */
interface CrmCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly crmWorkflowReadService: WorkflowReadService;
  readonly crmWorkflowConfigService: WorkflowConfigService;
  readonly crmOpportunityService: OpportunityService;
  readonly crmNotifier: CrmNotifier;
  readonly crmTagService: TagService;
  readonly crmOpportunityCommentService: OpportunityCommentService;
  readonly crmOpportunityAttachmentService: OpportunityAttachmentService;
  readonly crmOpportunityAssignmentService: OpportunityAssignmentService;
  readonly crmOpportunityLinkService: OpportunityLinkService;
  readonly crmOrderStatusPropagationService: OrderStatusPropagationService;
  readonly crmOpportunityTransitionService: OpportunityTransitionService;
  readonly opportunityTransitionGuardRegistry: OpportunityTransitionGuardRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  // --- Workflow ----------------------------------------------------------
  // Reading the configured workflow, and changing it. Every change is a
  // Command and re-validates the whole workflow before it commits.
  ctx.di.register({
    crmWorkflowReadService: ctx
      .asFunction(({ emFactory }: CrmCradle) => new WorkflowReadService(emFactory))
      .singleton(),
    crmWorkflowConfigService: ctx
      .asFunction(
        ({ commandBus, crmWorkflowReadService, crmValueRecalculationProducer }: CrmCradle & ValueCradle) =>
          new WorkflowConfigService(commandBus, crmWorkflowReadService, () =>
            crmValueRecalculationProducer.enqueue(),
          ),
      )
      .singleton(),
  });

  // --- Links ---------------------------------------------------------------
  // The documents linked to an Opportunity. `orders`' read port is the
  // integrity check for a link and the source of what a link renders; it is
  // resolved lazily, per call, and never captured in this singleton.
  ctx.di.register({
    crmOpportunityLinkService: ctx
      .asFunction(
        ({ emFactory, commandBus, crmQuoteRequests, crmOpportunityValueService }: CrmCradle & ValueCradle) =>
          new OpportunityLinkService({
            emFactory,
            commandBus,
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            quoteRequests: crmQuoteRequests,
            linksChanged: (opportunityId) => crmOpportunityValueService.recalculate(opportunityId),
          }),
      )
      .singleton(),
  });

  // --- Transitions ---------------------------------------------------------
  // The guard registry is a **contribution seam**: other modules push a guard
  // into it from a contribution-only boot hook, so it is registered ungated
  // (`ctx.di.register`, never `providePort`) — a boot hook that resolved a
  // gated port would stop the backend from starting whenever this module was
  // switched off. Nothing reads it while the module is off: the only reader is
  // the transition service, reached through this module's gated routes.
  //
  // Enumeration policy: a guard whose owner module is not effectively present
  // is skipped at dispatch. `effectiveState` is the kernel's one answer to
  // "is this module present", on both axes.
  ctx.di.register({
    opportunityTransitionGuardRegistry: ctx
      .asFunction(
        () => new OpportunityTransitionGuardRegistry((moduleId) => effectiveState.isPresent(moduleId)),
      )
      .singleton(),
    // Forward propagation: what an Opportunity's transition asks of its linked
    // Orders, through `orders`' own transition port — after the Opportunity's
    // commit, never inside it.
    crmOrderStatusPropagationService: ctx
      .asFunction(
        ({ emFactory, commandBus }: CrmCradle) =>
          new OrderStatusPropagationService({
            emFactory,
            commandBus,
            orderTransitions: lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort'),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          }),
      )
      .singleton(),
    crmOpportunityTransitionService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          eventBus,
          crmWorkflowReadService,
          opportunityTransitionGuardRegistry,
          crmOrderStatusPropagationService,
        }: CrmCradle) =>
          new OpportunityTransitionService({
            emFactory,
            commandBus,
            events: eventBus,
            workflowRead: crmWorkflowReadService,
            guards: opportunityTransitionGuardRegistry,
            propagation: crmOrderStatusPropagationService,
          }),
      )
      .singleton(),
  });

  // --- Reverse mapping -----------------------------------------------------
  // An Order's status moves its Opportunity. `order.status_changed.v1` is the
  // coarse event every Order status change emits, whoever caused it — the
  // operator, a payment, a shipment, or this module's own forward direction,
  // whose echo the handler recognises and drops.
  //
  // `ctx.subscribe`, so the handler does not run while the module is off; a
  // change made meanwhile is not replayed. There is no request behind an
  // event, so the work starts a system scope of its own and the service
  // constrains by the Organization the event names.
  ctx.subscribe('order.status_changed.v1', async (payload) => {
    const change = readOrderStatusChange(payload);
    if (!change) return;
    await enterSystemScope('crm: order status follows', async () => {
      const cradle = ctx.cradle<CrmCradle>();
      await cradle.crmOrderStatusPropagationService.onOrderStatusChanged(
        change,
        (opportunityId, to, causeOrderId) =>
          cradle.crmOpportunityTransitionService.apply(opportunityId, to, {
            actor: { kind: 'system' },
            cause: 'order_status',
            causeOrderId,
          }),
      );
    });
  });

  // --- Assignment ------------------------------------------------------------
  // Who holds an Opportunity. The Sales Reps of an Organization are
  // `organizations`' relation and the administrators are `admin_users`'; both
  // are read through their ports, lazily.
  //
  // The bell is `admin_notifications`', which an operator may switch off. This
  // module degrades without it (the manifest's `degrades-without` edge): the
  // notifier decides that module's presence before it asks, so an assignment
  // succeeds either way and nothing here catches a refusal.
  ctx.di.register({
    crmNotifier: ctx
      .asFunction(() =>
        createCrmNotifier(lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort')),
      )
      .singleton(),
    crmOpportunityAssignmentService: ctx
      .asFunction(
        ({ emFactory, commandBus, crmNotifier }: CrmCradle) =>
          new OpportunityAssignmentService({
            emFactory,
            commandBus,
            salesReps: lazyPort<SalesRepAssignmentPort>(ctx, 'organizationSalesRepScopePort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            notifier: crmNotifier,
          }),
      )
      .singleton(),
  });

  // --- Notes and messages ------------------------------------------------------
  // Internal to administrators: nothing outside this module's admin routes
  // reads them. A message tells the people in the conversation through the
  // same notifier an assignment uses, so it is stored whether or not the bell
  // is switched on.
  ctx.di.register({
    crmOpportunityCommentService: ctx
      .asFunction(
        ({ emFactory, commandBus, crmNotifier, crmReferenceService }: CrmCradle & ReferencesCradle) =>
          new OpportunityCommentService({
            emFactory,
            commandBus,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            notifier: crmNotifier,
            references: crmReferenceService,
          }),
      )
      .singleton(),
  });

  // --- Attachments -------------------------------------------------------------
  // The bytes are the media library's; an attachment is a link to one of its
  // files. Name, type and size come through `assetReadPort`, and the download
  // link through `assetsLibraryPort` — resolved here because the library's own
  // admin API asks for the library's permissions.
  ctx.di.register({
    crmOpportunityAttachmentService: ctx
      .asFunction(
        ({ emFactory, commandBus }: CrmCradle) =>
          new OpportunityAttachmentService({
            emFactory,
            commandBus,
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            assetsLibrary: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });

  /**
   * The asset-reference scanner — a **contribution** hook.
   *
   * It pushes an inert descriptor into `assetReferenceRegistry`, an ungated
   * registry `assets_library` owns, and carries no presence probe: the
   * attachments survive a deactivation, so a scanner registered only while the
   * module is on would let an operator delete a file that comes back as a
   * broken attachment when the module is switched on again. Off is
   * non-destructive and reversible (Constitution XVII); the registry honours
   * an absent contributor for exactly this reason.
   */
  ctx.onBoot(() => {
    registerCrmAssetReferences(
      lazyPort<AssetReferenceRegistryPort>(ctx, 'assetReferenceRegistry'),
      ctx.cradle<CrmCradle>().emFactory,
    );
  });

  // --- Tags ------------------------------------------------------------------
  // The tag list is platform configuration. What a tag is on is a child of an
  // Opportunity and is written by the Opportunity service, under its parent.
  ctx.di.register({
    crmTagService: ctx
      .asFunction(({ emFactory, commandBus }: CrmCradle) => new TagService({ emFactory, commandBus }))
      .singleton(),
  });

  // --- Opportunities -------------------------------------------------------
  // Create, list, read, edit, delete. The Organization, the contact person and
  // the assignee are read through their owners' ports.
  ctx.di.register({
    crmOpportunityService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          crmWorkflowReadService,
          crmOpportunityLinkService,
          crmOrderStatusPropagationService,
          crmOpportunityAssignmentService,
          crmTagService,
          crmOpportunityValueService,
          crmReferenceService,
        }: CrmCradle & ValueCradle & ReferencesCradle) =>
          new OpportunityService({
            emFactory,
            commandBus,
            workflowRead: crmWorkflowReadService,
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            assignment: crmOpportunityAssignmentService,
            tags: crmTagService,
            links: (opportunityId) => crmOpportunityLinkService.list(opportunityId),
            unresolvedPropagations: (opportunityId) =>
              crmOrderStatusPropagationService.listUnresolved(opportunityId),
            // --- Custom fields (User Story 15) ------------------------------
            // `custom_fields` validates and projects; the Opportunity's own
            // Commands write. The owner is non-deactivatable, so this is a
            // plain binding edge with no off state to degrade into.
            customFields: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
            // --- end of Custom fields ----------------------------------------
            recalculateValue: (opportunityId) => crmOpportunityValueService.recalculate(opportunityId),
            excludedDocuments: (opportunity) => crmOpportunityValueService.excludedDocuments(opportunity),
            references: crmReferenceService,
          }),
      )
      .singleton(),
  });

  /**
   * The Sales Channel attribution counter — a **contribution** hook.
   *
   * It pushes an inert counter into `salesChannelAttributionRegistry`, an
   * ungated registry `sales_channels` owns, and carries no presence probe: the
   * registry honours an absent contributor on purpose, because the
   * Opportunities survive a deactivation and their foreign key is `on delete
   * restrict` — a probe here would turn a refusal naming this module into a raw
   * constraint violation, and would make switching the module back on need a
   * restart.
   */
  ctx.onBoot(() => {
    registerOpportunitySalesChannelAttributions(
      lazyPort<SalesChannelAttributionRegistryPort>(ctx, 'salesChannelAttributionRegistry'),
      ctx.cradle<CrmCradle>().emFactory,
    );
  });

  // --- Board (User Story 7) --------------------------------------------------
  // One read: a column per status, with its figures and its first cards. The
  // cards are the list's — asked per status — so the service takes the list as
  // a function and renders no Opportunity itself. Its route is registered here,
  // in a `ctx.routes` of its own, so the whole story is this one section.
  ctx.di.register({
    crmBoardService: ctx
      .asFunction(
        ({ emFactory, crmWorkflowReadService, crmOpportunityService, crmTagService }: CrmCradle) =>
          new BoardService({
            emFactory,
            workflowRead: crmWorkflowReadService,
            listOpportunities: (query) => crmOpportunityService.list(query),
            opportunityIdsCarryingAll: (em, tagIds) => crmTagService.opportunityIdsCarryingAll(em, tagIds),
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle & { readonly crmBoardService: BoardService }>();
    await registerCrmBoardRoutes(app, {
      boardService: cradle.crmBoardService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Board ----------------------------------------------------------

  // --- Value and Quote Requests (User Story 8) -------------------------------
  // A computed value is a stored figure this section keeps true: it is asked
  // again when a link changes (the link service), when the mode becomes
  // `computed` (the Opportunity service), when a linked document's status or
  // amount changes (the subscribers below), and — for every computed
  // Opportunity at once — when the counting configuration is saved (the queue).
  //
  // `quote_requests` is operator-switchable and this module degrades without
  // it: `crmQuoteRequests` is the one door to its read port, and every caller
  // asks `isPresent()` before it goes through.
  ctx.di.register({
    crmQuoteRequests: ctx
      .asFunction(() => createCrmQuoteRequests(lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort')))
      .singleton(),
    crmOpportunityValueService: ctx
      .asFunction(
        ({ emFactory, commandBus, crmQuoteRequests }: CrmCradle & ValueCradle) =>
          new OpportunityValueService({
            emFactory,
            commandBus,
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            quoteRequests: crmQuoteRequests,
          }),
      )
      .singleton(),
    // The producing side of the recalculation queue. `moduleQueueRedis` is
    // undefined in a composition that wants no queues; nothing is enqueued then.
    crmValueRecalculationProducer: ctx
      .asFunction(({ moduleQueueRedis }: ValueCradle) => createValueRecalculationProducer(moduleQueueRedis))
      .singleton(),
  });

  // `ctx.subscribe`, so none of these runs while the module is off, and a
  // change made meanwhile is not replayed. There is no request behind an
  // event: each starts a system scope, and the value service reads only what
  // hangs off the one Opportunity the document is linked to.
  ctx.subscribe('order.status_changed.v1', async (payload) => {
    const orderId = readEventId(payload, 'orderId');
    if (!orderId) return;
    await enterSystemScope('crm: value follows an order status', () =>
      ctx.cradle<ValueCradle>().crmOpportunityValueService.recalculateForDocument('order', orderId),
    );
  });
  // A Quote Request approved, canceled, modified (its prices) or expired.
  // `quote_requests` emits none of these while it is off.
  for (const eventName of QUOTE_REQUEST_VALUE_EVENTS) {
    ctx.subscribe(eventName, async (payload) => {
      const quoteRequestId = readEventId(payload, 'rfqId');
      if (!quoteRequestId) return;
      await enterSystemScope('crm: value follows a quote request', () =>
        ctx.cradle<ValueCradle>().crmOpportunityValueService.recalculateForDocument(
          'quote_request',
          quoteRequestId,
        ),
      );
    });
  }
  // `order.created.v1` — an Order placed from a linked Quote Request joining
  // that Opportunity (FR-027) — is one branch of the placed-document
  // subscriber in the next section; the link service recalculates the value
  // once the Order has joined.

  // The consumer of the recalculation queue, attached where `app.log` exists
  // and through `ctx.worker`, which is what stops it with the module. Built
  // only where the host says this process consumes queues and offers a
  // connection; the shared test server says neither and drives the pass itself.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle & ValueCradle>();
    app.addHook('onClose', () => cradle.crmValueRecalculationProducer.close());
    startValueRecalculation({
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      recalculateAll: () => cradle.crmOpportunityValueService.recalculateAll(),
      log: ctx.log,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
    });
  });
  // --- end of Value and Quote Requests ---------------------------------------

  // --- Placed documents (User Story 9) -----------------------------------------
  // One subscriber per placed document, with the branches of research R-8 in
  // its service: an Order placed from a linked Quote Request joins that
  // Opportunity whatever the settings say; otherwise, with the setting on for
  // the document, an Opportunity is created for it and linked.
  //
  // `ctx.subscribe`, so nothing is created while the module is off, and nothing
  // is created afterwards for a document placed meanwhile. Each handler starts
  // a system scope and the service works on the one Organization the document
  // names.
  ctx.di.register({
    crmOpportunityAutoCreateService: ctx
      .asFunction(
        ({ eventBus, crmQuoteRequests, crmOpportunityLinkService, crmOpportunityService }: CrmCradle & ValueCradle) =>
          new OpportunityAutoCreateService({
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            quoteRequests: crmQuoteRequests,
            links: crmOpportunityLinkService,
            createForDocument: (input) => crmOpportunityService.createForDocument(input),
            linkByOrigin: (origin, document) =>
              ctx.cradle<OriginCradle>().crmOpportunityOriginLinkService.link(origin, document),
            events: eventBus,
            // A document whose commit is still in flight is read again off the
            // bus's dispatch chain — the bus awaits each subscriber before the
            // next, and the webhook bridge is one of them. The work gets a
            // system scope of its own (the handler's ends when it returns),
            // does nothing if the module was switched off meanwhile, and never
            // rejects: there is nobody left to hear it, so a failure is logged.
            defer: (work) =>
              enterSystemScope('crm: a placed document, read again after its commit', async () => {
                if (!effectiveState.isPresent('crm')) return;
                await work();
              }).catch((error: unknown) => {
                ctx.log.warn(
                  { error: error instanceof Error ? error.message : String(error) },
                  'crm: a placed document could not be handled after its commit',
                );
              }),
          }),
      )
      .singleton(),
  });
  ctx.subscribe('order.created.v1', async (payload) => {
    const orderId = readEventId(payload, 'orderId');
    if (!orderId) return;
    await enterSystemScope('crm: an order was placed', () =>
      ctx
        .cradle<PlacedDocumentsCradle>()
        .crmOpportunityAutoCreateService.onOrderCreated(orderId, readEventOrigin(payload)),
    );
  });
  // Emitted for a Quote Request a customer submits. `quote_requests` emits
  // nothing while it is off.
  ctx.subscribe('rfq.created.v1', async (payload) => {
    const quoteRequestId = readEventId(payload, 'rfqId');
    if (!quoteRequestId) return;
    await enterSystemScope('crm: a quote request was submitted', () =>
      ctx.cradle<PlacedDocumentsCradle>().crmOpportunityAutoCreateService.onQuoteRequestCreated(quoteRequestId),
    );
  });
  // --- end of Placed documents ---------------------------------------------------

  // --- Created from an Opportunity (User Story 10) -------------------------------
  // The create screens of `orders` and `quote_requests` hand an opaque `origin`
  // to their create requests, and the owners hand it on, unread, on
  // `order.created.v1` and `rfq.created_by_admin.v1`. An origin is a claim: the
  // service below checks it — same Organization as the document, and within
  // reach of the administrator the event names — before it links anything. It
  // is the first branch of the placed-document service above, so a document
  // created from an Opportunity never gets a second one.
  //
  // `rfq.created_by_admin.v1` is the only announcement of a Quote Request an
  // administrator creates; without an origin that holds it is handled as a
  // submitted one. `quote_requests` emits nothing while it is off.
  ctx.di.register({
    crmOpportunityOriginLinkService: ctx
      .asFunction(
        ({ emFactory, crmOpportunityLinkService }: CrmCradle) =>
          new OpportunityOriginLinkService({
            emFactory,
            links: crmOpportunityLinkService,
            adminScope: lazyPort<AdminTenantScopePort>(ctx, 'adminTenantScopePort'),
            warn: (fields, message) => ctx.log.warn(fields, message),
          }),
      )
      .singleton(),
  });
  ctx.subscribe('rfq.created_by_admin.v1', async (payload) => {
    const quoteRequestId = readEventId(payload, 'rfqId');
    if (!quoteRequestId) return;
    await enterSystemScope('crm: an administrator created a quote request', () =>
      ctx
        .cradle<PlacedDocumentsCradle>()
        .crmOpportunityAutoCreateService.onQuoteRequestCreated(
          quoteRequestId,
          readEventOrigin(payload),
          readEventId(payload, 'adminUserId'),
        ),
    );
  });
  // --- end of Created from an Opportunity ----------------------------------------

  // --- References (User Story 12) -------------------------------------------
  // Products and Orders mentioned in a description, a note or a message. The
  // Opportunity and the comment services store a text's references in the
  // Command that saves the text and resolve them when they render it; the
  // names come from `catalog`'s and `orders`' read ports, under the reader's
  // scope, every time.
  ctx.di.register({
    crmReferenceService: ctx
      .asFunction(
        () =>
          new ReferenceService({
            products: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  // --- end of References -------------------------------------------------------

  // --- Change history (User Story 11) ---------------------------------------
  // The audit log is the history: one read of the kernel's audit port for the
  // entries of one Opportunity, after the Opportunity itself was loaded through
  // the tenant-scoped EntityManager. `auditLogService` is a platform service,
  // not a module's port, and needs no manifest edge. The route is registered
  // here, in a `ctx.routes` of its own, so the whole story is this one section.
  ctx.di.register({
    crmOpportunityHistoryService: ctx
      .asFunction(
        ({ emFactory, auditLogService }: CrmCradle & HistoryCradle) =>
          new OpportunityHistoryService({
            emFactory,
            auditLog: auditLogService,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle & HistoryCradle>();
    await registerCrmHistoryRoutes(app, {
      historyService: cradle.crmOpportunityHistoryService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Change history -------------------------------------------------

  // --- Outbound webhooks (User Story 16) ----------------------------------------
  /**
   * The events this module offers to outbound webhooks — a **contribution**
   * hook.
   *
   * It pushes three event names into `webhookEventRegistry`, an ungated
   * registry `webhooks` owns, and carries no presence probe: the registry
   * leaves out a contributor that is not present when it is read, so a push
   * made while this module is off costs nothing, and one skipped here would
   * make switching the module on need a restart before its events were
   * offered. `webhooks` bridges each pushed type through its own gated
   * subscription and sends the event payload whole — which is why the three
   * have strict schemas in the contracts package.
   *
   * Nothing is read back and nothing degrades: with `webhooks` off the events
   * are emitted as ever and nobody is told; in an instance without `webhooks`
   * the push is dropped by the platform.
   */
  ctx.onBoot(() => {
    const registry = lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry');
    for (const eventType of CRM_WEBHOOK_EVENT_TYPES) registry.register({ ownerModuleId: 'crm', eventType });
  });
  // --- end of Outbound webhooks --------------------------------------------------

  // --- Lookups (research N-D4) -------------------------------------------------
  // What the screens' pickers choose from — Organizations, Sales Channels,
  // assignees, contact persons — read through their owners' ports and gated by
  // CRM's own codes, so a Sales Rep needs no other module's permission to fill
  // in a filter or a form. One service, one `ctx.routes`, this one section.
  ctx.di.register({
    crmLookupService: ctx
      .asFunction(
        ({ emFactory }: CrmCradle) =>
          new CrmLookupService({
            emFactory,
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle & { readonly crmLookupService: CrmLookupService }>();
    await registerCrmLookupRoutes(app, {
      lookupService: cradle.crmLookupService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Lookups ----------------------------------------------------------

  // --- Attachment upload (research N-F1) ----------------------------------------
  // One request that stores a file in the media library and attaches it, gated
  // by `crm:write` alone: the library's own upload endpoint asks for the
  // library's permission, which a Sales Rep need not hold. The bytes go through
  // `assetsLibraryPort.upload` — the library's own pipeline, so its limits and
  // its storage apply unchanged — and the attaching is the attachment service's
  // Command. One service, one `ctx.routes`, this one section.
  ctx.di.register({
    crmOpportunityAttachmentUploadService: ctx
      .asFunction(
        ({ emFactory, crmOpportunityAttachmentService }: CrmCradle) =>
          new OpportunityAttachmentUploadService({
            emFactory,
            assetsLibrary: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
            attach: (opportunityId, assetId) => crmOpportunityAttachmentService.add(opportunityId, assetId),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<
      CrmCradle & { readonly crmOpportunityAttachmentUploadService: OpportunityAttachmentUploadService }
    >();
    await registerCrmAttachmentUploadRoutes(app, {
      uploadService: cradle.crmOpportunityAttachmentUploadService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Attachment upload -------------------------------------------------

  // --- Analytics (User Story 13) -----------------------------------------------
  // Five figures over a range of days, each one grouped statement constrained
  // to the Organizations the caller reaches. The most valuable Opportunities
  // are rendered by the list's own renderer, handed in as a function, so a row
  // there is the card the list shows. One service, one `ctx.routes` under the
  // module's own `crm:analytics`, this one section.
  ctx.di.register({
    crmAnalyticsService: ctx
      .asFunction(
        ({ emFactory, crmWorkflowReadService, crmOpportunityService }: CrmCradle) =>
          new AnalyticsService({
            emFactory,
            workflowRead: crmWorkflowReadService,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            summarize: (rows) => crmOpportunityService.summarize(rows),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle & { readonly crmAnalyticsService: AnalyticsService }>();
    await registerCrmAnalyticsRoutes(app, {
      analyticsService: cradle.crmAnalyticsService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Analytics --------------------------------------------------------

  // --- The Opportunity of a document (User Story 17) ---------------------------
  // One read for the panel CRM contributes to the Order screen: which
  // Opportunity an Order is linked to. The Order is checked through `orders`'
  // read port, under the caller's scope, before anything is said about a link.
  // One service, one `ctx.routes`, this one section.
  ctx.di.register({
    crmDocumentOpportunityService: ctx
      .asFunction(
        ({ emFactory, crmOpportunityService }: CrmCradle) =>
          new DocumentOpportunityService({
            emFactory,
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            getOpportunity: (opportunityId) => crmOpportunityService.get(opportunityId),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<
      CrmCradle & { readonly crmDocumentOpportunityService: DocumentOpportunityService }
    >();
    await registerCrmDocumentRoutes(app, {
      documentOpportunityService: cradle.crmDocumentOpportunityService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of The Opportunity of a document ------------------------------------

  // --- Published ports and the audit reference (User Story 14) -----------------
  // What another module, or a deployment's overlay, reads and moves an
  // Opportunity through. Both are `providePort`: gated, so a consumer resolving
  // either while this module is off gets `ModuleDisabledError` (503
  // `MODULE_DISABLED`) and nothing half-executes.
  ctx.di.providePort<OpportunityReadPort>(
    'opportunityReadPort',
    ctx
      .asFunction(
        ({ emFactory, crmWorkflowReadService }: CrmCradle) =>
          new OpportunityReadPortService(emFactory, crmWorkflowReadService),
      )
      .singleton(),
  );
  ctx.di.providePort<OpportunityTransitionPort>(
    'opportunityTransitionPort',
    ctx
      .asFunction(
        ({ emFactory, crmWorkflowReadService, crmOpportunityTransitionService }: CrmCradle) =>
          new OpportunityTransitionPortService(emFactory, crmWorkflowReadService, crmOpportunityTransitionService),
      )
      .singleton(),
  );
  /**
   * The audit-reference resolver — a **contribution** hook.
   *
   * It pushes an inert resolver into `auditReferenceRegistry`, an ungated
   * registry `audit_logs` owns, and carries no presence probe: the registry's
   * own enumeration policy skips this entry while the module is absent, and a
   * probe here would make that survive a reactivation until the next restart.
   */
  ctx.onBoot(() => {
    registerCrmAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      ctx.cradle<CrmCradle>().emFactory,
    );
  });
  // --- end of Published ports --------------------------------------------------

  // --- Document lookups (research N-H2) --------------------------------------
  // The Quote Requests an Opportunity's link picker chooses from, through
  // `quote_requests`' read port and behind `crm:write` — the quote desk's own
  // list asks for the right to handle quotes. Absent with that module off.
  ctx.di.register({
    crmDocumentLookupService: ctx
      .asFunction(
        ({ crmQuoteRequests }: ValueCradle) =>
          new CrmDocumentLookupService({
            quoteRequestPresence: crmQuoteRequests,
            quoteRequests: lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<
      CrmCradle & { readonly crmDocumentLookupService: CrmDocumentLookupService }
    >();
    await registerCrmDocumentLookupRoutes(app, {
      documentLookupService: cradle.crmDocumentLookupService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Document lookups -----------------------------------------------

  // --- Routes ----------------------------------------------------------------
  // All through `ctx.routes`, so every one of them stops with the module.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle>();
    const { requireAdmin } = cradle;
    await registerCrmWorkflowRoutes(app, {
      workflowReadService: cradle.crmWorkflowReadService,
      workflowConfigService: cradle.crmWorkflowConfigService,
      requireAdmin,
    });
    await registerCrmOpportunityRoutes(app, {
      opportunityService: cradle.crmOpportunityService,
      requireAdmin,
    });
    await registerCrmAssignmentRoutes(app, {
      assignmentService: cradle.crmOpportunityAssignmentService,
      opportunityService: cradle.crmOpportunityService,
      requireAdmin,
    });
    await registerCrmAttachmentRoutes(app, {
      attachmentService: cradle.crmOpportunityAttachmentService,
      requireAdmin,
    });
    await registerCrmCommentRoutes(app, {
      commentService: cradle.crmOpportunityCommentService,
      requireAdmin,
    });
    await registerCrmLinkRoutes(app, {
      linkService: cradle.crmOpportunityLinkService,
      requireAdmin,
    });
    await registerCrmTagRoutes(app, {
      tagService: cradle.crmTagService,
      opportunityService: cradle.crmOpportunityService,
      requireAdmin,
    });
    await registerCrmTransitionRoutes(app, {
      transitionService: cradle.crmOpportunityTransitionService,
      propagationService: cradle.crmOrderStatusPropagationService,
      opportunityService: cradle.crmOpportunityService,
      requireAdmin,
    });
  });
}

/** What the value section reads from the container, beside {@link CrmCradle}. */
interface ValueCradle {
  readonly crmQuoteRequests: CrmQuoteRequests;
  readonly crmOpportunityValueService: OpportunityValueService;
  readonly crmValueRecalculationProducer: ValueRecalculationProducer;
  /** Whether this process runs queue consumers — the platform's one answer. */
  readonly processRunsWorkers: boolean;
  /** The connection a module may build a queue on; undefined where a composition wants none. */
  readonly moduleQueueRedis: Redis | undefined;
}

/** What the references section registers. */
interface ReferencesCradle {
  readonly crmReferenceService: ReferenceService;
}

/** What the change-history section reads from the container. */
interface HistoryCradle {
  /** The kernel's audit port, under the name `audit_logs`' own route reads it by. */
  readonly auditLogService: AuditPort;
  readonly crmOpportunityHistoryService: OpportunityHistoryService;
}

/** What the placed-documents section reads from the container. */
interface PlacedDocumentsCradle {
  readonly crmOpportunityAutoCreateService: OpportunityAutoCreateService;
}

/** What the created-from-an-Opportunity section registers. */
interface OriginCradle {
  readonly crmOpportunityOriginLinkService: OpportunityOriginLinkService;
}

/** The `quote_requests` events after which a linked Quote Request may count differently. */
const QUOTE_REQUEST_VALUE_EVENTS = [
  'rfq.approved.v1',
  'rfq.canceled.v1',
  'rfq.modified.v1',
  'rfq.expired.v1',
] as const;

/** One uuid-shaped field of a payload the bus hands over untyped, or `null`. */
function readEventId(payload: unknown, field: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[field];
  return typeof value === 'string' && value ? value : null;
}

/**
 * The part of `order.status_changed.v1` the reverse mapping reads, taken off a
 * payload the bus hands over untyped. `orders` publishes the event's shape as a
 * TypeScript type of its own module and no schema in the contracts package, so
 * the three fields are checked here, by hand, and an event that does not carry
 * them is dropped rather than acted on.
 */
function readOrderStatusChange(payload: unknown): OrderStatusChange | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { orderId, organizationId, to } = payload as Record<string, unknown>;
  if (typeof orderId !== 'string' || typeof organizationId !== 'string' || typeof to !== 'string') return null;
  if (!orderId || !organizationId || !to) return null;
  return { orderId, organizationId, to };
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 *
 * Thirteen classes, the whole schema of the module: the Opportunity
 * (`@OrgScoped`), its seven children (`@TransitivelyScoped` through it) and
 * five configuration tables (`@GlobalEntity`). Every class is here before the
 * first user story, so that no later story changes a generated registry.
 */
export const entities = [
  CrmOpportunity,
  CrmOpportunityAttachment,
  CrmOpportunityComment,
  CrmOpportunityLink,
  CrmOpportunityReference,
  CrmOpportunityStatus,
  CrmOpportunityStatusHistory,
  CrmOpportunityStatusTransition,
  CrmOpportunityTag,
  CrmOrderStatusMapping,
  CrmStatusPropagation,
  CrmTag,
  CrmValueCountingStatus,
];
