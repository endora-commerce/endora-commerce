import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Built-in settings manifest for the comparisons module — feature 007.
 *
 * Reserves the `compare` group. The single `compare.max_products`
 * setting is added in T013 (foundational), so US1 has a real cap to
 * read from day one. Range bounds (`1..16`) are enforced by
 * `ComparisonService.addProduct(...)` per research.md R-7, not by the
 * manifest — the Settings module's value-type registry only recognises
 * primitive shapes.
 */
export const COMPARE_SETTING_CODES = {
  MAX_PRODUCTS: 'compare.max_products',
} as const;

export const DEFAULT_COMPARE_MAX_PRODUCTS = 4;

const settings = defineModuleSettingsManifest({
  moduleCode: 'comparisons',
  groups: [
    {
      code: 'compare',
      name: 'Compare',
    },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'comparisons.enabled',
      name: 'Product comparison enabled',
      description:
        'Switches the product-comparison feature on or off: the storefront compare list, the shareable comparison links and the admin screens. Nothing is dropped — saved comparisons stay in the database and their share links work again when you switch it back on. While it is off, a comparison list an anonymous visitor built is no longer adopted when they sign in, and expires with its own cookie.',
      groupCode: 'compare',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: COMPARE_SETTING_CODES.MAX_PRODUCTS,
      name: 'Maximum products per comparison',
      description:
        'Upper bound on how many products a customer can place in a single Comparison. The Compare page and PDF export are sized for this number; the storefront refuses to add a (max+1)-th product. Sensible range 1..16; defaults to 4.',
      groupCode: 'compare',
      valueType: 'number',
      defaultValue: DEFAULT_COMPARE_MAX_PRODUCTS,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'comparisons',
  name: 'Compare Products',
  description:
    'Customer-facing product comparison feature with shareable links and PDF export.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than an optional argument that
  // decided whether the admin surface existed at all.
  //
  // `price_lists` joined in issue #132: a comparison column shows a price, and
  // it now resolves that price through the `pricingService` port instead of
  // projecting the catalogue's legacy attribute. The edge binds — comparing
  // products on prices the platform is refusing to serve is exactly the
  // failure the port gate exists to prevent.
  //
  // `organizations` joined with the viewer-priced comparison: the columns are
  // resolved for whoever is looking, and the engine selects a group-targeted
  // price list by the buyer's customer group, which is a field on the
  // organisation row.
  dependencies: [
    'catalog',
    'customer_accounts',
    'organizations',
    'price_lists',
    'sales_channels',
    'settings',
    'auth',
  ],
  settings,
  /**
   * The operator-visible error codes this module owns — feature 090, Phase 3
   * (`specs/090-module-owned-error-codes/migration-runbook.md`).
   *
   * The list is the incumbent prefix chain's *answer* for `comparisons`, copied
   * from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`
   * (`grep -oE "^  [A-Z0-9_]+: 'comparisons'," …`). It is a transcription, not a
   * judgement: the migration is answer-preserving over all 289 codes and
   * re-routing is out of scope (§6.2, §6.5).
   *
   * **Trap T1 does not bite here, and that was measured rather than assumed.**
   * The chain answers `comparisons` from one prefix and one identity —
   * `code.startsWith('COMPARISON_') || code === ERROR_CODES.PDF_GENERATION_FAILED`.
   * Three enumeration members carry the prefix and all three survive to this
   * rule; no earlier rule names `PDF_GENERATION_FAILED`. So reading the chain's
   * source would have given the same four as reading its answer. `inventory` and
   * `assets_library` are where it does bite; this is another module where the two
   * agree, which is worth recording so the next reader knows the question was
   * asked.
   *
   * **One code a reader will look for here and not find: `PRODUCT_NOT_IN_COMPARISON`.**
   * It names this module's own noun, it is raised in this package and nowhere
   * else — `routes.public.ts`' `translate()` converts
   * `ProductNotInComparisonError` into a 404 with it — and it is `catalog`'s,
   * declared there in !1117. The chain never reaches the `COMPARISON_` rule with
   * it, because the `PRODUCT_` prefix runs first and wins; the runbook's trap T2
   * names this exact code as a routing decision an earlier feature made
   * deliberately. Do not move it here.
   *
   * **The inverse: this package raises four codes it does not own.** All four are
   * in `routes.public.ts` — `PRODUCT_NOT_IN_COMPARISON` and `PRODUCT_NOT_FOUND`
   * are `catalog`'s (both from `translate()`), and `INTERNAL` and
   * `VALIDATION_FAILED` are the platform's. That is D-95.2 from the thrower's
   * side: routing follows the domain noun, and "the product does not exist" stays
   * a catalogue noun however it is reached. None is declared here.
   *
   * **No code is raised by nothing.** All four have a live raise site in this
   * package, on routes mounted unconditionally: `COMPARISON_EMPTY` and
   * `PDF_GENERATION_FAILED` in the `GET /api/v1/comparisons/me/pdf` handler
   * (`index.ts` always supplies a real `ComparisonPdfRenderer`, so the `if
   * (pdfRenderer)` guard around them is not a closed door), `COMPARISON_FULL`
   * from `translate()` over `ComparisonFullError`, and `COMPARISON_NOT_FOUND`
   * three times — the `notFoundComparison()` / `notFound()` factories in
   * `routes.public.ts` and `routes.share.ts`, and an inline throw in
   * `routes.admin.ts`. So this module contributes nothing to the deferred-defect
   * register's entry on codes no client can receive.
   *
   * Both spellings were searched, which trap T12 asks for: `ERROR_CODES.<CODE>`
   * and the bare quoted literal, over `packages` and `backend/src`. This package
   * writes no bare-literal `new HttpError(<status>, '<CODE>', …)` at all.
   *
   * No `tokens`, derived rather than assumed. `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads `details.code` and
   * nothing else; every raise site above was read and not one passes a fourth
   * argument, so no `details.code` can exist. The runbook's §5 raise-site scan
   * attributes the tree's ten token-carrying codes over 41 sites to `core`,
   * `invoices` and `carts` and names none of these; in the other direction the
   * module's bundles hold exactly four `errors.<CODE>` sentences in each language
   * and no `errors.<CODE>.<token>` key, so there is no dead sentence either.
   */
  errorCodes: [
    { code: 'COMPARISON_EMPTY' },
    { code: 'COMPARISON_FULL' },
    { code: 'COMPARISON_NOT_FOUND' },
    { code: 'PDF_GENERATION_FAILED' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [{ code: 'comparisons:read', label: 'View product comparisons' }],
  /**
   * The module's command-palette entry — feature 091, Phase 4 (the plan's
   * batch 6), and one of the fifteen Principle XVI entries
   * `specs/deferred-defects.md` records as owed.
   *
   * It arrives with the drain rather than before it, by the mechanism that
   * register predicts: the batch owes an off-state proof over every surface the
   * module contributes, and until this declaration existed the `AppShell.tsx`
   * `PALETTE_ITEMS` row that advertised /comparisons was the admin's own — a
   * hand-written copy no server-side presence check was ever asked about, so it
   * went on offering the screen to an operator who had switched the module off.
   * The Actions group is resolved by `AdminActionsService` against the effective
   * enabled-set, which is what makes the withdrawal real.
   *
   * `requiredPermission` is the code the target route enforces, which
   * `check:action-route-permissions` compares against the registration on
   * `GET /api/v1/admin/comparisons` itself. The admin side of this module is read-only, so the read
   * code is the whole of what it gates.
   */
  actions: [
    {
      id: 'open-comparisons',
      labelKey: 'actions.openComparisons.label',
      descriptionKey: 'actions.openComparisons.description',
      icon: 'Scale',
      targetRoute: '/comparisons',
      requiredPermission: 'comparisons:read',
      keywords: ['compare', 'comparison', 'comparisons'],
      keywordsKey: 'actions.openComparisons.keywords',
      weight: 600,
    },
  ],
  activation: { settingCode: 'comparisons.enabled', default: true },
  /**
   * The comparison PDF's template (`specs/152-compare-pdf-template/`). Neither
   * edge binds: with document templates off or absent the PDF keeps working
   * with this module's fixed layout, so `document_templates` must not become a
   * reason this module cannot run.
   */
  nonBindingDependencies: [
    {
      moduleId: 'document_templates',
      name: 'documentTypeRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module\'s contribution-only boot hook, of the Product comparison ' +
        'document type — its blocks, built-in layout and sample. Nothing is read back at push ' +
        'time: the registry answers a type only while its module is present, so an absent ' +
        'contributor costs the host nothing.',
    },
    {
      moduleId: 'document_templates',
      name: 'documentRenderPort',
      kind: 'degrades-without',
      whenAbsent:
        'comparison PDFs are produced with the fixed built-in layout and cannot be customised',
      reason:
        'The one call is the `GET /api/v1/comparisons/me/pdf` export, which asks the presence of ' +
        '`document_templates` before resolving the port and prints the fixed layout otherwise.',
    },
  ],
  /**
   * The three comparison blocks of the document-template editor
   * (`data-model.md` §4.2). Declared for the `document` context only; the
   * comparison document type offers them, no other type does.
   */
  blocks: [
    {
      name: 'comparisons.ComparisonHeader',
      labelKey: 'blocks.comparisonHeader.label',
      descriptionKey: 'blocks.comparisonHeader.description',
      category: 'comparison',
      contexts: ['document'],
      fields: {
        title: { type: 'text', label: 'Title' },
        titleSize: { type: 'number', label: 'Title size' },
        titleColor: { type: 'text', label: 'Title colour (#hex)' },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        showDate: { type: 'radio', label: 'Show date', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        dateLabel: { type: 'text', label: 'Date label' },
        showDisplayMode: { type: 'radio', label: 'Show display mode', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        modeLabelAll: { type: 'text', label: 'Caption: all attributes' },
        modeLabelCommon: { type: 'text', label: 'Caption: common attributes' },
        modeLabelDifferences: { type: 'text', label: 'Caption: differences' },
        showPricedFor: { type: 'radio', label: 'Show whose prices', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        pricedForOrganizationText: { type: 'text', label: 'Note: organisation prices' },
        pricedForChannelText: { type: 'text', label: 'Note: catalogue prices' },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: {
        title: 'Product comparison',
        titleSize: 16,
        titleColor: '#111827',
        align: 'left',
        showDate: true,
        dateLabel: 'Date:',
        showDisplayMode: true,
        modeLabelAll: 'All attributes',
        modeLabelCommon: 'Common attributes only',
        modeLabelDifferences: 'Differences only',
        showPricedFor: true,
        pricedForOrganizationText: 'Prices for your organisation.',
        pricedForChannelText: 'Catalogue prices.',
        marginBottom: 12,
      },
      weight: 10,
    },
    {
      name: 'comparisons.ComparisonTable',
      labelKey: 'blocks.comparisonTable.label',
      descriptionKey: 'blocks.comparisonTable.description',
      category: 'comparison',
      contexts: ['document'],
      fields: {
        showImages: { type: 'radio', label: 'Images', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        imageSize: { type: 'number', label: 'Image size (pt)' },
        showName: { type: 'radio', label: 'Name', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showSku: { type: 'radio', label: 'SKU', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showPrice: { type: 'radio', label: 'Price', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showAvailability: { type: 'radio', label: 'Availability', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        availableText: { type: 'text', label: 'Available text' },
        unavailableText: { type: 'text', label: 'Unavailable text' },
        attributeColumnLabel: { type: 'text', label: 'Attribute column heading' },
        emptyValue: { type: 'text', label: 'Missing value text' },
        highlightRows: { type: 'radio', label: 'Highlight same / different rows', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        commonColor: { type: 'text', label: 'Same rows colour (#hex)' },
        differentColor: { type: 'text', label: 'Different rows colour (#hex)' },
        headerBackground: { type: 'text', label: 'Header background (#hex)' },
        borderColor: { type: 'text', label: 'Border colour (#hex)' },
        fontSize: { type: 'number', label: 'Font size' },
        productsPerTable: { type: 'number', label: 'Products per table (1–8)' },
        showHiddenNote: { type: 'radio', label: 'Note on hidden products', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        hiddenNoteText: { type: 'text', label: 'Hidden products note ({{hiddenCount}})' },
      },
      defaultProps: {
        showImages: true,
        imageSize: 80,
        showName: true,
        showSku: false,
        showPrice: true,
        showAvailability: false,
        availableText: 'Available',
        unavailableText: 'Unavailable',
        attributeColumnLabel: 'Attribute',
        emptyValue: '—',
        highlightRows: true,
        commonColor: '#f0fdf4',
        differentColor: '#fef2f2',
        headerBackground: '#f1f5f9',
        borderColor: '#cbd5e1',
        fontSize: 9,
        productsPerTable: 4,
        showHiddenNote: true,
        hiddenNoteText: '{{hiddenCount}} product(s) of this comparison are not available to you.',
      },
      weight: 20,
    },
    {
      name: 'comparisons.ComparisonShareLink',
      labelKey: 'blocks.comparisonShareLink.label',
      descriptionKey: 'blocks.comparisonShareLink.description',
      category: 'comparison',
      contexts: ['document'],
      fields: {
        label: { type: 'text', label: 'Label' },
        showUrl: { type: 'radio', label: 'Show address', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showQr: { type: 'radio', label: 'Show QR code', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        qrSize: { type: 'number', label: 'QR code size (pt)' },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
      defaultProps: { label: 'View this comparison online:', showUrl: true, showQr: false, qrSize: 80, align: 'left' },
      weight: 30,
    },
  ],
  blockCategories: [
    { key: 'comparison', titleKey: 'blocks.category.comparison', contexts: ['document'], weight: 20 },
  ],
});

/** Legacy export retained for backward compatibility. */
export const comparisonsManifest = settings;
