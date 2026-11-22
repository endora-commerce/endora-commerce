import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type {
  AdminI18nTranslatePort,
  AdminNotificationRecordPort,
  AdminSearchProviderRegistryPort,
  AdminTenantScopePort,
  AdminUserReadPort,
  AssetReadPort,
  AssetReferenceRegistryPort,
  AssetsLibraryPort,
  AuditReferenceRegistryPort,
  CatalogProductReadPort,
  CustomFieldListFilterPort,
  CustomFieldValuePort,
  EmailDefaultsRegistryPort,
  OpportunityReadPort,
  OrderListPort,
  OrderReadPort,
  OrganizationDetailsPort,
  PermissionReadPort,
  ProjectReadPort,
  QuoteRequestReadPort,
  ReportingTimeZonePort,
  SettingWriteValidatorRegistryPort,
  TaskContextRegistryPort,
  TaskReadPort,
  TaskWritePort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  effectiveState,
  lazyPort,
  type AuditPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { createProjectAdminSearchProvider } from './admin-search-provider.js';
import { STAGE_ALERT_DEFAULT, STAGE_ALERT_EMAIL_CODE } from './email-templates/stage-alert-defaults.js';
import { Project } from './entities/project.entity.js';
import { ProjectAttachment } from './entities/project-attachment.entity.js';
import { ProjectComment } from './entities/project-comment.entity.js';
import { ProjectLink } from './entities/project-link.entity.js';
import { ProjectLossReason } from './entities/project-loss-reason.entity.js';
import { ProjectMember } from './entities/project-member.entity.js';
import { ProjectMemberRole } from './entities/project-member-role.entity.js';
import { ProjectMessageRead } from './entities/project-message-read.entity.js';
import { ProjectMessageReadBaseline } from './entities/project-message-read-baseline.entity.js';
import { ProjectOrganization } from './entities/project-organization.entity.js';
import { ProjectReference } from './entities/project-reference.entity.js';
import { ProjectRole } from './entities/project-role.entity.js';
import { ProjectStage } from './entities/project-stage.entity.js';
import { ProjectStageAlertDelivery } from './entities/project-stage-alert-delivery.entity.js';
import { ProjectStageEntry } from './entities/project-stage-entry.entity.js';
import { ProjectStageMove } from './entities/project-stage-move.entity.js';
import { ProjectStageTask } from './entities/project-stage-task.entity.js';
import { ProjectTemplate } from './entities/project-template.entity.js';
import { ProjectTemplateRole } from './entities/project-template-role.entity.js';
import { ProjectTemplateStage } from './entities/project-template-stage.entity.js';
import { ProjectTemplateStageMove } from './entities/project-template-stage-move.entity.js';
import { ProjectTemplateStageTask } from './entities/project-template-stage-task.entity.js';
import { ProjectValueChange } from './entities/project-value-change.entity.js';
import { ProjectViewer } from './entities/project-viewer.entity.js';
import { ProjectListSavedView } from './entities/project-list-saved-view.entity.js';
import { registerAnalyticsRoutes } from './routes/routes.analytics.js';
import { registerAttachmentRoutes } from './routes/routes.attachments.js';
import { registerCommentRoutes } from './routes/routes.comments.js';
import { registerDictionaryRoutes } from './routes/routes.dictionaries.js';
import { registerHistoryRoutes } from './routes/routes.history.js';
import { registerLinkRoutes } from './routes/routes.links.js';
import { registerLookupRoutes } from './routes/routes.lookups.js';
import { registerProjectRoutes } from './routes/routes.projects.js';
import { registerProjectListViewRoutes } from './routes/routes.list-views.js';
import { registerStageTaskRoutes } from './routes/routes.stage-tasks.js';
import { registerStageRoutes } from './routes/routes.stages.js';
import { registerTemplateRoutes } from './routes/routes.templates.js';
import { createAlertsTimeZoneValidator } from './services/alerts-time-zone-validator.js';
import { ProjectAnalyticsService } from './services/analytics-service.js';
import { ProjectAttachmentService } from './services/attachment-service.js';
import { ProjectCommentService } from './services/comment-service.js';
import type { DictionaryService } from './services/dictionary-service.js';
import { ProjectDocumentLookupService } from './services/document-lookup-service.js';
import { ProjectHistoryService } from './services/history-service.js';
import { LinkService } from './services/link-service.js';
import { createLinkedRecordStatusNames } from './services/linked-record-status.js';
import { createLinkedRecordOwners, type LinkedRecordOwners } from './services/linked-records.js';
import { ProjectLookupService } from './services/lookup-service.js';
import { createLossReasonService } from './services/loss-reason-service.js';
import { ProjectMentionService } from './services/mention-service.js';
import { MoveService } from './services/move-service.js';
import { createOwnerReadChecks, type OwnerReadChecks } from './services/owner-read-permissions.js';
import { ProjectAccess, type ProjectAccessDeps } from './services/project-access.js';
import { registerProjectAssetReferences } from './services/project-asset-references.js';
import { registerProjectAuditReferences } from './services/project-audit-references.js';
import { createProjectNotifier, type ProjectNotifier } from './services/project-notifier.js';
import { ProjectReadPortService } from './services/project-read-port.js';
import { reportingTimeZoneOf } from './services/reporting-time-zone.js';
import { ProjectReadService } from './services/project-read-service.js';
import { ProjectListViewService } from './services/project-list-view-service.js';
import { ProjectService } from './services/project-service.js';
import { ProjectStageGuardRegistry } from './services/project-stage-guard-registry.js';
import type { ProjectTasks } from './services/project-tasks.js';
import { RecordProjectService } from './services/record-project-service.js';
import { ProjectReferenceService } from './services/reference-service.js';
import { createRoleService } from './services/role-service.js';
import { StageAlertService, StageAlertStore } from './services/stage-alert-service.js';
import { createStageAlertEmail } from './services/stage-alert-email.js';
import { StageService } from './services/stage-service.js';
import { StageTaskService } from './services/stage-task-service.js';
import { createProjectTaskContext } from './services/task-context-descriptor.js';
import { TemplateService } from './services/template-service.js';
import { stageAlertTick, startStageAlerts } from './workers/stage-alert-worker.js';

/**
 * `projects` — composed by the kernel container.
 *
 * **One file, deliberately** (CRM `research.md` N-6): `check:port-dependencies`
 * reads a module's registrations from the file that exports `registerModule`
 * and from no other, so every registration, route, subscriber and boot hook of
 * this module is written here, one delimited section per area, and a story adds
 * a section rather than a file.
 */

/** What this module reads from the container: the platform's services and its own. */
interface ProjectsCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly projectsAccess: ProjectAccess;
  readonly projectsReadService: ProjectReadService;
  readonly projectsService: ProjectService;
  readonly projectsStageService: StageService;
  readonly projectsMoveService: MoveService;
  readonly projectStageGuardRegistry: ProjectStageGuardRegistry;
  readonly projectsTasks: ProjectTasks;
  readonly projectsStageTaskService: StageTaskService;
  readonly projectsTemplateService: TemplateService;
  readonly projectsTranslate: ProjectsTranslate;
  readonly projectsRoleService: DictionaryService;
  readonly projectsLossReasonService: DictionaryService;
  readonly projectsLookupService: ProjectLookupService;
  readonly projectsOwnerReadChecks: OwnerReadChecks;
  readonly projectsLinkedRecordOwners: LinkedRecordOwners;
  readonly projectsLinkService: LinkService;
  readonly projectsRecordProjectService: RecordProjectService;
  readonly auditLogService: AuditPort;
  readonly projectsReferenceService: ProjectReferenceService;
  readonly projectsNotifier: ProjectNotifier;
  readonly projectsMentionService: ProjectMentionService;
  readonly projectsCommentService: ProjectCommentService;
  readonly projectsDocumentLookupService: ProjectDocumentLookupService;
  readonly projectsAttachmentService: ProjectAttachmentService;
  readonly projectsHistoryService: ProjectHistoryService;
  readonly projectsAnalyticsService: ProjectAnalyticsService;
  readonly projectsListViewService: ProjectListViewService;
}

/** What the deadline-alert section registers and reads (User Story 8). */
interface StageAlertsCradle {
  readonly projectsStageAlertService: StageAlertService;
  readonly projectsStageAlertTick: () => Promise<void>;
  /**
   * `transactional_emails`' late-bound sender, read per send. It answers
   * `undefined` until that module has announced it.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** Whether this process runs queue consumers — the platform's one answer. */
  readonly processRunsWorkers: boolean;
  /** The connection a module may build a queue on; undefined where a composition wants none. */
  readonly moduleQueueRedis: Redis | undefined;
}

/** `_i18n`'s resolver over this module's own bundles. */
type ProjectsTranslate = (
  key: string,
  language: Parameters<AdminI18nTranslatePort['translate']>[2],
  params?: Record<string, string | number>,
) => Promise<string>;

export function registerModule(ctx: ModuleContext): void {
  // --- Access (research R-2, R-3) --------------------------------------------
  // The module's only read path to a Project: every Project-owned entity is
  // `@RuleScoped` with no ORM filter behind it, so every list, count and read
  // by id composes this service's predicate or starts from a Project it
  // returned (`project-access-seam.test.ts`). The ports it asks — permissions,
  // another administrator's reach, administrators, settings — are resolved
  // lazily, per call, and never captured in this singleton.
  ctx.di.register({
    projectsAccess: ctx
      .asFunction(
        ({ emFactory }: ProjectsCradle) =>
          new ProjectAccess({
            emFactory,
            permissions: lazyPort<ProjectAccessDeps['permissions']>(ctx, 'permissionService'),
            tenantScopes: lazyPort<AdminTenantScopePort>(ctx, 'adminTenantScopePort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
          }),
      )
      .singleton(),
  });
  // --- end of Access -----------------------------------------------------------

  // --- Wording (research R-7, R-8) ---------------------------------------------
  // What this module stores as a key and words per reader — a Stage Task's
  // responsible-Role note, a duplicated Template's name — through `_i18n`'s
  // resolver, resolved lazily, per call.
  ctx.di.register({
    projectsTranslate: ctx
      .asFunction((): ProjectsTranslate => {
        const i18n = lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService');
        return (key, language, params) => i18n.translate('projects', key, language, params);
      })
      .singleton(),
  });
  // --- end of Wording ------------------------------------------------------------

  // --- Projects (read side) ------------------------------------------------------
  ctx.di.register({
    projectsReadService: ctx
      .asFunction(
        ({ emFactory, projectsAccess, projectsReferenceService }: ProjectsCradle) =>
          new ProjectReadService({
            emFactory,
            access: projectsAccess,
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            references: projectsReferenceService,
            customFields: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
            customFieldListFilter: lazyPort<CustomFieldListFilterPort>(ctx, 'customFieldListFilterPort'),
          }),
      )
      .singleton(),
  });
  // --- end of Projects (read side) -------------------------------------------------

  // --- Tasks (User Story 2, research R-8, R-9) ---------------------------------------
  // The Tasks module is optional (FR-040): Projects only *degrades* without it
  // (the manifest's `degrades-without` edges on both ports). Every caller asks
  // `present()` first and only then calls a port, so a switched-off Tasks
  // module is a decision, never a caught refusal.
  ctx.di.register({
    projectsTasks: ctx
      .asFunction(
        (): ProjectTasks => ({
          present: () => effectiveState.isPresent('tasks'),
          read: lazyPort<TaskReadPort>(ctx, 'taskReadPort'),
          write: lazyPort<TaskWritePort>(ctx, 'taskWritePort'),
        }),
      )
      .singleton(),
  });
  /**
   * The `project` Task context — a **contribution** hook. It pushes an inert
   * descriptor into `taskContextRegistry`, an ungated registry `tasks` owns,
   * and carries no presence probe: the registry enumerates only descriptors
   * whose owner is effectively present, so Project Tasks are hidden while
   * Projects is off and back without a restart when it is on. In an instance
   * without `tasks` the push is dropped by the platform.
   */
  ctx.onBoot(() => {
    lazyPort<TaskContextRegistryPort>(ctx, 'taskContextRegistry').register(
      createProjectTaskContext({
        access: ctx.cradle<ProjectsCradle>().projectsAccess,
        emFactory: ctx.cradle<ProjectsCradle>().emFactory,
        translate: ctx.cradle<ProjectsCradle>().projectsTranslate,
      }),
    );
  });
  // --- end of Tasks ------------------------------------------------------------------

  // --- Settings ----------------------------------------------------------------------
  /**
   * `projects.alerts_time_zone` must be a zone the runtime knows (pulled
   * forward from T118) — a **contribution** hook into `settings`' validator
   * registry, which filters contributors by presence when it is read.
   */
  ctx.onBoot(() => {
    lazyPort<SettingWriteValidatorRegistryPort>(ctx, 'settingWriteValidatorRegistry').register(
      createAlertsTimeZoneValidator(),
    );
  });
  // --- end of Settings ---------------------------------------------------------------

  // --- Projects (writes, User Story 1) -----------------------------------------------
  // Create, edit and delete a Project, its Organizations and its Members. Every
  // write is a Command (Constitution XIII) and starts from `ProjectAccess`.
  ctx.di.register({
    projectsService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          projectsAccess,
          projectsReadService,
          projectsTasks,
          projectsTemplateService,
          projectsStageTaskService,
          projectsReferenceService,
          projectsMentionService,
        }: ProjectsCradle) =>
          new ProjectService({
            emFactory,
            commandBus,
            access: projectsAccess,
            read: projectsReadService,
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            tasks: projectsTasks,
            templates: projectsTemplateService,
            stageTasks: projectsStageTaskService,
            references: projectsReferenceService,
            mentions: projectsMentionService,
            customFields: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
          }),
      )
      .singleton(),
  });
  // --- end of Projects (writes) ------------------------------------------------------

  // --- Templates (User Story 3, research R-7) ------------------------------------------
  // Platform-wide configuration, copied into a Project when one is created
  // from it — never referenced — so nothing here reads a Project.
  ctx.di.register({
    projectsTemplateService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsTranslate }: ProjectsCradle) =>
          new TemplateService({ emFactory, commandBus, translate: projectsTranslate }),
      )
      .singleton(),
  });
  // --- end of Templates ----------------------------------------------------------------

  // --- Project Roles and loss reasons (User Story 4) --------------------------------------
  // Platform-wide configuration. A Role is a label a Member holds — it grants
  // no permission (FR-009); nothing here touches `admin_roles`.
  ctx.di.register({
    projectsRoleService: ctx
      .asFunction(({ emFactory, commandBus }: ProjectsCradle) => createRoleService({ emFactory, commandBus }))
      .singleton(),
    projectsLossReasonService: ctx
      .asFunction(({ emFactory, commandBus }: ProjectsCradle) => createLossReasonService({ emFactory, commandBus }))
      .singleton(),
  });
  // --- end of Project Roles and loss reasons ------------------------------------------------

  // --- Lookups (User Story 5) ------------------------------------------------------------
  // What the screens' pickers choose from — Organizations, Members, listed
  // people — read through their owners' ports and gated by this module's own
  // codes, so running Projects needs no other module's permission (the CRM
  // precedent). Organizations are narrowed to the caller's reach here.
  ctx.di.register({
    projectsLookupService: ctx
      .asFunction(
        () =>
          new ProjectLookupService({
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  // --- end of Lookups ---------------------------------------------------------------------

  // --- Linked records and the record panel (User Story 6, research R-10, R-11) ------
  // Orders, Quote Requests and Opportunities, through their owners' read
  // ports. `orders` is binding; `crm` and `quote_requests` are switchable and
  // this module degrades without them (`degrades-without`): every caller goes
  // through `linked-records.ts` and decides presence there before a port is
  // asked, and what a link shows of its record is the owner's read code's to
  // allow (`owner-read-permissions.ts`).
  ctx.di.register({
    projectsOwnerReadChecks: ctx
      .asFunction(() => createOwnerReadChecks(lazyPort<PermissionReadPort>(ctx, 'permissionService')))
      .singleton(),
    projectsLinkedRecordOwners: ctx
      .asFunction(() =>
        createLinkedRecordOwners({
          orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          quoteRequests: lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort'),
          opportunities: lazyPort<OpportunityReadPort>(ctx, 'opportunityReadPort'),
        }),
      )
      .singleton(),
    projectsLinkService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsAccess, projectsLinkedRecordOwners, projectsOwnerReadChecks }: ProjectsCradle) =>
          new LinkService({
            emFactory,
            commandBus,
            access: projectsAccess,
            owners: projectsLinkedRecordOwners,
            statusNames: createLinkedRecordStatusNames({
              orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
              quoteRequests: lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort'),
              opportunities: lazyPort<OpportunityReadPort>(ctx, 'opportunityReadPort'),
            }),
            mayRead: projectsOwnerReadChecks,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
    projectsRecordProjectService: ctx
      .asFunction(
        ({
          emFactory,
          projectsAccess,
          projectsReadService,
          projectsLinkedRecordOwners,
          projectsTasks,
          projectsOwnerReadChecks,
        }: ProjectsCradle) =>
          new RecordProjectService({
            emFactory,
            access: projectsAccess,
            read: projectsReadService,
            owners: projectsLinkedRecordOwners,
            tasks: projectsTasks,
            mayRead: projectsOwnerReadChecks,
          }),
      )
      .singleton(),
  });
  // --- end of Linked records -----------------------------------------------------------

  // --- Platform integration (User Story 11) ----------------------------------------
  /**
   * `projectReadPort` (`contracts/ports-and-events.md` §2) — `providePort`:
   * gated, so a consumer resolving it while this module is off gets
   * `ModuleDisabledError` (503 `MODULE_DISABLED`). Every answer starts from
   * `ProjectAccess` under the caller's context (`project-read-port.ts`).
   */
  ctx.di.providePort<ProjectReadPort>(
    'projectReadPort',
    ctx
      .asFunction(
        ({ projectsAccess, projectsReadService, projectsRecordProjectService }: ProjectsCradle) =>
          new ProjectReadPortService({
            access: projectsAccess,
            read: projectsReadService,
            records: projectsRecordProjectService,
          }),
      )
      .singleton(),
  );
  /**
   * The Project record type for admin global search (`contracts/admin-surfaces.md`
   * §6) — a **contribution** hook: it pushes an inert provider into
   * `admin_search`'s ungated registry and does nothing else, so it carries no
   * presence probe. The registry leaves it out at enumeration while this module
   * is switched off, and switching it back on needs no restart.
   */
  ctx.onBoot(() => {
    lazyPort<AdminSearchProviderRegistryPort>(ctx, 'adminSearchProviderRegistry').register(
      createProjectAdminSearchProvider({
        search: (query) => ctx.cradle<ProjectsCradle>().projectsReadService.searchForAdmin(query),
        translate: (key, language) => ctx.cradle<ProjectsCradle>().projectsTranslate(key, language),
      }),
    );
  });
  // --- end of Platform integration ---------------------------------------------------

  // --- Stages, workflow and walking a Project (User Story 1) -------------------------
  // The guard registry is a **contribution seam** (research R-6): other modules
  // and deployments push a guard into it from a contribution-only boot hook,
  // so it is registered ungated (`ctx.di.register`, never `providePort`) — a
  // boot hook that resolved a gated name would stop the backend from starting
  // whenever this module was switched off. Nothing reads it while the module is
  // off: its only reader is the move service, reached through this module's
  // gated routes.
  //
  // Enumeration policy: a guard whose owner module is not effectively present
  // is skipped at dispatch. `effectiveState` is the kernel's one answer to "is
  // this module present", on both axes.
  ctx.di.register({
    projectStageGuardRegistry: ctx
      .asFunction(() => new ProjectStageGuardRegistry((moduleId) => effectiveState.isPresent(moduleId)))
      .singleton(),
    projectsStageService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsAccess, projectsReadService, projectsTasks }: ProjectsCradle) =>
          new StageService({
            emFactory,
            commandBus,
            access: projectsAccess,
            read: projectsReadService,
            tasks: projectsTasks,
          }),
      )
      .singleton(),
    // Stage Tasks and the completion gate (User Story 2, R-7, R-8).
    projectsStageTaskService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsAccess, projectsReadService, projectsTasks }: ProjectsCradle) =>
          new StageTaskService({
            emFactory,
            commandBus,
            access: projectsAccess,
            read: projectsReadService,
            tasks: projectsTasks,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
    projectsMoveService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          projectsAccess,
          projectsReadService,
          projectStageGuardRegistry,
          projectsStageTaskService,
          projectsTasks,
        }: ProjectsCradle) =>
          new MoveService({
            emFactory,
            commandBus,
            access: projectsAccess,
            read: projectsReadService,
            guards: projectStageGuardRegistry,
            stageTasks: projectsStageTaskService,
            tasks: projectsTasks,
          }),
      )
      .singleton(),
  });
  // --- end of Stages -----------------------------------------------------------------

  // --- Collaboration (User Story 7, research R-13, R-14, R-17) ----------------------
  // Notes, the message thread, references in texts, attachments and the
  // history. References resolve through their owners' ports, each kind only
  // with its owner's read code and — for the two switchable owners — only
  // after presence is decided at their one door (`linked-records.ts`,
  // `project-tasks.ts`). Products are `catalog`'s, a binding dependency.
  //
  // The bell is `admin_notifications`', which an operator may switch off; this
  // module degrades without it (`degrades-without`): the notifier decides that
  // module's presence before it asks, so a message or a mention is stored
  // either way and nothing here catches a refusal. Who is told at all is
  // `ProjectAccess.canSeeAs`.
  //
  // Attachments are the asset library's files, through its ports; the history
  // is the platform's audit log (`auditLogService`, a platform service).
  ctx.di.register({
    projectsReferenceService: ctx
      .asFunction(
        ({ projectsAccess, projectsLinkedRecordOwners, projectsTasks, projectsOwnerReadChecks }: ProjectsCradle) =>
          new ProjectReferenceService({
            products: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            quoteRequests: projectsLinkedRecordOwners,
            tasks: projectsTasks,
            projects: projectsAccess,
            mayRead: projectsOwnerReadChecks,
          }),
      )
      .singleton(),
    projectsNotifier: ctx
      .asFunction(() =>
        createProjectNotifier(lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort')),
      )
      .singleton(),
    projectsMentionService: ctx
      .asFunction(
        ({ projectsAccess, projectsNotifier }: ProjectsCradle) =>
          new ProjectMentionService({
            access: projectsAccess,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            notifier: projectsNotifier,
          }),
      )
      .singleton(),
    projectsCommentService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          projectsAccess,
          projectsNotifier,
          projectsReferenceService,
          projectsMentionService,
        }: ProjectsCradle) =>
          new ProjectCommentService({
            emFactory,
            commandBus,
            access: projectsAccess,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            notifier: projectsNotifier,
            references: projectsReferenceService,
            mentions: projectsMentionService,
          }),
      )
      .singleton(),
    projectsDocumentLookupService: ctx
      .asFunction(
        ({ projectsAccess, projectsLinkedRecordOwners, projectsTasks, projectsOwnerReadChecks }: ProjectsCradle) =>
          new ProjectDocumentLookupService({
            access: projectsAccess,
            orders: lazyPort<OrderListPort>(ctx, 'orderListPort'),
            quoteRequests: projectsLinkedRecordOwners,
            tasks: projectsTasks,
            mayRead: projectsOwnerReadChecks,
          }),
      )
      .singleton(),
    projectsAttachmentService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsAccess }: ProjectsCradle) =>
          new ProjectAttachmentService({
            emFactory,
            commandBus,
            access: projectsAccess,
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            assetsLibrary: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
    projectsHistoryService: ctx
      .asFunction(
        ({ emFactory, projectsAccess, auditLogService, projectsReferenceService, projectsOwnerReadChecks }: ProjectsCradle) =>
          new ProjectHistoryService({
            emFactory,
            access: projectsAccess,
            auditLog: auditLogService,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            references: projectsReferenceService,
            mayReadCustomFields: projectsOwnerReadChecks.customFields,
          }),
      )
      .singleton(),
  });

  /**
   * The asset-reference scanner — a **contribution** hook. It pushes an inert
   * descriptor into `assetReferenceRegistry`, an ungated registry
   * `assets_library` owns, and carries no presence probe: the attachments
   * survive a deactivation, so a scanner registered only while the module is
   * on would let an operator delete a file that comes back as a broken
   * attachment when Projects is switched on again (Constitution XVII).
   */
  //
  // The descriptor is also **reader-restricted** (`specs/166-asset-reference-visibility/`
  // FR-002): the library shows a file only to a reader who may see a record
  // using it, and asks this module which Projects the caller may see. It asks
  // only while Projects is present — the library decides that, not this hook —
  // and `ProjectAccess` is resolved per call through a getter, never here.
  ctx.onBoot(() => {
    registerProjectAssetReferences(
      lazyPort<AssetReferenceRegistryPort>(ctx, 'assetReferenceRegistry'),
      ctx.cradle<ProjectsCradle>().emFactory,
      { access: () => ctx.cradle<ProjectsCradle>().projectsAccess },
    );
  });

  /**
   * The audit-reference resolver — a **contribution** hook into
   * `auditReferenceRegistry`, an ungated registry `audit_logs` owns. No
   * presence probe: the registry skips this entry while the module is absent.
   */
  ctx.onBoot(() => {
    registerProjectAuditReferences(lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'), () => {
      const cradle = ctx.cradle<ProjectsCradle>();
      return { access: cradle.projectsAccess, emFactory: cradle.emFactory };
    });
  });
  // --- end of Collaboration --------------------------------------------------------

  // --- Deadline alerts (User Story 8, research R-12) ---------------------------------
  // A sweep, not timers: the Stages are the schedule, and one pass claims what
  // is due today — one row per (Stage, offset, deadline) — before it delivers
  // anything. Who is told is read when the alert goes out: the Project's
  // Members who may see it at that moment (`ProjectAccess.canSeeAs`). The bell
  // is this module's notifier, which decides `admin_notifications`' presence
  // itself; the e-mail goes out through `transactional_emails`' sender, read
  // off the cradle per send — it is a function, announced late, and `lazyPort`
  // forwards method calls only.
  ctx.di.register({
    projectsStageAlertService: ctx
      .asFunction(
        ({ emFactory, commandBus, projectsAccess, projectsReadService, projectsNotifier }: ProjectsCradle) =>
          new StageAlertService({
            store: new StageAlertStore({ emFactory, commandBus }),
            timeZone: () => projectsReadService.timeZone(),
            access: projectsAccess,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            notifier: projectsNotifier,
            email: createStageAlertEmail({
              sender: () => ctx.cradle<StageAlertsCradle>().transactionalEmailSenderAccessor(),
              log: (message, context) => ctx.log.warn(context, message),
            }),
            log: (message, context) => ctx.log.warn(context, message),
          }),
      )
      .singleton(),
    // What one tick of the clock runs. Registered, so that what a test drives
    // is what the consumer runs: presence first, then one pass.
    projectsStageAlertTick: ctx
      .asFunction(({ projectsStageAlertService }: StageAlertsCradle) =>
        stageAlertTick({
          alerts: projectsStageAlertService,
          isPresent: () => effectiveState.isPresent('projects'),
          log: ctx.log,
        }),
      )
      .singleton(),
  });

  /**
   * The alert e-mail's default subject and body — a **contribution** hook. It
   * pushes an inert descriptor into `emailDefaultsPort`, the ungated registry
   * `transactional_emails` owns and reads once at boot, and carries no
   * presence probe: the definition is seeded from this module's manifest
   * whether the module is on or off, and a push skipped here would leave it
   * with an empty body until the next restart after a reactivation.
   */
  ctx.onBoot(() => {
    lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort').register(
      STAGE_ALERT_EMAIL_CODE,
      STAGE_ALERT_DEFAULT,
      'projects',
    );
  });

  // The clock: a Job Scheduler and its consumer, attached where `app.log`
  // exists and through `ctx.worker`, which is what stops it with the module.
  // Built only where the host says this process consumes queues and offers a
  // connection; the shared test server says neither and drives the tick itself.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<StageAlertsCradle>();
    await startStageAlerts({
      tick: cradle.projectsStageAlertTick,
      isPresent: () => effectiveState.isPresent('projects'),
      hasWork: () => cradle.projectsStageAlertService.hasWork(),
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });
  // --- end of Deadline alerts --------------------------------------------------------

  // --- Analytics (User Story 10, research R-15) -----------------------------------------
  // Seven figures over a range of days, each one grouped statement carrying
  // `ProjectAccess`'s predicate for the reader, so no figure counts a Project
  // the reader may not see.
  ctx.di.register({
    projectsAnalyticsService: ctx
      .asFunction(
        ({ emFactory, projectsAccess, projectsReadService }: ProjectsCradle) =>
          new ProjectAnalyticsService({
            emFactory,
            access: projectsAccess,
            read: projectsReadService,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            // `analytics`' reporting time zone, or UTC while it is off (`degrades-without`).
            reportingTimeZone: reportingTimeZoneOf({
              present: () => effectiveState.isPresent('analytics'),
              port: lazyPort<ReportingTimeZonePort>(ctx, 'reportingTimeZonePort'),
            }),
          }),
      )
      .singleton(),
  });
  // --- end of Analytics ---------------------------------------------------------------

  // --- Saved views (issue #1734) ------------------------------------------------------
  // Named presets of the Projects list's filters and sort, on feature 147's rules
  // (`specs/147-saved-views/`). A view is an administrator's own UI configuration,
  // not a domain write, so it does not run through the Command Bus (feature 147
  // research R-14), and it is no row of any Project, so it is outside
  // `ProjectAccess`: applying one re-runs the list under the applier's visibility.
  ctx.di.register({
    projectsListViewService: ctx
      .asFunction(({ emFactory }: ProjectsCradle) => new ProjectListViewService(emFactory, ctx.log))
      .singleton(),
  });
  // --- end of Saved views -------------------------------------------------------------

  // --- Routes ------------------------------------------------------------------------
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<ProjectsCradle>();
    await registerProjectRoutes(app, {
      projectReadService: cradle.projectsReadService,
      projectService: cradle.projectsService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerStageRoutes(app, {
      projectReadService: cradle.projectsReadService,
      stageService: cradle.projectsStageService,
      moveService: cradle.projectsMoveService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerStageTaskRoutes(app, {
      stageTaskService: cradle.projectsStageTaskService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerTemplateRoutes(app, {
      templateService: cradle.projectsTemplateService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerLookupRoutes(app, {
      lookupService: cradle.projectsLookupService,
      access: cradle.projectsAccess,
      mentionService: cradle.projectsMentionService,
      documentLookupService: cradle.projectsDocumentLookupService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerCommentRoutes(app, {
      commentService: cradle.projectsCommentService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerAttachmentRoutes(app, {
      attachmentService: cradle.projectsAttachmentService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerHistoryRoutes(app, {
      historyService: cradle.projectsHistoryService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerLinkRoutes(app, {
      linkService: cradle.projectsLinkService,
      recordProjectService: cradle.projectsRecordProjectService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerDictionaryRoutes(app, {
      roleService: cradle.projectsRoleService,
      lossReasonService: cradle.projectsLossReasonService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerAnalyticsRoutes(app, {
      analyticsService: cradle.projectsAnalyticsService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerProjectListViewRoutes(app, {
      listViewService: cradle.projectsListViewService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  // --- end of Routes -----------------------------------------------------------------
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 *
 * Twenty-five classes, the whole schema of the module
 * (`specs/163-projects-and-tasks/data-model.md` §2): the configuration is
 * `@GlobalEntity`, everything a Project owns is `@RuleScoped` and read only
 * through `ProjectAccess`. The twenty-fifth, `ProjectListSavedView`, holds the
 * list's saved views (issue #1734): an administrator's own row, `@GlobalEntity`.
 */
export const entities = [
  // Configuration (`@GlobalEntity`).
  ProjectRole,
  ProjectLossReason,
  ProjectTemplate,
  ProjectTemplateRole,
  ProjectTemplateStage,
  ProjectTemplateStageTask,
  ProjectTemplateStageMove,
  ProjectMessageReadBaseline,
  // An administrator's saved list views (`@GlobalEntity`, issue #1734).
  ProjectListSavedView,
  // A Project and what it owns (`@RuleScoped`).
  Project,
  ProjectOrganization,
  ProjectMember,
  ProjectMemberRole,
  ProjectViewer,
  ProjectStage,
  ProjectStageTask,
  ProjectStageMove,
  ProjectStageEntry,
  ProjectLink,
  ProjectComment,
  ProjectMessageRead,
  ProjectReference,
  ProjectAttachment,
  ProjectStageAlertDelivery,
  ProjectValueChange,
];

/**
 * The door to `projects_number_seq`, published **by name** on `./backend`, as
 * `tasks`' `nextTaskNumber` and CRM's `nextOpportunityNumber` are: the demo
 * composition creating Projects takes its numbers here, so there is one
 * statement of the format and one sequence. A function is not an entity class,
 * which is what D-168 bars from this door.
 */
export { nextProjectNumber } from './services/project-number.js';
