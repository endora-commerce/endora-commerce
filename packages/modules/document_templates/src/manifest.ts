import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

/**
 * Document templates — operator-designed Page Builder layouts for the PDF
 * documents the platform produces (`specs/152-compare-pdf-template/`).
 *
 * The module owns the template storage (`document_templates`, plus the import
 * markers of `document_template_imports`), the Commands that write it, the
 * admin API and screens, the Page Builder → pdfmake engine and the six
 * general-purpose blocks. It owns no document: a **document type** is
 * contributed by the module whose data the document prints — `comparisons`
 * and `invoices` in this release — through the `documentTypeRegistry`
 * contribution registry, and that module produces its documents through the
 * gated `documentRenderPort`, handing over its own data.
 *
 * It is operator-toggleable (Constitution XVII). While it is off the
 * comparison PDF falls back to the comparison module's fixed layout; invoices
 * bind it (research R-27, owner answer N2), so the lifecycle refuses to switch
 * it off while invoicing is on. Switching it off deletes nothing.
 */

const settings = defineModuleSettingsManifest({
  moduleCode: 'document_templates',
  groups: [{ code: 'document_templates', name: 'Document templates' }],
  settings: [
    {
      // The operator's activation control. Platform-wide.
      code: 'document_templates.enabled',
      name: 'Document templates enabled',
      description:
        'Switches the document templates screens, their API and template-based PDFs on or off. While it is off the product comparison PDF uses its fixed built-in layout. It cannot be switched off while invoicing is on, because invoice PDFs are produced from these templates. Nothing is dropped — every template comes back unchanged when you switch it back on.',
      groupCode: 'document_templates',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'document_templates',
  name: 'Document templates',
  description:
    'Design the PDF documents the platform produces — such as the product comparison, the invoice and the quote request — in the Page Builder, per document type, language and sales channel.',
  version: '1.0.0',
  // `settings` stores the activation control, `auth` owns `requireAdmin`, and
  // `assets_library` serves the bytes of the images an operator places in a
  // template. All three are non-deactivatable, so this module holds no other
  // module's switch.
  dependencies: ['settings', 'auth', 'assets_library'],
  settings,
  activation: { settingCode: 'document_templates.enabled', default: true },
  // FR-060 — viewing (list, editor, preview) and editing are separately
  // grantable. Invoice editors keep their access through `invoices`' one-time
  // grant (owner answers N3, P2).
  permissions: [
    { code: 'document_templates:read', label: 'View document templates' },
    {
      code: 'document_templates:write',
      label: 'Edit document templates',
      requires: ['document_templates:read'],
    },
  ],
  errorCodes: [
    { code: 'DOCUMENT_TEMPLATE_NOT_FOUND' },
    { code: 'DOCUMENT_TYPE_NOT_AVAILABLE' },
    // Raised through two `invalid(message, details)` helpers, whose callers
    // pass the offending `path`, `limit`, `language` or id and never a `code`
    // — so no refusal token (`check:error-translations`, issue #83).
    { code: 'DOCUMENT_TEMPLATE_INVALID', tokens: [] },
    { code: 'DOCUMENT_TEMPLATE_IS_DEFAULT' },
    { code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE' },
    { code: 'DOCUMENT_RENDER_FAILED' },
  ],
  // Principle XVI — the screen is reachable from ⌘K, also by the words an
  // operator used for the invoice templates screen it replaces (FR-062, FR-090).
  actions: [
    {
      id: 'open-document-templates',
      labelKey: 'actions.openDocumentTemplates.label',
      descriptionKey: 'actions.openDocumentTemplates.description',
      icon: 'FileText',
      targetRoute: '/document-templates',
      requiredPermission: 'document_templates:read',
      // At most ten (the action schema). Matched as substrings, so a generic
      // word an entry already contains ('pdf', 'szablon') needs no entry of
      // its own; the label and description are searched too.
      keywords: [
        'document template',
        'comparison pdf',
        'invoice template',
        'quote pdf',
        'offer template',
      ],
      keywordsKey: 'actions.openDocumentTemplates.keywords',
      weight: 650,
    },
  ],
  /**
   * The six general-purpose blocks (`data-model.md` §4.1). Declared for the
   * `document` context only, so they never reach a CMS page, an e-mail or a
   * newsletter; a document type offers them only if it opts in (`coreBlocks`).
   */
  blocks: [
    /**
     * Feature 153 — the **Line items table**
     * (`specs/153-quote-request-pdf-template/contracts/document-collections.md` §3).
     * Offered to a document type only when it declares a line collection. The
     * structured settings — columns, detail row, totals, grouping — are edited
     * through the facility's own custom fields in the admin; the descriptor
     * declares them so the Page Builder keeps them, and the scalar style
     * settings as ordinary fields.
     */
    {
      name: 'document_templates.ItemsTable',
      labelKey: 'blocks.itemsTable.label',
      descriptionKey: 'blocks.itemsTable.description',
      category: 'data',
      contexts: ['document'],
      fields: {
        collection: { type: 'text', label: 'Lines' },
        columns: { type: 'array', label: 'Columns' },
        detailRow: { type: 'object', label: 'Detail row' },
        totals: { type: 'array', label: 'Totals' },
        grouping: { type: 'object', label: 'Grouping' },
        emptyText: { type: 'text', label: 'Text when there are no lines' },
        fontSize: { type: 'number', label: 'Font size' },
        headerBackground: { type: 'text', label: 'Header background (#hex)' },
        borderColor: { type: 'text', label: 'Border colour (#hex)' },
        stripedRows: {
          type: 'radio',
          label: 'Striped rows',
          options: [
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ],
        },
        stripeColor: { type: 'text', label: 'Stripe colour (#hex)' },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: {
        columns: [
          {
            id: 'c1',
            field: 'row.number',
            label: '',
            width: 24,
            align: 'auto',
            format: {},
            emptyText: '',
            visibleWhen: { op: 'always' },
          },
        ],
        detailRow: { enabled: false, entries: [], separator: ' · ', italics: true, fontSize: 8 },
        totals: [],
        grouping: null,
        emptyText: '',
        fontSize: 9,
        headerBackground: '#f1f5f9',
        borderColor: '#cbd5e1',
        stripedRows: 'false',
        stripeColor: '#f8fafc',
        marginBottom: 12,
      },
      weight: 5,
    },
    {
      name: 'document_templates.Heading',
      labelKey: 'blocks.heading.label',
      descriptionKey: 'blocks.heading.description',
      category: 'layout',
      contexts: ['document'],
      fields: {
        text: { type: 'text', label: 'Text' },
        level: {
          type: 'select',
          label: 'Level',
          options: [
            { label: 'H1', value: 1 },
            { label: 'H2', value: 2 },
            { label: 'H3', value: 3 },
          ],
        },
        color: { type: 'text', label: 'Colour (#hex)' },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        marginTop: { type: 'number', label: 'Space above (pt)' },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: { text: 'Heading', level: 1, color: '#111827', align: 'left', marginTop: 0, marginBottom: 8 },
      weight: 10,
    },
    {
      name: 'document_templates.Text',
      labelKey: 'blocks.text.label',
      descriptionKey: 'blocks.text.description',
      category: 'layout',
      contexts: ['document'],
      fields: {
        text: { type: 'textarea', label: 'Text (merge fields: {{date}} …)' },
        fontSize: { type: 'number', label: 'Font size' },
        color: { type: 'text', label: 'Colour (#hex)' },
        bold: {
          type: 'radio',
          label: 'Bold',
          options: [
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ],
        },
        italics: {
          type: 'radio',
          label: 'Italics',
          options: [
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ],
        },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        marginTop: { type: 'number', label: 'Space above (pt)' },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: {
        text: 'Text',
        fontSize: 10,
        color: '#111827',
        bold: 'false',
        italics: 'false',
        align: 'left',
        marginTop: 0,
        marginBottom: 6,
      },
      weight: 20,
    },
    {
      name: 'document_templates.Image',
      labelKey: 'blocks.image.label',
      descriptionKey: 'blocks.image.description',
      category: 'layout',
      contexts: ['document'],
      fields: {
        assetId: { type: 'uuid', label: 'Image (assets library)', refKind: 'asset' },
        width: { type: 'number', label: 'Width (pt)' },
        maxHeight: { type: 'number', label: 'Maximum height (pt)' },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: { assetId: '', width: 120, maxHeight: 80, align: 'left', marginBottom: 8 },
      weight: 30,
    },
    {
      name: 'document_templates.Spacer',
      labelKey: 'blocks.spacer.label',
      descriptionKey: 'blocks.spacer.description',
      category: 'layout',
      contexts: ['document'],
      fields: { height: { type: 'number', label: 'Height (pt)' } },
      defaultProps: { height: 16 },
      weight: 40,
    },
    {
      name: 'document_templates.Divider',
      labelKey: 'blocks.divider.label',
      descriptionKey: 'blocks.divider.description',
      category: 'layout',
      contexts: ['document'],
      fields: {
        thickness: { type: 'number', label: 'Thickness (pt)' },
        color: { type: 'text', label: 'Colour (#hex)' },
        style: {
          type: 'select',
          label: 'Style',
          options: [
            { label: 'Solid', value: 'solid' },
            { label: 'Dashed', value: 'dashed' },
          ],
        },
        widthPercent: { type: 'number', label: 'Width (%)' },
        marginY: { type: 'number', label: 'Space above and below (pt)' },
      },
      defaultProps: { thickness: 1, color: '#cbd5e1', style: 'solid', widthPercent: 100, marginY: 8 },
      weight: 50,
    },
    {
      name: 'document_templates.PageBreak',
      labelKey: 'blocks.pageBreak.label',
      descriptionKey: 'blocks.pageBreak.description',
      category: 'layout',
      contexts: ['document'],
      fields: {},
      weight: 60,
    },
  ],
  blockCategories: [
    { key: 'data', titleKey: 'blocks.category.data', contexts: ['document'], weight: 30 },
    { key: 'layout', titleKey: 'blocks.category.layout', contexts: ['document'], weight: 90 },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  demo: false,
});
