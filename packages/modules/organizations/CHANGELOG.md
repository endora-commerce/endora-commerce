# @endora-commerce/mod-organizations

## 0.112.0

### Minor Changes

- 19885e5: Issue #1338: two operator writes on the organization screens now run as Commands on the Command Bus, so each write and its audit entry commit together. Before, the audit entry was written after the change was saved, and a failure in between left a change with no audit entry.

  - Deleting an organization (`DELETE /api/v1/admin/organizations/:id`) runs the `organization.delete` Command. The response, the `404` and the `409 has_children` refusal are unchanged, and so is the entry: the status, VAT status, whether it is personal, the parent by id and the version.
  - Turning a member's roll-up on or off (`PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/rollup`) runs the `customer_account.set_subtree_rollup` Command of `customer_accounts`, which records the flag before and after and names the operator. Each toggle now writes this one entry. The second, hand-written `customer_account.admin_rollup_change` entry is no longer recorded. If you filter the audit log on `customer_account.admin_rollup_change`, filter on `customer_account.set_subtree_rollup` instead. Older entries keep their action.

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

- 074f500: Admin zone contributions now choose a tab or a sidebar by naming the zone for that place (issues #1452 and #1526). Four zones are new: `organization.detail.sales` is the body of the organization's Sales tab, after the sales representatives, and carries `{ organizationId }` with no save session; `order.detail.sidebar`, `quote_request.detail.sidebar` and `opportunity.detail.sidebar` are sidebar cards, and each contribution is a section of the card. The order and quote request screens draw their sidebar only while something fills it. The organization's Sales tab is shown to someone who may assign sales representatives or who sees one of its panels. CRM opportunities and projects moved from the organization's Commerce tab to its Sales tab. The linked opportunity, the project and the tasks moved from the end of the order, quote request and opportunity screens into their sidebars. No zone was removed or renamed: contributions to the `.detail.after` zones keep working unchanged.
- 90320fd: **Breaking:** `PATCH /api/v1/admin/organizations/:id` no longer accepts `status` (issue #1468). A body that carries it is refused with `400 VALIDATION_ERROR` at `status`, and nothing else in that body is written. To change an organization's status, call the moderation endpoints instead: `POST /api/v1/admin/organizations/:id/approve`, `…/reject`, `…/block` or `…/unblock`. They are the only path that checks the allowed transitions, records `approvedAt` / `blockedAt` / `blockedReason`, emits `organization.status_changed.v1` and sends the customer e-mail.

  - Old: `PATCH /api/v1/admin/organizations/:id` with `{ "status": "blocked" }`.
  - New: `POST /api/v1/admin/organizations/:id/block` with `{ "expectedVersion": <version>, "reason": "…" }`.

  In `@endora-commerce/contracts`, `adminPatchOrganizationRequestSchema` refuses `status` with the message in the new `ADMIN_PATCH_ORGANIZATION_STATUS_REFUSAL` export. `vatStatus` is still accepted.

  On the organization screen, the status and VAT status selects are gone, and the page's Save no longer counts or sends either field:

  - The **Moderation** section is the only place the status is shown and changed. Its actions are offered only to operators who hold `customers:manage`.
  - The VAT status is shown in the header. It is changed by the new **Change VAT status…** dialog. The dialog needs `customers:manage`, applies immediately and is audited as `organization.admin_patch`.
  - The remaining section is titled **Contact & notifications**.

  `ModerationActionsPanel` takes a required `canModerate` prop. In the core catalogue, `organizations.detail.accountStatus` and `organizations.detail.statusCard` are removed and `organizations.detail.notificationsCard` is added. A deployment that overrides the removed keys must drop them.

- 4e7afbf: `organization.status_changed.v1` now also carries `previousStatus` and `reason` (issue #1620). `previousStatus` is the status the Organization left. `reason` is the operator's reason for a rejection or a block, and `null` for an approval, an unblock or a block without a reason. Before, a subscriber reacting to a rejection could not read why it happened or which status the Organization had before. The existing fields are unchanged, so subscribers that do not read the new ones need no change.
- 27b977d: Four refusals of `organizations` have error codes of their own instead of `VALIDATION_FAILED`,
  and a sentence in English and Polish filled from `details` (issue #629, part of #86). **Breaking
  change: a client that matches on `VALIDATION_FAILED` for these refusals now receives the new
  code.** Match on the code below, and show the envelope's `message` rather than matching on its
  text. The status stays `422` everywhere.

  | Route                                                                                                            | Was                                                                                                       | Is                                          | `details`                                                                                                                   |
  | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | `POST /api/v1/admin/organizations/:id/members` (personal organization)                                           | `VALIDATION_FAILED`, `A personal (individual) organization cannot have additional members.`               | `ORGANIZATION_PERSONAL`, token `add_member` | `organizationId`, `organizationName`                                                                                        |
  | `POST /api/v1/organizations/mine/invitations` (personal organization)                                            | `VALIDATION_FAILED`, `A personal (individual) account cannot invite members.`                             | `ORGANIZATION_PERSONAL`, token `invite`     | `organizationId`                                                                                                            |
  | `POST /api/v1/admin/organizations/:id/sales-reps` (personal organization)                                        | `VALIDATION_FAILED`, `A sales representative cannot be assigned to a personal (individual) organization.` | `ORGANIZATION_PERSONAL`, token `sales_rep`  | `organizationId`, `organizationName`                                                                                        |
  | `POST /api/v1/admin/organizations/:id/approve`, `/reject`, `/block`, `/unblock` (organization in another status) | `VALIDATION_FAILED`, `Organization is in status '…', cannot perform an action that requires '…'.`         | `ORGANIZATION_STATUS_INVALID`               | `currentStatus`, `requiredStatus` (unchanged), plus `currentStatusLabel` and `requiredStatusLabel` in the reader's language |

  An unknown sales channel id on the admin create stays `VALIDATION_FAILED`. `ORGANIZATION_PERSONAL`
  and `ORGANIZATION_STATUS_INVALID` are new members of `ERROR_CODES` in `@endora-commerce/contracts`,
  declared by the `organizations` manifest. No setting, permission or migration changes.

- bfab5bd: **Breaking:** `GET /api/v1/admin/quote-requests` now answers one page instead of every quote request. The server applies `assignmentScope`, `organizationId`, `status`, `q` (a fragment of the business id, the organization name or the customer's name, or a whole id), `sort` (`updatedAt:desc` by default, `updatedAt:asc`, `total:desc`, `total:asc`) and the page (`page`, default 1; `pageSize`, default 25, at most 200). The `pagination` block is now true for the response: it adds `page`, `pageSize` and `total`, and `limit` and `hasMore` describe the page returned (`nextCursor` stays `null`; ask for the next `page`). An invalid `pageSize`, `page`, `sort`, `assignmentScope` or `organizationId` is refused with 400.

  To migrate, a client that read the whole list from one call must page through it with `page` and `pageSize`, or read `pagination.total` when it only needs the count. The contracts publish the query and the envelope as `adminQuoteRequestListQuerySchema` and `adminQuoteRequestListResponseSchema`.

  `SalesRepAssignmentPort` gains `listOrganizationIdsWithAssignments()`; an implementation of the port outside this repository must add it. The admin Quote Requests list now asks the server for each page, filter and sort, and offers a lowest-total sort. The home page's pending-quotes tile and the project link picker read the paged list.

### Patch Changes

- c878440: Un-awaited Promises found by the typed lint rules now enabled for the whole repository (issue #1027) are awaited, handled or marked as deliberate fire-and-forget. No behaviour changes:

  - `resumeWorkersFor` no longer awaits BullMQ's synchronous `Worker.resume()`; the API interceptor pre-handler is typed as Fastify's async hook.
  - The breakpoint video hook ignores a refused autoplay through `Promise.resolve(video.play()).catch(...)`.
  - Admin screens wrap async form and button handlers in `void` (each handler catches its own errors), and the admin-search matchers of catalog, orders and quote requests are typed as returning `unknown`, because a Knex builder is thenable.

- 2c67b8b: The organization detail screen no longer shows raw catalogue keys or raw codes (issues #1321 and #1322). The order confirmation e-mail field and its hint now have English and Polish text. The account status and VAT status options show translated labels, and so do the status filter and the VAT column of the Organizations list.

  The VAT status labels moved from `convertToCompany.vatStatus.<code>` to `vatStatus.<code>` in the module's bundle, beside the new `status.<code>` labels. A deployment that overrides the old keys must rename them.

- b2ae377: A customer who asks for a password reset on the storefront now receives the reset e-mail (issue #1371). The request minted a reset token and answered 202, but nothing mailed the link, so a customer who forgot the password could not get back into the account. The link opens `/password-reset/confirm` on the storefront of the request's sales channel (its `sales_channels.storefront_url`, else `STOREFRONT_BASE_URL`), under the prefix of the channel language the request resolved to, and the e-mail is written in that language.

  The message is a new transactional e-mail, `customer_password_reset`, with English and Polish default content, editable under **Transactional emails** like every other customer e-mail. It cannot be switched off, because it is how the customer gets back into the account. A plain English message is sent when no template definition exists. The answer stays 202 whether or not an account has the address, and the e-mail is sent after the answer rather than before it, so the response time does not depend on the mail transport. The request throttle is unchanged.

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

- ced3b46: More admin screens follow the DS-03 rule that a frame inside a card is a defect unless it is a field (issue #1437, UX audit 2026-11-17).

  - **Form builder** (`forms`): the _Settings_ and _Notifications_ tabs and the field inspector are built on the kit's `EditorSection`, which draws the rule between groups, in place of a `Separator` between them. A notification channel list, an address field's parts and the published versions are rows divided by a rule, not a bordered box each; a form with no published version says so with the kit's empty state.
  - **Account security** (`mfa`): with two-step verification on, the card holds two titled sections, _Recovery codes_ first and _Switch off two-step verification_ last, so the destructive form sits away from the routine one.
  - **Asset detail** (`assets_library`): the drawer is one card of titled sections — _Links_, _Details_, _File_ (with the previous version inside it) and _Referenced by_ — in place of blocks fenced off by hand-drawn rules.
  - **Order statuses** (`orders`): the new-status form is a titled section (_New status_) of the statuses card, and every field on the page is the kit's `Input` / `Checkbox`.
  - **Tax ID scope** (`organizations`): each scope option is drawn as a choice field — the chosen one marked, keyboard focus ringed.
  - **Page builder section presets** (`cms`): the presets list in the block drawer has no box around it; one rule sets it off from the blocks below.

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

- e9af4f0: The bulk order-status dialog, the order-status delete confirmation, the quote-request cancel dialog, the organization moderation reason dialog and the credential configuration preview are the kit's `ModalDialog` / `ConfirmDialog` instead of hand-drawn overlays (issue #1474, SALES-09; #1444): each is named by its title, holds focus and returns it to the control that opened it, and closes on Escape. The bulk status dialog opens with no status chosen each time and announces a failure inside the dialog; the cancel dialog keeps a typed reason on a stray click on the scrim and shows a refused cancellation inside the dialog; the moderation reason field has a visible label, is marked required for a rejection, and a refusal is announced inside the dialog; the delete confirmation opens on _Cancel_; the credential preview's button reads _Close_.
- 87fb9c3: On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

  A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.

- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
- 7329865: The order, invoice, quote request, organization and customer detail screens and the promotion editor no longer replace the whole page with "Loading…" when they re-read their record after an action (issue #1496, UX audit SALES-06). The first load shows a skeleton of the page; a status change, a payment change, a custom-field save, an approve or cancel, a regenerated PDF or a member change keeps the page, its open tab, the scroll position and the focus on screen and marks the content `aria-busy` while it re-reads. A first load that fails now shows its error and a Retry button instead of "not found", and the promotion editor no longer shows an empty form over a promotion it could not read. On the organization screen a member change refused as stale now keeps its explanation on screen after the re-read. New string: `orderDetail.errors.load` (en, pl).
- 2040ae9: Action results beside the control that caused them, and at most one banner above a detail screen (issue #1499, UX audit SALES-17; owner decision DEC-12 a).

  - `@endora-commerce/admin-kit/components`: `DetailHeaderActions` takes `status` — normally `useInlineStatus().props` — and mounts an always-present polite `InlineStatus` before the header's buttons, so the last header action's result is said there. Given `status`, the group renders even when the record has no action left. `@endora-commerce/admin-kit/ui`: `InlineStatus` gains a `warning` tone (icon and warning colour) for a result that went through only in part.
  - `@endora-commerce/mod-quote-requests`: the quote-request detail no longer stacks up to six banners. Approve, Cancel, the customer's basket, the PDF outcome and a copied number are said beside the header's buttons; a stored revision in the Modify save bar. The cancellation reason leads the header's meta line. Above the tabs there is at most one banner: an error, else the lapsed deadline with its remedy, else the unsaved draft — the last only away from the Modify tab, where the save bar already says "Unsaved changes".
  - `@endora-commerce/mod-orders`: Issue invoice (a warning when the e-mail was not sent), Reorder, Clone to quote and a copied order number are said beside the header's buttons. A status or payment-status change adds no banner: the control announces it and its badge shows it.
  - `@endora-commerce/mod-organizations`: "Saved" and the results of the header's dialogs are said beside the header's buttons, a member write right above the Members section.
  - `@endora-commerce/mod-i18n`: `core`'s `rfq.detail.validity.lapsed.remedyEditable` and `remedyLocked` shortened to one sentence; `orderDetail.messages.orderMoved` and `orderDetail.messages.paymentMoved` removed.

- 45fd8dc: More admin screens show an action's result beside the control that caused it, not as a success banner (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a banner, and an error clears the result.

  - Organization detail, moderation: "Organization approved", "blocked" and the other transitions appear beside the moderation buttons.
  - Organization detail, hierarchy: "Organization parent updated" appears under the parent picker.
  - Organization detail, VAT validation: the outcome appears beside "Validate now". Only a validated identifier is shown as a success; format-only and deferred validations are a warning, a rejected identifier is shown in the error colour.
  - Organization detail, roles: a created, saved or deleted role is reported beside the Create role button in the tab's header. Opening the editor or a delete clears it.
  - CRM opportunity: coming back from creating an order or a quote request, the linking progress and its result appear beside the Create button that started it, instead of a banner under the section heading. A document that was created but not linked is a warning, with its link.
  - CMS brand settings: "Brand settings saved" and "The channel follows the global brand settings again" appear beside Save in the page header. The next edit, a channel switch or starting an override clears it.

- fc7f669: The six sales lists now have one shape (issue #1500, UX audit SALES-24). Each is the kit `ListPage` with the kit `ListToolbar`, so the toolbar is a named `search` landmark in a plain row, not a card. Below it is one results card that holds the bulk bar, the table and the pager. The kit `EmptyState` tells "nothing here yet" apart from "nothing matches these filters", and the second one offers _Clear filters_.

  - **Orders**: _New order_ is in the header for an operator holding `orders:write`. The toolbar, bulk-bar and results cards are now one card. While rows are selected, the bulk _Change status_ button is outline, so _New order_ stays the one filled primary. Each row has a menu with _Change status…_ and _Print invoice_ for that one order, plus _Open organization_. The pager offers only the page sizes the endpoint serves.
  - **Quote requests**: the hand-built toolbar, filter toggle and chips are replaced by the kit toolbar, so the advanced filters sit behind _More filters (n)_. Each row's menu has _Open organization_.
  - **Returns**: the four configuration links (workflow, reasons, return methods, clauses) are one _Settings_ menu next to _Export CSV_. The search is no longer listed as a chip. _Clear all filters_ empties the search too. When a case has an order, its row menu has _Open order_.
  - **Customers**, **Organizations**, **Carts**: these use the kit toolbar and the kit empty state. Each filter is named by its label, and its first option says what it is ("All statuses"). Customers and Carts rows have _Open organization_.

  Removed unused translation keys: `orders.open`, `orders.loading`, `orders.empty`, `rfq.list.open`, `rfq.list.loading`, `rfq.list.filter.toggle`, `rfq.list.filter.clearAll`, `returns.loading`, `returns.empty`, `returns.action.open`, `returns.filter.clearAll`, `organizations.filter.all` (core); `list.search.chip` (returns); `list.clearFilters` and `list.filter.all` (customers); `list.clearFilters` (organizations); `carts.clearFilters` and `carts.filter.all` (carts). The admin-kit README documents how the two compose.

- 204b98c: The organization detail screen is one card with tabs instead of sixteen stacked cards and five more from other modules (issue #1515, UX audit 2026-11-17 SALES-02).

  - **Overview**: moderation, registered address, hierarchy, custom fields. **Members & roles**: the members and the roles. **Commerce**: sales channels, order-confirmation e-mails, restrictions, fulfilment, the price books that apply, and every `organization.detail.after` panel. **Tax**: the tax ID and VAT status with _Change tax ID…_, _Change VAT status…_ or _Convert to company…_, then VAT validation. **Sales**: the sales representatives, offered only with `organizations:assign-sales-rep`. `?tab=` opens a tab. A tab holding unsaved changes says so, and switching tabs keeps them.
  - Every panel is a section of the tab's card, not a card of its own; `organization.detail.after` is mounted in the Commerce tab without `chrome="card"`, so its contributions render as sections. The related-payers panel is an `EditorSection` now, like the other contributions.
  - The header holds _Back_ and the page Save, the one primary. The tax corrections moved to the Tax tab, and their result is said beside them.
  - Moderation offers only the transitions the status allows (issue #1541, SALES-15): Approve and Reject while pending, Block while active, Unblock while blocked, none once rejected. The registry-divergence notice's link opens the Tax tab at the VAT validation.
  - The sales-representative remove button has an accessible name, and its result is said beside _Assign_ instead of an info banner.

- a02b5e6: The Organization detail screen's members are one _Members_ section (issue #1516).

  - `@endora-commerce/mod-organizations`: the _Invite member_ and _Direct add member_ cards are gone. The _Members_ section lists each member as a row with the member's role as a badge, and offers one **Add member** button. It opens a dialog that asks whether to send an invitation or create the account now. Only the second asks for the names, a temporary password and the member's `customer` custom fields. The form is checked when it is submitted, and each problem is shown at its field.
  - The bordered edit box above the members table is replaced by an **Edit** dialog. It holds the e-mail, the names and the role, and saves them together. The row no longer holds a role select that saved as soon as an option was picked. If the member was changed elsewhere, the dialog reloads the current values and says so.
  - **Remove** asks for confirmation first, and a refused removal is shown in that dialog. The last administrator can be neither removed nor demoted, and the reason is shown. Without `customers:manage` the list is read-only. A personal Organization offers no **Add member**.
  - The routes, their bodies, their permissions and their audit entries are unchanged. The new strings ship in the module's bundle under `members.*` (en, pl).
  - `@endora-commerce/mod-i18n` drops ten `organizations.detail.*` strings that nothing reads any more: `inviteCard`, `directAddCard`, `nameCol`, `actions`, `roleForLabel`, `twoFactor`, `twoFactorOn`, `verified`, `lastLogin` and `error.versionConflictMember`.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- b2c1723: The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
- ab0ad24: **Credit limits on the Organization screen** (UX audit SALES-19, issue #1544). `credit_limits` contributes a read-only _Credit limit_ summary to `organization.detail.after`, the Organization screen's Commerce tab: the granted, reserved and available amounts and the number of active reservations, or a note that no limit is granted. When reservations exceed the limit it says by how much. Its one link, _Adjust limit_ or _Grant credit limit_, opens the Credit limits screen with that organization's dialog already open (`/credit-limits?organizationId=<id>`); closing the dialog drops the parameter. The panel needs `credit_limits:manage` and is absent while the module is off. `organizations` only updates a comment that lists the zone's contributors.
- 306a659: The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — _Organizations_, _Price books_, _CMS pages_ — instead of _Back to organizations_, _All warehouses_, _Back to list_ or a bare _Back_ (follow-up of issue #1549). A generic _Back_ remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

  The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.

- 7ea72af: The way back from a detail, create or settings screen is now always the page header's back link above the title (issue #1549). Organization, New organization, Tax ID scope, Change tax ID, Convert to company, Order statuses, Return, Form entry, Category content, Product content and Comparison drew it as an outline Back button among the header actions, an arrow link above the header, or a button at the bottom of the page. Order statuses now goes back to "Orders" rather than a bare "Back". A form entry that is missing or cannot be loaded shows a "Form entry" heading with the same back link. The admin-kit README names `PageHeader` `back` as the one pattern.
- bfc21d3: Shorter admin copy on the order, quote-request, organization, promotion, invoice and return screens (UX audit text-to-cut pass, issue #1567):

  - Removed lines that repeated what the screen already shows: the description on the invoices list, the line under the customer's price-negotiation override, the line above the default payment / delivery / address fields, and the description of the organization's Roles section.
  - Shortened to one line: the read-only note on price negotiation, the warehouse-precedence hint, the order-confirmation e-mails hint, the parent-organization hint, the empty sales-reps note, the sales-channel hints on order and quote-request creation, the saved-rule copy hint on promotions, and the pending-effects notice on an order.
  - Shortened notices: the "carrier not contacted" shipment notice and the "different refund method" warning on a return.

  Removed translation keys (EN and PL): `invoices.description`, `defaultPreferences.description` (core bundle), `negotiation.customer.description` (quote requests), `roles.tab.description` (organizations). A theme or overlay that overrode them can drop the override.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 79d15cf: The Admin UI has one, light theme (issue #1810). `@endora-commerce/admin-kit/theme.css` no longer declares the `.dark { --background: … }` token block: nothing applied it, and applied by hand it was incomplete, with a light page under dark cards and unreadable outline buttons. An instance that set `.dark` on an element by itself now gets the light tokens; to restyle the admin, redeclare the `:root` tokens instead.

  The `dark:` utilities are gone too: `Badge`'s `success` and `warning` variants, the `ScopedField` "unsaved" badge, the shell's not-found notice, and the amber and emerald notices and icons in the admin screens of admin users, catalog bulk operations, the page-builder translate action and header actions, CRM propagation outcomes, custom-field carry drift, document-template item tables, tax-ID scope, product feeds and settings. Without a `dark` variant definition, Tailwind 4 compiles `dark:` to `@media (prefers-color-scheme: dark)`, so on an operating system set to dark these elements turned dark on a light page. They now render the same on every system.

- b3d4843: The buyer's session replies are described by their contract (issue #599, section 1):

  - `@endora-commerce/contracts` publishes `customerMeResponseSchema` / `CustomerMeResponse` for `GET /api/v1/me`: `data.customerAccount` (the account with its `preferredLanguage`), `data.organization` (`null` without one) and `data.impersonation` (`{ impersonatorAdminUserId }` while an administrator impersonates the buyer, else `null`). Its Organization, `customerMeOrganizationSchema`, declares the four keys the reply has always carried and `organizationSchema` does not: `legalName`, `version`, `canTransact` and `moderationMessage`.
  - `@endora-commerce/contracts` publishes `customerSignInResponseSchema` / `CustomerSignInResponse` for `POST /api/v1/auth/customer/login`: a `data` union on `status`, where `authenticated` carries the whole `customerAccount` and, when a guest basket was merged, `cartMerge`; `mfaRequired` carries `challengeId` and `mfaSetupRequired` carries `setupTicket`.
  - `customerLoginResponseSchema` / `CustomerLoginResponse` are deprecated: they declare no `status` and refuse the two second-step answers. Parse with `customerSignInResponseSchema` instead. They stay exported until the next breaking-change release.
  - `mod-organizations` builds both replies as the contract's types. Nothing on the wire changes.

- f74fe34: `carts`' `Migration20260611T140352CartsConsolidation` no longer adds or drops
  `organizations.requires_cart_approval` (issue #611). The column belongs to `organizations`, which
  already drops it in `Migration20261104T094535OrganizationsDropLegacyRoleColumns` and re-creates it
  in that migration's `down()`. The old migration keeps its class name, so a database that has
  already applied it does not change. A database migrated from empty now never has the column; its
  final schema is the same as before. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `carts`
  writing `organizations`.
- 0fbf186: `organizations` now creates `organizations.customer_group_id` and
  `organizations_customer_group_id_index` itself, in the new
  `Migration20261117T033143OrganizationsCustomerGroupColumn` (issue #611). Until now only
  `price_lists`' `Migration20260426T075235PriceListsPricingInit` created them, although the column
  belongs to `organizations`' `Organization` entity. That migration keeps its class name and no
  longer names `organizations` in `up()` or `down()`. The new migration uses `if not exists` with the
  same type and index name, so a database that has already applied the old migration does not change.
  `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `price_lists` writing `organizations`.
- 81fcc3f: `useConfirmDialog`'s `confirm` takes a new `returnFocusTo` option: an element, a ref, or a resolver that names where focus goes after a confirmed answer. A confirmed action that removes the control that asked it, such as a row's _Remove_, used to leave focus on `body` once the row was gone. The target is resolved once, when the dialog closes on a confirmed answer. On Cancel, or when it resolves to nothing, focus returns to the opener as before. The new `ConfirmFocusTarget` type is exported, and the controlled `ConfirmDialog` passes a `finalFocusRef` through to `ModalDialog`.

  Organization members: after a member is removed, focus moves to the next row's _Edit_, else to the previous row's, else to _Add member_.

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

- 2ee4923: Publishes `organizationWritePort` (`OrganizationWritePort` in `@endora-commerce/contracts`), so another module can find Organizations by tax ID, create one and update its identity fields without calling the admin HTTP API. Resolve it with `lazyPort` and declare `organizations` in your manifest `dependencies`.

  - `create` runs the existing `organization.create` Command through the same wrapper as the admin create, so a tax ID the active scope refuses answers `409 ORGANIZATION_TAX_ID_EXISTS`. When a `legalName` is given, the Command stores it and its audit entry names `legalName` among `changedFields`. The admin create (`POST /api/v1/admin/organizations`) does not send one, and its behaviour and audit entry are unchanged.
  - `update` runs the new `organization.update` Command. Its audit entry records the VAT status before and after and the sorted names of the changed fields, never their values. An update that changes nothing writes nothing, records nothing and does not move the version. `PATCH /api/v1/admin/organizations/:id` is unchanged.

- 3254098: **Correct a company organization's tax ID.** An operator can now fix a mistyped tax ID, or give a branch that was wrongly given its head office's tax ID one of its own, without deleting the organization: its id, members, roles and orders stay.

  - **Command** `organization.tax_id.change` — one transaction. Only a live company organization: a personal one is refused `409 ORGANIZATION_TAX_ID_CHANGE_REFUSED` `not_company`, a soft-deleted one `deleted` (new in `ERROR_CODES`). The value is normalised and checked against the active tax-ID scope exactly as creation checks it (soft-deleted holders count), and a database refusal at the statement or at commit answers the same `409 ORGANIZATION_TAX_ID_EXISTS`. The VAT validation summary (`vatValidatedAt`, `vatValidationProvider`, `vatValidationOutcome`) is reset to never-validated; `vatStatus` is kept. The same value after normalisation changes nothing and records no audit entry. The audit records names only: `changedFields: ['taxId']`, `vatStatusReset`, the scope. Orders, invoices and quote documents already issued keep the tax ID they were issued with.
  - **Admin API** `POST /api/v1/admin/organizations/:id/change-tax-id` (`adminOrganizationChangeTaxIdBodySchema`) under the new permission `organizations:change-tax-id`, answering `{ data, changed, vatValidation }`. With `validateTaxId: true` (which also needs `customers:manage`) a VAT validation runs after the change commits; its failure does not undo the change.
  - **Port** `OrganizationCommandPort.changeTaxId(organizationId, { taxId })` for admin routes and server code, never for a customer-facing route. It runs with the ambient actor and runs no VAT validation.
  - **Event** `organization.tax_id_changed.v1` `{ eventId, occurredAt, organizationId, changedAt }` (`OrganizationTaxIdChangedEvent`), dispatched once on commit; it carries neither the old nor the new tax ID.
  - **Admin UI** — _Change tax ID_ on a company organization's page (a dialog starting on the stored tax ID, the conflict shown on the field), and _Change an organization's tax ID_ in the command palette (`/organizations/change-tax-id`: pick a company organization, then correct its tax ID). The tax-ID scope screen's warning and refusal now point to this action as the way back to _Global_ for a tax ID shared by mistake.

- 7616ef1: `organization.convert_to_company` and `organization.tax_id.change` are hookable (issue #1057): the manifest lists both refs, and both Commands supply `hookData` and `outboxData` and accept `extensions`. A hook on either is handed ids, codes and field names only, never the tax ID.

  - A tax-ID correction to the same value still runs its hooks, with `changedFields: []`. It records no audit entry unless a hook noted a write; then it records one, `stateBefore: null` and `stateAfter: { extensions }`, naming only the hook's fields.
  - `organizationCommandPort.convertToCompany(id, input, { extensions })` and `changeTaxId(id, input, { extensions })` forward extension input; a key no present hook module claims answers `422 COMMAND_EXTENSION_UNCLAIMED` before anything is written. No HTTP body carries it.

- f39d37f: Custom-field values at registration and on the admin creates (`specs/175-buyer-input-custom-fields/`).

  - `POST /api/v1/organizations/register` passes the request's language to the value port, so each refusal's `message` is worded for the buyer in it (the code stays on the wire beside it).
  - `POST /api/v1/organizations/register` accepts `organization.customFieldValues` (stored on the Organization) and `firstUser.customFieldValues` (stored on the first account). Both groups are validated on the `organization.register` surface through custom_fields' `validateForCustomerInput` **before the first write**; every refusal of both is answered in one `422 CUSTOM_FIELD_VALUE_INVALID` whose `details` entries carry `field` (prefixed `organization.` / `firstUser.`; the group alone for `too_many_keys`), `code` and `message`, plus `path` / `issue` repeating them. Without a composed value port every supplied key is refused `not_open_for_input`; a registration that sends no values behaves as before. The `organization.register` audit entry gains `changedCustomFields`: the supplied keys, prefixed `organization.` / `firstUser.` and sorted — never values (`specs/conventions/audit-state.md`).
  - `POST /api/v1/admin/organizations` validates `customFieldValues` with the administrator's rules inside the `organization.create` Command (a refusal creates nothing; the audit after-state names the stored keys as `changedCustomFields`, never their values), and `POST /api/v1/admin/organizations/:id/members` validates the member's `customFieldValues` before the account is written and names their keys as `changedCustomFields` in the `customer_account.admin_create` audit row. Both now enforce `required` definitions at creation.
  - _New organization_ and the member direct-create form embed the custom-field panel (shown with `custom_fields:read`), send its bag as `customFieldValues` and show a refusal at the field it names.
  - The manifest exports `customFieldWrites`: the Organization create and update, the member direct-create, the member profile update (`PATCH /api/v1/admin/organizations/:id/members/:customerAccountId`, a customer update whose values are `customers`' values patch), the invitation exemption and the two buyer-input entries of `organization.register`.
  - The create screens read a refusal through `@endora-commerce/admin-kit`'s `customFieldErrorsOf` instead of a copy of their own.

- 3f95d1c: **Four Organization writes are hookable** (`specs/176-command-hooks-outbox/` FR-024): `organization.create`, `organization.register`, `organization.admin_patch` and `organization.set_custom_field_values`, both phases, listed in the manifest's `hookableActions` from `ORGANIZATION_HOOKABLE_ACTIONS`. Each Command supplies `hookData` (the uncommitted `OrganizationRecord` plus the channels, the first account, or the names of what changed — never the registration's verification token) and list-1 `outboxData`, and accepts `extensions` from a server-side caller; `organizationCustomFieldWritePort.setCustomFieldValues` forwards `{ extensions }` (an unclaimed key answers `422 COMMAND_EXTENSION_UNCLAIMED`). No HTTP body carries `extensions` yet. A hook's noted changes appear in the Organization's audit entry as names under `extensions.<moduleId>.changedFields`; `ORGANIZATION_AUDIT_KEYS` lists `extensions`. With no hook module installed nothing changes.
- f5caa4e: **Convert to company in the Admin UI.** A personal organization's page offers _Convert to company_ to holders of `organizations:convert-to-company`. A dialog asks for the company name, an optional legal name, the tax ID (spaces and dashes removed as you leave the field), the registered address, the VAT status and whether to validate the tax ID afterwards. It reports the validation's outcome; the organization page then shows its members and roles. _Convert personal organization_ (`/organizations/convert-to-company`, also from ⌘K and from the Organizations list's header menu) does the same in two steps, starting from a picker of personal organizations. `GET /api/v1/admin/organizations` accepts `filter[isPersonal]=true|false` with `includePersonal=true`.

  - **admin-kit:** `OrganizationPicker` takes an optional `kind` — `'company'` (default, unchanged), `'personal'` or `'any'`; `useOrganizationsQuery` takes the same option, and `OrganizationPickerKind` is exported.

- d14a4fd: **Personal → company conversion.** An operator can turn a personal (B2C) organization into a company in place: same id, orders, carts, addresses and channels, now with a company name, legal name, tax ID, registered address and VAT status.

  - **Command** `organization.convert_to_company` — one transaction. The tax ID is normalised and checked against the active tax-ID scope. The organization keeps its status; it is stamped approved by the operator when it never was. Its member stays its Administrator, and the conversion is refused when that is not so. `personalAccountId` is cleared and `convertedToCompanyAt` set. The audit records only which fields changed (`changedFields`), whether the approval was stamped, and the scope. Refusals: `409 ORGANIZATION_CONVERSION_REFUSED` (`not_personal`, `deleted`, `owner_not_administrator`; new in `ERROR_CODES`) and `409 ORGANIZATION_TAX_ID_EXISTS`. There is no reverse.
  - **Admin API** `POST /api/v1/admin/organizations/:id/convert-to-company` (`adminOrganizationConvertToCompanyBodySchema`) under the new permission `organizations:convert-to-company`. With `validateTaxId: true` — which also needs `customers:manage`, the VAT validation's own permission — a VAT validation runs **after** the conversion commits; its outcome is returned as `vatValidation`, and a failing provider does not undo the conversion. The admin conversion form offers _Validate the tax ID after converting_ (ticked by default) only to an operator holding `customers:manage` and sends `validateTaxId: false` otherwise, so the default form is never refused `403`.
  - **Port** `organizationCommandPort` (`OrganizationCommandPort.convertToCompany`) for admin routes and server code, never for a customer-facing route. **It checks no permission**: the caller is the gate. It runs with the ambient actor and runs no VAT validation.
  - **Event** `organization.converted_to_company.v1` `{ eventId, occurredAt, organizationId, convertedAt }`, dispatched once on commit (`OrganizationConvertedToCompanyEvent`).
  - **Returns** — a return of an order placed while the organization was personal is still a consumer withdrawal after a later conversion (`organizationWasConsumerAt`). The `isPersonalOrganization` dependency of the returns services takes the order's placement time as an optional second argument.
  - To move the converted company's only member out, give a second member the Administrator role first, as for any company.

- 86a92af: **Breaking: an organization's `taxId` is `string | null`.** A personal (B2C) organization has no tax ID; it used to carry a 32-character placeholder derived from its account id. `organizationSchema.taxId` is `z.string().nullable()` and `OrganizationRecord.taxId` is `string | null`. Was `organization.taxId.trim()`; now `organization.taxId?.trim() ?? ''`, or better `organizationCompanyTaxId(organization)`, which already answered `null` for a personal organization and now also accepts a `null` tax ID. Orders, invoices, quote documents and audit entries written before the upgrade are not rewritten.

  - **Minimum version to upgrade from: 0.100.0.** The migration below refuses to run, and changes nothing, on a database that has not applied `customer_accounts`' `Migration20260825T141659CustomerAccountsOrganizationRequired` (first shipped in 0.100.0) while it holds organizations or a customer account with no organization. Upgrade such an installation to a 0.100.x–0.110.x release first, run `migrate`, then upgrade to this release. A fresh database is not affected.
  - **Upgrade.** The migration `Migration20261110T135922OrganizationsPersonalTaxIdRemoval` clears the tax ID of every personal organization and records the customer account it was provisioned for in a new column, `organizations.personal_account_id` (taken from the old placeholder). A check, `organizations_tax_id_presence`, now refuses a personal organization with a tax ID and a company organization without one. A personal organization whose stored tax ID was not the placeholder (hand-made data) is cleared too and left without the link; the migration reports how many as a notice. Code that inserts personal organizations with a tax ID — fixtures, seeds, overlay modules — must write `null`.
  - **Provisioning** is idempotent by that link instead of the tax ID (`PersonalOrganizationProvisionApi.provisionFor`, `PersonalOrganizationPort.provisionPersonalOrganization`); the unassign destination is still the account's own personal organization.
  - **Tax-ID scope foundation.** `Migration20261110T135941OrganizationsTaxIdScope` adds a stored generated column `organizations.root_id` (the tree's root, from `path`) and the single-row table `organization_tax_id_policy`, seeded `global` — today's rule, unchanged. Adding the stored column rewrites `organizations` under an exclusive lock while it runs. The scope is switched only by the `organization.tax_id_scope.set` Command (see the tax-ID scope changeset).
  - **Lookups.** `OrganizationDetailsPort` gains `findByTaxId(taxId, { includeDeleted? })` — every organization holding the tax ID, the tree's root first — and `resolveByTaxId(taxId)` → `{ kind: 'none' | 'one' | 'ambiguous' }`. Both normalise the input with the new `normalizeTaxId` (whitespace and dashes stripped, upper-cased). An implementation or test double of `OrganizationDetailsPort` must add both methods.
  - **New contract shapes** for the coming tax-ID scope screen and personal → company conversion: `TaxIdScope` / `taxIdScopeSchema`, `adminTaxIdScopeSetBodySchema`, `adminTaxIdScopeResponseSchema`, `TaxIdResolution`, `adminOrganizationConvertToCompanyBodySchema` / `OrganizationConvertToCompanyInput`, `OrganizationConvertedToCompanyEvent`, `OrganizationRecord.convertedToCompanyAt`, and `AdminOrganizationCreateBodySchema.parentId` (optional). The conversion shapes are served by no route yet.
  - **Returns.** `OrderReturnContext` gains a required `placedAt: Date` — an implementation of `OrderReturnContextPort` must fill it.
  - **VAT validation** of an organization with no tax ID is refused `422 VALIDATION_FAILED` before any provider is called.

  An operator who wants to review orders placed by personal organizations before the placeholder was hidden can find them with `select id from orders where billing_address->>'taxId' ~ '^[0-9a-f]{32}$'`.

- 990e457: **Tax-ID scope screen.** _Organizations → Tax-ID scope_ (`/organizations/tax-id-scope`, also from ⌘K, _Tax-ID scope_) shows the scope in force, what each scope means, and how many tax IDs are shared, and switches it after a confirmation. If the switch to Global is refused, the screen lists the shared tax IDs with links to their organizations; if the database does not enforce the scope in force, it offers to apply it again. It is shown to holders of `organizations:manage-tax-id-scope` and reached from the Organizations list's header menu. _New organization_ gains an optional parent organization for unscoped administrators, so a branch can be created under its head office.
- ee2a111: **Tax-ID scope.** An installation chooses whether a tax ID belongs to one organization (`global`, the default and today's rule) or may be shared inside one organization tree (`per-tree-root`, so a head office and its branches carry the same tax ID). The database enforces both: `global` with the existing unique constraint `organizations_tax_id_unique`, `per-tree-root` with a deferred exclusion constraint `organizations_tax_id_one_tree` over the tree's root.

  - **Command** `organization.tax_id_scope.set` (audit: `{ scope }` before and after) swaps the constraint and the policy row in one transaction. It briefly blocks writes to `organizations` while the new constraint is built. Setting the scope already in force records nothing and re-creates a missing constraint. Switching to `global` is refused `409 ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` (`details: { code: 'shared_tax_ids', sharedTaxIdCount, examples }`, at most 20 examples) while any tax ID is on more than one organization, soft-deleted ones included. A tax ID cannot be changed from the admin, so once one is shared the way back to `global` is not available from the admin; the confirmation of a switch to `per-tree-root` says so.
  - **Admin API** `GET` / `PUT /api/v1/admin/organizations/tax-id-scope` (`adminTaxIdScopeResponseSchema`, `adminTaxIdScopeSetBodySchema`), under the new permission `organizations:manage-tax-id-scope` and for an unscoped administrator only.
  - **Admin create** `POST /api/v1/admin/organizations` accepts `parentId` and creates the organization as a branch in the same Command (unscoped administrators only, `403` otherwise; `404` for an unknown parent; the depth bound applies). In `per-tree-root` a branch may carry a tax ID its tree already holds. A tax ID the scope forbids is `409 ORGANIZATION_TAX_ID_EXISTS`, also when two creations race.
  - **Moves** in `per-tree-root` that would put a shared tax ID into a second tree are refused `409 ORGANIZATION_TREE_INVALID` with `details.code = 'tax_id_shared_across_trees'` and `details.taxIds`.
  - **Registration** refuses a tax ID that already resolves to an organization in both scopes, a branch's included, and answers a database refusal from either constraint with `409 ORGANIZATION_TAX_ID_EXISTS`.
  - **Migration** `Migration20261110T173752OrganizationsTaxIdWriteLock` adds the row trigger `organizations_tax_id_write_lock` (on inserts and on updates of `tax_id` or `path`): two transactions writing the same tax ID take turns, so the second meets the first's committed row and is refused with a 409 rather than deadlocking against the organization reach rebuild. The lock is keyed by one of 256 buckets of the tax ID, so a transaction holds at most 256 such locks however many rows it writes; moves lock their subtree's buckets in ascending order first.
  - **Tax IDs are stored normalised** — whitespace and dashes removed, upper-cased (`normalizeTaxId`). Registration and admin create store, check and answer the normalised form. `Migration20261110T183238OrganizationsTaxIdNormalise` rewrites existing rows and adds the check `organizations_tax_id_normalised`, which refuses any other form from any writer (fixtures, seeds and overlay code inserting organizations must write the normalised form). **It refuses to run, and changes nothing, when two organizations would hold one tax ID once normalised** where the scope forbids it (anywhere in `global`); its message lists up to 50 such groups. Find them before upgrading with:

    ```sql
    select upper(regexp_replace(tax_id, '[[:space:]-]', '', 'g')) as normalised,
           array_agg(id order by id) as organizations
      from organizations where tax_id is not null
     group by 1 having count(*) > 1;
    ```

    and give each organization its own tax ID first.

  - **Contention.** The scope change takes the table's `access exclusive` lock up front, waiting at most 5 seconds. A write of organizations that loses a lock to a concurrent one — the scope change, or a racing writer (`40P01`, `55P03`) — answers `409 ORGANIZATION_WRITE_CONTENDED` (new in `ERROR_CODES`); retrying succeeds.
  - **Tax IDs are validated after normalisation** where they enter: `registerOrganizationRequestSchema` (and so `AdminOrganizationCreateBodySchema`) now normalises the tax ID first and then requires 8 to 32 characters, so `--------` is refused with `400` and an over-long value is a `400`, not a `500`. The admin organization update accepts no tax ID; a tax ID cannot be changed after creation.
  - **Search.** The admin organizations list's `q` and the global search match the tax ID in its normalised form, so `pl 526-025` finds `PL526025…`.
  - **Boot** logs one error when the stored scope and the constraint present disagree; re-applying the scope repairs it.
  - `ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES` is new.

- bfa1ac4: `organizations` is an extensible host for declared extension columns (`specs/178-extensible-columns/` FR-051, FR-052). `GET /api/v1/admin/organizations/:id` and `GET /api/v1/admin/organizations` accept `?extensions=<moduleId>[,<moduleId>…]` (at most eight, `ExtensionsQuerySchema`) and then return `extensions` on every record: per named module that declares columns on `organizations` with `adminReads: true` and is present, its declared keys and values. A module that is switched off, not installed or not exposing the host is omitted without an error; a malformed parameter answers 400. Without the parameter both responses are byte-identical to before. `@endora-commerce/contracts` publishes the record shape as `adminOrganizationSchema` (`organizationSchema` plus optional `extensions`, `AdminOrganization`).
- 75027ef: The organization detail screen now has one Save for the whole page (issue #407, `specs/180-one-save-zone-editors/` WP-7).

  **mod-organizations:**
  - The screen runs a save session, one per organization, and passes it to `organization.detail.after`. The Save button sits in the page header (a sticky bar at the bottom on narrow screens). It reads "Save" or "Save n changes" and does nothing while there is nothing to save.
  - Status, VAT status, order-confirmation e-mails, fulfilment strategy, restrictions and custom fields no longer save on change, on blur or through their own Save buttons. They are staged and written by the page's Save: first one `PATCH /api/v1/admin/organizations/:id` with `expectedUpdatedAt`, carrying only the fields that changed, then, if the allow-lists changed, the `PUT …/restrictions` with the version the `PATCH` returned. After that come the panels, in zone order.
  - If either write answers `VERSION_CONFLICT`, no panel is written. The organization is reloaded, every unsaved change on the page (the screen's and every panel's) is discarded, and the screen says so. If a panel fails after the organization saved, a summary reports what was saved and what was not, and the next Save writes only what is left.
  - Members (invite, direct add, role, edit, remove), hierarchy, moderation, VAT validation, sales channels, roles and sales representatives still apply immediately. Each of these sections now carries an "Applies immediately" badge.
  - Leaving the page with unsaved changes asks first.
  - An operator without `customers:manage` sees status, VAT status, e-mails, fulfilment strategy, restrictions and custom fields read-only. The page's Save would never write them for that operator.
  - New strings in English and Polish: `detail.save.hostPartLabel` and `detail.save.conflict`. The badge is `@endora-commerce/admin-kit`'s `ImmediateBadge`.

  **mod-price-lists:**
  - The organization detail's display-mode panel passes that screen's session, so the display mode is saved by the page's Save instead of on change. No host is left without a session, so `DisplayModeOverrideRow` now requires `saveSession`, and its save-on-change branch and its "saved" suffix are gone.

- 20cda0c: Issue #461 — the Projects `@` list (`GET /api/v1/admin/projects/lookups/mentionable`) judges who may see the Project for every candidate administrator at once, instead of several reads per person.

  - **`@endora-commerce/contracts`** adds `PermissionReadPort.resolveRoles(adminUserIds)` — a `Map` holding, for every id asked, what `resolveRole` answers — and `AdminTenantScopePort.resolveForAdmins(adminUserIds)` — a `Map` holding, for every id asked, the scope `resolveForAdmin` answers. Every implementation of these ports must provide the new method; consumers are unaffected.
  - **`@endora-commerce/mod-admin-roles`** implements `resolveRoles` in two statements whatever the number of ids, and adds `holdersOf(adminUserIds, permission)` beside `hasPermission` on the `permissionService` container entry: the ids `hasPermission` answers yes for, refusing with `ADMIN_ROLE_REQUIRED` as `hasPermission` does when an active administrator asked holds no role.
  - **`@endora-commerce/mod-organizations`** implements `resolveForAdmins` with the same rule as `resolveForAdmin` — one batched role read, and the roll-up question asked once for the sales representatives only. A failure of that question leaves every representative asked unresolved, holding no organization, as one call at a time would. `SalesRepAssignmentService` gains `hasRollupCapabilities(adminUserIds)`.
  - **`@endora-commerce/mod-projects`** adds `ProjectAccess.canSeeAsMany(adminUserIds, projectId)`: the accounts, their roles and their reach each read once, and both visibility rules evaluated for everybody in one statement. `canSeeAs` is now that check for one person. The mentionable lookup asks it once; the people it offers, their order and the limit of 20 are unchanged.

- d1cbf57: Issue #470 (D-288, owner ruling O-2) — the `organization.admin_patch` audit entry (`PATCH /api/v1/admin/organizations/:id`) holds field names, not values. The Organization is the tenant, and its name, tax ID, reasons and custom field values are that tenant's values; the platform audit log is read under `audit_log:read` without Organization reach.

  - The entry no longer records the Organization's snapshot (name, legal name, tax ID, registered address, order-confirmation e-mails, block and rejection reasons, custom field values).
  - `stateBefore` holds the `status`, `vatStatus` and `fulfilmentStrategy` codes. `stateAfter` holds the same codes after the write, `changedFields` (the sorted names of the changed columns) and `changedCustomFields` (the sorted keys of the changed custom fields).
  - The request, the response, the `409 VERSION_CONFLICT` and the `422 CUSTOM_FIELD_VALUE_INVALID` envelope are unchanged. There is still one entry per PATCH.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new `organization.admin_patch` entries show no Organization values. See _An Organization edit's values leave the platform audit log_ in the upgrade guide.

- 1774bf5: Issue #470 (D-288, owner rulings O-1 and O-2) — every remaining `organizations` audit entry holds names and structure, not values. The platform audit log is read under `audit_log:read` without Organization reach, so an Organization's name, tax ID, address and reasons, a member's or invitee's e-mail and names, and a custom role's name and description stay out of it.

  - `organization.create` and `organization.register` no longer record the name, tax ID or registered address; `changedFields` names the fields the Organization was created with. The status, VAT status (create), sales channels and parent stay, and so do `changedCustomFields` and `registryLookup`.
  - `organization.delete` records `status`, `vatStatus`, `isPersonal`, `parentId` and `version` instead of the full Organization.
  - `organization.approved`, `.rejected`, `.blocked` and `.unblocked` record `hasBlockedReason` / `hasRejectedReason` instead of the reasons, and no longer repeat the Organization's id in their state.
  - `customer_account.admin_create`, `.admin_profile_update`, `.admin_rollup_change` and `.admin_remove` record the member's `organizationRoleId`, `subtreeRollupEnabled`, `emailVerified` and `twoFactorEnabled` and, after a change, `changedFields`. They no longer record the e-mail, names or the Organization's id.
  - `organization_invitation.create` and `.revoke` record `invitationId` and `role: { id, kind }`. They no longer record the invitee's e-mail or a custom role's name. `organization.invite_accept` no longer records the e-mail.
  - `organization_role.create`, `.update` and `.delete` record `role: { id, kind, permissions }`. An update adds `changedFields` (`name`, `description`, `permissions`). A custom role's name and description are no longer recorded.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new entries from these writes show no Organization, member, invitation or role values. See _Every other organizations entry leaves its values out of the audit log_ in the upgrade guide.

- d0c5dc8: Business registration (`POST /api/v1/organizations/register`) and invitation accept (`POST /api/v1/organizations/invitations/:token/accept`) record the request's language on the new account, resolved against the request's sales channel; an invitation records the invitee's language, not the inviter's. The customer sign-in (`POST /api/v1/auth/customer/login`) passes the request's language so that an account without one gets it (issue #652). `GET /api/v1/me` answers `customerAccount.preferredLanguage`. `RegistrationService.registerOrganization` accepts `context.preferredLanguage` and `InvitationService.acceptByToken` accepts `input.preferredLanguage`.
- 5f8eede: A sales representative's reach is read from a new table, `organization_reach_governor` (issue #955): for each organization, the nearest ancestor-or-self that carries a sales-representative assignment. Migration `20261109T144721_organizations_reach_governor` creates it, backfills it, and keeps it current through statement-level triggers on `organizations` and `organization_sales_rep_assignments`, inside the transaction of every write — the admin Commands, the assignment service, the demo reset and raw SQL alike — under one transaction-scoped advisory lock. It also adds `organizations_reach_excluded(admin_user_id, rollup)`, the one definition of a representative's excluded set: `SalesRepAssignmentService.reachOf` reads it, and `adminTenantScopePort` answers it as `excludedOrganizationsQuery`, which the tenant filter renders as a subquery. The rule is unchanged (`canSeeOrganization`), and nothing is cached.

  **Operations.** A data-only restore with `--disable-triggers` leaves the table stale; run `select organizations_reach_governor_rebuild(null);` afterwards. Every assignment write, organization insert and tree move now serialises on one advisory lock until its transaction commits.

- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 44529a4: Custom-field values from server-side code, and the admin Organization edit on the Command Bus.

  - Publishes `organizationCustomFieldWritePort` (`OrganizationCustomFieldWritePort` in `@endora-commerce/contracts`). Resolve it with `lazyPort` and declare `organizations` in your manifest `dependencies`. Each call runs one `organization.set_custom_field_values` Command, whose audit entry names the custom-field keys that changed (`changedCustomFields`) and carries none of their values. Writing `organizations.custom_field_values` directly is not a supported alternative.
  - `PATCH /api/v1/admin/organizations/:id` now runs as one `organization.admin_patch` Command. The `expectedUpdatedAt` check, the column changes and the custom-field merge share one transaction, and the audit entry is written in that same transaction rather than after the flush. The request, the response, the `409 VERSION_CONFLICT` and the `422 CUSTOM_FIELD_VALUE_INVALID` envelope are unchanged. A refused value still writes nothing, including the other columns in the same request. There is still one entry per PATCH, under the same action; its payload records the names of the changed fields only (see the #470 admin-patch changeset). That entry no longer carries the request's `X-Request-Id` (the Command Bus does not stamp one, as on every other Command).

- 42a9a4b: One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

  `mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

  **Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in _Upgrading an instance_ ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.

### Patch Changes

- 0e16877: **The verification link a business registration e-mails follows the channel language `Accept-Language` asks for, read as a q-weighted list** (issue #1011). `POST /api/v1/organizations/register` put the link under the language prefix of the header's first tag alone, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` linked to the English page and `de-DE, pl;q=0.5` to the channel default. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. A request without the header, or outside a sales channel, behaves as before.
- f8382b4: `organizations` now creates its own `organization_sales_rep_assignments` table (issue #1033,
  `specs/178-extensible-columns/` D-291 R-A8). Until now only `quote_requests` created it, so a
  platform that composed `organizations` without `quote_requests` failed on
  `Migration20261109T144721OrganizationsReachGovernor`, whose triggers name the table. That
  migration's `up()` now begins with `create table if not exists` and `create index if not exists`
  for the table and its two indexes, with the same columns, constraint names and index names as
  before. The two indexes are now created only here. No new migration is added and no migration class is renamed. A database that has already
  applied the migration does not run it again and does not change.
- 8abfd03: `@endora-commerce/mod-organizations` now publishes a development-only `./test-support` subpath
  (issue #1056). It exports `volatileTables`, which lists `organization_sales_rep_assignments` and
  `organization_reach_governor`. A test harness that collects module test support with
  `@endora-commerce/test-kit/support`'s `collectVolatileTables` now empties both tables between
  test files. Before this change, sales-rep assignments written by one test file were still there
  in later files, so those files saw a different sales-rep reach. Runtime code, migrations and the
  other exports are unchanged.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- fc16db9: The organization-role cache no longer sends `SUBSCRIBE` while its ioredis subscriber connection is still in its handshake (issue #1147, a follow-up to #1096). `OrganizationRoleCache.start` now subscribes through `subscribeWhenReady` from `@endora-commerce/platform/kernel`, as the module-registry, sales-channel access, custom-field definition and pricing generation caches already do, so a role-change announcement published during boot is no longer lost to a forced reconnect. The structural type `OrganizationRoleSubscriber` now extends `HandshakeAwareSubscriber`, so it also requires `status`, `once` and `removeListener`; the composition's ioredis subscriber already has them.
- d2f179f: `customerSignInCompletionPort` honours the new optional `salesChannelId` of its input and hands it to the post-sign-in hook: the `onLogin` option's argument gains the optional `salesChannelId`, the channel whose signed-out basket a sign-in merges when its request carries none (issue #1188). A composition's `organizationsLoginHook` should merge on `salesChannelId ?? <request channel>`; one that ignores it keeps merging on the request's channel. The password sign-in is unchanged.
- ecbf12a: The sales-channels panel on the organization detail applies each change immediately (issue #1305). It used to hold the ticked channels as a draft behind its own **Save sales channels** button, a second Save beside the page's one Save (spec 180, SC-001), although the panel is an immediate action.

  - Ticking or unticking a channel writes the assignment at once, through the same `PUT /api/v1/admin/organizations/:id/sales-channels` and with the same audit rows; the panel has no Save button and adds nothing to the page Save's count.
  - While a write is in flight the channel being changed is marked busy, a status line announces it, and no further tick is taken until it finishes. A write that fails puts the checkbox back and names the channel and the reason.
  - Unticking the last channel is refused in the panel, with the existing _"An organization must be assigned at least one sales channel."_ message, and writes nothing.
  - The catalogue keys `salesChannels.save`, `salesChannels.saving`, `salesChannels.saved` and `salesChannels.saveError` are removed; `salesChannels.adding`, `salesChannels.removing`, `salesChannels.added`, `salesChannels.removed` and `salesChannels.toggleError` are added, in English and Polish.

- 695636f: Storefront self-registration (`POST /api/v1/organizations/register`) is now one transaction
  (`specs/176-command-hooks-outbox/` US1). It runs as the `organization.register` Command, and the
  first account is `customer_accounts`' `customer_account.create`, run as its child through
  `ctx.run`.

  What this writes now commits together or not at all: the Organization, its sales-channel binding,
  the first account, the registry-lookup validation row, the e-mail verification token, both audit
  entries and both events (`organization.registered.v1`, `customer_account.created.v1`). Before, the
  Organization committed on its own. A failure after that point, such as a racing e-mail address or
  a failing token insert, left an Organization with no administrator, and the same tax ID could not
  be registered again.

  The request, the response, the status codes and the error codes are unchanged. That includes
  `409 ORGANIZATION_TAX_ID_EXISTS` from either tax-ID scope's constraint, mapped around the Command
  Bus for `per-tree-root`'s deferred one.

  **Audit log, for upgraders.** The `organization.register` entry keeps its names-only state: the
  status, `changedFields`, `changedCustomFields` and the registry lookup's codes. It is now written
  by the Command Bus, so it carries the request id, IP address and user agent, the same request id
  as the account's `customer_account.create` entry. Entries written before the upgrade are not
  rewritten.

  **For code that builds `RegistrationService` by hand.** The constructor now takes one options
  object: `{ emFactory, commandBus, events, accounts: { read, commands }, dictionaryValidator?,
channelMembership?, registryLookup?, customFieldValues? }`. `accounts.commands` is the
  `customerAccountMemberCommandPort`. It no longer takes an audit port. The module's plugin option
  `customerAccountCommands` carries the port, and the module's own composition wires it.

- bf257b8: `organizations` publishes `customerSignInCompletionPort` (`CustomerSignInCompletionPort`), the post-sign-in step its password sign-in runs: the contributed `organizationsLoginHook` merges the signed-out basket and adopts the anonymous comparison. The password route now runs the same function, so its answer and its `b2b_cart_anon` handling are unchanged (issue #368).
- 5c148de: The product editor, the category editor, the sales-channel editor and the organization and customer detail screens now pass `saveSession: INERT_SAVE_SESSION` to their zones (issue #407). None of these editors runs a save session yet, so nothing changes for operators. The `core` catalogue adds the save-session notices and the "switched off" message in English and Polish (`saveSession.notice.moduleOff`, `saveSession.notice.crashed`, `saveSession.error.moduleOff`).
- 577e94c: The product editor, the customer and organization detail screens and the sales-channel editor's warehouse routing panel draw their "Applies immediately" badges with `@endora-commerce/admin-kit`'s `ImmediateBadge` instead of a local copy each (issue #407). The badge looks and reads the same. The module strings it replaces are removed in English and Polish: `productEditor.immediate.badge` (catalog), `detail.immediate.badge` (customers, organizations) and `warehouses.channel.immediateBadge` (inventory).
- 4d0a26d: Documentation only (issue #407). The shipped `docs/` pages, in English and Polish, now describe the one Save on every editor with zone panels. Each page says what Save covers, what is checked before anything is written, the order the parts are written in, what a partial save reports and that the next Save writes only the part that failed. It also says how the leave guard works and which sections carry the "Applies immediately" badge.

  - catalog: "Editing a product at a scope" covers the base prices and the Inventory tab's product settings under Save, plus the actions that apply immediately. A new "Editing a category" section on the module page covers the category editor's Save.
  - price_lists: the display-mode override saves with the organization and category editors. The base-price panel's **Discard changes** is described.
  - organizations, customers: a section on each screen's one Save and its immediate actions.
  - quick_order, quote_requests: their panels save with the host screen's Save.
  - sales_channels: the edit page's Save and its count. Deactivate and Re-activate keep unsaved edits, and warehouse routing applies immediately.

  No code, API or string changes.

- 2905024: Organization admin, member, invitation and registration replies are described by their contract (issue #599, section 1):

  - `adminOrganizationSchema` in `@endora-commerce/contracts` now declares the keys every admin organization reply has answered: `legalName`, `orderConfirmationEmails`, `version`, `blockedReason`, `blockedAt`, `rejectedReason`, `rejectedAt`, `approvedAt`, `approvedByAdminUserId`, `vatValidation` (`outcome`, `provider`, `validatedAt`) and `customFieldValues`. This applies to the list, the detail and the answer of each write. The Admin UI's organization page reads these keys. They are optional, so a client that does not read them is unaffected.
  - `@endora-commerce/contracts` publishes schemas for replies that had none: `adminOrganizationListResponseSchema` for `GET /api/v1/admin/organizations`; `adminOrganizationDetailSchema` for `GET /api/v1/admin/organizations/:id` (the Organization, its `members` and its `predefinedRoles`); `adminOrganizationMemberSchema` for the detail's member rows and the admin member writes; `organizationMemberSchema` and `organizationMemberListResponseSchema` for `GET /api/v1/organizations/mine/members` and the member role change; `organizationInvitationSchema` and `organizationInvitationListResponseSchema` for `GET /api/v1/organizations/mine/invitations`; `inviteMemberResponseSchema` for `POST /api/v1/organizations/mine/invitations`; and `acceptInvitationResponseSchema` for `POST /api/v1/organizations/invitations/:token/accept`. Each has its inferred type.
  - `mod-organizations` builds these replies, and the registration reply, as the contract's types instead of `Record<string, unknown>` or an undeclared shape. The handlers declare their reply types. The Admin UI's organization page uses `AdminOrganizationDetail` and `AdminOrganizationMember` instead of hand-written interfaces. Nothing on the wire changes.

- b064fec: Documentation only. The module page (English and Polish) lists the events the module actually emits, the admin delete, address, member-profile and member roll-up routes, which permissions the admin reads accept, the PATCH fields, the credit-inheritance setting and where the last-administrator guard and the verification e-mail live; the English page gets back its section on the organization screen's one Save. The hierarchy page names the delete route, its `ORGANIZATION_HAS_CHILDREN` refusal and the member roll-up route.
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

- 9cfb28b: Organization roles (`specs/170-organization-roles/`). Every organization now has an _Administrator_ and a _Member_ role — created with the organization, by a database trigger, whichever path creates it — and up to 50 custom roles, each a set of organization permissions declared by the modules in their manifests' `organizationPermissions`.

  - Migration `Migration20261103T173304OrganizationsOrganizationRoles` creates `organization_roles`, gives every existing organization its two predefined roles, withholds `carts.order_without_approval` and `quick_order.one_click` from _Member_ where the organization required cart approval, and adds `organization_invitations.organization_role_id` (backfilled from `role`, `not null`, a composite foreign key to the invitation's own organization's roles). The invitation service writes both `role` and the new column.
  - Storefront routes for an organization's administrator: `GET/POST /api/v1/organizations/mine/roles`, `GET/PATCH/DELETE /api/v1/organizations/mine/roles/:id`, `GET /api/v1/organizations/mine/permission-catalogue`; and `GET /api/v1/organizations/mine/role` for every member. A personal organization answers `404`.
  - Operator routes `GET/POST /api/v1/admin/organizations/:id/roles`, `PATCH/DELETE /api/v1/admin/organizations/:id/roles/:roleId` and `GET /api/v1/admin/organizations/:id/permission-catalogue`, gated by the new operator codes `organizations:read-roles` and `organizations:manage-roles` (which requires the first).
  - The role writes are the Commands `organization_role.create`, `organization_role.update` (emits `organization_role.permissions_changed.v1` with `added` / `removed`) and `organization_role.delete`, audited against the organization.
  - New ports `organizationPermissionPort` (`can`, `assert`, `isAdministrator`, `effective`, `rolesHolding`) and `organizationRoleReadPort` (`predefinedRoleId`), over a per-process role cache dropped on every role change and announced on `b2b:organization-roles:changed`.
  - Seven new error codes declared and translated (EN, PL): `ORGANIZATION_PERMISSION_REQUIRED`, `ORGANIZATION_ROLE_NAME_TAKEN`, `ORGANIZATION_ROLE_STALE`, `ORGANIZATION_ROLE_LIMIT_REACHED`, `ORGANIZATION_ROLE_PROTECTED`, `ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`, `ORGANIZATION_PERMISSION_UNKNOWN`.

  Members are not yet assigned to roles individually: until they are, a member counts as _Administrator_ when they are the organization's administrator (or the member of a personal organization) and _Member_ otherwise, and a custom role somebody holds cannot be deleted.

- a206da9: Organization roles reach the members (`specs/170-organization-roles/`, WP-02b).

  - Deleting a custom role that members or invitations hold now takes `replacementRoleId` and moves every holder in the same transaction: one `customer_account.change_role` Command per account, each audited, then the invitations, then the role. A held role without a replacement is still refused `422 ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`.
  - The permission port reads the member's own role (`organizationRoleId`) instead of deriving it from the legacy `role`, and the role list's member counts come from the assignment.
  - `organizationRoleReadPort.findRole(organizationId, roleId)`.
  - The personal-organization provisioning answers carry `administratorRoleId` (`PersonalOrganizationProvisionApi.provisionFor` from `@endora-commerce/mod-organizations/ports` answers `PersonalOrganizationProvisioned` — `{ id, administratorRoleId }` where it answered `{ id }`); self-registration of a company, an operator's direct member creation and invitation acceptance create the account with its role.

- 34485ae: Members, invitations, session views and addresses by organization role (`specs/170-organization-roles/`, WP-03). Breaking for an HTTP client:

  - Requests name a role by id, and every body is strict — a body that still sends `role` is `400 VALIDATION_FAILED`: `PATCH /api/v1/organizations/mine/members/:id/role` takes `{ roleId }` (was `{ role }`); `POST /api/v1/organizations/mine/invitations` and `POST /api/v1/admin/organizations/:id/members/invite` take `{ email, roleId? }` (was `{ email, role? }`; default: the organization's _Member_ role); `POST /api/v1/admin/organizations/:id/members` takes `roleId?` (was `role?`); `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` takes `{ roleId, expectedUpdatedAt? }` (was `{ role, expectedUpdatedAt? }`). A role of another organization is `404`.
  - Responses drop `role` (`organization_admin` / `regular_user`) and carry `organizationRole: { id, name, kind }`: the login answer, `GET /api/v1/me` and the invitation accept (each with `permissions: string[]`), the members and invitations lists, the operator's member roster and member answers. `GET /api/v1/admin/organizations/:id` also answers `predefinedRoles` (the organization's _Administrator_ and _Member_ role references), for a role select an operator without `organizations:read-roles` can fill.
  - Managing members and invitations is reserved to the _Administrator_ role (`403 FORBIDDEN` otherwise, whatever the role's permissions); a personal organization's member is its administrator, and inviting there is `422 VALIDATION_FAILED`.
  - `GET /api/v1/organizations/mine/invitations` no longer lists expired invitations, and an expired administrator invitation no longer counts as the way back in for `409 CANNOT_REVOKE_LAST_ADMIN_INVITE`, nor does a blocked administrator count as an active one.
  - Creating, editing and deleting an organization address needs the `addresses.manage` permission (`403 ORGANIZATION_PERMISSION_REQUIRED`).
  - Invitations are created and revoked by the audited Commands `organization_invitation.create` / `organization_invitation.revoke`; the operator's role change and _recover administrator access_ run `customer_account.change_role`. The hand-written audit actions `organization.invite`, `organization.invite_sent`, `organization.invite_revoke`, `customer_account.admin_role_change` and `organization.break_glass_admin_promoted` are no longer recorded.
  - The invitation e-mail shows the role's own label in the e-mail's language (#667).
  - A login whose guest-basket merge was skipped for permission answers `cartMerge.outcome = 'noop'` and keeps the `b2b_cart_anon` cookie.
  - `InvitationService` takes one `InvitationServiceDeps` object (was positional arguments) and `invite(actor, { email, roleId? })` (was `{ email, role? }`); `buildInvitationEmail` takes `roleLabel` and `organizationRoleId` (was `role`). `organizationsModule` requires `commandBus`, `organizationRoles`, `customerAccountRoles` and `resolveEmailLanguage`. `OrganizationContextService.loadCartApprovalPolicy` is removed.

- 4b7543c: Admin UI for organization roles (`specs/170-organization-roles/`, US 7). The Organization screen (`/organizations/:id`) gains a **Roles** tab for a company Organization, shown to an operator holding `organizations:read-roles` (read-only) or `organizations:manage-roles` (create, edit, delete — a held role is deleted only with a replacement role), with the permission editor grouped by module and a _History_ link to the Organization's audit log. The members table's role select and the invite and direct-create forms now offer the Organization's roles and send `roleId` instead of `role`; they read each member's `organizationRole` instead of `role`, and last-administrator protection keys off `organizationRole.kind`. The admin layer therefore needs the backend's `roleId` member endpoints of the same release.
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

- 16f85f4: Company registry lookup at storefront registration (`specs/173-registration-registry-lookup/`). A business registering on the storefront can fetch its legal name, address and VAT status from the public registry by tax ID, and the registration persists what the registry answered for moderation. **Off by default.**

  - New anonymous endpoints `GET /api/v1/organizations/registration-options` and `POST /api/v1/organizations/registry-lookup` (10 lookups per 10 minutes per client address; answers as an unknown route while the switch is off). Polish NIPs go to GUS REGON (BIR1.1) and/or the Ministry of Finance VAT White List, other EU VAT numbers to VIES; answers are cached in Redis and every registry has a platform-wide budget.
  - Three settings: `organizations.registration.registry_lookup_enabled` (default `false`), `organizations.registration.registry_lookup_pl_sources` (`gus_mf` — default — `gus` or `mf`) and `organizations.registration.gus_credentials`; a palette action opens them, and the Settings screen warns while `gus` is chosen with no GUS credential.
  - A new credential type, `organizations_gus_bir` (user key, secret; environment `production` / `test`), contributed to `credentials`' registry. `credentials` stays switchable: without it Polish lookups use the White List alone.
  - `POST /api/v1/organizations/register` accepts an optional top-level `registryLookupId`; with the switch on and a matching reference it writes one `organization_tax_id_validations` row with `origin: 'registration'` and stamps the organization's last-validation summary. Registration never fails or waits on the lookup.
  - Migration `Migration20261105T121034OrganizationsRegistryLookupProvenance` adds `origin` (default `'admin'`), `registry_details` and `submitted_values` to `organization_tax_id_validations` and admits the `gus_pl` provider.
  - The admin VAT validation history answers the new fields and a computed `divergence`; the panel shows the registry data at registration beside what was submitted, and a pending organization's moderation actions show how many fields differ.
  - `MinisterstwoFinansowClient` gains `search(nip)` and `ViesClient` gains `check(country, number)`, which their `validate()` now runs over. Two answers change for "Validate now": the White List's daily-limit (`WL-1919`) and maintenance (`WL-1188`) refusals are `deferred` (`rate_limited`, `provider_maintenance`) rather than `failed`, and a VIES answer naming a member-state outage (`userError` `MS_UNAVAILABLE`, `TIMEOUT`, …) is `deferred` rather than `failed` / `not_found`.

- 6f19230: **BREAKING — `POST /api/v1/admin/orders` and `POST /api/v1/admin/orders/preview` for a sales channel that is not one of the customer's Organization's active assigned channels now answer `422 ORDER_SALES_CHANNEL_NOT_ALLOWED`: a channel the Organization is not assigned to, or an inactive one, where they answered `201` / `200`, and a channel id that does not exist, where they answered `404 NOT_FOUND`. `GET` and `PUT /api/v1/admin/organizations/:id/sales-channels` for an Organization outside a sales representative's reach now answer `404 NOT_FOUND` where they answered `200`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range (issue #515).

  An order an operator creates on a customer's behalf is placed only on one of the customer's Organization's active assigned channels — the rule a quote request created on a customer's behalf has followed since the product data scopes release. The refusal comes before anything is written: no working basket, no inline address, no order. The order's `salesChannelId` stays required, so there is no defaulted channel to check; a request without it is still `400 VALIDATION_FAILED`.

  - `@endora-commerce/contracts`: `ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED`, declared by `orders` with an English and a Polish sentence.
  - `@endora-commerce/mod-orders`: `OrderCreationAdminService` takes the Organization channel read (`SalesChannelMembershipPort.listChannelsForEntity`) as a new sixth constructor argument, before `mailer`; composed without it, `create` fails closed with `500 INTERNAL`, as the preview already did. The _Create order_ screen offers the customer's Organization's active channels, read from `GET /api/v1/admin/organizations/:id/sales-channels` — the only one preselected, else a choice; a `salesChannelId` in the link kept only when it is one of them; a notice and a retry when the Organization has none or they cannot be read — instead of every active channel.
  - `@endora-commerce/mod-organizations`: the Organization sales-channel read and replace apply the request's tenant scope. A platform administrator reaches every Organization, as before; a sales representative only the ones assigned to them. The response shape is unchanged.
  - `@endora-commerce/mod-i18n`: the _Create order_ screen's channel notices (`orderCreate.channelsLoadError`, `orderCreate.noChannelWarning`, `orderCreate.hint.salesChannel`), in English and Polish.

  An instance whose operators create orders on channels their customers' Organizations are not assigned to will see those requests refused once it upgrades: assign the Organization to the channel first (the Organization's _Sales channels_ panel), or create the order on one of its channels.

- 8ad737c: `GET /api/v1/admin/organizations/:id/restrictions` and `POST /api/v1/admin/organizations/:id/vat-validations` answer `404 NOT_FOUND` for an Organization that does not exist, is soft-deleted, or whose id is not a UUID, as every other Organization route does. They answered `500` before (issue #793).
- 5af8c25: The customer anonymization sweep now finishes every subject an earlier scrub rule left incomplete (issue #923), not only the accounts never anonymized. Until now it picked its work by account, so a personal organization anonymized before the scrub covered its legal name, order-confirmation e-mails, custom field values or block and rejection reasons kept them for good once its account was done.

  `PersonalOrganizationPort` gains `listIncompletelyScrubbed(): Promise<string[]>`: the ids of the personal organizations that carry the scrub's name but not all of the current scrub. It reads only the `organizations` table, ignores the retention cutoff, and agrees field by field with the check `anonymizeIfOrphaned` makes before it writes. An implementation or a test fake of the port must add the method.

  `PersonalOrganizationPort` also gains `hasIncompletelyScrubbed(): Promise<boolean>`, the same rows as a yes-or-no question. The sweep's scheduled tick asks it, outside any tenant scope, when no account is due, so a tick with only organization-side work left is not skipped as idle. If that question fails, the tick runs anyway. An implementation or a test fake of the port must add it too.

  Each sweep run now works through the accounts due for anonymization, then the anonymized member of every organization that method lists, each subject once, through the unchanged cascade. Finishing a subject writes one audit entry for each record it changes, keeps the account's `anonymizedAt` and the organization's `deletedAt`, and announces nothing: no second `customer_account.anonymized.v1`, so Forms does not erase the customer's entries a second time. The next run then finds nothing to do. The count `AnonymizationSweepWorker.sweep()` returns is now the number of subjects processed, finished ones included.

  The `customers` module page now describes this.

### Patch Changes

- 18cce2e: The customer login response reports the new internal cart-merge outcome `skipped_permission` as `cartMerge.outcome: 'noop'`. Nothing produces that outcome yet.
- ca52dff: `MinisterstwoFinansowClient` calls the White List at its new host, `wykazpodatnikowvat.mf.gov.pl`, by default (`specs/173-registration-registry-lookup/`, research R-6). The Ministry of Finance moved the service there on 2026-10-15 and serves the old `wl-api.mf.gov.pl` only until 2026-12-01, after which the admin "Validate now" for Polish NIPs would have answered `deferred` / `network_error` on every attempt. Paths and response bodies are unchanged; a `baseUrl` passed to the constructor still wins.
- 3890037: The admin Organization `/:id` routes now apply the sales-representative visibility rule (issue #698). `Organization` is a global entity, so no tenant filter narrowed these routes, and a sales representative could open, edit, block, restrict and delete an Organization assigned to another representative. Every `/api/v1/admin/organizations/:id` route — reads and writes, the nested ones included (addresses, restrictions, applicable price lists, VAT validations, subtree, ancestors, sales channels, moderation, members, recover administrator access, delete) — now answers a sales representative only for an Organization assigned to them (expanded to the subtree under `organizations:rollup`), or one no representative is assigned to, such as a registration awaiting approval. Any other Organization answers `404 NOT_FOUND`, the same answer an unknown Organization gets; every admin now gets that `404` for an unknown id on `/addresses`, `/applicable-price-lists` and `/vat-validations`, which answered `200` before. `GET /api/v1/admin/organizations` is unchanged, and a platform administrator is unaffected.
- 2056a2e: The module page's _Roles on the storefront_ section now says that a personal (B2C) Organization's member is offered neither _Organization_ nor _Org addresses_ in the storefront account: `/organization` redirects to `/account`, `/organization/addresses` to `/addresses`, the profile shows no _Organization_ row, and the checkout's billing tax-id field starts empty instead of with the synthetic tax id. Documentation only; no code in the package changed.
- d591bbe: A personal (B2C) Organization is labelled for what it is rather than by its placeholder tax id (issue #767, owner ruling of 2026-11-05). The admin Organizations list and the Organization detail header show "Personal account" ("Konto osobiste") in place of the tax id. The admin order and quote request screens' _Organization_ panel show "Individual customer" ("Klient indywidualny") where the tax-id line was. The three strings are new core keys: `organizations.personalAccount`, `orderDetail.org.individualCustomer` and `rfq.detail.org.individualCustomer`.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
- a9398c8: The customer anonymization sweep is restartable (issue #800). It now scrubs a personal organization, then its saved addresses, and anonymizes the account last, so an account whose cascade was interrupted stays due and the next run completes it. Each account runs on its own: one that fails no longer stops the run, which anonymizes the others and then throws once, naming the failed account ids. A `ModuleDisabledError` still aborts the run.

  `PersonalOrganizationPort.anonymizeIfOrphaned` is convergent. It writes only the part of the scrub that is still missing, keeps an existing `deletedAt` (an operator's soft-delete), and records `organization.anonymized` in the same transaction as the scrub, only when something changed. It answers the organization on a repeat call too, and answers `null` only for an org-less account, a non-personal organization, or one that still has a live member.

  `POST /api/v1/admin/customers/:id/restore` answers `409 CUSTOMER_RESTORE_WINDOW_ELAPSED` once `customers.deletion_retention_days` has elapsed since the deletion, even before the sweep has anonymized the account. It used to succeed in that case. `CustomerDeletionService` takes the retention-days resolver as a new constructor argument. `CUSTOMER_RESTORE_WINDOW_ELAPSED` now has a sentence in English and Polish in `customer_accounts`' bundle, so both raise sites answer in the reader's language.

- 90a4a76: Documentation only: the storefront account page now shows the member's role in the profile summary, with _What your role allows_ opening the role's permissions in a dialog instead of a section in the page body (issue #801).
- 0b56038: The customer anonymization sweep now clears every field that can hold the person's data (issue #802). On a personal organization, `PersonalOrganizationPort.anonymizeIfOrphaned` also sets `legalName` to `null`, empties `orderConfirmationEmails` (so `orders` stops mailing those addresses) and clears all custom field values. A personal organization scrubbed by an earlier release is finished on the next sweep run. On the account, `CustomerAccountLifecycleWritePort.anonymize` also clears all custom field values.

  `CustomerAccountLifecycleWritePort.anonymize` now writes the scrub and its `customer_account.anonymized` audit entry in one transaction, and announces `customer_account.anonymized.v1` only after that commit. Before, the audit entry was written after the scrub had committed, so a crash between the two left an anonymized account with no audit entry.

  The two audit entries no longer store the data they erase. `customer_account.anonymized` no longer has `stateBefore.email`; its `stateBefore` is `{ anonymizedAt: null, customFieldKeys }`, the sorted keys that held a value. `organization.anonymized` no longer has `stateBefore.name`; its `stateBefore` records `wasDeleted`, `hadLegalName`, `orderConfirmationEmailCount` and `customFieldKeys` (the sorted keys that held a value).

- 57145f7: The customer anonymization sweep now erases the reasons operators wrote about the customer (issue #843). `PersonalOrganizationPort.anonymizeIfOrphaned` sets a personal organization's `blockedReason` and `rejectedReason` to `null`; `CustomerAccountLifecycleWritePort.anonymize` sets the account's `blockReason` to `null`. The block or rejection itself is kept: the status, `blockedAt`, `rejectedAt`, `blockSource` and who applied the block. A company organization keeps its reasons.

  The audit entries record only whether a reason existed: `organization.anonymized` gains `stateBefore.hadBlockedReason` and `stateBefore.hadRejectedReason`, and `customer_account.anonymized` gains `stateBefore.hadBlockReason`. None of them stores the reason text.

  A subject anonymized by an earlier release is finished on the next sweep run. `CustomerAccountLifecycleWritePort.listDueForAnonymization` now also lists an anonymized account that still has a block reason or custom field values (left by a scrub before #802), whatever the retention cutoff, so raising `customers.deletion_retention_days` cannot strand it. For such an account, `anonymize` clears what is left and writes one more `customer_account.anonymized` entry. That entry's `stateBefore.anonymizedAt` is the original anonymization time, where the first scrub's is `null`; `hadBlockReason` and `customFieldKeys` say what was left. It keeps `anonymizedAt` and does not announce `customer_account.anonymized.v1` again. A personal organization with a reason left is finished whenever the sweep reaches its account.

  The `customers` module page now describes this, and says that audit entries written earlier keep the reason they recorded until #844 ships.

- 289fc12: `GET /api/v1/admin/organizations/:organizationId/sales-reps` now answers by the same organization reach as every other `/api/v1/admin/organizations/:id` route (issue #856, following #698). A sales representative gets the list for an organization assigned to them (with `organizations:rollup`, for one whose nearest assigned ancestor is theirs) or for one no representative is assigned to. An organization assigned to another representative answers `404 NOT_FOUND`, like an unknown id, so its representatives' names and e-mail addresses are no longer readable. The route also answers `404` for a deleted organization, as the other `/:id` routes do. A platform administrator is not affected.
- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
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

- c73366c: The command-palette actions of `credentials`, `orders`, `organizations`, `quick_order` and `returns` keep only English `keywords` in their manifests; their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #560). A Polish operator finds the same screens by the same words. The template-variable samples `order.shippingAddressText` (`order_confirmation`) and `statusLabel` (`new_org_registration`) are English in the manifest and carry their Polish form under a `sampleValueKey`.
- 0f5bcde: The new-organization notification is no longer Polish on every installation.

  - `@endora-commerce/contracts` exports `supportedLanguageOf(tag)`: the shipped language
    (`'en'` or `'pl'`) a BCP-47 tag such as a sales channel's `defaultLanguage` is written in,
    `LANGUAGE_FALLBACK` for any other.
  - `mod-organizations`: the admin bell entry recorded when an organization registers carries an
    English `title`/`body` and a `titleMessage`/`bodyMessage` key, so each administrator reads it
    in their own language (a Polish administrator sees the same text as before). The fallback
    e-mail sent when no `new_org_registration` template is defined, and the `statusLabel`
    variable passed to that template, are written in the system-default sales channel's
    language from the module's bundle, English when the bundle cannot answer. On a channel whose
    default language is Polish the e-mail is unchanged. New bundle keys:
    `notifications.newRegistration.*`. `OrgRegistrationNotifier` takes two optional
    dependencies, `translate` and `resolveLanguage`.

- 04fa275: The customer-safe moderation sentences are answered in the request's language.
  `GET /api/v1/me`'s `organization.moderationMessage` and the 423 `reason` of
  `POST /api/v1/storefront/checkout/preflight` were Polish whatever the request; they are now
  written in the language the response is answered in (`request.responseLanguage()`: the
  `Accept-Language` the storefront sends, else the sales channel's default language) from the
  module's bundle, English when the bundle cannot answer. A Polish request receives the same
  sentences as before. New bundle keys: `moderation.account.*`, `moderation.checkout.*`.
  `organizationsModule()` takes an optional `translate`.
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

- 14bcf1d: Every consumer prices on price books (feature 160, D-287 P1), through the one batched resolution chain.

  - **carts** — `cart_items.price_source` (migration `…_carts_cart_items_price_source`) records which tier priced a line (`agreed | base | catalogue | buyer | sale`). `CartLinePricing.orderablePrices` drops the product's own price step, passes the variant, and stores the source.
  - **orders** — `order_items.price_source` (migration `…_orders_order_items_price_source`) is copied from the cart line at placement. The admin order preview and the external order intake price through `resolveLinePrices` instead of one `resolveLinePrice` per line; a line no price book prices is refused, with no `defaultPrice` fallback.
  - **organizations** — the effective price lists of an organization are its effective **price books**: `PriceListReadPort.listForOrganization({ organizationChain, customerGroupId })` answers the books whose audience holds the organization, an ancestor or its group, each with `reason` and `depth`. Old: `listActive()` plus `evaluateApplicationRule` per list. New: one `listForOrganization` call.
  - **product_feeds** — a feed pinned to a price book publishes that book's rows over the channel's catalogue price (`namedListPrices` takes the feed's `salesChannelId`); a product the book does not price is absent.
  - **search** — hits and suggestions price through the batched listing resolution; suggestions pass the request currency.
  - **quote_requests** — reference prices are resolved in the request's currency; the RFQ create prefill and the reference probe call `POST /api/v1/admin/price-books/resolve` instead of `GET /api/v1/admin/products/:id/resolved-price`.

### Patch Changes

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

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

- ac24f80: A new Organization gets the sales channel of the store it was created on. A business registered
  through `POST /api/v1/organizations/register` is assigned exactly the request's resolved channel,
  also on a channel closed to anonymous visitors; without a request channel it gets the system
  default. A personal Organization provisioned for an individual registration is assigned the
  channel passed in `PersonalOrganizationProvisionInput.salesChannelId` (the system default when it
  is `null`), in the caller's transaction. Accepting an invitation leaves the Organization's
  channels unchanged.

  `PersonalOrganizationProvisionInput` (`@endora-commerce/mod-organizations/ports`) gains a
  required `salesChannelId: string | null`. A caller of `provisionFor` passes the channel of the
  store the account registers on, or `null`:

  ```ts
  // before
  await provision.provisionFor(em, { customerAccountId, email });
  // after
  await provision.provisionFor(em, { customerAccountId, email, salesChannelId: null });
  ```

- 248a9df: Every Organization is assigned the sales channels its members may use. A data migration assigns
  each existing Organization the system-default channel plus every channel it has orders on
  (`Migration20261018T104644OrganizationsChannelAccessBackfill`, idempotent, keeps earlier
  assignments). A registered business and a personal Organization are bound to the system-default channel
  when they are created. Customer sign-in and sign-out, password
  reset, e-mail verification, business registration and invitation acceptance are declared
  reachable whatever the sales-channel access rule decides.
- afaa86a: Operators manage which sales channels an Organization's members may use.

  - `GET`/`PUT /api/v1/admin/organizations/:id/sales-channels` (read with `customers:read` or
    `customers:manage`, write with `customers:manage`) answer the assignment with every channel option
    and replace the whole set through the kernel membership writer: one audit row per channel added or
    removed, the access cache dropped, the same set again a no-op. An id naming no channel is refused
    with 422 `VALIDATION_FAILED` on `salesChannelIds.<i>`.
  - `POST /api/v1/admin/organizations` (`customers:manage`) creates an Organization through the
    Command `organization.create` and assigns its channels in the same transaction; a duplicate tax id
    is refused with 409 `ORGANIZATION_TAX_ID_EXISTS`, as in registration.
    `GET /api/v1/admin/organizations/sales-channel-options` lists what the form chooses from.
  - Admin: a _Sales channels_ panel on the Organization page (read-only without `customers:manage`),
    a _New organization_ screen at `/organizations/new` with a button on the roster, and the palette
    action `new-organization`.
  - `OrganizationsModuleOptions.salesChannelMembership` now also takes `replaceChannelsForEntity` and
    `listChannelsForEntity`.

### Patch Changes

- 649fe8d: Documentation for sales-channel access (`specs/154-sales-channel-access/`), shipped in each
  package's `docs/` directory, English and Polish.

  - `@endora-commerce/mod-sales-channels`: the access rule (anonymous visitors only on channels open
    to them, customers only on channels assigned to their Organization), the _Open to anonymous
    visitors_ option, `GET /api/v1/storefront/sales-channel/access`, and a corrected multi-storefront
    section. The developer guide tells module authors to declare
    `config: { salesChannelAccess: 'open' }` on every provider callback their module receives
    (payment gateway notifications, carrier webhooks, provider return URLs) — such requests arrive
    without a session and are refused on a store closed to anonymous visitors otherwise — and
    describes `SalesChannelAccessPort`.
  - `@endora-commerce/mod-organizations`: the _Sales channels_ panel, the _New organization_ screen,
    which channel a new Organization gets, and that invitations change no channel.
  - `@endora-commerce/mod-carts`: one basket per store, and the `ORDER_SALES_CHANNEL_MISMATCH`
    refusal at order placement.

- 1525d86: Customer sign-in, the customer second factor and password-reset requests are now limited per
  account, the way administrator sign-in already was.

  - `@endora-commerce/platform/kernel` publishes `AuthenticationAttemptThrottle`, the attempt
    counter administrator sign-in used, with the profile types an owner of accounts builds one
    over (`AttemptThrottleProfile`, `AttemptPolicy`, `AttemptCounterStore`, `ThrottledAttempt`,
    `ThrottledCheckResult`, `ThrottledCredentialState`) and `ADDRESS_POLICY`, `ACCOUNT_POLICY`,
    `ABANDONED_AFTER_SECONDS`, `DEFAULT_STORE_DEADLINE_MS`, `addressOrigin`. `admin_users`' own
    throttle is now a profile over it; its keys, cookie values, codes and audit rows are unchanged.
  - `@endora-commerce/contracts` adds `CustomerAuthenticationThrottlePort` (container name
    `customerAuthenticationThrottlePort`, owner `customer_accounts`) with
    `CustomerAuthenticationAttempt`, `CustomerAuthenticationCheckResult`,
    `CustomerAuthenticationOrigin` and `CustomerAuthenticationFactor`; the error codes
    `CUSTOMER_AUTHENTICATION_THROTTLED` (429, with `Retry-After`) and
    `CUSTOMER_AUTHENTICATION_UNAVAILABLE` (503); the cookie name
    `CUSTOMER_KNOWN_DEVICE_COOKIE_NAME` (`b2b_customer_device`) and its lifetime. Optional
    additions: `CustomerLoginInput.knownDevice`, `CustomerLoginResult.knownDevice`, and a second
    `context` argument on `CustomerPasswordResetPort.requestReset`.
  - `customer_accounts` counts wrong passwords per folded e-mail address (50 in 30 minutes from a
    device the account has not signed in on, 10 from a known one), and password-reset requests per
    address (5 an hour). There is no per-address counter: the storefront signs shoppers in from its
    own server. A completed sign-in sets the signed `b2b_customer_device` cookie, and an attempt
    carrying it is held to that device's own budget. Asking for a new reset link retires the
    earlier unused ones.
  - `mfa` checks customer second-factor codes inside the customer throttle (20 in 30 minutes,
    10 from a known device) and sets the customer known-device cookie when a customer sign-in
    completes there.
  - `organizations` reads and sets the customer known-device cookie on
    `POST /api/v1/auth/customer/login` and reads it on `POST /api/v1/auth/password-reset/request`.

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

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

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

### Minor Changes

- 08192f0: **An administrator always holds a role, and one without a role is refused.** An administrator's
  permissions and the organizations they reach are both read off the role the account holds. An
  account with no role used to be treated as reaching every organization; it now reaches none and is
  refused by name.

  **After upgrading, an administrator account that has no role is refused until it is given one.**
  Accounts are deliberately not given a role by the upgrade — any default would grant access nobody
  chose. The instance logs a warning at every boot naming how many accounts are affected. To repair
  one:
  - from the Admin UI, on the Users screen, choose a role for the account; or
  - from the command line, which is the way when no administrator can sign in:
    `pnpm run admin:create -- --email=<their e-mail> --password-stdin --first-name=<f> --last-name=<l> [--role=<code>]`.
    The command updates the existing account, sets the password it is given and assigns
    `platform_admin` unless `--role` names another role.

  What an operator sees for such an account: every permission-gated admin route answers 403
  `ADMIN_ROLE_REQUIRED`, and so does the first read of organization data on any other route. The
  account can still sign in, read `GET /api/v1/admin/me` (which answers `role: null`) and sign out.

  **Every instance has the platform-administrator role.** `platform_admin` — shown as _Platform
  administrator_ / _Administrator platformy_ — holds every permission. Installing
  `@endora-commerce/mod-admin-roles` creates it and every boot ensures it exists with full access, on
  an instance with or without demo data. It cannot be deleted (409 `ADMIN_ROLE_PROTECTED`), whether
  or not anybody holds it, and withdrawing the demo data no longer removes it. The role code is
  unchanged; an operator's own rename of the role is kept.

  **The admin surface no longer produces an account without a role.**
  - `POST /api/v1/admin/admin-users` requires `adminRoleId`; without one it answers 400
    `ADMIN_USER_ROLE_REQUIRED`. A client that created accounts and assigned the role afterwards must
    send the role with the create.
  - `PATCH /api/v1/admin/admin-users/:id` with `adminRoleId: null` answers 400
    `ADMIN_USER_ROLE_REQUIRED`. A role is changed for another, never cleared.
  - The Users screen requires a role when creating an account and offers no "unassigned" choice for
    an account that has one.

  For code that consumes the packages:
  - `ERROR_CODES` gains `ADMIN_ROLE_REQUIRED` (declared by `admin_roles`) and
    `ADMIN_USER_ROLE_REQUIRED` (declared by `admin_users`), each with an `en` and a `pl` sentence.
  - `PermissionReadPort` (container name `permissionService`) gains
    `resolveRole(adminUserId): Promise<AdminRoleResolution>`, which answers `{ role }` or
    `{ refusal }`. An implementation of the port must add it.
  - `hasPermission` on that service **throws** the 403 `ADMIN_ROLE_REQUIRED` refusal for an active
    administrator with no role, where it used to answer `false`. An unknown or inactive
    administrator is still `false`.
  - `AdminTenantScope`'s confined member gains an optional `unresolved: Error`.
    `adminTenantScopePort.resolveForAdmin` no longer answers `{ allowAll: true }` for an id that
    names no live administrator or for an administrator with no role: it answers
    `{ allowAll: false, allowedOrganizationIds: [], unresolved }`, and the platform's tenant guard
    raises `unresolved` on the first tenant-scoped read.
  - `@endora-commerce/mod-admin-roles` exports an `installHook`.

### Patch Changes

- f052b7f: **Tenant isolation fix for scaffolded instances — upgrade.** Every instance scaffolded from the
  published packages up to and including 0.102.0 is affected. In such an instance requests were not
  confined to the organization of the customer or API key making them, and an admin's scope was not
  resolved from the admin's role: every request ran in the platform's system tenant scope, and
  audit entries written through the Command Bus did not record the acting admin. The fix is to
  upgrade; nothing in the instance has to be edited.

  **Upgrade all `@endora-commerce/*` packages together.** The platform reads the admin's scope
  from a port `@endora-commerce/mod-organizations` registers from this version on. With the
  platform upgraded and that package left behind, every admin — a platform administrator included —
  is confined to no organization and organization-scoped screens are empty; the platform logs a
  warning at boot naming `adminTenantScopePort` when that is the case.

  `composeApp` used to leave the actor → tenant-context mapping to its caller and fall back to a
  system context when none was supplied, which is what an instance's entry point does. The mapping
  is the platform's own now and every composition gets it:
  - a customer is confined to its organization, widened to that organization's subtree only for an
    account with roll-up enabled;
  - an admin gets the scope its role resolves to — every organization, or the organizations
    assigned to a sales representative;
  - an API key bound to an organization is confined to that organization and its service account;
  - system scope remains for a request that identifies nobody (anonymous traffic, an unbound API
    key) and for work with no request at all.

  It fails closed. A composition that does not register the ports the mapping reads confines
  rather than widens: a customer stays on its own organization and an admin reaches no
  organization. The same holds for an admin while `organizations`, `admin_users` or `admin_roles`
  is absent: the admin holds no organization, routes over global data keep answering, and a route
  that reads organization data answers 503 `MODULE_DISABLED` naming the absent module.

  A browser may hold an admin session and a customer session at once — an operator who is also
  signed in to the storefront, and every request made while impersonating a customer. The route
  decides which of the two a request runs as: an admin route runs in the admin's scope and a
  storefront route in the customer's, whichever cookies are present. Admin screens are therefore
  unaffected by a customer session in the same browser.

  For a host that composes the platform itself:
  - `ComposeAppOptions.buildTenantContext` is still accepted and should normally be omitted. A
    supplied mapping is now refused, and the request fails, when it answers a customer or an API
    key bound to an organization with a `system` or `all` context, or an admin with a `system`
    context.
  - `@endora-commerce/mod-organizations` registers a new port, `adminTenantScopePort`
    (`AdminTenantScopePort` and `AdminTenantScope` in `@endora-commerce/contracts`):
    `resolveForAdmin(adminUserId)` answers `{ allowAll: true }` or
    `{ allowAll: false, allowedOrganizationIds }`. The platform reads it by container name; a
    composition that replaces `organizations` should register its own.

- f2a2dca: A newly created organization is stored with the tree path of a root, `/<id>/`, and the tree
  service no longer trusts a stored path it cannot read.

  **Who is affected.** Any instance holding organizations that were created by company registration,
  as the personal organization of a B2C account, or by the demo seed, and never re-parented since.
  Those rows were stored with an empty `organizations.path`.

  **What was wrong for such an organization.**
  - Its subtree was read too wide. That affects `GET /api/v1/admin/organizations/:id/subtree`,
    sales-rep subtree assignment, and the scope of a customer account with `subtreeRollupEnabled`.
  - `POST /api/v1/admin/organizations/:id/parent` refused every move with
    `422 ORGANIZATION_TREE_INVALID` (`cycle`).

  **What changes.**
  - The `Organization` entity assigns the root path on create.
  - A new migration, `Migration20261003T184802OrganizationsRepairEmptyPaths`, runs on the next
    `endora upgrade` or `pnpm run setup`. It rewrites `path` from the `parent_id` chain for every row
    where the two disagree and bumps that row's `version`; a row that was already right is not
    written.
  - `OrganizationTreeService` judges a stored path before using it (`isReadableTreePath`, exported).
    For an organization whose path is empty or malformed, `subtreeIds` and `subtreeNodes` answer
    that organization alone, `ancestorIds` answers none, and a re-parent involving it is refused with
    `409 ORGANIZATION_TREE_INVALID` and the new token `path_unreadable`, whose `details` name the
    organization. The token has its sentence in English and Polish.

  **If any customer account on your instance has `subtreeRollupEnabled` set, apply this release.**

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
- 489a0b6: Documentation: two pages said their wiring was done in `composition.ts`. The megamenu module
  registers its CMS and asset reference scanners in its own boot hook, and the promotions gate on
  organization status is a required `PromotionService` argument that the `promotions` module wires
  to `organizationReadPort.loadEffectiveOrganization`, not a raw SQL lookup.
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

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
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

## 0.11.4

### Patch Changes

- 4b1844c: Reword a manifest comment: `delivery_methods` and `payment_methods` are
  described as optional modules. No behaviour change.
- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.11.3

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

## 0.11.2

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.11.1

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

## 0.11.0

### Minor Changes

- b8ad861: Sales-rep assignment and organization parentage are platform-admin writes — a scoped admin now gets `403`

  **If your operator has a scoped admin role that assigns sales representatives or moves
  organizations in the tree, this release makes those calls fail with `403 FORBIDDEN`.**
  Three route handlers changed; no entity, service, DTO or migration did.
  - `POST /api/v1/admin/organizations/:organizationId/sales-reps`
  - `DELETE /api/v1/admin/organizations/:organizationId/sales-reps/:adminUserId`
  - `POST /api/v1/admin/organizations/:id/parent`

  All three were gated on a `requireAdmin(...)` permission code alone, and a permission code is
  not a tenancy boundary. `OrganizationSalesRepAssignment` is the table that _defines_ an
  `allowed-set` actor's `allowedOrganizationIds`, and `Organization.parentId` is what the
  roll-up capability expands over, so an actor resolving to `allowed-set` could widen **its own
  authority**: measured at `[orgA] → [orgA, orgB]` by one self-assignment (answered `201`) and
  again by one re-parent (answered `200`). Both entities are `@GlobalEntity` and correctly so —
  the assignment table cannot be `@OrgScoped` without circularity — so no classification and no
  column filter could reach either write.

  What changes for a consumer, in the order you will meet it:
  - **The three routes require `mode: 'all'`.** A platform admin and a `system` caller are
    unaffected and keep writing across organizations exactly as before. An `allowed-set` or
    `single-org` actor is refused `403 FORBIDDEN` with a message naming no organization.
  - **The refusal is categorical, including for the actor's own organization.** Assigning a
    second representative to an organization you already hold still edits the graph that decides
    who holds what. The graph is the boundary, not an operation inside it.
  - **The gate answers before the existence lookup**, so the refusal does not depend on the
    organization or the admin user being there, and the response is the same either way.
  - **Only the routes moved.** `SalesRepAssignmentPort.assign` / `.unassign` are unchanged, so an
    ERP import or an install hook calling the exported service — `comarch_xl`'s contractor apply
    is one — keeps working under its own `system` scope.

  `minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
  series a minor already takes every caret dependent out of range, which is the consumer-facing
  meaning of the break.

  Implements D-260's rule that a write which changes the acting principal's own authority cannot
  be authorised by that authority. The idiom is this module's own credit-inheritance-mode
  handler, which already required `mode: 'all'` on the weaker argument of a money-behaviour
  switch.

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
  - @endora-commerce/email-components@0.9.1
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
  - @endora-commerce/email-components@0.9.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

### Patch Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

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

- 72013ed: Published `OrganizationTaxProfilePort`, and moved the error envelope's assembly into the
  platform.

  **`@endora-commerce/contracts` gains `OrganizationTaxProfilePort`.** It described the
  `organizationTaxProfilePort` container name and was declared by
  `@endora-commerce/mod-organizations/backend`, so a consumer resolving that port had to name
  the provider's own package to spell the type — which is the reach a port exists to remove,
  and which `@endora-commerce/platform` may not write at all. The declaration is unchanged
  member for member.

  ```diff
  -import type { OrganizationTaxProfilePort } from '@endora-commerce/mod-organizations/backend';
  +import type { OrganizationTaxProfilePort } from '@endora-commerce/contracts';

   const taxProfile = lazyPort<OrganizationTaxProfilePort>(ctx, 'organizationTaxProfilePort');
  ```

  **`@endora-commerce/mod-organizations/backend` no longer exports it**, and that is the
  breaking half. A re-export was written and withdrawn: a barrel re-exporting a name whose
  source is another package makes _"does this barrel carry an entity class by name"_ unknown
  rather than false, which D-168 may not be wrong about, and two spellings for one type is the
  shape this repository removes rather than adds. Change the specifier; the type is
  unchanged.

  **`@endora-commerce/platform/composition` gains `composeErrorEnvelopeOptions` and loses
  `createRequestLanguageResolver`.** The two callbacks a composition root passes to
  `registerErrorEnvelope` — the language ladder and the translation lookup — were assembled
  by each root itself, identically, in twenty lines apiece. They are one function now, and
  what a root supplies is only what a root knows: its own resolved error-code routing table
  and the two container names the callbacks read.

  ```diff
  -errorEnvelope: {
  -  errorTranslationTargets: routing.targets,
  -  resolvePreferredLanguage: createRequestLanguageResolver({
  -    adminPreferredLanguage: async (id) =>
  -      (await adminUserReadPort().findById(id))?.preferredLanguage ?? null,
  -  }),
  -  translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
  -    const t = await i18n().translate(moduleId, key, language, params);
  -    return t === `${moduleId}.${key}` ? originalMessage : t;
  -  },
  -},
  +errorEnvelope: composeErrorEnvelopeOptions({
  +  errorTranslationTargets: routing.targets,
  +  adminUserReadPort: () => identityPorts().adminUserReadPort,
  +  translate: () => cradle().adminI18nService,
  +}),
  ```

  `createRequestLanguageResolver` is off the barrel because no composition root constructs it
  any more; the ladder it builds is unchanged and is now built inside the assembly. If you
  called it directly, call `composeErrorEnvelopeOptions` instead. Both are on `./composition`,
  which is host-internal — no module may name it — so this affects a host and never a module.

- 6e037cd: The module declares its demo data: `manifest.demo` creates the buying organisation the demo shop
  trades with, and withdraws it again.

  `endora demo seed` now reports `organizations` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
  nothing is loaded by the processes that merely compose the platform, and the module gained no
  `exports` subpath, no `files` entry and no manifest `dependencies` entry.

  **The withdrawal changed, and on this table it is the sharpest repair in the batch.** The host's
  demo reset cleared `organizations` with a `truncate … cascade`, and an organisation is the tenant
  every buyer, address, cart, quote request and order hangs off — so one word took a developer's
  entire test tenancy with it, silently, on every seed. The reset now deletes only the tax id
  `seed` assigns.

  **The demo buyer and the demo credit limit are not this module's demo data.** Each is another
  module's row against this one's, so each stays with the instance composition.

  Seeding twice creates nothing the second time and reports the same count.

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

- 94e8f3f: Publish `OrganizationTreeService`, `TargetValidatorDeps` and `StorefrontDeps`
  from each package's `./backend` subpath.

  The composition root contributes these shapes and must name their types. It
  reached the source files by relative path, which is `TS6059` under the
  backend's build `rootDir` — even for an `import type`, since a type-only
  import still joins the program — so `pnpm --filter backend run build` was red
  and the production image could not be built.

- cf97e05: The organization approval and rejection e-mails are sent in the recipient's language.

  Both were composed as hard-coded Polish sentences inside
  `OrganizationModerationService` and handed straight to `EmailMailerPort.send` with no
  code, no template and no language, so a buyer on an English sales channel received
  Polish unconditionally.

  The module now declares two transactional e-mails, `organization_approved` and
  `organization_rejected`, ships `en-US` and `pl-PL` content for both, and routes the two
  messages through `templateEmailPort`, which resolves the language from the
  system-default sales channel and falls back to `en-US`. English is the primary copy and
  the fallback tier; the Polish is the copy these messages already shipped.

  `OrganizationModerationService`'s constructor takes an eighth argument, the
  `TemplateEmailPort` adapter. It is optional and defaults to the no-op, so an existing
  caller keeps compiling and keeps sending — through the English in-code builders, which
  remain as the tier reached when the platform holds no definition for a code.

- efa4111: Six more modules become workspace packages (feature 080, T040b batch five):
  `admin_actions`, `admin_roles`, `admin_users`, `megamenu`, `organizations` and
  `price_lists`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the fifty-three packages before them.

  **`@endora-commerce/mod-organizations` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `PersonalOrganizationProvisionApi` and `PersonalOrganizationProvisionInput`
  instead of reaching into the owner's directory.

  ```ts
  import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
  ```

  The implementation stays behind the container name
  `personalOrganizationProvisionPort`, resolved with `lazyPort`, so the gate that
  answers 503 `MODULE_DISABLED` when `organizations` is switched off is still the
  registration and not a call anyone has to remember to write.

  **Three packages publish a runtime binding by name, beside the `entities`
  array.** D-168 keeps entity classes off `./backend`; these are not entities, and
  each is exported because a host program must hold the _same_ copy the platform
  composed rather than a second one evaluated from source (D-160.6.1):
  - `@endora-commerce/mod-admin-roles/backend` — `PermissionCatalogueService`,
    `listAssignablePermissionCodes`, and the inventory scanner
    (`ConstantResolver`, `defaultScanRoots`, `scanEnforcedPermissionCodes`,
    `scanEnforcedPermissionGates`). The acceptance instance probe and
    `check:action-route-permissions` read them.
  - `@endora-commerce/mod-price-lists/backend` — `DefaultPriceListMigrator`,
    `DEFAULT_PRICE_LIST_ID` and `PriceListService`. The development catalog seed
    runs the migrator; a second copy would `em.create` a `PriceList` class the ORM
    never registered, which fails at the first insert rather than at load.

  **Nothing about a module's behaviour changed.** No manifest `dependencies` array
  moved, so the migration order is the same function of the same inputs: the
  committed registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base over all 164
  entries.

### Patch Changes

- d7dca40: Error-code ownership: `organizations` declares the eight codes it owns and ships its first i18n
  bundle.

  `CANNOT_REVOKE_LAST_ADMIN_INVITE`, `EMAIL_ALREADY_IN_ORGANIZATION`,
  `EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION`, `ORGANIZATION_HAS_CHILDREN`, `ORGANIZATION_SUSPENDED`,
  `ORGANIZATION_TAX_ID_EXISTS`, `ORGANIZATION_TREE_INVALID` and `ORG_OWNER_DEPLETION` move from
  `@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-organizations`'. For a consumer the
  observable difference is **which bundle answers for them**: the sentences are no longer served from
  the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
  ships `@endora-commerce/mod-organizations` gets them and one that does not gets the raising code's
  own English. Two of the eight are raised by another module — `ORG_OWNER_DEPLETION` by
  `@endora-commerce/mod-customers` and `ORGANIZATION_SUSPENDED` by `@endora-commerce/mod-orders` — so
  for those two the sentence and the raise now ship in different packages.

  Five of the eight arrive with prose written for the first time; they carried a machine-shaped
  restatement of their own code (`"Organization Suspended."`), which is deleted rather than moved.
  `ORG_OWNER_DEPLETION` had no sentence in either language and now has one.

  **Three token sub-keys are new and are the ones the error envelope actually reads.** Every raise of
  `ORGANIZATION_HAS_CHILDREN` and `ORGANIZATION_TREE_INVALID` carries a `details.code`, so the
  envelope looks up `errors.<CODE>.<token>`: `errors.ORGANIZATION_HAS_CHILDREN.has_children`,
  `errors.ORGANIZATION_TREE_INVALID.cycle` and `errors.ORGANIZATION_TREE_INVALID.max_depth_exceeded`.
  Until now only the base keys existed and neither code rendered a translated sentence at all.

  **The 422 `ORGANIZATION_TREE_INVALID` depth response now carries `details.maxDepth`** beside its
  `code`, a number. It carried the token alone before, while the English message named the bound —
  so a translated sentence had no way to say how deep is too deep. This is additive; the member is
  `maxDepth` and never a second `code`, which is the refusal token.

  **`cycleRefusal()`, `maxDepthRefusal(maxDepth?)` and `hasChildrenRefusal()` are new exports** of
  `@endora-commerce/mod-organizations/backend`'s `services/organization-tree-service.js`. They are the
  refusals the tree rules and the admin delete route already threw, extracted as pure functions for
  the reason `@endora-commerce/mod-admin-roles`' `roleInUseRefusal` was: only a test that renders a
  real refusal against the bundle can see that the token, the key and the placeholder agree.

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
