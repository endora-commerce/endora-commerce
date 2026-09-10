import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Returns module — manifest (feature 046, Zwroty / Refunds / RMA).
 *
 * Owns return/complaint (RMA) case management: configurable workflow, RMA
 * numbering, comments, settlement (refunds / credit / replacement / repair),
 * return delivery methods, and the EU 2023/2673-aligned defaults. Scalar
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
} as const;

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
        'Number of days a Customer may open a free return, counted from the moment the Order entered its fulfilment-completing status. 0 = no free-return option. Default 14 reflects the EU consumer withdrawal period (Directive (EU) 2023/2673). Sales-channel value overrides the global value.',
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
  ],
});

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
  // line of its own. The other three settlement owners are deliberately **not**
  // here — see `nonBindingDependencies`.
  dependencies: [
    'auth',
    'customer_accounts',
    'orders',
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
      keywords: ['returns', 'refunds', 'rma', 'zwroty', 'reklamacje'],
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
      keywords: ['return status', 'rma workflow', 'statusy zwrotów'],
      weight: 235,
    },
  ],
  activation: { settingCode: 'returns.enabled', default: true },
});
