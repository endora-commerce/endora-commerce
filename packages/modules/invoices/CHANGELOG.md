# @endora-commerce/mod-invoices

## 0.112.0

### Minor Changes

- 8b29aae: An invoice for an order paid by a related payer is recorded under the payer: the invoice ledger, the admin invoice list's reach and its new _Billed organization_ filter all use `payerOrganizationId ?? organizationId`. The admin invoice list gains that Organization filter (`filter[organizationId]=`) for every invoice.

### Patch Changes

- 3872f3d: Order invoice PDF downloads serve the issued invoice, rendered from its template (issue #1341):

  - `GET /api/v1/orders/:id/invoice` serves the order's newest ready document of kind `invoice`. It no longer serves a proforma or a correction issued after it, and an order with only a proforma answers `404 INVOICE_NOT_READY`. The PDF is rendered from the invoice template, the same as `GET /api/v1/orders/:id/invoices/:invoiceId/pdf`, instead of a one-page summary with the number and total.
  - `InvoicePdfPort` gains `renderInvoice(invoiceId)`, which returns the template-rendered PDF of one document. An implementation of the port outside `mod-invoices` must add it. `renderMinimal` is deprecated and no route calls it any more.
  - The admin order screen's Payment tab links each ready invoice to `GET /api/v1/admin/invoices/:id/pdf`. It used to link to the customer-only route, which refused the operator's session.

- 28181ed: One card implementation with density tokens (issue #1438, UX audit DS-04; SHELL-18 #1502). This
  changes how every admin card looks, including the cards third-party modules render.

  - `theme.css` declares `--card-pad` (16px), `--card-pad-sm` (12px), `--card-gap` (16px),
    `--section-gap` (24px), `--fs-page-title` (20px), `--fs-section-title` (14px) and `--fs-hint`
    (12px). A client can redeclare them after the import like any other token.
  - `Card`, `CardHeader`, `CardContent` and `CardFooter` pad with `--card-pad` (16px) instead of
    `p-6` (24px). `CardContent` drops its top padding only when it follows a `CardHeader`, so a
    card without a header no longer needs `className="pt-6"`. Every part carries a `data-slot`.
  - `CardTitle` renders an `h2` by default and takes `as` (`h2`–`h6`, or `div` to stay out of the
    heading outline); its size is `--fs-section-title` (14px, was 16px). A `CardTitle` that wrapped
    its own `<h2>` now nests a heading in a heading: pass the `id` to `CardTitle` and drop the inner
    element. A test that found a card title with `getByText` still does; one that counted headings
    now counts the card titles too.
  - `<Card flush>` removes the content padding and clips the corners, for a table that runs to the
    card's edge. New types: `CardProps`, `CardTitleProps`, `CardTitleElement`.
  - `.b2b-card`, `.b2b-card--clickable` and `.b2b-card__head` / `__title` / `__sub` / `__body` /
    `__body--flush` / `__foot` are **deprecated** but still published; they read the same tokens.
    The only visible change there is the header's vertical padding, 14px to 12px. Use `Card`.

  Every module's card call sites drop the `pt-6` workaround and the redundant `text-base` on
  `CardTitle`, and the 14 titles that wrapped their own `<h2>` carry the `id` themselves.

- d7de1ac: More admin lists tell "nothing here yet" apart from "your filters match nothing" (issue #1448). They used one grey sentence for both, so an operator who had never filtered read "No entries match the current filter.", and an operator whose filters hid every row had no way back but to undo each filter by hand. They now show the kit `EmptyState`: the `no-data` variant, with an icon, a title and one line, when there is nothing to list, and the `no-results` variant, whose _Clear filters_ button resets the filters and returns focus to the first filter field, when the filters hide everything.

  - **Audit log**: "Nothing recorded yet" on an unfiltered empty log. _Clear filters_ also clears the filters held in the URL.
  - **Invoices**: "No invoices yet" until an order is invoiced.
  - **Languages, Countries and Currencies** (dictionaries): Countries and Currencies used to draw an empty table when the search matched nothing, and Languages printed its "no match" sentence even when nothing was filtered. _Clear filters_ on Languages also resets the status filter.
  - **Transactional e-mails**: "No transactional e-mails" when no module declares one, and a no-match state for the search. The list no longer shows an empty state before it has loaded. The `transactional_emails` key `list.empty` is replaced by `list.emptyFiltered`.
  - **Newsletter subscribers**: "No subscribers yet", and a no-match state for the search and tag filters. A server scope notice still takes precedence. The list no longer shows an empty state before it has loaded. `subscribers.empty` now reads "No subscriber matches these filters."
  - **Comparisons**: "No comparisons yet", and a no-match state with the list's first _Clear filters_. A server scope notice still takes precedence.
  - **Product-feed template builder**: a field search that matches nothing shows the `no-results` state rather than a bare sentence. The search box gains an accessible name.

  New keys, in English and Polish: `core` `auditLog.emptyState.*` and `invoices.emptyState.*`; `dictionaries` `languages.emptyState.*`, `countries.empty`, `countries.emptyState.*`, `currencies.empty` and `currencies.emptyState.*`; `transactional_emails` `list.emptyFiltered` and `list.emptyState.*`; `newsletter` `subscribers.emptyState.*`; `comparisons` `list.emptyState.*`.

- 87fb9c3: On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

  A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.

- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
- 7329865: The order, invoice, quote request, organization and customer detail screens and the promotion editor no longer replace the whole page with "Loading…" when they re-read their record after an action (issue #1496, UX audit SALES-06). The first load shows a skeleton of the page; a status change, a payment change, a custom-field save, an approve or cancel, a regenerated PDF or a member change keeps the page, its open tab, the scroll position and the focus on screen and marks the content `aria-busy` while it re-reads. A first load that fails now shows its error and a Retry button instead of "not found", and the promotion editor no longer shows an empty form over a promotion it could not read. On the organization screen a member change refused as stale now keeps its explanation on screen after the re-read. New string: `orderDetail.errors.load` (en, pl).
- 25f30c4: More sales screens show an action's result beside the control that caused it, not as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result.

  - Orders and Returns lists: the result of a bulk status change or a bulk authorization appears beside the header's actions. The bulk bar goes away with the selection, so the header is what is still on screen. A result that skipped orders or cases is shown as a warning.
  - Customers list: the result of resetting two-step verification for an organization appears beside the reset button. It is a warning when some accounts were not reset.
  - Credit limits: a granted or adjusted limit appears under the organization's panel. Opening another organization clears it.
  - Invoice detail: "PDF regenerated" and the result of resending the e-mail appear beside the header buttons. The screen shows at most one banner above the invoice: an error first, then "PDF not ready".

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- b2c1723: The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
- 9b1157f: The admin invoice detail draws the invoice as one card instead of six (issue #1547, UX audit SALES-25): Details, Seller and Buyer sit side by side under section headings, the details as a description list and each party as an address, followed by the lines, whose table footer carries the VAT summary per rate and the document totals, as the order detail does. Contributions to the `invoice.detail.after` zone render below the card. The header has one primary action (DS-07): _Download PDF_ on a ready invoice, _Regenerate PDF_ on a pending one, with the remaining actions in the "More" menu, which is disabled while one of them runs. New `core` copy `invoiceDetail.vatRow`, in English and Polish; the unused `invoiceDetail.section.vatSummary` and `invoiceDetail.section.totals` are removed.
- bfc21d3: Shorter admin copy on the order, quote-request, organization, promotion, invoice and return screens (UX audit text-to-cut pass, issue #1567):

  - Removed lines that repeated what the screen already shows: the description on the invoices list, the line under the customer's price-negotiation override, the line above the default payment / delivery / address fields, and the description of the organization's Roles section.
  - Shortened to one line: the read-only note on price negotiation, the warehouse-precedence hint, the order-confirmation e-mails hint, the parent-organization hint, the empty sales-reps note, the sales-channel hints on order and quote-request creation, the saved-rule copy hint on promotions, and the pending-effects notice on an order.
  - Shortened notices: the "carrier not contacted" shipment notice and the "different refund method" warning on a return.

  Removed translation keys (EN and PL): `invoices.description`, `defaultPreferences.description` (core bundle), `negotiation.customer.description` (quote requests), `roles.tab.description` (organizations). A theme or overlay that overrode them can drop the override.

- c042024: The kit pager has a cursor mode (issue #1664). `useCursorPagination` is the counterpart of `useListPagination` for an endpoint that pages by cursor and answers no total. `ListPage` draws the same `PaginationFooter` for it, with _Previous_ / _Next_, _Page N_ and "Showing 21–40 of more than 40" while a next page exists. `PaginationFooter` takes the new `CursorPaginationFooterProps` (`mode: 'cursor'`), and `ListPage` has a `tabs` slot for section tabs between the header and the toolbar.

  - **Invoices**: the list is the kit `ListPage`, like the other sales lists (issue #1500, UX audit SALES-24). _Load more_ is replaced by the cursor pager. The filters are the kit toolbar: the order-number search, kind and status, with the issue dates and totals behind _More filters_. The empty state tells "no invoices yet" apart from "nothing matches these filters". _Download PDF_ and _Resend email_ are in each row's menu. The error messages are translated.

  Removed unused translation keys (core): `invoices.loadMore`, `invoices.filters.clear`, `invoices.pdfNotReady`, `invoices.resendEmail`, `invoices.kind.all`, `invoices.status.all`.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 5e380e3: An amount withheld on a return is now invoiced as part of the goods' price, at their VAT rate
  (issue #854, owner ruling of 2026-11-07). When a return settled before the order was invoiced
  approved less than its default refund, for example to keep a handling fee, the invoice adds a line
  _Retained on return: product_ (`line_kind: retained`) per order line at that line's VAT rate. Its
  gross is what was withheld and its net makes the rate's VAT row the kept goods' gross plus that
  amount. Until now the amount showed as an overpayment with no VAT document. An order whose every
  line came back is now invoiced when something was withheld on it.

  The returned goods take their whole share of the order discount off the invoice's discount line,
  and the withheld amount carries none. Issued invoices are not rewritten. Run the `invoices`
  migrations: `invoice_lines.line_kind` admits `retained`.

- Updated dependencies [c878440]
- Updated dependencies [c878440]
- Updated dependencies [65f9a7b]
- Updated dependencies [3fdbe86]
- Updated dependencies [bfc68c7]
- Updated dependencies [9eaa409]
- Updated dependencies [d908737]
- Updated dependencies [1042e2a]
- Updated dependencies [3872f3d]
- Updated dependencies [bbfcd80]
- Updated dependencies [41b598c]
- Updated dependencies [f5b8275]
- Updated dependencies [467b075]
- Updated dependencies [a56109e]
- Updated dependencies [84b89ed]
- Updated dependencies [b2cd2d3]
- Updated dependencies [e5b17ae]
- Updated dependencies [e78d27d]
- Updated dependencies [596ce81]
- Updated dependencies [b2b41eb]
- Updated dependencies [932821f]
- Updated dependencies [28181ed]
- Updated dependencies [c15eb60]
- Updated dependencies [33db45a]
- Updated dependencies [cec9beb]
- Updated dependencies [d4bda8d]
- Updated dependencies [8e7684c]
- Updated dependencies [87fb9c3]
- Updated dependencies [998ac87]
- Updated dependencies [d0a6c2c]
- Updated dependencies [35e0829]
- Updated dependencies [3f66b6f]
- Updated dependencies [61bdc2a]
- Updated dependencies [649d662]
- Updated dependencies [38adf84]
- Updated dependencies [7329865]
- Updated dependencies [84ed7b6]
- Updated dependencies [1064839]
- Updated dependencies [d2d9d79]
- Updated dependencies [f687479]
- Updated dependencies [074f500]
- Updated dependencies [7624db6]
- Updated dependencies [cec9beb]
- Updated dependencies [7be07f6]
- Updated dependencies [2614e4f]
- Updated dependencies [90320fd]
- Updated dependencies [bb21b86]
- Updated dependencies [79a17a3]
- Updated dependencies [3dab0be]
- Updated dependencies [e22b612]
- Updated dependencies [cb75825]
- Updated dependencies [a4455db]
- Updated dependencies [f3b2ec8]
- Updated dependencies [f093a02]
- Updated dependencies [d5a077f]
- Updated dependencies [86b9b39]
- Updated dependencies [42febee]
- Updated dependencies [447e829]
- Updated dependencies [2040ae9]
- Updated dependencies [fc7f669]
- Updated dependencies [40b76aa]
- Updated dependencies [eeed5c8]
- Updated dependencies [63a657b]
- Updated dependencies [0ecb287]
- Updated dependencies [9a27b93]
- Updated dependencies [2f0b69f]
- Updated dependencies [87b9b60]
- Updated dependencies [50d451b]
- Updated dependencies [a6d6f08]
- Updated dependencies [98c0411]
- Updated dependencies [9f4eae3]
- Updated dependencies [a8261aa]
- Updated dependencies [f64646d]
- Updated dependencies [17ac8f1]
- Updated dependencies [306a659]
- Updated dependencies [7ea72af]
- Updated dependencies [f6dda10]
- Updated dependencies [f6dda10]
- Updated dependencies [f6dda10]
- Updated dependencies [bfbcac2]
- Updated dependencies [ee6062c]
- Updated dependencies [820f089]
- Updated dependencies [f33ffed]
- Updated dependencies [4e668b5]
- Updated dependencies [843ed42]
- Updated dependencies [0d4c134]
- Updated dependencies [3f7b5ae]
- Updated dependencies [b98739c]
- Updated dependencies [6155f4b]
- Updated dependencies [bdcc9a4]
- Updated dependencies [7b8006e]
- Updated dependencies [5850aac]
- Updated dependencies [c042024]
- Updated dependencies [8a5725e]
- Updated dependencies [ed3feda]
- Updated dependencies [99042ee]
- Updated dependencies [52d0617]
- Updated dependencies [f915a24]
- Updated dependencies [8688a1f]
- Updated dependencies [95e5082]
- Updated dependencies [31c0430]
- Updated dependencies [0686447]
- Updated dependencies [691414b]
- Updated dependencies [8a06dc5]
- Updated dependencies [e118ee4]
- Updated dependencies [5fb3cd3]
- Updated dependencies [9eee781]
- Updated dependencies [bd47236]
- Updated dependencies [bd47236]
- Updated dependencies [79d15cf]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [398e6d2]
- Updated dependencies [51c5072]
- Updated dependencies [0e81803]
- Updated dependencies [2e287a5]
- Updated dependencies [fbc6c7c]
- Updated dependencies [9d6f006]
- Updated dependencies [49328cf]
- Updated dependencies [b3d4843]
- Updated dependencies [f74fe34]
- Updated dependencies [19eb7c0]
- Updated dependencies [0fbf186]
- Updated dependencies [27b977d]
- Updated dependencies [5e2a12a]
- Updated dependencies [5518a09]
- Updated dependencies [5e380e3]
- Updated dependencies [bfab5bd]
- Updated dependencies [8a0ec92]
- Updated dependencies [81fcc3f]
- Updated dependencies [12c63fa]
- Updated dependencies [2d6d031]
- Updated dependencies [3d723ff]
- Updated dependencies [72637e0]
  - @endora-commerce/page-builder-core@0.112.0
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/page-builder-admin@0.112.0
  - @endora-commerce/email-components@0.112.0

## 0.111.0

### Minor Changes

- aed2d58: Issue #470 (D-288) — invoice audit entries hold no amount. An invoice is `@TransitivelyScoped` through its Order, and the platform audit log is read under `audit_log:read` without Organization reach.

  - `invoice.issued` no longer records `grossTotal`. It keeps `number`, `kind`, `orderId` and `salesChannelId`.
  - `invoice.corrected` no longer records `credited` or `charges` (charge kind mapped to amount). It records `chargeKinds`, the sorted kinds of the credited charges, beside `number`, `orderId`, `originalInvoiceId` and `priceReductionLines`.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new invoice entries show no totals. See _Invoice amounts leave the platform audit log_ in the upgrade guide.

- d68aa70: The business refusals of invoice issuance and of corrective invoices have error codes of their
  own instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #633, part of #86).
  **A caller that matches on `VALIDATION_FAILED`, or on the `details.code` tokens listed below, now
  sees the specific code.** The HTTP status of each is unchanged. Until now each was answered with an
  English sentence in every language, because the error envelope never replaces the message of
  `VALIDATION_FAILED`.

  | Was                                                                                                      | Is                                                | `details`                                                                                                                                    |
  | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
  | `422 VALIDATION_FAILED`, _"Seller VAT/NIP and company data must be configured before issuing invoices."_ | `422 INVOICE_SELLER_DATA_MISSING`                 | `setting` (unchanged)                                                                                                                        |
  | `422 VALIDATION_FAILED`, `details.code = "correction_currency_mismatch"`                                 | `422 INVOICE_CORRECTION_CURRENCY_MISMATCH`        | `requestedCurrency`, `invoiceCurrency` (was `originalCurrency`), `originalInvoiceId`; `details.code` is gone                                 |
  | `400 VALIDATION_FAILED`, `details.code = "correction_total_exceeds_lines"`                               | `400 INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES`      | `total`, `linesTotal`, and `currency` (new); `details.code` is gone, except `"below_charges"` when the total is below the charges it credits |
  | `422 VALIDATION_FAILED`, `details.code = "correction_exceeds_rate_remaining"`                            | `422 INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING`   | `taxRate`, `vatRatePercent`, `remaining`, and `currency` (new); `details.code` is gone                                                       |
  | `422 VALIDATION_FAILED`, `details.code = "correction_exceeds_charge_remaining"`                          | `422 INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING` | `details.code` is now the charge (`"delivery"` or `"payment_surcharge"`), `chargeKind`, `remaining`, and `currency` (new)                    |

  The seller refusal is answered by `POST /api/v1/admin/orders/:orderId/invoices` and by automatic
  issuance; the four correction refusals by every caller of the corrective-invoice port, which is a
  return settlement in this repository. The five codes are members of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `invoices` manifest, and the module's documentation
  page names them. `@endora-commerce/mod-i18n` loses the sentence
  `errors.VALIDATION_FAILED.correction_exceeds_rate_remaining`, which nothing could render: the
  envelope never translates `VALIDATION_FAILED`. The sentence lives on, under the new code, in the
  `invoices` bundle. No setting, permission or migration changes.

### Patch Changes

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- f8b29e1: **The admin invoice list pages by cursor, and an ERP WZ document has a label.**

  - **Admin API** `GET /api/v1/admin/invoices` now answers what `adminInvoiceListResponseSchema`'s `pagination` block has always declared: `hasMore: true` and an opaque `cursor` while rows remain beyond the page, `cursor: null` and `hasMore: false` on the last one. Pass the cursor back as `?cursor=` with the same filters to read the next page. Rows are ordered newest `issuedAt` first, ties broken by id, so a page boundary never skips or repeats an invoice. A page is filled from the rows the caller's tenant scope lets it see, so a sales representative's page is never shortened by another organization's invoices. A cursor the route did not issue is refused `400 VALIDATION_FAILED`. It always answered `hasMore: false` before, so an instance with more invoices than one page could not reach the rest.
  - **Admin UI** — the _Invoices_ list has a _Load more_ button while more rows exist, and the kind filter offers every kind, `wz` included.
  - **i18n** — `invoices.kind.wz` ("goods dispatch note" / "dokument WZ") and `invoices.loadMore` in the `core` namespace, English and Polish. ERP-imported WZ rows showed the raw key `invoices.kind.wz` in the list, on the detail page and in the kind filter.

- 2b12d58: `@endora-commerce/contracts` now publishes the invoice **list** replies (issue #599): `adminInvoiceListItemSchema` / `adminInvoiceListResponseSchema` for `GET /api/v1/admin/invoices`, `orderInvoiceListItemSchema` / `orderInvoiceListResponseSchema` for `GET /api/v1/orders/:id/invoices`, and `erpSaleDocumentListResponseSchema` for `GET /api/v1/account/organization/invoices` (rows: the existing `erpSaleDocumentListItemSchema`), each with its inferred type. The routes are typed with them.

  Two drifts the new schemas surfaced are fixed in `@endora-commerce/mod-invoices`: an ERP-imported sale document without an order now answers `orderId: null` in the admin list (the key was absent), and `pagination.limit` is the page size asked for, an empty page included (it was the number of rows answered, `0` for an empty page, which `paginationSchema` refuses). The admin invoice list renders a dash for a document without an order instead of failing on it.

- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 4efb051: The module page lists every invoice route with its `invoices:read` / `invoices:write` gate, describes automatic issuance on `invoices.auto_issue.trigger_status` and on-demand PDF rendering, and names the invoice's `kind`, `status` and `origin`. Documentation only.
- Updated dependencies [baa0dae]
- Updated dependencies [ee0698d]
- Updated dependencies [9c8efbe]
- Updated dependencies [3de70b4]
- Updated dependencies [2ee4923]
- Updated dependencies [e9df6b5]
- Updated dependencies [1937bed]
- Updated dependencies [3254098]
- Updated dependencies [7616ef1]
- Updated dependencies [ed57923]
- Updated dependencies [cffa0bf]
- Updated dependencies [644739b]
- Updated dependencies [c58acd1]
- Updated dependencies [fc91398]
- Updated dependencies [feaa40b]
- Updated dependencies [d2f179f]
- Updated dependencies [d16b343]
- Updated dependencies [34b3387]
- Updated dependencies [e283396]
- Updated dependencies [4ecb155]
- Updated dependencies [ff7bd10]
- Updated dependencies [097b599]
- Updated dependencies [761d9c4]
- Updated dependencies [8e7f794]
- Updated dependencies [8e7f794]
- Updated dependencies [f39d37f]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [695636f]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [3f95d1c]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [f5caa4e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [8a4ca9c]
- Updated dependencies [c7ec2fa]
- Updated dependencies [52831b7]
- Updated dependencies [a2d306f]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
- Updated dependencies [2e603f7]
- Updated dependencies [2e603f7]
- Updated dependencies [73e8e8c]
- Updated dependencies [bf257b8]
- Updated dependencies [d591709]
- Updated dependencies [577e94c]
- Updated dependencies [e435bad]
- Updated dependencies [7bdf512]
- Updated dependencies [5c148de]
- Updated dependencies [e435bad]
- Updated dependencies [5c148de]
- Updated dependencies [036865c]
- Updated dependencies [0beb869]
- Updated dependencies [37532da]
- Updated dependencies [bfdbeaf]
- Updated dependencies [65f7abc]
- Updated dependencies [a998fee]
- Updated dependencies [54ae028]
- Updated dependencies [20cda0c]
- Updated dependencies [48b2505]
- Updated dependencies [c24bd3c]
- Updated dependencies [6b664cd]
- Updated dependencies [cd05402]
- Updated dependencies [91272e6]
- Updated dependencies [eb4dbc6]
- Updated dependencies [e2669cd]
- Updated dependencies [aec841a]
- Updated dependencies [da2b459]
- Updated dependencies [77904b3]
- Updated dependencies [4ab926c]
- Updated dependencies [a3b1da5]
- Updated dependencies [28fc1c7]
- Updated dependencies [2b12d58]
- Updated dependencies [9110863]
- Updated dependencies [2905024]
- Updated dependencies [ae1cedf]
- Updated dependencies [6f0debc]
- Updated dependencies [d6e7a55]
- Updated dependencies [62d3e2d]
- Updated dependencies [0b2f558]
- Updated dependencies [dc9bbea]
- Updated dependencies [1acf873]
- Updated dependencies [edf46c9]
- Updated dependencies [ef656f9]
- Updated dependencies [71ec1f8]
- Updated dependencies [7a3673f]
- Updated dependencies [1c3366d]
- Updated dependencies [ea965bb]
- Updated dependencies [fc08f90]
- Updated dependencies [d34fe02]
- Updated dependencies [59b5246]
- Updated dependencies [c55dcf5]
- Updated dependencies [3e7b0b6]
- Updated dependencies [d68aa70]
- Updated dependencies [0b991d6]
- Updated dependencies [9af7a64]
- Updated dependencies [ecbebe2]
- Updated dependencies [e61a12b]
- Updated dependencies [d362c3c]
- Updated dependencies [ef9630f]
- Updated dependencies [b7a9c8e]
- Updated dependencies [75f89d2]
- Updated dependencies [ca66684]
- Updated dependencies [b6fd6df]
- Updated dependencies [6658f0f]
- Updated dependencies [877477b]
- Updated dependencies [767d5de]
- Updated dependencies [d0c5dc8]
- Updated dependencies [ac094f5]
- Updated dependencies [61a6edf]
- Updated dependencies [dd869ee]
- Updated dependencies [ff6b599]
- Updated dependencies [ac65359]
- Updated dependencies [49b43de]
- Updated dependencies [5f8eede]
- Updated dependencies [de28088]
- Updated dependencies [44529a4]
- Updated dependencies [af88938]
- Updated dependencies [9aff446]
- Updated dependencies [42a9a4b]
- Updated dependencies [8ae3f58]
- Updated dependencies [65cdd0e]
  - @endora-commerce/admin-kit@0.111.0
  - @endora-commerce/contracts@0.111.0
  - @endora-commerce/platform@0.111.0
  - @endora-commerce/email-components@0.111.0
  - @endora-commerce/page-builder-admin@0.111.0
  - @endora-commerce/page-builder-core@0.111.0

## 0.110.0

### Minor Changes

- 9bfb0b8: The legacy two-value organization role is removed (`specs/170-organization-roles/`, WP-12). Breaking for every consumer that still names it. A member holds a role **id**, and what they may do follows from that role's permissions. Old → new:

  - `organizationRoleSchema` and `OrganizationRole` (`'organization_admin' | 'regular_user'`, from `common.ts`) are removed. Use `OrganizationRoleRef` (`{ id, name, kind }`) and `OrganizationRoleKind` (`administrator`, `member`, `custom`) instead.
  - `CustomerAccountRole` is removed, and so are `CustomerAccountRecord.role` and `CustomerAccountCreateInput.role`. Read and write `organizationRoleId` instead; it is required on create.
  - `CustomerAccountReadPort.countByOrganizationRole(organizationId, role, options)` is removed. Use `countAdministrators(organizationId, options)`, which takes the same options. `listByOrganization` still answers the Organization's _Administrator_ holders first, then by creation date.
  - `CustomerRolePort.changeRole(organizationId, customerAccountId, newRole)` is removed. Use `customerAccountRoleCommandPort.changeRole({ organizationId, customerAccountId, roleId })`, the `customer_account.change_role` Command. `customerRolePort` keeps `listMembers` and `removeMember`.
  - `RfqCustomerContext.isOrgAdmin` is removed. Ask `OrganizationPermissionPort.isAdministrator(subject)` instead (research R-30). `carts`, `orders`, `quick_order` and `shopping_lists` no longer pass it.
  - `OrganizationRecord.requiresCartApproval`, `OrganizationCartApprovalWritePort` (the container name `organizationCartApprovalWritePort` is no longer registered), `CartApprovalPolicyWriteResult`, `setCartApprovalPolicySchema` / `SetCartApprovalPolicy` and `cartApprovalPolicyResponseSchema` / `CartApprovalPolicyResponse` are removed, together with the `organization.set_cart_approval_policy` Command. Approval now follows the member's `carts.order_without_approval` permission (OR-3), and the policy endpoints were already removed.
  - On responses, `role` is no longer described on `customerAccountSchema`, `customerLoginResponseSchema`'s `customerAccount` or `impersonationStartResponseSchema`'s `impersonatedCustomerAccount`. `organizationRole` is now **required** on all three, and `permissions` is required on the first two: every producer sends them. `POST /api/v1/admin/organizations/:id/impersonate` (`admin_users`) no longer sends `role` and now sends `organizationRole`, read through `organizationRoleReadPort` (an acknowledged dependency on `organizations`); `POST /api/v1/admin/customers/:id/impersonate` (`customers`) always sends it.
  - The request schemas `inviteMemberRequestSchema` (`{ email, role? }`), `changeMemberRoleRequestSchema` (`{ role }`), `adminDirectMemberRequestSchema` (`role?`) and `adminPatchMemberRoleRequestSchema` (`{ role, expectedUpdatedAt? }`) are removed. Use `inviteMemberToRoleRequestSchema`, `assignMemberRoleRequestSchema`, `adminDirectMemberToRoleRequestSchema` and `adminAssignMemberRoleRequestSchema`, which take `roleId`. They stay strict, so a body that still sends `role` is refused with `400`.
  - The customers CSV export (`import_export`) carries `organization_role_name` (a predefined role's English label, or a custom role's name) and `organization_role_kind` (`administrator`, `member`, `custom`) in place of its `role` column. It reads them through `organizationRoleReadPort`, a new non-binding `degrades-without` edge on `organizations`. The export is export-only, so no import is affected.
  - `carts`' published bundles (`i18n/en.json`, `i18n/pl.json`) drop five unread keys that described the removed policy and the administrator-only approval: `approval.banner.pending`, `approval.banner.rejected`, `approval.banner.policy_on`, `approval.banner.policy_off` and `reject.email.body`.
  - The `CustomerAccount` entity loses `role`. `Organization` loses `requiresCartApproval`, and `OrganizationInvitation` loses `role`, so its `organizationRoleId` is now required. Nothing writes the legacy value any more.
  - New migrations `Migration20261104T094535OrganizationsDropLegacyRoleColumns` (M4) and `Migration20261104T094540CustomerAccountsDropLegacyRoleColumn` (M5):
    - M4 drops `organizations.requires_cart_approval`, `organization_invitations.role` and the invitation default trigger that read it.
    - M5 drops `customer_accounts.role` with its index.
    - M5 also redefines the account default: an account inserted without a role holds _Administrator_ in a personal Organization, else _Member_.
    - Each `down()` re-derives the dropped values from the role reference.

- 6bd2ab7: Issue #876 — invoices follow a consumer's withdrawal that refunded the delivery cost and the payment surcharge.

  - `CorrectiveInvoiceProvider` credits `CorrectiveInvoiceInput.charges` on lines of their own, written with `lineKind` `delivery` / `payment_surcharge`, named and rated like the invoice line that charged them (0 % today). A charge is never credited above what that line still charges after earlier corrections. Otherwise the correction is refused `422 correction_exceeds_charge_remaining` before any money moves. A charge the invoice has no line for is refused `422 no_corrected_line`. An invoice issued before #904 has no line kinds: its delivery line is the first positive 0 % line naming no order item, and its surcharge line the second. A positive line at any other rate is never taken for a charge. `correctionAmounts` takes `charges` and answers `chargeLines`; `CorrectionExceedsChargeRemainingError` and `chargeLinesOf` are new.
  - An invoice issued after such a settlement charges the delivery and the surcharge less what the settled returns refunded (`ReturnRefundsLookup.refundedChargesFor`, from `returnRefundReadPort.listRefundedCharges`), and leaves a line out when nothing is left. A B2C order returned and refunded in full is refused `422 INVOICE_ORDER_REFUNDED` as before.

  **Behaviour change on upgrade.** On a B2C order returned in full after it was invoiced, the last correction now also credits the delivery and the surcharge, so the invoice nets to zero. Before, the delivery stayed charged. A B2C order returned in full before it was invoiced is now refused, where it used to be invoiced for the delivery alone. When the operator reduced a premium delivery, only the difference is invoiced. Documents already issued are not changed.

- 7a73cc8: Migration `Migration20261108T073244InvoicesInvoiceLineKind` adds a nullable `invoice_lines.line_kind` (`goods`, `delivery`, `payment_surcharge`, `discount`, `price_reduction`), an internal column read through the `InvoiceLine` entity's `lineKind` (issue #904). It is not published on the API: `invoiceLineSchema` and the invoice responses are unchanged. Every line of a newly issued invoice or proforma records its kind, including the 0 % delivery and surcharge lines; `RawOrderLine` and `BuiltInvoiceLine` carry it. No amount changes. Lines issued earlier and correction lines stay `null`.
- 32b4d0c: **The content of an invoice issued after a return changes** (issue #435). An invoice or proforma issued once a return has been settled, while the order has no invoice yet, now lists only what the buyer kept: each order line is invoiced at its ordered quantity less the quantity of the order's settled `return`-kind cases resolved with a refund or a credit — whether or not the money has been paid out — and a line returned in full is left off. The discount line carries only the kept goods' share: the order's `discountTotal` less the discount those cases carried back with their refunds (as recorded at settlement), left off when nothing remains. Before, every order line and the whole discount were invoiced, so the amount due included goods the buyer had returned. Replacement, repair and complaint cases change no line; the delivery and payment-surcharge lines, the per-rate VAT on the sum of the nets and `paidTotal` (captured − refunded) are unchanged; an invoice for an order refunded in full is still refused with `422 INVOICE_ORDER_REFUNDED` (a proforma is not). With `returns` switched off, every line is invoiced as before. Invoices already issued are not touched.

  **A default return refund can differ by one cent from before.** For an order placed under the per-rate VAT method, the default refund of a case is now the drop in the value of the goods kept — what was left paid less VAT per rate on the nets kept after the case, net of the discount the kept part carries — instead of the value of the returned units on their own, so the kept-lines invoice equals what is left paid to the cent. Example: 3 × 10.01 at 23 % (36.94) refunds 12.32 for one unit, not 12.31. All of an order's returns together still refund exactly what was paid, and a cent an earlier case refunded under the previous rule is absorbed by the next case on the same order. Orders placed before 0.108.0 keep their rule. This is not a breaking change.

  `ReturnRefundReadPort` (`returnRefundReadPort`, owned by `@endora-commerce/mod-returns`) gains `listReturnedQuantities(orderId)`, returning the new `OrderReturnedQuantity` (`{ orderItemId, quantity, discount }`) from `@endora-commerce/contracts`. The change is additive for a consumer of the port; an implementation of `ReturnRefundReadPort` outside `@endora-commerce/mod-returns` adds the method.

  An invoice for an order **returned in full** before it was invoiced — every product line back through settled returns and no delivery or payment surcharge kept — is refused with the existing `422 INVOICE_ORDER_REFUNDED`, whatever the state of the refund (issued, waiting for a person, or waiting for the gateway's webhook); a proforma is not refused. The error carries `details.reason` (`refunded_in_full` or `returned_in_full`), its message (`errors.INVOICE_ORDER_REFUNDED`) now covers both causes, and automatic issuance skips such an order and logs the cause. When the delivery or the surcharge is kept, the invoice lists only that line.

  Issuing an invoice now holds the order's returns lock, the one `@endora-commerce/mod-returns` takes to create and to settle a case, so an invoice is never drawn from a return being settled; it waits, and answers `409 VERSION_CONFLICT` (`details.code: settlement_in_progress`), retryable, after 15 s. The key is the new `returnCaseOrderLockKey(orderId)` in `@endora-commerce/contracts`. A return line whose default refund is 0.00 because its discount share takes its whole value now carries that discount back, so the invoice's discount line no longer keeps it. None of this is breaking. `@endora-commerce/mod-i18n` adds the sentence for `errors.VERSION_CONFLICT.settlement_in_progress` in English and Polish.

### Patch Changes

- 6459048: Polish invoice PDFs no longer print English labels (issue #437). The invoice document type's built-in layout carried English literals in its label props (_Issue date_, _Sale date_, _Payment due_, _Payment method_, _Seller_, _Buyer_, the VAT summary's _Total_, and the totals block's _Paid_, _Amount due_, _Total_ and _In words_) and in its footer text (_Thank you for your business._). A label prop wins over the translation, so an invoice, proforma or correction printed with that layout said _Paid_ where it should say _Zapłacono_. Every one of these props is empty in the built-in layout now (`GENERIC_INVOICE_TEMPLATE_SEED_REVISION` 3), and an empty prop is drawn in the document's language. The footer follows the labels: an empty or blank footer text prints the default footer in the document's language. Until now it printed an empty footer, while the editor's canvas already showed the default.

  `Migration20261107T110328DocumentTemplatesInvoiceSeededLabels` (`mod-document-templates`) does the same to stored invoice templates. In every language layout of every `invoices.invoice` template, it empties a prop only where the prop holds **exactly** the English literal the built-in layout seeded, and it advances `version` on each template it changes. Every other value stays as it is: a translated label, a reworded one, or a footer with a line added. Other document types are untouched.

  **Behaviour change on upgrade.** If an invoice template kept a seeded English label because you wanted English on Polish invoices, the label prints in Polish after the upgrade. Type the English label into the block again to keep it. The same applies to the English sample footer.

- 7acaa33: The buyer invoice routes for an order — `GET /api/v1/orders/:id/invoices` and
  `GET /api/v1/orders/:id/invoices/:invoiceId/pdf` — now follow the order's own read scope. A regular
  member of an Organization reaches only the invoices of orders they placed; an `organization_admin`
  reaches the invoices of every order of the Organization. Any other order answers 404, as
  `GET /api/v1/orders/:id` already did. Previously these routes accepted any order of the caller's
  Organization.

  `GET /api/v1/account/organization/invoices` is unchanged.

- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- a3502c0: A corrective invoice of an invoice issued under the per-rate VAT method now leaves, per rate, what
  the invoice keeps (issue #873). When a return refunds its default amount, the net and VAT left at
  each rate are VAT per rate on the nets of the kept quantities, the figures an invoice issued after
  the same return lists. For example, returning one unit of 3 × 10.01 net at 23 % credits 10.01 net
  and 2.31 VAT and leaves 20.02 / 4.60; until now it credited 10.02 / 2.30 and left 20.01 / 4.61.
  An operator-reduced amount splits the gross the invoice keeps at the rate by the same rule. Where
  no net carries that gross, the correction itself follows the rule and what is left may be 0.01 off
  it at that rate (owner ruling E1); the money is always exact.

  Only corrections issued from now on change; issued ones are not rewritten. An order placed before
  0.108.0 and invoiced per rate now keeps its unpaid cent as 0.01 net and no VAT, where its
  correction used to leave 0.00 net and 0.01 VAT.

  `correctionAmounts` (`services/corrective-invoice.ts`) takes `originalSummary` and the quantity and
  unit net price of every `CreditedLine`, and reports how each rate's net was found in `paths`.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
- a3502c0: A complaint refunded or credited after the order was invoiced is now documented as a price
  reduction, not as goods coming back (issue #885, product-owner ruling of 2026-11-07). The
  settlement sends its lines with `basis: 'price_reduction'`, no discount and the case's RMA number.
  The correction credits the approved amount at the line's VAT rate on a line stored with quantity 0
  and named in the document's language, _Obniżka ceny (reklamacja RMA-…): product_
  (`invoices.lines.priceReduction`, or `lines.priceReductionUnreferenced` without an RMA number). It
  credits no discount, and it does not lower the quantity a later return of the line is credited
  from. A complaint resolved by replacement or repair still issues no correction.

  The provider refuses, before any money moves, a price-reduction line that carries a discount
  (`422 VALIDATION_FAILED`, `price_reduction_carries_discount`) and a correction that credits more
  goods at one VAT rate than the invoice still charges there (`422 VALIDATION_FAILED`,
  `correction_exceeds_rate_remaining`, with `taxRate`, `remaining` and `vatRatePercent`; the operator
  sentence is in `@endora-commerce/mod-i18n`). The `invoice.corrected` audit entry records
  `priceReductionLines`.

  Wire `CorrectiveInvoiceProvider`'s new last constructor argument, `{ translate, language }`, to name
  the line; without it the line is named in English.

  A complaint refunded before the order was invoiced is unchanged: the invoice still lists the goods
  in full and shows the complaint refund as amount due.

- 2fd4bde: The invoice template editor's canvas draws what the PDF prints (#888). A label the template leaves empty is shown in the language of the tree being edited, from the invoices bundle's `pdf.*` keys. That covers the header title and dates, seller and buyer, the tax ID rows, the line-item and VAT-summary column headers, the totals and the default footer. A label the operator typed is shown as typed. The document-template editor now wraps its canvas in `BlockRenderEnvironmentProvider` with the edited language and `preview: true`, so a contributed block's `useBlockRenderEnvironment().language` is the edited tree's language and no longer always `en`.
- Updated dependencies [18cce2e]
- Updated dependencies [18cce2e]
- Updated dependencies [9cfb28b]
- Updated dependencies [a206da9]
- Updated dependencies [34485ae]
- Updated dependencies [34485ae]
- Updated dependencies [0f1717c]
- Updated dependencies [86e8761]
- Updated dependencies [9bfb0b8]
- Updated dependencies [ed5cf6a]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [2da23d2]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [9d9c8df]
- Updated dependencies [5303aab]
- Updated dependencies [16f85f4]
- Updated dependencies [270aa2b]
- Updated dependencies [3f020ba]
- Updated dependencies [3f020ba]
- Updated dependencies [b59e5d5]
- Updated dependencies [b59e5d5]
- Updated dependencies [bf1cc2d]
- Updated dependencies [ff60e93]
- Updated dependencies [6f19230]
- Updated dependencies [06cf85b]
- Updated dependencies [77b8c37]
- Updated dependencies [65104b8]
- Updated dependencies [7acaa33]
- Updated dependencies [7019c71]
- Updated dependencies [4eee98b]
- Updated dependencies [14ac256]
- Updated dependencies [248bf1b]
- Updated dependencies [b2db8c3]
- Updated dependencies [4cf529d]
- Updated dependencies [5e4dd48]
- Updated dependencies [75b053f]
- Updated dependencies [54fc8f1]
- Updated dependencies [dac5795]
- Updated dependencies [5bbb389]
- Updated dependencies [d69e765]
- Updated dependencies [dbc1cef]
- Updated dependencies [d69e765]
- Updated dependencies [a6bc891]
- Updated dependencies [8ad737c]
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [cea1470]
- Updated dependencies [d46d414]
- Updated dependencies [73e2eec]
- Updated dependencies [29d7e90]
- Updated dependencies [7f2fa6e]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
- Updated dependencies [e46d233]
- Updated dependencies [58a1632]
- Updated dependencies [b476f44]
- Updated dependencies [14fe4fb]
- Updated dependencies [76d89ab]
- Updated dependencies [5cbffb9]
- Updated dependencies [c01aaa3]
- Updated dependencies [6bd2ab7]
- Updated dependencies [a3502c0]
- Updated dependencies [7a73cc8]
- Updated dependencies [5ff8302]
- Updated dependencies [fc7db4c]
- Updated dependencies [c34b405]
- Updated dependencies [5af8c25]
- Updated dependencies [48f055e]
- Updated dependencies [bf50b85]
- Updated dependencies [2c6fba0]
- Updated dependencies [0801f69]
- Updated dependencies [d1c0d13]
- Updated dependencies [6d1d284]
- Updated dependencies [974be57]
- Updated dependencies [99c075e]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0
  - @endora-commerce/platform@0.110.0
  - @endora-commerce/page-builder-admin@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0
  - @endora-commerce/page-builder-core@0.110.0

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
