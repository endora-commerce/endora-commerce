# @endora-commerce/mod-invoices

## 0.109.0

### Minor Changes

- 61fc321: The storefront language is part of the URL path (`/pl/p/wiertarka`, `/en/p/drill`, issue #396).

  **Upgrade note for operators: existing sales channels keep their addresses.** The migration
  `Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage` adds the per-channel setting
  _Prefix the default language in URLs_ and switches it **off** on every channel that exists when it
  runs, so default-language URLs stay unprefixed; channels created later start **on**. To adopt
  prefixes for the default language too, switch _Prefix the default language in URLs_ on in
  _Sales channels_ → the channel. Other languages are prefixed either way: a former
  `/p/<key>?lang=<L>` link answers a permanent redirect to `/<prefix>/p/<key>`. A CMS page whose slug
  starts with a channel language prefix can no longer be saved.

  `@endora-commerce/contracts`:

  - New: `channelUrlLanguages`, `channelUrlLanguageAliases`, `storefrontPagePath`,
    `storefrontPagePathFor`, `storefrontDefaultPath`, `channelUrlLanguageSchema`,
    `channelUrlLanguageAliasSchema`, `URL_LANGUAGE_PREFIX_PATTERN`, types `ChannelUrlFacts`,
    `ChannelUrlLanguage`, `ChannelUrlLanguageAlias`; `productDefaultPath(key)`.
  - **`productPath` takes the channel's URL facts and never appends `?lang=`:**
    `productPath({ key, languageCode, channelDefaultLanguage })` (`/p/drill?lang=en-US`) becomes
    `productPath({ key, languageCode, channel })` (`/en/p/drill`), where `channel` is any
    `{ languages, defaultLanguage, prefixDefaultLanguage }` — the cached channel satisfies it.
  - `productKeyResolutionSchema`'s `redirect` requires `permanent` (`false` for a key of another
    channel language, answered 307); `productPagePathsSchema` requires `xDefault`.
  - Sales channel shapes carry `prefixDefaultLanguage` (create defaults to `true`); the public
    channel read answers `prefixDefaultLanguage`, `urlLanguages` and `urlLanguageAliases`.
  - `cmsPageUrl` (163 R24) takes the channel's URL facts and composes the prefixed path:
    `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` (`/about-us?lang=en-US`) becomes
    `cmsPageUrl({ path, languageCode, channel })` (`/en/about-us`). The resolved CMS page's `url` and
    `alternates`, and the storefront page index, therefore carry each language's own slug under its
    prefix.
  - `CmsPageRecord` gains optional `languages` and `translations` (the `seo` sitemap lists each
    language at its own slug); `cmsPageSummarySchema` gains an optional
    `shadowedByLanguagePrefix` (any of the page's slugs, per-language ones included).

  Emitters (catalog, seo sitemap, product feeds, organizations, customers, newsletter, comparisons,
  mfa, invoices) compose prefixed storefront URLs; the product feed `link` uses the product's key in
  the feed language; the invoice e-mail links the storefront order page; the admin password reset
  links `/password-reset/confirm`. `cms-components` localizes block links through the render
  context's `localizePath`.

- 5114576: An invoice's `paidTotal` deducts every refund made before it was issued, each once: what `payments` recorded, plus the issued refunds of the order's settled returns that never pass through `payments` — a credit-limit top-up, and a money refund of an order not paid through a gateway — and an order an operator marked `refunded` counts as refunded everything received — its total with nothing captured, what was captured otherwise — taken as the larger of the recorded refunds and what was received, never their sum. An order refunded in full that way is not invoiced (`422 INVOICE_ORDER_REFUNDED`). `@endora-commerce/mod-returns` publishes the new `returnRefundReadPort` (`ReturnRefundReadPort`, `OrderReturnRefund` in `@endora-commerce/contracts`), which `@endora-commerce/mod-invoices` reads as a `degrades-without` dependency.

  `InvoiceDetail.amountDue` is now `max(0, grossTotal − paidTotal)` and never negative, and the new required `InvoiceDetail.overpayment` is `max(0, paidTotal − grossTotal)`. The invoice PDF's totals block prints it as _Nadpłata_ (`showOverpayment`, `labelOverpayment`), the admin invoice screen as _Overpayment_, and `{{var invoice.overpayment}}` is a new merge field. A consumer that built an `InvoiceDetail` by hand adds the field.

### Patch Changes

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 5898b0e: Invoice PDF labels and the names of an invoice's non-product lines come from the module's
  bundle in the invoice's language instead of Polish literals in code.

  - A rendered invoice draws every label a template prop does not supply — the document
    titles, the header labels, the party labels, the line-table and VAT-summary column headers,
    the totals labels and the default footer — in the document's `language`; an English render
    is English throughout. Invoices are printed in `pl-PL` (owner answer N5), and that render is
    unchanged byte for byte. The overpayment label follows the document language as well, where
    it followed the amount-in-words language before; the two coincide for a printed invoice.
  - The delivery, payment-method surcharge and discount lines an invoice itemises, and the
    fallback product name and unit, are named in the invoice's language when it is issued,
    `pl-PL` — so issued invoices carry the same names as before.
  - The section builders in `pdf-components/sections.ts` take an optional `labels` argument and
    draw English without it; `TITLES` is removed. `createInvoiceDocumentType` and
    `invoicesModule()` take an optional `translate`. New bundle keys: `pdf.*`, `lines.*`.

- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [eeed924]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/page-builder-admin@0.109.0
  - @endora-commerce/page-builder-core@0.109.0
  - @endora-commerce/email-components@0.109.0

## 0.108.0

### Minor Changes

- c8b20f6: An order refunded in full before it is invoiced is not invoiced (issue #417, owner ruling of 2026-10-24): there is no sale left to document. When the refunds of its captured payments equal what was captured and cover the whole order total, issuing a VAT invoice answers `422 INVOICE_ORDER_REFUNDED` and draws no number; the automatic issuance on an order status skips the order and logs the reason instead of failing. An order refunded in part is invoiced as before, with what was kept as paid. `ERROR_CODES` gains `INVOICE_ORDER_REFUNDED` (`@endora-commerce/contracts`), declared by `invoices` with an English and a Polish sentence.
- e0ee513: Invoices compute every amount in exact decimal arithmetic, and price a line at its net (issue #417).

  - **A line's net is `unitPrice × quantity`.** Issuance read the order line's `lineTotal` as the net, but `orders` stores that line's **gross** there, so every VAT-payer line was taxed twice: an order line of 100.00 net at 23 % was invoiced at 123.00 net and 151.29 gross. Invoices already issued are not rewritten; one issued for a VAT-payer order before this release overstates its net, VAT and gross and needs a correction.
  - **A line's gross is `net × (1 + rate)` rounded half-up on the exact decimal product** (`grossFromNetHalfUp`); rounding the double made 29.50 at 23 % the gross 36.28 instead of 36.29. The per-rate rule is unchanged: a rate's VAT is the sum of its lines' grosses minus the sum of their nets.
  - **A correction** caps, shares out, backs the net out of each gross and stores the unit net price (four places) in the same arithmetic: 0.15 over 8 pieces is stored as 0.0188, not 0.0187.
  - `buildInvoiceLines` returns its totals as two-place strings (`netTotal`, `taxTotal`, `grossTotal`) and each line's stored amounts under `stored`; new `summarizeVat(lines)` and `vatSummaryRows(rows)` are the summary rule issuance and the read model share; new `correctionAmounts(total, originalGross, lines)`.

- 161e9d3: Invoices store the summary they were issued with, record as paid what was captured, and correct cumulatively (issue #417, owner ruling and review of PR #423).

  - **A line's `grossValue` is the line's own rounding**, `round(net × (1 + rate))`; the VAT and the totals stay per rate on the net sums, so the line grosses may differ from the gross total by a cent.
  - **New nullable column `invoices.vat_summary`** (migration `Migration20261024T145631InvoicesVatSummary`, no backfill): issuance and a correction store the per-rate summary they were issued with, and the read model shows it. A document with none — issued before 0.108.0, or imported — is shown with the summary derived from its stored lines, as it was then. `readModelVatSummary(lines, stored)` decides by the stored summary, never by whether the totals reproduce.
  - **`paidTotal` is what was paid for the order** — the paid, partially refunded and refunded payment attempts' amounts, through `payments`' `paymentReadPort` (a new `degrades-without` dependency); an order recorded as paid with nothing captured, or with `payments` absent, its stored total — never the invoice gross. An order placed before 0.108.0 that charged 40.80 and is invoiced now at 40.81 shows 0.01 as due.
  - **A correction is cumulative over the corrections of one invoice**: per rate (per line for an invoice issued before 0.108.0) it credits the net of everything credited so far minus what earlier corrections credited, so all corrections together credit exactly the invoiced net and VAT; the cap is what remains of the invoice. A total above the sum of the correction's lines is refused with `400 VALIDATION_FAILED` (`details.code: correction_total_exceeds_lines`). `correctionAmounts` takes one `CorrectionInput` object.

- 97617df: Invoices take VAT per rate on the sum of the nets at that rate, rounded half-up once, with gross = net + VAT (owner ruling of 2026-10-24, issue #417; `vatByRate`). This replaces a rate's VAT as the sum of its lines' rounded grosses minus their nets: three 0.02 lines at 23 % now carry 0.01 VAT, not 0.00. A line's stored `grossValue` is informational — its share of its rate's VAT added to its net — and the line grosses add up to the invoice gross; the per-line net is unchanged. A correction applies the same method: per rate, the net the credited gross came from (`netForGrossAtRate`) and the VAT on it, so a return refunded at what the invoice charged credits exactly the invoiced net and VAT. An invoice issued before this release is shown with the rule it was issued under (new `readModelVatSummary`); `summarizeVat` and `vatSummaryRows` are removed.

### Patch Changes

- f3598cd: A correction credits an order-level discount the way the invoice charged it (issue #417, review of PR #423). `CorrectiveInvoiceLine` gains an optional `discount` (`@endora-commerce/contracts`): the part of the order's discount the line's refund carries. The goods are credited at `amount + discount` at their VAT rate, and the discount comes back on a negative 0 % line mirroring the invoice's own discount line, so the correction totals the refund and credits the goods' VAT as charged: a full return of 100.00 net at 23 % with a 50.00 discount credits 123.00 of goods (23.00 VAT) and −50.00 of discount, 73.00 in all, where it credited 73.00 of goods with 13.65 VAT. Earlier corrections' discount lines stay out of the goods' cumulative nets.
- 65daee2: An invoice's `paidTotal` is what was kept from what was captured for the order: each captured payment attempt's amount less its `refundedAmount`, summed once per attempt (issue #417, review of PR #423). An order refunded before invoicing records only what was kept (nothing, after a full refund); the invoice is still issued, since the sale happened and its return is a correction's to document. An order recorded as paid with no captured attempt still records its stored total; an overpayment is shown as it is.
- cb35881: A settlement refunds and corrects one set of lines, and the settlements of one order run one at a time (issue #417, review of PR #423).

  - **`@endora-commerce/mod-returns`**: the settlement's total covers every line of the case — a line the request leaves out counts at its stored `approvedRefundAmount`, as the correction already did — so a request naming one of two discounted lines no longer refunds 113.00 while its correction credits 246.00 of goods (46.00 VAT) less 20.00 of discount. A settlement takes the same per-order advisory lock as case creation, on a connection of its own, so two cases of one order settled at once no longer both read the same earlier corrections (2 × 0.03 at 23 % credited 0.02 VAT of the 0.01 invoiced). One that waits more than 15 seconds answers `409` (`details.code: settlement_in_progress`) with nothing moved.
  - **`@endora-commerce/mod-invoices`**: `correctionAmounts` credits the goods at `amount + discount` and the discount back only when the correction credits exactly what its lines add up to; any other total is credited as goods in line order, with no discount line.

- a4cd906: A correction that cannot be made never follows money that moved (issue #417, review of PR #423).

  - `CorrectiveInvoicePort` gains `validateCorrection(input)` (`@endora-commerce/contracts`): it refuses, writing nothing, what `createCorrection` would refuse for the same input. `invoices` implements both from one preparation step.
  - The returns settlement builds its correction once and validates it **before** the refund or the credit top-up; a refusal leaves the case in `received` with nothing moved. With `invoices` switched off, a settlement asking for a correction is refused before the credit, where it used to credit first and refuse after.
  - A cancelled correction no longer counts against the cap or the cumulative nets of later corrections.

- 9979afb: The one-time document template access grant no longer opens a system scope of its own at boot. It runs inside the system scope the platform already enters for every boot hook (`boot: invoices`), so each boot recorded a second `tenant.escape_hatch` entry for the same access, labelled with the `worker` entry point although only the boot ran it. What the grant writes, and when, is unchanged.
- e6f3a78: Unit prices are shown by the one rule of the owner ruling of 2026-10-25: two places when the third and fourth are zero, otherwise the significant places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`); line values and totals keep two.

  - `@endora-commerce/mod-invoices`: the invoice PDF's unit net price column (new `unitMoney` beside `money` in the PDF sections), the admin invoice screen and the template preview.
  - `@endora-commerce/mod-carts`, `@endora-commerce/mod-customers`: the admin cart and the customer's cart history.
  - `@endora-commerce/mod-comparisons`: a compared product's price on the screen, the canvas and the PDF (`1.50 PLN`, `0.0125 PLN`), where it was rounded to two places.
  - `@endora-commerce/mod-crm`: an Opportunity's value of a linked Quote Request adds the quote's line values, each rounded to the cent once, as the quote desk does; it rounded only the sum.
  - `@endora-commerce/cms-components`: the CMS product card's price; the package now depends on `@endora-commerce/contracts` for the rule.

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/page-builder-admin@0.108.0
  - @endora-commerce/page-builder-core@0.108.0
  - @endora-commerce/email-components@0.108.0

## 0.107.0

### Minor Changes

- dd939be: **Breaking:** invoice templates moved into _Document templates_ (`specs/152-compare-pdf-template/`).
  This is a breaking change released as `minor` because the package is in `0.x` (D-225).

  - **Withdrawn API.** `GET/POST /api/v1/admin/invoice-templates`, `GET /api/v1/admin/invoice-templates/:id`,
    `PUT /api/v1/admin/invoice-templates/:id/content/:language`,
    `GET /api/v1/admin/invoice-templates/page-builder/config` and the two
    `/api/v1/admin/invoice-templates/:id/preview` routes are removed. Use
    `/api/v1/admin/document-templates` with `documentType: 'invoices.invoice'`:
    `POST /api/v1/admin/document-templates` (create), `PUT …/:id/content/pl-PL` (save, with
    `{ tree, expectedVersion }`), `POST …/:id/set-default`, `POST …/preview`,
    `GET …/types/invoices.invoice/builder-config`.
  - **No data is carried over.** The `invoice_templates` table is dropped by a migration; the
    invoice document type's built-in layout (the former generic template) is used until an operator
    sets an invoice template as default.
  - **E-mailed invoice PDFs now follow the configured template**: the attachment of the invoice
    e-mail is rendered exactly like the download. **PDF layouts can change** with this release.
  - The module now depends on `document_templates` (which cannot be switched off while invoicing is
    on) and `admin_roles`. A one-time, audited boot step gives every role holding `invoices:read`
    the `document_templates:read` permission and every role holding `invoices:write` also
    `document_templates:write`; it records itself in the hidden setting
    `invoices.document_templates_grant_done` and never runs again.
  - Removed: the `invoicePdfRenderer` container registration (invoice PDFs are produced by
    `document_templates`' `documentRenderPort`), the `invoice-templates` palette action, and the
    invoice template admin pages; `/invoices/templates` and `/invoices/templates/:id` redirect to
    _Document templates_. `invoicePdfBlockRegistry` and its contributor contract are unchanged.
  - `invoices:write` is relabelled _Issue/correct invoices and configure invoicing_.

### Patch Changes

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ad55813]
- Updated dependencies [ad55813]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/page-builder-admin@0.107.0
  - @endora-commerce/page-builder-core@0.107.0
  - @endora-commerce/email-components@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/page-builder-admin@0.106.0
  - @endora-commerce/page-builder-core@0.106.0
  - @endora-commerce/email-components@0.106.0

## 0.105.0

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/page-builder-admin@0.105.0
  - @endora-commerce/page-builder-core@0.105.0
  - @endora-commerce/email-components@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [9d6dfbc]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/page-builder-admin@0.104.0
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/email-components@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/email-components@0.103.1
  - @endora-commerce/page-builder-admin@0.103.1
  - @endora-commerce/page-builder-core@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/email-components@0.103.0
  - @endora-commerce/page-builder-admin@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Minor Changes

- 255b60b: The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
  its package at 0.21 (`npm install @measured/puck` now prints _"Puck has moved"_), and these
  packages now import `@puckeditor/core` 0.23 — the code, the types and the stylesheet
  (`@puckeditor/core/puck.css`).

  **What a consumer changes.** If your project declares the editor itself — an admin application
  that bundles `@endora-commerce/page-builder-admin`, `@endora-commerce/mod-cms` or any of the
  modules above, or a storefront rendering pages through `@endora-commerce/cms-components`:

  ```bash
  pnpm remove @measured/puck
  pnpm add @puckeditor/core@^0.23.0
  ```

  and rename the specifier in any import of your own (`'@measured/puck'` → `'@puckeditor/core'`,
  `'@measured/puck/puck.css'` → `'@puckeditor/core/puck.css'`). A project scaffolded with
  `create-endora-commerce` / `endora new instance` gets the new name at its root from this release
  on; an existing instance renames the one line in its root `package.json`. Leaving
  `@measured/puck` installed does not satisfy the peer — the two names are different packages —
  so a bundler resolves `@puckeditor/core` to nothing and the editor fails to build.

  **Stored content is unchanged.** Puck 0.21–0.23 changed no part of the page data shape: CMS
  pages, blocks, templates, blog bodies, e-mail templates, newsletter blocks and invoice templates
  persisted under 0.20 render and edit as they did, with no migration and no read-time adapter.

  **The editor looks and behaves as it did.** Three 0.21–0.23 defaults that reshape the editor are
  pinned back for every builder host through new exports of `@endora-commerce/page-builder-core/editor`:
  `withPuckLegacySideBar(plugins)` keeps the stacked Components + Outline side bar instead of the
  0.21 Plugin Rail, `PUCK_LEGACY_VIEWPORTS` keeps the 0.20 Small / Medium / Large viewports without
  the 0.21 full-width one (the CMS host keeps passing its own breakpoints), and `PUCK_LEGACY_DND`
  keeps the 0.20 fluid drag-and-drop instead of the 0.23 insertion line. A host of your own built on
  these packages can pass the same three to its `<Puck>`.

  `@puckeditor/core` 0.23 requires Node 20 or later, below this platform's own floor (22.17).

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/page-builder-admin@0.102.0
  - @endora-commerce/email-components@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1
  - @endora-commerce/email-components@0.101.1
  - @endora-commerce/page-builder-admin@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0
  - @endora-commerce/email-components@0.101.0
  - @endora-commerce/page-builder-admin@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/email-components@0.100.2
  - @endora-commerce/page-builder-admin@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/email-components@0.100.1
  - @endora-commerce/page-builder-admin@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

## 0.11.1

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.11.0

### Minor Changes

- 922d0c3: The invoice template editor offers blocks other modules declare, and keeps blocks it cannot show

  The editor now reads `GET /api/v1/admin/invoice-templates/page-builder/config` and merges it into its own configuration through `withDescribedInvoiceBlocks`:
  - A block that a present module declares, and that this module has no editor binding for, can be inserted and configured from the _Invoice sections_ palette. Its fields come from the descriptor. On the canvas it appears as a short note naming the module that draws it on the PDF. _Preview PDF_ shows the real output.
  - A stored block that nothing covers keeps its place and its props, and shows a note saying it is not available on this instance and is not printed. This covers a module that is off, a module that is not installed, and a name nobody recognises. The block is not offered in the palette.
  - If the descriptor cannot be fetched, the editor keeps its own blocks and still shows every stored block it cannot render as that note. No block is dropped.

  `mod-i18n` adds the three `invoiceTemplates.describedBlock.*` strings in English and Polish.

- a12d4bf: Invoice PDF blocks declared by another module are rendered through `invoicePdfBlockRegistry`, and `ksefVerificationResolver` is gone
  - **New registration, `invoicePdfBlockRegistry`.** A module that declares an invoice template block registers its renderer, its builder description and the per-render data it needs (see `InvoicePdfBlockRegistration` in `@endora-commerce/contracts`). While the contributing module is not present, its block is not rendered, not described and its data is not read. A stored template that places the block keeps it, and the PDF simply has no such section. The built-in fallback layout ends with the present contributors' blocks.
  - **Removed: the `ksefVerificationResolver` contribution point and `InvoicePdfRenderer.setKsefVerificationResolver`.** A composition that contributed `ksefVerificationResolver` drops that line. The KSeF module now registers its block, verification QR included, itself. `InvoicePdfRenderer` gains `content(invoice, locale, tree?)`, which returns the pdfmake content every render path uses.
  - **The generic invoice template seed no longer contains `ksef.InvoiceSection`.** A new instance's generic template has eight blocks, all of them this module's. Existing templates are not rewritten, because the seed revision is unchanged. An operator who wants the KSeF section places it in the template builder.
  - **The invoice template editor no longer binds `ksef.InvoiceSection`.** The builder descriptor (`GET /api/v1/admin/invoice-templates/page-builder/config`) now describes this module's ten blocks plus each present contributor's block.

  `minor` rather than `patch` because a registration name and a public method were removed.

- 9ef7f4b: `invoices` identifies an imported sale document by its source system and its id there, and validates what an importer sends

  `upsertImportedDocument` used to find an existing `erp_import` row by the source id alone, across every source system, and then overwrite that row's organization, header and reference. After an operator switched ERP, the second system's first colliding id would have taken over the first system's document together with its already-downloaded attachments. The lookup is now scoped to `(externalDocumentRef.system, externalDocumentRef.externalId)`. It still does not narrow by organization: within one source system, a document the source system reassigns to another contractor moves with it.

  `upsertImportedDocument` parses its input with `erpSaleDocumentUpsertInputSchema` and refuses a payload that does not parse with `VALIDATION_FAILED`, writing nothing — including a payload in the previous `xlSaleDocumentId` shape from a connector built against an older `@endora-commerce/contracts`.

  A new migration, `Migration20260926T230239InvoicesImportIdentity`:
  - renames the stored `external_document_ref` keys `xlSaleDocumentId` → `externalId` and `xlDocumentNumber` → `externalNumber`;
  - renames `invoice_external_attachments.xl_attachment_id` → `external_attachment_id`, and its unique constraint to `invoice_external_attachments_invoice_external_uq`;
  - replaces the unique index `invoices_external_xl_sale_document_uq` with `invoices_external_document_uq` on the pair, for `erp_import` rows;
  - adds the check `invoices_erp_import_identity_chk`, which refuses an `erp_import` row with an empty or missing `system` or `externalId`.

  Its `down()` restores the previous shape only while a single source system has written; once two systems share an id, recreating the id-only index fails.

- 6738f35: `invoices` owns the first download of an ERP-imported attachment and dispatches it by source system

  The customer route `GET /api/v1/account/organization/invoices/:invoiceId/attachments/:attachmentId` no longer resolves `comarchXlSaleDocumentAttachmentPort`. The module registers `invoiceAttachmentFetchRegistry` (an ungated contribution registry), and a connector registers a fetch provider into it keyed by the source system its import writes into `externalDocumentRef.system`. On each download the registry checks that the invoice and the attachment belong to the calling organization, then calls the provider of that document's own system if its module is effectively present. It never falls back to another provider. An absent, switched-off or unknown provider answers 404, as an unfetchable attachment already did, and a file stored earlier stays downloadable. Registering a second provider for a system that already has one throws.

  The manifest no longer declares a `refuses-without` edge onto `comarch_xl`. A connector that still provides `comarchXlSaleDocumentAttachmentPort` instead of registering into the new seam is no longer called: its attachments answer 404 until it registers.

- 170cd2f: The invoice PDF and the admin invoice screen print the invoice's KSeF number whatever any module's state
  - **PDF.** `invoices.InvoiceHeader` prints `<labelKsefNumber>: <number>` directly under the title row when the invoice has a KSeF number. The label defaults to `Numer w KSeF` and can be changed in the template builder. There is no prop to hide the row. The row is left out only while a block that prints the number itself (a registration with `printsKsefReferenceNumber: true`) is present and placed in the template. For the built-in layout, present is enough. The number is printed exactly once, including for a number an accounting vendor recorded while the KSeF module is off or absent.
  - **Admin.** The invoice detail screen shows a _KSeF number_ row whenever the invoice has one. The `invoice.detail.after` zone is unchanged.
  - The KSeF module sets `printsKsefReferenceNumber: true` on `ksef.InvoiceSection`, so an invoice that places that section prints its number once, from the section, as before. That module has since left this repository; its release with the change is cut from the paid-modules repository.
  - `mod-i18n` adds `invoiceDetail.field.ksefNumber` in English and Polish.

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/page-builder-admin@0.9.7
  - @endora-commerce/page-builder-core@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.10.5

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-admin@0.9.6
  - @endora-commerce/page-builder-core@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.4

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/email-components@0.9.5
  - @endora-commerce/page-builder-admin@0.9.5
  - @endora-commerce/page-builder-core@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.3

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/page-builder-admin@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.10.2

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/page-builder-admin@0.9.3

## 0.10.1

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-admin@0.9.2
  - @endora-commerce/page-builder-core@0.9.2

## 0.10.0

### Minor Changes

- 4915024: Comarch ERP XL integration (feature 119): shared ERP connector layer and Comarch XL adapter.

  **`@endora-commerce/contracts`** adds `erp-connector.ts` and `comarch-xl.ts` (admin and wire
  schemas), `erpConnector` on `ModuleManifestSchema`, and `COMARCH_XL_*` / `ERP_CONNECTOR_*`
  error codes.

  **`@endora-commerce/mod-erp-connector`** is a new non-deactivatable infra package: mutual
  exclusion registry (`erpConnectorRegistryPort`), activation lock entity, and shared job/run
  vocabulary. Subpaths: `.`, `./backend`, `./migrations`.

  **`@endora-commerce/mod-comarch-xl`** is a new switchable connector package: OpenAPI v0.1.0
  REST client, identity mapping, BullMQ detect/sync pipeline, domain apply services, admin UI,
  and documented overlay ports. Subpaths: `.`, `./backend`, `./migrations`, `./admin`. Ships
  `i18n/` and operator documentation under `docs/`.

  **`@endora-commerce/mod-invoices`** extends the module with `erpSaleDocumentWritePort`,
  ERP-imported sale document entities, B2B customer routes, and attachment handling for XL
  sale documents.

  **`@endora-commerce/mod-inventory`** extends `inventoryStockImportPort` for Comarch XL stock
  apply wiring (warehouse snapshot import).

  **`@endora-commerce/mod-catalog`** honours `createProduct` request `status` instead of
  always defaulting new products to `draft`.

  Activation is gated by `comarch_xl.enabled` (default off). Only one `erpConnector: true`
  module may be operator-active at a time.

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/page-builder-admin@0.9.1
  - @endora-commerce/page-builder-core@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/email-components@0.9.0
  - @endora-commerce/page-builder-admin@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-admin@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1
  - @endora-commerce/page-builder-admin@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

## 0.8.0

### Minor Changes

- 142fcdd: Removed the `InvoicesBridge` interface and the `invoicesBridge` container name; `invoices`
  resolves its cross-module dependencies itself.

  **If you composed this module**, delete your `invoicesBridge` contribution. There is no
  replacement name and nothing to supply: `registerModule` now reads the platform's own
  `adminContextResolver` and `customerContextResolver` from the cradle, reads
  `transactional_emails`' `transactionalEmailSenderAccessor`, and resolves
  `customerAccountReadPort` and `assetReadPort` through `lazyPort`. The channel's language is a
  read of the platform's `SalesChannel`, which is what both composition roots did.
  `ksefVerificationResolver` is unchanged and is still the one thing a composition supplies for
  this module.

  Six option changes come with it, all on `InvoicesModuleOptions` (internal to the package and
  reachable only through `./backend`):
  - `resolveAdminUserId`, `resolveCustomerContext`, `getTransactionalEmailSender`,
    `resolveRecipientEmail`, `resolveLanguage` and `loadAssetImage` are now **required**. Each
    was optional because the _contribution_ was, which was never true of the module — and an
    option no composition may decline to supply is a branch no test can drive. It was not
    hypothetical: `emailDispatcher` was built only when three of them were present, so a
    composition missing one silently stopped sending invoices and answered `no_sender`, and
    `loadAssetImage` was omitted by one of the two roots outright.
  - `InvoicesModuleHandle.emailDispatcher` is therefore **no longer optional**, and the handle
    gains `loadAssetImage` — the composed loader, which is otherwise held privately by the PDF
    renderer.
  - `LoadedAssetImage.bytes` is `Uint8Array` rather than `Buffer`, following
    `assetReadPort.openAssetBytes`. A `Buffer` still satisfies it, so a caller that passes one
    needs no change; a caller that _reads_ one and called a `Buffer` method does.

  New export on `./backend`: `services/cross-module-context.js`'s
  `createRecipientEmailResolver`, `createChannelLanguageResolver` and `createAssetImageLoader` —
  the three mappings the bridge held, as functions of what they read, so they are testable with
  nothing composed.

  `assets_library` and `customer_accounts` join the manifest `dependencies`. Both are binding
  and neither costs an operator a control: both declare `activation.nonDeactivatable`, so there
  is no switchable owner for a `refuses-without` sentence to describe.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/page-builder-admin@0.8.0
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Minor Changes

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- af72a42: `invoices` declares the three error codes it owns, and the four refusal tokens under two of them.

  The module's `manifest.ts` gains an `errorCodes` array
  (`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
  sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
  changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
  chain routes here today, so a consumer sees the identical envelope for `INVOICE_NOT_READY`,
  `INVOICE_NUMBER_ALREADY_ISSUED` and `INVOICE_NUMBER_PATTERN_COLLIDES`.

  The `tokens` come off the raise sites rather than off the bundle, because the envelope's
  `refusalToken` reads exactly one member of `details` and the token set is the set of values a
  raise site can put there. This module writes bare string literals — `same_channel` /
  `other_channel` for a duplicated number, `no_sequence_token` / `other_channel` for an illegal
  numbering pattern — across three throws in two files, so the set is complete once those throws
  are enumerated rather than by following a type.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [1f07b01]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/page-builder-admin@0.7.0
