# @endora-commerce/mod-customers

## 0.112.0

### Minor Changes

- d908737: The admin customer detail's **Impersonate** now asks for an optional reason before it starts a support session, and sends it with the start, so it is stored outside the audit log. After the start the screen says the session is open, links to the storefront and offers **End support session**. It does not offer a second start while that session is open. A refused start stays in the dialog with the refusal (issue #1328).

  The **E-mail language** row names the language in the admin's language, for example "English (US)", with the tag beside it.

  `@endora-commerce/admin-kit/lib` exports `storefrontBaseUrl`, the storefront origin read from `VITE_STOREFRONT_BASE_URL` (default `http://localhost:3000`).

### Patch Changes

- 12371af: The password-reset e-mail an operator sends with **Reset password** on the admin customer screen is now a transactional e-mail, `customer_password_reset_by_admin` (issue #1295). It was a hard-coded English message: it is now sent in the default sales channel's language, with English and Polish default content, and its wording and branding can be edited under **Transactional emails** like every other customer e-mail. It cannot be switched off, because it is how the customer gets back into the account. The plain English message is still sent when no template definition exists.

  `mod-customers` now depends on `transactional_emails` and declares `@endora-commerce/email-components` as a peer dependency.

- e78d27d: Admin screens show translated labels (EN and PL) where they used to show raw codes:

  - Quote requests: the status badge in the list and the detail, the status filter and its chips. The status keys are now `rfq.status.<value>` in the `core` catalogue, which replace the unused `rfq.list.statusFilter.<value>` keys. `rfq.list.statusFilter.all` stays.
  - Cart detail: the actor, the action and both states in the history feed (`carts.audit.actor.*`, `carts.audit.actionLabel.*`).
  - Customer detail: the status of each order, quote request and cart in the history panels, and the address kind.
  - Availability notifications: the status badge. Asset detail: the kind of each record that references the asset.

  Technical values are gone from the order, quote request and cart screens. The order and quote request detail headers no longer repeat the UUID next to the copyable business ID. The order detail names the delivery and payment methods instead of showing their codes. When the Organization or customer details are missing, it says so instead of printing a UUID (`orderDetail.org.unavailable`, `orderDetail.customer.unavailable`). The carts list starts each row with the cart's owner, linked to the cart, instead of the first eight characters of its UUID. The cart detail header names the owner and the Organization, and an anonymous owner is now labelled "Guest" (`carts.owner.anonymous`). The `carts.column.id` key is removed.

- 988436f: Sales admin screens drop the page descriptions that repeated their title or addressed developers (issue #1436, UX audit 2026-11-17, DS-02). The Orders, Customers, Returns, Quote requests, Carts and Organizations lists, the order and quote-request create screens, Order statuses, Return statuses, Payment methods, Credit limits, the promotion editor, Promotion statistics, Order on behalf, New organization, Change tax ID and Convert to company no longer show a description. The payment and delivery method Integrations cards drop their one-line intro.

  Kept descriptions are now one line: Return delivery methods ("A return cost of 0 means the shop pays for the return."), Delivery methods ("Price changes don't affect orders already placed."), Promotion rules, Online customers and Customer groups ("A customer's own group overrides their organization's."). New organization says that members are invited from the organization's page beside its Save, as `create.hint.inviteMembers`.

  Translation keys removed from both `en` and `pl`: `core` `orders.page.description`, `orderCreate.description`, `orderStatusConfig.description`, `rfq.list.description`, `rfqCreate.description`, `organizations.page.description`, `returns.description`, `returns.statuses.description`, `legacyMethods.payment.description`, `legacyMethods.integrations.description`, `legacyMethods.integrations.shippingDescription`, `creditLimits.page.description`, `promotions.edit.description`, `promotionStats.description`, and the unused `rfq.detail.convert.description` and `rfq.detail.approveDescription`; customers `list.description`; carts `carts.page.description`; quick_order `onBehalf.page.description`; organizations `create.description`, `changeTaxId.page.description` and `convertToCompany.page.description`. A deployment that overrides one of these keys can drop the override.

- 932821f: Editor panels render as sections of the card they sit in, not as cards inside it (issue #1437, UX audit DS-03).

  New in `@endora-commerce/admin-kit/ui`: `EditorSection`, a heading (`h2` by default, `as` like `CardTitle`), an optional one-line `description`, an `action`, and a rule between consecutive sections. It has a `chrome` prop: `'section'` (the default) or `'card'` for a section that stands alone on a page. Also new: `EditorSectionChromeProvider`, `useEditorSectionChrome`, and the types `EditorSectionChrome`, `EditorSectionHeading`, `EditorSectionProps` and `EditorSectionChromeProviderProps`. `Section` now renders through `EditorSection` without the divider; it looks and reads as before.

  **Breaking visual change for modules (0.x, so released as a minor):**

  - `CustomFieldValuesPanel` no longer draws its own `Card`. It renders as a section of the host's card. A panel mounted on its own, between cards, must pass `chrome="card"` to keep its card: `<CustomFieldValuesPanel chrome="card" … />`. It also takes `titleAs` (`'h3'` inside a titled card).
  - `RecordHistory` and `CommentThread` list their entries as rows divided by a rule instead of a bordered box per entry. Both take `chrome="card"` to draw a titled card around themselves.
  - `<AdminZone>` takes `chrome`. A contribution built on `EditorSection` renders as a section by default, and as a card of its own under `<AdminZone … chrome="card" />`. Use that prop for a zone mounted at page level. A contribution that draws its own `Card` is unchanged.

  The CRM, Projects, Tasks, quote-request and quick-order panels contributed to the order, quote-request, opportunity, task, organization and customer screens are now built on `EditorSection`. Those screens mount their zones with `chrome="card"`, so the panels look as they did. The custom-field panels on the customer, organization, order-create, quote-request-create, opportunity-create, project-create and task screens keep their card. Project stages, template stages and project-create members are listed as divided rows.

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

- c15eb60: The admin list page pattern (issue #1439, UX audit DS-05) and a pager on the Customers,
  Organizations and Carts lists (issue #1473, SALES-08).

  `@endora-commerce/admin-kit/components` exports `ListPage` (with `ListPageProps` and
  `ListPageLoad`) — the `PageHeader` with its one "New …" action, a toolbar row that is not a card,
  the count in a live region, one results card with loading, error-with-retry and ready states, and
  the `PaginationFooter` under it — and `useListPagination({ scope, maxPageSize })` with the pure
  helpers `pageSizesUpTo`, `fitPageSize` and `lastPageIndex`. The hook keeps the admin's remembered
  page size per list, offers only the sizes the endpoint serves, and moves back to the last page
  that exists when a response reports a smaller total. It reads the page-size preference, so it
  needs `AuthProvider` above it. The `core` bundle gains `common.list.loadError`. The pattern is
  documented in the kit README under "List pages".

  `GET /api/v1/admin/organizations` accepts `page` (one-based, default 1) and `pageSize` (1–200;
  `limit` when omitted) and answers `meta: { page, pageSize, total }` beside `pagination`, whose
  `hasMore` now says whether a later page exists. `@endora-commerce/contracts` adds
  `adminOrganizationListPageQuerySchema` and the `meta` member of
  `adminOrganizationListResponseSchema`. A caller that names neither parameter keeps its one
  `limit`-sized first page, now ordered by `createdAt` and then `id`, so a page boundary never
  repeats or skips a row.

  The Customers, Organizations and Carts admin lists page through every row, open a record from its
  name instead of an "Open" button in each row, tell "none yet" from "none match — Clear filters",
  and offer a retry when the list fails to load. The Customers organization filter is the searchable
  `OrganizationPicker` instead of a list of the first 50 organizations, and resetting two-step
  verification for an organization asks first.

- 84ed7b6: Empty lists now tell "nothing here yet" apart from "your filters match nothing" (issue #1448). The products, inventory, warehouses, back-in-stock and pricing-override lists used to show one sentence for both. Now a list that its filters emptied offers _Clear filters_, and a list with no records offers its create action, if the operator may use it. The sales channels, credentials, online customers, invoice ledger deliveries, dictionary audit and command hooks screens show the kit's empty state instead of a plain grey sentence.

  - **`EmptyState`'s documentation** says where the block belongs. Use it for the page's or the tab's primary region. Keep a one-line sentence for pickers, inline sub-lists and side widgets.
  - **Header create buttons.** While a list is empty, its header no longer repeats the create button that the empty state carries: products, warehouses, inventory import, sales channels and credentials.
  - **Removed keys.** `catalog` drops `productsList.empty.prefix`, `.button`, `.suffix` and `.readOnly`. The empty catalog now uses `productsList.empty.noData.*`.
  - **Peer dependencies.** `mod-sales-channels`, `mod-credentials` and `mod-invoice-ledger` gain an optional peer dependency on `lucide-react` `^1`, which their admin screens now import.

- c60f072: The admin customer detail asks before blocking a customer, resetting their two-step verification or deleting them (issue #1471). Each question names the customer and what the action does, opens with focus on Cancel, and runs the request inside the dialog: busy while it is in flight, and a refusal (the last administrator of a company organization, for example) stays in the dialog. Delete moves out of the action row into its own section at the end of the page; Block is no longer styled as a destructive button, since Unblock reverses it.
- 7329865: The order, invoice, quote request, organization and customer detail screens and the promotion editor no longer replace the whole page with "Loading…" when they re-read their record after an action (issue #1496, UX audit SALES-06). The first load shows a skeleton of the page; a status change, a payment change, a custom-field save, an approve or cancel, a regenerated PDF or a member change keeps the page, its open tab, the scroll position and the focus on screen and marks the content `aria-busy` while it re-reads. A first load that fails now shows its error and a Retry button instead of "not found", and the promotion editor no longer shows an empty form over a promotion it could not read. On the organization screen a member change refused as stale now keeps its explanation on screen after the re-read. New string: `orderDetail.errors.load` (en, pl).
- 25f30c4: More sales screens show an action's result beside the control that caused it, not as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result.

  - Orders and Returns lists: the result of a bulk status change or a bulk authorization appears beside the header's actions. The bulk bar goes away with the selection, so the header is what is still on screen. A result that skipped orders or cases is shown as a warning.
  - Customers list: the result of resetting two-step verification for an organization appears beside the reset button. It is a warning when some accounts were not reset.
  - Credit limits: a granted or adjusted limit appears under the organization's panel. Opening another organization clears it.
  - Invoice detail: "PDF regenerated" and the result of resending the e-mail appear beside the header buttons. The screen shows at most one banner above the invoice: an error first, then "PDF not ready".

- fc7f669: The six sales lists now have one shape (issue #1500, UX audit SALES-24). Each is the kit `ListPage` with the kit `ListToolbar`, so the toolbar is a named `search` landmark in a plain row, not a card. Below it is one results card that holds the bulk bar, the table and the pager. The kit `EmptyState` tells "nothing here yet" apart from "nothing matches these filters", and the second one offers _Clear filters_.

  - **Orders**: _New order_ is in the header for an operator holding `orders:write`. The toolbar, bulk-bar and results cards are now one card. While rows are selected, the bulk _Change status_ button is outline, so _New order_ stays the one filled primary. Each row has a menu with _Change status…_ and _Print invoice_ for that one order, plus _Open organization_. The pager offers only the page sizes the endpoint serves.
  - **Quote requests**: the hand-built toolbar, filter toggle and chips are replaced by the kit toolbar, so the advanced filters sit behind _More filters (n)_. Each row's menu has _Open organization_.
  - **Returns**: the four configuration links (workflow, reasons, return methods, clauses) are one _Settings_ menu next to _Export CSV_. The search is no longer listed as a chip. _Clear all filters_ empties the search too. When a case has an order, its row menu has _Open order_.
  - **Customers**, **Organizations**, **Carts**: these use the kit toolbar and the kit empty state. Each filter is named by its label, and its first option says what it is ("All statuses"). Customers and Carts rows have _Open organization_.

  Removed unused translation keys: `orders.open`, `orders.loading`, `orders.empty`, `rfq.list.open`, `rfq.list.loading`, `rfq.list.filter.toggle`, `rfq.list.filter.clearAll`, `returns.loading`, `returns.empty`, `returns.action.open`, `returns.filter.clearAll`, `organizations.filter.all` (core); `list.search.chip` (returns); `list.clearFilters` and `list.filter.all` (customers); `list.clearFilters` (organizations); `carts.clearFilters` and `carts.filter.all` (carts). The admin-kit README documents how the two compose.

- a79646e: The customer detail screen is one card with two tabs instead of eleven stacked cards (issue #1517, UX audit 2026-11-17 SALES-22).

  - **Profile** holds the account information, the addresses, the panels other modules add (ordering defaults, price negotiation) and the custom fields. **Activity** holds the orders, quote requests and carts. `?tab=activity` opens Activity. While something on Profile is unsaved its tab says so, and switching tabs keeps the change.
  - The organization and the customer group are fields of the account section, each a picker that starts on the current value and an _Assign_ / _Set_ button that applies at once. They were two cards of one picker and one button each. The group picker clears to "No group", which replaces the _Clear group_ button.
  - The account actions are the header's **More** menu: block, password reset, two-factor reset, impersonate and, last and set apart, delete. A blocked customer shows _Unblock_ beside it, a deleted one _Restore_. The _Actions_ card and the delete section at the end of the page are gone. An action's result ("Password reset e-mail sent.") is said beside the header's buttons.

  Removed translation keys (customers): `detail.actions.title`, `detail.dangerZone.title`, `detail.dangerZone.hint`, `detail.org.title`, `detail.org.assignLabel`, `detail.group.title`, `detail.group.setLabel`, `detail.group.clear`.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- b2c1723: The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
- 966e32b: Six admin list screens are the kit `ListPage` now (issue #1749): Sales channels, Credentials, Online customers, Invoice ledger deliveries, Dictionary audit and Comparisons. Each has the kit's loading skeleton, a load error with **Retry**, the result count announced at the end of the toolbar row, and its filters in a toolbar row instead of a card.

  - **Credentials:** _Preview_, _Edit_ and _Delete_ are in the row's menu, and the name opens the configuration. _Delete_ runs inside the confirmation, so a configuration a setting still uses is refused there, with the settings to detach.
  - **Online customers:** the customer's name opens the customer; the _Open_ button is gone. A refresh, by hand or on the timer, keeps the rows on screen.
  - **Invoice ledger deliveries** and **Comparisons:** the _Load more_ button is replaced by the kit pager (_Previous_ / _Next_ and rows per page), as on the invoices list. Comparisons puts the date range behind _More filters_, and the owner opens the comparison.
  - **Dictionary audit:** _Copied_ and _Cache invalidated_ are said beside the buttons, not in a banner.
  - `@endora-commerce/mod-invoice-ledger` no longer ships `mergeLedgerDeliveryPages`, the _Load more_ helper; it was internal to the screen.
  - New `en` / `pl` keys: `sales_channels` `list.toolbar.label`, `list.count`; `credentials` `page.count`, `action.menu`; `customers` `online.count`; `invoice_ledger` `deliveries.toolbar.label`; `comparisons` `list.toolbar.label`.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

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
- Updated dependencies [98c0411]
- Updated dependencies [9f4eae3]
- Updated dependencies [a8261aa]
- Updated dependencies [f64646d]
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
- Updated dependencies [5850aac]
- Updated dependencies [c042024]
- Updated dependencies [8a5725e]
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
- Updated dependencies [72637e0]
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/email-components@0.112.0

## 0.111.0

### Minor Changes

- 172a6b9: The customer detail screen now has one Save for everything that waits to be saved (issue #407, `specs/180-one-save-zone-editors/` WP-8).

  - The screen runs a save session, one per open customer, and passes it to `customer.detail.after`, so the panels contributed there save with the page.
  - A Save button in the page head reads "Save" or "Save n changes", counting the edited custom fields plus every panel's changes. It does nothing while there is nothing to save, and it is not shown to an operator without `customers:manage` when no panel can be written.
  - The custom fields no longer have a Save button of their own. Save writes them first, through the same `PATCH /api/v1/admin/customers/:id/custom-fields`, then the panels in zone order. If the custom-field write is refused, no panel is written and the refusal is shown at its field. If a panel fails after the custom fields saved, a summary at the top of the screen says what was saved and what was not; the next Save writes only what is left.
  - Leaving the page or closing the browser tab with unsaved changes asks first.
  - Block, unblock, password reset, two-step verification reset, impersonation, delete and restore, and the organization and customer-group assignments still apply at once. Their sections now carry an "Applies immediately" badge.
  - New string in English and Polish: `detail.save.hostPartLabel`. The badge is `@endora-commerce/admin-kit`'s `ImmediateBadge`.

- 06a23da: Issue #470 (D-288) — the retired personal address book's audit entries carry names, never the tenant anchor. A `CustomerAddress` is `@CustomerScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

  - `customer_address.merge`, `customer_address.merge_refused`, `customer_address.erased` and `customer_address.anonymized` no longer record the customer account's id in `stateBefore`; it now holds `{ kind }` (plus `wasDeleted` for `.anonymized`). The entries are still recorded against the row (`objectId`).
  - `customer_address.merge` and `.merge_refused` no longer record the personal Organization's id. A merge keeps `mergedIntoAddressId`, `deduplicated` and `wasDefault`; a refusal keeps `mergeRefusal`, the owner's error code. None of them records an address value, as before.
  - `CUSTOMER_ADDRESS_AUDIT_KEYS`, a constant in `src/backend/services/customer-address-audit-state.ts` (not on a published barrel), lists every top-level key these states may hold, held by a sentinel test.
  - No screen reads these values back from the audit log, so no value store is added. The retention sweep's audit-history erasure finds the entries by row id and is unaffected.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** See _Retired personal address book entries leave out the account and the Organization_ in the upgrade guide.

- d0c5dc8: The customer's e-mail language, on the account page and on the admin customer screen (issue #652).

  - New route `PATCH /api/v1/me/customer/preferred-language`, body `{ preferredLanguage }`: the signed-in customer's own choice. A language the request's sales channel offers is matched without regard to case and stored as the channel spells it, answering `{ data: { preferredLanguage } }`; any other answers `422 PREFERRED_LANGUAGE_NOT_OFFERED` ("This store does not offer that language." / "Ten sklep nie oferuje tego języka."). The route is unavailable (`503 MODULE_DISABLED`) while the module is switched off.
  - `GET /api/v1/me/customer` and `GET /api/v1/admin/customers/:id` answer `preferredLanguage` (`null` while unknown).
  - `POST /api/v1/customers/register` records the registering request's language on the new account.
  - The admin customer detail shows an _E-mail language_ row, read-only; _Not set — the store's default language is used_ while the account has none.

- 42a9a4b: One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

  `mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

  **Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in _Upgrading an instance_ ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.

### Patch Changes

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- f39d37f: Each manifest exports `customFieldWrites` (`specs/175-buyer-input-custom-fields/`), the `CustomFieldWriteDeclaration[]` naming the admin routes that write its custom-field host's values: opportunity, project and task create (`POST`) and update (`PATCH …/:id`), and the customer values patch (`PATCH /api/v1/admin/customers/:id/custom-fields`). A type-only declaration read by `check:custom-field-writes`; no runtime behaviour changes.
- 5c148de: The product editor, the category editor, the sales-channel editor and the organization and customer detail screens now pass `saveSession: INERT_SAVE_SESSION` to their zones (issue #407). None of these editors runs a save session yet, so nothing changes for operators. The `core` catalogue adds the save-session notices and the "switched off" message in English and Polish (`saveSession.notice.moduleOff`, `saveSession.notice.crashed`, `saveSession.error.moduleOff`).
- 577e94c: The product editor, the customer and organization detail screens and the sales-channel editor's warehouse routing panel draw their "Applies immediately" badges with `@endora-commerce/admin-kit`'s `ImmediateBadge` instead of a local copy each (issue #407). The badge looks and reads the same. The module strings it replaces are removed in English and Polish: `productEditor.immediate.badge` (catalog), `detail.immediate.badge` (customers, organizations) and `warehouses.channel.immediateBadge` (inventory).
- 4d0a26d: Documentation only (issue #407). The shipped `docs/` pages, in English and Polish, now describe the one Save on every editor with zone panels. Each page says what Save covers, what is checked before anything is written, the order the parts are written in, what a partial save reports and that the next Save writes only the part that failed. It also says how the leave guard works and which sections carry the "Applies immediately" badge.

  - catalog: "Editing a product at a scope" covers the base prices and the Inventory tab's product settings under Save, plus the actions that apply immediately. A new "Editing a category" section on the module page covers the category editor's Save.
  - price_lists: the display-mode override saves with the organization and category editors. The base-price panel's **Discard changes** is described.
  - organizations, customers: a section on each screen's one Save and its immediate actions.
  - quick_order, quote_requests: their panels save with the host screen's Save.
  - sales_channels: the edit page's Save and its count. Deactivate and Re-activate keep unsaved edits, and warehouse routing applies immediately.

  No code, API or string changes.

- aec841a: Response contracts for replies #128's survey did not reach (issue #599, sections 3–5):

  - `@endora-commerce/contracts` publishes `adminCustomerListResponseSchema` / `AdminCustomerListResponse` for `GET /api/v1/admin/customers`. The rows were already described; the `meta: { page, pageSize, total }` envelope was not.
  - `GET /api/v1/cart/upsells` now answers `unitPrice: null` on every row, as `upsellProductSchema` declares. The key used to be absent. The strip resolves no price, and the storefront shows its "no price" label either way. `CartUpsellCandidate` in `@endora-commerce/mod-carts` is now the contract's `UpsellProduct`.
  - `mod-orders` builds order comments as the contract's `OrderComment`, so a key the contract does not declare is a compile error. The customer reply still leaves out `authorAdminUserId` and `systemNote`. The admin customer list route now returns the contract's `AdminCustomerListResponse` type.

- dd869ee: The retention sweep now scrubs the delivery records of the e-mails sent to the anonymised account's address, through `email`'s `emailDeliveryAnonymizationPort`, after the carts step and before the history is erased and the account's own scrub, so an interrupted run is finished by the next one (issue #928). A subject that is already anonymised is not handed to the step: its address is already the account's marker. `CustomerDeletionService` takes the port as a new constructor argument after the carts port, and `CustomersModuleOptions` gains `emailDeliveryAnonymizationPort`.
- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- b064fec: Documentation only. The module page (English and Polish) lists `PATCH /api/v1/admin/customers/:id/custom-fields`.
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
- Updated dependencies [a2d306f]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
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

## 0.110.0

### Minor Changes

- 34485ae: Customers by organization role (`specs/170-organization-roles/`, WP-03).

  - The depletion guard (`409 ORG_OWNER_DEPLETION`) on blocking, deleting and detaching a customer protects the last active holder of a **company** organization's _Administrator_ role, read from the role rather than the legacy `role` column. Blocked administrators no longer count on any of the three paths (deletion and detaching counted them before), so deleting or detaching the last unblocked administrator is refused. Blocking or deleting a personal organization's member is no longer refused.
  - `GET /api/v1/me/customer` answers `organizationRole` and `permissions`; the impersonation start answers `impersonatedCustomerAccount.organizationRole`.
  - `CustomerModerationService` and `CustomerDeletionService` take an `OrganizationDepletionGuard` as their last constructor argument; `customersModule` requires `organizationPermissionPort` and an `organizationRoleReadPort` that also answers `roleRef`.

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

- 270aa2b: **Breaking:** the personal address book is retired for everyone (`specs/173-b2c-address-book-merge/` release 1 of 2).

  - Every former personal-address-book endpoint answers `410 Gone` with `CUSTOMER_ADDRESS_BOOK_RETIRED`, in Polish or English: `GET`/`POST /api/v1/me/customer/addresses`, `PATCH`/`DELETE /api/v1/me/customer/addresses/:addressId`, `PUT /api/v1/me/customer/addresses/:addressId/default`, `POST /api/v1/admin/customers/:id/addresses`, and a `PUT /api/v1/me/customer/defaults` whose body carries `billingAddressId` or `shippingAddressId`. Manage addresses on `/api/v1/organizations/mine/addresses`.
  - `GET /api/v1/me/customer/defaults` (and the admin customer detail's `defaults`) reports the default addresses of the customer's Organization book.
  - `GET /api/v1/admin/customers/:id/addresses` answers `{ organization, personal }`, where `personal` lists only the rows the retirement job refused, each with `mergeRefusal`.
  - The `customerAddressReadPort` port is no longer published.
  - A one-time BullMQ job (`customers.address-book-retirement`, run by the worker process while `customers` is on) moves every live B2C personal-book row into the customer's personal Organization's book without duplicates, keeping an existing Organization default, and erases every other live row — a company member's, one of an individual whose personal Organization was already anonymized, or one of an account with no Organization. The summary it logs counts the last as `erasedWithoutOrganization` and warns when there are any. Each row is audited; a row `addresses` refuses stays live with its reason. A migration adds the provenance columns it writes. The package now peers on `bullmq` and `ioredis`.
  - The retention sweep also blanks and soft-deletes a scrubbed personal Organization's saved addresses.

- a41e6ac: The customer's _Addresses_ card in the Admin UI (`AddressesPanel`) is read-only (`specs/173-b2c-address-book-merge/`, OD-6). It lists the customer's Organization address book, then any personal-book row the retirement job refused, with its reason. The add form is gone, and so are its bundle keys `detail.addresses.recipient`, `.street`, `.city`, `.postal`, `.country` and `.add`. New keys: `detail.addresses.organizationBook`, `.refused`, `.refusedHint` and `.refusalReason`. The module page documents the retired personal book.
- dac5795: The storefront can read whether individual self-registration is offered before it renders the form (issue #756). `customers` adds the public `GET /api/v1/storefront/settings/customer-registration`, which answers `{ data: { allowRegistrationWithoutOrganization } }` from `customers.allow_registration_without_organization`, the same answer `POST /api/v1/customers/register` applies. Its shape is `customerRegistrationOptionsResponseSchema` in the contracts. `CustomerRegistrationService` gains `allowsStandalone()`, and `registerStandalone` now uses it. The response is not cached.
- 54ad556: `customers.allow_registration_without_organization` is now read for the request's sales channel (issue #773). `POST /api/v1/customers/register` and `GET /api/v1/storefront/settings/customer-registration` (through `CustomerRegistrationService.allowsStandalone()`) resolve the value set for the channel the request resolves to, then the all-channels value, then the manifest default (`false`). Until now both read the system-default channel's value and applied it to every channel, so a value set only for another channel had no effect.

  **Behaviour change on upgrade.** An installation that enabled the setting only for its default channel had B2C registration on every channel; after this release it has it only on the default channel, and its other channels refuse standalone registration with `REGISTRATION_REQUIRES_ORGANIZATION`. To keep the previous behaviour, set the value for all channels, or for each channel that should offer it, on the admin settings screen.

  **Federated sign-up (`mod-customer-accounts`).** A first sign-in through an external identity provider (`GET /api/v1/auth/customer/oauth/:provider/callback`) creates an account through `customerSocialLoginPort.autoCreate`, which now reads the same setting for the channel the sign-in was started on (the channel `SocialIdentityService` carries out of the OAuth transaction) instead of the system-default channel. Where the setting is off for that channel the sign-in answers `registration_required` and creates no account; a caller that names no channel gets no account either. The same upgrade note applies: federated sign-up stops on every channel that does not have the setting on.

  **Outside a request** (no resolved sales channel), the `mod-customers` registration gate now answers `false` rather than the system-default channel's value. `customers.deletion_retention_days` and `customers.presence_freshness_minutes` still read the system-default channel.

- 8ad737c: The admin sub-resources of a customer that does not exist answer `404 CUSTOMER_NOT_FOUND`, as the customer itself and a malformed id do (issue #794). Before, `PATCH …/custom-fields` and `POST …/impersonate` answered `404 NOT_FOUND`, and `GET …/addresses`, `…/orders`, `…/quote-requests` and `…/carts` answered `200` with empty lists. A customer outside a scoped operator's reach reads as absent, so it now answers the same `404`. The permission is still judged first: a caller without `customers:impersonate` is refused `403` whether or not the customer exists. The retired `POST …/addresses` answers `410 CUSTOMER_ADDRESS_BOOK_RETIRED` to every caller holding `customers:manage`, whatever the id (`specs/173-b2c-address-book-merge/` FR-005); a malformed id there answered `404 CUSTOMER_NOT_FOUND` before.
- a9398c8: The customer anonymization sweep is restartable (issue #800). It now scrubs a personal organization, then its saved addresses, and anonymizes the account last, so an account whose cascade was interrupted stays due and the next run completes it. Each account runs on its own: one that fails no longer stops the run, which anonymizes the others and then throws once, naming the failed account ids. A `ModuleDisabledError` still aborts the run.

  `PersonalOrganizationPort.anonymizeIfOrphaned` is convergent. It writes only the part of the scrub that is still missing, keeps an existing `deletedAt` (an operator's soft-delete), and records `organization.anonymized` in the same transaction as the scrub, only when something changed. It answers the organization on a repeat call too, and answers `null` only for an org-less account, a non-personal organization, or one that still has a live member.

  `POST /api/v1/admin/customers/:id/restore` answers `409 CUSTOMER_RESTORE_WINDOW_ELAPSED` once `customers.deletion_retention_days` has elapsed since the deletion, even before the sweep has anonymized the account. It used to succeed in that case. `CustomerDeletionService` takes the retention-days resolver as a new constructor argument. `CUSTOMER_RESTORE_WINDOW_ELAPSED` now has a sentence in English and Polish in `customer_accounts`' bundle, so both raise sites answer in the reader's language.

### Patch Changes

- a206da9: Assigning a customer to another organization, or detaching them to their own personal organization, writes the role they hold there with the move (`specs/170-organization-roles/`, WP-02b): a company's _Administrator_ stays _Administrator_ in the target, anyone else becomes its _Member_, and a detached customer is their personal organization's _Administrator_.
- 9b87711: Soft-deleted customer accounts are now anonymized once `customers.deletion_retention_days` has elapsed (issue #677). `AnonymizationSweepWorker.sweep()` had no caller, so a deleted account kept its personal data indefinitely and `customer_account.anonymized.v1` was never announced. The module now installs a daily BullMQ Job Scheduler (`customers.anonymization.sweep`, idempotent across restarts and replicas) and consumes it through `ctx.worker` in processes that run workers, so no run happens while `customers` is off.

  **Behaviour change on upgrade.** The first worker boot after the upgrade installs the schedule, and its first run starts immediately: every soft-deleted account already older than `customers.deletion_retention_days` (default 365) is anonymized within minutes, irreversibly. To keep any of them, raise `customers.deletion_retention_days` before upgrading, for all channels or at least the default channel, and restore them; once the window has passed, restore is refused. See _Deleted customer accounts are anonymized on schedule_ in the upgrade guide, which has a query to count the accounts due.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- 57145f7: The customer anonymization sweep now erases the reasons operators wrote about the customer (issue #843). `PersonalOrganizationPort.anonymizeIfOrphaned` sets a personal organization's `blockedReason` and `rejectedReason` to `null`; `CustomerAccountLifecycleWritePort.anonymize` sets the account's `blockReason` to `null`. The block or rejection itself is kept: the status, `blockedAt`, `rejectedAt`, `blockSource` and who applied the block. A company organization keeps its reasons.

  The audit entries record only whether a reason existed: `organization.anonymized` gains `stateBefore.hadBlockedReason` and `stateBefore.hadRejectedReason`, and `customer_account.anonymized` gains `stateBefore.hadBlockReason`. None of them stores the reason text.

  A subject anonymized by an earlier release is finished on the next sweep run. `CustomerAccountLifecycleWritePort.listDueForAnonymization` now also lists an anonymized account that still has a block reason or custom field values (left by a scrub before #802), whatever the retention cutoff, so raising `customers.deletion_retention_days` cannot strand it. For such an account, `anonymize` clears what is left and writes one more `customer_account.anonymized` entry. That entry's `stateBefore.anonymizedAt` is the original anonymization time, where the first scrub's is `null`; `hadBlockReason` and `customFieldKeys` say what was left. It keeps `anonymizedAt` and does not announce `customer_account.anonymized.v1` again. A personal organization with a reason left is finished whenever the sweep reaches its account.

  The `customers` module page now describes this, and says that audit entries written earlier keep the reason they recorded until #844 ships.

- 58a1632: The retention sweep erases the anonymised customer's audit history in place, through the platform's `auditRedactionService` (issue #844). This covers the rows about the account, and for an individual also the rows about their personal Organization, every address of it (deleted ones included) and the account's rows in the retired personal address book. Keys, ids, timestamps, codes, actions, actors and times stay. Personal values, free text and every custom-field value become `"[erased]"`, and so do the IP address and user agent on the rows the customer wrote for themselves. One `audit.redacted` entry is written per subject. The step runs after the organisation and address scrubs and before the account's own scrub, so an interrupted run is finished by the next one. `CustomerDeletionService` takes the history step's dependencies as a ninth constructor argument, and the module reads `auditRedactionService` off its cradle.
- 76d89ab: The daily anonymization sweep no longer enters the system scope when no account is due, so an idle instance stops writing one `tenant.escape_hatch` audit row a day (issue #857).

  - `CustomerAccountLifecycleWritePort` gains `hasDueForAnonymization(cutoff): Promise<boolean>`: whether `listDueForAnonymization(cutoff)` would list anything, answered yes or no over the same predicate. An implementation of the port outside this repository must add it.
  - The sweep tick reads `customers.deletion_retention_days` and asks that question before it enters its scope. A question that fails counts as yes, so the sweep then runs as before.
  - `CustomerAccountLifecycleWritePort.anonymize` locks the account row before it checks `anonymizedAt`, so two overlapping sweep runs anonymize an account once, with one `customer_account.anonymized` audit entry and one `customer_account.anonymized.v1` event.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
- c34b405: The retention sweep now erases the reasons operators and approvers gave for rejecting the anonymised account's carts, through `carts`' `cartAnonymizationPort`, before the account's own scrub, so an interrupted run is finished by the next one (issue #920). `CustomerDeletionService` takes the port as a ninth constructor argument, and `CustomersModuleOptions` gains `cartAnonymizationPort`.
- 5af8c25: The customer anonymization sweep now finishes every subject an earlier scrub rule left incomplete (issue #923), not only the accounts never anonymized. Until now it picked its work by account, so a personal organization anonymized before the scrub covered its legal name, order-confirmation e-mails, custom field values or block and rejection reasons kept them for good once its account was done.

  `PersonalOrganizationPort` gains `listIncompletelyScrubbed(): Promise<string[]>`: the ids of the personal organizations that carry the scrub's name but not all of the current scrub. It reads only the `organizations` table, ignores the retention cutoff, and agrees field by field with the check `anonymizeIfOrphaned` makes before it writes. An implementation or a test fake of the port must add the method.

  `PersonalOrganizationPort` also gains `hasIncompletelyScrubbed(): Promise<boolean>`, the same rows as a yes-or-no question. The sweep's scheduled tick asks it, outside any tenant scope, when no account is due, so a tick with only organization-side work left is not skipped as idle. If that question fails, the tick runs anyway. An implementation or a test fake of the port must add it too.

  Each sweep run now works through the accounts due for anonymization, then the anonymized member of every organization that method lists, each subject once, through the unchanged cascade. Finishing a subject writes one audit entry for each record it changes, keeps the account's `anonymizedAt` and the organization's `deletedAt`, and announces nothing: no second `customer_account.anonymized.v1`, so Forms does not erase the customer's entries a second time. The next run then finds nothing to do. The count `AnonymizationSweepWorker.sweep()` returns is now the number of subjects processed, finished ones included.

  The `customers` module page now describes this.

- 48f055e: The retention sweep now blanks every row of the anonymised account in the retired personal address book (`customer_addresses`), whether the retirement job moved it, erased it or refused it, or the customer deleted it; each row is audited `customer_address.anonymized` with `customerAccountId`, `kind` and `wasDeleted` only, and keeps its `deletedAt`, `mergedIntoAddressId` and `mergeRefusal`. It runs for every anonymised account, before the account's own scrub, and writes nothing on a repeat run (issue #927). `CustomerDeletionService` takes the retired book as a ninth constructor argument.
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
  - @endora-commerce/admin-kit@0.110.0

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

### Patch Changes

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 5038a3a: Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings) and error codes are unchanged.

  - `@endora-commerce/mod-mfa`: the four TOTP setting names (now "Admin UI — allow two-step verification", "Admin UI — enforce two-step verification", "Storefront — allow two-step verification", "Storefront — enforce two-step verification"; the `MFA_DEACTIVATION_BLOCKED` sentence quotes the new name), the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
  - `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
  - `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
  - `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
  - `@endora-commerce/contracts`: the validation message of the MFA disable request body.
  - `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.

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

## 0.108.0

### Patch Changes

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

## 0.107.0

### Minor Changes

- bf9881f: Each module contributes its record type to admin global search (`@endora-commerce/mod-admin-search`).

  | Package              | Record type                           | Fields offered (default in bold)                                                 | Permission                             |
  | -------------------- | ------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
  | `mod-orders`         | `orders.order`                        | **number**, **organizationName**, **customer**, billingCompanyName, billingTaxId | `orders:read`                          |
  | `mod-quote-requests` | `quote_requests.quote_request`        | **number**, **organizationName**, **customer**, customerNote                     | `rfqs:handle`                          |
  | `mod-crm`            | `crm.opportunity`                     | **number**, **title**, **organizationName**, description                         | `crm:read`                             |
  | `mod-organizations`  | `organizations.organization`          | **name**, **taxId**, legalName                                                   | `customers:read` or `customers:manage` |
  | `mod-customers`      | `customers.customer`                  | **email**, **name**                                                              | `customers:read`                       |
  | `mod-catalog`        | `catalog.product`, `catalog.category` | **sku**, **name**, slug, quickSearchAttributes; **name**, **slug**               | `catalog:read`                         |

  Every provider applies its own admin list's visibility: sales representatives see only their
  organizations' orders, quote requests, opportunities and customers; organizations follow the
  Organizations list, with a representative's assigned organizations ranked first. Each module declares
  a `contributes-to` edge on `adminSearchProviderRegistry`, so none of them depends on global search and
  none loses its switch. `mod-quote-requests`, `mod-organizations`, `mod-customers` and `mod-catalog`
  now declare `_i18n` in `dependencies` (status labels in the admin's language), and each module's
  bundle gains `adminSearch.*` keys in English and Polish.

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

## 0.105.0

### Patch Changes

- 0184be5: An e-mail that was only written to the server log is no longer reported as sent. On an instance
  with no `SMTP_URL` the console mailer logs the message and used to answer `{ status: 'sent' }`,
  and the transactional e-mail service answered a constant `sent` of its own, so every module that
  records or reports a delivery recorded one that did not happen.

  **Breaking for a consumer of the two port types — three unions gain a member:**

  - `EmailMailerSendOutcome` gains `{ status: 'logged' }`. The console mailer answers it instead of
    `sent`; the SMTP mailer and `InMemoryMailer` still answer `sent`.
  - `TransactionalSendOutcome` gains `{ status: 'logged' }`, and `TransactionalEmailSender.send`
    passes the transport's `logged` on. A transport's `suppressed` (an already accepted message id)
    is still answered as `sent`, as before.
  - `emailDeliveryStatusSchema` / `EmailDeliveryStatus` gain `'logged'`, and
    `invoiceEmailNotSentReasonSchema` / `InvoiceEmailNotSentReason` gain `'logged'`.

  What to do: code with an exhaustive `switch` over one of these unions, or that passes
  `outcome.status` into a closed union of its own, stops compiling until it handles `logged`; code
  that reads `outcome.reason` after `outcome.status !== 'sent'` must narrow to
  `outcome.status === 'suppressed'` first, because `logged` carries no reason. Code that compares
  with `=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
  failure and there is nothing to retry: the same call would log the message again. An own
  implementation of `EmailMailerPort` or `TransactionalEmailSender` needs no change.

  What changes on an instance without a mail server:

  - `email_deliveries` rows are written with `status = 'logged'` instead of `'sent'`. The column is
    a plain `varchar(16)`, so there is no migration; rows written earlier keep `sent`.
  - The order, return, payment-status, shipment and invoice e-mail results answer
    `{ sent: false, reason: 'logged' }`, each with its usual "was not sent" log line. Issuing an
    invoice or re-sending its e-mail from the Admin UI says the e-mail was not sent because no mail
    server is configured, in English and Polish (`invoices.emailNotSent.logged`).
  - A CRM Event reminder is recorded as delivered to the bell alone — or as undeliverable when the
    bell is unavailable too — instead of "bell and e-mail".
  - `POST /api/v1/organizations/register` answers `emailVerificationSent: false` when the
    verification e-mail went through the in-code builder and was only logged.

  No setting, permission or migration changes.

- 560f2e3: More credential changes withdraw the sessions and pending sign-ins obtained before them.

  - **`admin_users create` run again for an existing account** replaces the password, so it now
    ends every session of that account and withdraws its pending second-factor challenges and
    setup tickets, through the same path as a peer reset. The write is audited as
    `admin_user.change_password` with `via: 'cli'` and no acting administrator. Creating a new
    account is unchanged.
  - **Removing a second factor.** Disabling your own two-factor authentication
    (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`) ends every other
    session of the account and keeps the one the request was made from. An administrator's reset of
    a customer's second factor (`POST /api/v1/admin/customers/:customerId/mfa/reset`, and the bulk
    route for each account it actually resets) ends every session of that customer. Both withdraw
    the account's pending challenges and setup tickets. Enrolling a factor ends no session, and a
    disable or reset that removes nothing ends none either.
  - **Customer password change** (`POST /api/v1/me/customer/change-password`,
    `POST /api/v1/me/password`) ends every other session of the account and keeps the calling one.
    **Redeeming a reset token** (`POST /api/v1/auth/password-reset/confirm`) ends all of them. Both
    mark every other outstanding reset token of the account as consumed and withdraw its pending
    second-factor challenges and setup tickets.

  In every case the new state is persisted first and the sessions are revoked after it.

  Port changes, all additive: `AuthSessionPort.destroyAllForCustomer` takes an optional
  `{ exceptSessionId }` (`AuthDestroyAllForCustomerOptions`), mirroring `destroyAllForAdmin`;
  `CustomerAuthPort.changePassword` takes an optional fourth argument
  `{ sessionCookieValue }` (`CustomerChangePasswordContext`) naming the session to keep — a caller
  that omits it keeps none. No port member was removed or changed incompatibly.

  Not ports, but changed for anyone constructing these classes directly: `PasswordResetService`'s
  constructor takes the session port as its second argument (the audit port moved to third), and
  `MfaEnrolmentService.disable` returns whether a factor was removed.

- b0c0959: A customer or address id that is not a UUID answers `404` instead of `500`. Every
  `/api/v1/admin/customers/:id…` route handed its path parameter to the database unchecked, so a
  mistyped URL such as `GET /api/v1/admin/customers/not-a-uuid` came back as
  `invalid input syntax for type uuid` behind an `INTERNAL` error. These routes now answer the same
  `404 CUSTOMER_NOT_FOUND` they give an unknown customer, after the permission check, so an anonymous
  caller still gets `401`. The self-service address routes
  (`PATCH`/`DELETE /api/v1/me/customer/addresses/:addressId` and `PUT …/default`) had the same
  omission and now answer `404 CUSTOMER_ADDRESS_NOT_FOUND`.

  One visible difference beyond the status code: the read-only panels
  (`…/:id/addresses`, `/orders`, `/quote-requests`, `/carts`) answer `404` for a malformed id while
  still answering `200` with empty lists for a well-formed id no customer has.

  No setting or permission changes.

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
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

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

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.7

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
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

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
  - @endora-commerce/platform@0.13.1

## 0.10.4

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

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

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
  - @endora-commerce/platform@0.11.1

## 0.10.0

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

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

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

## 0.8.0

### Minor Changes

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

## 0.7.0

### Minor Changes

- f11ccdb: `customers`, `organizations` and `sales_channels` ship their admin screens, and two icon names
  join the allowlist.

  **Three packages' `./admin` subpath gains `routes` and `nav`, and two of them gain the subpath
  itself.** `@endora-commerce/mod-sales-channels/admin` already exported `contributions` with a
  `zones` array and nothing else; it now declares its screens there too. `@endora-commerce/mod-customers`
  and `@endora-commerce/mod-organizations` had no `./admin` subpath at all and now declare one.
  Eight routes and six sidebar entries between them, at the paths and codes the hand-written host
  registrations carried. The exported symbol is the same one every other module package uses —
  `contributions`, an `AdminContributions` object, and nothing else — so a consumer already
  reading `sales_channels`' zones needs no edit.
  - `@endora-commerce/mod-customers` — **new `./admin` subpath**, exporting `contributions`.
    `/customers` (the landing route), `/customers/online` and `/customers/:id`, all on
    `customers:read`, which is the code every `GET` behind them enforces; the detail screen keeps
    gating its block, unblock, impersonate, delete and restore controls on `customers:manage`
    inside itself. Two sidebar rows, in the `customers` section at weights 100 and 200. The detail
    screen is reached from the roster and has no row of its own. `CustomerDetail` renders the
    `customer.detail.after` zone, which is unchanged.
  - `@endora-commerce/mod-organizations` — **new `./admin` subpath**, exporting `contributions`.
    `/organizations` and `/organizations/:id`, both on the **any-of pair**
    `['customers:read', 'customers:manage']`, which is what
    `requireAdminAny(['customers:read', 'customers:manage'])` enforces on every organization
    endpoint. `AdminNavDeclaration.requiredPermission` and `AdminRouteDeclaration.requiredPermission`
    both take a `PermissionRequirement`, so the pair is declared rather than collapsed: naming only
    the read code hides the screen from a role holding just `customers:manage`. One sidebar row, in
    the `customers` section at weight 300. `OrganizationDetail` renders the
    `organization.detail.after` zone — four modules contribute there — and that is unchanged.
  - `@endora-commerce/mod-sales-channels` — `/sales-channels` and `/sales-channels/:code` on
    `sales_channels:read`, and `/sales-channels/new` on `sales_channels:write`. **That last one is a
    behaviour change for a consumer rendering these routes**: the create form is a screen whose only
    purpose is a write, `POST /api/v1/admin/sales-channels` enforces `sales_channels:write`, and the
    module's own `new-sales-channel` palette action already advertised that code. It was ungated
    while the route was the admin application's, so an operator holding only `sales_channels:read`
    could open a form whose save then refused; the roster's _+ New channel_ button is gated on the
    same code in this release, so the dead end is closed at both ends. `credentials` ships the
    identical split for `/credentials/new`. One sidebar row, in the `channels` section at weight 100.
    `SalesChannelEditPage` renders the `sales_channel.editor.after` zone, which is unchanged.

  **`@endora-commerce/contracts` — two members join `KnownIconNameSchema`: `Building2` and
  `Store`.** They are the glyphs the admin application drew for `/organizations` and
  `/sales-channels` by hand. A contribution names its icon rather than importing it, so a name that
  is not on the allowlist degrades to the fallback; adding them is what keeps the two rows looking
  as they did. Widening an enum is additive for a consumer validating against it and breaking for
  one exhaustively switching over `KnownIconName` — there is no such consumer in this repository.

  **`@endora-commerce/admin-kit` — `resolveIcon` answers for both new names.** `ICON_MAP` gains
  `Building2` and `Store`; the function's signature is unchanged and every existing name resolves
  exactly as before.

  **`@endora-commerce/mod-customers`, `@endora-commerce/mod-organizations` and
  `@endora-commerce/mod-sales-channels` ship new i18n keys, and `@endora-commerce/mod-i18n` loses
  six.** `nav.customers.label`, `nav.customersOnline.label`, `nav.organizations.label`,
  `nav.salesChannels.label` and the two new actions' `label`/`description` pairs are in the three
  modules' own `i18n/{en,pl}.json`; `appShell.nav.customers`, `appShell.nav.customersOnline`,
  `appShell.nav.organizations`, `appShell.nav.salesChannels`,
  `appShell.palette.sub.customerAccounts` and `appShell.palette.sub.storefrontChannels` are removed
  from the shared bundle in both shipped languages, nothing rendering them any more. **A consumer
  resolving one of those six keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **`organizations` and `sales_channels` declare a new palette action each.**
  `open-organizations` (`/organizations`, `customers:read`) and `open-sales-channels`
  (`/sales-channels`, `sales_channels:read`) replace hand-written rows in the admin's own palette
  table — copies the server was never asked about, which went on advertising the screens whatever
  the effective enabled-set said. One narrowing comes with `open-organizations`:
  `ModuleActionSchema.requiredPermission` is a single string, so it names `customers:read` and a
  role holding only `customers:manage` loses the palette entry while keeping the sidebar one.

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

### Patch Changes

- 3786732: Error-code ownership: the rest of Tier A is declared by the modules that own its nouns.

  `manifest.errorCodes` gains six codes on `@endora-commerce/mod-prompt-actions`
  (`ASSISTANT_*`, `PROMPT_*`), five on `@endora-commerce/mod-custom-fields` (`CUSTOM_FIELD_*`),
  two on `@endora-commerce/mod-customers` (`CUSTOMER_ADDRESS_NOT_FOUND`,
  `REGISTRATION_REQUIRES_ORGANIZATION`), two on `@endora-commerce/mod-shopping-lists`
  (`SHOPPING_LIST_*`), one on `@endora-commerce/mod-price-lists` (`PRICE_LIST_NOT_FOUND`) and one
  on `@endora-commerce/mod-transactional-emails` (`TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`);
  `@endora-commerce/mod-i18n` drops the same seventeen from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 3 of eight;
  D-121 tiers T1 and T2; `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes. No wire shape moves —
  `error.code` is unchanged — and no sentence is relocated: none of the seventeen had a
  translation in `en` or `pl` in any bundle. Writing one of those sentences is now a change to the
  owning module's own `i18n/{en,pl}.json` rather than to the platform's.

  `@endora-commerce/mod-shopping-lists` gains an `i18n` bundle it never had, declared as
  `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. It holds the two `SHOPPING_LIST_*`
  sentences in both languages, which is an operator- and buyer-visible improvement: a Polish
  reader refused a delete of the default or the last shopping list now reads Polish prose instead
  of the English the raise site carries.

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

- 764b379: **`customerFilterCond`'s `allowed-set` arm stops returning `{}`, and the function takes an
  argument.**

  `customerFilterCond()` is now `customerFilterCond(organizationColumn: CustomerOrganizationColumn)`,
  where `CustomerOrganizationColumn` is `'present' | 'absent'` — both exported from
  `@endora-commerce/platform/tenancy`'s `filters` module. Any direct caller must pass one:

  ```ts
  // before
  const where = customerFilterCond();
  // after — `'present'` iff the entity you are filtering carries `organizationId`
  const where = customerFilterCond('absent');
  ```

  `@CustomerScoped()` itself is source-compatible and takes no new argument. It derives the answer
  per query from the ORM's discovered metadata, so an entity that gains an `organizationId` column
  starts being filtered on it with no further change.

  **The behaviour change is confined to the `allowed-set` mode** — the mode a scoped
  (assignment-limited) administrator resolves to. It previously contributed **no predicate at all**
  to any `@CustomerScoped` entity, so such an entity behaved as if it were `@GlobalEntity` for that
  actor. It now contributes `{ organizationId: { $in: allowed } }` when the entity carries the
  column, and a predicate that matches nothing when it does not. `all`, `system` and `single-org`
  are unchanged, and a buyer resolves `single-org`.

  A surface that has already established the caller's authority by other means and reads a
  `@CustomerScoped` entity with no organization column will now read nothing under a scoped
  administrator. Cross that deliberately with `withSystemScope(reason, fn)` after the check that
  establishes the authority; do not catch.

  `@endora-commerce/mod-quick-order`'s `registerQuickOrderAdminRoutes` takes a new required dep,
  `customerAccounts: CustomerAccountReadPort`. It is the tenant boundary of the admin build route:
  `onBehalfOf` names the customer account and organization the built Cart or Quote Request is
  written to, and it arrives in the request body, where no read filter can reach it.

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
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
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
  - @endora-commerce/platform@0.7.0
