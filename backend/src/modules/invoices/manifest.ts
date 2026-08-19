import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Invoices module — manifest (feature 047-invoices-module).
 *
 * Owns invoice generation (proforma / VAT invoice / correction), the per-channel
 * numbering engine, the WYSIWYG PDF templates, seller company settings, and
 * email delivery (through the transactional_emails module). Scalar settings are
 * declared here and seeded by the module-lifecycle ManifestReconciler on boot;
 * all are Sales-Channel-scopable through the standard settings scoping.
 */

export const INVOICES_SETTING_CODES = {
  SELLER_TAX_ID: 'invoices.seller.tax_id',
  SELLER_COMPANY_DATA: 'invoices.seller.company_data',
  AUTO_ISSUE_TRIGGER_STATUS: 'invoices.auto_issue.trigger_status',
  EMAIL_SEND_ON_ISSUE: 'invoices.email.send_on_issue',
  EMAIL_DELIVERY_MODE: 'invoices.email.delivery_mode',
  NUMBERING_INVOICE_PATTERN: 'invoices.numbering.invoice.pattern',
  NUMBERING_PROFORMA_PATTERN: 'invoices.numbering.proforma.pattern',
  NUMBERING_CORRECTION_PATTERN: 'invoices.numbering.correction.pattern',
  STOREFRONT_BASE_URL: 'invoices.storefront_base_url',
} as const;

export const invoicesSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'invoices',
  groups: [{ code: 'invoices', name: 'Invoices' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'invoices.enabled',
      name: 'Invoices enabled',
      description:
        'Switches invoice issuance, corrections, the PDF renderer and the customer-facing invoice list on or off. Nothing is dropped: issued invoices, their numbering sequence and their templates stay in the database, and issuance resumes from the same sequence when you switch it back on.',
      groupCode: 'invoices',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: INVOICES_SETTING_CODES.SELLER_TAX_ID,
      name: 'Seller VAT / NIP',
      description:
        'Your company VAT/NIP number printed on every invoice as the seller. Sales-channel value overrides the global value.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: INVOICES_SETTING_CODES.SELLER_COMPANY_DATA,
      name: 'Seller company data',
      description:
        'Seller (your company) data printed on invoices: { legalName, addressLine1, addressLine2, postalCode, city, country, bankName, bankAccount, swift, email, phone }. JSON object.',
      groupCode: 'invoices',
      valueType: 'json',
      defaultValue: {},
    },
    {
      code: INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS,
      name: 'Auto-issue on order status',
      description:
        'Order status code that automatically issues a VAT invoice when reached (e.g. "paid"). Empty = manual issuance only.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE,
      name: 'Email invoice on issue',
      description: 'When enabled, the invoice is emailed to the customer automatically once issued.',
      groupCode: 'invoices',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: INVOICES_SETTING_CODES.EMAIL_DELIVERY_MODE,
      name: 'Invoice email delivery mode',
      description:
        'Whether the invoice email carries the PDF as an attachment or a link to the storefront customer panel download.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'attachment',
      enumOptions: ['attachment', 'link'],
    },
    // Feature 078, D-95.3 — the three numbering defaults carry `{channel}`.
    //
    // Every channel used to resolve one and the same default, so *creating a
    // sales channel* armed a duplicate: two channels drew sequence 1 in the
    // same year, rendered one string, and the second issuance died on
    // `invoices_number_unique`. The operator never had to open this screen for
    // that to happen, which is why the fix is in the default rather than only
    // in the write refusal.
    //
    // `previousDefaultValues` names the pre-D-95 string so `ManifestReconciler`
    // migrates a deployment that never overrode it instead of refusing to boot.
    // The system-default channel is pinned back to the old pattern by this
    // module's boot hook, so no existing series changes shape.
    {
      code: INVOICES_SETTING_CODES.NUMBERING_INVOICE_PATTERN,
      name: 'Invoice numbering pattern',
      description:
        'Format for VAT invoice numbers. Tokens: {seq}, {seq:N} (zero-padded), {channel} (the sales channel code), {YYYY}, {YY}, {MM}. The sequence resets yearly, per channel, while the number itself must be unique across the whole platform — so a pattern shared by two channels needs {channel} in it.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'FV {seq}/{channel}/{YYYY}',
      previousDefaultValues: ['FV {seq}/{YYYY}'],
    },
    {
      code: INVOICES_SETTING_CODES.NUMBERING_PROFORMA_PATTERN,
      name: 'Proforma numbering pattern',
      description:
        'Format for proforma numbers. Tokens: {seq}, {seq:N} (zero-padded), {channel} (the sales channel code), {YYYY}, {YY}, {MM}. The sequence resets yearly, per channel, while the number itself must be unique across the whole platform — so a pattern shared by two channels needs {channel} in it.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'PRO {seq}/{channel}/{YYYY}',
      previousDefaultValues: ['PRO {seq}/{YYYY}'],
    },
    {
      code: INVOICES_SETTING_CODES.NUMBERING_CORRECTION_PATTERN,
      name: 'Correction numbering pattern',
      description:
        'Format for corrective-invoice numbers. Tokens: {seq}, {seq:N} (zero-padded), {channel} (the sales channel code), {YYYY}, {YY}, {MM}. The sequence resets yearly, per channel, while the number itself must be unique across the whole platform — so a pattern shared by two channels needs {channel} in it.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'KOR {seq}/{channel}/{YYYY}',
      previousDefaultValues: ['KOR {seq}/{YYYY}'],
    },
    {
      code: INVOICES_SETTING_CODES.STOREFRONT_BASE_URL,
      name: 'Storefront base URL (for invoice email links)',
      description:
        'Base URL used to build the customer-panel invoice download link in link-mode emails (e.g. https://shop.example.com). Empty = links disabled.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'invoices',
  name: 'Invoices',
  description: 'Invoice generation, numbering, PDF templates, corrections, and email delivery.',
  version: '2.0.0',
  // `auth` owns the `requireAdmin` port and the customer guard this module
  // resolves; feature 072 made both container resolutions.
  // `ksef` is deliberately absent: it reads `invoiceService`, so declaring it
  // here would close a cycle. The KSeF verification block reaches this module
  // as a contribution a root fills, not as a port this module resolves.
  dependencies: [
    'auth',
    'orders',
    'settings',
    'transactional_emails',
  ],
  settings: invoicesSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  // Feature 047 — admin-editable transactional email owned by this module.
  transactionalEmails: [
    {
      code: 'invoice_issued',
      name: 'Invoice issued',
      group: 'invoices',
      variables: [
        { key: 'invoice.number', label: 'Invoice number', sampleValue: 'FV 26/2026' },
        { key: 'invoice.total', label: 'Invoice total', sampleValue: '6 648,15' },
        { key: 'invoice.currency', label: 'Currency', sampleValue: 'PLN' },
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'invoice.downloadUrl', label: 'Download link', sampleValue: 'https://shop.example.com/orders/…' },
      ],
    },
  ],
  permissions: [
    { code: 'invoices:read', label: 'View invoices and download invoice PDFs' },
    { code: 'invoices:write', label: 'Issue/correct invoices, edit templates, and configure invoicing' },
  ],
  actions: [
    {
      id: 'open-invoices',
      labelKey: 'actions.openInvoices.label',
      descriptionKey: 'actions.openInvoices.description',
      icon: 'FileText',
      targetRoute: '/invoices',
      requiredPermission: 'invoices:read',
      keywords: ['invoices', 'faktury', 'vat', 'billing'],
      weight: 240,
    },
    {
      id: 'invoice-templates',
      labelKey: 'actions.invoiceTemplates.label',
      descriptionKey: 'actions.invoiceTemplates.description',
      icon: 'Layers',
      targetRoute: '/invoices/templates',
      // `invoices:read` — `GET /api/v1/admin/invoice-templates` is read-gated,
      // and the row is a destination rather than an operation (issue #232).
      requiredPermission: 'invoices:read',
      keywords: ['invoice template', 'szablon faktury', 'pdf'],
      weight: 245,
    },
  ],
  activation: { settingCode: 'invoices.enabled', default: true },
});
