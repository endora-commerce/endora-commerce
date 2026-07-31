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
    {
      code: INVOICES_SETTING_CODES.NUMBERING_INVOICE_PATTERN,
      name: 'Invoice numbering pattern',
      description:
        'Format for VAT invoice numbers. Tokens: {seq}, {seq:N} (zero-padded), {YYYY}, {YY}, {MM}. The sequence resets yearly, per channel.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'FV {seq}/{YYYY}',
    },
    {
      code: INVOICES_SETTING_CODES.NUMBERING_PROFORMA_PATTERN,
      name: 'Proforma numbering pattern',
      description: 'Format for proforma numbers. Same tokens as the invoice pattern.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'PRO {seq}/{YYYY}',
    },
    {
      code: INVOICES_SETTING_CODES.NUMBERING_CORRECTION_PATTERN,
      name: 'Correction numbering pattern',
      description: 'Format for corrective-invoice numbers. Same tokens as the invoice pattern.',
      groupCode: 'invoices',
      valueType: 'string',
      defaultValue: 'KOR {seq}/{YYYY}',
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
  dependencies: ['orders', 'settings'],
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
      requiredPermission: 'invoices:write',
      keywords: ['invoice template', 'szablon faktury', 'pdf'],
      weight: 245,
    },
  ],
});
