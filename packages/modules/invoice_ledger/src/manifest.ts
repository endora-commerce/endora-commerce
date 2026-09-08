import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  INVOICE_LEDGER_READ_PERMISSION,
  INVOICE_LEDGER_SETTING_CODES,
  INVOICE_LEDGER_WRITE_PERMISSION,
} from '@endora-commerce/contracts';

export const invoiceLedgerSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'invoice_ledger',
  groups: [{ code: 'invoice_ledger', name: 'Invoice ledger' }],
  settings: [
    {
      code: INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
      name: 'Invoice numbering source',
      description:
        'Whether issued VAT numbers stay Endora-assigned (mode A) or wait for the ledger vendor (mode B). Sales-channel value overrides the instance default.',
      groupCode: 'invoice_ledger',
      valueType: 'string',
      enumOptions: ['endora', 'vendor'],
      defaultValue: 'endora',
    },
    {
      code: INVOICE_LEDGER_SETTING_CODES.KSEF_ROUTING,
      name: 'KSeF submission routing',
      description:
        'Native submits through the KSeF module. Vendor skips native enqueue even when the ledger adapter is off. Sales-channel value overrides the instance default.',
      groupCode: 'invoice_ledger',
      valueType: 'string',
      enumOptions: ['native', 'vendor'],
      defaultValue: 'native',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'invoice_ledger',
  name: 'Invoice ledger',
  description:
    'Shared invoice-ledger rails: vendor mutex, numbering and KSeF routing, deliveries, and document maps. Vendor HTTP lives in adapter modules such as Infakt.',
  version: '1.0.0',
  dependencies: ['settings', 'organizations', 'admin_users', 'sales_channels'],
  nonBindingDependencies: [
    {
      moduleId: 'credentials',
      name: 'credentialsService',
      kind: 'refuses-without',
      whenAbsent:
        'VAT copy cannot freeze the Infakt environment while credentials are off.',
      reason:
        'Enqueue reads the instance Infakt credential environment at freeze time. invoice_ledger is non-deactivatable, so credentials cannot be a hard dependency.',
    },
  ],
  activation: {
    nonDeactivatable: true,
    reason:
      'The shared invoice ledger registry must stay available so operator activation of a ledger vendor can be refused when another is already active.',
  },
  settings: invoiceLedgerSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  errorCodes: [
    { code: 'INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE' },
    { code: 'INVOICE_LEDGER_CREDENTIALS_MISSING' },
    { code: 'INVOICE_LEDGER_DELIVERY_NOT_RETRYABLE' },
  ],
  permissions: [
    {
      code: INVOICE_LEDGER_READ_PERMISSION,
      label: 'View invoice ledger deliveries',
      description: 'Allows viewing ledger routing and delivery history.',
    },
    {
      code: INVOICE_LEDGER_WRITE_PERMISSION,
      label: 'Manage invoice ledger',
      description: 'Allows changing numbering and KSeF routing, and retrying deliveries.',
      requires: [INVOICE_LEDGER_READ_PERMISSION],
    },
  ],
  actions: [
    {
      id: 'open-invoice-ledger-deliveries',
      labelKey: 'actions.openDeliveries.label',
      descriptionKey: 'actions.openDeliveries.description',
      icon: 'ClipboardList',
      targetRoute: '/invoice-ledger/deliveries',
      requiredPermission: INVOICE_LEDGER_READ_PERMISSION,
      keywords: ['infakt', 'ledger', 'deliveries', 'invoices', 'faktury'],
      weight: 245,
    },
  ],
});
