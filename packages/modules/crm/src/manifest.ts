import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * CRM — Sales Opportunities and their configurable status workflow
 * (`specs/143-crm-sales-opportunities/`).
 *
 * The module is operator-toggleable (Constitution XVII): `crm.enabled` is its
 * activation control, and everything it contributes — routes, subscribers,
 * workers, admin surfaces — stops with it. Nothing is dropped while it is off.
 */

/**
 * The module's setting codes, for the code that reads them and the tests that
 * write them.
 */
export const CRM_SETTING_CODES = {
  ENABLED: 'crm.enabled',
  AUTO_CREATE_FROM_ORDERS: 'crm.auto_create_from_orders',
  AUTO_CREATE_FROM_QUOTE_REQUESTS: 'crm.auto_create_from_quote_requests',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'crm',
  groups: [
    {
      code: 'crm',
      name: 'CRM',
    },
  ],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: CRM_SETTING_CODES.ENABLED,
      name: 'CRM enabled',
      description:
        'Switches the CRM on or off: the sales opportunity screens, the status workflow and its configuration, and the link between an opportunity and its orders. Nothing is dropped — every opportunity, its history and the workflow configuration stay in the database and resume where they were.',
      groupCode: 'crm',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // What `backend/test/integration/crm/auto-create.test.ts` proves, and no
      // more: placed after it is switched on, read for the order's sales
      // channel, never a second opportunity for one document.
      code: CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS,
      name: 'Create an opportunity for every new order',
      description:
        'When on, an order placed after this is switched on gets a sales opportunity of its own, linked to it: for the order\'s organization and sales channel, in the start status, assigned by the default rule, with a value calculated from the order. Never for an order that is already linked to an opportunity, and never for an order placed from a quote request that is linked to one — that order joins the same opportunity. Can be set per sales channel. Off by default.',
      groupCode: 'crm',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS,
      name: 'Create an opportunity for every new quote request',
      description:
        'When on, a quote request a customer submits after this is switched on gets a sales opportunity of its own, linked to it: for the quote request\'s organization, in the start status, assigned by the default rule, with a value calculated from the quote request. Never for a quote request that is already linked to an opportunity. Needs the Quote Requests module to be on. Off by default.',
      groupCode: 'crm',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'crm',
  name: 'CRM',
  description:
    'Sales opportunities with a configurable status workflow that linked orders follow.',
  version: '1.0.0',
  // Every owner named here is one the platform refuses to switch off, so none
  // of these edges can deaden an operator's switch.
  //
  // `auth` owns `requireAdmin`, which gates every route of this module;
  // `settings` owns the store the activation control and the module settings
  // live in.
  //
  // `organizations` and `sales_channels` are forced by the schema:
  // `crm_opportunities.organization_id` and `.sales_channel_id` are foreign
  // keys into their tables, and a cross-module foreign key is declared here or
  // the migration order is wrong.
  //
  // `orders`, `customer_accounts`, `catalog`, `admin_users` and
  // `assets_library` own the ports the module's services resolve: linked Orders
  // and their status, the contact person, referenced Products, assignees and
  // authors, and the media library an attachment lives in.
  dependencies: [
    'admin_users',
    'assets_library',
    'auth',
    'catalog',
    'customer_accounts',
    'orders',
    'organizations',
    'sales_channels',
    'settings',
  ],
  /**
   * Edges that are real to the container and bind no operator.
   *
   * `admin_notifications` is operator-switchable, and telling somebody an
   * Opportunity is theirs is a courtesy: the notifier asks
   * `effectiveState.isPresent('admin_notifications')` before it resolves the
   * port, so with the bell off an assignment succeeds and nobody is told. A
   * `dependencies` entry would have stopped an operator switching the bell off
   * while CRM is on.
   */
  nonBindingDependencies: [
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent:
        'CRM stops notifying people about assignments and messages; everything else in CRM ' +
        'keeps working',
      reason:
        'The one call into this owner is `crm-notifier.ts`, which decides its presence in front ' +
        'of the gate and answers `not-present` in its return type; nothing in this module fails ' +
        'closed on it, and no table of that owner is referenced from this module\'s schema.',
    },
    // CRM offers three of its events to outbound webhooks by pushing their
    // names into `webhooks`' registry from a contribution-only boot hook. A
    // push, and nothing read back: with `webhooks` off or absent nothing is
    // delivered and nothing in this module changes, so there is no
    // `whenAbsent` to state.
    {
      moduleId: 'webhooks',
      name: 'webhookEventRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module\'s contribution-only boot hook, of the three event names it ' +
        'offers for outbound delivery. Nothing is read back: the registry is a plain ' +
        'registration that leaves out every event type whose owner is not present when it is ' +
        'read, and `webhooks` bridges and delivers through its own gated subscription.',
    },
    // `quote_requests` is operator-switchable too. A shop that sells without
    // quotes still wants a pipeline, so the quote desk's switch must not be
    // held by this module (owner decision of 2026-10-05, research R-17).
    {
      moduleId: 'quote_requests',
      name: 'quoteRequestReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'Quote Requests linked to Opportunities show as unavailable, stop counting toward ' +
        'computed values, and can no longer be linked or created from one. ' +
        'Opportunities and their Orders keep working',
      reason:
        'Every call into this owner goes through `crm-quote-requests.ts`, whose callers ask ' +
        '`isPresent()` in front of the gate: a linked Quote Request is skipped when it renders ' +
        'and when a value is computed, and linking one answers 503 from that decision rather ' +
        'than from a caught refusal. A link holds the Quote Request by value, so no table of ' +
        'that owner is referenced from this module\'s schema.',
    },
  ],
  settings,
  // Constitution XVII — the operator's activation control.
  activation: { settingCode: 'crm.enabled', default: true },
  /**
   * `requires` is advisory: the Opportunity screen shows the Orders linked to
   * it and searches Orders to link one, through `orders`' own admin endpoints,
   * which enforce `orders:read`. A role holding `crm:read` alone sees
   * Opportunities with their linked Orders unavailable.
   *
   * Only the codes a route of this module enforces today are declared. The
   * inventory sweeps both directions — a code granted before its gate lands
   * fails as loudly as a gate with no code — so each later code is declared by
   * the change that adds its first `requireAdmin`.
   *
   * `crm:configure` also gates deleting an Opportunity: removing a record with
   * its whole history is an administrator's act, not a step of daily work.
   */
  permissions: [
    {
      code: 'crm:read',
      label: 'View sales opportunities',
      module: 'crm',
      requires: ['orders:read'],
    },
    {
      code: 'crm:write',
      label: 'Create and work sales opportunities',
      module: 'crm',
      requires: ['crm:read'],
    },
    {
      code: 'crm:configure',
      label: 'Configure the CRM workflow and tags',
      module: 'crm',
      requires: ['crm:read'],
    },
  ],
  /**
   * The refusals this module raises, each with its sentence under
   * `errors.<CODE>` in `i18n/{en,pl}.json`. Each code was declared by the
   * change that added its first raise site.
   *
   * `CRM_TRANSITION_VETOED` carries the guard's own sentence: the raise puts it
   * in `details.reason` and both bundle sentences are that placeholder alone,
   * so the Sales Rep reads what the guard's author wrote.
   */
  errorCodes: [
    { code: 'CRM_OPPORTUNITY_NOT_FOUND' },
    { code: 'CRM_INVALID_TRANSITION' },
    { code: 'CRM_TRANSITION_VETOED' },
    { code: 'CRM_TRANSITION_CONFLICT' },
    { code: 'CRM_DOCUMENT_NOT_FOUND' },
    { code: 'CRM_DOCUMENT_ALREADY_LINKED' },
    { code: 'CRM_LINK_ORGANIZATION_MISMATCH' },
    { code: 'CRM_STATUS_CODE_TAKEN' },
    { code: 'CRM_STATUS_IN_USE' },
    { code: 'CRM_STATUS_INITIAL_REQUIRED' },
    { code: 'CRM_ASSIGNEE_INVALID' },
    { code: 'CRM_TAG_NAME_TAKEN' },
    { code: 'CRM_MESSAGE_IMMUTABLE' },
    // One sentence per broken rule: the raise carries the rule as its refusal
    // token (`details.code`) beside `details.rule`, which the contract names.
    {
      code: 'CRM_WORKFLOW_INVALID',
      tokens: [
        'exactly_one_initial',
        'initial_must_be_open',
        'won_status_required',
        'lost_status_required',
        'transition_unknown_status',
        'mapping_unknown_status',
        'mapping_duplicate',
        'mapping_duplicate_order_status',
      ],
    },
  ],
  /**
   * The command palette (Principle XVI): the landing surface, the one thing a
   * Sales Rep starts from it daily, and the board. Curated, not a route dump —
   * the workflow configuration is reached from the sidebar by the few who
   * configure it.
   *
   * Each `requiredPermission` is the code the target route itself enforces
   * (`src/admin/index.ts`), so the palette never advertises a screen the
   * operator cannot open.
   */
  actions: [
    {
      id: 'open-opportunities',
      labelKey: 'actions.openOpportunities.label',
      descriptionKey: 'actions.openOpportunities.description',
      icon: 'CircleDollarSign',
      targetRoute: '/crm/opportunities',
      requiredPermission: 'crm:read',
      keywords: ['crm', 'opportunity', 'opportunities', 'pipeline', 'szansa', 'sprzedaż', 'lejek'],
      weight: 320,
    },
    {
      id: 'new-opportunity',
      labelKey: 'actions.newOpportunity.label',
      descriptionKey: 'actions.newOpportunity.description',
      icon: 'PlusCircle',
      targetRoute: '/crm/opportunities/new',
      requiredPermission: 'crm:write',
      keywords: ['crm', 'opportunity', 'new', 'create', 'szansa', 'sprzedaż', 'nowa'],
      weight: 321,
    },
    {
      id: 'open-opportunity-board',
      labelKey: 'actions.openOpportunityBoard.label',
      descriptionKey: 'actions.openOpportunityBoard.description',
      icon: 'PanelLeft',
      targetRoute: '/crm/board',
      requiredPermission: 'crm:read',
      keywords: ['crm', 'opportunity', 'board', 'kanban', 'pipeline', 'szansa', 'tablica', 'lejek'],
      weight: 322,
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Demo data is a later story's decision (research R-24); `false` is a
  // decision, absent would be "nobody has decided".
  demo: false,
});
