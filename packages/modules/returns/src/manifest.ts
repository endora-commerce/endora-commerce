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
  dependencies: [
    'auth',
    'orders',
    'settings',
    'transactional_emails',
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
