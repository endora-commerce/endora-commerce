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
      code: INVOICE_LEDGER_SETTING_CODES.ACTIVATION,
      name: 'Invoice ledger enabled',
      description:
        'Switches the shared invoice-ledger rails on or off. Switching off also switches off every active ledger adapter such as Infakt. Adapters cannot be switched on again until this is on. Maps and delivery history stay.',
      groupCode: 'invoice_ledger',
      valueType: 'boolean',
      defaultValue: true,
    },
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
      moduleId: 'invoices',
      name: 'invoiceNumberingHostPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot write vendor-assigned numbers while invoices is off.',
      reason:
        'invoices is switchable; a hard dependency would freeze invoices while the ledger is on.',
    },
    {
      moduleId: 'invoices',
      name: 'invoicePaidHostPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot stamp paid from Infakt while invoices is off.',
      reason:
        'invoices is switchable; a hard dependency would freeze invoices while the ledger is on.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceKsefAssignmentPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot record Infakt KSeF numbers while invoices is off.',
      reason:
        'invoices is switchable; a hard dependency would freeze invoices while the ledger is on.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceCopyHostPort',
      kind: 'degrades-without',
      whenAbsent: 'Delivery list shows invoice ids without numbers while invoices is off.',
      reason:
        'List reads invoice numbers through the invoices copy port. invoices is switchable, so it cannot be a hard dependency.',
    },
  ],
  activation: {
    settingCode: INVOICE_LEDGER_SETTING_CODES.ACTIVATION,
    default: true,
    cascadeDependentsOnDeactivate: true,
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
