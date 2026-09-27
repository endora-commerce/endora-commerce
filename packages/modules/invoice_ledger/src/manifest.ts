import {
  CAPABILITY_KEYS,
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
        'Native leaves submission to the platform (a KSeF submission module, when one is installed). Vendor skips native enqueue even when the ledger adapter is off. Sales-channel value overrides the instance default.',
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
    'Shared invoice-ledger rails: vendor mutex, numbering and KSeF routing, deliveries, and document maps. Vendor HTTP lives in the vendor adapter modules.',
  version: '1.0.0',
  dependencies: ['settings', 'organizations', 'admin_users', 'sales_channels'],
  nonBindingDependencies: [
    {
      moduleId: 'invoices',
      name: 'invoiceNumberingHostPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot write vendor-assigned numbers while invoices is off.',
      reason:
        'invoice_ledger is non-deactivatable, so invoices cannot be a hard dependency.',
    },
    {
      moduleId: 'invoices',
      name: 'invoicePaidHostPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot stamp an invoice paid from the vendor while invoices is off.',
      reason:
        'invoice_ledger is non-deactivatable, so invoices cannot be a hard dependency.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceKsefAssignmentPort',
      kind: 'refuses-without',
      whenAbsent: 'Webhook apply cannot record a vendor-assigned KSeF number while invoices is off.',
      reason:
        'invoice_ledger is non-deactivatable, so invoices cannot be a hard dependency.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceCopyHostPort',
      kind: 'degrades-without',
      whenAbsent:
        'Delivery list shows invoice ids without numbers while invoices is off, and no new delivery is queued.',
      reason:
        'List reads invoice numbers through the invoices copy port, and the enqueue path reads the buyer organization it freezes on the delivery row through the same port — the two ledger tables carry their own tenant key rather than hanging off Invoice, because invoice_ledger is non-deactivatable and invoices cannot be a hard dependency. With invoices off nothing issues an invoice, so there is no delivery to queue and the degrade is the list alone.',
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
  /**
   * Feature 132 — this module **owns** the invoice-ledger vendor capability and
   * declares it mutually exclusive, minting the code an operator meets
   * (`contracts/module-capabilities.md` R3.1). A vendor raises the code and must
   * not declare it (D-95.2); it declares membership and nothing more.
   */
  exclusiveCapabilities: [
    {
      key: CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR,
      errorCode: 'INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE',
    },
  ],
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
      keywords: ['ledger', 'deliveries', 'invoices', 'faktury'],
      weight: 245,
    },
  ],
});
