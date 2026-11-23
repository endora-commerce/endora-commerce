# @endora-commerce/mod-returns

## 0.112.0

### Minor Changes

- 8a06dc5: **Returns: notifications, and complaints about goods bought elsewhere, with attachments and clauses.**

  **Breaking for API callers: `attachmentAssetIds` and the JSON `{ assetId }` attachment body are removed.** They linked any asset id without checking that it existed, belonged to the caller or was a file a case may hold, and nothing displayed the link. Files are now uploaded and stored by `returns` itself.

  - Old: `POST /api/v1/returns` with `{ …, attachmentAssetIds: [assetId] }`, and `POST /api/v1/returns/:id/attachments` with the JSON body `{ assetId }` (`addReturnAttachmentRequestSchema`).
  - New: upload each file first with `POST /api/v1/returns/uploads` (multipart: `file`, `type` = `photo` | `proof_of_purchase` | `other`), which answers `{ uploadId, … }`. Then file the case with `{ …, attachments: [{ uploadId }] }`. To add a file to a case already filed, post it as multipart (`file`, `type`) to `POST /api/v1/returns/:id/attachments`. Download with `GET /api/v1/returns/:id/attachments/:attachmentId/file` (customer) or `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` (admin).
  - `returnAttachmentSchema` no longer carries `assetId`. It now carries `type`, `filename`, `mimeType` and `sizeBytes`. `addReturnAttachmentRequestSchema` is gone; `returnUploadSchema`, `returnAttachmentUploadFieldsSchema` and `RETURN_ATTACHMENT_LIMITS` are new. Limits: JPEG, PNG, WebP or PDF, judged by content; 10 MB per file, 30 MB per submission, 10 files per case. A refused file answers `422 RETURN_ATTACHMENT_REJECTED`.
  - **Upgrade note:** attachment rows written by the old API keep their `asset_id`. The migration fills in their `organization_id` from their case and types them `other`. They stay in the database but are not listed on the case and cannot be downloaded, because no stored file stands behind them.

  **`@endora-commerce/mod-returns`**

  - **Notifications.** Four transactional e-mails, editable and switchable under _Transactional emails_ (group `returns`), in English and Polish:
    - `return_new_case`, to the new setting `returns.new_case_recipients` (`string_list`, up to 10 addresses, per sales channel).
    - `return_submitted`, to the filer.
    - `return_comment_added`, for a customer-visible comment posted with `notifyCustomer: true`.
    - `return_status_entered`, for a status marked `notifyCustomerOnEntry`.
    - Administrators holding `returns:read` also get a bell entry per new case, while `admin_notifications` is present.
    - Delivery runs on the `returns-notifications` BullMQ queue, after commit.
    - `GET /api/v1/admin/returns/notification-health` reports channels whose new-case e-mail goes to nobody.
  - **Who authorized a case.** `return_cases.authorized_by_admin_user_id` is recorded on entering _Authorized_. Existing cases are back-filled from the audit log. The admin list, the detail and the CSV export (`reference`, `authorizedBy`) show it. Every case has a `reference`: the RMA number, else `#` and the first eight characters of the id.
  - **Complaints without a platform order.** Switched on per channel with `returns.off_platform_complaints_enabled` (default off); `returns.proof_of_purchase_required` makes a proof-of-purchase file mandatory.
    - `POST /api/v1/returns` accepts `createOffPlatformComplaintRequestSchema`: lines naming a catalogue product or a model name, a purchase date, a contact and a return address. `createReturnCaseRequestSchema` is now the union of the order and the no-order shapes.
    - Both shapes take an optional `submissionKey`, which makes a repeated submission answer the case already filed (`200` instead of `201`).
    - Such a case has `orderId: null` and `offPlatform: true`, and is settled by `replacement`, `repair` or the new `settled_outside` (with a mandatory `resolutionNote`). Refund, credit and a corrective invoice answer `422 RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.
    - New refusals: `403 RETURN_OFF_PLATFORM_DISABLED` and `422 RETURN_PROOF_OF_PURCHASE_REQUIRED`.
    - Admin list filter `origin` (`platform` | `off_platform`).
    - Summaries carry `offPlatform`, `productLabel`, `lineCount` and `purchaseDate`.
  - **Clauses.** `GET|POST /api/v1/admin/returns/clauses` and `PATCH|DELETE …/clauses/:id`, plus the _Return and complaint terms_ screen and palette action.
    - A clause is `must_accept` or `inform_only`, per language, for returns, complaints or both, on one channel or all.
    - `GET /api/v1/returns/form-config` serves the clauses with the toggles and limits.
    - A filed case stores the clauses shown with it (`acceptedClauses`, `clausesAcceptedAt`). A missing or outdated acceptance answers `422 RETURN_CLAUSES_NOT_ACCEPTED`.
  - **Erasing personal data.** On `customer_account.anonymized.v1` the account's cases lose their contact, return address and files (`personalDataErasedAt`). The daily `returns-maintenance` pass catches up on an anonymisation missed while the module was off, and deletes uploads never filed after 24 hours.
  - **Event** `return_case.created.v1` (`ReturnCaseCreatedEventV1Schema`) is emitted after a case is filed. `ReturnStatusEvent.orderId` may now be `null`.
  - **Dependencies.** New binding dependencies: `_i18n`, `admin_users`, `assets_library` and `catalog`. `admin_notifications` is a `degrades-without` edge. The package now has a peer dependency on `@fastify/multipart` `^10`.
  - **Migrations.**
    - `20261113T145001_returns_authorizer_status_notifications` adds the authorizer and the per-status e-mail flag.
    - `20261113T155433_returns_off_platform_complaints` makes `return_cases.order_id` nullable, adds the purchase, contact, address, clause, note, submission-key and erasure columns, reshapes `return_case_attachments`, and creates `return_case_clauses`. Rolling it back is refused while a case without a platform order exists.

  **`@endora-commerce/mod-transactional-emails`** publishes `transactionalEmailStatePort` (`TransactionalEmailStatePort.isActive(code)` in contracts). It reports whether a transactional e-mail is switched on, and `false` for an unknown code.

  **`@endora-commerce/admin-kit`** resolves the palette icon `FileCheck`, which `KnownIconNameSchema` now accepts.

- bd47236: **Returns: complaints from guests without a customer account, followed through a private tracking link.**

  **`@endora-commerce/contracts`**

  - **Widened, handle `null`:** `returnCaseSummarySchema.customerAccountId` and `returnCaseDetailSchema.customerAccountId` are now `uuid | null`. `null` means a guest's case, which also has no `organizationId`. An admin consumer that read the field as always set must handle `null`.
  - `ReturnCaseCreatedEventV1Schema` gains `guest: boolean`, and its `organizationId` is `uuid | null` (`null` exactly when `guest`).
  - Admin shapes: `adminReturnsListQuerySchema.origin` accepts `off_platform_customer` and `guest` beside `platform` and `off_platform` (unchanged meaning: both kinds bought elsewhere). Summaries and details carry `guest`; details carry `contactVerifiedAt`, `trackingLinkValidUntil` and `guestDataErasureDueAt`; a comment's `authorKind` may be `guest`; an attachment carries `uploadedByGuest`. New `adminEraseGuestDataRequestSchema` (`{ confirm: true }`) and `adminEraseGuestDataResultSchema`.
  - Guest shapes, new: `guestAvailabilitySchema`, `guestVerificationRequestSchema`, `guestVerificationAcceptedSchema`, `guestSessionRedeemRequestSchema`, `guestSessionSchema`, `guestFormConfigSchema` (180's `returnFormConfigSchema` plus `reasons` — the active complaint reasons, since `GET /api/v1/returns/reasons` needs a customer session — `verifiedEmail`, `sessionExpiresAt` and `confirmationEmailEnabled`), `createGuestComplaintRequestSchema` (`.strict()`: a body naming an account, an organization or an order is refused), `guestCaseFiledSchema`, `guestCaseViewSchema` (which includes `rejectionReason`, `string | null`), `guestCommentRequestSchema`, `guestTrackingAttachmentFieldsSchema` and `guestLimitSchema`.
  - Error codes: `RETURN_GUEST_COMPLAINTS_DISABLED` (403), `RETURN_GUEST_SESSION_REQUIRED` (401), `RETURN_GUEST_LINK_INVALID` (410), `RETURN_TRACKING_LINK_INVALID` (404), `RETURN_GUEST_LIMIT_REACHED` (429, `details.limit`) and `RETURN_GUEST_DATA_ERASED` (409).

  **`@endora-commerce/mod-returns`**

  - **Complaints from guests.** New per-channel setting `returns.guest_complaints_enabled` (default off), effective only while `returns.off_platform_complaints_enabled` is on for the same channel. A visitor without an account confirms an e-mail address by a one-time link (60 minutes, redeemed by a POST so mail scanners cannot use it up), gets a 24-hour guest session, and files a complaint without a platform order on 180's form. The case has no customer account and no organization and is never attached to an account. Anonymous routes under `/api/v1/returns/guest/*`.
  - **Tracking link.** Every guest case has one private link, `/api/v1/returns/track*` with the token in the `X-Returns-Tracking-Token` header: read the case, reply and add files while it is open. It stops working 90 days after the case closes, on erasure, or when an administrator sends a new one (`POST /api/v1/admin/returns/:id/guest/tracking-link`, `returns:write`). The link is sealed with the platform's cursor seal, so rotating `SESSION_COOKIE_SECRET` voids every guest link.
  - **Who sees guest cases.** Only administrators whose tenant scope is unrestricted; for everyone else a guest case is absent from lists, counts, search, export, saved views and the bell, and a direct id answers 404. The admin list filters by the new origins, marks guest rows, and finds a case by its exact contact e-mail; the CSV export gains a `guest` column.
  - **Retention and erasure.** New global setting `returns.guest_data_retention_days` (default 90, read clamped to 30–3650). The daily `returns-maintenance` sweep erases a guest's contact, return address and files that long after the case enters a terminal status (`closed_at` is now written on terminal entry), and deletes verification records after 7 days. New permission `returns:erase_personal_data` (requires `returns:read`) and `POST /api/v1/admin/returns/:id/guest/erase` erase at once, in any status. Anonymising a customer account does not touch guest cases with the same address.
  - **E-mails.** Seven transactional templates in English and Polish: `return_guest_verification` and `return_guest_submitted` (neither can be switched off), `return_guest_comment_added`, `return_guest_status_entered`, `return_guest_authorized`, `return_guest_rejected` and `return_guest_link_reissued`. The shop's `return_new_case` names a guest as "{name} (guest)".
  - **Audit.** Guest writes are Commands recorded with `by: 'guest'`: `return_case.create`, the new `return_case.comment.add_by_guest`, and `return_case.attachment.add`; plus the new `return_case.tracking_link.reissue` and `return_case.guest_data.erase`. No entry holds a guest's contact value, comment text or token.
  - **Migration** `20261116T104415_returns_guest_complaints` makes `return_cases.customer_account_id` nullable with checks that a guest case has no organization, adds the guest columns to cases, comments and attachments, and creates `return_guest_verifications`. Rolling it back is refused while a guest case exists.

- 8b29aae: A credit resolution on a return of an order paid by a related payer credits the payer (`payerOrganizationId ?? organizationId` from the order's return context) instead of the buyer.

### Patch Changes

- e78d27d: Adds source comments only. Each comment marks a place where the new raw-enum lint rule is waived on purpose. Nothing these packages emit changes.
- 988436f: Sales admin screens drop the page descriptions that repeated their title or addressed developers (issue #1436, UX audit 2026-11-17, DS-02). The Orders, Customers, Returns, Quote requests, Carts and Organizations lists, the order and quote-request create screens, Order statuses, Return statuses, Payment methods, Credit limits, the promotion editor, Promotion statistics, Order on behalf, New organization, Change tax ID and Convert to company no longer show a description. The payment and delivery method Integrations cards drop their one-line intro.

  Kept descriptions are now one line: Return delivery methods ("A return cost of 0 means the shop pays for the return."), Delivery methods ("Price changes don't affect orders already placed."), Promotion rules, Online customers and Customer groups ("A customer's own group overrides their organization's."). New organization says that members are invited from the organization's page beside its Save, as `create.hint.inviteMembers`.

  Translation keys removed from both `en` and `pl`: `core` `orders.page.description`, `orderCreate.description`, `orderStatusConfig.description`, `rfq.list.description`, `rfqCreate.description`, `organizations.page.description`, `returns.description`, `returns.statuses.description`, `legacyMethods.payment.description`, `legacyMethods.integrations.description`, `legacyMethods.integrations.shippingDescription`, `creditLimits.page.description`, `promotions.edit.description`, `promotionStats.description`, and the unused `rfq.detail.convert.description` and `rfq.detail.approveDescription`; customers `list.description`; carts `carts.page.description`; quick_order `onBehalf.page.description`; organizations `create.description`, `changeTaxId.page.description` and `convertToCompany.page.description`. A deployment that overrides one of these keys can drop the override.

- 4fdc335: More admin screens follow the DS-03 rule that a frame inside a card is a defect unless it is a field (issue #1437, UX audit 2026-11-17).

  - **My profile** is one form card with three sections (identity, author profile, password) under the one Save, and the language preference, which is saved on its own, is the one card beside it. The language Save's result is a status line beside its button, with an icon, in place of a red or green box inside the card. The language select is named by its heading. The screen is on the kit's primitives.
  - **Organization detail, price display mode** (`price_lists`, `organization.detail.after`): the panel has a heading (_Pricing_) and renders as an `EditorSection`, so it follows the mount — one titled card at page level, a section inside a host card. It was a card without a heading.
  - **Return detail** (`returns`): comments and the accepted clauses are rows divided by a rule, not a bordered box each.
  - **Settings** (`settings`): a group's settings are rows divided by a rule inside the group card, not a bordered box each; a changed row keeps its tint and its _Unsaved_ badge.
  - **Form entry notes** (`forms`): notes are rows divided by a rule, not a bordered box each.

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

- c4addef: The three returns configuration lists — return reasons, return delivery methods and return statuses — create from a _New …_ button in the page header that opens a dialog, instead of a form drawn open under the list (issue #1439). With no reason or method yet, the empty state carries that button instead. A missing required field is said at the field, a server refusal stays in the dialog with what was typed, and a success closes the dialog and is said next to the header's button. The statuses screen now says _Status added._ after a create. When every delivery method already has a return setting, the dialog says so instead of offering an empty choice. An operator without `returns:write` — the permission every write route already requires — still sees the three lists, but without _New …_, the row _Delete_ buttons, or the active and e-mail toggles, which are shown disabled. No API, setting, permission or migration changes.
- 35e0829: `ContentLanguageTabs` (`@endora-commerce/admin-kit/components`) is now drawn by the kit's `Tabs` (issue #1445): one tab in the tab order (roving `tabindex`), ←/→ select and wrap, Home/End jump to the ends, and the `.b2b-tabs` look of every other strip instead of filled and outline buttons.

  It gains an optional `idBase` prop. Pass it and wrap the per-language content in `TabPanel`, and every tab names that panel through `aria-controls`; leave it out for a strip that switches page state spread over the screen, which then names no panel:

  ```tsx
  <ContentLanguageTabs languages={languages} activeLanguage={language} onChange={setLanguage} idBase="product-content-language" />
  <TabPanel idBase="product-content-language" value={language} tabIndex={-1}>{fields}</TabPanel>
  ```

  `Tabs` gains the matching optional `controlsPanel` prop (default `true`); `false` omits `aria-controls`.

  With no language to offer the strip draws the kit's `EmptyState` (issue #1448) instead of a grey sentence, with the new `core` key `contentLanguageTabs.emptyHint` (EN and PL) as its line. The catalog's product and category content screens, the CMS block and template editors (their canvas) and the returns clause dialog name their language panel; the CMS page editor and the blog editors, whose language also switches settings fields, keep a strip with no panel.

- b8d1fab: The returns admin screens are translated in full and show names instead of codes (issue #1472). On the case detail, the authorize action, the status transition buttons (now named after the target status, "Move to Received" rather than "→ received"), the items table, the return shipments card (direction and status translated) and the load and action errors have English and Polish text; the order is a link to the order, named by its order number; amounts are formatted in the case currency.

  The return reasons, return statuses and return delivery methods screens use the admin kit's labelled form fields, switches and empty states. A reason's label and what it applies to, a status's name and a return delivery method's name are shown in the operator's language, and a return delivery method is chosen by name instead of by pasting its ID (the ID field stays as a fallback when the delivery methods cannot be read). A return cost of 0 is shown as free. Deleting a reason, a status or a return delivery method now asks for confirmation; the delete runs inside the dialog, which shows a refusal, and focus moves to the next row's Delete or to the form's first field.

  On the case detail, an action's result (authorized, moved, rejected, settled, a shipment recorded or received, a comment added, the consent recorded or revoked) is said beside the control that produced it instead of in a banner at the top of the page; errors are still a banner.

  The `returns.methods.description` key is removed from the shared bundle: the "0 = free" note is now the return cost field's hint, `methods.field.costHint` in the `returns` bundle. A deployment that overrides the old key must move its text there.

- 89dc3b1: Screen readers now read the admin's visible labels, in the admin's language, instead of developer ids (issue #1475). Before, some controls had an `aria-label` that replaced their visible label, such as `customerNote`, `select-all` or `deliveryAddress-street`.

  - **New order** and **new quote request**: the customer, sales channel, payment and delivery method pickers, the customer note and the new-address fields are now named by their labels through `FormField`. Each address side is a group named "Delivery address" or "Billing address", and its saved-address picker carries the same name.
  - **Order detail**: the comment box has a visible label, "Add a comment".
  - **Orders** and **Returns** lists: the selection checkboxes read "Select all orders on this page" and "Select order ORD-…", with the returns equivalents.
  - **Order statuses**: the edit and delete icon buttons read "Edit status …" and "Delete status …". The actions column has a hidden heading, and the delete confirmation is named by its title.

  A new lint rule (`no-restricted-syntax` in the root `eslint.config.js`, admin sources only) rejects an `aria-label` or `ariaLabel` written as a camelCase or hyphenated id. The two sites left in the catalog attribute manager are tracked in #1590.

  Tests that found these controls by their developer ids now find them by their accessible name, or by `id` where two controls share a name.

- 87fb9c3: On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

  A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.

- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
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

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- 306a659: The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — _Organizations_, _Price books_, _CMS pages_ — instead of _Back to organizations_, _All warehouses_, _Back to list_ or a bare _Back_ (follow-up of issue #1549). A generic _Back_ remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

  The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.

- 7ea72af: The way back from a detail, create or settings screen is now always the page header's back link above the title (issue #1549). Organization, New organization, Tax ID scope, Change tax ID, Convert to company, Order statuses, Return, Form entry, Category content, Product content and Comparison drew it as an outline Back button among the header actions, an arrow link above the header, or a button at the bottom of the page. Order statuses now goes back to "Orders" rather than a bare "Back". A form entry that is missing or cannot be loaded shows a "Form entry" heading with the same back link. The admin-kit README names `PageHeader` `back` as the one pattern.
- bfc21d3: Shorter admin copy on the order, quote-request, organization, promotion, invoice and return screens (UX audit text-to-cut pass, issue #1567):

  - Removed lines that repeated what the screen already shows: the description on the invoices list, the line under the customer's price-negotiation override, the line above the default payment / delivery / address fields, and the description of the organization's Roles section.
  - Shortened to one line: the read-only note on price negotiation, the warehouse-precedence hint, the order-confirmation e-mails hint, the parent-organization hint, the empty sales-reps note, the sales-channel hints on order and quote-request creation, the saved-rule copy hint on promotions, and the pending-effects notice on an order.
  - Shortened notices: the "carrier not contacted" shipment notice and the "different refund method" warning on a return.

  Removed translation keys (EN and PL): `invoices.description`, `defaultPreferences.description` (core bundle), `negotiation.customer.description` (quote requests), `roles.tab.description` (organizations). A theme or overlay that overrode them can drop the override.

- 8688a1f: Nine more admin list screens now use the kit `ListPage` (issue #1749): Inventory, Low stock, Warehouses, Availability notifications, Product feeds, Price books, Return reasons, Return delivery methods and Return clauses. Each one has the kit's loading skeleton, a load error with **Retry**, and the result count at the end of the toolbar row. The inventory lists' toolbar is a row above the results, not a strip inside their card. A filter or page change on Inventory, Warehouses, Availability notifications and Price books keeps the rows on screen while it reloads. Return clauses show the kit empty state instead of a bare sentence. Product feeds no longer show _New feed_ twice while there is no feed.

  - `@endora-commerce/admin-kit`: the `ListPage` `tabs` slot is documented as the band between the header and the toolbar, which can also hold a KPI strip.
  - New `en` / `pl` keys: core `warehouses.count`, `inventory.count`, `inventory.lowStock.count`, `inventory.availability.count`; `product_feeds` `feeds.count`; `returns` `reasons.count`, `methods.count`, `clauses.count`.

- 2d0537e: The admin returns list (`GET /api/v1/admin/returns`) now orders both its sorts by `id` after the chosen key, so cases filed at the same instant no longer repeat or go missing across pages (#1760).
- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- c37a362: The returns admin names a return status in the admin's language on the returns list (the status column and the status filter) and in the return detail's header (issue #1815). Before, both showed the status's default (English) name to a Polish admin, while the statuses configuration page and the transition buttons already used the Polish name. A status name stored under a regional key (`pl-PL`) now also answers its language, as the backend's resolution does.
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

- 599168b: **Returns: reasons and statuses take a Polish name, not only an English one.** The _Return reasons_ and _Return statuses_ screens now have one name field per language, English and Polish, when you create a reason or status. Either name is enough. Each row also has an _Edit_ action, which opens the same dialog to change its names. Editing keeps any other language the record already stores. A status's default name and its suggested code come from the English name, or from the Polish one when there is no English name. The list shows a "Missing: …" badge on a row that lacks a language. The API and the stored data are unchanged.
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

- d14a4fd: **Personal → company conversion.** An operator can turn a personal (B2C) organization into a company in place: same id, orders, carts, addresses and channels, now with a company name, legal name, tax ID, registered address and VAT status.

  - **Command** `organization.convert_to_company` — one transaction. The tax ID is normalised and checked against the active tax-ID scope. The organization keeps its status; it is stamped approved by the operator when it never was. Its member stays its Administrator, and the conversion is refused when that is not so. `personalAccountId` is cleared and `convertedToCompanyAt` set. The audit records only which fields changed (`changedFields`), whether the approval was stamped, and the scope. Refusals: `409 ORGANIZATION_CONVERSION_REFUSED` (`not_personal`, `deleted`, `owner_not_administrator`; new in `ERROR_CODES`) and `409 ORGANIZATION_TAX_ID_EXISTS`. There is no reverse.
  - **Admin API** `POST /api/v1/admin/organizations/:id/convert-to-company` (`adminOrganizationConvertToCompanyBodySchema`) under the new permission `organizations:convert-to-company`. With `validateTaxId: true` — which also needs `customers:manage`, the VAT validation's own permission — a VAT validation runs **after** the conversion commits; its outcome is returned as `vatValidation`, and a failing provider does not undo the conversion. The admin conversion form offers _Validate the tax ID after converting_ (ticked by default) only to an operator holding `customers:manage` and sends `validateTaxId: false` otherwise, so the default form is never refused `403`.
  - **Port** `organizationCommandPort` (`OrganizationCommandPort.convertToCompany`) for admin routes and server code, never for a customer-facing route. **It checks no permission**: the caller is the gate. It runs with the ambient actor and runs no VAT validation.
  - **Event** `organization.converted_to_company.v1` `{ eventId, occurredAt, organizationId, convertedAt }`, dispatched once on commit (`OrganizationConvertedToCompanyEvent`).
  - **Returns** — a return of an order placed while the organization was personal is still a consumer withdrawal after a later conversion (`organizationWasConsumerAt`). The `isPersonalOrganization` dependency of the returns services takes the order's placement time as an optional second argument.
  - To move the converted company's only member out, give a second member the Administrator role first, as for any company.

- 15f5bca: Issue #470 (D-288) — return-case audit entries hold no amount and no free-text reason. A return case is `@OrgScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

  - `return.settled` no longer records `amount`, `charges` (each charge's cap and approved amount), `recomputedDefaults` (line, from, to) or `lineCeilings` (line, default, ceiling). It records `refundedCharges` (charge kinds), `recomputedDefaultItemIds` and `ceilingBoundItemIds` instead. `resolutionType`, `currency`, `settlementState`, `correctiveInvoice` and the withdrawal flags stay.
  - `return.status_changed` no longer records `reason`. It records `hasReason`. The reason is still passed to the status events. It is no longer stored anywhere.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new return entries show no amounts, and a status change no longer shows the reason typed with it. See _Return amounts and reasons leave the platform audit log_ in the upgrade guide.

- 1c3366d: Thirteen `returns` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish (issue #625, part of #86). **A caller that matches on
  `VALIDATION_FAILED`, or on the reason in `details.code`, now sees the specific code.** The HTTP
  status is unchanged. Until now the buyer and the operator read the thrower's English sentence
  whatever language they asked for, because the error envelope never replaces the message of
  `VALIDATION_FAILED`.

  | Route                                                                              | Was                                                                                                      | Is                                           | `details`                                                                    |
  | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
  | `POST /api/v1/returns`                                                             | `422 VALIDATION_FAILED`, `details.code` `order_not_completing`                                           | `422 RETURN_ORDER_NOT_ELIGIBLE`              | `orderId`                                                                    |
  | `POST /api/v1/returns`                                                             | `422 VALIDATION_FAILED`, `details.code` `qty_exceeds_returnable`                                         | `422 RETURN_QUANTITY_EXCEEDS_RETURNABLE`     | `orderItemId`, `requested`, `remaining`                                      |
  | `POST /api/v1/returns`, a reason that exists but is switched off                   | `422 VALIDATION_FAILED`, `details.code` `unknown_reason`                                                 | `422 RETURN_REASON_INACTIVE`                 | `reasonId`                                                                   |
  | `POST /api/v1/returns/:id/comments`, `POST /api/v1/admin/returns/:id/comments`     | `409 VALIDATION_FAILED`, `details.code` `case_terminal`                                                  | `409 RETURN_COMMENTS_CLOSED`                 | `returnCaseId`, `statusCode`                                                 |
  | `POST /api/v1/returns/:id/select-delivery-method`, a finished case                 | `409 VALIDATION_FAILED`, `details.code` `case_terminal`                                                  | `409 RETURN_CASE_CLOSED`                     | `returnCaseId`, `statusCode`                                                 |
  | `POST /api/v1/returns/:id/select-delivery-method`, a method not offered            | `422 VALIDATION_FAILED`, `details.code` `method_not_allowed`                                             | `422 RETURN_DELIVERY_METHOD_UNAVAILABLE`     | `returnDeliveryMethodId`                                                     |
  | `POST /api/v1/admin/returns/:id/settlement`                                        | `409 VALIDATION_FAILED`, `details.code` `settlement_in_progress`                                         | `409 RETURN_SETTLEMENT_IN_PROGRESS`          | `orderId`                                                                    |
  | `POST /api/v1/admin/returns/:id/settlement`, a line                                | `422 VALIDATION_FAILED`, `details.code` `refund_exceeds_paid`                                            | `422 RETURN_REFUND_EXCEEDS_PAID`             | `returnCaseItemId`, `requested`, `maximum` (two-decimal strings), `currency` |
  | `POST /api/v1/admin/returns/:id/settlement`, the delivery or the payment surcharge | `422 VALIDATION_FAILED`, `details.code` `refund_exceeds_paid`                                            | `422 RETURN_REFUND_EXCEEDS_PAID`             | `code: 'delivery'` or `'surcharge'`, `requested`, `maximum`, `currency`      |
  | `POST /api/v1/admin/returns/:id/settlement`                                        | `502 VALIDATION_FAILED`, message = the gateway's `failureReason`, `details.code` `gateway_refund_failed` | `502 RETURN_REFUND_GATEWAY_FAILED`           | `settlementState`, `failureReason`, `providerDetails`                        |
  | `POST /api/v1/admin/returns/statuses`                                              | `409 VALIDATION_FAILED`, _Status "X" already exists._                                                    | `409 RETURN_STATUS_CODE_TAKEN`               | `statusCode`                                                                 |
  | `PATCH /api/v1/admin/returns/statuses/:code`                                       | `409 VALIDATION_FAILED`, _Cannot mark "X" terminal while it has outgoing transitions._                   | `409 RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'mark_terminal'`, `statusCode`, `outgoingCount`                       |
  | `PUT /api/v1/admin/returns/transitions`                                            | `422 VALIDATION_FAILED`, _Terminal status "X" cannot have outgoing transitions._                         | `422 RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'add_transition'`, `statusCode`, `toStatusCode`                       |
  | `DELETE /api/v1/admin/returns/statuses/:code`                                      | `409 VALIDATION_FAILED`, _The initial status cannot be deleted._                                         | `409 RETURN_STATUS_NOT_DELETABLE`            | `code: 'initial'`, `statusCode`                                              |
  | `DELETE /api/v1/admin/returns/statuses/:code`                                      | `409 VALIDATION_FAILED`, _Cannot delete status "X" while N case(s) use it._                              | `409 RETURN_STATUS_IN_USE`                   | `statusCode`, `caseCount`                                                    |

  The status code travels as `details.statusCode`, because `details.code` is the slot for a
  refusal's token. The gateway's own words are `details.failureReason` and never the sentence. An
  unknown order line or return line, a reason id that names nothing (`unknown_reason`), a missing
  refund payment method, a blank rejection reason and a transition naming a status that does not
  exist stay `VALIDATION_FAILED`. The thirteen codes are members of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `returns` manifest, and the module's documentation
  page lists them. No setting, permission or migration changes.

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
- fc4585c: The return detail screen's **Reject** action asks for the rejection reason in a dialog instead of
  the browser's `window.prompt()` (issue #311). The reason is a required, multi-line field: an empty
  or whitespace-only reason, or one over 2000 characters, is refused in the dialog before anything is
  sent, and the reason is sent trimmed. **Reject** is destructive and shows a busy state while the
  request runs; an error from the server is shown in the dialog with the reason kept. Cancel and
  Escape close the dialog and return focus to **Reject**. Every string is in the `returns` bundle in
  English and Polish. No API change.
- 4efb051: The module page lists the attachment route and documents that a consumer withdrawal is judged at the order's placement, also after a personal organization becomes a company. Documentation only.
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

## 0.110.0

### Minor Changes

- ed5cf6a: Returns and complaints follow the buyer's organization role (`specs/170-organization-roles/` FR-052 – FR-054, owner ruling OR-11, research R-41). The manifest declares two organization permissions, labelled in English and Polish: `returns.create` ("Create returns and complaints", member-default) and `returns.view_organization` ("View the organization's returns and complaints", not member-default); _Administrator_ holds both. `organizations` joins `dependencies` (it is `nonDeactivatable`, so no operator control is lost).

  Behaviour on the buyer routes:

  - `POST /api/v1/returns` is gated by `organizationPermissionPreHandler(…, 'returns.create')` after `requireCustomer`: a role without it is refused `403 ORGANIZATION_PERMISSION_REQUIRED` before the order is read.
  - `GET /api/v1/orders/:orderId/returnable` and `POST /api/v1/returns` judge the order through `orderReadPort.findByIdForCustomer` instead of comparing the order's placer with the caller: a member holding `orders.view_organization` (or _Administrator_) may start a return from a colleague's order, filed in the starter's name; an order out of reach is still `404`.
  - `GET /api/v1/returns` and `GET /api/v1/returns/:id` widen for a holder of `returns.view_organization` to every case of the Organization (its subtree for a roll-up login); anyone else keeps the cases they filed. The case summary and the operator's row carry `customerAccountId`.
  - Comments, attachments, the delivery-method choice and cancelling stay the filer's (`404` to anyone else) and need no code.

  _Member_ keeps exactly its former reach. An administrator's reach widens on upgrade (owner's answer to Q-R3).

  Shape changes: `ReturnsModuleOptions` gains the required `orderReadPort: OrderReadPort` and `organizationPermissions: OrganizationPermissionPort`; `ReturnCaseServiceDeps` gains the required `orderRead` and `scope: ReturnCaseScope`; `ReturnCaseService.getReturnable`, `.createCase`, `.listForCustomer` and `.getForCustomer` take a `ReturnCustomerContext` (`{ customerAccountId, organizationId, organizationRoleId? }`) where they took a `customerAccountId: string`.

- 6bd2ab7: Issue #876 — a consumer's withdrawal from the whole order refunds the delivery cost and the payment surcharge (Directive 2011/83/EU art. 13(1), Polish Consumer Rights Act art. 32 ust. 1; owner rulings E1–E3 of 2026-11-07). The case that brings back the last unit of a B2C order (its organization `isPersonal`, read through `organizationDetailsPort`) refunds both, besides the goods, when it is a `return` settled with a refund or a credit. A partial case, a complaint, a replacement or repair, and a business customer's return refund neither, and an order with a line not returnable at purchase is never withdrawn in full.

  - Each charge is capped at what was paid for it less what earlier cases refunded. The default is the cap when the case was opened within 14 days of the order's completion or within the channel's longer `returns.free_return_days`, and 0 outside it. A channel set to `0` keeps the 14 days.
  - The settlement takes `deliveryRefundAmount` / `surchargeRefundAmount`. An omitted one settles at the default recomputed under the order's lock. A present one settles exactly as sent, `0` included, when it is within the cap (art. 13(2), a premium delivery). One above the cap is refused `422 refund_exceeds_paid` with nothing written. This deliberately differs from the line amounts, where an amount equal to a default means the default approved. A replacement or a repair has a cap of 0. The admin form sends only an amount the operator edited. The prefill reports `charges` (on a settled case `cap` equals `approved`), the case detail `chargeRefunds`, and the `return.settled` audit entry `charges: { delivery: { cap, approved }, surcharge: { cap, approved } }`.
  - `totalRefundAmount`, the gateway refund, the credit top-up and the corrective invoice's `total` include the charges, and the correction names them (`CorrectiveInvoiceInput.charges`).
  - `returnRefundReadPort.listRefundedCharges` reports what settled returns refunded of each charge.
  - The admin settlement form shows a _Delivery cost_ and a _Payment surcharge_ row when there is something to refund (strings in `mod-i18n`, EN and PL).
  - `Migration20261108T125405ReturnsCaseChargeRefunds` adds `default_delivery_refund`, `approved_delivery_refund`, `default_surcharge_refund` and `approved_surcharge_refund` to `return_cases`, `0.00` by default, with no backfill.

  **Behaviour change on upgrade.** A B2C return that completes a withdrawal now refunds more than the sum of its lines: the settlement form prefills the delivery and the surcharge, and an API client that settles without the two new fields refunds them. Cases settled before the upgrade are not changed and nothing is refunded retroactively (owner ruling E4). To list B2C orders already returned in full whose delivery or surcharge was not refunded, use the query in _A consumer's withdrawal refunds the delivery and the surcharge_ in the upgrade guide. The window that decides the default is counted as the withdrawal period is (#905): from the order's completion, in calendar days of `returns.time_zone`, with a last day on a weekend moved to the Monday.

- 71a7a6a: The free-return window counts calendar days in a new setting, `returns.time_zone` (#905). The setting is an IANA zone name (default `Europe/Warsaw`), can be set per sales channel, and refuses a zone the runtime does not know with `422 VALIDATION_FAILED`. The window now ends at the end of its last day in that zone, and a last day on a Saturday or Sunday moves to the following Monday. It used to end exactly `free_return_days × 24 h` after the anchor, so a case can now be free-return eligible up to a day (or, over a weekend, up to three days) later than before, never earlier. The anchor is the order's completion (`orders.completed_at`, through `OrderReturnContextPort`), no longer its last edit. A new pure module, `domain/withdrawal-period.ts`, derives the consumer's statutory withdrawal period from that anchor: 14 calendar days, the same weekend roll, and a 7-day grace before the withdrawal function closes. An order that has not been completed has not started its period. Nothing reads it yet besides the free-return window; the withdrawal function and its stored in-period flag come in later releases. `isWithinFreeWindow` takes the time zone as a fourth argument.
- 5ff8302: A consumer's withdrawal settles as a refund unless the consumer's consent to another resolution is on record (#905). A `return` filed by a personal Organization while the withdrawal is still possible for the order (the statutory 14 days, the channel's longer free-return window, or the 7-day grace after them) is classified as a consumer withdrawal when it is filed, read through `organizationDetailsPort`; the case detail reports `consumerWithdrawal`. Such a case can no longer be settled as credit, a replacement or a repair until an operator records the consumer's consent to that resolution: the settlement answers `422 RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED` with `details.resolution`. `POST /api/v1/admin/returns/:id/alternative-consent` (`returns:write`) records the consent (resolution, when, and an evidence note) and `DELETE` on the same path revokes it; both are Commands, audited as `return_case.alternative_consent.record` and `.revoke` without the note's text, and both answer `409` (`consent_frozen`) once the case is settled, or `409` (`case_closed`) while it sits in a terminal status of the configured workflow (rejected, cancelled, or one an operator marked terminal), writing nothing. The settlement prefill proposes a refund to the order's own payment method; a refund to another method is accepted and its `return.settled` audit entry records `refundMethodDiffers`. Company returns and complaints are unchanged, and cases filed before this release stay unclassified (`null`) and settle as before. A new migration adds the consumer-withdrawal columns to `return_cases` and creates `return_withdrawal_statements`, which nothing writes yet. The `returns.free_return_days` description now cites Directive 2011/83 art. 9 for the 14 days instead of Directive (EU) 2023/2673. In the admin, the case detail of a consumer withdrawal carries a warning badge and a Consumer withdrawal panel that records, changes or revokes the consent (revoking asks first, because it deletes the evidence note); the settlement form lists the resolutions as radios, marks those that need consent, and offers the refund payment method by name, falling back to the method's id when the payment-method list cannot be read.
- 32b4d0c: **The content of an invoice issued after a return changes** (issue #435). An invoice or proforma issued once a return has been settled, while the order has no invoice yet, now lists only what the buyer kept: each order line is invoiced at its ordered quantity less the quantity of the order's settled `return`-kind cases resolved with a refund or a credit — whether or not the money has been paid out — and a line returned in full is left off. The discount line carries only the kept goods' share: the order's `discountTotal` less the discount those cases carried back with their refunds (as recorded at settlement), left off when nothing remains. Before, every order line and the whole discount were invoiced, so the amount due included goods the buyer had returned. Replacement, repair and complaint cases change no line; the delivery and payment-surcharge lines, the per-rate VAT on the sum of the nets and `paidTotal` (captured − refunded) are unchanged; an invoice for an order refunded in full is still refused with `422 INVOICE_ORDER_REFUNDED` (a proforma is not). With `returns` switched off, every line is invoiced as before. Invoices already issued are not touched.

  **A default return refund can differ by one cent from before.** For an order placed under the per-rate VAT method, the default refund of a case is now the drop in the value of the goods kept — what was left paid less VAT per rate on the nets kept after the case, net of the discount the kept part carries — instead of the value of the returned units on their own, so the kept-lines invoice equals what is left paid to the cent. Example: 3 × 10.01 at 23 % (36.94) refunds 12.32 for one unit, not 12.31. All of an order's returns together still refund exactly what was paid, and a cent an earlier case refunded under the previous rule is absorbed by the next case on the same order. Orders placed before 0.108.0 keep their rule. This is not a breaking change.

  `ReturnRefundReadPort` (`returnRefundReadPort`, owned by `@endora-commerce/mod-returns`) gains `listReturnedQuantities(orderId)`, returning the new `OrderReturnedQuantity` (`{ orderItemId, quantity, discount }`) from `@endora-commerce/contracts`. The change is additive for a consumer of the port; an implementation of `ReturnRefundReadPort` outside `@endora-commerce/mod-returns` adds the method.

  An invoice for an order **returned in full** before it was invoiced — every product line back through settled returns and no delivery or payment surcharge kept — is refused with the existing `422 INVOICE_ORDER_REFUNDED`, whatever the state of the refund (issued, waiting for a person, or waiting for the gateway's webhook); a proforma is not refused. The error carries `details.reason` (`refunded_in_full` or `returned_in_full`), its message (`errors.INVOICE_ORDER_REFUNDED`) now covers both causes, and automatic issuance skips such an order and logs the cause. When the delivery or the surcharge is kept, the invoice lists only that line.

  Issuing an invoice now holds the order's returns lock, the one `@endora-commerce/mod-returns` takes to create and to settle a case, so an invoice is never drawn from a return being settled; it waits, and answers `409 VERSION_CONFLICT` (`details.code: settlement_in_progress`), retryable, after 15 s. The key is the new `returnCaseOrderLockKey(orderId)` in `@endora-commerce/contracts`. A return line whose default refund is 0.00 because its discount share takes its whole value now carries that discount back, so the invoice's discount line no longer keeps it. None of this is breaking. `@endora-commerce/mod-i18n` adds the sentence for `errors.VERSION_CONFLICT.settlement_in_progress` in English and Polish.

- 7ce9b8a: **Behaviour change for API clients** — the saved views of the admin Returns list follow the rules
  of the order, product and quote request lists' saved views (#312), and the Returns list gains the
  _Saved views_ control.

  `GET`/`POST /api/v1/admin/returns/list-views` and `PATCH`/`DELETE /api/v1/admin/returns/list-views/:id`
  stay gated by `returns:read`, and change as follows:

  - **`PATCH` and `DELETE` with an id that is not a UUID answer `404 NOT_FOUND`** (was `500 INTERNAL`).
  - **Another admin's private view answers `404 NOT_FOUND`** on `PATCH` and `DELETE` (was `403 FORBIDDEN`),
    so a view the caller may not see is indistinguishable from one that does not exist.
  - **A shared view can be changed or deleted by its owner or by a platform admin** — an admin whose
    access is not restricted to a set of organizations. Anyone else gets `403 FORBIDDEN` (before, only
    the owner could).
  - **Names are stricter**: trimmed before they are stored, 1–160 characters (was 1–200, untrimmed, so
    `"   "` was accepted), and without control or format characters; a name breaking these answers
    `400 VALIDATION_FAILED`.
  - **New `409 RETURN_SAVED_VIEW_NAME_TAKEN`** on `POST`, and on a `PATCH` that changes the name, when the
    view's owner already holds a view on the return list whose name differs only by letter case or
    surrounding spaces. The message is translated (English and Polish). Two admins may each use a name.
  - **Size caps** — `filters` at most 8 KB of JSON (UTF-8), `visibleColumns` at most 64 entries of at
    most 64 characters, `sort.field` at most 64 characters; over a cap answers `400 VALIDATION_FAILED`.
  - **`shared` is required on `POST`** (was optional, defaulting to `false`), as on the other lists;
    `sort` stays required.
  - **List items and write answers carry `ownerAdminUserId`, `ownedByCaller` and `canModify`**, and the
    list is ordered by name (was by creation time).
  - **`DELETE` answers `{ "data": { "deleted": "<id>" } }`** (was `{ "data": { "ok": true } }`).

  Views saved before this release are kept exactly as stored — a blank name, a name over 160
  characters or two names of one owner sharing a key included. No migration rewrites them: they are
  listed as they are, a `PATCH` that leaves the name alone is never refused for it, and renaming one
  must meet the rules above.

  `@endora-commerce/contracts`: `returnSavedViewSortSchema`, `returnSavedViewSchema`,
  `ReturnSavedViewDto`, `returnSavedViewCreateSchema` and `returnSavedViewUpdateSchema` are removed.
  Use `createReturnSavedViewRequestSchema` and `updateReturnSavedViewRequestSchema` (with the types
  `CreateReturnSavedViewRequest` and `UpdateReturnSavedViewRequest`) for the requests, and the shared
  `savedListViewSchema` / `SavedListView` for a view. `ERROR_CODES.RETURN_SAVED_VIEW_NAME_TAKEN` is new.

### Patch Changes

- 45c9893: The organization role form, on the storefront and in the admin Roles tab, heads the Addresses, Carts, Orders, Quote Requests and Returns permission groups in the reader's language. The five modules now ship `module.name` in English and Polish ("Adresy", "Koszyki", "Zamówienia", "Zapytania ofertowe", "Zwroty"); before this, Polish pages showed the English manifest name.
- 75b053f: A customer record read by an id that is not a UUID answers `404` with the route's own not-found code, exactly as a well-formed id that names nothing does, instead of `500` (issue #753). This covers `GET /api/v1/orders/:id` (`ORDER_NOT_FOUND`), `GET /api/v1/returns/:id`, `GET /api/v1/quote-requests/:id`, `GET /api/v1/shopping-lists/:id` and `GET /api/v1/organization/carts/:id` (`NOT_FOUND`), and every other route that reads its record through the same lookup.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- ead3ee3: The default refund of a return is now recomputed at settlement, from the cases already settled
  (issue #875). The kept state is the return cases settled with a refund or a credit: a case that was
  rejected, replaced or repaired takes nothing off it, and a complaint never enters it (issue #874).
  A complaint settled with money is a price reduction of goods the buyer keeps, so it counts only
  against what is left paid for the order and against the line it names. A case settled out of the
  order it was opened in, or after an earlier case was rejected, therefore refunds what leaves the
  kept-lines invoice and the corrected invoice equal to what is left paid, to the cent.

  The figure an open case shows is provisional until settlement and may move by a cent or two. The
  settlement prefill previews the recomputed figure. An approved amount equal to a default the case
  showed settles at the recomputed default; a lower amount is kept as typed; a higher one is refused
  with `422 VALIDATION_FAILED` (`refund_exceeds_paid`) and nothing written.

  No order line refunds more than it was paid. A complaint and the returns of its line are bounded
  by the line's value, and only the unabsorbed part of the complaint money lowers what is left paid
  for the order. A return after a complaint gets its full default until that bound binds; the figure
  shown when the case is opened is already bounded. The operator lowers the amount by hand
  when the unit the complaint compensated is the one coming back. The
  stored default stays the value of the goods that came back. The `return.settled` audit entry
  records `recomputedDefaults` and `lineCeilings` when either applies.

  `ReturnSettlementService` takes `orderContext` (`OrderReturnContextPort`) in its dependencies;
  `returnsModule` wires it from the options it already receives. A settlement whose order cannot be
  read is refused with `404 NOT_FOUND` before anything happens; a switched-off `orders` still answers
  `503 MODULE_DISABLED`.

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
  - @endora-commerce/email-components@0.110.0

## 0.109.0

### Patch Changes

- c73366c: The command-palette actions of `credentials`, `orders`, `organizations`, `quick_order` and `returns` keep only English `keywords` in their manifests; their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #560). A Polish operator finds the same screens by the same words. The template-variable samples `order.shippingAddressText` (`order_confirmation`) and `statusLabel` (`new_org_registration`) are English in the manifest and carry their Polish form under a `sampleValueKey`.
- 5114576: An invoice's `paidTotal` deducts every refund made before it was issued, each once: what `payments` recorded, plus the issued refunds of the order's settled returns that never pass through `payments` — a credit-limit top-up, and a money refund of an order not paid through a gateway — and an order an operator marked `refunded` counts as refunded everything received — its total with nothing captured, what was captured otherwise — taken as the larger of the recorded refunds and what was received, never their sum. An order refunded in full that way is not invoiced (`422 INVOICE_ORDER_REFUNDED`). `@endora-commerce/mod-returns` publishes the new `returnRefundReadPort` (`ReturnRefundReadPort`, `OrderReturnRefund` in `@endora-commerce/contracts`), which `@endora-commerce/mod-invoices` reads as a `degrades-without` dependency.

  `InvoiceDetail.amountDue` is now `max(0, grossTotal − paidTotal)` and never negative, and the new required `InvoiceDetail.overpayment` is `max(0, paidTotal − grossTotal)`. The invoice PDF's totals block prints it as _Nadpłata_ (`showOverpayment`, `labelOverpayment`), the admin invoice screen as _Overpayment_, and `{{var invoice.overpayment}}` is a new merge field. A consumer that built an `InvoiceDetail` by hand adds the field.

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
  - @endora-commerce/email-components@0.109.0

## 0.108.0

### Minor Changes

- 0bd5a2b: Returns honour the per-line returnable flag recorded at purchase; complaints stay unrestricted.

  - **Behaviour change for API clients.** `GET /api/v1/orders/:orderId/returnable` gives each line `returnable` and, when it may not be returned, `notReturnableReason: 'product_not_returnable'`. **`eligible: false` with the new reason `no_returnable_lines` still allows a complaint** — `eligible` answers for `return`-kind cases only.
  - `POST /api/v1/returns` with `kind: 'return'` naming a line recorded as not returnable is refused with `422 RETURN_LINE_NOT_RETURNABLE` (`details.productName`, `orderItemIds[]`, `lines[]`). Complaints are never restricted.
  - **Behaviour change — a complaint on a non-returnable line refunds nothing by default.** A `complaint` line recorded as not returnable at purchase is stored with `approvedRefundAmount` `0`; its `defaultRefundAmount` stays the amount paid (the settlement cap). The admin settlement form now pre-fills each line from its stored approved amount rather than from the amount paid, and the case view marks such a line **Not returnable at purchase** (`mod-i18n` `core` key `returns.detail.notReturnableAtPurchase`, English and Polish). The case detail's items carry `returnableAtPurchase`, read through `OrderReturnContextPort`.
  - **Duplicate order lines in one request are summed** per order line, for both kinds, and checked against the remaining quantity (`qty_exceeds_returnable`). An unknown line is reported before any quantity error.
  - Lines of orders placed before this release carry no recorded value and count as returnable. **FR-034: products default to not returnable, so lines of orders placed after the upgrade are not returnable until their products are marked** in the catalogue (Bulk edit → Returnable); orders placed before the upgrade are unaffected.
  - New bundle sentence `errors.RETURN_LINE_NOT_RETURNABLE` in English and Polish.

- 357a13d: A return's default refunds are cumulative over the order's live cases (issue #417, review of PR #423). For each group of what the order charged — a VAT rate of an order placed under the per-rate method, a line of an order placed before it — a case refunds the group's amount for everything returned so far, this case included, minus what earlier returns already refunded in it; capped at what remains of the order's stored products total. No sequence of returns refunds more than was paid (two returns of 1 × 1.07 at 23 % refund 1.32 + 1.31 = 2.63, not 2.64), and a return that completes the order refunds exactly what it charged. Only returnable lines enter the rule; a non-returnable complaint line gets its own amount as the cap an operator may approve up to. What was paid is read from the order's stored figures (`OrderReturnContext.vatMethod`, `productsPaidTotal`, each line's stored `lineTotal`), never recomputed. `defaultRefunds` is replaced by `caseDefaultRefunds`.
- cabb2a0: Return refunds account for the order-level discount, include complaints, and are created one at a time per order (issue #417, review of PR #423).

  - **The discount**: an order takes its discount off the gross, so a return refunds the goods less the share of the discount they carried — shared over the order's rate groups (lines, for an order placed before 0.108.0) by their amounts, and carried in proportion to what came back. A full return of an order that captured 83.00 for 100.00 net + 23.00 VAT − 50.00 discount + 10.00 delivery refunds 73.00, where it refunded 123.00. Each line records the discount its default refund carries (new column `return_case_items.default_discount_amount`, migration `Migration20261024T174052ReturnsCaseItemDiscount`, default 0), and the settlement passes it to the correction in proportion to the amount approved (new `carriedDiscount`).
  - **Complaints**: a complaint on a line that was not returnable enters the same cumulative accounting and the same cap, so a return and a complaint can no longer refund more than was paid (0.08 against 0.07). `caseDefaultRefunds` answers `{ refund, discount }` per line and takes the order's `discountTotal`.
  - **The target**: a case that completes the order — every unit of every line back, returned or complained about — refunds exactly what remains of the stored products total (subtotal + tax − discount); for an order placed before 0.108.0 that may be a cent off the sum of its stored line totals, and the money charged decides. The correction credits exactly that refund.
  - **Concurrency**: creating a case takes a transaction-scoped advisory lock keyed by the order and reads the order's earlier cases once, inside that transaction, so two cases created at once no longer both see none (three simultaneous returns of the last unit created three cases).

- a4a677b: A return case's default refunds follow the one VAT method (owner ruling of 2026-10-24, issue #417; new `defaultRefunds`): the returned nets — net unit price × returned quantity — with VAT per rate on their sum, rounded once, and each line its net plus its share. A full return refunds exactly what the invoice charged for those lines (9.05 × 3 at 8 % is 29.32, where the paid unit gross × 3 was 29.31); a partial return applies the same rule to the returned quantity. `defaultRefundForQuantity` is removed.

### Patch Changes

- 7a9678c: Refund amounts are computed in exact decimal arithmetic (issue #417). An approved amount is rounded half-up on its decimal digits (new `approvedAmount`) before it is capped, summed and stored: a typed 1.005 was the refund 1.00. `exceedsCap` compares the amount at the two places it would be stored at, so 100.005 against a 100.00 cap is refused, where the half-cent tolerance on doubles let it through; `defaultRefundForQuantity` and `sumApproved` are exact. A return delivery method's `returnCost` is stored half-up.
- cb35881: A settlement refunds and corrects one set of lines, and the settlements of one order run one at a time (issue #417, review of PR #423).

  - **`@endora-commerce/mod-returns`**: the settlement's total covers every line of the case — a line the request leaves out counts at its stored `approvedRefundAmount`, as the correction already did — so a request naming one of two discounted lines no longer refunds 113.00 while its correction credits 246.00 of goods (46.00 VAT) less 20.00 of discount. A settlement takes the same per-order advisory lock as case creation, on a connection of its own, so two cases of one order settled at once no longer both read the same earlier corrections (2 × 0.03 at 23 % credited 0.02 VAT of the 0.01 invoiced). One that waits more than 15 seconds answers `409` (`details.code: settlement_in_progress`) with nothing moved.
  - **`@endora-commerce/mod-invoices`**: `correctionAmounts` credits the goods at `amount + discount` and the discount back only when the correction credits exactly what its lines add up to; any other total is credited as goods in line order, with no discount line.

- a4cd906: A correction that cannot be made never follows money that moved (issue #417, review of PR #423).

  - `CorrectiveInvoicePort` gains `validateCorrection(input)` (`@endora-commerce/contracts`): it refuses, writing nothing, what `createCorrection` would refuse for the same input. `invoices` implements both from one preparation step.
  - The returns settlement builds its correction once and validates it **before** the refund or the credit top-up; a refusal leaves the case in `received` with nothing moved. With `invoices` switched off, a settlement asking for a correction is refused before the credit, where it used to credit first and refuse after.
  - A cancelled correction no longer counts against the cap or the cumulative nets of later corrections.

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
  - @endora-commerce/email-components@0.108.0

## 0.107.0

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
  - @endora-commerce/email-components@0.106.0

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
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/email-components@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/email-components@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- 9b170e8: **Admin aggregates are narrowed to the organizations the administrator reaches.** The analytics
  summary, and the "in use" count shown beside each order status and each return status, are
  computed over organization-scoped data. They are now confined to the reader the way the lists
  beside them already are, so an administrator whose authority is a set of organizations — a sales
  representative — sees figures for those organizations only.
  - A platform administrator sees what they saw before.
  - An administrator confined to a set of organizations sees figures for those organizations, and
    one with no organization assigned sees none.
  - Analytics events that belong to no organization — anonymous storefront traffic — are counted
    for a platform administrator and are not visible to an administrator confined to a set of
    organizations.

  Upgrade to pick the change up; nothing in an instance has to be edited.

  `AnalyticsQueryService.summary` takes an optional second argument, the organization constraint to
  apply; it defaults to the one the ambient tenant context implies.

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
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
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

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/email-components@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/email-components@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.9.7

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

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.9.5

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
  - @endora-commerce/platform@0.13.1

## 0.9.4

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

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.9.1

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

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

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

- 686cd9d: Removed `ReturnsBridge` from `@endora-commerce/mod-returns/backend`, and with it every
  name a composition root had to contribute for this module.

  The bridge carried eight members and none of them was a composition's answer to give.
  `orderContext`, `paymentRefund`, `correctiveInvoice` and `creditTopup` were forwarders
  onto `orderReturnContextPort`, `paymentRefundPort`, `correctiveInvoicePort` and
  `creditTopupPort`; the module resolves those four itself now, with `lazyPort`, and
  declares each edge in its manifest — `orders` and `customer_accounts` in `dependencies`,
  and `payments`, `invoices` and `credit_limits` as `refuses-without`
  `nonBindingDependencies`, because settling a return is a choice among resolutions and
  switching one owner off must stop that resolution rather than the module.
  `resolveCustomerEmail` is `customer_accounts`' published `customerAccountReadPort`,
  `resolveChannelLanguage` is a read of the platform's own `SalesChannel`, and
  `resolveCustomerAccountId` / `resolveAdminUserId` are the platform's own
  `customerAccountIdResolver` and `adminContextResolver` under a second pair of names.

  **If you contributed `returnsBridge`**, delete the contribution: the container name is
  read by nobody and registering it now does nothing. There is no replacement to write.
  Make sure the composition registers `customerAccountIdResolver` and
  `adminContextResolver` — `@endora-commerce/platform`'s `composeApp` contributes both, so
  a platform-composed deployment already has them.

  `ReturnCommentNotifier` and `ReturnCommentServiceDeps.notifier` are removed in the same
  change. The optional notifier was declared, guarded and supplied by nobody — `plugin.ts`
  builds `ReturnCommentService` with `emFactory` and `graphService` and no third member —
  so its body was unreachable. Sending on a customer-visible comment is a product decision
  that has not been taken; when it is, it takes a notifier a composition really supplies.

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

## 0.7.0

### Minor Changes

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

- 661e80d: Fourteen new packages: the **second** batch of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time, then ten together; these fourteen are the
  same shape as the ten, and the properties below hold fourteen times over.

  **One changeset, not fourteen**, for the reason batch one gives: a changeset is written for
  the consumer of a package, and a package that did not exist a moment ago has no upgrader to
  instruct. What genuinely differs per package is its layer inventory, and that is the table.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                     | Subpaths                         | Entities                                                                                                                                                                                                                                                                                                                                       | Migrations | Ships          |
  | ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-admin-notifications`  | `.`, `./backend`, `./migrations` | `AdminNotificationRead`, `AdminNotification`                                                                                                                                                                                                                                                                                                   | 1          | `dist`         |
  | `@endora-commerce/mod-api-keys`             | `.`, `./backend`, `./migrations` | `ApiKey`                                                                                                                                                                                                                                                                                                                                       | 1          | `dist`         |
  | `@endora-commerce/mod-linkedin-ads`         | `.`, `./backend`, `./migrations` | `LinkedInConversionMapping`                                                                                                                                                                                                                                                                                                                    | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-sales-channels`       | `.`, `./backend`                 | —                                                                                                                                                                                                                                                                                                                                              | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shopping-lists`       | `.`, `./backend`, `./migrations` | `ShoppingListItem`, `ShoppingList`                                                                                                                                                                                                                                                                                                             | 2          | `dist`         |
  | `@endora-commerce/mod-delivery-methods`     | `.`, `./backend`, `./migrations` | `DeliveryMethod`                                                                                                                                                                                                                                                                                                                               | 2          | `dist`         |
  | `@endora-commerce/mod-prompt-actions`       | `.`, `./backend`, `./migrations` | `PromptActionRequest`                                                                                                                                                                                                                                                                                                                          | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-mfa`                  | `.`, `./backend`, `./migrations` | `MfaEnrolment`, `MfaOrganizationPolicy`, `MfaRecoveryCode`, `MfaSocialIdentity`                                                                                                                                                                                                                                                                | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-webhooks`             | `.`, `./backend`, `./migrations` | `WebhookDelivery`, `Webhook`                                                                                                                                                                                                                                                                                                                   | 3          | `dist`         |
  | `@endora-commerce/mod-transactional-emails` | `.`, `./backend`, `./migrations` | `EmailBlockSalesChannel`, `EmailBlock`, `EmailTemplateSalesChannel`, `EmailTemplate`, `TransactionalEmailContent`, `TransactionalEmail`                                                                                                                                                                                                        | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-cms`                  | `.`, `./backend`, `./migrations` | `CmsBlock`, `CmsHookBlockAttachment`, `CmsHook`, `CmsPage`, `CmsTemplate`                                                                                                                                                                                                                                                                      | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-pwa`                  | `.`, `./backend`, `./migrations` | `PushMessageDelivery`, `PushMessage`, `PushSubscription`, `PwaIconRendition`                                                                                                                                                                                                                                                                   | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-newsletter`           | `.`, `./backend`, `./migrations` | `NewsletterAutomationRun`, `NewsletterAutomation`, `NewsletterCampaignSubscriber`, `NewsletterCampaign`, `NewsletterCustomField`, `NewsletterEmailBlockSalesChannel`, `NewsletterEmailBlock`, `NewsletterEngagementEvent`, `NewsletterSendRecord`, `NewsletterSubscriberTag`, `NewsletterSubscriber`, `NewsletterSuppression`, `NewsletterTag` | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-returns`              | `.`, `./backend`, `./migrations` | `Refund`, `ReturnCaseAttachment`, `ReturnCaseComment`, `ReturnCaseItem`, `ReturnCase`, `ReturnDeliveryMethod`, `ReturnListSavedView`, `ReturnReason`, `ReturnShipment`, `ReturnStatusTransition`, `ReturnStatus`                                                                                                                               | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168) — type-only exports included, which this batch measured rather than assumed:
  two packages published their entities' row types so the dev seed could name them, and
  `module-package-entity-surface.test.ts` refused both, in as many words — _"that is the one
  thing that makes a foreign module's `import type { … }` compile"_. The exports are gone and
  the seed takes each class off the published array by name.

  **One of the fourteen owns no table and says so with an empty array rather than by
  omission.** `@endora-commerce/mod-sales-channels` exports `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export
  with `[]`, so "this module has no table" and "somebody forgot the array" would otherwise
  arrive as one silence, whose only symptom is a query against a table nobody created.

  **One package publishes a type on `./backend` that is not an entity**, and it is there
  because a composition root has to name a contribution it supplies:
  `@endora-commerce/mod-shopping-lists` re-exports `ShoppingListService`. A root cannot reach
  a package's internal file — `rootDir` makes a relative specifier into `packages/` TS6059
  even for an `import type` — so a contribution shape has to be on a published subpath or it
  is unnameable.

  **Two packages declare a `@fastify/*` dependency nothing imports.**
  `@endora-commerce/mod-mfa` peers on `@fastify/cookie` and `@endora-commerce/mod-pwa` on
  `@fastify/multipart`, because `reply.setCookie`, `request.isMultipart()` and
  `request.file()` are declaration-merging augmentations rather than imports. Inside the
  application those arrived ambiently through the host's own dependency; a package compiles
  against its own manifest, where an unnamed dependency does not exist. Both write
  `import type {} from '@fastify/…'`, which is type-only: the plugin is still the host's to
  register.

  **`@endora-commerce/mod-newsletter` and `@endora-commerce/mod-pwa` also carry a companion
  `@types/*` in `devDependencies`** — `@types/nodemailer` and `@types/web-push` — which the
  manifest generator now derives. Nothing imports a `@types` package; the compiler finds it
  through `node_modules/@types`, which inside a package is the package's own declaration, so
  a module importing a JS-only library did not build until this landed.

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
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
