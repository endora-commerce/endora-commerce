import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

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
  //
  // `assets_library` and `customer_accounts` joined in
  // `specs/110-instance-repository/` T118c, when `invoicesBridge` was retired:
  // the operator's logo is `assetReadPort` and the invoice e-mail's recipient
  // is `customerAccountReadPort`, both resolved by this module now and both
  // reached through a composition root's closure before. Binding edges, and
  // **neither costs an operator a control** — derived and not waived: both
  // owners declare `activation.nonDeactivatable`, so there is no switchable
  // owner for a `refuses-without` sentence to describe. That is the same answer
  // `mfa` and `product_feeds` came to and a different one from `returns`, and
  // the difference is the owners', not the consumer's.
  dependencies: [
    'assets_library',
    'auth',
    'customer_accounts',
    'orders',
    'settings',
    'transactional_emails',
  ],
  settings: invoicesSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
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
  /**
   * The three error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where each sentence is looked up from: `errors.<CODE>` in this
   * module's own `i18n/{en,pl}.json`, which already holds all three in both
   * languages.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5): it is exactly
   * what the prefix chain in `@endora-commerce/mod-i18n` routes here today,
   * copied from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` rather than
   * re-derived. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **This module's list and this module's `throw`s are two different sets, in
   * both directions**, because ownership follows the domain noun and never the
   * thrower (D-95.2). `INVOICE_NOT_READY` is declared here and raised **only** by
   * `orders`, at both ends of its invoice-download path — `GET
   * /api/v1/orders/:id/invoice` and `POST /api/v1/admin/orders/bulk/print-invoices`,
   * both in that module's `routes.ts`. Going the other way, five
   * codes this module does raise belong elsewhere and are absent below:
   * `ORDER_NOT_FOUND` is `orders`', and `NOT_FOUND`, `VALIDATION_FAILED`,
   * `VERSION_CONFLICT` and `INTERNAL` are the platform's.
   *
   * **One more code a reader will look for here and not find.**
   * `PDF_GENERATION_FAILED` reads like this module's — it renders every invoice
   * PDF — and is `comparisons`', by the chain's own `code ===
   * ERROR_CODES.PDF_GENERATION_FAILED` rule. Nothing here raises it: this
   * module's PDF path throws no `HttpError` at all.
   *
   * **The tokens come off the raise sites, not off the bundle.** The envelope's
   * `refusalToken` (`packages/platform/src/http/error-envelope.ts`) reads exactly
   * one member of `details` — `code` — as the tail of `errors.<CODE>.<token>`, so
   * the token set is the set of values this module's raise sites can put there.
   * Unlike `carts` there is no enum and no named type here: every value is a bare
   * string literal, so the set is complete once the raise sites are enumerated,
   * and enumerating them completely is the whole of the work. Each token list
   * below is in raise-site order.
   *
   * - `INVOICE_NUMBER_ALREADY_ISSUED` — `duplicate-number-refusal.ts` throws it
   *   twice. The second throw writes `code: sameChannel ? 'same_channel' :
   *   'other_channel'`; the first, taken when the row holding the number has been
   *   deleted between the constraint violation and the read, deliberately passes
   *   no `code` and so answers the tokenless base sentence.
   * - `INVOICE_NUMBER_PATTERN_COLLIDES` — `numbering-write-validator.ts` throws it
   *   twice too, `{ code: 'no_sequence_token' }` for the self-collision and
   *   `code: 'other_channel'` for the pairwise one. Two separate throws in one
   *   file: an author who stopped at the first grep hit would declare one token
   *   and lose the other.
   * - `INVOICE_NOT_READY` — neither raise site passes `details` at all, so it
   *   carries no token.
   *
   * The bundle holds a sentence for all four and for no fifth, and
   * `backend/test/unit/invoices/error-sentences.test.ts` enumerates the same
   * seven keys by hand. Both agree with the raise sites; neither is the
   * authority, because a token nobody has written a sentence for is still a token
   * (`specs/090-module-owned-error-codes/migration-runbook.md` §5).
   */
  errorCodes: [
    { code: 'INVOICE_NOT_READY' },
    { code: 'INVOICE_NUMBER_ALREADY_ISSUED', tokens: ['same_channel', 'other_channel'] },
    {
      code: 'INVOICE_NUMBER_PATTERN_COLLIDES',
      tokens: ['no_sequence_token', 'other_channel'],
    },
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
  /**
   * The 10 invoice-template blocks this module owns, and the Invoice sections
   * section they populate (feature 096, §7.3 and §2.1).
   *
   * The eleventh block in that palette, `InvoiceKsef`, is **`ksef`'s** —
   * `ksef.InvoiceSection`, by the owner ruling of 2026-09-02 — which is why
   * weight 70 is left unused here.
   *
   * The category declaration carries a **`weight`** deliberately. `ksef`
   * declares the same section, joining it with no `weight` and no `visible`, so
   * under `contracts/block-definition.md` §1.1's total order this declaration
   * wins on weight and names the section. Leaving the weight off would put the
   * pair on the module-id tie-break, which happens to give the same answer
   * today and gives it for no stated reason.
   */
  blocks: [
    {
      name: 'invoices.InvoiceHeader',
      labelKey: 'blocks.invoiceHeader.label',
      descriptionKey: 'blocks.invoiceHeader.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 10,
    },
    {
      name: 'invoices.InvoiceParties',
      labelKey: 'blocks.invoiceParties.label',
      descriptionKey: 'blocks.invoiceParties.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 20,
    },
    {
      name: 'invoices.InvoiceLineItems',
      labelKey: 'blocks.invoiceLineItems.label',
      descriptionKey: 'blocks.invoiceLineItems.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 30,
    },
    {
      name: 'invoices.InvoiceVatSummary',
      labelKey: 'blocks.invoiceVatSummary.label',
      descriptionKey: 'blocks.invoiceVatSummary.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 40,
    },
    {
      name: 'invoices.InvoiceTotals',
      labelKey: 'blocks.invoiceTotals.label',
      descriptionKey: 'blocks.invoiceTotals.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 50,
    },
    {
      name: 'invoices.InvoiceNotes',
      labelKey: 'blocks.invoiceNotes.label',
      descriptionKey: 'blocks.invoiceNotes.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 60,
    },
    {
      name: 'invoices.InvoiceSpacer',
      labelKey: 'blocks.invoiceSpacer.label',
      descriptionKey: 'blocks.invoiceSpacer.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 80,
    },
    {
      name: 'invoices.InvoiceDivider',
      labelKey: 'blocks.invoiceDivider.label',
      descriptionKey: 'blocks.invoiceDivider.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 90,
    },
    {
      name: 'invoices.InvoiceLogo',
      labelKey: 'blocks.invoiceLogo.label',
      descriptionKey: 'blocks.invoiceLogo.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 100,
    },
    {
      name: 'invoices.InvoiceFooter',
      labelKey: 'blocks.invoiceFooter.label',
      descriptionKey: 'blocks.invoiceFooter.description',
      category: 'invoice',
      contexts: ['invoice'],
      fields: {},
      weight: 110,
    },
  ],
  blockCategories: [
    { key: 'invoice', titleKey: 'blocks.category.invoice', contexts: ['invoice'], weight: 10 },
  ],
});
