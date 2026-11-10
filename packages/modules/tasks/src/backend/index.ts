import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import {
  TaskTimeZoneSchema,
  type AdminI18nTranslatePort,
  type AdminNotificationRecordPort,
  type AdminSearchProviderRegistryPort,
  type AdminUserReadPort,
  type AssetReadPort,
  type AssetReferenceRegistryPort,
  type AssetsLibraryPort,
  type AuditReferenceRegistryPort,
  type CatalogProductReadPort,
  type CustomFieldDefinitionReadPort,
  type CustomFieldListFilterPort,
  type CustomFieldValuePort,
  type EmailDefaultsRegistryPort,
  type OpportunityReadPort,
  type OrderListPort,
  type OrderReadPort,
  type PermissionReadPort,
  type ProjectReadPort,
  type QuoteRequestReadPort,
  type SettingsAdminPort,
  type SettingWriteValidatorRegistryPort,
  type TaskReadPort,
  type TaskWritePort,
  type TransactionalEmailSender,
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
import { createTaskAdminSearchProvider } from './admin-search-provider.js';
import { TASK_DIGEST_DEFAULT, TASK_DIGEST_EMAIL_CODE } from './email-templates/digest-defaults.js';
import { TASK_REMINDER_DEFAULT, TASK_REMINDER_EMAIL_CODE } from './email-templates/reminder-defaults.js';
import { Task } from './entities/task.entity.js';
import { TaskAssignee } from './entities/task-assignee.entity.js';
import { TaskAttachment } from './entities/task-attachment.entity.js';
import { TaskValueChange } from './entities/task-value-change.entity.js';
import { TaskComment } from './entities/task-comment.entity.js';
import { TaskDigestSubscription } from './entities/task-digest-subscription.entity.js';
import { TaskListSavedView } from './entities/task-list-saved-view.entity.js';
import { TaskPriority } from './entities/task-priority.entity.js';
import { TaskRecordLink } from './entities/task-record-link.entity.js';
import { TaskReference } from './entities/task-reference.entity.js';
import { TaskRelation } from './entities/task-relation.entity.js';
import { TaskReminder } from './entities/task-reminder.entity.js';
import { TaskReminderDelivery } from './entities/task-reminder-delivery.entity.js';
import { TaskStatus } from './entities/task-status.entity.js';
import { TaskStatusTransition } from './entities/task-status-transition.entity.js';
import { TaskTag } from './entities/task-tag.entity.js';
import { TaskTagAssignment } from './entities/task-tag-assignment.entity.js';
import { registerTaskBoardRoutes } from './routes/routes.board.js';
import { registerTaskCollaborationRoutes } from './routes/routes.collaboration.js';
import { registerTaskPriorityRoutes } from './routes/routes.priorities.js';
import { registerTaskReminderRoutes } from './routes/routes.reminders.js';
import { registerTaskSettingsRoutes } from './routes/routes.settings.js';
import { registerTaskTagRoutes } from './routes/routes.tags.js';
import { registerTaskRoutes } from './routes/routes.tasks.js';
import { registerTaskViewRoutes } from './routes/routes.views.js';
import { registerTaskWorkflowRoutes } from './routes/routes.workflow.js';
import { TaskAttachmentService } from './services/attachment-service.js';
import { TaskBoardCardFieldService } from './services/board-card-field-service.js';
import { TaskBoardService } from './services/board-service.js';
import { TaskCommentService } from './services/comment-service.js';
import { TaskDigestService } from './services/digest-service.js';
import { TaskHierarchyService } from './services/hierarchy-service.js';
import { TaskRelationService } from './services/relation-service.js';
import { TaskDocumentLookupService } from './services/document-lookup-service.js';
import { createTaskAudience, TaskMentionService, type TaskAudience } from './services/mention-service.js';
import {
  createOwnerReadCheck,
  createOwnerReadChecks,
  TASKS_READ_PERMISSION,
  type OwnerReadChecks,
} from './services/owner-read-permissions.js';
import { TaskPriorityService } from './services/priority-service.js';
import { TaskRecordLinkService } from './services/record-link-service.js';
import { TaskReminderService } from './services/reminder-service.js';
import { createTaskRecordOwners, type TaskRecordOwners } from './services/record-owners.js';
import { TaskListViewService } from './services/saved-view-service.js';
import { TaskReferenceService } from './services/reference-service.js';
import { TaskTagService } from './services/tag-service.js';
import { registerTaskAssetReferences } from './services/task-asset-references.js';
import { actingAdminUserId, TaskAccess } from './services/task-access.js';
import { registerTaskAuditReferences } from './services/task-audit-references.js';
import { TaskContextRegistry } from './services/task-context-registry.js';
import { createTaskEmail, type TaskEmail } from './services/task-email.js';
import { TaskHistoryService } from './services/task-history-service.js';
import { TaskMaintenanceService } from './services/maintenance-service.js';
import { createTaskNotifier, type TaskNotifier } from './services/task-notifier.js';
import { TaskReadPortService } from './services/task-read-port.js';
import { TaskService } from './services/task-service.js';
import { TaskSettingsService } from './services/task-settings-service.js';
import { isSystemActor, TaskVisibility } from './services/task-visibility.js';
import { TaskTransitionService } from './services/task-transition-service.js';
import { TaskWorkflowRead } from './services/task-workflow-read.js';
import { TaskWritePortService } from './services/task-write-port.js';
import { createTaskTimeZoneValidator } from './services/time-zone-validator.js';
import { TaskWorkflowConfigService } from './services/workflow-config-service.js';
import {
  createTasksRemindersJob,
  startTasksReminders,
  TASKS_DIGEST_SCOPE_REASON,
  TASKS_MAINTENANCE_SCOPE_REASON,
  TASKS_REMINDERS_SCOPE_REASON,
  type TasksRemindersJob,
} from './workers/tasks-reminders-worker.js';

/**
 * `tasks` — composed by the kernel container.
 *
 * **One file, deliberately** (CRM `research.md` N-6): `check:port-dependencies`
 * reads a module's registrations from the file that exports `registerModule`
 * and from no other, so every registration, route, subscriber and boot hook of
 * this module is written here, one delimited section per area, and a story adds
 * a section rather than a file.
 */

/** What this module reads from the container: the platform's services and its own. */
interface TasksCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly auditLogService: AuditPort;
  readonly taskContextRegistry: TaskContextRegistry;
  readonly tasksVisibility: TaskVisibility;
  readonly tasksAccess: TaskAccess;
  readonly tasksWorkflowRead: TaskWorkflowRead;
  readonly tasksNotifier: TaskNotifier;
  readonly tasksTaskService: TaskService;
  readonly tasksHistoryService: TaskHistoryService;
  readonly tasksOwnerReadChecks: OwnerReadChecks;
  readonly tasksRecordOwners: TaskRecordOwners;
  readonly tasksAudience: TaskAudience;
  readonly tasksReferenceService: TaskReferenceService;
  readonly tasksMentionService: TaskMentionService;
  readonly tasksDocumentLookupService: TaskDocumentLookupService;
  readonly tasksPriorityService: TaskPriorityService;
  readonly tasksTagService: TaskTagService;
  readonly tasksAttachmentService: TaskAttachmentService;
  readonly tasksCommentService: TaskCommentService;
  readonly tasksHierarchyService: TaskHierarchyService;
  readonly tasksRelationService: TaskRelationService;
  readonly tasksRecordLinkService: TaskRecordLinkService;
  readonly tasksTransitionService: TaskTransitionService;
  readonly tasksWorkflowConfigService: TaskWorkflowConfigService;
  readonly tasksBoardCardFieldService: TaskBoardCardFieldService;
  readonly tasksBoardService: TaskBoardService;
  readonly tasksListViewService: TaskListViewService;
  readonly tasksSettingsService: TaskSettingsService;
  readonly tasksEmail: TaskEmail;
  readonly tasksReminderService: TaskReminderService;
  readonly tasksDigestService: TaskDigestService;
  readonly tasksMaintenanceService: TaskMaintenanceService;
  readonly tasksRemindersJob: TasksRemindersJob;
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

export function registerModule(ctx: ModuleContext): void {
  // --- Context (research R-1, R-9) -------------------------------------------
  // The Task contexts other modules own. A **contribution seam**: registered
  // ungated (`ctx.di.register`, never `providePort`), so a contributor's boot
  // hook can push into it whatever this module's state — a boot hook resolving
  // a gated port would stop the backend starting while `tasks` is off.
  //
  // Enumeration policy: fail-closed. A descriptor whose owner is not
  // effectively present is never enumerated, so its Tasks are hidden, and
  // return without a restart when the owner is back (the registry's header).
  //
  // Visibility is the module's only read path (`Task` is `@RuleScoped`): every
  // list, count and read by id asks it, under the caller's own context. It
  // also carries the draft/private rule (`specs/165-task-management/` R-3):
  // who the caller is and whether they hold `tasks:see_private`, asked of
  // `admin_roles`' `permissionService` per call, never for the system.
  // `TaskAccess` is how a route obtains one Task, and what it may do with it.
  ctx.di.register({
    taskContextRegistry: ctx
      .asFunction(() => new TaskContextRegistry((moduleId) => effectiveState.isPresent(moduleId)))
      .singleton(),
    tasksVisibility: ctx
      .asFunction(({ taskContextRegistry }: TasksCradle) => {
        // The published read port plus the capability check `hasPermission`,
        // which the container entry carries beside it (Projects' precedent).
        const permissions = lazyPort<
          PermissionReadPort & { hasPermission(adminUserId: string, permission: string): Promise<boolean> }
        >(ctx, 'permissionService');
        return new TaskVisibility({
          contributors: () => taskContextRegistry.present(),
          isSystemActor,
          viewer: async () => {
            const adminUserId = actingAdminUserId();
            if (adminUserId === null) return { adminUserId: null, seePrivate: false };
            return { adminUserId, seePrivate: await permissions.hasPermission(adminUserId, 'tasks:see_private') };
          },
        });
      })
      .singleton(),
    tasksAccess: ctx
      .asFunction(
        ({ emFactory, tasksVisibility, taskContextRegistry }: TasksCradle) =>
          new TaskAccess({ emFactory, visibility: tasksVisibility, contexts: taskContextRegistry }),
      )
      .singleton(),
    // The workflow and the priority list — global configuration (R-1, R-9).
    tasksWorkflowRead: ctx.asFunction(({ emFactory }: TasksCradle) => new TaskWorkflowRead(emFactory)).singleton(),
  });
  // --- end of Context ----------------------------------------------------------

  // --- References and configuration lists (User Story 1, research R-5, R-9, R-10)
  // What a Task's text refers to, resolved per reader through the owners'
  // ports, each kind only with its owner's read code. `orders` and `catalog`
  // cannot be switched off and are binding dependencies; `quote_requests`,
  // `crm` and `projects` are operator-switchable and this module only
  // *degrades* without them (the manifest's `degrades-without` edges): their
  // one door (`record-owners.ts`) decides presence before a port is asked, and
  // nothing here catches a refusal. A Task referred to is read through this
  // module's own visibility seam.
  //
  // The priority list and the tag list are this module's configuration; their
  // usage counts compose the visibility pre-filter.
  ctx.di.register({
    tasksOwnerReadChecks: ctx
      .asFunction(() => createOwnerReadChecks(lazyPort<PermissionReadPort>(ctx, 'permissionService')))
      .singleton(),
    tasksRecordOwners: ctx
      .asFunction(() =>
        createTaskRecordOwners({
          quoteRequests: lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort'),
          opportunities: lazyPort<OpportunityReadPort>(ctx, 'opportunityReadPort'),
          projects: lazyPort<ProjectReadPort>(ctx, 'projectReadPort'),
        }),
      )
      .singleton(),
    // Who besides the caller may see a Task — who may be assigned, mentioned or told.
    tasksAudience: ctx
      .asFunction(({ taskContextRegistry }: TasksCradle) =>
        createTaskAudience({
          permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
          contexts: taskContextRegistry,
        }),
      )
      .singleton(),
    tasksReferenceService: ctx
      .asFunction(
        ({ tasksRecordOwners, tasksOwnerReadChecks }: TasksCradle) =>
          new TaskReferenceService({
            products: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            owners: tasksRecordOwners,
            // Read off the cradle per call: the task service is composed after this one.
            tasks: (ids) => ctx.cradle<TasksCradle>().tasksTaskService.visibleRowsByIds(ids),
            mayRead: tasksOwnerReadChecks,
          }),
      )
      .singleton(),
    tasksMentionService: ctx
      .asFunction(
        ({ tasksAccess, tasksAudience, tasksNotifier }: TasksCradle) =>
          new TaskMentionService({
            access: tasksAccess,
            audience: tasksAudience,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            notifier: tasksNotifier,
          }),
      )
      .singleton(),
    tasksDocumentLookupService: ctx
      .asFunction(
        ({ tasksRecordOwners, tasksOwnerReadChecks }: TasksCradle) =>
          new TaskDocumentLookupService({
            orders: lazyPort<OrderListPort>(ctx, 'orderListPort'),
            owners: tasksRecordOwners,
            tasks: (q, limit) => ctx.cradle<TasksCradle>().tasksTaskService.searchVisibleRows(q, limit),
            mayRead: tasksOwnerReadChecks,
          }),
      )
      .singleton(),
    tasksPriorityService: ctx
      .asFunction(
        ({ emFactory, tasksWorkflowRead, tasksVisibility, commandBus, auditLogService }: TasksCradle) =>
          new TaskPriorityService({
            emFactory,
            workflow: tasksWorkflowRead,
            visibility: tasksVisibility,
            commandBus,
            auditLog: auditLogService,
          }),
      )
      .singleton(),
    tasksTagService: ctx
      .asFunction(
        ({ emFactory, commandBus, tasksVisibility }: TasksCradle) =>
          new TaskTagService({ emFactory, commandBus, visibility: tasksVisibility }),
      )
      .singleton(),
  });
  // --- end of References and configuration lists ----------------------------------

  // --- Workflow (User Story 2, research R-1) -------------------------------------
  // The operator's statuses and moves. A status change goes through the one
  // door, `TaskTransitionService`, whoever asks for it — the detail screen, the
  // board, a context owner. The configuration writes are Commands that end by
  // holding the whole workflow to FR-013; removing a status in use moves its
  // Tasks, each with an audit row of its own through the kernel's audit port.
  ctx.di.register({
    tasksTransitionService: ctx
      .asFunction(
        ({ commandBus, tasksAccess, tasksWorkflowRead }: TasksCradle) =>
          new TaskTransitionService({ commandBus, access: tasksAccess, workflow: tasksWorkflowRead }),
      )
      .singleton(),
    tasksWorkflowConfigService: ctx
      .asFunction(
        ({ commandBus, tasksWorkflowRead, auditLogService }: TasksCradle) =>
          new TaskWorkflowConfigService({ commandBus, workflow: tasksWorkflowRead, auditLog: auditLogService }),
      )
      .singleton(),
  });
  // --- end of Workflow -------------------------------------------------------------

  // --- Tasks (User Story 2) -----------------------------------------------------
  // The list, My Tasks, one Task, and its writes — every write a Command of
  // `task-commands.ts` (Constitution XIII). `admin_users`' read port names an
  // assignee and a creator; `_i18n`'s resolver words a context its owner did
  // not describe. Both are resolved lazily, per call, never captured.
  //
  // The bell is `admin_notifications`', which an operator may switch off. This
  // module degrades without it (the manifest's `degrades-without` edge): the
  // notifier decides that module's presence before it asks, so an assignment
  // succeeds either way and nothing here catches a refusal.
  ctx.di.register({
    tasksNotifier: ctx
      .asFunction(() => createTaskNotifier(lazyPort<AdminNotificationRecordPort>(ctx, 'adminNotificationRecordPort')))
      .singleton(),
    tasksTaskService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          tasksVisibility,
          tasksAccess,
          tasksWorkflowRead,
          taskContextRegistry,
          tasksNotifier,
          tasksAudience,
          tasksPriorityService,
          tasksTagService,
          tasksReferenceService,
          tasksMentionService,
          tasksTransitionService,
          tasksHierarchyService,
          tasksRecordLinkService,
          auditLogService,
        }: TasksCradle) => {
          const i18n = lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService');
          const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
          return new TaskService({
            emFactory,
            commandBus,
            visibility: tasksVisibility,
            access: tasksAccess,
            workflow: tasksWorkflowRead,
            contexts: taskContextRegistry,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            notifier: tasksNotifier,
            audience: tasksAudience,
            priorities: tasksPriorityService,
            tags: tasksTagService,
            customFields: lazyPort<CustomFieldValuePort>(ctx, 'customFieldValueService'),
            customFieldListFilter: lazyPort<CustomFieldListFilterPort>(ctx, 'customFieldListFilterPort'),
            references: tasksReferenceService,
            mentions: tasksMentionService,
            transitions: tasksTransitionService,
            hierarchy: tasksHierarchyService,
            links: tasksRecordLinkService,
            // Read off the cradle per call: the reminder service is composed after this one.
            reminders: (taskId) => ctx.cradle<TasksCradle>().tasksReminderService.forReader(taskId),
            auditLog: auditLogService,
            // `tasks.time_zone` (R-17): read per call, so an operator's change
            // is seen by the next request.
            timeZone: () => settings.get('tasks.time_zone', null, TaskTimeZoneSchema.shape.timeZone),
            translate: (key, language) => i18n.translate('tasks', key, language),
          });
        },
      )
      .singleton(),
    // The audit log is the history (`task-history-service.ts`).
    // `auditLogService` is a platform service, not a module's port.
    tasksHistoryService: ctx
      .asFunction(
        ({ emFactory, tasksTaskService, auditLogService, tasksVisibility, tasksAccess }: TasksCradle) =>
          new TaskHistoryService({
            emFactory,
            tasks: tasksTaskService,
            visibility: tasksVisibility,
            access: tasksAccess,
            auditLog: auditLogService,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<TasksCradle>();
    await registerTaskRoutes(app, {
      taskService: cradle.tasksTaskService,
      historyService: cradle.tasksHistoryService,
      mentionService: cradle.tasksMentionService,
      documentLookupService: cradle.tasksDocumentLookupService,
      recordLinkService: cradle.tasksRecordLinkService,
      contexts: cradle.taskContextRegistry,
      cardFields: cradle.tasksBoardCardFieldService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerTaskWorkflowRoutes(app, {
      taskService: cradle.tasksTaskService,
      workflowConfigService: cradle.tasksWorkflowConfigService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerTaskPriorityRoutes(app, { priorityService: cradle.tasksPriorityService, requireAdmin: cradle.requireAdmin });
    await registerTaskTagRoutes(app, { tagService: cradle.tasksTagService, requireAdmin: cradle.requireAdmin });
    await registerTaskCollaborationRoutes(app, {
      attachmentService: cradle.tasksAttachmentService,
      commentService: cradle.tasksCommentService,
      relationService: cradle.tasksRelationService,
      recordLinkService: cradle.tasksRecordLinkService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  /**
   * The audit-reference resolver — a **contribution** hook. It pushes an inert
   * resolver into `auditReferenceRegistry`, an ungated registry `audit_logs`
   * owns, and carries no presence probe: the registry's own enumeration policy
   * skips this entry while the module is absent, and a probe here would make
   * that survive a reactivation until the next restart.
   */
  ctx.onBoot(() => {
    registerTaskAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      () => ctx.cradle<TasksCradle>().tasksTaskService,
    );
  });
  /**
   * The Task record type for admin global search (`contracts/admin-surfaces.md`
   * §6) — a **contribution** hook: it pushes an inert provider into
   * `admin_search`'s ungated registry and does nothing else, so it carries no
   * presence probe. The registry leaves it out at enumeration while this module
   * is switched off, and switching it back on needs no restart.
   */
  ctx.onBoot(() => {
    lazyPort<AdminSearchProviderRegistryPort>(ctx, 'adminSearchProviderRegistry').register(
      createTaskAdminSearchProvider({
        search: (query) => ctx.cradle<TasksCradle>().tasksTaskService.searchForAdmin(query),
        statusLabel: (code, language) => ctx.cradle<TasksCradle>().tasksTaskService.statusLabel(code, language),
      }),
    );
  });
  // --- end of Tasks ----------------------------------------------------------------

  // --- Board and saved views (User Story 3, research R-11, R-13, R-14) --------------
  // The board is the list again, one column per status: it reads no table of
  // its own, only `TaskService`'s grouped count and list pages, with the
  // visibility scope computed once per request. What a card shows is one
  // Setting, written through `settings`' own audited write and offered from
  // `custom_fields`' `task` definitions — both binding dependencies, resolved
  // lazily per call. A saved view is a per-administrator preset (feature 147),
  // not a domain write. The list/board choice is `admin_users`' preference
  // `listViewModes`, which this module does not serve.
  ctx.di.register({
    tasksBoardCardFieldService: ctx
      .asFunction(
        () =>
          new TaskBoardCardFieldService({
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            settingsAdmin: lazyPort<SettingsAdminPort>(ctx, 'settingsAdminService'),
            definitions: lazyPort<CustomFieldDefinitionReadPort>(ctx, 'customFieldDefinitionReadPort'),
          }),
      )
      .singleton(),
    tasksBoardService: ctx
      .asFunction(
        ({ tasksTaskService, tasksWorkflowRead, tasksBoardCardFieldService }: TasksCradle) =>
          new TaskBoardService({
            tasks: tasksTaskService,
            workflow: tasksWorkflowRead,
            cardFields: tasksBoardCardFieldService,
          }),
      )
      .singleton(),
    tasksListViewService: ctx
      .asFunction(({ emFactory }: TasksCradle) => new TaskListViewService(emFactory, ctx.log))
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<TasksCradle>();
    await registerTaskBoardRoutes(app, {
      boardService: cradle.tasksBoardService,
      boardCardFieldService: cradle.tasksBoardCardFieldService,
      requireAdmin: cradle.requireAdmin,
    });
    await registerTaskViewRoutes(app, { listViewService: cradle.tasksListViewService, requireAdmin: cradle.requireAdmin });
  });
  // --- end of Board and saved views ----------------------------------------------------

  // --- Collaboration: attachments (User Story 1, research R-7) ----------------------
  // A Task's files are the asset library's, through its ports — `assets_library`
  // cannot be switched off and is a binding dependency.
  ctx.di.register({
    tasksAttachmentService: ctx
      .asFunction(
        ({ emFactory, commandBus, tasksAccess }: TasksCradle) =>
          new TaskAttachmentService({
            emFactory,
            commandBus,
            access: tasksAccess,
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
            assetsLibrary: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
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
   * attachment when Tasks is switched on again (Constitution XVII).
   */
  //
  // The descriptor is also **reader-restricted** (`specs/166-asset-reference-visibility/`
  // FR-002): the library shows a file only to a reader who may see a record
  // using it, and asks this module which Tasks the caller may see. It asks only
  // while Tasks is present — the library decides that, not this hook — and
  // every service it reaches is resolved per call through getters, never here.
  ctx.onBoot(() => {
    registerTaskAssetReferences(
      lazyPort<AssetReferenceRegistryPort>(ctx, 'assetReferenceRegistry'),
      ctx.cradle<TasksCradle>().emFactory,
      {
        access: () => ctx.cradle<TasksCradle>().tasksAccess,
        visibility: () => ctx.cradle<TasksCradle>().tasksVisibility,
        mayReadTasks: createOwnerReadCheck(lazyPort<PermissionReadPort>(ctx, 'permissionService'), TASKS_READ_PERMISSION),
      },
    );
  });
  // --- end of Collaboration ----------------------------------------------------------

  // --- Collaboration: comments (User Story 4, research R-6) -------------------------
  // A Task's comment thread: notes only, each its author's. The body's
  // references are the References section's (resolved per reader, kept in
  // `task_references` as the comment's own rows); the people a comment newly
  // mentions are told through the mention service, and the assignees and the
  // Creator through the notifier — the bell is `admin_notifications`', which
  // this module only degrades without, and the notifier decides its presence.
  // The routes are registered with the attachments' (`routes.collaboration.ts`).
  ctx.di.register({
    tasksCommentService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          tasksAccess,
          tasksAudience,
          tasksNotifier,
          tasksReferenceService,
          tasksMentionService,
        }: TasksCradle) =>
          new TaskCommentService({
            emFactory,
            commandBus,
            access: tasksAccess,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            audience: tasksAudience,
            notifier: tasksNotifier,
            references: tasksReferenceService,
            mentions: tasksMentionService,
          }),
      )
      .singleton(),
  });
  // --- end of Collaboration: comments -------------------------------------------------

  // --- Sub-tasks and related Tasks (User Story 5, research R-15) ---------------------
  // A Task's parent and its related Tasks — this module's own tables only. Every
  // change of the hierarchy (a parent set or cleared, a Task created under a
  // parent, a parent deleted) runs under one advisory lock, so two changes that
  // would only together close a cycle cannot both commit. A link between two
  // Tasks is recorded on both, the second entry through the kernel's audit port
  // on the same transaction. The parent change is asked by the Task service
  // (`PATCH /tasks/:id`); the relation routes are registered with the other
  // collaboration routes (`routes.collaboration.ts`).
  ctx.di.register({
    tasksHierarchyService: ctx
      .asFunction(({ commandBus, tasksAccess }: TasksCradle) => new TaskHierarchyService({ commandBus, access: tasksAccess }))
      .singleton(),
    tasksRelationService: ctx
      .asFunction(
        ({ commandBus, tasksAccess, auditLogService }: TasksCradle) =>
          new TaskRelationService({ commandBus, access: tasksAccess, auditLog: auditLogService }),
      )
      .singleton(),
  });
  // --- end of Sub-tasks and related Tasks ---------------------------------------------

  // --- Record links (User Story 6, research R-16) -------------------------------------
  // A Task's links to the Opportunities, Orders and Quote Requests it is about,
  // held by value in this module's own table. Each is validated when made
  // through the owner's port with the owner's read code — `orders` cannot be
  // switched off and is a binding dependency; `crm` and `quote_requests` are
  // switchable, reached through the one door (`record-owners.ts`) that decides
  // presence first — and named to each reader through the reference resolver.
  // A link changes nobody's visibility of the Task (Q2 = A). The routes are
  // registered with the other collaboration routes; the link and Project/Stage
  // pickers with the Tasks lookups.
  ctx.di.register({
    tasksRecordLinkService: ctx
      .asFunction(
        ({ emFactory, commandBus, tasksAccess, tasksReferenceService, tasksRecordOwners, tasksOwnerReadChecks }: TasksCradle) =>
          new TaskRecordLinkService({
            emFactory,
            commandBus,
            access: tasksAccess,
            references: tasksReferenceService,
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            orderList: lazyPort<OrderListPort>(ctx, 'orderListPort'),
            owners: tasksRecordOwners,
            mayRead: tasksOwnerReadChecks,
          }),
      )
      .singleton(),
  });
  // --- end of Record links ------------------------------------------------------------

  // --- Settings (User Story 7, research R-17) ------------------------------------------
  // `tasks.time_zone`, the calendar of Tasks: read on `tasks:read`, written on
  // `tasks:configure` through `settings`' own audited write. Its validator is a
  // **contribution** into `settings`' validator registry, which filters
  // contributors by presence when it is read — so the boot hook carries no probe.
  ctx.di.register({
    tasksSettingsService: ctx
      .asFunction(
        () =>
          new TaskSettingsService({
            settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
            settingsAdmin: lazyPort<SettingsAdminPort>(ctx, 'settingsAdminService'),
          }),
      )
      .singleton(),
  });
  ctx.onBoot(() => {
    lazyPort<SettingWriteValidatorRegistryPort>(ctx, 'settingWriteValidatorRegistry').register(
      createTaskTimeZoneValidator(),
    );
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<TasksCradle>();
    await registerTaskSettingsRoutes(app, { settingsService: cradle.tasksSettingsService, requireAdmin: cradle.requireAdmin });
  });
  // --- end of Settings ----------------------------------------------------------------

  // --- Reminders, the daily digest and the maintenance pass (US7, US10; R-17 – R-19) --
  // A sweep, not timers: the reminder rows are the schedule, and one pass claims
  // each (reminder, recipient) with a delivery row before it tells anyone. The
  // bell is `admin_notifications`', which this module only degrades without: its
  // presence is decided before the bell is written, and the bell is written on
  // the delivery row's own transaction (`recordWithin`), so it is exactly once.
  // The e-mails go out through `transactional_emails`' sender, read off the
  // cradle per send — a function, announced late, and `lazyPort` forwards
  // method calls only. Who is told is decided when it goes out: the audience
  // question every notification of this module asks.
  ctx.di.register({
    tasksEmail: ctx
      .asFunction(() =>
        createTaskEmail({
          sender: () => ctx.cradle<TasksCradle>().transactionalEmailSenderAccessor(),
          log: (message, context) => ctx.log.warn(context, message),
        }),
      )
      .singleton(),
    tasksReminderService: ctx
      .asFunction(
        ({ emFactory, commandBus, tasksAccess, tasksAudience, tasksEmail }: TasksCradle) => {
          const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
          return new TaskReminderService({
            emFactory,
            commandBus,
            access: tasksAccess,
            audience: tasksAudience,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            permissions: lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            bell: lazyPort<AdminNotificationRecordPort<EntityManager>>(ctx, 'adminNotificationRecordPort'),
            bellPresent: () => effectiveState.isPresent('admin_notifications'),
            email: tasksEmail,
            timeZone: () => settings.get('tasks.time_zone', null, TaskTimeZoneSchema.shape.timeZone),
            log: (message, context) => ctx.log.warn(context, message),
          });
        },
      )
      .singleton(),
    tasksDigestService: ctx
      .asFunction(({ emFactory, commandBus, tasksAudience, tasksNotifier, tasksEmail }: TasksCradle) => {
        const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
        return new TaskDigestService({
          emFactory,
          commandBus,
          audience: tasksAudience,
          adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
          notifier: tasksNotifier,
          email: tasksEmail,
          timeZone: () => settings.get('tasks.time_zone', null, TaskTimeZoneSchema.shape.timeZone),
          log: (message, context) => ctx.log.warn(context, message),
        });
      })
      .singleton(),
    // The #450 clean-up: Tasks whose context's record is gone, asked of each
    // present owner that can say (`existingContexts`, research R-19).
    tasksMaintenanceService: ctx
      .asFunction(
        ({ emFactory, commandBus, taskContextRegistry, auditLogService }: TasksCradle) =>
          new TaskMaintenanceService({ emFactory, commandBus, contexts: taskContextRegistry, auditLog: auditLogService }),
      )
      .singleton(),
    // What one tick of the clock runs, and the slower passes' cadence. Registered, so that
    // what a test drives (`runTasksRemindersJob`) is what the consumer runs:
    // presence, then each pass's probe, then its scope.
    tasksRemindersJob: ctx
      .asFunction(({ tasksReminderService, tasksDigestService, tasksMaintenanceService }: TasksCradle) =>
        createTasksRemindersJob({
          isPresent: () => effectiveState.isPresent('tasks'),
          reminders: {
            scopeReason: TASKS_REMINDERS_SCOPE_REASON,
            hasWork: (now) => tasksReminderService.hasWork(now),
            run: (now) => tasksReminderService.sweep(now),
          },
          digest: {
            scopeReason: TASKS_DIGEST_SCOPE_REASON,
            hasWork: (now) => tasksDigestService.hasWork(now),
            run: (now) => tasksDigestService.pass(now),
          },
          maintenance: {
            scopeReason: TASKS_MAINTENANCE_SCOPE_REASON,
            hasWork: () => tasksMaintenanceService.hasWork(),
            run: () => tasksMaintenanceService.pass(),
          },
          log: ctx.log,
        }),
      )
      .singleton(),
  });
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<TasksCradle>();
    await registerTaskReminderRoutes(app, {
      reminderService: cradle.tasksReminderService,
      digestService: cradle.tasksDigestService,
      requireAdmin: cradle.requireAdmin,
    });
  });
  /**
   * The two e-mails' default subjects and bodies — a **contribution** hook. It
   * pushes inert descriptors into `emailDefaultsPort`, the ungated registry
   * `transactional_emails` owns and reads once at boot, and carries no presence
   * probe: the definitions are seeded from this module's manifest whether the
   * module is on or off, and a push skipped here would leave them with an empty
   * body until the next restart after a reactivation.
   */
  ctx.onBoot(() => {
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register(TASK_REMINDER_EMAIL_CODE, TASK_REMINDER_DEFAULT, 'tasks');
    defaults.register(TASK_DIGEST_EMAIL_CODE, TASK_DIGEST_DEFAULT, 'tasks');
  });
  // The clock: a Job Scheduler and its consumer, attached where `app.log`
  // exists and through `ctx.worker`, which is what stops it with the module.
  // Built only where the host says this process consumes queues and offers a
  // connection; the shared test server says neither and drives the job itself.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<TasksCradle>();
    await startTasksReminders({
      job: cradle.tasksRemindersJob,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });
  // --- end of Reminders, the daily digest and the maintenance pass ----------------------

  // --- Published ports (contracts/ports-and-events.md §1) ---------------------------
  // What another module reads and writes Tasks through. Both are `providePort`:
  // gated, so a consumer resolving either while this module is off gets
  // `ModuleDisabledError` (503 `MODULE_DISABLED`) and nothing half-executes.
  ctx.di.providePort<TaskReadPort>(
    'taskReadPort',
    ctx.asFunction(({ tasksTaskService }: TasksCradle) => new TaskReadPortService(tasksTaskService)).singleton(),
  );
  ctx.di.providePort<TaskWritePort>(
    'taskWritePort',
    ctx
      .asFunction(
        ({ commandBus, emFactory, taskContextRegistry, tasksWorkflowRead, auditLogService }: TasksCradle) =>
          new TaskWritePortService({
            commandBus,
            emFactory,
            contexts: taskContextRegistry,
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            workflow: tasksWorkflowRead,
            auditLog: auditLogService,
          }),
      )
      .singleton(),
  );
  // --- end of Published ports ---------------------------------------------------------
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 *
 * `Task` and the nine tables that hang off it are `@RuleScoped` — their
 * tenancy is the Task's context rule (163 research R-9), read only through
 * `TaskVisibility` (165 research R-21). The workflow, priorities and tags are
 * `@GlobalEntity` configuration; saved views and digest subscriptions are
 * `@GlobalEntity` per-administrator rows.
 */
export const entities = [
  Task,
  TaskAssignee,
  TaskTagAssignment,
  TaskComment,
  TaskReference,
  TaskAttachment,
  TaskRecordLink,
  TaskRelation,
  TaskReminder,
  TaskReminderDelivery,
  TaskStatus,
  TaskStatusTransition,
  TaskPriority,
  TaskTag,
  TaskListSavedView,
  TaskDigestSubscription,
  // Issue #470 — the values the platform audit log no longer carries.
  TaskValueChange,
];

/**
 * The door to `tasks_number_seq`, published **by name** on `./backend`, as
 * CRM's `nextOpportunityNumber` is (`specs/143-crm-sales-opportunities/`
 * research N-DD1): a demo composition creating Tasks takes its numbers here, so
 * there is one statement of the format and one sequence. A function is not an
 * entity class, which is what D-168 bars from this door.
 */
export { nextTaskNumber } from './services/task-number.js';
