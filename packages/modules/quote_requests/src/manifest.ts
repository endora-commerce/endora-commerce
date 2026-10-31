import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Settings manifest for the Quote Requests module — feature 008.
 *
 * Settings keys:
 *   - quote_requests.expiryDays      (integer, default 0 = never)
 *   - quote_requests.showAddToQuoteOnCard (boolean, default true)
 *   - quote_requests.showAddToQuoteOnPdp  (boolean, default true)
 *   - quote_requests.business_id.prefix   (string, default '')
 *   - quote_requests.business_id.suffix   (string, default '')
 */

export const QUOTE_REQUESTS_SETTING_CODES = {
  EXPIRY_DAYS: 'quote_requests.expiry_days',
  SHOW_ADD_TO_QUOTE_ON_CARD: 'quote_requests.show_add_to_quote_on_card',
  SHOW_ADD_TO_QUOTE_ON_PDP: 'quote_requests.show_add_to_quote_on_pdp',
  BUSINESS_ID_PREFIX: 'quote_requests.business_id.prefix',
  BUSINESS_ID_SUFFIX: 'quote_requests.business_id.suffix',
} as const;

export const DEFAULT_QUOTE_REQUESTS_EXPIRY_DAYS = 0;

const settings = defineModuleSettingsManifest({
  moduleCode: 'quote_requests',
  groups: [
    {
      code: 'quote_requests',
      name: 'Quote Requests',
    },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'quote_requests.enabled',
      name: 'Quote requests enabled',
      description:
        'Switches the RFQ flow on or off: the customer request surfaces, the add-to-quote controls on the product card and PDP, the admin quote desk, and the worker that expires pending requests. Nothing is dropped — every request, its revisions and its messages stay in the database and resume where they were.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
      name: 'Auto-expire pending after (days)',
      description:
        'Number of days without activity after which a Pending or Created from admin Quote Request is moved to Expired. 0 disables auto-expiry entirely. A request carrying an offer whose validity date is still ahead is never expired by this rule. Turning this on, or lowering it, expires every open request that has already been inactive that long, on the next runs of the expiry sweep (every 30 minutes). Each request is held to the value of its own sales channel: a channel set to 0 is exempt, and a request with no channel follows the default channel.',
      groupCode: 'quote_requests',
      valueType: 'number',
      defaultValue: DEFAULT_QUOTE_REQUESTS_EXPIRY_DAYS,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_CARD,
      name: 'Show "Add to quote" on product card',
      description: 'Toggles the "Add to quote" button on storefront product card listings.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_PDP,
      name: 'Show "Add to quote" on product detail',
      description: 'Toggles the "Add to quote" button on storefront product detail pages.',
      groupCode: 'quote_requests',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_PREFIX,
      name: 'Business Quote Request ID prefix',
      description:
        'Text prepended to the generated business Quote Request ID shown to the Customer (e.g. "QR-"). Empty = no prefix.',
      groupCode: 'quote_requests',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_SUFFIX,
      name: 'Business Quote Request ID suffix',
      description:
        'Text appended to the generated business Quote Request ID shown to the Customer (e.g. "-2026"). Empty = no suffix.',
      groupCode: 'quote_requests',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'quote_requests',
  name: 'Quote Requests',
  description:
    'Customer-initiated RFQ workflow with admin pricing, approvals, and expiry.',
  version: '1.0.0',
  // `admin_roles` since feature 072 (T138): the sales-rep roll-up scope reads
  // `permissionService` directly now, rather than through a root-built bundle.
  // It was already satisfied transitively via `auth`; the edge is declared
  // because a manifest is what an operator reads.
  // Feature 075, Phase C — `admin_users` and `customer_accounts` join the seven
  // that were already here. Both are ordinary declarations: neither reaches
  // back to this module, so the edges close no cycle. `carts` and `orders` do
  // reach back and are acknowledged below.
  //
  // `sales_channels` owns `salesChannelAttributionRegistry`, the registry this
  // module pushes its own "how many of my rows are attributed to this channel?"
  // counter into (feature 075, D-87). The registry is ungated and its owner is
  // non-deactivatable, so the declaration buys install and migration order
  // rather than a flip-time refusal.
  //
  // `price_lists` since feature 146: every customer write stores each line's
  // reference price, resolved through `buyerLinePricePort`
  // (`specs/146-quote-request-pricing-history/research.md` R2). `price_lists`
  // is `nonDeactivatable` and does not reach back to this module, so the edge
  // closes no cycle and makes no activation control a dead switch.
  dependencies: [
    // `_i18n` owns `adminI18nService`, through which global search's Quote
    // Request provider labels a status in the admin's language
    // (`specs/150-admin-global-search/`).
    '_i18n',
    'admin_roles',
    'admin_users',
    'auth',
    'catalog',
    'custom_fields',
    'customer_accounts',
    'organizations',
    'price_lists',
    'sales_channels',
    'settings',
    'taxes',
    // Feature 153 (owner answer Q4) — `transactional_emails` owns the sender the
    // *Quote request PDF* e-mail goes out through and `emailDefaultsPort`, the
    // registry its default subject and body are pushed into. It is
    // `nonDeactivatable` and does not reach back to this module, so the edge
    // closes no cycle and makes no activation control a dead switch (the `crm`
    // precedent). The operator's "off" for this one e-mail is the per-e-mail
    // switch, which refuses the send.
    'transactional_emails',
  ],
  /**
   * Feature 075, Phase C — the two edges this module genuinely has and cannot
   * declare above, because `carts/manifest.ts` declares **this** module and
   * `orders` declares `carts`. An ordinary declaration would close a cycle,
   * which `backend/test/unit/db/module-graph.test.ts` fails the build on.
   *
   * Neither is a schema edge, so nothing is lost by keeping them out of the
   * install and migration order: `cartWritePort` is the quote-to-cart
   * conversion (the write that used to be `em.create(Cart, …)` from inside this
   * module), and `orderReadPort` is the `order.created.v1` reactor reading the
   * order that names the quote request it completes. Both fail closed, and both
   * owners are the ones that would have to be off for the path to be reachable
   * at all — a conversion with no cart module has nowhere to convert to.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'carts',
      port: 'cartWritePort',
      reason:
        'Converting an approved quote seeds the customer’s active cart at the agreed unit ' +
        'prices, which is a write into carts’ own tables and belongs to carts. Declaring it ' +
        'as a dependency closes a cycle, because carts declares this module for the ' +
        '"add to quote" surface. The seam fails closed: a conversion that cannot reach the ' +
        'cart must refuse rather than report a checkout URL for a cart nobody wrote.',
    },
    {
      moduleId: 'orders',
      port: 'orderReadPort',
      reason:
        'The order.created.v1 reactor reads the order that names the quote request it ' +
        'completes. Declaring it closes a cycle through carts. The seam fails closed, and ' +
        'the event that triggers it cannot be emitted by an absent orders module, so the ' +
        'acknowledged edge adds no refusal that was reachable before.',
    },
  ],
  // This module offers two of its events to outbound webhooks by pushing their
  // names into `webhooks`' registry from a contribution-only boot hook. A push,
  // and nothing read back: with `webhooks` off or absent nothing is delivered
  // and nothing in this module changes, so there is no `whenAbsent` to state.
  nonBindingDependencies: [
    {
      moduleId: 'admin_search',
      name: 'adminSearchProviderRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the Quote Request provider for ' +
        'the admin global search, built over its own admin service. Nothing is read back: the ' +
        'registry enumerates only providers whose module is effectively present, so an absent ' +
        'contributor costs the host nothing and an absent host holds a table nobody walks. Not ' +
        '`dependencies`: that would make global search a reason this module cannot be switched off.',
    },
    {
      moduleId: 'webhooks',
      name: 'webhookEventRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module\'s contribution-only boot hook, of the two event names it ' +
        'offers for outbound delivery — `rfq.created.v1` and `rfq.expired.v1`. Nothing is read ' +
        'back: the registry is a plain registration that leaves out every event type whose ' +
        'owner is not present when it is read, and `webhooks` bridges and delivers through its ' +
        'own gated subscription.',
    },
    // Feature 153 — the quote request PDF (`specs/153-quote-request-pdf-template/`).
    {
      moduleId: 'document_templates',
      name: 'documentTypeRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module\'s contribution-only boot hook, of the Quote request document ' +
        'type — its four blocks, its line collection, built-in layout and sample. Nothing is read ' +
        'back at push time: the registry answers a type only while its module is present, so an ' +
        'absent contributor costs the host nothing and its templates stay stored.',
    },
    {
      moduleId: 'document_templates',
      name: 'documentRenderPort',
      kind: 'refuses-without',
      whenAbsent: 'quote requests cannot be exported to PDF and no PDF template can be chosen',
      reason:
        'The quote PDF routes — the template choices, the remembered template, the download and ' +
        'the e-mail — resolve the port per request and never probe it, so while document ' +
        'templates are off each answers 503 MODULE_DISABLED and the admin hides both actions. ' +
        'Not `dependencies`: a PDF is optional for a quote, and binding would make the document ' +
        'templates switch dead while quote requests are on.',
    },
  ],
  settings,
  // Feature 073 (Constitution XVII) — the operator's activation control.
  activation: { settingCode: 'quote_requests.enabled', default: true },
  /**
   * The error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where the sentence for each is looked up from: `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`, which holds all ten in both
   * languages and no eleventh. None of them is a `check-error-translations.ts`
   * `UNTRANSLATED_ERROR_CODES` entry.
   *
   * **Nine came from the capture and one was minted.**
   * `RFQ_PRICE_PROPOSAL_NOT_ALLOWED` was created by feature 146
   * (`specs/146-quote-request-pricing-history/`, FR-022) after the prefix chain
   * was deleted, so the capture below cannot hold it; its owner and reason are
   * recorded in `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
   * `MINTED_ERROR_CODES` instead. Everything said below about "the nine" is
   * about the captured ones.
   *
   * The captured list is answer-preserving, not a judgement (§6.2 and §6.5), and it was
   * not written by hand: it is the verbatim output of the runbook's step-1
   * derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **No code here is a shadow, and none of this module's is shadowed away.**
   * Trap T1 exists because the chain is an ordered `if`: an earlier rule can
   * claim a code a later one names, which cost `inventory` two codes and gave
   * `catalog` four. This module has a single rule — `RFQ_` or `QUOTE_`, no misc
   * set — and the three rules above it (`SETTING_`, the generic set, `catalog`'s
   * prefixes and misc set) name no `RFQ_` or `QUOTE_` code, so the nine the
   * chain answers with are exactly the nine `RFQ_`/`QUOTE_`-prefixed members of
   * `ERROR_CODES`. The derivation was still run from the answer, because "no
   * shadow reaches me" is a conclusion of reading the whole chain and not a
   * premise a migrating author is entitled to.
   *
   * **Three of the nine are raised by nothing** — `RFQ_ALREADY_CLAIMED`,
   * `RFQ_NOT_ACCEPTED` and `RFQ_NOT_NEW`. Each is a
   * member of `ERROR_CODES` with a sentence in both languages that no `throw`
   * in `backend/src` or `packages` can produce. They are declared anyway,
   * because ownership follows the capture and not the raise sites (trap T10):
   * dropping one reds the progress test as `[undeclared]` and moves an answer
   * the migrating merge request was not allowed to move. Whether a code nothing
   * raises should exist is a separate question, filed in
   * `specs/deferred-defects.md` § *Roughly 29 error codes have translated
   * sentences no client can ever receive*, and measured for this module in that
   * merge request's description.
   *
   * **It said six until 2026-08-29, and the two it lost are the reason that
   * register entry is worth keeping.** `RFQ_EXPIRED` and
   * `QUOTE_VALIDITY_ENDED` were unraised because a rule had been *removed*, not
   * because nobody ever wrote one: the feature-008 workflow rewrite
   * (`4f24dc948`) dropped `accept()`'s live `expiresAt` check and nothing
   * replaced it, so the per-request validity deadline an operator sets with
   * `expiresInDays` bound nothing while both parties were shown its date. Both
   * are raised now — `RFQ_EXPIRED` on `accept-revision`,
   * `QUOTE_VALIDITY_ENDED` on `convert-to-order`, in
   * `services/rfq-service.ts` — which is the split
   * `specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md`
   * assigned them. That is T11's distinction reaching its conclusion: for these
   * two the sentences were the last surviving evidence of the rule, and the
   * repair was to restore the rule rather than to retire the codes.
   *
   * **And four until 2026-10-08**, when `QUOTE_INCOMPLETE` gained the rule its
   * name describes: a line with no agreed unit price is refused on
   * `accept-revision`, on the admin `approve` and on `convert-to-order`
   * (`services/agreed-price.ts`). The remaining three have no such history,
   * and the count here is a fact about the tree that moves with it — re-derive
   * it, never carry it forward.
   *
   * The inverse is also true and is T2's shape: this module raises five codes it
   * does not own — `CUSTOM_FIELD_VALUE_INVALID`, `FORBIDDEN`, `NOT_FOUND` and
   * `VERSION_CONFLICT`, which the chain routes to `core`, and
   * `PRODUCT_NOT_FOUND`, which is `catalog`'s and is declared there. None is
   * declared here and every one of those sentences stays where it is.
   *
   * **No `tokens`, and it is derived rather than assumed.** The envelope's
   * `refusalToken` (`packages/platform/src/http/error-envelope.ts`) reads
   * exactly one member of `details` — `code`, and only when `details` is an
   * object — as the tail of `errors.<CODE>.<token>`. Every raise of these
   * codes was enumerated over `packages` and `backend/src` rather than over
   * this package alone (runbook §5), and not one passes a fourth argument at
   * all; the codes nothing raises reach no token by construction. The
   * bundle agrees from the other direction: ten `errors.<CODE>` keys in each
   * language and not one `errors.<CODE>.<token>`.
   */
  errorCodes: [
    { code: 'QUOTE_INCOMPLETE' },
    { code: 'QUOTE_VALIDITY_ENDED' },
    { code: 'RFQ_ALREADY_CLAIMED' },
    { code: 'RFQ_EMPTY' },
    { code: 'RFQ_EXPIRED' },
    { code: 'RFQ_NOT_ACCEPTED' },
    { code: 'RFQ_NOT_DRAFT' },
    { code: 'RFQ_NOT_NEW' },
    { code: 'RFQ_NOT_QUOTED' },
    { code: 'RFQ_PRICE_PROPOSAL_NOT_ALLOWED' },
    { code: 'RFQ_SAVED_VIEW_NAME_TAKEN' },
    // Feature 163 (security review M1) — an operator's on-behalf request on a channel,
    // named or resolved (owner decision 2026-10-29 "A"), that is not one of the
    // Organization's active channels. Minted by this feature;
    // owner and reason in `MINTED_ERROR_CODES`.
    { code: 'RFQ_SALES_CHANNEL_NOT_ALLOWED' },
    // Feature 153 (owner answer Q4) — sending the quote PDF by e-mail. Minted
    // by this feature; owner and reason in `MINTED_ERROR_CODES`.
    { code: 'QUOTE_REQUEST_PDF_TOO_LARGE' },
    { code: 'QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE', tokens: ['deactivated', 'no_transport', 'no_definition'] },
    { code: 'QUOTE_REQUEST_PDF_SEND_FAILED' },
  ],
  /**
   * `rfqs:handle` is declared in the core `PERMISSION_CATALOGUE`, which carries
   * its label and names this module as its owner. Re-declaring it here adds no
   * owner and no label — it adds the one thing only this module can state
   * (D-175, feature 080 T057).
   *
   * `RfqCreatePage` prefills an agreed price from
   * `POST /api/v1/admin/price-books/resolve` (feature 160; it was the per-product
   * resolved-price probe), which `price_lists` gates
   * with `price_lists:read`. D-173 made that gate deliberately: the route used
   * to enforce `rfqs:handle`, a code its own switchable owner could take off
   * `/admin-roles` while `price_lists` — `nonDeactivatable` — went on demanding
   * it, and !956's repair was for the consumer to gate on a code it owns. The
   * ruling recorded the operator-visible consequence in the same breath: *"a
   * role holding only `rfqs:handle` loses the RFQ create screen's price prefill
   * until granted it; the screen degrades to manual entry rather than
   * erroring"*, and the dev seed gives `sales_representative` both codes for
   * that reason.
   *
   * That sentence was in a ruling, a route comment and a seed, and in nothing
   * an operator could read. It is here now. It is advisory only: the screen's
   * fallback stays and no upsert is refused.
   *
   * Feature 146 made `price_lists` a real lifecycle dependency of this module,
   * for a different reason: the server-side reference price every customer
   * write stores per line comes from its `buyerLinePricePort` (research R2).
   * That edge is about the port, read in-process with no permission at all; it
   * does not change this entry, which stays about the admin UI probe and stays
   * advisory.
   */
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  /**
   * Feature 153 — the four quote blocks of the document-template editor
   * (`contracts/quote-request-document.md` §2). Declared for the `document`
   * context only; the *Quote request* document type offers them. A label left
   * empty prints in the PDF's language, so no English default is stored.
   */
  blocks: [
    {
      name: 'quote_requests.QuoteHeader',
      labelKey: 'blocks.quoteHeader.label',
      descriptionKey: 'blocks.quoteHeader.description',
      category: 'quote',
      contexts: ['document'],
      fields: {
        title: { type: 'text', label: 'Title' },
        titleSize: { type: 'number', label: 'Title size' },
        align: {
          type: 'select',
          label: 'Alignment',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Centre', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        showNumber: { type: 'radio', label: 'Show the quote number', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        numberLabel: { type: 'text', label: 'Quote number label' },
        showIssueDate: { type: 'radio', label: 'Show the date', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        issueDateLabel: { type: 'text', label: 'Date label' },
        showValidUntil: { type: 'radio', label: 'Show the validity date', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        validUntilLabel: { type: 'text', label: 'Validity date label' },
        showRevision: { type: 'radio', label: 'Show the revision number', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        revisionLabel: { type: 'text', label: 'Revision label' },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: {
        titleSize: 18,
        align: 'left',
        showNumber: 'true',
        showIssueDate: 'true',
        showValidUntil: 'true',
        showRevision: 'true',
        marginBottom: 12,
      },
      weight: 10,
    },
    {
      name: 'quote_requests.QuoteParties',
      labelKey: 'blocks.quoteParties.label',
      descriptionKey: 'blocks.quoteParties.description',
      category: 'quote',
      contexts: ['document'],
      fields: {
        buyerHeading: { type: 'text', label: 'Buyer heading' },
        showLegalName: { type: 'radio', label: 'Show the legal name', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showTaxId: { type: 'radio', label: 'Show the tax ID', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        taxIdLabel: { type: 'text', label: 'Tax ID label' },
        showAddress: { type: 'radio', label: 'Show the address', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        showCustomer: { type: 'radio', label: 'Show the contact person', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        customerHeading: { type: 'text', label: 'Contact heading' },
        showSalesRep: { type: 'radio', label: 'Show the sales representative', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        salesRepHeading: { type: 'text', label: 'Sales representative heading' },
        layout: {
          type: 'select',
          label: 'Layout',
          options: [
            { label: 'Side by side', value: 'columns' },
            { label: 'One under another', value: 'stacked' },
          ],
        },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: {
        showLegalName: 'true',
        showTaxId: 'true',
        showAddress: 'true',
        showCustomer: 'true',
        showSalesRep: 'true',
        layout: 'columns',
        marginBottom: 12,
      },
      weight: 20,
    },
    {
      name: 'quote_requests.QuoteNotes',
      labelKey: 'blocks.quoteNotes.label',
      descriptionKey: 'blocks.quoteNotes.description',
      category: 'quote',
      contexts: ['document'],
      fields: {
        label: { type: 'text', label: 'Label' },
        showWhenEmpty: { type: 'radio', label: 'Show the label when there is no note', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        italics: { type: 'radio', label: 'Italics', options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }] },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: { showWhenEmpty: 'false', italics: 'false', marginBottom: 12 },
      weight: 30,
    },
    {
      name: 'quote_requests.QuoteDetails',
      labelKey: 'blocks.quoteDetails.label',
      descriptionKey: 'blocks.quoteDetails.description',
      category: 'quote',
      contexts: ['document'],
      fields: {
        heading: { type: 'text', label: 'Heading' },
        layout: {
          type: 'select',
          label: 'Layout',
          options: [
            { label: 'Table', value: 'table' },
            { label: 'List', value: 'list' },
          ],
        },
        marginBottom: { type: 'number', label: 'Space below (pt)' },
      },
      defaultProps: { layout: 'table', marginBottom: 12 },
      weight: 40,
    },
  ],
  blockCategories: [{ key: 'quote', titleKey: 'blocks.category.quote', contexts: ['document'], weight: 20 }],
  /**
   * Feature 153 (owner answer Q4) — the e-mail *Send PDF to customer* sends,
   * the quote PDF attached by the sender. Its default subject and body, in
   * Polish and English, are pushed from this module's contribution-only boot
   * hook (`src/backend/email-templates/quote-pdf-defaults.ts`); an operator
   * edits them, or switches the e-mail off, on the e-mail templates screen.
   */
  transactionalEmails: [
    {
      code: 'quote_request_pdf',
      name: 'Quote request PDF',
      group: 'quote_requests',
      description:
        'Sent when a sales representative uses Send PDF to customer on a quote request: the quote as a PDF attachment, with an optional personal message.',
      variables: [
        { key: 'quote.number', label: 'Quote number', sampleValue: 'QR-000153' },
        { key: 'quote.validUntil', label: 'Valid until', sampleValue: 'November 16, 2026' },
        { key: 'customer.name', label: 'Customer name', sampleValue: 'Anna Example' },
        { key: 'salesRep.name', label: 'Sales representative name', sampleValue: 'Jan Sample' },
        { key: 'salesRep.email', label: 'Sales representative e-mail', sampleValue: 'jan.sample@example.com' },
        { key: 'channel.name', label: 'Sales channel', sampleValue: 'B2B store' },
        { key: 'message', label: 'Personal message', sampleValue: 'As agreed on the phone, here is our offer.' },
      ],
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  actions: [
    {
      id: 'open-rfq-inbox',
      labelKey: 'actions.openInbox.label',
      descriptionKey: 'actions.openInbox.description',
      icon: 'Inbox',
      targetRoute: '/quote-requests',
      requiredPermission: 'rfqs:handle',
      keywords: ['rfq', 'quote', 'inbox'],
      keywordsKey: 'actions.openInbox.keywords',
      weight: 310,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const quoteRequestsManifest = settings;
