import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Returns module — manifest (feature 046, Zwroty / Refunds / RMA).
 *
 * Owns return/complaint (RMA) case management: configurable workflow, RMA
 * numbering, comments, settlement (refunds / credit / replacement / repair),
 * return delivery methods, and the defaults the EU consumer rules set: the
 * 14-day withdrawal period of Directive 2011/83 art. 9, and the withdrawal
 * function its art. 11a (inserted by Directive (EU) 2023/2673, applicable from
 * 19 June 2026) requires. Scalar
 * settings are declared here and seeded by the module-lifecycle
 * ManifestReconciler on boot; they are Sales-Channel-scopable through the
 * standard settings scoping.
 */

export const RETURNS_SETTING_CODES = {
  /** Number of free-return days (0 = no free-return option); counted from the
   *  order's fulfilment-completing status. Default 14 = EU withdrawal period. */
  FREE_RETURN_DAYS: 'returns.free_return_days',
  /** Text prepended to the generated RMA number (e.g. "RMA-"). */
  RMA_NUMBER_PREFIX: 'returns.rma_number_prefix',
  /** Text appended to the generated RMA number. */
  RMA_NUMBER_SUFFIX: 'returns.rma_number_suffix',
  /** Who bears the return cost once the free-return window has passed. */
  DEFAULT_COST_BEARER_OUTSIDE_WINDOW: 'returns.default_cost_bearer_outside_window',
  /** The IANA zone the free-return window and the withdrawal period count calendar days in (issue #905). */
  TIME_ZONE: 'returns.time_zone',
  /**
   * `specs/180-off-platform-complaints/` FR-A01 — who receives the *new case*
   * e-mail. Validated when it is sent, not when it is saved (research R-4).
   */
  NEW_CASE_RECIPIENTS: 'returns.new_case_recipients',
  /** 180 FR-B01 — complaints without a platform order are accepted on the channel. */
  OFF_PLATFORM_COMPLAINTS_ENABLED: 'returns.off_platform_complaints_enabled',
  /** 180 FR-B21 — a complaint without a platform order needs a proof-of-purchase attachment. */
  PROOF_OF_PURCHASE_REQUIRED: 'returns.proof_of_purchase_required',
} as const;

/** `returns.time_zone`'s default, and what a value the runtime does not know falls back to. */
export const RETURNS_DEFAULT_TIME_ZONE = 'Europe/Warsaw';

const settings = defineModuleSettingsManifest({
  moduleCode: 'returns',
  groups: [{ code: 'returns', name: 'Returns' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'returns.enabled',
      name: 'Returns enabled',
      description:
        'Switches the returns and complaints flow on or off: the customer-facing RMA request, the admin case list and the settlement paths that refund a payment, issue a corrective invoice or top up a credit limit. Nothing is dropped — open cases, their history and their refunds stay in the database and resume exactly where they were.',
      groupCode: 'returns',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
      name: 'Free-return window (days)',
      description:
        'Number of days a Customer may open a free return, counted from the moment the Order entered its fulfilment-completing status. 0 = no free-return option. Default 14 reflects the EU consumer withdrawal period (Directive 2011/83/EU, art. 9). Sales-channel value overrides the global value.',
      groupCode: 'returns',
      valueType: 'number',
      defaultValue: 14,
    },
    {
      code: RETURNS_SETTING_CODES.RMA_NUMBER_PREFIX,
      name: 'RMA number prefix',
      description: 'Text prepended to the generated RMA number (e.g. "RMA-"). Empty = no prefix.',
      groupCode: 'returns',
      valueType: 'string',
      defaultValue: 'RMA-',
    },
    {
      code: RETURNS_SETTING_CODES.RMA_NUMBER_SUFFIX,
      name: 'RMA number suffix',
      description: 'Text appended to the generated RMA number. Empty = no suffix.',
      groupCode: 'returns',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: RETURNS_SETTING_CODES.DEFAULT_COST_BEARER_OUTSIDE_WINDOW,
      name: 'Return cost bearer outside the free-return window',
      description:
        'Who bears the return shipping cost when a return is opened after the free-return window has passed.',
      groupCode: 'returns',
      valueType: 'string',
      defaultValue: 'customer',
      enumOptions: ['customer', 'shop'],
    },
    {
      // Issue #905 (design D3.4). A module setting of its own, as
      // `tasks.time_zone` is: there is no platform-wide shop time zone.
      code: RETURNS_SETTING_CODES.TIME_ZONE,
      name: 'Time zone of the return windows',
      description:
        'The time zone, as an IANA name such as Europe/Warsaw, in which the free-return window and the consumer\'s withdrawal period count calendar days: each ends at the end of its last day in this zone, and a last day on a Saturday or Sunday moves to the Monday. Sales-channel value overrides the global value.',
      groupCode: 'returns',
      valueType: 'string',
      defaultValue: RETURNS_DEFAULT_TIME_ZONE,
    },
    {
      // `specs/180-off-platform-complaints/` FR-A01, research R-4. The shape of
      // `orders.confirmation_recipients`; the settings store validates no list
      // item, so an invalid entry is skipped and reported at send time.
      code: RETURNS_SETTING_CODES.NEW_CASE_RECIPIENTS,
      name: 'New-case recipients',
      description:
        'E-mail addresses that receive the "new case" e-mail for every return and complaint filed. Up to 10 addresses are used. An invalid address is skipped and reported in the e-mail log. Sales-channel value replaces the global value.',
      groupCode: 'returns',
      valueType: 'string_list',
      defaultValue: [],
    },
    {
      // `specs/180-off-platform-complaints/` FR-B01. Evaluated inside an active
      // module: the module's own off state always wins over it.
      code: RETURNS_SETTING_CODES.OFF_PLATFORM_COMPLAINTS_ENABLED,
      name: 'Complaints without a platform order',
      description:
        'Customers may file a complaint about goods they did not buy on this platform: they name the product or model, the purchase date and how to reach them. Such a complaint is settled by repair, replacement or outside the platform, never by a refund here. Sales-channel value overrides the global value.',
      groupCode: 'returns',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      // `specs/180-off-platform-complaints/` FR-B21 (Clarifications).
      code: RETURNS_SETTING_CODES.PROOF_OF_PURCHASE_REQUIRED,
      name: 'Proof of purchase required',
      description:
        'A complaint without a platform order is accepted only with an attachment typed "proof of purchase". Applies to complaints without a platform order only; has no effect while those are switched off. Sales-channel value overrides the global value.',
      groupCode: 'returns',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

/** A transactional e-mail variable as the e-mail editor lists it. */
const variable = (key: string, label: string, sampleValue: string) => ({ key, label, sampleValue });

export const manifest = defineModuleManifest({
  id: 'returns',
  name: 'Returns',
  description: 'Return/complaint (RMA) case management, settlement, and refunds.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port and the customer guard this module
  // resolves; feature 072 made both container resolutions.
  //
  // T118c adds `customer_accounts`, whose `customerAccountReadPort` answers where
  // the authorize / reject e-mail goes. It arrived through `returnsBridge` until
  // this feature — a closure each composition root wrote over that same port —
  // so the edge was real and declared nowhere. It belongs in `dependencies`
  // rather than below: that module declares `nonDeactivatable`, so it has no off
  // state for a consequence to describe and the bind costs no operator a control.
  //
  // `orders` was already here, which is why `orderReturnContextPort` needs no
  // line of its own — nor `orderReadPort`, which judges the order a buyer
  // starts a return from (`specs/170-organization-roles/` FR-054). The other
  // three settlement owners are deliberately **not** here — see
  // `nonBindingDependencies`.
  //
  // `organizations` arrives with the two organization permissions below
  // (`specs/170-organization-roles/` OR-11, research R-41 item 7): the buyer
  // routes ask `organizationPermissionPort` whether the caller may open a case
  // and whether they see the Organization's cases. `organizations` declares
  // `nonDeactivatable`, so the bind costs no operator a control.
  //
  // `admin_users` arrives with `specs/180-off-platform-complaints/` phase A: its
  // `adminUserReadPort` names the administrator who authorized a case (FR-A41) and
  // lists the administrators the new-case bell entry goes to (research R-3). It
  // declares `nonDeactivatable`, so the bind costs no operator a control. So does
  // `_i18n`, whose `adminI18nService` words the CSV export's *former administrator*
  // and *unknown* in the request's language (FR-A41).
  //
  // `specs/180-off-platform-complaints/` phase B adds `assets_library`, whose
  // `objectStoragePort` holds the attachments' bytes (research R-12), and `catalog`,
  // whose `catalogProductAvailabilityPort` judges a no-order line's product (R-17).
  // Both declare `nonDeactivatable`, so neither bind costs an operator a control.
  dependencies: [
    '_i18n',
    'admin_users',
    'assets_library',
    'auth',
    'catalog',
    'customer_accounts',
    'orders',
    'organizations',
    'settings',
    'transactional_emails',
  ],
  /**
   * The three settlement owners an operator may switch off, and what stops when
   * they do (`specs/110-instance-repository/` T118c; D-44).
   *
   * All three are `refuses-without` rather than `dependencies`, and the reason is
   * the product's rather than the graph's. Settling a return is a **choice among
   * resolutions**: a refund goes through `payments`, a credit through
   * `credit_limits`, and the corrective document through `invoices` — and
   * `ReturnSettlementService` reaches each one only for the resolution it is
   * about. Binding them would make `payments.enabled`, `invoices.enabled` and
   * `credit_limits.enabled` refuse their flip for as long as `returns` is
   * present, which is a false coupling: a shop that offers no deferred-payment
   * credit switches `credit_limits` off and goes on refunding returns exactly as
   * before. Each is a `lazyPort` forward on a `di.providePort` name with no
   * fallback, so the seam refuses at the settlement and the rest of this module
   * keeps serving — which is what `refuses-without` says.
   *
   * Until T118c none of the three was declared anywhere: a composition root held
   * the forwarder and a root's resolution is nobody's dependency, so the
   * confirmation dialog for switching any of them off had nothing to say about
   * returns at all. Nothing about the behaviour changes here; what the entries
   * add is the sentence the operator reads.
   */
  nonBindingDependencies: [
    {
      // `specs/180-off-platform-complaints/` FR-A03, FR-A04, research R-3.
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent:
        'no bell entry is recorded for a new return or complaint; the case, the shop e-mail and the customer e-mails are unaffected',
      reason:
        'The one call into this owner records the new-case bell entries, inside the ' +
        '`returns-notifications` job after the case committed. The job asks ' +
        "`effectiveState.isPresent('admin_notifications')` first and records `not_present` " +
        'rather than catching a refusal, so an operator who switches the bell off loses ' +
        'nothing else of the notification. No table of that owner is referenced.',
    },
    {
      moduleId: 'payments',
      name: 'paymentRefundPort',
      kind: 'refuses-without',
      whenAbsent:
        'a return cannot be settled as a refund — the money-back resolution refuses and the ' +
        'case stays where it was, retryable; every other resolution, and the rest of the ' +
        'returns flow, is unaffected',
      reason:
        'Only the `refund` resolution reaches this port, inside step 2 of the settlement, ' +
        'before anything is written — so an absent owner leaves the case in `received` with ' +
        'nothing half-applied, which is the same law the gateway`s own `failed` outcome ' +
        'obeys. A `lazyPort` forward with no fallback. The degrade this port does own is in ' +
        'its return type (`pending_manual`), and that is about a method that cannot refund ' +
        'automatically, not about an owner that is not there.',
    },
    {
      moduleId: 'invoices',
      name: 'correctiveInvoicePort',
      kind: 'refuses-without',
      whenAbsent:
        'no return that moves money can be settled while a corrective invoice is requested — ' +
        'clearing that box on the settlement lets it through, and a replacement or a repair ' +
        'is unaffected either way',
      reason:
        'The correction is attempted for every money-moving settlement unless the caller ' +
        'passes `createCorrectiveInvoice: false`, so the refusal is wider than the other two ' +
        'and the sentence says so rather than naming refunds. A `lazyPort` forward with no ' +
        'fallback, called before any state is written, so the case stays retryable. ' +
        '`invoices` declares `orders` and not this module, so no cycle forces this ' +
        'classification — the operator`s control does.',
    },
    {
      moduleId: 'credit_limits',
      name: 'creditTopupPort',
      kind: 'refuses-without',
      whenAbsent:
        'a return cannot be settled as store credit — the credit resolution refuses; refunds, ' +
        'replacements and repairs are unaffected',
      reason:
        'Only the `credit` resolution reaches this port, and only for a case that carries an ' +
        'organisation — a case without one already answers `applied: false` without asking. A ' +
        '`lazyPort` forward with no fallback. Binding it would be the sharpest of the three ' +
        'false couplings: a shop that grants no deferred-payment credit has every reason to ' +
        'switch that module off and none to stop taking returns.',
    },
  ],
  settings,
  /**
   * The buyer actions this module gates by organization role
   * (`specs/170-organization-roles/` FR-022, OR-11, research R-41). One code
   * covers returns and complaints alike: they are one form and one route.
   *
   * - `returns.create` gates `POST /api/v1/returns` only (FR-052). Reading an
   *   order's returnable lines, one's own cases, and the follow-up actions on a
   *   case one filed stay open — they continue a case rather than open one.
   * - `returns.view_organization` widens the buyer's case list and case read
   *   from the cases they filed to every case of the Organization, as
   *   `orders.view_organization` widens orders (FR-053). It opens none of a
   *   colleague's case's follow-up actions (Q-R2 = A).
   *
   * Labels and descriptions are `organizationPermissions.<code>.{label,description}`
   * in this module's `i18n/{en,pl}.json`.
   */
  organizationPermissions: [
    {
      code: 'returns.create',
      label: 'Create returns and complaints',
      description:
        "Open a return or a complaint for an order you can see: your own, or a colleague's if you may view the organization's orders.",
      memberDefault: true,
    },
    {
      code: 'returns.view_organization',
      label: "View the organization's returns and complaints",
      description:
        'See every return and complaint filed in the organization, not only your own. Commenting, attaching files, choosing the return delivery method and cancelling stay with the member who filed the case.',
      memberDefault: false,
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Feature 047 — admin-editable transactional emails owned by this module.
  transactionalEmails: [
    {
      code: 'return_authorized',
      name: 'Return authorized',
      group: 'returns',
      variables: [
        { key: 'rmaNumber', label: 'RMA number', sampleValue: 'RMA-1042' },
        { key: 'returnCaseId', label: 'Return case ID', sampleValue: '…' },
      ],
    },
    {
      code: 'return_rejected',
      name: 'Return rejected',
      group: 'returns',
      variables: [
        { key: 'reason', label: 'Rejection reason', sampleValue: 'Item used beyond inspection' },
        { key: 'returnCaseId', label: 'Return case ID', sampleValue: '…' },
      ],
    },
    // `specs/180-off-platform-complaints/` phase A (contracts/settings-emails-events.md
    // §2): `caseReference` is the RMA number, else the derived `#XXXXXXXX` (FR-A44).
    {
      code: 'return_new_case',
      name: 'New return or complaint (to the shop)',
      group: 'returns',
      variables: [
        variable('caseReference', 'Case reference', '#3F9A21C0'),
        variable('kindLabel', 'Kind', 'Complaint'),
        variable('customerName', 'Customer', 'Ewa Nowak'),
        variable('organizationName', 'Organization', 'Acme Sp. z o.o.'),
        variable('productList', 'Products', '1 × Cordless drill'),
        variable('offPlatform', 'Bought elsewhere ("yes" or empty)', ''),
        variable('submittedAt', 'Filed at', '13 Nov 2026, 10:30'),
        variable('adminCaseUrl', 'Link to the case in the admin panel', 'https://admin.example.com/returns/…'),
      ],
    },
    {
      code: 'return_submitted',
      name: 'Return or complaint received (to the customer)',
      group: 'returns',
      variables: [
        variable('caseReference', 'Case reference', '#3F9A21C0'),
        variable('kindLabel', 'Kind', 'Complaint'),
        variable('productList', 'Products', '1 × Cordless drill'),
        variable('submittedAt', 'Filed at', '13 Nov 2026, 10:30'),
        variable('caseUrl', 'Link to the case in the customer account', 'https://shop.example.com/returns/…'),
      ],
    },
    {
      code: 'return_comment_added',
      name: 'Message on a return or complaint (to the customer)',
      group: 'returns',
      variables: [
        variable('caseReference', 'Case reference', 'RMA-1042'),
        variable('commentBody', 'Message', 'We received your parcel and are checking the goods.'),
        variable('caseUrl', 'Link to the case in the customer account', 'https://shop.example.com/returns/…'),
      ],
    },
    {
      code: 'return_status_entered',
      name: 'Return or complaint status changed (to the customer)',
      group: 'returns',
      variables: [
        variable('caseReference', 'Case reference', 'RMA-1042'),
        variable('statusName', 'New status', 'Received'),
        variable('caseUrl', 'Link to the case in the customer account', 'https://shop.example.com/returns/…'),
      ],
    },
  ],
  permissions: [
    { code: 'returns:read', label: 'View returns / RMA cases' },
    { code: 'returns:write', label: 'Manage returns / RMA cases, settlement, and configuration' },
  ],
  actions: [
    {
      id: 'open-returns',
      labelKey: 'actions.openReturns.label',
      descriptionKey: 'actions.openReturns.description',
      icon: 'Package',
      targetRoute: '/returns',
      requiredPermission: 'returns:read',
      keywords: ['returns', 'refunds', 'rma'],
      keywordsKey: 'actions.openReturns.keywords',
      weight: 230,
    },
    {
      id: 'return-statuses',
      labelKey: 'actions.returnStatusConfig.label',
      descriptionKey: 'actions.returnStatusConfig.description',
      icon: 'Settings',
      targetRoute: '/returns/statuses',
      // `returns:read`, for the same reason as `orders:order-statuses`: the GET
      // that renders the screen is read-gated, so the write code hid a screen
      // read-only operators can open (issue #232).
      requiredPermission: 'returns:read',
      keywords: ['return status', 'rma workflow'],
      keywordsKey: 'actions.returnStatusConfig.keywords',
      weight: 235,
    },
    {
      // `specs/180-off-platform-complaints/` contracts/settings-emails-events.md §8:
      // read-gated like `return-statuses` (issue #232's reasoning).
      id: 'return-clauses',
      labelKey: 'actions.returnClauses.label',
      descriptionKey: 'actions.returnClauses.description',
      icon: 'FileCheck',
      targetRoute: '/returns/clauses',
      requiredPermission: 'returns:read',
      keywords: ['return terms', 'complaint clauses'],
      keywordsKey: 'actions.returnClauses.keywords',
      weight: 236,
    },
  ],
  activation: { settingCode: 'returns.enabled', default: true },
  /**
   * The error codes this module owns. The first, minted by feature 155
   * (`specs/155-catalog-order-constraints/contracts/error-codes.md`):
   * `RETURN_LINE_NOT_RETURNABLE`, the refusal of a `return`-kind case naming an
   * order line recorded as not returnable at purchase. The policy is this
   * module's — `orders` only reports the stamp through `OrderReturnContextPort`
   * — and `createCase` is the one raise site. Its sentence is `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`. No token: its `details` carry
   * `{ productName, orderItemIds, lines }`, no `code`.
   *
   * `RETURN_SAVED_VIEW_NAME_TAKEN` (#312) is the 409 a saved view on the return
   * list earns when its owner already holds one whose name differs only by case
   * or surrounding spaces; `return-list-view-service.ts` is the one raise site.
   *
   * `RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED` (#905, design D1) is the 422
   * a consumer withdrawal's settlement as a credit, a replacement or a repair
   * earns while the consumer's consent to that resolution is not on record;
   * `return-settlement-service.ts` is the one raise site. Its `details` carry
   * `{ resolution }`, no `code`.
   */
  errorCodes: [
    { code: 'RETURN_LINE_NOT_RETURNABLE' },
    { code: 'RETURN_SAVED_VIEW_NAME_TAKEN' },
    { code: 'RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED' },
    // Issue #625 (#86) — business-state refusals that were `VALIDATION_FAILED`.
    // A token picks the sentence where one code has several raise sites: a
    // charge's refund (`delivery`, `surcharge`; a line's has none) and the two
    // terminal-status sites. The status-graph family mirrors `ORDER_STATUS_*`.
    { code: 'RETURN_ORDER_NOT_ELIGIBLE' },
    { code: 'RETURN_QUANTITY_EXCEEDS_RETURNABLE' },
    { code: 'RETURN_REASON_INACTIVE' },
    { code: 'RETURN_COMMENTS_CLOSED' },
    { code: 'RETURN_CASE_CLOSED' },
    { code: 'RETURN_DELIVERY_METHOD_UNAVAILABLE' },
    { code: 'RETURN_SETTLEMENT_IN_PROGRESS' },
    { code: 'RETURN_REFUND_EXCEEDS_PAID', tokens: ['delivery', 'surcharge'] },
    { code: 'RETURN_REFUND_GATEWAY_FAILED' },
    { code: 'RETURN_STATUS_CODE_TAKEN' },
    { code: 'RETURN_STATUS_TERMINAL_HAS_TRANSITIONS', tokens: ['mark_terminal', 'add_transition'] },
    { code: 'RETURN_STATUS_NOT_DELETABLE', tokens: ['initial'] },
    { code: 'RETURN_STATUS_IN_USE' },
    // `specs/180-off-platform-complaints/` contracts/settings-emails-events.md §4.
    { code: 'RETURN_OFF_PLATFORM_DISABLED' },
    { code: 'RETURN_PROOF_OF_PURCHASE_REQUIRED' },
    { code: 'RETURN_CLAUSES_NOT_ACCEPTED' },
    // The refusal travels in `details.reason` (too_large, type_not_accepted,
    // unknown_upload, too_many, submission_too_large), never in `details.code`:
    // one sentence, the reason beside it.
    { code: 'RETURN_ATTACHMENT_REJECTED', tokens: [] },
    { code: 'RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM' },
  ],
});
