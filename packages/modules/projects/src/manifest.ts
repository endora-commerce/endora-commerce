import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Projects — Projects for zero or more Organizations, run through per-Project
 * Stages by Members holding Project Roles (`specs/163-projects-and-tasks/`).
 *
 * The module is operator-toggleable (Constitution XVII): `projects.enabled` is
 * its activation control, and everything it contributes — routes, workers,
 * admin surfaces — stops with it. Nothing is dropped while it is off.
 */

/**
 * The module's setting codes, for the code that reads them and the tests that
 * write them.
 */
export const PROJECTS_SETTING_CODES = {
  ENABLED: 'projects.enabled',
  VISIBILITY: 'projects.visibility',
  ALERTS_TIME_ZONE: 'projects.alerts_time_zone',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'projects',
  groups: [
    {
      code: 'projects',
      name: 'Projects',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: PROJECTS_SETTING_CODES.ENABLED,
      name: 'Projects enabled',
      description:
        'Switches Projects on or off: the Project screens, Templates, analytics and the Project panels on Orders, Quote Requests and Opportunities. Nothing is dropped — every Project, its Stages and its history stay in the database and resume where they were.',
      groupCode: 'projects',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // FR-018, research R-3. A Project set to "inherit" follows this; a
      // Project's own setting, a Member, a listed person and `projects:see_all`
      // act inside it. Nothing here widens Organization reach.
      code: PROJECTS_SETTING_CODES.VISIBILITY,
      name: 'Who sees a Project',
      description:
        'Who may see a Project that follows this setting: "everyone" — every administrator who may view Projects; "members" — its Members and the people listed on it. Each Project can override it. Either way an administrator sees only Projects of Organizations they can reach, and holders of "See every project" see every one of those.',
      groupCode: 'projects',
      valueType: 'string',
      enumOptions: ['everyone', 'members'],
      defaultValue: 'members',
    },
    {
      // Research R-5 and R-12: the calendar a Stage's start day, its deadline
      // and the day a deadline alert goes out are counted in.
      code: PROJECTS_SETTING_CODES.ALERTS_TIME_ZONE,
      name: 'Time zone of Stage dates and deadline alerts',
      description:
        'The time zone, as an IANA name such as Europe/Warsaw, in which "today" is counted for Projects: the day a Stage starts, whether its deadline has passed, and the day a deadline alert is sent — from 08:00 in this zone.',
      groupCode: 'projects',
      valueType: 'string',
      defaultValue: 'Europe/Warsaw',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'projects',
  name: 'Projects',
  description:
    'Projects for zero or more Organizations, run through per-Project Stages by Members holding Project Roles.',
  version: '1.0.0',
  // Every owner named here is one the platform refuses to switch off, so none
  // of these edges can deaden an operator's switch.
  //
  // `auth` owns `requireAdmin`, which gates every route of this module;
  // `settings` owns the store the activation control and the module settings
  // live in.
  //
  // `organizations` is forced by the schema —
  // `project_organizations.organization_id` is a foreign key into its table —
  // and also owns `adminTenantScopePort` (another administrator's reach) and
  // `organizationDetailsPort` (an Organization's name).
  //
  // `admin_roles` owns `permissionService`, which answers whether a reader
  // holds `projects:see_all`; `admin_users` owns `adminUserReadPort`, through
  // which Members are named.
  //
  // `_i18n` owns `adminI18nService`, which words what this module stores as a
  // key in the reader's language: a Stage Task's responsible-Role note and the
  // name of a duplicated Template.
  //
  // `orders` owns `orderReadPort`, through which a linked Order is validated
  // and shown (User Story 6), and `orderListPort`, the `@@` list's Orders
  // (User Story 7); it cannot be switched off.
  //
  // User Story 7: `catalog` owns `catalogProductReadPort`, which names a
  // Product a text refers to; `assets_library` owns `assetReadPort`,
  // `assetsLibraryPort` and `assetReferenceRegistry`, through which a file is
  // attached, downloaded and kept from deletion while a Project uses it;
  // `audit_logs` owns `auditReferenceRegistry`, through which an audit row
  // about a Project is labelled. None of the three can be switched off.
  //
  // User Story 8: `transactional_emails` owns the sender a Stage deadline
  // alert's e-mail goes out through, and `emailDefaultsPort`, the registry this
  // module pushes that e-mail's default subject and body into. It cannot be
  // switched off.
  //
  // User Story 9: `custom_fields` owns `customFieldValueService`, which
  // validates a Project's custom-field values and projects them for reading,
  // and its list-filter port, through which the admin list filters on them.
  // It cannot be switched off.
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
    'organizations',
    'settings',
    'transactional_emails',
  ],
  /**
   * Edges that are real to the container and bind no operator (FR-040: a
   * Project works without Tasks).
   *
   * `tasks` is operator-switchable. Projects pushes its `project` Task context
   * into `tasks`' registry from a contribution-only boot hook, and reads and
   * creates Tasks through its two ports only after asking
   * `effectiveState.isPresent('tasks')` — so with Tasks off a Project offers no
   * Tasks, applies no completion gate and creates no Stage Task, and says so.
   */
  nonBindingDependencies: [
    {
      moduleId: 'admin_search',
      name: 'adminSearchProviderRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the Project provider for the ' +
        'admin global search, built over its own read service. Nothing is read back: the registry ' +
        'enumerates only providers whose module is effectively present, so an absent contributor ' +
        'costs the host nothing and an absent host holds a table nobody walks. Not `dependencies`: ' +
        'that would make global search a reason this module cannot be switched off.',
    },
    {
      moduleId: 'tasks',
      name: 'taskContextRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the `project` Task context. ' +
        'The registry enumerates only contexts whose owner is effectively present, so an absent ' +
        'contributor hides its Tasks and an absent host holds a descriptor nobody asks. Not ' +
        '`dependencies`: that would make Tasks a reason this module cannot be switched off.',
    },
    {
      moduleId: 'tasks',
      name: 'taskReadPort',
      kind: 'degrades-without',
      whenAbsent: 'Projects work without Tasks: no Tasks tab, no Stage Tasks, no completion gates.',
      reason:
        'Every call into this owner goes through `project-tasks.ts`, whose callers ask `present()` ' +
        'in front of the gate: the completion gate is then not applied (and the Stage entry says so), ' +
        'a Stage is deleted without counting Tasks, the Tasks tab answers `tasksAvailable: false`, ' +
        'a Task referred to in a text renders as unavailable and the `@@` list offers no Tasks. ' +
        'A Task is held by its context, so no table of that owner is referenced from this module’s schema.',
    },
    {
      moduleId: 'tasks',
      name: 'taskWritePort',
      kind: 'degrades-without',
      whenAbsent: 'Projects work without Tasks: no Tasks tab, no Stage Tasks, no completion gates.',
      reason:
        'Every call into this owner goes through `project-tasks.ts`, whose callers ask `present()` ' +
        'in front of the gate: a Stage entered while Tasks is off is marked skipped instead of ' +
        'creating its Stage Tasks, and a deleted Project leaves its Tasks hidden rather than deleting them.',
    },
    // User Story 6 — linked records of the two switchable owners. A link holds
    // its record by value, so no table of either owner is referenced from this
    // module's schema.
    {
      moduleId: 'crm',
      name: 'opportunityReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'Opportunities linked to Projects show as unavailable and cannot be linked; their panels are gone. ' +
        'The links are kept and return when CRM is back.',
      reason:
        'Every call into this owner goes through `linked-records.ts`, whose callers ask `isPresent()` in ' +
        'front of the gate: a linked Opportunity renders as unavailable, and linking one or asking for its ' +
        'Project answers 503 from that decision rather than from a caught refusal.',
    },
    {
      moduleId: 'quote_requests',
      name: 'quoteRequestReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'Quote Requests linked to Projects show as unavailable and cannot be linked; their panels are gone. ' +
        'The links are kept and return when Quote Requests is back.',
      reason:
        'Every call into this owner goes through `linked-records.ts`, whose callers ask `isPresent()` in ' +
        'front of the gate: a linked or referred-to Quote Request renders as unavailable, the `@@` list ' +
        'offers none, and linking one or asking for its Project answers 503 from that decision rather ' +
        'than from a caught refusal.',
    },
    // T146 (owner decisions 2026-10-27, #465) — the reporting time zone.
    {
      moduleId: 'analytics',
      name: 'reportingTimeZonePort',
      kind: 'degrades-without',
      whenAbsent: 'Project analytics count days in UTC instead of the reporting time zone.',
      reason:
        'The one call into this owner is `reporting-time-zone.ts`, which asks `analytics`’ presence in front ' +
        'of the gate and answers `UTC` without it; the figures are counted either way, and no table of that ' +
        "owner is referenced from this module's schema.",
    },
    // User Story 7 — the bell. A message and a mention are stored either way.
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent:
        'Project members are not notified of messages and mentions, and get Stage deadline alerts by e-mail only.',
      reason:
        'The one call into this owner is `project-notifier.ts`, which decides its presence in front ' +
        'of the gate and answers `not-present` in its return type; nothing in this module fails ' +
        "closed on it, and no table of that owner is referenced from this module's schema. A deadline " +
        'alert is e-mailed either way, and is settled `email` when the bell is off.',
    },
  ],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: PROJECTS_SETTING_CODES.ENABLED, default: true },
  /**
   * Reading Projects. The other codes of research R-16 arrive with the first
   * route or check they gate: a code is declared by the change that adds its
   * first `requireAdmin`, so no code is grantable before it gates anything.
   */
  permissions: [
    {
      code: 'projects:read',
      label: 'View projects',
      module: 'projects',
    },
    {
      // Creating, editing and deleting a Project, its Organizations, Members,
      // Stages and workflow, and moving, closing and reopening it (User Story 1).
      code: 'projects:write',
      label: 'Create and run projects',
      module: 'projects',
      requires: ['projects:read'],
    },
    {
      // Lifts the visibility rule — the module setting, the Project's own
      // visibility, membership — but never Organization reach (User Story 5,
      // research R-3). No route asks for it: `ProjectAccess` reads it.
      code: 'projects:see_all',
      label: 'See every project regardless of visibility',
      module: 'projects',
      requires: ['projects:read'],
    },
    {
      // Templates (User Story 3), Project Roles and loss reasons (User Story 4).
      code: 'projects:configure',
      label: 'Configure projects (roles, templates, loss reasons)',
      module: 'projects',
      requires: ['projects:read'],
    },
    {
      // How all Projects are going (User Story 10): the seven figures of
      // `GET /projects/analytics/*`, each over the Projects the reader may see.
      code: 'projects:analytics',
      label: 'View project analytics',
      module: 'projects',
      requires: ['projects:read'],
    },
  ],
  /**
   * The refusals this module raises, each with its sentence under
   * `errors.<CODE>` in `i18n/{en,pl}.json`, declared by the change that added
   * its first raise site.
   *
   * `PROJECT_GUARD_REFUSED` carries the guard's own sentence: the raise puts it
   * in `details.reason` and both bundle sentences are that placeholder alone
   * (CRM's `CRM_TRANSITION_VETOED`).
   */
  errorCodes: [
    { code: 'PROJECT_NOT_FOUND' },
    { code: 'PROJECT_HAS_LINKS' },
    { code: 'PROJECT_ORGANIZATION_IN_USE' },
    { code: 'PROJECT_RECORD_NOT_FOUND' },
    { code: 'PROJECT_RECORD_ALREADY_LINKED' },
    { code: 'PROJECT_LINK_ORGANIZATION_MISMATCH' },
    { code: 'PROJECT_ORGANIZATION_OUT_OF_SCOPE' },
    { code: 'PROJECT_STAGE_CURRENT' },
    { code: 'PROJECT_STAGE_LAST' },
    // Raised through `notPermitted(message, details?)`, whose callers pass
    // `fromStageId` and `toStageId` or nothing — never a `code`, so no refusal
    // token (`check:error-translations`, issue #83).
    { code: 'PROJECT_MOVE_NOT_PERMITTED', tokens: [] },
    { code: 'PROJECT_CHANGED' },
    { code: 'PROJECT_GUARD_REFUSED' },
    { code: 'PROJECT_COMPLETION_NOT_PERMITTED' },
    { code: 'PROJECT_LOSS_REASON_INVALID' },
    { code: 'PROJECT_MEMBER_INVALID' },
    { code: 'PROJECT_STAGE_HAS_TASKS' },
    { code: 'PROJECT_STAGE_GATE_OPEN_TASKS' },
    { code: 'PROJECT_STAGE_TASKS_NOT_RETRYABLE' },
    { code: 'PROJECT_TEMPLATE_NOT_FOUND' },
    { code: 'PROJECT_DICTIONARY_ENTRY_NOT_FOUND' },
    { code: 'PROJECT_DICTIONARY_ENTRY_SYSTEM' },
    { code: 'PROJECT_DICTIONARY_ENTRY_IN_USE' },
    { code: 'PROJECT_DICTIONARY_NAME_TAKEN' },
    { code: 'PROJECT_NOTE_NOT_AUTHOR' },
    { code: 'PROJECT_MESSAGE_IMMUTABLE' },
    { code: 'PROJECT_ATTACHMENT_TOO_LARGE' },
  ],
  /**
   * The one e-mail this module sends: a Stage deadline alert, to every Member
   * who may see the Project, on the day the deadline is that many days away
   * (User Story 8). Its default subject and body, in English and Polish, are
   * pushed from this module's boot hook
   * (`src/backend/email-templates/stage-alert-defaults.ts`); an operator edits
   * them, or switches the e-mail off, on the e-mail templates screen.
   *
   * The variables are what the bell entry says and no more.
   */
  transactionalEmails: [
    {
      code: 'projects_stage_deadline_alert',
      name: 'Stage deadline alert',
      group: 'projects',
      description:
        'Sent to every member of a project who may see it, on the day a deadline alert of its current stage is due — a set number of days before the stage deadline.',
      variables: [
        { key: 'project.number', label: 'Project number', sampleValue: 'PRJ-000042' },
        { key: 'stage.name', label: 'Stage name', sampleValue: 'Design' },
        { key: 'stage.deadline', label: 'Stage deadline', sampleValue: 'October 30, 2026' },
        { key: 'alert.daysLeft', label: 'Days left until the deadline', sampleValue: '3' },
      ],
    },
  ],
  /**
   * The command palette (Principle XVI, FR-041; `contracts/admin-surfaces.md`
   * §4). Each opens a screen of this module's own admin layer and declares the
   * code that screen is gated on. The Templates screen is `projects:configure`
   * while the list it loads is read-gated (the create form offers Templates to
   * every writer), which `check:action-route-permissions` ledgers. The roles and
   * loss-reason dictionaries joined with issue #516: both are sidebar screens on
   * `projects:configure`.
   */
  actions: [
    {
      id: 'open-projects',
      labelKey: 'actions.openProjects.label',
      descriptionKey: 'actions.openProjects.description',
      icon: 'ClipboardList',
      targetRoute: '/projects',
      requiredPermission: 'projects:read',
      keywords: ['projects', 'project', 'stages', 'work', 'projekty', 'projekt', 'etapy'],
      weight: 340,
    },
    {
      id: 'new-project',
      labelKey: 'actions.newProject.label',
      descriptionKey: 'actions.newProject.description',
      icon: 'FolderPlus',
      targetRoute: '/projects/new',
      requiredPermission: 'projects:write',
      keywords: ['project', 'new', 'create', 'projekt', 'nowy', 'utwórz'],
      weight: 341,
    },
    {
      id: 'open-project-templates',
      labelKey: 'actions.openProjectTemplates.label',
      descriptionKey: 'actions.openProjectTemplates.description',
      icon: 'Layers',
      targetRoute: '/projects/templates',
      requiredPermission: 'projects:configure',
      keywords: ['project', 'templates', 'template', 'stages', 'projekt', 'szablony', 'szablon'],
      weight: 342,
    },
    {
      id: 'open-project-analytics',
      labelKey: 'actions.openProjectAnalytics.label',
      descriptionKey: 'actions.openProjectAnalytics.description',
      icon: 'LineChart',
      targetRoute: '/projects/analytics',
      requiredPermission: 'projects:analytics',
      keywords: ['project', 'analytics', 'report', 'statistics', 'projekt', 'analityka', 'raport'],
      weight: 343,
    },
    {
      id: 'open-project-roles',
      labelKey: 'actions.openProjectRoles.label',
      descriptionKey: 'actions.openProjectRoles.description',
      icon: 'Users',
      targetRoute: '/projects/roles',
      requiredPermission: 'projects:configure',
      keywords: ['project', 'roles', 'role', 'team', 'projekt', 'role', 'zespół'],
      weight: 344,
    },
    {
      id: 'open-project-loss-reasons',
      labelKey: 'actions.openProjectLossReasons.label',
      descriptionKey: 'actions.openProjectLossReasons.description',
      icon: 'Tag',
      targetRoute: '/projects/loss-reasons',
      requiredPermission: 'projects:configure',
      keywords: ['project', 'loss', 'lost', 'reasons', 'projekt', 'utrata', 'powody'],
      weight: 345,
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  // `docs/projects.md` at the package root: users' and developers' page.
  docs: { dir: 'docs' },
  // The demo Projects are a step of the demo composition, not this module's
  // demo body (research R-20, T134); `false` is a decision, absent would be
  // "nobody has decided".
  demo: false,
});
