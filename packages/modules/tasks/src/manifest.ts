import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  TASK_BOARD_DEFAULT_CARD_FIELDS,
} from '@endora-commerce/contracts';

/**
 * Tasks — a first version of Tasks assigned to admin users, with a due date and
 * a status (`specs/163-projects-and-tasks/`). Any module may own Tasks through
 * an opaque context; this module names none of them.
 *
 * The module is operator-toggleable (Constitution XVII): `tasks.enabled` is its
 * activation control, and everything it contributes — routes, ports, admin
 * surfaces — stops with it. Nothing is dropped while it is off.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'tasks',
  groups: [
    {
      code: 'tasks',
      name: 'Tasks',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'tasks.enabled',
      name: 'Tasks enabled',
      description:
        'Switches Tasks on or off: the Tasks list, My Tasks, the Task screens and the Tasks other modules create. Nothing is dropped — every Task and its history stay in the database and reappear when Tasks is switched back on.',
      groupCode: 'tasks',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // `specs/165-task-management/` R-11. Written by the *Board card* section
      // of the Task workflow screen (`PUT /tasks/board/card-fields`,
      // `tasks:configure`); the default is `TASK_BOARD_DEFAULT_CARD_FIELDS` of
      // the contracts package. Read forgivingly: a reference that names no
      // field is skipped.
      code: 'tasks.board_card_fields',
      name: 'Fields shown on a task board card',
      description:
        'Which fields a card on the task board shows, in order, as a JSON array of field references — for example ["builtin:number","builtin:assignees","custom:region"]. Change it on the Task workflow screen, in the Board card section, which offers the fields that exist; a reference that names no field is skipped, and at most six are shown. One choice for the whole platform.',
      groupCode: 'tasks',
      valueType: 'json',
      defaultValue: [...TASK_BOARD_DEFAULT_CARD_FIELDS],
    },
    {
      // R-17. Not `analytics.reporting_time_zone`: `analytics` is switchable
      // and falls back to UTC.
      code: 'tasks.time_zone',
      name: 'Time zone of task due dates, reminders and the daily digest',
      description:
        'The time zone, as an IANA name such as Europe/Warsaw, in which Tasks count "today": when a task with a due date but no time becomes overdue, the date a due time falls on, the 09:00 a reminder relative to a date-only due date fires at, and the hour each person\'s daily digest is sent.',
      groupCode: 'tasks',
      valueType: 'string',
      defaultValue: 'Europe/Warsaw',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'tasks',
  name: 'Tasks',
  description:
    'Tasks assigned to admin users, with statuses, priorities, tags, comments, attachments, sub-tasks, reminders and a board, which any module can own through an opaque context.',
  version: '1.0.0',
  // `auth` owns `requireAdmin`, which gates every route of this module;
  // `settings` owns the store the activation control lives in;
  // `admin_users` owns `adminUserReadPort`, through which an assignee and a
  // creator are named; `audit_logs` owns `auditReferenceRegistry`, through
  // which an audit row about a Task is labelled; `_i18n` owns
  // `adminI18nService`, which words a context its owner did not describe in
  // the reader's language. All five are non-deactivatable.
  //
  // `specs/165-task-management/` (R-21) adds five more, none of which can be
  // switched off either: `custom_fields` owns `customFieldValueService` and its
  // list-filter port, through which a Task's custom-field values are validated
  // and filtered on (R-8); `assets_library` owns `assetsLibraryPort` and
  // `assetReferenceRegistry`, through which a file is attached and kept from
  // deletion while a Task uses it (R-7) — the push into that registry needs no
  // `contributes-to` edge beside this one, which `defineModuleManifest` would
  // refuse as a second claim on the same owner; `transactional_emails` owns the
  // sender a reminder and the daily digest go out through, and
  // `emailDefaultsPort` (R-17, R-18); `orders` owns `orderReadPort`, through
  // which a referenced or linked Order is named (R-5, R-16); `catalog` owns
  // `catalogProductReadPort`, which names a referenced Product (R-5).
  // `admin_roles` owns `permissionService`, which answers whether the caller
  // holds `tasks:see_private` (R-3) and whether somebody about to be told of a
  // Task may read Tasks at all (F-14); it cannot be switched off either.
  dependencies: [
    '_i18n',
    'admin_roles',
    'admin_users',
    'assets_library',
    'audit_logs',
    'auth',
    'catalog',
    'custom_fields',
    'orders',
    'settings',
    'transactional_emails',
  ],
  /**
   * Edges that are real to the container and bind no operator.
   *
   * `admin_notifications` is operator-switchable, and telling somebody a Task
   * is now theirs is a courtesy: the notifier asks
   * `effectiveState.isPresent('admin_notifications')` before it resolves the
   * port, so with the bell off an assignment succeeds and nobody is told.
   */
  nonBindingDependencies: [
    {
      moduleId: 'admin_search',
      name: 'adminSearchProviderRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the Task provider for the ' +
        'admin global search, built over its own task service. Nothing is read back: the registry ' +
        'enumerates only providers whose module is effectively present, so an absent contributor ' +
        'costs the host nothing and an absent host holds a table nobody walks. Not `dependencies`: ' +
        'that would make global search a reason this module cannot be switched off.',
    },
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent: 'Assignees are not notified of new Tasks.',
      reason:
        'The one call into this owner is `task-notifier.ts`, which decides its presence in front ' +
        'of the gate and answers `not-present` in its return type; nothing in this module fails ' +
        "closed on it, and no table of that owner is referenced from this module's schema.",
    },
    // `specs/165-task-management/` R-5, R-16 — references and record links of
    // the three switchable owners. A reference and a link hold their record by
    // value, so no table of any of them is referenced from this module's schema.
    {
      moduleId: 'crm',
      name: 'opportunityReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'Opportunities cannot be referenced or linked; existing ones show as unavailable, and the Tasks panel on an Opportunity is not shown.',
      reason:
        'Every call into this owner goes through the reference and record-link services, whose ' +
        'callers ask `isPresent()` in front of the gate: a referenced or linked Opportunity renders ' +
        'as unavailable, the `@@` list and the link picker offer none, and linking one answers ' +
        '`TASK_LINK_INVALID` from that decision rather than from a caught refusal.',
    },
    {
      moduleId: 'quote_requests',
      name: 'quoteRequestReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'Quote Requests cannot be referenced or linked; existing references and links show as unavailable.',
      reason:
        'Every call into this owner goes through the reference and record-link services, whose ' +
        'callers ask `isPresent()` in front of the gate: a referenced or linked Quote Request renders ' +
        'as unavailable, the `@@` list and the link picker offer none, and linking one answers ' +
        '`TASK_LINK_INVALID` from that decision rather than from a caught refusal.',
    },
    {
      moduleId: 'projects',
      name: 'projectReadPort',
      kind: 'degrades-without',
      whenAbsent: 'Projects cannot be referenced; existing references show as unavailable.',
      reason:
        'Every call into this owner goes through the reference service, whose callers ask ' +
        '`isPresent()` in front of the gate: a referenced Project renders as unavailable and the ' +
        '`@@` list offers none. A Task in a Project is held by its opaque context, which names no ' +
        'Projects table, and is hidden through `taskContextRegistry` rather than this port.',
    },
  ],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'tasks.enabled', default: true },
  /**
   * Reading Tasks, and creating, editing and deleting them (163 User Story 2);
   * configuring the workflow, tags, priorities, the board card and the time
   * zone, and reading other people's private Tasks (165 R-20).
   */
  permissions: [
    {
      code: 'tasks:read',
      label: 'View tasks',
      module: 'tasks',
    },
    {
      code: 'tasks:write',
      label: 'Create and edit tasks',
      module: 'tasks',
      requires: ['tasks:read'],
    },
    {
      code: 'tasks:configure',
      label: 'Configure tasks',
      module: 'tasks',
      requires: ['tasks:read'],
    },
    {
      // Owner ruling Q1 = B: read and delete only; every other write on
      // someone else's private Task answers 403 `TASK_PRIVATE_READ_ONLY`.
      code: 'tasks:see_private',
      label: 'See private tasks',
      module: 'tasks',
      requires: ['tasks:read'],
    },
  ],
  /**
   * The refusals this module raises, each with its sentence under
   * `errors.<CODE>` in `i18n/{en,pl}.json`, declared by the change that added
   * its first raise site.
   */
  errorCodes: [
    { code: 'TASK_NOT_FOUND' },
    { code: 'TASK_CONTEXT_INVALID' },
    { code: 'TASK_ASSIGNEE_INVALID' },
    { code: 'TASK_STATUS_UNKNOWN' },
    { code: 'TASK_TRANSITION_FORBIDDEN' },
    { code: 'TASK_TRANSITION_CONFLICT' },
    // The broken rule is the refusal token (`{ rule, code: rule }`): the five
    // graph rules of `TaskWorkflowRule`, the three configuration refusals of
    // `TaskWorkflowConfigRule` and the two of `TaskPriorityConfigRule`.
    {
      code: 'TASK_WORKFLOW_INVALID',
      tokens: [
        'exactly_one_initial',
        'initial_must_be_open',
        'done_status_required',
        'cancelled_status_required',
        'transition_unknown_status',
        'status_code_taken',
        'category_in_use',
        'replacement_required',
        'priority_code_taken',
        'priority_replacement_required',
      ],
    },
    // A status removal carries no token; a priority removal carries
    // `priority` (`priority-service.ts`, through `holdTasksFor`).
    { code: 'TASK_STATUS_IN_USE_TOO_MANY', tokens: ['priority'] },
    { code: 'TASK_PRIVATE_READ_ONLY' },
    // No `tokens`: the raise carries the unknown priority code as
    // `details.priorityCode`, which the sentence names, and no `details.code`
    // (issue #569).
    { code: 'TASK_PRIORITY_UNKNOWN' },
    { code: 'TASK_TAG_UNKNOWN' },
    { code: 'TASK_TAG_NAME_TAKEN' },
    { code: 'TASK_ATTACHMENT_REFUSED' },
    { code: 'TASK_VIEW_NAME_TAKEN' },
    { code: 'TASK_PARENT_CYCLE' },
    { code: 'TASK_HIERARCHY_TOO_DEEP' },
    { code: 'TASK_LINK_INVALID' },
    { code: 'TASK_REMINDER_INVALID' },
    { code: 'TASK_PRIVATE_ASSIGNEE' },
    { code: 'TASK_ALREADY_PUBLISHED' },
  ],
  /**
   * The command palette (Principle XVI, FR-041; `contracts/admin-surfaces.md`
   * §4). Each opens a screen of this module's own admin layer and declares the
   * code that screen and its API are gated on.
   */
  actions: [
    {
      id: 'open-tasks',
      labelKey: 'actions.openTasks.label',
      descriptionKey: 'actions.openTasks.description',
      icon: 'ListChecks',
      targetRoute: '/tasks',
      requiredPermission: 'tasks:read',
      keywords: ['tasks', 'task', 'to do', 'todo'],
      keywordsKey: 'actions.openTasks.keywords',
      weight: 330,
    },
    {
      id: 'open-my-tasks',
      labelKey: 'actions.openMyTasks.label',
      descriptionKey: 'actions.openMyTasks.description',
      icon: 'ListChecks',
      targetRoute: '/tasks/mine',
      requiredPermission: 'tasks:read',
      keywords: ['my tasks', 'mine', 'assigned', 'tasks'],
      keywordsKey: 'actions.openMyTasks.keywords',
      weight: 331,
    },
    {
      id: 'new-task',
      labelKey: 'actions.newTask.label',
      descriptionKey: 'actions.newTask.description',
      icon: 'Plus',
      targetRoute: '/tasks/new',
      requiredPermission: 'tasks:write',
      keywords: ['task', 'new', 'create'],
      keywordsKey: 'actions.newTask.keywords',
      weight: 332,
    },
    {
      // `specs/165-task-management/contracts/admin-surfaces.md` §4: the workflow
      // screen, on the code its route and every write it makes enforce.
      id: 'open-task-workflow',
      labelKey: 'actions.openTaskWorkflow.label',
      descriptionKey: 'actions.openTaskWorkflow.description',
      icon: 'Settings',
      targetRoute: '/tasks/settings/workflow',
      requiredPermission: 'tasks:configure',
      keywords: ['task statuses', 'workflow', 'transitions'],
      keywordsKey: 'actions.openTaskWorkflow.keywords',
      weight: 333,
    },
    {
      // `contracts/admin-surfaces.md` §4 (User Story 9): the priority list's screen.
      id: 'open-task-priorities',
      labelKey: 'actions.openTaskPriorities.label',
      descriptionKey: 'actions.openTaskPriorities.description',
      icon: 'Settings',
      targetRoute: '/tasks/settings/priorities',
      requiredPermission: 'tasks:configure',
      keywords: ['task priorities', 'priority', 'urgency'],
      keywordsKey: 'actions.openTaskPriorities.keywords',
      weight: 334,
    },
    {
      // `contracts/admin-surfaces.md` §4 (User Story 9): the tag list's screen.
      id: 'open-task-tags',
      labelKey: 'actions.openTaskTags.label',
      descriptionKey: 'actions.openTaskTags.description',
      icon: 'Settings',
      targetRoute: '/tasks/settings/tags',
      requiredPermission: 'tasks:configure',
      keywords: ['task tags', 'tags', 'labels'],
      keywordsKey: 'actions.openTaskTags.keywords',
      weight: 335,
    },
    {
      // `contracts/admin-surfaces.md` §4: the general settings screen (the time
      // zone due dates, reminders and the digest are counted in).
      id: 'open-task-general-settings',
      labelKey: 'actions.openTaskGeneralSettings.label',
      descriptionKey: 'actions.openTaskGeneralSettings.description',
      icon: 'Settings',
      targetRoute: '/tasks/settings/general',
      requiredPermission: 'tasks:configure',
      keywords: ['task settings', 'time zone', 'timezone'],
      keywordsKey: 'actions.openTaskGeneralSettings.keywords',
      weight: 336,
    },
  ],
  /**
   * The e-mails this module sends (R-17, R-18). Their default subject and body
   * are pushed into `emailDefaultsPort` from an ungated boot hook; the list in
   * the digest loops over the Tasks with `{{for}}`; `taskList` is still sent
   * because it is the variable the manifest declares (T073).
   */
  transactionalEmails: [
    {
      code: 'tasks_task_reminder',
      name: 'Task reminder',
      group: 'tasks',
      description:
        'Sent to each recipient of a task reminder at its moment — a time someone chose, or a set time before the task is due — when they may still see the task and it is still open.',
      variables: [
        { key: 'task.number', label: 'Task number', sampleValue: 'TSK-000042' },
        { key: 'task.title', label: 'Task title', sampleValue: 'Measure the showroom' },
        { key: 'task.due', label: 'Task due date', sampleValue: 'October 30, 2026 14:00' },
      ],
    },
    {
      code: 'tasks_daily_digest',
      name: 'Daily task digest',
      group: 'tasks',
      description:
        'Sent once a day, at the hour each person chose, to everyone who turned the digest on, listing their open assigned tasks due that day or overdue. Not sent on a day with no such task.',
      variables: [
        { key: 'digest.date', label: 'Date of the digest', sampleValue: 'October 30, 2026' },
        { key: 'digest.taskCount', label: 'Number of tasks listed', sampleValue: '3' },
        {
          key: 'digest.taskList',
          label: 'The tasks, one per line',
          sampleValue:
            'TSK-000042 Measure the showroom — overdue since October 28\nTSK-000051 Call the installer — due today',
        },
      ],
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  // `docs/tasks.md` at the package root: users' and developers' page.
  docs: { dir: 'docs' },
  // `false` is a decision, absent would be "nobody has decided": the demo Tasks
  // name `admin_users`' rows, so they are steps of the demo composition
  // (`@endora-commerce/demo-composition`, `tasks.ts` and `projects.ts`), not
  // this module's demo body (`specs/165-task-management/` research R-23).
  demo: false,
});
