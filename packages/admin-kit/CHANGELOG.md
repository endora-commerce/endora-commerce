# @endora-commerce/admin-kit

## 0.112.0

### Minor Changes

- d908737: The admin customer detail's **Impersonate** now asks for an optional reason before it starts a support session, and sends it with the start, so it is stored outside the audit log. After the start the screen says the session is open, links to the storefront and offers **End support session**. It does not offer a second start while that session is open. A refused start stays in the dialog with the refusal (issue #1328).

  The **E-mail language** row names the language in the admin's language, for example "English (US)", with the tag beside it.

  `@endora-commerce/admin-kit/lib` exports `storefrontBaseUrl`, the storefront origin read from `VITE_STOREFRONT_BASE_URL` (default `http://localhost:3000`).

- b2cd2d3: `@endora-commerce/admin-kit/ui` publishes `FormField` and `HelpTip` (issue #1432).

  `FormField` renders a label, its control, a one-line hint and an error, and wires them together: it generates the control's `id`, points the `<label>` at it, links the error, hint and description through `aria-describedby`, marks the control `aria-invalid` when there is an error and `aria-required` when the field is `required`. The child is cloned with that wiring — `Input`, `Select`, `Textarea`, `Checkbox`, or any component that forwards `id` and `aria-*` — or, for a control that needs it elsewhere, the child is a function receiving it as `FormFieldControlProps`:

  ```tsx
  <FormField label={t('field.email')} hint={t('field.emailHint')} error={errors.email} required>
    <Input type="email" value={email} onChange={onEmail} />
  </FormField>
  ```

  `group` labels a composite control (`role="group"` named by the label); `help` puts a longer explanation behind a `HelpTip` beside the label; `description`, `labelAddon`, `action` and `describedBy` cover editor rows that carry more than a label. `HelpTip` is the ⓘ disclosure on its own, for a page header or a table column.

  `core` gains `common.formField.required` and `common.helpTip.label`, in English and Polish.

- e78d27d: `@endora-commerce/admin-kit/lib` exports `defineEnumLabels(keys)`, with the types `EnumLabels<V>` and `EnumTranslate`. A module declares an enum once, as a map from each value its API sends to the catalogue key that names it. It then renders `labels.label(t, value)` and builds a filter from `labels.options(t)`. A value the map does not declare is shown as itself rather than as a missing-key placeholder, and an empty value is shown as a dash. Pass the published union as the type argument (`defineEnumLabels<RfqStatus>({ … })`) to make a missing value a type error.
- 596ce81: A status is no longer changed by a select that writes as soon as an option is picked (issue #1435).

  - `@endora-commerce/admin-kit/components` exports `StatusChangeControl` and the types `StatusChangeControlProps` and `StatusChangeOption`. It shows the current value as a badge with a "Change…" button. The button opens a dialog that lists only the allowed targets as radio options. The write runs only after a confirmation step that names the change from one value to the other. `onConfirm(to)` does the write. If it rejects, the dialog stays open and shows `errorMessage(error)`. While the write runs, the dialog is busy. With no targets, or with a `disabledReason`, the button is disabled and the reason is shown as its description.
  - `@endora-commerce/mod-i18n` ships the control's strings under `common.statusChange.*` (en, pl), and the order detail screen's under `orderDetail.statusChange.*`.
  - `@endora-commerce/mod-orders`: the order detail screen changes the order status and the payment status through this control (issue #1470). The order status dialog offers the configured transition graph's outgoing transitions. The payment status dialog offers the values `POST /api/v1/admin/orders/:id/payment-status` accepts, except the current one. The payment status stays editable by hand when the `payments` module is on, for bank transfers. Both changes are disabled, with the reason shown, for an administrator without `orders:write`. The routes, their permissions and their audit entries are unchanged. Status names follow the admin language. The helper `paymentStatusOptions` in the module's admin layer is replaced by `paymentStatusTargets`; it was not exported from the package.

- b2b41eb: `PageHeader` in `@endora-commerce/admin-kit/ui` gains `help`, and its `description` is one line (issue #1436).

  - `description` stays optional and is now clamped to one line (`line-clamp-1`). Give one only when it says something the screen does not show; longer text belongs in `help`.
  - `help` renders a `HelpTip` (ⓘ) beside the title, named after it ("More information: <title>"), outside the `h1`.
  - `back` accepts an optional `onClick`, which runs before the navigation; `event.preventDefault()` holds it, so an editor can ask about unsaved changes first.

  **Removed from `theme.css`:** the `.b2b-page-head`, `.b2b-page-head__back`, `.b2b-page-head__title`, `.b2b-page-head__sub` and `.b2b-page-head__actions` classes, including their mobile rules and the `.b2b-page-head__actions.b2b-sticky-form-actions` button grid. A module that renders them gets unstyled markup and no `h1`. Replace the markup with `PageHeader`:

  ```tsx
  // before
  <div className="b2b-page-head">
    <div className="b2b-grow">
      <div className="b2b-page-head__title">{t('page.title')}</div>
      <div className="b2b-page-head__sub">{t('page.description')}</div>
    </div>
    <div className="b2b-page-head__actions">{actions}</div>
  </div>

  // after
  <PageHeader title={t('page.title')} description={t('page.description')} actions={actions} />
  ```

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

- cec9beb: `@endora-commerce/admin-kit/components` publishes `ListToolbar`, `ListToolbarSearch` and `FilterChip` (issue #1440, UX audit DS-06), with the `AppliedFilter`, `ListToolbarProps`, `ListToolbarSearchProps` and `FilterChipProps` types.

  `ListToolbar` is a list page's filter row, extracted from the Orders list's toolbar and the Tasks list's "More filters (n)" disclosure. It renders a `search` landmark named by `label`, holding `search`, the three or four primary `filters` and the list's own `actions` (saved views, the column picker) pushed to the right. `moreFilters` folds the rest behind a **More filters** button that shows `moreFiltersActiveCount` as **More filters (n)** while it is closed. The panel is always mounted, so `aria-controls` names an element, and its controls render only while it is open. `appliedFilters` lists each applied filter as a removable chip named "Remove filter: …", and `onClearFilters` adds **Clear all filters**. The toolbar draws no frame of its own, so the page decides the card and border around it.

  `ListToolbarSearch` is the toolbar's search box. It is `type="search"`, named by `label` rather than by its placeholder, and its icon is decorative.

  `FilterChip` is a one-press filter toggle: a `<button type="button" aria-pressed>` in the theme's `b2b-filterchip` style, controlled through `pressed` and `onPressedChange(next)`. On a coarse pointer it has a 44 px hit area. A filter with several values belongs in a labelled `Select` or `MultiSelect`, not in a chip.

  ```tsx
  <ListToolbar
    label={t('orders.toolbar.label')}
    search={<ListToolbarSearch label={t('orders.field.search')} value={q} onValueChange={setQ} />}
    filters={<MultiSelect ariaLabel={t('orders.field.status')} … />}
    actions={<SavedViewsControl … />}
    moreFilters={<>…</>}
    moreFiltersActiveCount={hiddenInUse}
    appliedFilters={chips}
    onClearFilters={clearAll}
  />
  ```

  The shared bundle gains the toolbar's copy in English and Polish (`common.listToolbar.*`).

- 8e7684c: One primary action per view (issue #1441, UX audit DS-07), and the product editor's Inventory tab brought to it (issue #1454, CAT-01).

  - `@endora-commerce/admin-kit/components` publishes `DetailHeaderActions({ primary?, secondary?, children?, moreLabel?, moreDisabled?, moreTitle?, className? })`, the actions of a record's detail header: the one primary action drawn last, one or two `outline` secondary actions before it, and a labelled "More" menu drawn first whose entries are `RowActionMenuItem` / `RowActionMenuSeparator`. The menu trigger is not rendered when it would be empty, and the group renders nothing without an action. The kit README documents the rule: one filled button per view, "Add …" as `outline`, row actions as `ghost` icon buttons or a `RowActionMenu`, destructive actions in a menu and confirmed.
  - `@endora-commerce/mod-i18n`: `core`'s `common.action.more` ("More" / "Więcej").
  - `@endora-commerce/mod-catalog`: on the Inventory tab, each warehouse row's filled **Save** and **Save threshold** become an `outline` **Apply** (translated; named after the warehouse; busy while the write is in flight; available once the value differs from the stored one), so the editor's one Save is the only primary. The per-warehouse inputs are named after their warehouse, a result is announced through an always-mounted status region and a failure is an alert. "Disable stock management" becomes a positive **Track stock** switch, and backorders are a switch too. The per-warehouse writes still apply immediately. Catalog keys removed: `inventoryTab.stockMgmt.disableManageStock`, `inventoryTab.stockMgmt.disableManageStockHelp`, `inventoryTab.lowStock.save`, `inventoryTab.lowStock.saving`.

- 87fb9c3: `@endora-commerce/admin-kit/ui` publishes `Switch` and `SettingRow` (issue #1442), and `FormField` gains `layout`.

  `Switch` is the kit's on/off control: a native `<button type="button" role="switch" aria-checked>`, always controlled through `checked` and `onCheckedChange(next)`. `disabled` is the native attribute; `disabledReason` keeps the switch focusable, marks it `aria-disabled`, ignores presses and describes it with the reason; `busy` marks an immediate write in flight (`aria-busy`) and ignores presses until it is cleared. On a coarse pointer its hit area is 44 × 44 px.

  `SettingRow` is the settings-list layout — label, description, hint and error on the left, the control on the right — and is `FormField` with the new `layout="row"`; `layout` defaults to `"stack"`, so every existing `FormField` renders as before.

  ```tsx
  <SettingRow label={t('settings.listPrice.label')} description={t('settings.listPrice.help')}>
    <Switch checked={value} onCheckedChange={setValue} />
  </SettingRow>
  ```

  Use a `Switch` for every boolean setting and every toggle that takes effect immediately; in a form saved later, only where the label describes a state — otherwise keep a `Checkbox`.

- 998ac87: `@endora-commerce/admin-kit/ui` publishes `InlineStatus` and `useInlineStatus` (issue #1443), and `Alert`'s ARIA role now follows its variant (issue #1484).

  `InlineStatus` is the result of an action shown next to the button that produced it: a `role="status"` polite live region that is mounted, empty, from the first render, so its message is announced. `useInlineStatus()` holds its state — `show(message, tone?)` after the action, `clear()` on the next edit — and re-announces a repeated message. `tone` is `success`, `error` or `info`; `visuallyHidden` announces without showing.

  ```tsx
  const status = useInlineStatus();
  <Button onClick={save}>{t('common.save')}</Button>
  <InlineStatus {...status.props} />
  ```

  `Alert` used to render `role="alert"` for every variant, so every success, warning and static notice interrupted the screen reader. It is now `role="alert"` only for `destructive`, `role="status"` for `success`, and has no live role for `default` and `warning`. The new `live` prop chooses explicitly — `'assertive'`, `'polite'` or `'off'` — and an explicit `role` still wins. **A warning or default banner that has to be announced must now pass `live`.** `ALERT_DEFAULT_LIVE` and `alertRole(variant, live)` expose the mapping, and every `Alert` carries `data-slot="alert"` and `data-variant` so a test can find a banner without a role. Success and warning colours come from the `--success-soft` and `--warn-soft` theme tokens instead of a fixed palette. `SaveSessionSummary` and `StatusChangeControl` announce through `InlineStatus`.

- d0a6c2c: `ModalDialog` is the admin's one modal dialog (issue #1444, DS-11). It now renders into `document.body` through a portal, so it is placed against the viewport from inside a transformed drawer, a table row or the fullscreen Page Builder; it takes a `layer` prop — `'page'` (default, `z-50`, unchanged stacking) or `'overlay'`, which stacks it at the new exported `MODAL_OVERLAY_Z_INDEX` above the builder's floating chrome; with two dialogs open only the topmost answers Escape, and an Escape a control inside already handled (`defaultPrevented`) is left alone; and a dialog with nothing focusable focuses its own panel. A caller that queried the dialog inside its own render container must query `document.body` (Testing Library's `screen` already does). `StatusChangeControl` no longer wraps it in a second portal. New type export: `ModalDialogLayer`.
- 35e0829: `ContentLanguageTabs` (`@endora-commerce/admin-kit/components`) is now drawn by the kit's `Tabs` (issue #1445): one tab in the tab order (roving `tabindex`), ←/→ select and wrap, Home/End jump to the ends, and the `.b2b-tabs` look of every other strip instead of filled and outline buttons.

  It gains an optional `idBase` prop. Pass it and wrap the per-language content in `TabPanel`, and every tab names that panel through `aria-controls`; leave it out for a strip that switches page state spread over the screen, which then names no panel:

  ```tsx
  <ContentLanguageTabs languages={languages} activeLanguage={language} onChange={setLanguage} idBase="product-content-language" />
  <TabPanel idBase="product-content-language" value={language} tabIndex={-1}>{fields}</TabPanel>
  ```

  `Tabs` gains the matching optional `controlsPanel` prop (default `true`); `false` omits `aria-controls`.

  With no language to offer the strip draws the kit's `EmptyState` (issue #1448) instead of a grey sentence, with the new `core` key `contentLanguageTabs.emptyHint` (EN and PL) as its line. The catalog's product and category content screens, the CMS block and template editors (their canvas) and the returns clause dialog name their language panel; the CMS page editor and the blog editors, whose language also switches settings fields, keep a strip with no panel.

- 3f66b6f: `@endora-commerce/admin-kit/ui` publishes `Tabs`, `TabPanel` and `RecordTabs` (issue #1445), with the helpers `tabId`, `tabPanelId` and `nextTabValue`.

  `Tabs` is the kit's in-page tab strip: the WAI-ARIA tabs pattern with automatic activation — one tab in the tab order, ←/→ select and wrap, Home/End jump to the ends, disabled tabs are skipped — drawn with `.b2b-tabs` / `.b2b-tab` like `RouteTabs`. It is controlled through `value` and `onValueChange(next)`; every tab's `aria-controls` names the strip's one `TabPanel`, which is labelled by the selected tab. `RecordTabs` frames a record's sections in one card, strip on top and panel as its body; an item's `count` is drawn as a badge and spoken as "{label}, items: {count}" (the new `core` key `common.tabs.counted`, EN and PL), or as the item's own `countLabel`.

  ```tsx
  <Tabs items={items} value={tab} onValueChange={setTab} idBase="dictionary" aria-label={t('tabs.label')} />
  <TabPanel idBase="dictionary" value={tab}>{panel}</TabPanel>
  ```

  Tabs inside tabs are not allowed: a second level inside a panel becomes `Section`s, and in development a `Tabs` rendered inside a `TabPanel` logs a warning. `.b2b-tab` now draws a visible focus ring and a disabled state. The product editor's tabs are `RecordTabs`; their ids, keys and behaviour are unchanged.

- 61bdc2a: The order and quote-request detail screens draw their sections with the kit's `RecordTabs` instead of hand-written tab strips (issue #1445, UX audit DS-12). The strip is named ("Order sections", "Quote request sections"). Only the selected tab is in the tab order. ←/→ move between tabs and select them, Home/End jump to the first or last tab, and every tab is linked to its panel. The ids are `order-detail-tab-*` / `order-detail-tabpanel` and `rfq-detail-tab-*` / `rfq-detail-tabpanel`. The quote request's Modify draft still stays mounted across tab switches.

  `TabItem` gains `unsaved?: string`. It draws a dot after the label and adds the words to the tab's accessible name, so the colour is never the only signal. The Modify tab now uses it.

  The status-graph toolbar's Connect toggle and its layout buttons, and the order-create address source buttons (saved or new), now report their state with `aria-pressed`. The layout buttons are a group named "Layout". New copy: `core` `orderStatusConfig.graph.layout`, `orders` `detail.tabs.label`, `quote_requests` `detail.tabs.label`, in English and Polish.

- 38adf84: The admin's one unsaved-changes guard (issue #1446, UX audit DS-13).

  - `@endora-commerce/admin-kit/components` publishes `useUnsavedChangesGuard({ dirty, onSave?, onDiscard?, guardTabsOutside?, title?, message? })`, which returns `{ confirm(action), asking, dialog }`. While `dirty` it asks **Save and continue / Discard changes / Stay here** in the admin's own dialog before a same-origin link (the sidebar, a Back link), an opted-in host tab or a `confirm(action)` call drops the changes, and arms the browser's `beforeunload` prompt; the blocked link or tab is replayed after the answer. Render `dialog` once. Also published: `UnsavedChangesDialog` (the question on its own) and `UnsavedChangesHint` (the "Unsaved changes" status beside a Save button, a polite live region).
  - `@endora-commerce/admin-kit/lib` publishes `isDraftEqual(a, b)`, the structural comparison a screen computes its `dirty` with (key order and `undefined`-valued keys ignored, as JSON does). `useUnsavedChangesPrompt` is unchanged for its callers and now shares its interception with the guard.
  - `@endora-commerce/page-builder-admin`: `PageBuilderEditorLayout` takes `dirty`, `onSave` and `onDiscard` and arms the guard over the whole editor; `hasUnsavedCanvas` compares a Page Builder editor's active and stashed canvases with what was saved.
  - `@endora-commerce/mod-i18n`: the `core` copy for the guard (`form.unsavedChanges.title|body|save|saving|discard|stay|hint`), in English and Polish.

- 7329865: `@endora-commerce/admin-kit/lib` publishes `useDetailResource` and `@endora-commerce/admin-kit/ui` publishes `Skeleton` and `DetailSkeleton` (issue #1447, UX audit DS-14).

  `useDetailResource(key, load)` holds the record a detail screen shows and keeps its first load apart from every refresh. `load` answers the record, `null` for one that does not exist, or throws. It returns `data`, `initialLoading`, `refreshing`, `error`, `refresh()`, `setData` and `busyProps` (`{ 'aria-busy': true }` while a refresh runs). A refresh keeps `data` on screen; a new `key` starts a new first load and never shows the previous record; an earlier, slower read never overwrites a later one.

  `Skeleton` is one `aria-hidden` placeholder block whose pulse runs only without `prefers-reduced-motion`. `DetailSkeleton` is a record page's first load — header, tab strip (`tabs={false}` drops it) and field rows — in a `role="status"`, `aria-busy` region labelled `common.state.loading` unless `label` says otherwise. Use either for the first load only.

  ```tsx
  const resource = useDetailResource(id, loadOrder);
  if (resource.initialLoading) return <DetailSkeleton />;
  <Card {...resource.busyProps}>…</Card>;
  // after an action: await resource.refresh();
  ```

- 1064839: `@endora-commerce/admin-kit/ui` publishes `EmptyState` (issue #1448): the block a list, a tab or a panel shows when it has nothing to show — a decorative icon, a title, at most one line and at most one action, drawn with the design system's `.b2b-empty` classes.

  It has two variants. `no-data` (the default) takes `icon`, `title`, an optional `description` and an optional `action`. `no-results` takes `onClearFilters` and renders the kit's own title, line and _Clear filters_ button (new `core` keys `common.emptyState.clearFilters`, `common.emptyState.noResults.title` and `common.emptyState.noResults.body`, in English and Polish); `icon`, `title` and `description` override them.

  After _Clear filters_ the kit moves focus to `focusAfterClear` (a ref, normally the list's search box) on the next frame, so focus never drops to `<body>` when the button unmounts (WCAG 2.2 SC 2.4.3). Without one, and only if focus was lost, it focuses the page's `<h1>`, else the closest container of the block still in the document. Every list that uses the `no-results` variant here passes its search box; `EntryFilters`, `OpportunityFilterFields` and `TaskFilters` gain an optional `searchRef` for that.

  ```tsx
  <EmptyState variant="no-results" title={t('list.emptyFiltered')} onClearFilters={clearFilters} />
  <EmptyState icon={<ClipboardList size={20} />} title={t('list.empty.title')} action={createButton} />
  ```

  The forms and form-entries lists, the CRM opportunities list, the task and _My tasks_ lists, the task settings lists, the project and project-template lists, the custom-fields table, the price-book list, and the product-feed list, runs, delivery and templates screens now use it. The forms list now says "No forms yet" with a line of its own (a reader is told who can create one), and it hides the header's _New form_ while the empty state carries it. The form-entries list's empty state gains a title.

- d2d9d79: `StickyFormActions` is now the one place of an editor's single Save (issue #1449). It takes `primary` and `secondary` actions (the primary drawn last), a `note` that also describes the primary, `dirty` for the unsaved-changes hint, and `error` / `status` regions that say the last save's outcome beside the button. `desktop="sticky"` keeps the bar in view at the bottom of a long editor at 1024 px and wider; the default, `inline`, keeps the previous behaviour, and `children` still renders as before.
- f687479: Keys and codes are proposed from the name instead of typed by hand (issue #1450). The admin kit's
  `./lib` exports `deriveKey(name, { separator, maxLength })`, built on the contracts' `slugify` with
  its diacritic fold, and `useDerivedKey`, the field behaviour that goes with it: the key follows the
  name until the operator edits it, is normalised on blur, and a cleared key follows the name again.

  - The Tasks status and priority dialogs take the new code from the English name, and the CRM status
    dialog from the default name (issue #1560). A code already in the list is refused at the code, and
    so is the server's own collision, never with a suffix added. The code hint now says where the code
    comes from and that it cannot be changed later.
  - The custom-field definition form takes the new key from the default label, which now has the focus
    when the form opens, and refuses a key the record type already has before sending it (issue #1531).
    The key help is shortened to the same sentence.

  The API is unchanged: the server still refuses a malformed or taken code, and existing codes and keys
  are not changed.

- 7624db6: Adds `InlineEdit` and `InlineEditTitle` to the admin kit's `./components`: the admin's one model for editing a record's facts where they are shown (issue #1453). Each fact has its own pencil, _Save_ and _Cancel_, and sends only itself. `InlineEdit` takes a `group` option for an editor of several controls, which names itself through the new `labelId`. `MultiSelect` and `TagMultiSelect` take an optional `id` for the trigger. The copy is in `core`: `common.inlineEdit.edit`, `common.inlineEdit.saved` and `common.inlineEdit.error`.

  CRM now uses the kit's component (its own copy is removed), and the Opportunity's assignee is edited the same way as the facts beside it, instead of through an always-open lookup. On a Task, the page-wide _Edit_ form is replaced: the title, description, due date, start date, priority, tags and assignees are each edited in place. On a Project's _Overview_, the description, the start date and who sees the Project are edited in place. The start date could not be changed there before (issue #1525).

- 7be07f6: `ScopedField` in `@endora-commerce/admin-kit/components` gains `help` (issue #1459, UX audit CAT-14).

  `help` renders a `HelpTip` (ⓘ) beside the field's label, named after it ("More information <label>"), for an explanation too long for the one-clause `note`. It is not part of the control's `aria-describedby`, so a screen reader hears the note on every focus and the longer text only when asked for — the same split as `FormField`'s `hint` and `help`.

- 79a17a3: The sign-in screen no longer shows English the kit hard-coded (issue #1481). When a password or code step fails without a backend message — the network dropped, the answer was not an error envelope — `AuthProvider` now leaves `lastLoginError` as `null` and sets `lastLoginReason` to `'sign_in_failed'` or `'verification_failed'`; the exported `LoginErrorReason` type gains those two members. A custom sign-in screen should word those two reasons itself, as `@endora-commerce/admin-shell`'s `LoginPage` does: before, it received `'Sign-in failed.'` or `'Verification failed.'` in `lastLoginError`. A `switch` over `LoginErrorReason` that was exhaustive needs the two new cases.

  The two-step verification step of `LoginPage` takes its words from the shell's pre-auth copy like the rest of the sign-in screen, and its code field is described by the error it caused.

- e22b612: The product editor's tabs are sections of the editor card, not cards inside it (issue #1488, UX audit CAT-06).

  `@endora-commerce/admin-kit/field-protection`: `FieldProtectionSummary` is now an `EditorSection` and no longer draws its own bordered box. It takes `chrome` (`'section'` by default, or `'card'`) and `titleAs`, like `CustomFieldValuesPanel`. The heading names the source, so two integrations on one record render as two labelled sections. **Breaking visual change for integration modules (0.x, so released as a minor):** a summary mounted on its own, outside a card, must pass `chrome="card"` to keep a frame: `<FieldProtectionSummary source={…} chrome="card" />`.

  `@endora-commerce/admin-kit` theme: the `.b2b-hr` class is removed. The product editor's Details tab was the last thing that rendered it; a rule between sections is now drawn by `EditorSection` itself. A module that still uses it can write a `<Separator />` from `./ui` instead.

  `@endora-commerce/mod-catalog`: on Variants, Related products, Grouped items, Bundle slots, Inventory (stock management, low-stock threshold, fulfilment strategy, stock by warehouse, order rules, packaging units), Details, Media and Attachments, each group is an `EditorSection` with an `h2` heading and a rule between sections. The Pricing and Channels tabs no longer put a heading of their own, repeating the tab's name, above their contributors' sections. Bundle slots, gallery images and attachments are listed as rows divided by a rule instead of one bordered box per item. The Inventory summary (cumulative on hand, active warehouses) is now a stat line under the _Stock by warehouse_ heading, and the Inventory tab no longer has the extra "Stock" heading above its sections. The catalog's `SectionHeading` is gone. Its badge logic remains in the editor as `SectionBadge`.

  `@endora-commerce/mod-sales-channels`: the product editor's Channels panel (`EntityChannelMembership`, the `product.editor.channels` contribution) is an `EditorSection` instead of a `Card`. Its heading carries "Applies immediately", and its channels are rows divided by a rule.

- cb75825: The inventory module's remaining screens and the PWA push audience rule builder draw one visual system: the admin kit's `ui/*` primitives and Tailwind utilities, instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

  `@endora-commerce/admin-kit` theme. **Breaking for a module that renders these classes (0.x, so released as a minor).** Nothing in the platform renders them any more, so they are removed from `theme.css`:

  - `.b2b-btn--danger`: use `Button` from `./ui` with `variant="outline"` for a destructive action that a confirm dialog follows, or `variant="destructive"`.
  - `.b2b-btn--icon` (and `.b2b-btn--sm.b2b-btn--icon`): use `<Button variant="ghost" size="icon" aria-label="…">`.
  - `.b2b-field--mono`: use `Input` from `./ui` with `className="font-mono"`.
  - The `.b2b-tbl` cell modifiers `td.num`, `th.num` and `td.actions`. `.b2b-tbl` itself stays. With the kit `Table`, a numeric column is `<TableHead className="text-right">` and `<TableCell className="text-right tabular-nums">`; an actions column is `<TableCell className="w-[1%] whitespace-nowrap">`.
  - `.b2b-grow` and `.b2b-tabular`: use the Tailwind utilities `flex-1` and `tabular-nums`.

  `@endora-commerce/mod-inventory`: the low-stock list, the warehouses list and editor, the back-in-stock queue and the stock import use kit cards, tables, buttons and fields. Their failures are kit alerts announced as alerts, their loading messages are announced politely, and a cancelled back-in-stock subscription is a kit `InlineStatus`. The warehouses list and the back-in-stock queue use the kit list toolbar: a search box with an accessible name, and filter chips that announce whether they are on. In the warehouse editor, the address and contact fields are tied to their labels, which they were not, the two-column grid that never rendered is a real grid, and _Delete_ is an outline button so _Save_ is the page's one filled button. The stock import's warehouse picker, file input and paste box have names, each skipped row's reason is in words instead of the raw code, and a low-stock row's _Edit stock_ opens the product's Inventory tab.

  `@endora-commerce/mod-pwa`: the push audience rule builder's frames, AND / OR switch and buttons are kit primitives, and its value picker lists each option as a labelled checkbox that a keyboard can reach, where it used to be clickable by mouse only.

  `@endora-commerce/mod-i18n`: new `core` strings for the screens above, in English and Polish. The back-in-stock statuses are capitalised (_Queued_, _W kolejce_), and `inventory.import.pasteDirectly` is replaced by `inventory.import.field.paste`.

- f3b2ec8: The products list, the product editor's Inventory tab and packaging units, the inventory list, the sales-channel warehouses panel and the pricing settings page draw one visual system: the admin kit's `ui/*` primitives and Tailwind utilities, instead of kit components next to the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

  `@endora-commerce/admin-kit` theme. **Breaking for a module that renders these classes (0.x, so released as a minor).** Nothing in the platform renders them any more, so they are removed from `theme.css`:

  - `.b2b-bulkbar` (and its `.count`, `.actions` and button rules): the products list's bulk-action bar was its only renderer. Draw the bar with `Button` from `./ui` inside a Tailwind row, for example `<div className="flex items-center gap-3 rounded-md border bg-muted px-3 py-2"><Button size="sm">…</Button></div>`.
  - `.b2b-table`: a table class one screen used. Use `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead` and `TableCell` from `./ui`.
  - The `.b2b-tbl` row and cell modifiers `tr.is-selected`, `tr.is-clickable` and `.col-cb`. `.b2b-tbl` itself stays. With the kit `Table`, mark a selected row with `<TableRow data-state="selected">`, make a clickable row `className="cursor-pointer"`, and size a checkbox column with `className="w-8"`.

  `@endora-commerce/mod-catalog`: the products list is a kit `Card` with kit buttons, checkboxes and table. The page and row checkboxes now have accessible names, and the bulk-action bar is a light row with one filled primary, where it used to be a dark inverted bar. The row thumbnail placeholder is one neutral tile instead of a colour derived from the product id. On the Inventory tab, the two low-stock threshold modes form one radio group named after their section, and the inputs and the per-warehouse table come from the kit. Packaging units use kit inputs, which were unstyled before because the class they used was never defined, and icon buttons to reorder.

  `@endora-commerce/mod-inventory`: the inventory list's KPI tiles and per-warehouse totals are kit cards, each KPI marked up as a term and its value. The sales-channel warehouses panel uses the kit table, select and buttons. Its _Add_ is an outline button now, because it applies at once and the channel editor's Save is the page's one primary.

  `@endora-commerce/mod-price-lists`: the pricing settings page switches scope through kit tabs instead of three hand-coloured buttons. Its saved and failed results are kit `Alert`s: a saved change is announced politely, a failure as an alert. The override search has an accessible name, and in the _Add override_ drawer each candidate is a keyboard-reachable button.

- 86b9b39: The CMS page, block, template and hook lists, the blog post, tag and category lists and the megamenu list use the kit list page, and pages, blocks, templates, custom hooks, blog posts and megamenus can now be deleted from their lists (issue #1495). The blog tag form opens in a dialog (issue #1538).

  - `@endora-commerce/admin-kit/components` exports `useDebouncedValue(value, delayMs?)` and `SEARCH_DEBOUNCE_MS` (300). The hook returns `value` once it has stayed unchanged for `delayMs`. Use it so a list's search runs while the operator types, with one request per pause.
  - `@endora-commerce/admin-kit/components` also exports `useRemovalFocus(rows, idOf, ready)`. It returns a `returnFocusTo` for `useConfirmDialog` that moves focus to the next row after a delete, or to the list's create action once the list is empty.
  - Each row has a menu with Open (Edit for a blog tag) and Delete. Delete asks for confirmation and calls the module's existing delete endpoint. When the server refuses (the record is still referenced, or a megamenu is active on a channel), the dialog stays open and says what to do. A system CMS hook is offered no delete. The menus, the blog tag's New button and the megamenu's New button need the module's write permission (`cms.write`, `blog.write`, `megamenu.write`).
  - The card title that repeated the page title is gone. Loading shows a skeleton, an empty list shows the kit `EmptyState`, statuses are badges with translated text, and the CMS page and blog post searches run as you type. The blog post and tag lists use the kit pager.
  - The megamenu list's name field in the header is replaced by a New megamenu button that opens a dialog.
  - `@endora-commerce/mod-blog` now lists `lucide-react` (`^1`) as an optional peer dependency, like the other module packages with an admin UI.
  - Translation keys removed: cms `*.cardTitle`, `*.description`, `*.empty` and `*.loading` for `pagesList`, `blocksList`, `templatesList` and `hooksList`, and `common.search`. Blog: `postList.cardTitle`, `postList.description`, `postList.empty`, `postList.loading` and `postList.total`; `tagList.cardTitle`, `tagList.description`, `tagList.empty` and `tagList.messages.*`; `tagList.validation.invalidForm` and `tagList.validation.missingTag`; `tagList.deleteConfirm.default` and `tagList.deleteConfirm.inUse`; `categoryTree.cardTitle`, `categoryTree.description` and `categoryTree.empty`; `pagination.*`. Megamenu: `list.cardTitle`, `list.description`, `list.empty` and `list.newNamePlaceholder`. A deployment that overrides one of these keys should move its override to the new key or drop it.

- 447e829: The order and quote-request headers have one primary action (issue #1497, UX audit SALES-12).

  - `@endora-commerce/admin-kit/components`: `DetailHeaderActions` takes `moreBusy`, which disables the "More" trigger, marks it `aria-busy` and shows a spinner while an entry of the menu runs. An entry that opens a dialog (a `useConfirmDialog` question, a `ModalDialog`) now runs only after the menu has given focus back to its trigger, as `RowActionMenu` already did, so the dialog keeps focus and returns it to "More" when it closes. Before, focus went back to the trigger behind the dialog.
  - `@endora-commerce/mod-orders`: on the order detail, **Issue invoice** is the one filled button while the order has no invoice, and the header has no primary once it has one. **Reorder**, **Clone to quote**, the **Invoice PDF** download and a repeat **Issue invoice** are in the "More" menu. While one of these requests runs, every header action is disabled and the control that started it shows a spinner, so a double press no longer sends the request twice.
  - `@endora-commerce/mod-quote-requests`: on the quote-request detail, the next step of the status is the one filled button: **Approve** on a Pending request, **Prepare the customer's basket** on an Approved one, none otherwise. **Export PDF**, **Send PDF** and **Cancel RFQ** are in the "More" menu, with Cancel last, after a separator. **Approve** now asks for confirmation first, because it locks the agreed prices and notifies the customer.
  - `@endora-commerce/mod-i18n`: `core`'s `rfq.detail.approveConfirm.title` and `rfq.detail.approveConfirm.message`, in English and Polish.

- 2040ae9: Action results beside the control that caused them, and at most one banner above a detail screen (issue #1499, UX audit SALES-17; owner decision DEC-12 a).

  - `@endora-commerce/admin-kit/components`: `DetailHeaderActions` takes `status` — normally `useInlineStatus().props` — and mounts an always-present polite `InlineStatus` before the header's buttons, so the last header action's result is said there. Given `status`, the group renders even when the record has no action left. `@endora-commerce/admin-kit/ui`: `InlineStatus` gains a `warning` tone (icon and warning colour) for a result that went through only in part.
  - `@endora-commerce/mod-quote-requests`: the quote-request detail no longer stacks up to six banners. Approve, Cancel, the customer's basket, the PDF outcome and a copied number are said beside the header's buttons; a stored revision in the Modify save bar. The cancellation reason leads the header's meta line. Above the tabs there is at most one banner: an error, else the lapsed deadline with its remedy, else the unsaved draft — the last only away from the Modify tab, where the save bar already says "Unsaved changes".
  - `@endora-commerce/mod-orders`: Issue invoice (a warning when the e-mail was not sent), Reorder, Clone to quote and a copied order number are said beside the header's buttons. A status or payment-status change adds no banner: the control announces it and its badge shows it.
  - `@endora-commerce/mod-organizations`: "Saved" and the results of the header's dialogs are said beside the header's buttons, a member write right above the Members section.
  - `@endora-commerce/mod-i18n`: `core`'s `rfq.detail.validity.lapsed.remedyEditable` and `remedyLocked` shortened to one sentence; `orderDetail.messages.orderMoved` and `orderDetail.messages.paymentMoved` removed.

- 40b76aa: `StatusChangeControl` takes `labelVisuallyHidden` (issue #1501). The `label` stays the accessible name of the _Change…_ button and of the dialog's radio group, but is no longer drawn above the badge — for a control inside a table cell, whose column header already says it. Default `false`; existing call sites render as before.
- eeed5c8: `@endora-commerce/admin-kit` theme: the second card system and the legacy form, table and layout classes are removed from `theme.css` (issue #1502, UX audit SHELL-18). **Breaking for a theme or a module that renders or overrides these classes (0.x, so released as a minor).** Nothing in the platform renders them any more: issue #1492 moved their last renderers onto the kit.

  Upgrade note — replace each removed class with its kit primitive (`@endora-commerce/admin-kit/ui`) or Tailwind utility:

  - `.b2b-card`, `.b2b-card__head`, `.b2b-card__title`, `.b2b-card__sub`, `.b2b-card__body`, `.b2b-card__foot`: `Card`, `CardHeader`, `CardTitle` (an `h2`; `as` picks another level), `CardDescription`, `CardContent`, `CardFooter`. `CardContent` pads all four sides unless it follows a `CardHeader`, so do not add `pt-6`.
  - `.b2b-card__body--flush`: `<Card flush>` around a table.
  - `.b2b-card--clickable`: a `Card` with a `Link` inside it.
  - `.b2b-btn`, `.b2b-btn--primary`, `.b2b-btn--default`, `.b2b-btn--ghost`, `.b2b-btn--sm`, `.b2b-btn--lg`: `Button` (default variant), `variant="outline"`, `variant="ghost"`, `size="sm"`, `size="lg"`.
  - `.b2b-field` (input or textarea), `.b2b-select`, `.b2b-label`, `.b2b-help`: `Input`, `Textarea`, `Select`, and `FormField` for the label and the hint.
  - `.b2b-field--addon` and `.b2b-input-wrap` (a search box with a leading icon): `ListToolbarSearch` from `@endora-commerce/admin-kit`.
  - `.b2b-tbl`: `Table`, `TableHeader`, `TableRow`, `TableHead`, `TableCell`.
  - `.b2b-row`, `.b2b-col`, `.b2b-mono`: `flex items-center gap-3`, `flex flex-col gap-2`, `font-mono`.

  A theme that overrode one of these classes in its stylesheet now overrides nothing; move the override to the kit primitive's tokens (`--card-pad`, `--fs-section-title`, `--r-*`, `--primary-*`) or to a still-published class such as `.b2b-badge`. The badge, tabs, page frame and drawer/scrim classes stay.

  `@endora-commerce/cli`: `endora new module --admin` scaffolds its screen's card as `<CardContent>` without the `pt-6` workaround, which drew 24 px of top padding above 16 px sides.

- 63a657b: The last kit composites that drew their own card or bordered box are sections of the card they sit in (issue #1503, UX audit SHELL-22; the DS-03 rule from #1437).

  **Breaking visual change for modules.** The packages are in `0.x`, where `major` is refused (D-225, `specs/conventions/release-intent.md`) and a `minor` already takes every caret dependent out of range, so this is released as a minor. **Upgrade note: pass `chrome="card"` to keep the old frame.**

  - `ScopePicker` (`@endora-commerce/admin-kit/components`) no longer draws its own `Card`. It renders as an `EditorSection` and follows its mount. A picker placed on its own, between a page's cards, must pass `chrome="card"` to keep its card: `<ScopePicker value={scope} onChange={setScope} chrome="card" />`. It also takes `titleAs` (`'h3'` inside a titled card).
  - `FieldProtectionPricePanel` (`@endora-commerce/admin-kit/field-protection`) no longer draws a bordered box. It renders as an `EditorSection` whose heading names the source, with the description as its one line, like `FieldProtectionSummary`. Pass `chrome="card"` where it stands alone on a page; it also takes `titleAs`.
  - `RuleBuilder` (`@endora-commerce/admin-kit/components`) no longer draws its outer `rounded-md border` box, and a group's children are rows divided by a rule instead of a column behind a left border. Its selects and inputs keep their own borders. A builder placed on its own, outside a card, must pass `chrome="card"` to keep a frame: `<RuleBuilder value={rule} onChange={setRule} chrome="card" />`. The card is titled _Conditions_ (`ruleBuilder.title`, EN + PL) unless you pass `title`; `titleAs` sets the heading level.
  - `CommentThreadCopy.hint` is optional. Omit it when the thread has no rule to state, and nothing is drawn above the thread. Passing it still works as before.

  The promotion editor, the saved promotion rules page and the product-feed criteria panel all place `RuleBuilder` inside a card already and mount it without a frame. The blog and CMS editors mount `ScopePicker` with `chrome="card"`, so they look as they did. The sales-channel editor's warehouse routing (`inventory`, `sales_channel.editor.after`) is one section, with the add form as an `h3` sub-section, a load or write failure as an alert and its confirmations as a status line, in place of up to four cards; the sales-channel editor mounts the zone with `chrome="card"`. A product feed's Settings tab is one card with five sections instead of five cards.

- 0ecb287: `ListToolbar` offers _Clear all filters_ without applied-filter chips, and hands focus on after it (issue #1505, WORK-05).

  - New optional prop `filtersActive`. With `onClearFilters` given and no `appliedFilters`, the filter row ends with **Clear all filters** while `filtersActive` is true. A page that lists its applied filters as chips keeps the button at the end of the chip row, as before, and does not need the prop.
  - After **Clear all filters**, in either place, focus moves to the toolbar's first enabled control, normally the search box. Before, focus was left on a button that went away with the filters.
  - The _More filters_ toggle stays focused while it opens and closes the panel. This was already the behaviour; it is now documented and covered by a test.

- 9a27b93: New kit composite `BoardCardFieldsEditor` (`@endora-commerce/admin-kit/components`), with the types `BoardCardFieldChoice`, `BoardCardFieldsConfig`, `BoardCardFieldsEditorCopy` and `BoardCardFieldsEditorProps` (issue #1506). It edits which fields a board card shows and in what order: `load` and `save` answer `{ fields, available, maxFields }` (the catalogue and the limit come from the server), `fieldLabel` names a field, and `copy` carries the three lines that name the module's record. Its other copy is `core`'s new `boardCardFields.*` keys in `@endora-commerce/mod-i18n`.

  CRM's and Tasks' own `BoardCardFieldsEditor` copies are removed, along with their duplicated `boardCard.*` keys (the title, `shown.titleAlways`, `available.builtin` and `available.noCustom` stay). CRM's `ITEM_COUNT_LABEL_KEY` and `opportunity.tabs.counted` are removed too, because the kit's `common.tabs.counted` reads the same. The Opportunity and Project record tabs now use the kit `RecordTabs`, and the form builder's tabs use `Tabs` / `TabPanel`. The form builder's strip now looks like every other strip in the admin.

- 2f0b69f: Categories are named in every language the active sales channels offer, instead of a fixed English and Polish pair (issue #1507). The category content and product content screens offer the same languages. A stored name or document in a language no channel offers stays visible, read-only and flagged, and a save keeps it unchanged. The kit publishes `useChannelLanguages`, `loadChannelLanguages`, `offerContentLanguages` and `contentLanguageName`; the hook moved from the newsletter module's admin.
- 50d451b: The product editor has fewer tabs (issue #1510, UX audit CAT-10). Media and Attachments are one **Media & files** tab with the gallery and the attachments as its two sections, and the Scope map is no longer a tab: it opens as a side drawer from the Scope map link in the scope bar and from the completeness line, and its address is `?scopeMap=1`. Old addresses keep working — `?tab=scopes` opens the drawer and `?tab=attachments` the Media & files tab, each rewritten to the current address; the bulk-edit result links to `?scopeMap=1`. A simple product now has eight tabs at most. `ModalDialog` gains `placement="end"` (exported type `ModalDialogPlacement`), a full-height panel docked to the inline end of the viewport, with the same modal behaviour.

  The Pricing tab's base-price panel (issue #1529, CAT-19) says "No base price in …" and "Not orderable below …" in the warning token with an icon instead of a hard-coded amber, so it reads in every theme, and it drops its own **Discard changes** button: the editor's one Save and its Save / Discard / Stay question are the one way to keep or drop the changes. The `basePrices.discard` string is removed.

- 9f4eae3: The Modules screen (`/platform/modules`) is easier to scan (UX audit SHELL-12, issue #1520). It has a search box that matches the module's name, id or description and ignores case and diacritics. Filter chips (On · Off · Not offered · Locked) show how many modules each one holds, and the modules are grouped under the sidebar section their screens are in. Modules without a screen are listed last, under "Other modules".

  Switching a module on or off is now a switch in the _Your business_ column. Before, every module that was off showed a filled "Switch on" button. Turning a module off still asks for confirmation. A module that cannot be switched off shows a locked switch with its reason as the tooltip and the description, instead of printing the reason twice. The Recent Activity choice is a switch in a new _Dashboard_ column, which is shown only to an admin who may change it. A module's description, dependencies and lock reason are behind a disclosure on its row. What either switch does is unchanged.

  `ListPage` takes an optional `help`, passed to `PageHeader`'s ⓘ.

  Removed `core` keys: `platform.modules.column.actions`, `platform.modules.action.enable` and `platform.modules.recentActivity.{shown,hidden,hint}`. An overlay that overrides them should override the new `platform.modules.*` keys instead.

- f6dda10: New `RecordHistoryChangeList` (`@endora-commerce/admin-kit/components`): the field-by-field "before → after" list `RecordHistory` draws for each entry, published on its own for a screen that shows one audited change, as the audit log's row detail does (issue #1555). `RecordHistory` draws its entries with it and is unchanged otherwise.
- bfbcac2: The admin kit publishes `ViewModeToggle` from `@endora-commerce/admin-kit/components`: the _List | Board_ switch that Tasks and My Tasks used, now named from the shared `common.viewMode.*` strings. The Tasks module no longer ships its own copy, and its `view.label`, `view.list` and `view.board` strings are removed.

  CRM's Opportunities list and board are one page. `/crm/opportunities` shows the list, and `/crm/opportunities?view=board` shows the board, switched by the toggle in the page header. The two views share one address: the search, organization, assignee, tag, sales-channel and creation-date filters carry over when the view changes. The list's state, status, sort and custom-field filters are now in the address too, so a reload or a shared link keeps them. **Clear all filters** clears the filters of both views. The sidebar loses its _Board_ row. `/crm/board`, and the command palette's _Opportunity board_ that targets it, redirect to the board view and keep the filters a bookmark carried. The CRM strings `nav.board.label` and `board.title` are removed.

- 820f089: The admin kit exports `formatDate(value, language)`, and `formatDateTime(iso, language)` takes the admin UI language: a medium date, and a moment as that date with the short time, never the browser's locale (UX audit #1567). The Opportunity sidebar's deadline and Record dates, the Projects date labels (the Project panel's Stage deadline among them) and the Tasks date labels use them, so one screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`. On the Opportunity sidebar the value stays on one line and the value-mode switch sits below it instead of squeezing it to one character per line.
- 3f7b5ae: The browser's Back and Forward buttons now ask before they leave a screen with unsaved changes (issue #1605). `AdminRoot` mounts a data router (`createBrowserRouter` with `RouterProvider`, transitions still off) instead of a component `<BrowserRouter>`; the whole app is one splat route, so the shell's `<Routes>`, links and relative paths behave as before. `useUnsavedChangesGuard` asks Save / Discard / Stay and `useUnsavedChangesPrompt` asks with the browser's confirm, both through React Router's blocker. Only a history step to another path is asked about; a step that changes only the query is left to the screen. A project that composes its own tree under a component router keeps the previous behaviour: Back and Forward are not intercepted there.
- b98739c: `useUnsavedChangesGuard().confirm(action, ask?)` takes an optional second argument, the new exported type `UnsavedChangesAsk` — `{ title?, message?, onStay? }` (issue #1606). `title` and `message` word that one question instead of the guard's own (a scope switch can say it is a switch while a link keeps the screen-wide wording), and `onStay` runs when the operator answers _Stay here_ or presses Escape, for undoing what the switch already moved — for example putting back an address the browser's Back / Forward changed. Existing `confirm(action)` calls are unchanged.
- bdcc9a4: The server-backed list reorder that CRM and Tasks each kept a copy of now lives in the admin kit
  (issue #1633): `useServerReorder` and `ReorderControls` from `@endora-commerce/admin-kit/components`,
  with the types `ReorderableRow`, `ReorderNotice`, `UseServerReorderOptions`, `UseServerReorderResult`
  and `ReorderControlsProps`. The hook moves the row at once, sends the whole list in one save, rolls back
  and reports a refusal, and on a 409 `ORDER_STALE` reloads the list and says so; the screen still passes
  its own `staleMessage` and `failedMessage`. The CRM workflow statuses and the Tasks statuses and
  priorities use the kit copies and behave as before.

  The controls' accessible names are now `core` copy: `reorder.moveRowUp` and `reorder.moveRowDown`
  ("Move {name} up" / "Move {name} down", same wording in Polish as before). The `crm` and `tasks` keys
  `reorder.moveUp` and `reorder.moveDown` are removed.

- c042024: The kit pager has a cursor mode (issue #1664). `useCursorPagination` is the counterpart of `useListPagination` for an endpoint that pages by cursor and answers no total. `ListPage` draws the same `PaginationFooter` for it, with _Previous_ / _Next_, _Page N_ and "Showing 21–40 of more than 40" while a next page exists. `PaginationFooter` takes the new `CursorPaginationFooterProps` (`mode: 'cursor'`), and `ListPage` has a `tabs` slot for section tabs between the header and the toolbar.

  - **Invoices**: the list is the kit `ListPage`, like the other sales lists (issue #1500, UX audit SALES-24). _Load more_ is replaced by the cursor pager. The filters are the kit toolbar: the order-number search, kind and status, with the issue dates and totals behind _More filters_. The empty state tells "no invoices yet" apart from "nothing matches these filters". _Download PDF_ and _Resend email_ are in each row's menu. The error messages are translated.

  Removed unused translation keys (core): `invoices.loadMore`, `invoices.filters.clear`, `invoices.pdfNotReady`, `invoices.resendEmail`, `invoices.kind.all`, `invoices.status.all`.

- 95e5082: The admin products list now uses the kit `ListPage` (issue #1749), the last catalog list to move. The status tabs sit under the header, the toolbar is a plain row with the matching-product count at its end, and the bulk bar, the table and the pager share one results card. The first load shows the kit skeleton; a page turn, a filter change or a refresh after a bulk action keeps the rows on screen, so the focused control keeps its focus. A load failure shows the kit error with **Retry**. Each product's name is now a link to its editor, so the keyboard can open a product; the row is no longer a click target of its own. Saved views, bulk edit, _select all matching_, every filter (stock included, and its absence while inventory is off) and the empty states work as before.

  - `@endora-commerce/admin-kit`: `ResponsiveTable` takes `isRowSelected`, which marks selected rows and cards with `data-state="selected"` (drawn in the selected tint).
  - `@endora-commerce/mod-catalog`: new `en` / `pl` key `productsList.count`; the unused `productsList.loading` is removed.

- 31c0430: `ListPage` takes three optional additions (issue #1749), so the lists that refresh over their own rows can use it:

  - `busy` — a refresh over rows already on screen. The rows stay, the results region is `aria-busy` and the count's live region says _Loading…_. `load: { kind: 'loading' }` still draws the skeleton, for the first load.
  - `resultsRef` — a ref to the results region, which then takes `tabIndex={-1}`, for a screen that moves focus to the results.
  - `ListPageLoad`'s `error` variant takes `action`, a way out shown in place of _Retry_ (for example _Remove filter_ when the server refuses a filter).

  `ResponsiveTable` takes an optional `label`, the table's accessible name.

  Existing callers are unaffected.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 691414b: **The admin top bar's notification bell and language picker are kit menus, and every top-bar control is a 44 px target on touch screens (issues #1783, #1784).**

  - **`@endora-commerce/admin-kit`:** `./ui` now exports `DropdownMenuRadioGroup` and `DropdownMenuRadioItem`, a pick-one-of-N menu entry (`menuitemradio` with `aria-checked` and a check mark), and `DropdownMenuLabel`. On a coarse pointer, one rule in `theme.css` makes every control in `.b2b-topbar__actions`, and the mobile menu button, at least 44 × 44 px. The profile avatar keeps its 28 px circle and grows its target with padding. A mouse keeps the 34 px controls. The `.b2b-main .b2b-topbar__icon-btn` rule is removed: it matched nothing, because the top bar is not inside `.b2b-main`.
  - **`@endora-commerce/admin-shell`:** the bell and the language picker were hand-made `role="menu"` panels. They now use the kit `DropdownMenu`. Focus moves into the menu when it opens. The arrow keys, Home and End move between entries. Typing jumps to a notification by its title or to a language by its name. Escape closes the menu and gives focus back to the button. The bell's menu is named by its heading. _Mark all read_ is now the last entry, after a separator, so opening the bell with Enter lands on the newest notification; it keeps the menu open. While a language is being saved, the picker's button is `aria-disabled` rather than `disabled`, so keyboard focus stays on it instead of falling to the page. It still cannot be opened until the save ends. The save error from #1769 behaves as before.

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

- bd47236: `RowActionMenu` no longer loses a dialog's focus to its own trigger (`specs/181-guest-complaints/` design review A-1).

  - **An item's `onSelect` now runs after the menu has closed**, from the menu content's `onCloseAutoFocus`, with the ⋮ trigger focused first. Until now an item that opened a dialog (`ConfirmDialog`, `useConfirmDialog`) had the dialog take focus and then lose it to the trigger behind the scrim, in the timer Radix queues at unmount: Tab left the modal, Enter reopened the menu, and a destructive dialog's "open on _Cancel_" was defeated. The dialog now keeps focus and returns it to the trigger when it closes. The action is no longer synchronous with the select event: a test that asserts its effect straight after selecting an item awaits it (`waitFor`, or a flushed timer). `RowActionMenuItem` used outside a `RowActionMenu` runs `onSelect` at once, as before; an `asChild` item without `onSelect` is unchanged.
  - New optional prop `showLabel` on `RowActionMenu`: the trigger shows `label` as its text, in an outline button with a chevron, instead of the icon alone — for a menu on a detail page rather than in a table row. The text is then the accessible name.
  - A `DropdownMenu` composed directly, outside `RowActionMenu`, keeps Radix's behaviour; an item there that opens a dialog still needs the same deferral.

- 79d15cf: The Admin UI has one, light theme (issue #1810). `@endora-commerce/admin-kit/theme.css` no longer declares the `.dark { --background: … }` token block: nothing applied it, and applied by hand it was incomplete, with a light page under dark cards and unreadable outline buttons. An instance that set `.dark` on an element by itself now gets the light tokens; to restyle the admin, redeclare the `:root` tokens instead.

  The `dark:` utilities are gone too: `Badge`'s `success` and `warning` variants, the `ScopedField` "unsaved" badge, the shell's not-found notice, and the amber and emerald notices and icons in the admin screens of admin users, catalog bulk operations, the page-builder translate action and header actions, CRM propagation outcomes, custom-field carry drift, document-template item tables, tax-ID scope, product feeds and settings. Without a `dark` variant definition, Tailwind 4 compiles `dark:` to `@media (prefers-color-scheme: dark)`, so on an operating system set to dark these elements turned dark on a light page. They now render the same on every system.

- 398e6d2: Record-tab zones: a module can add a whole tab — a label, an optional count and a panel — to another module's record tab strip. `@endora-commerce/contracts` adds the zone `opportunity.detail.tabs` (props `OpportunityDetailZoneProps`), `RECORD_TAB_ZONE_NAMES` with `RecordTabZoneName` and `isRecordTabZoneName`, `RecordTabDeclarationSchema`, an optional `tab` on a zone contribution (required on a record-tab zone, refused on every other one) and the TypeScript-only `count` factory (`AdminCountFactory`). `@endora-commerce/admin-kit` adds `recordTabComponent()` on `./contributions`, which takes only a record-tab zone and type-checks the panel and the count loader (`RecordTabCounter`) against the zone's props, and `useRecordTabZone()` on `./zones`, which returns the visible contributed tabs with their labels and counts and renders the selected panel; `zoneComponent()` now refuses a record-tab zone at compile time. The CRM opportunity screen renders `opportunity.detail.tabs` after its _Events_ tab and selects a contributed tab from `?tab=<id>`. The Tasks module's panel on an opportunity left `opportunity.detail.sidebar` and is now a _Tasks_ tab (`?tab=tasks`) on `opportunity.detail.tabs`, whose count is the open linked Tasks; the order and quote-request sidebars keep their _Tasks_ sections. `check:admin-zones` reads `useRecordTabZone('<zone>', …)` as a render site and `recordTabComponent('<zone>', …)` as a contribution.
- 0e81803: The analytics screen helpers that CRM and Projects each kept a copy of now live in the admin kit
  (issue #464): `FigureCard`, `useFigure`, `useChartColors` and `prefersReducedMotion` from
  `@endora-commerce/admin-kit/components`, and the range presets (`RANGE_PRESETS`, `presetRange`,
  `isDayRange`, `DayRange`, `RangePreset`) from `@endora-commerce/admin-kit/lib`. `FigureCard`
  takes the module's error sentence as `errorFallback`, and an optional `footer` drawn under every
  answer. Both analytics screens use the kit copies and behave as before; Projects keeps its own
  wrapper for the period and counts line under each figure.
- 5518a09: `GET /api/v1/admin/import-export/channel-targets` now answers each channel's per-language `name` beside its `id`, `code` and `languages`, and `importChannelTargetSchema` requires it. Code that builds an `ImportChannelTarget` must add `name` (a record of language code to name; an empty record is valid).

  The import profile dialog labels each target as "channel name / language name", with the channel code as secondary text; a channel with no name in any language is labelled by its code, and a saved target whose channel no longer exists is listed as a missing channel.

  `MultiSelectOption` gains an optional `description`, shown muted after the option's label.

- 8a0ec92: `ConfirmDialog` takes a `layer` prop and `useConfirmDialog` takes `{ layer }` options (UX audit follow-up, issue #1567). Both pass it to `ModalDialog`: `layer: 'overlay'` opens the question above the fullscreen Page Builder and Puck's floating action bar, which sat over a confirmation opened at the default `z-50`. The default stays `page`, so existing call sites are unchanged. The new `UseConfirmDialogOptions` type is exported from `./components`.

  The Page Builder's "Clear canvas" question, under the toolbar's "More" menu, is now `useConfirmDialog({ layer: 'overlay' })` instead of a hand-built `ModalDialog`. It behaves as before: focus starts on Cancel, Escape cancels, and focus returns to "More".

- 81fcc3f: `useConfirmDialog`'s `confirm` takes a new `returnFocusTo` option: an element, a ref, or a resolver that names where focus goes after a confirmed answer. A confirmed action that removes the control that asked it, such as a row's _Remove_, used to leave focus on `body` once the row was gone. The target is resolved once, when the dialog closes on a confirmed answer. On Cancel, or when it resolves to nothing, focus returns to the opener as before. The new `ConfirmFocusTarget` type is exported, and the controlled `ConfirmDialog` passes a `finalFocusRef` through to `ModalDialog`.

  Organization members: after a member is removed, focus moves to the next row's _Edit_, else to the previous row's, else to _Add member_.

### Patch Changes

- f5b8275: The admin carts list now shows translated labels (EN and PL) for the cart status and the approval status, in both filter selects and in the status badges. Before, it showed the raw codes, such as `rejected_by_org_admin`. The screen's title, description, column headings and empty and loading text were missing from the `carts` catalogue, so they appeared as raw keys. They are now in the catalogue too, with the new `carts.status.<code>` and `carts.approvalStatus.<code>` keys.

  `OrganizationStatusBadge` now reads its labels from the `core` catalogue (`organizationStatusBadge.<status>`, EN and PL) instead of hard-coded English. The badge is used in the organizations list, the moderation panel and the organization pickers. The English labels are unchanged.

- 84b89ed: The admin no longer shows raw translation keys or a "page not found" message while it starts (issues #1431 and #1485). After sign-in, `App` shows a loading skeleton shaped like the shell until the operator's translation bundle and the module-presence list have loaded. The skeleton is announced as a status in the operator's language. It also opens when either request fails, so it never stays on screen for good.

  `TranslationProvider`'s context, read through `useTranslationContext()`, has a new `ready` field. It is `false` until the provider's first bundle request settles, and `true` from the start when `initialBundle` is passed. After a language change it stays `true`, and the previous bundle stays on screen until the new one arrives.

  `App` takes an optional `translations` prop, beside `modulePresence`. It hands a bundle the caller already has to the provider, so the shell opens on its first render. A test that renders `<App/>` and checks the shell right away should pass it. `translations={{}}` keeps the old output, where every key renders as `scope.key`.

- e5b17ae: The admin kit's primitives draw their own words from the `core` bundle instead of English literals (issue #1433), so a Polish operator no longer reads English where a caller passed no copy: `RuleBuilder`, `MultiSelect`, `FileDropzone`, `AssetFieldPicker`, `CmsBlockPicker`, `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti` and `CustomFieldValuesPanel`'s fallback errors. Every prop that overrode a default still does.

  `RuleBuilderLabels` gains optional entries for each word the builder draws (`addCondition`, `addGroup`, `combineWith`, `groupOperatorLabel`, `groupAll`, `groupAny`, `groupSuffix`, `addChildCondition`, `addChildGroup`, `removeCondition`, `removeChild`, `valuesInputPlaceholder`, `fieldLabel`, `operatorLabel`). Its icon-only remove buttons and its field, operator and AND / OR selects now have accessible names. The default `matchAll` sentence is "No conditions: everything matches." rather than "Matches all carts.", which was wrong on every rule editor that does not filter carts; pass `labels.matchAll` to keep a domain-specific sentence.

  `@endora-commerce/mod-i18n` ships the new `core` keys in English and Polish.

- d4bda8d: In-editor "Add" buttons are outline, not filled, so they no longer compete with the screen's one primary action (issue #1441): the transition graph's "Add transition" (`StatusTransitionGraph`), the channel membership panel's "Add" and the CMS hook panel's "Add". The order status configuration no longer draws its new-status form open under the table: "Add status" in the Statuses card header opens a dialog (issue #1439). The newsletter tags and fields screen does the same for "Add tag" and "Add field", and an empty tag or field list shows an empty state with an icon and a line of explanation instead of a grey sentence (issue #1448).
- 649d662: **The product browser's status strip is the kit `Tabs`, and its empty list is the kit `EmptyState`** (issues #1445, #1448).

  - **Status tabs.** _All / Active / Inactive / Archived_ now follow the WAI-ARIA tabs pattern: the strip is named ("Product status"), it is one stop in the tab order, ←/→ and Home/End move and select, every tab names the list as the panel it controls, and the count is part of the tab's accessible name ("Active, items: 25"). As on every other kit strip, a count of zero draws no badge. While _Show selected only_ is on, the tabs are disabled and none is selected, because the review lists the selection across every status; _Show all products_ leaves it, as before.
  - **Empty list.** A search or type filter that matches nothing shows the kit's no-results block with _Clear filters_, which clears the search and the type, keeps the tab and the selection, and puts focus back in the search box. A tab with nothing in it and no filter says so ("No archived products", "The catalogue has no products yet") without offering to clear anything.
  - `RouteTabsZone` now draws the same strip markup as `RouteTabs`, through one shared internal frame. No visible change.

- 84ed7b6: Empty lists now tell "nothing here yet" apart from "your filters match nothing" (issue #1448). The products, inventory, warehouses, back-in-stock and pricing-override lists used to show one sentence for both. Now a list that its filters emptied offers _Clear filters_, and a list with no records offers its create action, if the operator may use it. The sales channels, credentials, online customers, invoice ledger deliveries, dictionary audit and command hooks screens show the kit's empty state instead of a plain grey sentence.

  - **`EmptyState`'s documentation** says where the block belongs. Use it for the page's or the tab's primary region. Keep a one-line sentence for pickers, inline sub-lists and side widgets.
  - **Header create buttons.** While a list is empty, its header no longer repeats the create button that the empty state carries: products, warehouses, inventory import, sales channels and credentials.
  - **Removed keys.** `catalog` drops `productsList.empty.prefix`, `.button`, `.suffix` and `.readOnly`. The empty catalog now uses `productsList.empty.noData.*`.
  - **Peer dependencies.** `mod-sales-channels`, `mod-credentials` and `mod-invoice-ledger` gain an optional peer dependency on `lucide-react` `^1`, which their admin screens now import.

- 2614e4f: Deletes that fired on one click now ask first (issue #1464).

  `useConfirmDialog().confirm` accepts an `action` and a `describeError` beside the usual options. With them, the dialog runs `action` itself on confirm: busy while it is pending (both buttons and Escape inert, so it cannot be submitted twice), resolving `true` once it succeeds, and on a throw staying open with `describeError(err)` as its announced error, so the operator can retry or cancel where they are looking. A call without `action` behaves as before.

  The newsletter's e-mail block, subscriber, tag and custom-field deletes, the Google Analytics custom-event delete and the megamenu tree's item delete now confirm, naming the object and what deleting it does; focus opens on Cancel. The Google Analytics Delete moves out of the row beside Save into its own section below the form. The megamenu confirmation says how many nested items go with the item, and that nothing changes on the storefront until the tree is saved.

- bb21b86: The admin sidebar's search entry is now a button styled as a search field (issue #1480). It opens the command palette when it is clicked or activated with Enter or Space, no longer when keyboard focus merely lands on it, and it carries an accessible name and `aria-keyshortcuts="Meta+K Control+K"`. Every collapsible sidebar group header, the Pinned section's included, now exposes `aria-expanded` and names the item region it folds through `aria-controls`; group headers and the search entry get a visible focus ring. The top bar's Help button, which had no action, is removed. The design system's `.b2b-topbar__hide-mobile` class, which only that button rendered, is removed with it.
- 3dab0be: The Notes, Messages, Attachments and Change history tabs of an opportunity and a project no longer explain how they work (issue #1487). Notes and Messages say one line, "Internal. Customers never see this.", and the message composer says "Cannot be edited after sending." under the field. The Attachments and Change history tabs open straight on their content. English and Polish both change.

  Removed bundle keys: `attachments.hint` and `history.hint` in CRM, `attachments.hint` and `changeHistory.hint` in Projects. New key in both: `comments.messages.composerHint`.

  In the admin kit, `CommentThreadCopy` takes an optional `composerHint`, a line under the composer that describes the field (`aria-describedby`). `CommentComposer` takes the matching `hint`. `RecordHistoryCopy.hint` is now optional, and no paragraph is drawn without it.

- a4455db: The Home dashboard, the command palette's prompt mode and the admin kit's shared components now use one visual system: the kit's `ui/*` primitives and Tailwind utilities instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

  - Home (issue #1556): the quick actions are a short list of links instead of four full-width buttons. The stock-alert thumbnails use the sunken-surface colour token instead of a fixed grey gradient, so they follow the dark theme. The KPI tiles, the recent-activity feed and the stock alerts are kit `Card`s with `h2` titles, and the activity feed's loading state is announced.
  - Prompt mode: the clarification text box is the kit `Input` and now has a name.
  - Admin kit: `PaginationFooter`, the product browser and its trigger, `SaveSessionActions` and `RecordTabs` draw kit `Button`, `Select` and `Card` parts. The product browser's search box is the list toolbar's search. Its side-drawer frame stays until the kit has a drawer.
  - The theme still defines the classes these screens stopped using: `b2b-btn--default`, `b2b-field--addon`, `b2b-input-wrap`, `b2b-card--clickable`, `b2b-card__head`, `b2b-card__sub`, `b2b-card__title`, `b2b-card__foot`, `b2b-card__body--flush`, `b2b-filterbar`, `b2b-filterbar__search`, `b2b-kpi-grid`, `b2b-home-dashboard-grid` and `b2b-thumb`. A theme override that targets one of them no longer reaches these screens.

- f093a02: Every dialog the Page Builder, the e-mail builder and the CMS editor open over the canvas is now the kit's `ModalDialog` on the `overlay` layer (issue #1493, UX audit CONTENT-03). Save as template, apply template, copy from language, clear canvas, Translate, the column-layout pickers, the colour palette, the asset library, the product and category searches, the variable picker and the e-mail preview all trap focus, close on Escape, return focus to the button that opened them, and are named by their title. Before, each drew its own scrim, and none of them trapped focus. The result of saving or applying a template, or of copying from a language, now appears next to its button. Before, it was announced only to screen readers. A failure stays inside the dialog. Clear canvas opens with focus on Cancel. The column-layout pickers, the variable picker and the catalogue searches read their copy from `core` in English and Polish, and their search fields are labelled. `MODAL_OVERLAY_Z_INDEX` rises from 10000 to 2147483646, so an `overlay` dialog also opens above the rich-text editor's own dialogs, from which the asset library is opened.
- d5a077f: The Page Builder has one canvas toolbar (issue #1494, UX audit CONTENT-11). `PageBuilderHeaderActions` now draws the module's own actions (`extraActions`, such as Translate or Preview email), a labelled **More** menu and Fullscreen. Save as template, Apply template, Copy from language and Clear canvas are entries of that menu. Clear canvas is the last entry, after a separator, in the destructive colour, and still asks before it clears. An entry that cannot run says why under its label.

  **Breaking for consumers of `@endora-commerce/page-builder-admin`:** `PageBuilderTemplateActions` and `PageBuilderHeaderShell` are removed. Pass their props to `PageBuilderHeaderActions` instead and drop the Puck `header` override:

  ```tsx
  // before
  header: ({ children }) => (
    <PageBuilderHeaderShell leading={<PageBuilderTemplateActions currentData={data} onSaveAsTemplate={save} onListTemplatesForApply={list} onApplyTemplate={apply} t={t} />}>
      {children}
    </PageBuilderHeaderShell>
  ),
  headerActions: () => <PageBuilderHeaderActions fullscreen={fs} onToggleFullscreen={toggle} currentData={data} t={t} />,

  // after
  headerActions: () => (
    <PageBuilderHeaderActions
      fullscreen={fs}
      onToggleFullscreen={toggle}
      currentData={data}
      onSaveAsTemplate={save}
      onListTemplatesForApply={list}
      onApplyTemplate={apply}
      t={t}
    />
  ),
  ```

  The `.cms-pb-header-shell`, `.cms-pb-header-left` and `.cms-pb-header-leading` rules are removed from the admin kit's `theme.css`. The CMS, blog, megamenu and document-template editors show Back as the page header's back link above the title instead of a button beside Save. The `core` bundle gains `pageBuilder.clearCanvas.alreadyEmpty` in English and Polish.

- fc7f669: The six sales lists now have one shape (issue #1500, UX audit SALES-24). Each is the kit `ListPage` with the kit `ListToolbar`, so the toolbar is a named `search` landmark in a plain row, not a card. Below it is one results card that holds the bulk bar, the table and the pager. The kit `EmptyState` tells "nothing here yet" apart from "nothing matches these filters", and the second one offers _Clear filters_.

  - **Orders**: _New order_ is in the header for an operator holding `orders:write`. The toolbar, bulk-bar and results cards are now one card. While rows are selected, the bulk _Change status_ button is outline, so _New order_ stays the one filled primary. Each row has a menu with _Change status…_ and _Print invoice_ for that one order, plus _Open organization_. The pager offers only the page sizes the endpoint serves.
  - **Quote requests**: the hand-built toolbar, filter toggle and chips are replaced by the kit toolbar, so the advanced filters sit behind _More filters (n)_. Each row's menu has _Open organization_.
  - **Returns**: the four configuration links (workflow, reasons, return methods, clauses) are one _Settings_ menu next to _Export CSV_. The search is no longer listed as a chip. _Clear all filters_ empties the search too. When a case has an order, its row menu has _Open order_.
  - **Customers**, **Organizations**, **Carts**: these use the kit toolbar and the kit empty state. Each filter is named by its label, and its first option says what it is ("All statuses"). Customers and Carts rows have _Open organization_.

  Removed unused translation keys: `orders.open`, `orders.loading`, `orders.empty`, `rfq.list.open`, `rfq.list.loading`, `rfq.list.filter.toggle`, `rfq.list.filter.clearAll`, `returns.loading`, `returns.empty`, `returns.action.open`, `returns.filter.clearAll`, `organizations.filter.all` (core); `list.search.chip` (returns); `list.clearFilters` and `list.filter.all` (customers); `list.clearFilters` (organizations); `carts.clearFilters` and `carts.filter.all` (carts). The admin-kit README documents how the two compose.

- 87b9b60: The product editor states the scope once (issue #1508, UX audit CAT-08). `ScopedField` no longer shows an "Inherited", "Not translated" or "No value" badge on an inheriting field while its "Use value from <parent>" checkbox is shown, and its source line appears only when it adds a fact the field does not already show: no value at any scope above, a value inherited from further up than the checkbox's parent, an untick with nothing staged yet, what a staged tick will use, or what an own empty value means. "Set at this scope" no longer repeats the "Overridden" badge. Without write access, where there is no checkbox, the badge and the line stay as before. The product editor's scope bar drops its "Editing: <scope>" column — the channel and language selects and the banner already name the scope — and moves the Scope map link beside the language select; the `productEditor.scope.editing` string is removed.
- 306a659: The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — _Organizations_, _Price books_, _CMS pages_ — instead of _Back to organizations_, _All warehouses_, _Back to list_ or a bare _Back_ (follow-up of issue #1549). A generic _Back_ remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

  The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.

- 7ea72af: The way back from a detail, create or settings screen is now always the page header's back link above the title (issue #1549). Organization, New organization, Tax ID scope, Change tax ID, Convert to company, Order statuses, Return, Form entry, Category content, Product content and Comparison drew it as an outline Back button among the header actions, an arrow link above the header, or a button at the bottom of the page. Order statuses now goes back to "Orders" rather than a bare "Back". A form entry that is missing or cannot be loaded shows a "Form entry" heading with the same back link. The admin-kit README names `PageHeader` `back` as the one pattern.
- f33ffed: **`RowActionMenu`: the icon-only trigger is a 44 × 44 touch target.** On a coarse pointer the ⋮ trigger, and the move-up, move-down and delete buttons of a `LineGroupsEditor` group heading, grow their hit area to 44 × 44 px with a transparent pseudo-element. Before, they were 32 px, below the touch minimum. They still look 32 px, and nothing changes with a mouse.
- 0d4c134: Accessibility follow-ups from the UX audit (issues #1599, #1600, #1607).

  - **Scope picker** (CMS pages, blocks and templates; blog posts and categories): the _Languages_ heading now names the group of language checkboxes, so a screen reader announces "Languages, group" when focus enters it. It used to be a label attached to nothing.
  - **New order — delivery and billing address**: the _Pick existing_ / _Enter new_ buttons are a group named _Address source_, and pressing the option already chosen no longer clears a typed address or a picked one.
  - **Pricing settings — Show the list price beside the buyer's price**, and the **Private** setting on a new task and on a task's page, are now the standard on/off switch rather than a checkbox announced as a switch. A task's _Private_ switch that cannot be turned on (other people are assigned) stays focusable and says why.
  - The unused, never-displayed _Quote requests_ settings tab component in the Settings module, and its strings, are removed. The quote-request settings are unchanged.

- 8688a1f: Nine more admin list screens now use the kit `ListPage` (issue #1749): Inventory, Low stock, Warehouses, Availability notifications, Product feeds, Price books, Return reasons, Return delivery methods and Return clauses. Each one has the kit's loading skeleton, a load error with **Retry**, and the result count at the end of the toolbar row. The inventory lists' toolbar is a row above the results, not a strip inside their card. A filter or page change on Inventory, Warehouses, Availability notifications and Price books keeps the rows on screen while it reloads. Return clauses show the kit empty state instead of a bare sentence. Product feeds no longer show _New feed_ twice while there is no feed.

  - `@endora-commerce/admin-kit`: the `ListPage` `tabs` slot is documented as the band between the header and the toolbar, which can also hold a KPI strip.
  - New `en` / `pl` keys: core `warehouses.count`, `inventory.count`, `inventory.lowStock.count`, `inventory.availability.count`; `product_feeds` `feeds.count`; `returns` `reasons.count`, `methods.count`, `clauses.count`.

- e118ee4: **Pager buttons keep keyboard focus at the ends of the range** (#1803).

  `PaginationFooter` (offset and cursor modes) and `CursorPagination` now mark Previous / Next with `aria-disabled` instead of `disabled` on the first and last page, and while a cursor page is being fetched. Pressing Next onto the last page no longer drops focus to the page body; the button stays focusable, is announced as unavailable and ignores the press, so `onNext` / `onPrev` are still never called past the range. The range summary is now a polite live region, so the page change is announced.

  No prop changes. A consumer test that asserted `toBeDisabled()` on these buttons should assert `toHaveAttribute('aria-disabled', 'true')` instead.

- 5fb3cd3: Six small Admin defects from the demo click-through are fixed (issue #1808).

  - The Inventory stock overview shows each product's name in the Product column, not its SKU.
  - Custom-field labels are shown in the admin's language. A host that does not set the language (order, customer and organization detail, among others) used to show a Polish operator the field's default label, which may be its code.
  - The "New channel" button no longer reads "+ + New channel". The blog category tree's "Add subcategory" button and the quote's "Add line" button show a plus icon instead of a typed "+".
  - On the opportunities list the two filters say what they filter: "Open and closed" (the outcome) and "All workflow statuses" (the stage in the workflow). The Number and Organization columns stay on one line; a long organization name is cut with an ellipsis.
  - The product editor's low-stock threshold placeholder reads "Inherited" and fits its input. The help text under it still explains the inheritance.
  - The newsletter subscriber search shows "Search by e-mail" in the box.

- fbc6c7c: The command palette (⌘K / CTRL+K) now tells a screen reader which result is highlighted (issue #481). The search input is a `combobox` that controls a `listbox`, every result is an `option` with a stable id, and the input's `aria-activedescendant` follows the highlight as the arrow keys move. Group headings label `role="group"` containers, and a record type that could not be searched is a disabled option. Keyboard behaviour is unchanged: focus stays in the input, `Enter` opens the highlighted result and `Alt+Enter` pins or unpins it.

  A pinnable result now says "Pinned" or "Not pinned" in its accessible name and carries `aria-keyshortcuts="Alt+Enter"`. The pin icon beside it is no longer a `<button>`: a result's children are presentational, so the icon is a pointer shortcut hidden from assistive technology, marked `data-palette-pin` and `data-pinned`. The theme's `.b2b-palette__pin[aria-pressed="true"]` selector is now `.b2b-palette__pin[data-pinned="true"]`; a deployment stylesheet that targets the old selector must follow.

  New `core` bundle keys: `appShell.palette.pin.statePinned`, `appShell.palette.pin.stateUnpinned`, `appShell.palette.results` and `appShell.palette.title` (the palette dialog's name), in English and Polish.

- 12c63fa: `FormField`'s `action` slot is marked as a ReactNode slot for the raw-enum lint rule from #1434, like `Section`'s. No behaviour change; it unblocks `pnpm -r run lint` on master, which turned red when #1432 and #1434 merged together.
- 72637e0: `UnsavedChangesDialog` no longer wraps `ModalDialog` in a second portal: `ModalDialog` renders into `document.body` itself since DS-11 (#1444).
- Updated dependencies [65f9a7b]
- Updated dependencies [3fdbe86]
- Updated dependencies [bfc68c7]
- Updated dependencies [9eaa409]
- Updated dependencies [3872f3d]
- Updated dependencies [bbfcd80]
- Updated dependencies [41b598c]
- Updated dependencies [467b075]
- Updated dependencies [a56109e]
- Updated dependencies [c15eb60]
- Updated dependencies [33db45a]
- Updated dependencies [074f500]
- Updated dependencies [cec9beb]
- Updated dependencies [90320fd]
- Updated dependencies [42febee]
- Updated dependencies [98c0411]
- Updated dependencies [a8261aa]
- Updated dependencies [f64646d]
- Updated dependencies [f6dda10]
- Updated dependencies [ee6062c]
- Updated dependencies [4e668b5]
- Updated dependencies [843ed42]
- Updated dependencies [6155f4b]
- Updated dependencies [5850aac]
- Updated dependencies [8a5725e]
- Updated dependencies [f915a24]
- Updated dependencies [8a06dc5]
- Updated dependencies [9eee781]
- Updated dependencies [bd47236]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [8b29aae]
- Updated dependencies [398e6d2]
- Updated dependencies [51c5072]
- Updated dependencies [2e287a5]
- Updated dependencies [9d6f006]
- Updated dependencies [49328cf]
- Updated dependencies [b3d4843]
- Updated dependencies [27b977d]
- Updated dependencies [5e2a12a]
- Updated dependencies [5518a09]
- Updated dependencies [5e380e3]
- Updated dependencies [bfab5bd]
  - @endora-commerce/contracts@0.112.0

## 0.111.0

### Minor Changes

- f39d37f: `CustomFieldValuesPanel` honours a definition's admin access (`specs/175-buyer-input-custom-fields/`).

  - A `read` definition renders as its label and stored value (a dash when there is none) with no input; a `hidden` one is not rendered. A panel whose every definition is `hidden` renders nothing, as for an entity type with no definitions.
  - **The bag handed to `save` and to `onChange` now carries the keys of `edit` definitions only.** A stored `read` or `hidden` value, and a key with no definition, are no longer in it; every in-tree host sends the bag as a patch to a merging endpoint, which keeps an absent key, so a panel save no longer overwrites a value it did not let the operator edit — including one an integration wrote after the page loaded.
  - A refusal for a non-`edit` field — passed in `fieldErrors`, or answered by the host's `save` in a `CUSTOM_FIELD_VALUE_INVALID` envelope — is shown at the top of the panel with the field's label and level and a pointer to the Custom fields screen. New `core` keys: `customFields.adminAccess.read`, `customFields.adminAccess.hidden`, `customFields.nonEditableRefusal`, `customFields.value.yes`, `customFields.value.no`.
  - Admin access is a panel convenience, not access control: no API endpoint reads it.
  - New export `customFieldErrorsOf(error)` from `./components`, beside the panel: a `422 CUSTOM_FIELD_VALUE_INVALID` `ApiError` as the panel's `fieldErrors` (definition key → sentence), `null` for any other failure. Every host create screen reads a refusal through it.

- f5caa4e: **Convert to company in the Admin UI.** A personal organization's page offers _Convert to company_ to holders of `organizations:convert-to-company`. A dialog asks for the company name, an optional legal name, the tax ID (spaces and dashes removed as you leave the field), the registered address, the VAT status and whether to validate the tax ID afterwards. It reports the validation's outcome; the organization page then shows its members and roles. _Convert personal organization_ (`/organizations/convert-to-company`, also from ⌘K and from the Organizations list's header menu) does the same in two steps, starting from a picker of personal organizations. `GET /api/v1/admin/organizations` accepts `filter[isPersonal]=true|false` with `includePersonal=true`.

  - **admin-kit:** `OrganizationPicker` takes an optional `kind` — `'company'` (default, unchanged), `'personal'` or `'any'`; `useOrganizationsQuery` takes the same option, and `OrganizationPickerKind` is exported.

- 2e603f7: `@endora-commerce/admin-kit/components` exports `ConfirmDialog` and `useConfirmDialog`
  (with `ConfirmDialogProps`, `ConfirmOptions` and `UseConfirmDialog`), the design-system
  replacement for the browser's `window.confirm()` (issue #313).

  `useConfirmDialog()` returns `{ confirm, confirmDialog }`. Render `confirmDialog` once in the
  screen, then replace `if (!window.confirm(message)) return;` with:

  ```tsx
  if (!(await confirm({ message, confirmLabel: t('common.action.delete'), destructive: true })))
    return;
  ```

  `confirm` resolves `true` on the confirm button and `false` on Cancel, Escape, the scrim, or when
  the screen unmounts. `title`, `confirmLabel` and `cancelLabel` default to the `core` bundle's
  `common.confirm.title`, `common.action.confirm` and `common.action.cancel`. A `destructive`
  question styles the confirm button as destructive and opens with focus on Cancel. Any other
  question opens with focus on the confirm button. Focus returns to the opener on close.
  `ConfirmDialog` is the controlled form, with `busy` and `error`, for a screen that keeps the
  dialog open while its own request runs. Both are built on `ModalDialog` and render into
  `document.body` through a portal, so a call site inside a table row does not nest a `<div>` in
  a `<tbody>`.

  `react-dom` (`^19.0.0`) is now a peer dependency, for `createPortal`. Any app that renders the
  admin already has it.

- 577e94c: **`@endora-commerce/admin-kit/components`** adds `ImmediateBadge`, the one "Applies immediately" badge for the heading of a section whose controls write at once, outside the page's one Save (issue #407, `specs/180-one-save-zone-editors/` FR-061). Text with a decorative icon, drawn with the info tokens the product editor used. An optional `className` places it and is merged last, so a caller's spacing class replaces the badge's own. Its string is `saveSession.immediateBadge` in the `core` catalogue (English and Polish), which `@endora-commerce/mod-i18n` now ships.
- e435bad: Save-session additions, needed by the first editor to adopt the session (issue #407):

  - `SaveParticipantHandlers.validate` and `save` now receive the participant's saved state as a third argument, `baseline`, so a part can check and write only what changed. Handlers that take two arguments keep working.
  - `useSaveSession()` returns `zoneOf(partId)`, the zone a participant rendered in, or `null` for a host-owned section. A host uses it to take the operator to the part from the summary's "Show" without naming the contributing module.
  - Fix: a panel that remounts while its read is still in flight no longer discards the draft the session kept for it.

- 7bdf512: **`@endora-commerce/admin-kit/components`** adds the two generic controls for an editor's save session (issue #407, `specs/180-one-save-zone-editors/contracts/save-participation.md` §5):

  - **`SaveSessionActions`** (`hostCount`, `canSave`, `saving`, `onSave`, optional `describedBy`). This is the one Save for a host that has no Save of its own. It renders inside `StickyFormActions` and reads "Save" or "Save n changes", counting the host's changes plus every participant's. It is inert while there is nothing to save or a save is running. It is shown when the host record or any participant is writable.
  - **`SaveSessionSummary`** (`outcome`, `notices`, `onShow(partId)`). This renders a `SaveOutcome` part by part:
    - a refusal lists each part with its number of problems;
    - a partial save says what was saved and what was not, with the reason;
    - a failed save says nothing was saved;
    - a full save is announced in a polite live region only.
      Each part with a problem has a "Show" button, which calls `onShow`. Focus moves to the summary's heading when an outcome arrives. Discarded-change notices are listed below.

  `CustomFieldValuesPanel` takes an optional `saveSession`. With one, the panel joins the page's one Save as a host-owned section and renders no Save button of its own. The page Save writes it through the host's `save`, and a refused write shows at the field. Without `saveSession`, the panel works exactly as before.

- 5c148de: **`@endora-commerce/admin-kit/lib`** adds the save session (issue #407, `specs/180-one-save-zone-editors/contracts/save-participation.md`). It lets the panels contributed to an editor's zones save with the editor's one Save:

  - `SaveSessionProvider` (`resetKey`, optional `hostModule`) wraps a host editor. A new `resetKey` starts an empty session.
  - `useSaveSession()` is the host side. It returns `handle` (pass it as the zones' `saveSession` prop), `dirtyCount`, `hasWritableParticipant`, `dirtyParticipants()`, `discardAll()`, `clearOutcome()`, `saving`, `notices`, `lastOutcome` and `run(hostPart, { stopOnFailure? })`.
  - `useSaveParticipant(handle, { key, label, writable, loaded }, { changeCount, validate, save })` is the contributor side. Drafts are held by the session, so they survive the panel unmounting. The participant's id is `${module}:${key}`, and its module comes from the zone contribution that rendered it. Outside a zone, the provider's `hostModule` owns it. A participant whose module is switched off or whose contribution crashes is dropped with a notice. A `503 MODULE_DISABLED` from its write is reported as switched off.
  - `runSave(parts, options)` is the pure orchestrator. It validates every part first and writes nothing if any part refuses. It then writes the parts in order: a blocking part that fails stops the run, and a non-blocking part that fails is recorded while the rest still run. `hasIssues` is exported beside it.
  - `INERT_SAVE_SESSION` is the handle for a mount with no live session. A participant given it keeps a local draft and takes part in no Save.

  Types: `SavePart`, `SaveContext`, `ParticipantIssues`, `SaveOutcome`, `SaveOutcomePart`, `SavePartResult`, `RunSaveOptions`, `SaveParticipantHandlers`, `SaveParticipantSpec`, `SaveParticipant`, `ParticipantStatus`, `SaveSessionValue`, `SaveSessionProviderProps`. `<AdminZone>` now tells each contribution which module and zone it renders in, and `ZoneErrorBoundary` reports a crashing contribution to the live sessions.

- 0beb869: `CustomFieldValuesPanel` takes an optional `readOnly` prop (issue #407, `specs/180-one-save-zone-editors/` WP-7). With it, every field is shown as its value with no input, the way an `edit`-level definition is shown at `read`, and nothing reaches the bag. Without it the panel is unchanged. The organization detail uses it for an operator without `customers:manage`, whose page Save would never write the custom fields.
- 54ae028: `useAuth()` now returns `hasAnyPermission(codes: readonly string[]): boolean` (issue #458). It
  answers `true` when the signed-in admin holds any one of `codes` (a `'*'` role holds every code),
  and `false` for an empty list. Use it instead of `codes.some((code) => hasPermission(code))`, and
  write the codes as a literal array at the call: the permission inventory in
  `@endora-commerce/mod-admin-roles` reads that literal, so each code is checked. A test that mocks
  `useAuth()` for a component that calls `hasAnyPermission` must add it to the mock.
- 8ae3f58: **Behaviour change: a line quantity has an upper bound, refused with a new error code, `LINE_QUANTITY_EXCEEDED`; and the quote request and return line arrays have a line-count bound** (issue #351). A quantity past the integer column it is stored in used to pass validation and answer `500`; it is now refused, in the reader's language.

  New in `@endora-commerce/contracts`: `LINE_QUANTITY_MAX` (`1 000 000`, the same value as `ORDER_MINIMUM_MAX`, so the largest minimum stays orderable), `lineQuantitySchema` (a whole number in 1…`LINE_QUANTITY_MAX`), `boundedLineQuantity(schema)`, `isLineQuantityExceededIssue(issue)`, `LINE_QUANTITY_EXCEEDED` (also in `ERROR_CODES`) and `REQUEST_LINE_ITEMS_MAX` (`200`). `ADMIN_ORDER_MAX_ITEMS` and `QUICK_ORDER_BUILD_MAX_ITEMS` are now that constant under their own names; their value does not change.

  **The new code.** Every request schema carrying a line quantity uses `lineQuantitySchema`: `addCartItemRequestSchema`, `updateCartItemRequestStrictSchema`, `createQuoteRequestSchema` / `patchQuoteRequestSchema` lines, `adminCreateQuoteRequestSchema` / `adminPatchQuoteRequestSchema` lines, `adminCreateOrderRequestSchema` / `adminOrderPreviewRequestSchema` items, `apiPlaceOrderRequestSchema` lines, `quickOrderBuildRequestSchema` items, `quickOrderOneClickRequestSchema`, `addShoppingListItemRequestSchema`, `updateShoppingListItemRequestSchema`, `createReturnCaseRequestSchema` lines, `catalogBulkPriceRequestSchema` lines, `cartSnapshotSchema` lines, and the packaging unit's `baseQuantity` in `createPackagingUnitRequestSchema` / `updatePackagingUnitRequestSchema`. A quantity past the bound is a Zod issue tagged `LINE_QUANTITY_EXCEEDED`. The error envelope in `@endora-commerce/platform` answers a request whose only failures are that issue with `400 LINE_QUANTITY_EXCEEDED` and a translated sentence (`@endora-commerce/mod-i18n` ships it in English and Polish), with `details` naming the field. A request that fails anything else as well stays `400 VALIDATION_FAILED`, with the issue among its details. `POST /api/v1/external/orders` and `POST /api/v1/external/catalog/prices` parse their bodies themselves and keep answering `422 VALIDATION_FAILED`; the detail's `issue` there is `LINE_QUANTITY_EXCEEDED`.

  `@endora-commerce/mod-carts`: two cases are refused with `422 LINE_QUANTITY_EXCEEDED`, `details: { quantity, maximum }`, and write nothing: an add onto an existing basket line whose sum would pass the bound, and a packaging-unit add whose pieces (`baseQuantity × units`) would pass it. This covers the single and batch add, reorder and shopping list to cart. Signing in sums the anonymous basket into the customer's and keeps a summed line at the bound instead of failing the sign-in. `updateCartItemRequestSchema` (the line edit) now accepts any quantity from `0` (remove) to the bound; it stopped at `999`.

  **Line counts.** The line arrays of `adminCreateQuoteRequestSchema`, `adminPatchQuoteRequestSchema` and `createReturnCaseRequestSchema` are bounded at `REQUEST_LINE_ITEMS_MAX`, as the customer's quote request create and edit already were: one line more is `400 VALIDATION_FAILED`. The value is shared but the refusal is not. The order intakes (admin create and preview, `POST /api/v1/external/orders`) and the quick-order build keep refusing more than 200 items with `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, and the basket's own cap stays `422 CART_LINE_CAP_EXCEEDED`.

  `@endora-commerce/admin-kit`: `parsePositiveInt` returns `null` past `LINE_QUANTITY_MAX`, so the admin order and quote request create screens mark such a line invalid before sending it. `@endora-commerce/mod-quick-order`: an imported row past the bound, and every row of a duplicate whose sum passes it, is rejected as `quantity_invalid` instead of being recognised into a build that would be refused. `@endora-commerce/mod-quote-requests`: the Modify tab's quantity input carries the bound as its `max`.

### Patch Changes

- baa0dae: `CustomFieldValuesPanel` hands its host only the custom-field keys the operator changed (issue #1007). Until now the bag given to `save` and `onChange` carried every `edit`-level key the panel had loaded, so saving the order custom-fields panel wrote an unchanged, stale value over one another writer had changed after the page loaded, even though `PATCH /api/v1/admin/orders/:id/custom-fields` merges per key.

  - The bag now holds the `edit`-level keys whose value differs from the one the panel loaded. A cleared field is still in it, as `null` (an empty string for text, an empty array for a multiselect); a field edited back to its loaded value is not.
  - With its own Save, the panel compares against what its last successful save wrote, so a second save does not send the first one's keys again. A refused save keeps them.
  - Under a page Save (`saveSession`), the save session's baseline is the comparison point.
  - A host that forwards the bag as it is needs no change. A host that fills in the keys missing from the bag (as cleared, for example) must stop doing so: a missing key now means "unchanged", and filling it in clears a value the operator did not touch.

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- 097b599: Save session fix (issue #1271): an edit made in the moment between a panel's read landing and the session being seeded with it is no longer dropped. `useSaveParticipant`'s `setDraft` now seeds a participant that has no entry yet from the current render's read before it records the draft; an entry that already exists is not re-seeded, so a Save's newer baseline is kept.
- d591709: Save session fix (issue #407): an edit made right after a participant became writable is no longer dropped. `useSaveParticipant`'s `setDraft` now applies the current render's `writable` and label before it records the draft, instead of waiting for an effect.
- Updated dependencies [ee0698d]
- Updated dependencies [9c8efbe]
- Updated dependencies [3de70b4]
- Updated dependencies [2ee4923]
- Updated dependencies [e9df6b5]
- Updated dependencies [3254098]
- Updated dependencies [7616ef1]
- Updated dependencies [ed57923]
- Updated dependencies [cffa0bf]
- Updated dependencies [c58acd1]
- Updated dependencies [fc91398]
- Updated dependencies [feaa40b]
- Updated dependencies [d2f179f]
- Updated dependencies [d16b343]
- Updated dependencies [34b3387]
- Updated dependencies [e283396]
- Updated dependencies [4ecb155]
- Updated dependencies [ff7bd10]
- Updated dependencies [761d9c4]
- Updated dependencies [8e7f794]
- Updated dependencies [8e7f794]
- Updated dependencies [f39d37f]
- Updated dependencies [3f95d1c]
- Updated dependencies [695636f]
- Updated dependencies [27834f3]
- Updated dependencies [190986e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [aaa50ff]
- Updated dependencies [6e528ad]
- Updated dependencies [eedda68]
- Updated dependencies [73e8e8c]
- Updated dependencies [bf257b8]
- Updated dependencies [e435bad]
- Updated dependencies [5c148de]
- Updated dependencies [036865c]
- Updated dependencies [37532da]
- Updated dependencies [bfdbeaf]
- Updated dependencies [65f7abc]
- Updated dependencies [a998fee]
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
- Updated dependencies [44529a4]
- Updated dependencies [af88938]
- Updated dependencies [42a9a4b]
- Updated dependencies [8ae3f58]
- Updated dependencies [65cdd0e]
  - @endora-commerce/contracts@0.111.0

## 0.110.0

### Minor Changes

- 9d9c8df: Blog post authors and administrator author profiles (feature 171, US6–US7).

  An administrator keeps an avatar (a library asset) and an _about me_ text per language on their
  profile page: `PATCH /api/v1/admin/me` and `PATCH /api/v1/admin/admin-users/:id` take
  `avatarAssetId` and `bio`; an avatar that is no live asset is refused with
  `422 ADMIN_USER_AVATAR_NOT_FOUND`. The library counts an avatar as a use of the asset (reference kind
  `admin_user_avatar`). `admin_users` declares `assets_library` as a non-binding dependency.

  A blog post names one author, an administrator (`authorAdminUserId` on create and patch;
  `422 BLOG_AUTHOR_NOT_FOUND` for anyone but an active administrator). Editors with `blog.write` pick
  one from `GET /api/v1/admin/blog/author-candidates` (names and avatars only). The storefront shows the
  author's name, avatar and biography on the post page, the name on cards and a `Person` in the post's
  JSON-LD; an inactive author is still shown, a deleted one is not. `blog` now depends on `admin_users`.

  `@endora-commerce/contracts`: `AdminUserRecord.avatarAssetId` and `.bio`, and
  `AdminUserReadPort.findByAvatarAssetIds` — **an implementer of the port must add it**;
  `adminUserSchema.avatarAssetId`/`.bio`; `ADMIN_USER_BIO_MAX_LENGTH`; `blogAuthorSchema`,
  `blogAuthorCardSchema`, `blogAuthorCandidateSchema`, `blogPostAuthorAdminSchema`; `authorId` and
  `author` on post cards and the resolved post; `assetReferenceKindSchema` gains `admin_user_avatar`.
  `@endora-commerce/admin-kit`: `AdminMe.adminUser.avatarAssetId` and `.bio`.

- 3f020ba: **`ScopedField` — one inherited-value control for scoped product fields (feature 174).** `@endora-commerce/admin-kit` exports `ScopedField` and its types (`ScopedFieldProps`, `ScopedFieldControlProps`, `ScopedFieldViewWithParent`, `ScopedInheritedValue`): a field at Global, a channel, or a channel and language, showing "Use value from _parent scope_", an own value, or a deliberately empty value. `use-unsaved-changes-prompt` honours a `[data-own-unsaved-guard]` opt-out.

  **Breaking:** the product browser and the page-builder catalog pickers read a product's `name` as a string (the Global name); a caller passing a per-language name map passes the string instead.

  `CategoryTreePicker`'s list is a labelled `role="group"` instead of `role="tree"`: its rows are checkboxes, not `treeitem`s, and it has no tree keyboard model. A test that queried `getByRole('tree', …)` queries `getByRole('group', …)`.
  - `@endora-commerce/admin-kit/ui` exports `DropdownMenuSeparator` (the existing primitive), so a menu can set its destructive item apart.
  - `CategoryTreePicker`: clicking a category name toggles it, each expand control names its branch (`categoryTreePicker.expand` / `.collapse` take `{name}`), the list id is per instance, the loading line is a status, and its controls are 44 px below 1024 px. The `ScopedField` "Edit at" control is 44 px there too.

- cea1470: **Breaking:** `useAuth()` gains `federatedSignInError: FederatedSignInErrorCode | null`, and the `?error=` a federated sign-in leaves on `/login` no longer arrives in `lastLoginError`. `AuthProvider` passes on only a value that parses with `federatedSignInErrorCodeSchema`; any other value, a sentence an older `mod-mfa` sent included, arrives as `'sign_in_failed'`, so the raw value is never available to print. A login screen that rendered `lastLoginError` to show a federated refusal now reads `federatedSignInError` and words the code itself. `lastLoginError` still carries the backend's answer to a password or second-step attempt and the session-expired notice. `useAuth()` also gains `lastLoginReason: LoginErrorReason | null` (the type is exported from `@endora-commerce/admin-kit/lib`). It is `'session_expired'` for the notice set when a signed-in session answers 401, and `null` otherwise. It is set and cleared together with `lastLoginError`, so a screen titles the session-expired notice from the reason instead of matching the message text. The next sign-in attempt clears all three (issue #813).

### Patch Changes

- 7f2fa6e: `ScopedField` no longer drops an untick of "Use value from <parent>" made right after the field renders. The reset that a new read (a new `view`) applies now happens while rendering instead of in an effect, so it can no longer be queued behind the untick and undo it. A new `view` still starts the field over, as before.
- b476f44: `Combobox` (`@endora-commerce/admin-kit/ui`) now lets you clear any value the field shows, not only one found among the loaded `options`. Before, the "Clear selection" button and Backspace on an empty input worked only once `options` contained the current `value`. So a server-side picker that shows its value through `selectedLabel` could not clear it when that value was missing from the current page, or when the lookup no longer returned it (a deactivated record). This affected every picker built on `Combobox`, the kit's own and modules' alike. The props are unchanged; `clearable={false}` and `disabled` still mean no Clear. A non-null `value` that the field cannot show (not in `options` and no `selectedLabel`) still offers nothing to clear.
- 5cbffb9: A signed-in admin who opens `/login` (a bookmark, a link in an e-mail) is redirected instead of seeing "Page not found" (issue #859). `App` gains a `/login` route for the authenticated tree. It leads to the `?next=` target when that is a path of this application, and to the dashboard (`/`) otherwise. Nothing else in the query is carried over, so `?error=` is still never shown.

  `readReturnTo(params, param?)` in `@endora-commerce/admin-kit/lib` takes an optional parameter name, which defaults to `returnTo`. It reads `next` by the same rule: a path of this application only, never a scheme, a host or `//`. Existing calls are unchanged.

- fc7db4c: `SalesChannelPicker` with `activeOnly` keeps a stored inactive channel among its options (#912). It used to ask the endpoint for active channels only, so a saved value pointing at a deactivated channel was missing from the options: the field showed nothing and offered no Clear. The picker now reads the whole list and narrows the options itself, as the CRM's sales-channel lookup does — the stored channel stays visible, marked inactive in the list, and can be cleared or replaced, while other inactive channels are still not offered as new choices. Its request is now always `activeOnly=false`.
- 974be57: The asset upload now goes through the kit's 401 handling (issue #354). `uploadAsset` posts through the new `postMultipart` helper, exported from `./lib`. An expired session now notifies the `onUnauthorized` listeners and sends the operator back to sign in, and every failed upload is an `ApiError` instead of a plain `Error`. `AssetUploader` shows the server's message for a refused upload. `createApiClient` sends a `FormData` body as multipart instead of as JSON, and without a `fetchFn` it now looks up the global `fetch` on each request rather than once at creation.
- Updated dependencies [18cce2e]
- Updated dependencies [9cfb28b]
- Updated dependencies [a206da9]
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
- Updated dependencies [4cf529d]
- Updated dependencies [5e4dd48]
- Updated dependencies [75b053f]
- Updated dependencies [54fc8f1]
- Updated dependencies [dac5795]
- Updated dependencies [5bbb389]
- Updated dependencies [d69e765]
- Updated dependencies [dbc1cef]
- Updated dependencies [a6bc891]
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [29d7e90]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
- Updated dependencies [14fe4fb]
- Updated dependencies [76d89ab]
- Updated dependencies [6bd2ab7]
- Updated dependencies [a3502c0]
- Updated dependencies [7a73cc8]
- Updated dependencies [5ff8302]
- Updated dependencies [c34b405]
- Updated dependencies [5af8c25]
- Updated dependencies [48f055e]
- Updated dependencies [bf50b85]
- Updated dependencies [2c6fba0]
- Updated dependencies [0801f69]
- Updated dependencies [d1c0d13]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0

## 0.109.0

### Minor Changes

- 9b45768: `ModalDialog` takes two optional props: `widthClassName` replaces the panel's default `max-w-lg`, and `dismissOnScrim={false}` keeps a press on the scrim from closing a dialog that holds unsaved input (Escape and the dialog's own buttons still close it). Existing callers are unaffected. The product browser draws an archived product's status as a neutral outline beside the catalogue's Archived pill.

  The catalog's bulk edit is one `ModalDialog`: bulk Archive / Restore is confirmed in a second step of the same dialog, focus moves to the outcome's heading, an inline result no longer links to an operation page that does not exist, and a queued Archive / Restore says so and links to its operation. The product list keeps the archived empty-state copy for an unfiltered Archived tab, offers to repeat an empty search among archived products, and shows one coloured pill — Archived — on an archived row; the editor's archived notice carries its Restore action.

- 0e33ca9: Additive props on the asset and CMS page pickers; existing callers are unchanged.

  - `AssetPicker` and `AssetFieldPicker`: `acceptMimePrefix` also accepts `'font/'`, which lists font files in the picker grid. It narrows the grid only — the inline uploader is not restricted, because browsers report no reliable type for font files.
  - `AssetFieldPicker`: optional `chooseLabel`, `changeLabel` and `clearLabel` for translated button copy; each defaults to the previous English text.
  - `CmsPagePicker`: optional `excludeIds` (pages never offered, such as a page and its descendants in a parent picker; a client-side filter only) and `selectedLabel` (the label shown for `value` before a search has returned that page).

- e03e6a9: **BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
  - **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
  - **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
  - **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
  - **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has _All · Active · Inactive · Archived_ with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's _Set status_ offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
  - **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.

- 476c5aa: The signed-in administrator's Admin UI preferences, kept on the server, and a Pinned section in the sidebar (feature 164).

  - **`useAdminPreference(key)` and `useAdminPreferencesStatus()`** (`@endora-commerce/admin-kit/lib`). `AuthProvider` now provides the signed-in administrator's preferences itself — no extra provider to mount. `useAdminPreference('sidebarPins' | 'sidebarCollapsedGroups' | 'sidebarRailMode')` returns the value and a setter that applies at once and saves in the background, newest value last, retried on reconnect and when the page returns to the foreground. `useAdminPreferencesStatus()` reports whether the preferences loaded and whether a save failed. A session seeded through `AuthProvider`'s `initial` without `preferences` reads the defaults; a fetched one without them opens with the defaults and saves nothing until a later load succeeds. `AdminMe` gains `preferences?: AdminPreferences | null`.
  - **Pinned sidebar section** (`@endora-commerce/admin-shell`). Every sidebar entry has a pin button after its link (a Tab stop of its own; always visible with a 44 px target on touch). Pinned entries appear first, in a section of their own, in the expanded sidebar, the mobile drawer and — as the first icon — the collapsed rail, where its fly-out lists the pins with an unpin button. A pin whose entry the administrator cannot see is not shown. Pinning and unpinning are announced.
  - **Reordering pins** in the expanded sidebar and the drawer, with the kit's `useReorderList`: drag a row, or focus its handle and use Space and the arrow keys (Escape cancels), or the up/down buttons on touch screens; every move is announced. A pin that is hidden at the moment keeps its place.
  - **Pinning from the command palette.** A result whose destination is a sidebar entry has a pin button beside it, and `Alt+Enter` (`⌥↵`) pins or unpins the highlighted result; `Enter` still opens it. No palette entry or group is added.
  - **`usePageSizePreference(scope)` is server-backed**, same signature: each list's page size is the signed-in administrator's, kept on the server per list (default 20); it is read when the list opens, so a change made on another device applies the next time the list opens. Folded sidebar groups (the Pinned section folds as `pinned`) and rail mode are server-held too, and present in the first render. Nothing is kept in `localStorage` any more.
  - **One-time carry-over on upgrade.** On first load the browser's remembered page sizes **for the signed-in administrator** are sent to the server — a value already there wins — and removed once it confirmed; another administrator's are left alone. The two old sidebar values (`b2b-admin.nav.collapsed-groups`, `b2b-admin.nav.rail-mode`) were not tied to an administrator, so they are removed without being imported: everyone opens in the default sidebar layout once.
  - **A failed save** keeps the change on screen and shows one dismissible notice below the top bar.
  - **New `core` strings** (`@endora-commerce/mod-i18n`, English and Polish): `appShell.pinned.*` (including `appShell.pinned.reorder.*`), `appShell.palette.pin.*`, `adminPreferences.saveFailed`, `adminPreferences.dismiss`.
  - **Theme** (`@endora-commerce/admin-kit/theme.css`): `.b2b-nav-row`, `.b2b-nav-pin`, `.b2b-nav-reorder-handle`, `.b2b-palette__pin` and the notice's classes.

- 42189ce: CRM's collaboration components are in the kit, so any module's screen can have notes, messages,
  references, attachments and a change history without copying them.

  **`@endora-commerce/admin-kit/components`** gains:

  - `ReferenceField` — the formatted text field in which `@` mentions a person, `@@` refers to a
    document and `@@@` to a Product. What may be referred to is the `kinds` prop (the standard is
    `REFERENCE_TRIGGER_KINDS`, `['admin_user', 'document', 'product']`), and where the suggestions
    come from is a `ReferenceLookups` adapter (`searchPeople`, `searchDocuments`, `searchProducts`)
    the screen fills from its own lookups, behind its own permissions. `@@` with `kind: 'document'`
    shows one list grouped Orders · Quote requests · Tasks, from a `RecordDocumentLookupResponse`.
  - `ReferenceText` — a stored text drawn with its formatting, and every reference — person, Order,
    Product, Quote Request, Task — as a chip that links to its screen, or says it is unavailable.
    An Order's chip carries `data-order-reference="<id>"`, and a chip inside the field carries its
    token in `data-reference-token`; a chip copied from CRM's earlier editor, whose attribute was
    `data-crm-token`, still pastes back as a chip.
  - `CommentThread` and `CommentComposer` — a record's notes or messages, over a `CommentThreadApi`
    adapter (`list`, `add`, `update`, `remove`); `RecordComment`, `CommentThreadCopy`.
  - `AttachmentUploader` and `uploadAttachment(path, file)` — a file chosen or dropped, posted
    multipart to the record's own upload endpoint.
  - `useRecordHistory` and `RecordHistory` — a cursor-paginated change history whose headings,
    field labels and values the record injects; `recordHistoryChanges` lists what an entry changed.
  - `CursorPagination` — rows per page and Previous / Next for a list that knows no total, with a
    `maxPageSize`.
  - the reference grammar's editor halves: `findMentionTrigger`, `clipReferenceText`,
    `editorDocOf`, `textOfEditorDoc`, `REFERENCE_NODE`, `MENTION_QUERY_LIMIT`.

  The kit now declares `@tiptap/react` and `@tiptap/starter-kit` (`^3.22.5`) as peer dependencies.

  **`@endora-commerce/mod-i18n`**: the components' English and Polish sentences are in the shared
  `core` bundle (`references.*`, `editor.*`, `comments.*`, `history.*`, `cursorPagination.*`).

  CRM is the components' first user; what that changes for `@endora-commerce/mod-crm` is in its own
  entry.

- 55864a1: Additive (`specs/165-task-management/`):

  - `TagChips`, `TagMultiSelect` and `useTagOptions` (`components/tags/`), promoted from CRM with the options source injected, so any module can offer tags.
  - `MoveToMenu` (`components/kanban/MoveToMenu.tsx`), the keyboard _Move to…_ menu for a `KanbanBoard` card, promoted from CRM; it takes generic `targets {code, name, color}`.
  - The reference editor and `ReferenceText` know the reference kinds `opportunity` and `project`: two more document groups in the `@@` list and link targets for both.
  - Admin preferences: `listViewModes` in the preference store, and `useListViewModePreference(listId)`, which remembers a list's list-or-board choice across devices.
  - `CommentThread` takes `keepDeleted`: a deleted entry keeps its place, marked as deleted, with nothing left to change (`RecordComment.deletedAt`, optional). Without it a deleted entry leaves the list, as before.
  - `MultiSelect` and `TagMultiSelect` take `ariaLabelledBy`: the trigger is named by a visible label's id rather than a second copy of it in `ariaLabel`. `TagMultiSelect` takes one of the two.
  - `StatusTransitionGraph` names the statuses in its _From_ / _To_ form and in the selected move through `statusLabel`, as its graph already did, instead of showing their codes; the options' values stay the codes. Every workflow screen built on it (orders, returns, CRM, Projects' stages, Tasks) shows names there now.
  - `ReferenceField`'s suggestion list keeps a suggestion's label (a record's number, a person's name) at its width and truncates the description (a title) instead: a long title no longer squeezes the number down to `TSK-…` or out of sight.
  - `RecordHistory` and `CommentThread` take `formatTime`, optional: an entry's time in the record's own format. Without it both write it with `formatDateTime`, as before.

### Patch Changes

- 42b1038: `@endora-commerce/admin-shell` no longer carries its 67 re-export shims over `@endora-commerce/admin-kit` (`lib/api-client`, `lib/auth`, `components/ui/*`, `i18n/*` and the rest). The shell imports every one of those bindings from `@endora-commerce/admin-kit/lib`, `/ui`, `/components` or `/i18n` directly. None of the shims was reachable through the package's `exports` map, so nothing a consumer can import has changed: `AuthProvider` and the `AdminMe` / `AuthProviderProps` types are still exported from the package root, and are the kit's own bindings as before. A test that replaces one of these bindings with `vi.mock` must name the kit specifier (for example `vi.mock('@endora-commerce/admin-kit/lib', …)`, spreading the original module) — a mock on an old `admin-shell/src/...` path no longer has a file to resolve to.
- c3165da: `OrganizationPickerMulti`'s `selectedLabels` takes an optional `status`: a label without one renders its chip without a status badge. Type-only widening; existing callers are unaffected.
- 1b1c43e: Both packages now declare `"sideEffects": ["*.css"]` in `package.json`. No JavaScript file in either package does anything when it is imported, so a bundler can drop every barrel member a consumer does not use. The CSS files the packages ship (`theme.css`, `tailwind.css`) are still treated as side-effectful, so a stylesheet imported from JavaScript is kept.

  The exported API does not change. In this repository's admin build, the entry chunk shrank from 2454.5 kB to 806.8 kB (gzip: 774.6 kB to 231.6 kB). A consumer that imported from the barrels gets a smaller bundle and does not need to change anything.

- d68fb89: `CustomFieldListFilters` no longer loses a text or number filter typed into a control in the moment it appears, before its effects have run. The control used to take the value it mounted with back over what had just been typed, and in StrictMode the simulated unmount also cleared the pending commit, so clearing a filter as a list's fields finished loading could leave the list filtered by the old value. The control now adopts an outside value only when that value changes, and a pending commit is skipped only once the control is really unmounted.
- 5038a3a: Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings) and error codes are unchanged.

  - `@endora-commerce/mod-mfa`: the four TOTP setting names (now "Admin UI — allow two-step verification", "Admin UI — enforce two-step verification", "Storefront — allow two-step verification", "Storefront — enforce two-step verification"; the `MFA_DEACTIVATION_BLOCKED` sentence quotes the new name), the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
  - `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
  - `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
  - `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
  - `@endora-commerce/contracts`: the validation message of the MFA disable request body.
  - `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.

- d9053a7: `FulfilmentStrategyPicker` derives its options from `fulfilmentStrategySchema.options` in `@endora-commerce/contracts` instead of a hand-copied list, so a strategy added to the contract is offered without a kit change. Its label is read from the `core` key `fulfilment.strategy.<id>`, which a new strategy must ship in every admin language. No prop changes; the five current strategies render as before.
- 23489bf: Data-fetching picker fixes; no prop changes.

  - `AdminUserPicker`, `CustomerPicker`, `CategorySelect` and `CustomerGroupPicker`: a failed request now shows its error in the listbox even when the caller passes `emptyMessage`. Previously the caller's empty-state text replaced the error, so a failure read as "nothing found".
  - `CategorySelect`: category names are looked up by the admin language's locale (`pl` → `pl-PL`), so a Polish admin sees Polish names; before, every label fell back to `en-US`.
  - `CategorySelect`, `CustomerGroupPicker`, `CustomerPicker` and `useCountriesQuery` import `apiClient` through the kit's `lib` barrel, so a test that mocks `@endora-commerce/admin-kit/lib` reaches them.

- f40ce92: Kit pickers speak the admin's language and announce their state; no prop changes.

  - `Combobox` keeps a polite live region (`role="status"`) mounted beside its input and writes the open list's status into it — the loading message, the empty message, or `Results: {count}` — so a screen reader hears a finished load, an empty result and a failed search (WCAG 2.2 SC 4.1.3). It is empty while the list is closed. Its default `loadingMessage` and `emptyMessage` now come from the `core` bundle (`common.combobox.loading`, `common.combobox.noResults`) instead of English literals. A test that finds the status text with `getByText` now matches two elements, the visible row and the live region; query the listbox (`getByRole('listbox')`) or the region (`getByRole('status')`) instead.
  - `AdminUserPicker`, `CustomerPicker`, `CategorySelect`, `CustomerGroupPicker` and `SalesChannelPicker` take their default placeholder, accessible name, empty, prompt and error copy from the `core` bundle in English and Polish (`adminUserPicker.*`, `customerPicker.*`, `categorySelect.*`, `customerGroupPicker.*`, `salesChannelPicker.*`). Props that override them are unchanged.
  - `AdminUserPicker` and `CustomerPicker` prompt for a name or e-mail address until their first search answers, instead of saying "No matching …" before anything has been searched.
  - `SalesChannelPicker` labels channels by the admin language's locale (`pl` → `pl-PL`), so a Polish admin sees the Polish channel name; before, every label fell back to `en-US`. A failed load now shows its error even when the caller passes `emptyMessage`.

  `@endora-commerce/mod-i18n` ships the new `core` keys in `en.json` and `pl.json`.

- 1846755: `SalesChannelPicker` reports a list response with no `items` as a failed load again, instead of throwing at render. The translation change in the previous release moved the mapping out of the load's promise chain, so a malformed body stopped reaching its error handler and crashed the screen holding the picker.
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [e64ed74]
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
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [c73366c]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Minor Changes

- 291ec86: Custom-field filters for admin lists: one composite, its hook and the pure helpers the Orders, Quote Requests and Opportunities lists share.

  **New in `@endora-commerce/admin-kit/components`.**

  - `CustomFieldListFilters` — one filter control per custom field a list offers, rendered as grid
    cells for the host's own advanced-filters grid. Props: `idPrefix`, `fields`
    (`CustomFieldListFilterField[]`), `value` (`CustomFieldFilters`), `onChange(key, filter | null)`
    (one key's filter, whole; `null` when nothing of it is left), `language`, and optionally
    `status` (the hook's) with `onRetry`: a placeholder cell while the fields load, and on failure a
    sentence with a _Try again_ button. A text field is a search box committed after a 300 ms pause;
    a number is a minimum and a maximum, a decimal comma accepted, also paused; a date is a from and
    a to. Both ranges stack below `sm` with a visible short label on each bound, explain a bound that
    is not a number and an inverted range in a message linked to the input, and send nothing for
    either. A yes/no field is _Any / Yes / No_; a select or multiselect field is a multi-select of its
    options in their order, searchable above eight. Labels follow `label[language]`, then the base
    language, then `labelDefault`. A pending text or number commit is dropped when the value changes
    from outside.
  - `useCustomFieldListFilterFields(endpoint)` — `{ fields, status: 'loading' | 'ready' | 'error',
reload }` from one `GET` of a list's offered-fields endpoint; `reload()` reads it again.
  - `readCustomFieldFilterParams(params)` / `writeCustomFieldFilterParams(params, filters)` — the
    filters in an address's `cf.<key>.<op>` parameters (`in` repeated) and back, other parameters
    untouched. A key failing the definition-key grammar and a malformed operator value are dropped;
    an unknown well-formed key is kept for the server to refuse; at most 10 keys and 100 `in`
    values.
  - `sanitizeCustomFieldFilters(saved, fields)` — a saved view's filters against the offered fields:
    `{ kept, dropped }`, removed options pruned. `pruneRemovedOptions(filters, fields)` — removes
    options a known field no longer has from filters read from the address.
  - `customFieldFilterChips(fields, filters, language, t)` — one `{ id, label, remove, removeLabel }`
    chip per key, the label plain text and `removeLabel` the remove action's accessible name.
  - `customFieldDisplayName(fields, key, language)` — how a field is named to the operator: its label
    (language, base language, `labelDefault`), or for a key the list does not offer the key cut to
    64 characters. `resolveCustomFieldLabel(label, labelDefault, language)` — the label rule alone.
  - `emptyCustomFieldFilters()`, `withCustomFieldFilter(filters, key, filter | null)` and
    `withoutCustomFieldFilter(filters, key)` — new prototype-free records with one key set or removed. `customFieldFilterRefusal(error)` — the key a
    `CUSTOM_FIELD_FILTER_UNAVAILABLE` refusal names, else `null`. `toCustomFieldFiltersParam(filters)`
    — the `customFieldFilters` request parameter, keys sorted, `null` when empty.
  - Types: `CustomFieldListFiltersProps`, `CustomFieldFilterChip`, `CustomFieldFilterTranslator`,
    `CustomFieldListFilterFieldsState`, `CustomFieldListFilterFieldsStatus`.

  Every record the helpers return has a `null` prototype, so a key such as `constructor` is an
  ordinary key and never an inherited member.

  **`@endora-commerce/mod-i18n`** ships the `customFieldFilters.*` keys of the `core` namespace in
  English and Polish, which the composite reads; a host needs that version alongside this one.

  **`Input`** (`@endora-commerce/admin-kit/ui`) draws its border in the destructive colour while
  `aria-invalid` is set.

- cf7a9c0: A detail screen can lead its Back to the screen that opened it, and a page header can carry controls beside its title.

  - **New in `@endora-commerce/admin-kit/lib`**: `readReturnTo(searchParams)` returns the `?returnTo=` path a screen was opened with, or `null` for anything that is not a path of the application (a scheme, a host, `//`); `withReturnTo(target, returnTo)` adds it to a link, keeping the query and the hash; `RETURN_TO_PARAM`.
  - **`PageHeader`** takes an optional `titleActions`, drawn beside the heading but outside it, so the heading's accessible name stays its words. Pages that do not pass it render as before.

- c8aa175: Line groups editor and grouped reordering in `@endora-commerce/admin-kit/components`.

  - **`useGroupedReorder(options)`** — the multi-section sibling of `useReorderList`: items move within and across sections (native pointer drag, the ARIA grab-mode keyboard map crossing section boundaries, `moveItemBy` / `moveItemTo`), non-fixed sections move among themselves (`moveSectionBy`), and every move is announced through the caller's labels. The hook owns no list: it calls `onMoveItem(id, sectionKey, index)` and `onMoveSection(key, index)`.
  - **`<LineGroupsEditor>`** — domain-free editor of named, ordered groups of a document's lines: inline group names (required, 120 characters), move up/down, delete (lines move to the ungrouped section, announced), a _Move to group_ menu per line, per-section `renderSummary` and `renderSectionFooter`, a `readOnly` mode and a `layout="table"` mode for screens whose lines are table rows. With no group it renders the bare line list. Every string is a prop (`LineGroupsEditorLabels`).
  - **`<SplitLineDialog>`** — _Split line_: a modal dialog asking for the quantity to move to a new line (whole steps from `step` to `quantity − step`, invalid entries marked with their reason, Enter confirms) and the section of the new line; with `canSplitLine(quantity, step)` and `splitLineInto(lines, key, split, ops)`, which applies a confirmed split to a display-ordered line list. Every string is a prop (`SplitLineDialogLabels`).

- e1b173f: New `EditableGrid` on `@endora-commerce/admin-kit/components` (feature 161, `specs/161-price-book-editor/research.md` R4): an ARIA data grid for spreadsheet-like editing that knows nothing about its cells' meaning. The caller supplies `columns`, `rows`, `getText(rowKey, columnKey)`, optional `getError`, `isReadOnly` and `renderCell` (keep it stable), and receives every change as one group through `onChange(changes, reason)` — `changes` are `{ rowKey, columnKey, text }`, `reason` is `'edit' | 'paste' | 'fill' | 'clear' | 'undo' | 'redo'`. The grid owns the keyboard model (one tab stop, arrows, Home/End, Ctrl+Home/End, PageUp/PageDown, Enter/F2/Escape/Tab, Shift selection), tab-separated copy and paste (a semicolon line too), fill down (Ctrl/⌘+D), clear, undo and redo of change groups, per-cell `aria-invalid` with its reason, `aria-rowcount`/`aria-rowindex` for paged sets (`totalRowCount`, `rowIndexOffset`), and a polite live region. A `ref` (`EditableGridHandle`) applies an outside change as one undoable group (`apply`), forgets the history (`clearHistory`) and reads the selection (`selection`). Types: `EditableGridProps`, `EditableGridColumn`, `EditableGridRow`, `EditableGridCellChange`, `EditableGridChangeReason`, `EditableGridRenderContext`, `EditableGridSelection`, `EditableGridHandle`. Its strings are in the `core` namespace under `editableGrid.*` (shipped by `@endora-commerce/mod-i18n`).
- ef1318e: Two additions for the price-book grid (feature 161, Phase 5), both additive.

  - **`EditableGrid` `getCellToken?(rowKey, columnKey): string`.** A cell's memo token: a cell renders again when its text, error, state or this token changes. A caller whose cell shows more than its own text (what an empty cell inherits from a neighbour) puts that in the token, so a change renders the cells it affects and no other. Without it, a cell renders on its text alone, as before.
  - **`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` on `@endora-commerce/admin-kit/ui`** — the Radix menu `RowActionMenu` is built on, published for menus with a labelled trigger.

- f42bbaf: `PaginationFooter` takes an optional `pageSizes` (feature 161): the page sizes its rows-per-page select offers, for a list whose API pages differently. Omitted, it offers `PAGE_SIZE_OPTIONS` as before. The props are generic over the size type — `PaginationFooterProps<S extends number = PageSizeOption>` — so `pageSize` and `onPageSizeChange` take the caller's sizes; existing callers are unchanged.
- c781cd6: `useUnsavedChangesPrompt(when, message?, options?)` takes an optional third argument (feature 161, FR-020): `{ guardTabsOutside: ref }` also asks before a `role="tab"` outside the referenced element is activated, and keeps the tab when the operator cancels — for a panel contributed into a host's tabbed screen, whose tab switch unmounts it. Existing two-argument calls are unchanged. Type: `UnsavedChangesPromptOptions`.
- 4a05f32: `formatMoney(amount, currency, locale?, options?)` takes `{ unitPrice: true }` for a unit price (owner ruling of 2026-10-25): two places when its third and fourth are zero, otherwise its significant places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`), by `unitPriceFractionDigits` from `@endora-commerce/contracts`. An amount (a line value, a total) still shows two. New exported type `FormatMoneyOptions`.

### Patch Changes

- 172597c: `ModalDialog` (`@endora-commerce/admin-kit/components`) takes an optional `aria-describedby`: the
  id of the element that describes the dialog, set on the panel beside its `aria-labelledby`, so a
  screen reader reads a warning or a question together with the title when focus enters the dialog.
  Without it the panel carries no `aria-describedby`, exactly as before. Additive.
- 53e88c7: _Send feedback_ beside the release in the Admin UI sidebar (an icon of its own when the sidebar is collapsed), shown while the `admin_feedback` module is present. It opens a dialog — the feedback (required), the sender's e-mail (the signed-in administrator's, editable) and an optional phone — that posts to `POST /api/v1/admin/feedback`, and says every outcome: thanks, sending switched off on the instance, too many messages, or not delivered, always with `support@endora.software` to write to by hand and with what was typed kept. New `appShell.feedback.*` keys in the core bundle (EN, PL); `theme.css` gains `.b2b-sidebar__feedback` and `.b2b-sidebar__feedback-rail-row`.
- 8e10ba1: The collapsed sidebar's fly-out is drawn over the page content again. `.b2b-sidebar` now sets `z-index: 36` — above the sticky topbar (35) and the page's sticky bars, below the mobile nav backdrop (40), the scrim, drawers and command palette (50/60). A sticky box is its own stacking context, so the fly-out's own `z-index` could never lift it above content painted later in the page.
- 3a9dc6e: Raise `vite` to `^7.3.7`. It includes a dev-server fix that keeps module ids, not URLs, in `safeModulePaths`. `@endora-commerce/admin-shell`'s generated README lists the new peer range.
- Updated dependencies [0bd5a2b]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
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
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
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
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0

## 0.107.0

### Minor Changes

- 97d24cf: A shared product browser for admin screens that add many products at once, and selectability rules for the quick product search.

  **New in `@endora-commerce/admin-kit/components`.**

  - `ProductBrowserDialog` — a wide side drawer that lists the catalogue from
    `GET /api/v1/admin/catalog/products` in a paginated table (status tabs with counts, a type
    filter, a debounced SKU / slug / name search) and keeps a selection across pages, page sizes
    and filters. Props: `open`, `rules`, `alreadyAddedIds`, `title?`, `onConfirm(items)`,
    `onCancel`, `confirmErrorMessage?(error)` (the message shown for a rejected confirm, given the
    rejection so a host can name its cause). `onConfirm` receives the selected
    `ProductBrowserItem`s in the order they were ticked. Return nothing for a local append; return a
    promise to make the confirm a server write — the dialog shows pending, and on rejection stays
    open with the selection kept and a **Retry** that sends the same items again. **The host owns
    `open`**: close the dialog in `onConfirm`, or once its promise resolves. One confirm takes at most
    `ADMIN_PRODUCT_SELECTION_MAX` (200) products. Its first page size follows the operator's
    Products-list preference, and changing it inside the dialog does not change that preference.
  - `ProductBrowserTrigger` — the **Browse products** button. It is disabled, with a visible hint,
    for an operator without `catalog:read`; `disabled` and `disabledReason` add a host's own reason.
  - `productSelectability(row, rules, { alreadyAddedIds, selectedIds, max })` — the pure rule both
    entry points apply: `{ selectable: true }` or `{ selectable: false, reason }`, the reason being
    the first of `alreadyAdded`, `typeBlocked`, `statusBlocked`, `limitReached`. A row already
    selected stays de-selectable at the cap. `productSelectabilityReasonKey(reason, rules)` gives
    the `core` translation key for a reason.
  - `productDisplayName(item)` — the name a product is shown under: `en-US`, else the first locale
    present, else the slug, else the SKU. `parsePositiveInt(input)` — a whole number of at least 1
    from a quantity field, or `null`. The two line helpers every product-browser host shares, so
    their screens and the kit's own picker show the same name and accept the same quantities.
  - Types: `ProductBrowserRules` (`initialStatus: 'all' | 'active'`, `blockedTypes?`,
    `blockedStatuses?`, `alreadyAddedLabelKey?`), `ProductBrowserItem`, `ProductBrowserStatus`,
    `ProductBrowserType`, `ProductSelectability`, `ProductSelectabilityReason`,
    `ProductSelectabilityContext`, `ProductBrowserDialogProps`, `ProductBrowserTriggerProps`.

  **`ProductPicker` gains three optional props; without them nothing changes.**

  - `rules` and `alreadyAddedIds` — every option is judged by `productSelectability`; one the host
    refuses is shown disabled with its translated reason instead of hidden. Passing `rules` also
    disables the picker, with the same hint as the trigger, for an operator without
    `catalog:read`. A picker given no `rules` adds no permission check and needs no signed-in
    session, exactly as before.
  - `onPickProduct(item)` — receives the full summary of the picked product (`id`, `sku`, `slug`,
    `name`, `status`, `type`), in both `select` and `multiselect` mode.

  Every new string is read from the `core` namespace, so a host needs `@endora-commerce/mod-i18n`
  at the version that ships the `productBrowser.*` keys.

- 86a88fd: `AssetUploader` takes two optional props: `upload` and `accept`.

  - `upload(file)` replaces the default request, which uploads the file as a new asset. The assets library's **Replace file** action passes one that stages the file for its own confirmation. The component still refuses a file outside `acceptPrefix` when one is given — a dropped file included — shows its progress and errors, and calls `onUploaded` with what `upload` answers.
  - `accept` sets the file input's whole `accept` attribute (for example `application/pdf`). It only filters the file picker: a dropped file is checked against `acceptPrefix` alone, so pass both to hold a drop to one kind. Without `accept`, `acceptPrefix` decides the attribute as before.

  The hidden file input now carries the trigger's label as its accessible name.

  Every existing caller is unchanged.

- 2933bf0: `@endora-commerce/admin-kit/components` publishes two new components. `ModalDialog` (with `ModalDialogProps`) is the dialog primitive `crm` used to keep to itself: a titled panel over a scrim with an accessible name, a focus trap, Escape and scrim to close, and a `busy` flag that makes both inert. It gains two optional props, `initialFocusRef` (focused on open instead of the first focusable element) and `finalFocusRef` (focused after close instead of the opener, read at close time); without them it behaves as before. `useFocusTrap` accepts the same two refs through a new optional third argument (`FocusTrapOptions`). `SavedViewsControl` (with `SavedViewsControlProps` and `SavedViewState`) is the saved-views selector with _Save view_ and _Delete view_, both through dialogs rather than the browser's native prompts: the caller passes the list's saved-view endpoint, its current state and an `onApply` callback, and the control lists, creates and deletes views through the kit's `apiClient`. A name the server refuses as taken (`409`) is shown in the save dialog with the name field marked invalid until the next keystroke. It never sends an update.

  `crm` imports `ModalDialog` from the kit instead of its own copy, which is deleted. No behaviour changes.

  The `core` bundle gains eighteen `savedViews.*` keys in English and Polish — the copy `SavedViewsControl` and its dialogs render.

### Patch Changes

- 09e72a3: `ProductPicker` now shows a preselected product without any interaction when it is mounted under React `<StrictMode>`, as the admin runs it. Its warm-up lookup marked an id as fetched before the answer arrived, so StrictMode's simulated unmount discarded the answer and the remount asked for nothing — the field stayed empty until opening the dropdown happened to load the product (seen on a quote request's Modify tab). The lookup in flight is now kept per id and re-awaited by every effect run, so a remount reuses the same request; only a failed lookup is remembered so it is not retried on every re-render.
- b8adc7f: `AssetPicker` carries the new asset summary members (`fileUrl`, `permalink`, `permalinkUrl`, `contentVersion`) into its grid when an upload completes.

  Nothing changes in what the picker shows or selects; the item it adds after an upload now matches the
  shape the library's list answers.

- a57515b: The sidebar shows the release number in a section of its own: the logo, a divider, the version
  badge, a divider, then the rest of the sidebar. The badge no longer overlaps the logo's header.
  The collapsed sidebar still hides it and keeps the release in the logo's tooltip.
- 30c61d9: `AuthProvider` picks up what a federated sign-in leaves in the address when it returns to the Admin UI: `#mfa-challenge=<id>` opens the two-step verification form exactly as after the password step, and `/login?error=<sentence>` shows that sentence on the sign-in form (it was not shown before). Both are removed from the address bar once read. A pending challenge and that sentence survive the initial `/admin/me` check answering `401`.
- Updated dependencies [fcf4d09]
- Updated dependencies [70bb5e5]
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
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/contracts@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0

## 0.105.0

### Minor Changes

- 8ca54eb: Delivery and payment methods are offered per sales channel, and the choice is enforced.

  The admin API already stored a channel assignment for each method, but nothing read it: the
  storefront listed every active method on every channel, the two admin screens offered no way to
  choose channels, and an order could be placed with any active method.

  **The rule.** An assignment is a restriction. A method assigned to one or more sales channels is
  offered in exactly those; a method assigned to **no** channel is offered in every channel. That
  differs from products on purpose — methods exist without an assignment as a matter of course (a
  module that ships its own method seeds it with none, and so does demo data), so "none" cannot mean
  "nowhere".

  **Upgrade note for an instance with more than one sales channel: review every method.** The new
  **Sales channels** column on `/delivery-methods` and `/payment-methods` shows where each one stands.

  - **Created in the admin so far** — assigned to the **default channel only** (the screens offered
    nothing else), and so gone from the other channels' checkouts until changed.
  - **Seeded by a gateway or carrier module under an earlier release, on an instance that had already
    been started** — also assigned to the **default channel only**: that release's seed bound the
    method to the default channel whenever it existed. They do not appear on other channels until an
    operator widens them.
  - **Seeded by a module from this release on** — assigned to **no channel**, and so offered on every
    channel, whenever the module is installed. The same holds for methods a module seeded under an
    earlier release during the instance's first setup, before its first start, and for demo data.

  Open each method and choose its channels, or untick all of them to offer it everywhere. No data is
  migrated: a method bound to the default channel by an earlier seed cannot be told apart from one an
  operator restricted on purpose, so none is widened automatically. An instance with a single sales
  channel is unaffected.

  **For authors of a gateway or carrier module.** `bindToDefaultChannel` is removed from
  `DeliveryMethodSeedApi` and `PaymentMethodSeedApi` (`@endora-commerce/mod-delivery-methods/ports`,
  `@endora-commerce/mod-payment-methods/ports`, and the seeders their `./install` subpaths create).
  An install hook that called it after `ensureMethodForAdapter` must delete the call, and needs no
  replacement: the seeded method is offered on every channel until an operator restricts it. Two
  things follow for a module that still calls it. Its **source** no longer compiles against this
  release. And a **build published earlier** does not fail at compile time at all: the seeder object
  simply has no such method, so the module's install hook throws a `TypeError` the first time it
  creates its method — on a new instance, or on any instance where the method's row does not exist
  yet. An instance that already has the row is unaffected, because the hook only calls the bind for a
  row it has just created. Such modules must therefore be re-released for this version. A module that must seed a method restricted to particular channels has
  no seam for that at install; restrict it in the admin.

  **Permissions.** Choosing a method's sales channels is part of configuring the method:
  `delivery_methods:write` / `payment_methods:write` is sufficient to assign, replace and clear them,
  and `sales_channels:write` is not required. The form reads its options from a route of the method
  module itself, `GET /api/v1/admin/{delivery,payment}-methods/sales-channels`, gated on that
  module's `:read` code, so an administrator who configures methods and does not administer sales
  channels can use the field.

  **A storefront must name the channel when it reads the two catalogues.** The reference storefront
  read `GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` with no `X-Sales-Channel`
  header; it forwards the header now, on the checkout and on the buyer's preferences page. A
  storefront created by an earlier release has the same omission in `lib/api/methods.ts`
  (`listDeliveryMethods` and `listPaymentMethods` take the request context as a required argument
  now) and, until it is changed, is answered with the default channel's methods on every channel;
  the steps are in _Upgrading an instance_.

  What changed, by package:

  - **`mod-delivery-methods`, `mod-payment-methods`** — `GET /api/v1/delivery-methods` and
    `GET /api/v1/payment-methods` list only the methods offered in the sales channel the request
    resolved. Both admin screens gain a **Sales channels** field in the form and a column in the
    list. `salesChannelIds` on `PUT /api/v1/admin/{delivery,payment}-methods/:code` now has three
    meanings: **omitted** leaves the assignment unchanged on an update and assigns a new method to
    the default channel (unchanged behaviour); **`[]`** removes every assignment, offering the method
    in every channel (it used to be ignored); a non-empty list replaces the assignment (unchanged).
    An id that names no sales channel is now refused with `400 VALIDATION_FAILED` and a
    `salesChannelIds` field error, before anything is written; it used to answer `500`. Channel
    changes made through these routes are audited with the acting administrator.
    The modules' sales-channel bridges are registered with `emptyMeansEveryChannel: true`.
  - **`mod-orders`** — placing an order and previewing its total refuse a delivery or payment method
    not offered in the order's sales channel: `400 VALIDATION_FAILED` with
    `details.code` `delivery_method_not_in_sales_channel` / `payment_method_not_in_sales_channel`.
    This covers `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`, one-click buy, admin
    order creation and its preview, and the API-key order intake; the last three refuse before the
    customer's basket is touched. The admin order-creation form narrows its method lists to the
    chosen channel.
  - **`contracts`** — new `SalesChannelOptionSchema` / `SalesChannelOption`, the shape of the two
    channel-options routes. `DeliveryMethodReadPort` and `PaymentMethodReadPort` gain
    `isAvailableInChannel(id, salesChannelId): Promise<boolean>`. An implementation of either port
    outside this repository must add it.
  - **`platform`** — a sales-channel bridge registration may declare `emptyMeansEveryChannel`, and
    `SalesChannelMembershipPort` gains two methods that read it:
    `filterEntityIdsAvailableInChannel(channelId, entityType, entityIds)` — the ids bound to the
    channel, plus, for a declaring type only, the ids bound to none — and
    `clearChannelsForEntity(entityType, entityId, options?)`, refused with
    `ENTITY_WOULD_HAVE_ZERO_CHANNELS` for a type that does not declare it. Products keep the
    at-least-one-channel rule. An implementation of the port outside this repository must add both.
  - **`admin-kit`** — new `MethodSalesChannelsField`, `MethodSalesChannelsCell`,
    `useSalesChannelOptions(path, enabled)` and `salesChannelIdsToSubmit` on
    `@endora-commerce/admin-kit/components`.
  - **`mod-i18n`** — the `methodSalesChannels.*` strings of the `core` bundle, in English and Polish.
  - **`mod-quick-order`** — one-click buy is not offered when the buyer's default delivery or payment
    method is not offered in the sales channel of the request:
    `GET /api/v1/quick-order/one-click/eligibility` answers `{ enabled: false, reason: "missing_defaults" }`
    there, and `POST /api/v1/quick-order/one-click` refuses with `one_click_unavailable` without
    touching the basket.

### Patch Changes

- 1190180: The Admin UI says which Endora Commerce release it is talking to, and the health payload stops
  saying `0.0.0`.

  **A version badge in the admin header.** Under the wordmark in the sidebar, `AppShell` renders
  the release the API runs — `v0.104.0` — in the kit's `Badge`. It is read from a new endpoint,
  `GET /api/v1/admin/platform-info`, which any signed-in admin may call and which answers
  `{ "version": string | null }` (`PlatformInfoSchema` / `PlatformInfo`, new exports of
  `@endora-commerce/contracts`). With the sidebar collapsed the release moves into the logo's
  tooltip. While the number is loading, when the read fails — an API older than this release
  answers 404 — or when the platform cannot tell, the badge is not rendered at all; there is no
  placeholder. An instance needs no change: upgrade the packages and the badge appears.

  **`GET /api/v1/_health` reports the real release.** Its `version` was
  `process.env.npm_package_version ?? '0.0.0'`: the _host application's_ manifest version, which is
  `0.0.0` in every scaffolded instance, and a variable no package manager sets when a container
  starts the server with `node dist/index.js`. Every deployment therefore reported `0.0.0`. It is
  now the version of the `@endora-commerce/platform` package the process loaded, and `unknown` if
  that cannot be read. If you compared this field against `0.0.0`, or set `npm_package_version` to
  steer it, neither works any more.

  `npm_package_version` is no longer a declared platform environment input
  (`PLATFORM_ENVIRONMENT_INPUTS`), since nothing reads it.

  One key joins the `core` bundle in English and Polish — `appShell.brand.versionLabel`, the
  sentence a screen reader and the tooltip are given — and `@endora-commerce/admin-kit`'s
  `theme.css` gains `.b2b-sidebar__brand-row`, `.b2b-sidebar__brand-row--versioned` and
  `.b2b-sidebar__brand-version`; the sidebar header is 14px taller while a release is shown. A
  theme override that styles `.b2b-sidebar__brand`'s bottom border should move it to
  `.b2b-sidebar__brand-row`, which owns the divider now.

- 79bd849: `CustomFieldValuesPanel` reports a cleared number, date or select as `null` instead of `undefined`.

  The hosts send the edited bag as JSON, which omits a key whose value is `undefined`, and the server keeps the stored value of a key the request does not name. Clearing one of those three field types on a customer, organization, order or quote request and pressing _Save_ therefore reported success and left the old value in place. `null` survives serialisation and is what the server reads as "clear this".

  A host that reads the bag handed to `save` or `onChange` now sees `null` where it saw `undefined` for a cleared number, date or select. Text (`''`) and multiselect (`[]`) are unchanged.

- 8d4440f: The configured admin idle-logout window now applies to every administrator, not only to those whose
  role includes `settings:read`. The Admin UI learned the window by requesting
  `GET /api/v1/admin/settings/admin.idle_logout_minutes`, which requires `settings:read`: an
  administrator with a narrower role was answered 403 on every sign-in and was signed out after the
  built-in 60 minutes whatever the operator had configured.

  `GET /api/v1/admin/me` now carries the window as `idleLogoutMinutes` (`number | null`), described
  by the new `adminMeResponseSchema` in `@endora-commerce/contracts`, and the Admin UI reads it from
  there — it no longer calls the settings endpoint for it. `AdminMe` in `@endora-commerce/admin-kit`
  gains the matching optional field. The field is additive; the Admin UI keeps its 60-minute default
  when the field is absent (a backend older than this release) or `null` (the setting could not be
  resolved).

  The permission gate on the settings admin API is unchanged. No setting or permission changes.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0

## 0.104.0

### Minor Changes

- 32775d5: `CustomFieldValuesPanel` can be embedded in a form. `save` is now optional: with `onChange` and
  no `save` the panel renders the fields and no button, and reports the whole edited bag on
  every change. Two further optional props: `fieldErrors` (a message per field key, shown at the
  field) and `language` (the language labels are shown in; `en` when omitted). A caller passing
  none of them sees no change.
- 2f95785: A new component, `KanbanBoard`, and **a new peer dependency an application must provide:
  `@dnd-kit/core` `^6.3.1`**.

  **The peer.** `@endora-commerce/admin-kit` now declares `@dnd-kit/core` in `peerDependencies`,
  the way it declares `echarts`. An application that embeds the kit and installs with a package
  manager that adds missing peers by itself (pnpm with `auto-install-peers`, its default; npm 7
  and later) needs to do nothing. One that does not — or that wants the version under its own
  control — adds `"@dnd-kit/core": "^6.3.1"` to its own `dependencies`. It is MIT-licensed and
  brings `@dnd-kit/accessibility`, `@dnd-kit/utilities` and `tslib` with it. A module package
  that uses the board imports it from the kit and declares nothing for it.

  **`KanbanBoard`**, exported from `@endora-commerce/admin-kit/components` with the types
  `KanbanBoardProps`, `KanbanBoardLabels`, `KanbanColumnRenderState`, `KanbanCardRenderState`,
  `KanbanColumnState` and `KanbanDropState`. A board of lanes whose cards move between lanes by
  dragging — with a mouse, with a finger (press and hold) or from the keyboard (each card has a
  handle: Space lifts, the left and right arrows choose a lane, Space drops, Escape cancels).

  It is generic and knows no domain: the lanes (`columns`, `getColumnId`), the cards
  (`itemsByColumn`, `getItemId`) and everything drawn (`renderCard`, `renderColumnHeader`,
  optional `renderColumnFooter`) are the caller's.

  - `onMove(itemId, fromColumnId, toColumnId)` is called once when a card is dropped on another
    lane that accepts it. Return a promise and the move is optimistic: the card is shown in the
    new lane while the promise is pending and goes back if it rejects.
  - `canDrop(item, toColumnId, fromColumnId)` says which lanes accept the lifted card. Lanes
    that refuse are marked while it is lifted, and a drop on one calls nothing.
  - `getColumnState` with `renderColumnLoading`, `renderColumnError` and `renderColumnEmpty` give
    each lane its loading, error and empty content.
  - `labels` carries every string the board names something with or announces to a screen
    reader. The kit ships none of them: the sentences name the caller's items and lanes, so the
    caller translates them.
  - `disabled` renders a read-only board.

  Links, buttons and form controls inside a card never start a drag, and neither does anything
  marked `data-kanban-no-drag`. **A consumer owes one thing the component cannot supply**: a way
  to move a card with a single pointer and without dragging — a "Move to…" menu in `renderCard`
  — because WCAG 2.2 SC 2.5.7 requires it and only the caller knows what the target lanes mean.
  Cards have no order inside a lane; a drop reports the lane, not a position.

  **Size and scrolling.** Lanes share the board's width down to 256 px each and then the board
  scrolls sideways. The board bounds no height itself: give it one through `className` (for
  example a `max-h-…` class) and every lane takes it — a lane's cards then scroll inside the
  lane, under its header, and the board's own scroll bar stays in view. The drag handle is a
  28 px picture with a 44 px hit area.

- f02494f: The contract for Events on a Sales Opportunity and for the CRM Calendar. Additive throughout.
  The routes that serve it and the screens that draw it are `@endora-commerce/mod-crm`'s, and
  the port method is answered by `@endora-commerce/mod-auth`; each has a changeset of its own in
  this release.

  **`@endora-commerce/contracts` — `crm`.** The request and response shapes of five routes
  (`GET`/`POST /opportunities/:id/events`, `PATCH`/`DELETE …/events/:eventId`,
  `GET /calendar/events`):

  - `CreateOpportunityEventRequestSchema` and `UpdateOpportunityEventRequestSchema` — a name of
    1 to 200 characters, an optional description of 5 000 at most, `allDay`, `startsAt` and
    `endsAt` as ISO 8601 instants with an offset, the IANA `timeZone` the times were chosen in,
    and an optional `remindAt`. The schema refuses what needs neither a clock nor zone data: an
    end that is not after the start, and a span over `OPPORTUNITY_EVENT_MAX_SPAN_HOURS` (25).
    The update is the same members, all optional, and strict.
  - **Every instant of these shapes** — `startsAt`, `endsAt`, `remindAt`, and `from` and `to` of
    `CalendarEventsQuerySchema` — must lie in `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`, the
    end excluded. A four-digit year as written is not enough: an offset carries
    `9999-12-31T22:00:00-14:00` into the year 10000, which PostgreSQL refuses. Outside the range
    the schema refuses, so the routes answer 400.
  - `OpportunityEventSchema` — the stored Event, with `allDayDate` computed by the server and a
    `reminder` of `{ at, state, handledAt, channels }` or `null`.
    `opportunityEventReminderStateSchema` names the seven states and
    `opportunityEventReminderChannelSchema` the two channels; `channels` is non-empty exactly
    when the state is `sent`.
  - `opportunityEventRuleSchema` — the five reasons a well-formed Event is refused with 422
    `VALIDATION_FAILED` (`details.rule`).
  - `CalendarEventsQuerySchema` (`from`, `to`, an optional `scope` of `mine` or `all`; a range
    of `CALENDAR_EVENTS_MAX_RANGE_DAYS`, 45, at most), `CalendarEventSchema` — what a calendar
    draws, without the description — `CalendarEventsMetaSchema` and
    `CalendarEventsResponseSchema`; `CALENDAR_EVENTS_MAX_RESULTS` (500).
  - `OpportunityDetailSchema` gains `upcomingEventCount`, a non-negative integer.

  **`@endora-commerce/contracts` — `auth`.** `AuthSessionReadPort` gains
  `lastSeenByAdminUser(adminUserIds, since)` and the type `AuthAdminLastSeen`, the twin of
  `lastSeenByCustomerAccount`. **An implementer or a test double of this port outside the
  repository must add the method to keep compiling.**

  **`@endora-commerce/contracts` and `@endora-commerce/admin-kit`.** `CalendarDays` joins the
  admin icon allowlist: `KnownIconNameSchema` gains the name and `resolveIcon` maps it to the
  lucide component, the pair a declared icon needs in one change.

- 1a15fdc: The Sales Channel create and edit forms pick languages and currencies from searchable controls,
  and a default that is no longer selected is reported instead of being replaced.

  - **`@endora-commerce/admin-kit/ui` exports `MultiCombobox`** (with `MultiComboboxProps`) — a
    searchable multi-select: one combobox input over a filtered listbox, the selection shown as
    removable chips. It takes the same `ComboboxOption[]` as `Combobox` and a `value: T[]` /
    `onChange(next: T[])` pair, matches on `label` and `description` without regard to diacritics,
    and is driven from the keyboard (arrows, `Home`/`End`, `Enter` to toggle, `Escape`, `Backspace`
    to remove the last chip). `MultiSelect` is unchanged and remains the control for filter bars.
  - **`Combobox` accepts `invalid` and `ariaDescribedBy`**, so it can be used as a validated form
    field, and **closes its listbox when focus leaves it**. It used to stay open after `Tab`, until a
    pointer press elsewhere; a caller that relied on that has nothing to change, the list simply no
    longer covers the next field.
  - **Sales Channel form**: _Languages_ and _Currencies_ are `MultiCombobox`es over the active
    Dictionary entries, searchable by code and by name; _Default language_ and _Default currency_ are
    `Combobox`es limited to what is selected. Removing the entry that is the current default now
    **empties the default** and blocks saving until one is chosen — the form used to promote the
    first remaining entry silently. The submitted value has the same shape as before.
  - The shared admin bundle gains `common.multiCombobox.added`, `.noMatches`, `.remove` and
    `.removed` in English and Polish.

### Patch Changes

- 32775d5: `readableTextColor` — and so `statusBadgeStyle` — picks the text colour by contrast ratio.

  It chose white or dark grey by a brightness threshold, which put white text on the mid-tones an
  operator actually picks for a status — amber, green, blue — at 2:1 to 3.7:1. It now answers
  whichever of `#000000` and `#ffffff` has the higher WCAG contrast against the background,
  which is at least 4.58:1 on any colour (SC 1.4.3 asks for 4.5:1).

  **What changes on screen:** a status or tag badge on a mid-tone colour shows black text where
  it showed white, on every screen that uses the helper — order statuses and return statuses
  included. The dark text is `#000000` where it was `#1f2937`. Signatures are unchanged.

- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
  - @endora-commerce/contracts@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/contracts@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: `AdminContributionsProvider` also carries the `blocks` each module contributes, and `@endora-commerce/admin-kit/zones` exports `useBlockContributions(context)` — the editor renderers the present modules contribute for `cms` or `email`, with no factory evaluated — together with `selectBlockContributions`, `OwnedBlockContribution` and `BlockContributionContext`. A block a module contributes under a name another module owns is dropped.

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
  - @endora-commerce/contracts@0.103.0

## 0.102.0

### Patch Changes

- d8b4e1b: `ScopePicker` (`@endora-commerce/admin-kit/components`) no longer rewrites the scope it was given
  while the selected sales channels' languages are still loading. Until each channel's details
  arrived it treated the channel's default language as the channel's only language and pruned the
  value against that through `onChange`, so content whose only language was not the channel
  default opened with no language checked (and, in the CMS and blog editors, an empty canvas), and
  content scoped to the default **and** another language silently lost the other one — which the
  next save then stored.

  The picker now waits for every selected channel's details before it offers languages, and says
  it is loading meanwhile instead of showing an empty selection. It never calls `onChange` on its
  own: a stored language that the selected channels no longer offer stays listed and checked, and
  the operator is the one who removes it. Unchecking a channel still prunes the languages only
  that channel offered, as before. If a channel's details cannot be read, the error is shown and
  the stored languages stay as they are.

  Content saved through an affected editor before this fix may have had its language list
  shortened. The per-language data itself was kept — CMS pages, blocks and templates and blog posts
  store a narrower language list without deleting `content.languages[<code>]`, and blog categories
  keep their per-language names — so an item whose stored per-language data holds a language its
  language list does not is a candidate to review and re-scope.

- @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- @endora-commerce/contracts@0.100.1

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

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0

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
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0

## 0.9.3

### Patch Changes

- 80751c2: `TranslationProvider`'s development diagnostics report each distinct subject once

  `useTranslation`'s and `TranslationProvider`'s two `import.meta.env.DEV` warnings — `[i18n] bundle
fetch failed` and `[i18n] missing <language>: <scope>.<key>` — now print the first occurrence of
  each distinct subject in full, stack included, and drop exact repeats for the life of the module
  registry (one page load in a browser, one test file under vitest). No exported symbol, signature or
  production code path changes, and nothing is silenced: every distinct fact still reaches the console
  in its complete form.

  It is a `patch` rather than an empty changeset because the question
  `specs/conventions/release-intent.md` asks is _"does this commit change what a published package
  emits?"_ — and this one does. `packages/admin-kit/tsconfig.build.json` compiles `src`, so
  `src/i18n/TranslationProvider.tsx` is code the package ships, not a comment or a test. A consumer of
  this package sees a different development console after upgrading, which is a consumer-visible
  change even though it is not a behavioural one.

  Why it was worth shipping: the repetition destroyed the artefact it was printed into. One green
  `pnpm --filter '!backend' run test` measured **5 509 606 bytes**, 1.31x GitLab's 4 194 304-byte log
  ceiling, of which 64.2% was 38 201 missing-key lines carrying 920 distinct keys and a further 25.5%
  was 673 copies of one fetch failure with a ten-frame stack apiece. Master pipeline 14265's
  `test:frontend` was red and the reason was unobtainable, because vitest prints its failure summary
  last and the summary was past the cut.

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0

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

- Updated dependencies [0eeb9b5]
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 16a9a6d: **`./theme.css` — the admin's design system now ships from this package**, and
  it carries the class vocabulary as well as the tokens (owner ruling D-219,
  `specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
  R3–R4).

  **Old:**

  ```css
  @import '@endora-commerce/admin-shell/theme.css';
  ```

  **New:**

  ```css
  @import '@endora-commerce/admin-kit/theme.css';
  ```

  If your host also held `src/styles/design-tokens.css` and
  `src/styles/components.css` and imported them from `main.tsx`, **delete both and
  drop those two imports**: their content is in the file above. Keeping them
  overrides the package, which is what the ruling removes.

  The subpath moved here because this is the package every renderer already
  declares — 55 module packages depend on it and none depends on the shell — so a
  class name it publishes is one every renderer can put a version range on. It is
  also the reason this is a `major` on both packages rather than a move nobody
  notices.

  **What is in the file.** 79 custom properties under one `:root`, the 22
  `@theme inline` mappings that bind them to Tailwind utility names, `.dark`,
  `[data-density="compact"]`, the `@layer base` rules, and the **200-token class
  vocabulary** — `.b2b-*` and the page-builder classes — that host and module
  admin surfaces render by name.

  **The default palette changed**, and it is the one visible change in the
  rendered output. The shell's `./theme.css` declared a shadcn slate palette that
  this repository's own admin overwrote in full on every load; the merged file
  declares one palette and it is the one that has actually rendered since the
  rebrand. `--primary` is now `var(--accent-h) var(--accent-s) var(--accent-l)`
  rather than a slate literal. To get the old palette, redeclare it after the
  import.

  **Overriding is unchanged and still needs no fork**: a redeclaration for a
  value, a later rule for a class, both in your own stylesheet after the import.

  ```css
  @import '@endora-commerce/admin-kit/theme.css';

  :root {
    --accent-h: 262;
  }
  .b2b-btn {
    border-radius: 2px;
  }
  ```

  **23 classes were deleted rather than moved** — `.page-header`, `.card`,
  `.field`, `.input`, `.btn`, `.alert`, `.badge`, `.table` and their modifiers,
  the unprefixed `@layer components` shim. Measured over every class-attribute
  position in this repository, no file that loaded them rendered one. If you
  render any of them, define them yourself; the supported vocabulary is the
  `.b2b-*` family and `@endora-commerce/admin-kit/ui`.

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

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Major Changes

- 1d84094: `@endora-commerce/api-client` is gone; its client is now `@endora-commerce/admin-kit`'s own
  (owner ruling D-202).

  **What changes for you.** Nothing you imported from `@endora-commerce/admin-kit/lib` moved:
  `apiClient`, `ApiError`, `apiBaseUrl` and `onUnauthorized` are the same bindings at the same
  subpath. What moved is where `ApiError` is _declared_ — it is now the kit's class rather than a
  re-export — so a consumer that reached past the kit for it has to stop:

  ```diff
  -import { ApiError } from '@endora-commerce/api-client';
  +import { ApiError } from '@endora-commerce/admin-kit/lib';
  ```

  Identity is the reason this matters rather than a rename: every `catch` in the admin decides
  what it is looking at with `instanceof ApiError`, and two classes of that name pass every
  structural comparison while failing that test.

  Three symbols the deleted package exported are **not** published: `createApiClient` and the
  `ApiClient` / `ApiClientOptions` types are internal to the kit now, because the kit's own
  `apiClient` was their only caller and this package's surface is derived from what its consumers
  reach for. Ask for them if you need to build a second client.

  Drop the `@endora-commerce/api-client` dependency from your manifest; the kit no longer peers
  on it.

### Minor Changes

- 93a300c: Publish the admin contribution declarations, and the package a module's admin
  layer is written against.

  **`@endora-commerce/contracts`** gains `admin-contributions.ts`, re-exported
  from the barrel. It is additive and breaks nothing:
  - `AdminRouteDeclarationSchema`, `AdminNavDeclarationSchema` and
    `AdminZoneContributionSchema` — the data half of what a module package's
    `./admin` layer exports, so a generator, a check or a server can enumerate a
    contribution without evaluating any of the module's UI code.
  - `AdminNavSectionNameSchema` — the closed set of sidebar sections a module may
    join, derived from the twelve `admin/src/components/AppShell.tsx` already
    declares. A module may not invent a section: an invented section is a heading
    nobody else can join.
  - `AdminZoneNameSchema` — the closed, hierarchical set of places in one
    module's screen where another module's contribution may appear. The four
    opening members are exactly the places measured module additions reached into
    by editing another module's file.
  - `PermissionRequirementSchema` — a permission code, or a set any one of which
    suffices; the shape `admin/src/lib/surface-visibility.ts` already defines,
    published so a module package declares it without reaching into the admin for
    the type.
  - `AdminContributions`, `AdminRouteDeclaration`, `AdminZoneContribution` and
    `AdminComponentFactory` — the interfaces that carry the dynamic-import
    factory, which is the only function-valued field a contribution has. It is a
    TypeScript type rather than a Zod schema deliberately: a function value
    carries nothing to validate beyond its arity, and a `z.function()` here would
    tell a reader it had been checked.

  **`@endora-commerce/admin-kit`** is new, private, and publishes one subpath:

  ```ts
  import {
    AdminNavSectionNameSchema,
    type AdminContributions,
  } from '@endora-commerce/admin-kit/contributions';
  ```

  Every export is the identical binding rather than a copy —
  `@endora-commerce/contracts` is a peer dependency, so a consumer resolves one
  copy and a schema compared across the seam is the same object.

  The four design-system subpaths the feature derives (`./ui`, `./components`,
  `./lib`, `./i18n`) are **not** in this release. The package's README records the
  measurement: a `tsc`-emitted façade re-exporting `admin/src` is TS6059 —
  verified on a two-file probe — and dropping `rootDir` to make it compile emits a
  second copy of every component into the kit's `dist`, which is a duplicated
  module-scope value in a tree full of React context. Publishing them takes the
  shape feature 080 used for the platform relocation: the implementations move
  into the package and `admin/src` keeps re-export shims at their old paths.

- a85b425: Publish the four design-system subpaths: `./ui`, `./components`, `./lib` and
  `./i18n`.

  ```ts
  import { Button, Card, PageHeader } from '@endora-commerce/admin-kit/ui';
  import { ResponsiveTable, EChart } from '@endora-commerce/admin-kit/components';
  import { apiClient, cn, formatMoney } from '@endora-commerce/admin-kit/lib';
  import { useTranslation } from '@endora-commerce/admin-kit/i18n';
  ```

  Additive: nothing published before this release changed, and `./contributions`
  is untouched.

  **The implementations moved into this package.** 57 files that were
  `admin/src/components/ui`, `admin/src/components`, `admin/src/lib` and
  `admin/src/i18n` now live here, and the admin application keeps a one-line
  re-export shim at each of the 53 old paths it still names. That is a move rather
  than a façade because a façade cannot be built: a `tsc` re-export escaping the
  package is TS6059, and dropping `rootDir` to make it compile emits a second copy
  of every component into `dist` — a duplicated module-scope value in a tree full
  of React context, which is a `null` context at runtime with no type error.

  Every export is therefore the **only** copy in the process, and that is asserted
  by reference equality rather than by structure
  (`admin/test/kit/admin-kit-identity.test.ts`): a second `createContext()`, a
  second `ApiError` class and a second copy of `PAGE_SIZE_OPTIONS` all pass a
  field-by-field comparison and none of them passes `toBe`.

  **Every dependency the kit renders with is a `peerDependency`** — `react`,
  `react-router-dom`, `lucide-react`, the four Radix packages,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `echarts` and
  `@endora-commerce/contracts`. An application must resolve one copy of each: two copies of `react-router-dom` is two router
  contexts and a `useNavigate()` that throws.

  **Two groups are deliberately not published**, both recorded in
  `backend/scripts/ledgers/admin-surface.ts` with the event that retires them:
  - the six pickers over another module's data (`organization-picker`,
    `sales-channel-picker`, `asset-picker`, `cms-picker`) — publishing them would
    put module knowledge in a platform package; they belong to the owning module's
    own admin layer;
  - the admin application's session and module-presence state (`useAuth`,
    `useModulePresence`, `useSurfaceVisibility`, `usePageSizePreference`). Its
    `PAGE_SIZE_OPTIONS` constant **is** published here, because the list of page
    sizes is design-system and the per-admin preference is application state.

  A consumer that needs either today has no supported spelling for it; that is
  stated rather than worked around.

- 4c9892c: Added `apiBaseUrl` to `@endora-commerce/admin-kit/lib`.

  The origin the admin's `apiClient` was built from, published beside it. A screen that has to
  build a URL the fetch client cannot make for it — an `<a download>` href, a form action — needed
  that origin and had no supported way to ask for it, so it read `import.meta.env.VITE_API_BASE_URL`
  itself. Inside a **module package** that is a second copy of the `http://localhost:3001` fallback
  plus `vite/client` types in the package's own compiler configuration, for one string.

  ```diff
  -const apiBaseUrl =
  -  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  +import { apiBaseUrl } from '@endora-commerce/admin-kit/lib';
  ```

  The value is identical to the one `apiClient` uses — it is now the same binding, not a second
  read — and the expression stays verbatim in the kit, because Vite replaces
  `import.meta.env.VITE_API_BASE_URL` at build time and a cast or an indirection is a chance for
  that replacement to stop happening in a way no type-check can see.

- 972e7ed: Publishes the five pieces feature 091's batch 8 had to drain before `seo`, `taxes`,
  `credit_limits`, `delivery_methods`, `megamenu` and `returns` could own their admin
  surfaces: `ProductPicker`, `CountryPicker`, `CurrencyPicker` and
  `StatusTransitionGraph` on `./components`, and `statusBadgeStyle` /
  `readableTextColor` on `./lib`. The two dictionary reads
  (`listDictionaryCountries`, `listDictionaryCurrencies`) sit beside the pickers, as
  the asset cluster's do.

  Ten `cross-module-imports` keys retire on them — four into `catalog`'s picker, two
  into `dictionaries`' country picker, two into its currency picker and two into
  `orders` — of which four belong to modules this batch does not move (`orders`,
  `quote_requests` twice, `inventory`). Each took the exit P2's three data pickers
  took: the component builds its own request from the published `apiClient` and the
  owner's `@endora-commerce/contracts` schema, so it holds no module code and
  `admin-kit-surface.md` R6 permits it.

  **Two of the five changed shape, and both changes are R-1's rule applied.**

  `StatusTransitionGraph` no longer takes a `t` prop. Both callers passed
  `useTranslation('core')` and the component read `orderStatusConfig.*` keys out of
  it, so the prop carried the component's _own_ copy through the caller rather than
  the caller's vocabulary — which the `statusLabel` prop already carries. It resolves
  those keys itself now, out of the `core` namespace they were already in, and the
  rendered output is unchanged in both shipped languages. **If you rendered it**,
  drop `t={t}`; nothing else about the call changes.

  `orderStatusBadgeStyle` is published as **`statusBadgeStyle`**. A kit symbol named
  after a module is R6 wearing a different hat, and the caller that made the
  generality visible is `returns`, whose statuses are not orders'. The old spelling
  survives as an alias at `admin/src/modules/orders/orderStatusColor.ts`.

  `CountryPicker` and `CurrencyPicker` read `core` rather than `dictionaries` (R-1):
  their six keys moved from that module's bundle into `_i18n`'s under the same
  spelling. **If you translate this admin**, `dictionaries`' bundle loses the three
  `countryPicker.*` and three `currencyPicker.*` keys and `_i18n`'s gains them,
  plus five new `productPicker.*` — the four English sentences `ProductPicker`
  carried as literals, which a component nobody had to translate looks like.

  `CountryPicker` is **not** a duplicate of `CountrySelect`: this one reads the admin
  dictionary, which serves inactive rows and groups them, so an operator can see that
  a country exists and is switched off. `CountrySelect` reads the public facade,
  which cannot answer that.

- b1589fd: Publishes `CustomFieldValuesPanel` and `CustomFieldValuesPanelProps` on `./components`.

  The panel renders the definition-driven form for one host record's custom fields
  (feature 055). It was classified as a contribution the `custom_fields` module mounts
  inside four other modules' screens, and `admin-component-contribution.md` §9.1 rules that
  it never was one. Its props are `(entityType, values, save)` — data in, edited data back
  — so all four call sites hand it the **host's own** stored bag and the **host's own**
  writer, and `custom_fields`' admin API serves definitions and entity types and no values
  at all. Principle XIV working as designed puts `customFieldValues` on the host's row, so
  what crosses the seam is one `GET` for the definitions and nothing that belongs to the
  owner.

  That makes it the same shape as the pickers this package already publishes: it rebuilds
  `GET /api/v1/admin/custom-fields/definitions?entityType=…` from the published
  `apiClient`, and every type it names (`CustomFieldDefinitionDto`, `SupportedEntityType`)
  is `@endora-commerce/contracts`', which both sides compile.

  ```diff
  -import { CustomFieldValuesPanel } from '@/modules/custom_fields/CustomFieldValuesPanel';
  +import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
  ```

  The admin keeps a re-export shim at the old path, so nothing outside the four consumers
  had to be rewritten and both spellings are one binding — asserted by reference equality,
  because a second copy would be a second `useState` draft of one record's values.

  **It reads `core`, and adds no key to it.** `customFields.title` and `customFields.save`
  were already in the shipped bundle in both languages, so R-1's rule about a translation
  namespace being module knowledge is satisfied without moving anything. Rendered output is
  unchanged.

  **One defect travels with it, deliberately unfixed.** `defs.length === 0` returns `null`
  **above** the error `Alert`, so a failed definitions load renders nothing and is
  indistinguishable from "no custom fields are defined for this entity type". That is
  accidentally right for a 503 and wrong for everything else. It predates this move and
  repairing it inside a move would mix two subjects, so the behaviour is preserved verbatim
  and asserted as it stands.

- 316f44b: `@endora-commerce/admin-kit` publishes four generic members that sat under a module's
  admin directory and were rendered from another's (feature 091, P8).

  **`./components` gains `ContentLanguageTabs` and `ScopePicker`.**
  - `ContentLanguageTabs({ languages, activeLanguage, onChange })` — a tab strip over
    content language codes. Its props type is `ContentLanguageTabsProps`.
  - `ScopePicker({ value, onChange })` — sales channels and the content languages inside
    them. Its props type is `ScopePickerProps` and its value type is **`ScopePickerValue`**,
    which is `CmsScopeValue` renamed: `{ salesChannelIds: string[]; languages: string[] }`,
    field for field. A consumer importing `CmsScopeValue` from `mod-cms`' admin code renames
    the type and changes nothing else.
  - `listScopeSalesChannels(pageSize?)` and `fetchScopeSalesChannel(code)` come with it. The
    picker called `sales_channels`' admin API client; it now builds both `GET`s from the
    published `apiClient` and the contract's own `SalesChannelListResponse` /
    `SalesChannelDetail`, so the kit holds no module code.

  **`./ui` gains `Section`** — `Section({ title, action?, className?, children })` and
  `SectionProps`. A heading, an optional action beside it and a slot; it is a layout
  primitive, which is why it is here and not on `./components`.

  **`./lib` gains the three invoice e-mail-outcome helpers** — `invoiceEmailNotSentReason`,
  `sendInvoiceEmailMessage` and `issueInvoiceNotice`, plus the `Translate` type they take.
  Signatures are unchanged: each still receives the caller's scope-bound `t`.

  **`@endora-commerce/mod-cms`' bundle loses six keys** and `@endora-commerce/mod-i18n`'s
  gains them under new names, because the two components now render out of `core` (ruling
  R-1: a translation namespace is module knowledge). None of the six had another reader.

  | gone from `mod-cms`      | arrives in `mod-i18n`           |
  | ------------------------ | ------------------------------- |
  | `languageTabs.empty`     | `contentLanguageTabs.empty`     |
  | `languageTabs.ariaLabel` | `contentLanguageTabs.ariaLabel` |
  | `scope.title`            | `scopePicker.title`             |
  | `fields.languages`       | `scopePicker.languages`         |
  | `scope.selectChannel`    | `scopePicker.selectChannel`     |
  | `scope.loadingLanguages` | `scopePicker.loadingLanguages`  |

  Every value is carried across unchanged in both shipped languages. **A consumer that
  supplies its own bundle has to move all six**: a key left in the `cms` scope does not fail
  to compile and does not 404 — it renders `core.scopePicker.title` into the operator's screen
  as a label.

  The invoice e-mail helpers move no key. All twelve they read —
  `invoices.emailNotSent.<reason>` (seven), `invoices.emailSent`,
  `invoices.emailNotSentNotice` and three `orderDetail.issueInvoice.*` — were already
  `mod-i18n`'s in both languages and in neither `mod-invoices`' bundle nor `mod-orders`'.

- 45e77bb: `@endora-commerce/admin-kit/components` gains `FulfilmentStrategyPicker` (feature 091, P9).

  The control sat under `inventory`'s admin directory and was rendered by `catalog`'s product
  Inventory tab and by `organizations`' fulfilment panel. It is a **published component and
  never was a zone contribution**: its props are a value in and a value back, and both
  consumers own the save (`contracts/admin-component-contribution.md` §10.2, Z1 question 1).

  **Exported symbols.** `FulfilmentStrategyPicker`, and the three types
  `FulfilmentStrategyPickerProps`, `FulfilmentStrategyValue` and `FulfilmentWarehouseOption`.

  ```ts
  import {
    FulfilmentStrategyPicker,
    type FulfilmentStrategyValue,
    type FulfilmentWarehouseOption,
  } from '@endora-commerce/admin-kit/components';
  ```

  ```tsx
  <FulfilmentStrategyPicker
    value={value} // { strategy: FulfilmentStrategy | null; warehouseOrder: string[] }
    onChange={setValue} // every edit, including the ordering, arrives here
    warehouses={warehouses} // { id, code, name }[] — the caller's list
    allowInherit // optional: offers an "inherit" option that maps to a null strategy
    disabled={saving} // optional
    idPrefix="org-fulfilment" // optional: disambiguates element ids when two pickers share a page
  />
  ```

  **Nothing about the component changed** — same props, same behaviour, same element ids. It
  keeps no state of its own: the parent owns `value` and the warehouse list, and owns the
  PATCH.

  **No key moves and no bundle changes.** The component already read `useTranslation('core')`
  and every `fulfilment.*` key it renders was already `@endora-commerce/mod-i18n`'s in both
  shipped languages, so ruling R-1 §9.2 — a translation namespace is module knowledge — costs
  this publication nothing. A consumer supplying its own bundle needs the fourteen
  `fulfilment.*` keys under `core`, which is where they already are.

  `admin/src/modules/inventory/components/FulfilmentStrategyPicker.tsx` stays as a re-export
  shim over the package's own bindings, so the old spelling and the subpath name one module
  record.

- ebc08af: Publishes the Assets-Library picker cluster: `AssetPicker`, `AssetUploader` and
  `AssetFieldPicker` on `./components`, `toAbsoluteAssetUrl` on `./lib`, and the three
  requests they make (`listAssets`, `fetchAssetDetail`, `uploadAsset`) beside them on
  `./components`.

  They were the last of feature 091's Group A pickers, left unpublished because
  `AssetFieldPicker`'s module knowledge was a **component** — `assets_library`' own
  `AssetPicker` — rather than a request, so there looked to be nothing to rebuild.
  Measured, `AssetPicker` is one `GET`, `AssetUploader` is one multipart `POST` over the
  `apiBaseUrl` this package already publishes, and every type all three name
  (`AssetSummary`, `AssetDetail`, `ListAssetsResponse`) is `@endora-commerce/contracts`'.
  So the cluster took the same exit the three data pickers took: the components build
  their own requests and hold no module code.

  **If you rendered a picker through the admin's `@/modules/assets_library/…` paths**,
  name the package instead — those files are gone, and the shim that remains is at
  `@/components/asset-picker/AssetFieldPicker` only.

  ```diff
  -import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';
  -import { AssetUploader } from '@/modules/assets_library/components/AssetUploader';
  -import { toAbsoluteAssetUrl } from '@/modules/assets_library/lib/asset-url';
  -import { assetsLibraryClient } from '@/modules/assets_library/api/assets-library-client';
  +import {
  +  AssetPicker,
  +  AssetUploader,
  +  fetchAssetDetail,
  +} from '@endora-commerce/admin-kit/components';
  +import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
  ```

  `AssetUploader`'s `defaults` prop is typed `AssetUploadFields` rather than the module
  client's `UploadFields`; the shape is unchanged. `assetsLibraryClient.uploadAsset` and
  its `UploadFields` type are removed from the admin's own client, which had no caller
  left once the uploader moved — a second live copy of one multipart `POST` is not
  something to keep.

  **The components' copy is `core`'s now, not `assets_library`'s** (R-1). A translation
  namespace is module knowledge on the same test that permits an HTTP path: the schema
  crossing a path is in a peer dependency both sides compile, and a bundle is not — it is
  shipped by a module package this one may not depend on, and a key that did not travel
  renders `core.assetPicker.empty` at the operator rather than failing to compile. The
  eleven keys the two components read moved: three reuse `core`'s existing
  `common.action.close`, `common.state.loading` and `common.action.search` (the last added
  to that family), and eight are new under `assetPicker.*`. Rendered output is unchanged in
  both shipped languages.

  **If you translate this admin**, `assets_library`'s bundle loses nine keys —
  `common.close`, `picker.empty`, `picker.searchPlaceholder`, `picker.uploadNew` and the five
  `uploader.*` — and `_i18n`'s gains nine. `uploader.triggerCurrentFolder`, `common.loading`
  and `common.search` stay where they are: the module's own screens still read them.

- 47c958f: Published the admin session and module-presence state.

  `@endora-commerce/admin-kit/lib` gains `AuthProvider`, `useAuth`, `AdminMe`,
  `ModulePresenceProvider`, `useModulePresence`, `getModulePresence`,
  `setModuleActivation`, `useSurfaceVisibility`, `isSurfaceVisible`,
  `satisfiesPermission`, `usePageSizePreference` and the `GatedSurface` /
  `PermissionRequirement` types.

  **`useAuth` is how a screen refuses a control the operator may not use**, and until now a
  package could not name it. Sixteen packaged modules therefore render every control live to
  a read-only operator, who fills the form in and gets a 403 on save. This release is what
  lets each of them fix that; the screen-side repairs are the owners'.

  `usePageSizePreference` moves for a related reason. Its constant, `PAGE_SIZE_OPTIONS`, was
  published on its own because the hook reads the signed-in admin's id to key its
  `localStorage` entry — that id comes from `useAuth`, so the split has nothing left to
  separate and both halves are one package's now.

  **If you render one of these,** nothing changes: every prop is the same, and `admin/src`
  keeps a re-export shim at each old path.

  **If you test something that reads them, the seam changed and this is the part to read.**
  `useSurfaceVisibility` calls `useAuth` and `useModulePresence` **inside** the package, so a
  test that replaced either module at its own path no longer reaches the predicate:

  ```diff
  -vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
  -vi.mock('@/lib/module-presence', () => ({ useModulePresence: () => ({ isPresent: () => true }) }));
  +render(
  +  <AuthProvider initial={session}>
  +    <ModulePresenceProvider initial={{ modules: [...], degraded: false }}>
  +      <Subject />
  +    </ModulePresenceProvider>
  +  </AuthProvider>,
  +);
  ```

  `AuthProvider` takes a new optional `initial: AdminMe`, the prop `ModulePresenceProvider`
  has carried since it was written: supply it and the provider starts `authenticated` and
  skips its boot fetch. That is the whole substitution seam, and it is data rather than a
  mock — a permission gate asserted against a stub of the predicate asserts that the stub was
  consulted.

  Two properties of the projection are worth knowing before you seed one. `isPresent` answers
  `false` for a module id the projection does not list, so name every module your subject asks
  about; and an unlisted module is the _hidden_ branch of every gate, which renders as
  nothing at all.

- b2552d5: Published the three data-fetching pickers, and the Organization picker's row shape.

  `@endora-commerce/admin-kit/components` gains `SalesChannelPicker`, `CmsBlockPicker`,
  `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti`,
  `OrganizationStatusBadge` and `useOrganizationsQuery`. Each of them was previously
  unreachable from a package: it lived in the admin application and imported another
  module's admin API client, so publishing it would have put module code in the kit.

  **A kit component gets its data by building the request itself**, from the published
  `apiClient` and the owner's schema in `@endora-commerce/contracts`. Five kit components
  already did that before this release (`CustomerPicker`, `AdminUserPicker`,
  `CustomerGroupPicker`, `CategorySelect`, `useCountriesQuery`); the rule was simply never
  written down. An HTTP path plus a schema out of a package the kit already depends on is
  not module knowledge — a module's _code_ is, and that is what these seven files no longer
  name.

  **If you render one of these,** nothing changes: every prop is the same, and
  `admin/src` keeps a re-export shim at each old path. **If you test one,** the seam moved:
  mock `@endora-commerce/admin-kit/lib`'s `apiClient`, not the module client.

  ```diff
  -vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
  -  organizationsPickerClient: { list: listSpy },
  -}));
  +vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  +  ...(await vi.importActual('@endora-commerce/admin-kit/lib')),
  +  apiClient: { get: getSpy, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  +}));
  ```

  `@endora-commerce/contracts` gains `organizationPickerListItemSchema` /
  `OrganizationPickerListItem` and `organizationPickerPageSchema` /
  `OrganizationPickerPage` — the picker's projection over
  `GET /api/v1/admin/organizations`, which now crosses a package boundary and so belongs
  here under Principle II. **There is no `OrganizationStatusPickerFilter`**: its four
  members are exactly `organizationStatusSchema`'s, measured, so the picker takes the
  published `OrganizationStatus` rather than acquiring a second name for one set.

  ```diff
  -import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
  +import type { OrganizationStatus } from '@endora-commerce/contracts';
  ```

  `admin/src/modules/organizations/api/organizations-picker-client.ts` is deleted; it
  existed only to serve this picker and nothing else imported it.

- 7140eed: `adminUiPackages` / `declaresAdminUi`: a workspace member may now declare
  `endora: { type: 'admin-ui' }`, the third value of that block beside
  `'platform'` and `'module'`, and `@endora-commerce/cli/lib/workspace-packages.js`
  exports the two functions that read it.

  `@endora-commerce/admin-kit` declares it. Nothing about what the kit publishes
  changes; the declaration is what puts its sources into two static checks'
  populations — `i18n:hardcoded`'s walk, which found the kit by name until now,
  and `check:admin-zones`' third `foreign-module-id` population, which found it
  not at all. A second admin-ui package (feature 091 P5b's
  `@endora-commerce/page-builder-admin`) is judged from its first commit by
  declaring the same block, with no edit to either check.

  The declaration only ever _adds_ obligations, which is what distinguishes it
  from the self-certified exemption D-171 refused: forgetting it is a hard-coded
  string that goes unread and a `HARDCODED_STRINGS_BASELINE` entry that reports
  itself drained in the same run.

- cebad9c: Admin zones are usable: a props contract at both ends, `match`, and a `./zones` renderer.

  **Breaking, `@endora-commerce/contracts`.** `AdminZoneNameSchema` no longer carries
  `order.detail.tabs`, `delivery_method.row.actions`, `payment_method.row.actions` or
  `product.editor.sidebar.after`. All four were rendered by no host and contributed to by
  no module — measured — and the new `check:admin-zones` reports a member nothing renders
  as `unrendered-zone` with no ledger to record it in. The three members that replace them
  are the three places a host actually mounts:

  ```diff
  -AdminZoneNameSchema.parse('product.editor.sidebar.after')
  +AdminZoneNameSchema.parse('product.editor.details.before')
  +AdminZoneNameSchema.parse('product.editor.pricing.before')
  +AdminZoneNameSchema.parse('product.editor.field.after')
  ```

  **If you named one of the four removed members**, there is no drop-in replacement: a zone
  name is a place, and each of the four described a place that either does not exist
  (`product.editor.sidebar.after` — the product editor has no right-hand sidebar) or has no
  mount yet. The batch that renders your place adds the member with the mount, in one merge
  request; that is the rule the removals establish.

  New in `@endora-commerce/contracts`:
  - `AdminZonePropsMap`, `AdminZoneProps<Z>` and the props interfaces
    `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`. The map is declared as
    `Record<AdminZoneName, object>`, so a zone member without a props type is a compile
    error in the package itself.
  - `match` on `AdminZoneContributionSchema` —
    `Record<string, string | readonly string[]>`, optional. The renderer includes a
    contribution when every key agrees with the mount's props, and it decides that
    **before** `React.lazy`, so a contributor that serves two of a zone's mounts is not
    downloaded on the rest.

  New in `@endora-commerce/admin-kit`:
  - A `./zones` subpath — `AdminContributionsProvider`, `useAdminZone(name, props)`,
    `<AdminZone name props />`, `ZoneErrorBoundary`, and the pure
    `selectZoneContributions` / `matchesZoneProps`. Presence, permission and `match` are
    filtered at enumeration, so an operator's activation flip needs no rebuild; each
    contribution gets its own error boundary and `Suspense`.
  - `zoneComponent(zone, load, options?)` and `AdminZoneComponent<Z>` on
    `./contributions` — the contributor's end of the props map, which is what constrains a
    module's default export to the zone it names.

  ```ts
  // host
  <AdminZone name="product.editor.field.after"
             props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />

  // contributor, in src/admin/index.ts
  zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
    weight: 10,
    requiredPermission: 'catalog:write',
  })
  ```

  `./zones` is a separate subpath from `./contributions` on purpose: the second is
  data-only and is what a module's declaration file imports, and one subpath would let a
  declaration file import a component.

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

- 543151a: `catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

  **`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
  gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
  with eight `routes` and six `nav` declarations — the product roster and editor, the category
  tree, the attribute and attribute-set registries, the attachment types and the two
  bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
  nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
  that composes either package's `./admin` gets those screens without editing an application file.

  **`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
  `open-categories` and `open-attributes`, each with the destination, permission code and keywords
  the admin's hand-written palette row carried, and with the labels and descriptions those rows
  rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
  `open-orders` action it had declared all along.

  **`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
  `@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
  declaration names its icon rather than importing it, and `orders`' three sidebar rows render
  that glyph.

  **Breaking for a consumer that imports these two modules' screens from the admin application.**
  Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
  were deleted with them:
  - `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
  - `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
    `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
    `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
    `@endora-commerce/admin-kit/lib`'s.

  **`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
  `appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
  shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
  module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
  bundles.

  **One route tightens.** `/orders/new` was declared by the admin application and therefore
  ungated, while the sidebar row that advertised it carried `orders:write`; the route is
  `@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
  previously open an order-entry form whose save would refuse now meets the admin's not-found
  treatment instead.

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

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

- 21dac4f: `dictionaries`, `settings` and `credentials` ship their admin surfaces, and a module can
  publish a React component to another module for the first time.

  **New `./admin` subpath on four packages.** `@endora-commerce/mod-dictionaries`,
  `@endora-commerce/mod-settings` and `@endora-commerce/mod-credentials` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`,
  and nothing else. `@endora-commerce/mod-pwa` already exported one and it grows a `routes`
  entry. Nine routes and ten nav entries in total, all at the paths and codes the
  hand-written host registrations carried:
  - `mod-dictionaries` — `/dictionary`, `/dictionaries/audit` and `/admin/dictionaries/audit`,
    all `dictionary.write`; sidebar rows for `/dictionary` and `/admin/dictionaries/audit`.
  - `mod-settings` — `/settings` and `/settings/groups` on `settings:read`, `/settings/cache`
    on `settings:write`; a sidebar row for each.
  - `mod-credentials` — `/credentials` on `credentials:read` and `/credentials/new` on
    `credentials:write`; one sidebar row.
  - `mod-pwa` — `/settings/pwa` on `pwa:read`, beside the sidebar row it has declared since
    the previous wave. `PwaPage`, `PushAudienceRuleBuilder` and the `pwa` admin API client
    moved into this package from `mod-settings`' directory, where they had been since before
    either was a package.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **New `./admin-ui` subpath on `@endora-commerce/mod-credentials`, and it is a new kind of
  subpath.** It exports `ConfigurationPreviewModal` and its `ConfigurationPreviewModalProps` —
  a read-only view of one credential configuration with every secret masked, taking
  `{ open, configuration, onClose }`. This is the first package in the repository to publish a
  React component to another package rather than to the admin application, and three things
  about it are contract rather than convenience:
  - **It is not the kit.** A component whose rendering is generic over its data belongs in
    `@endora-commerce/admin-kit`; this one calls `useTranslation('credentials')`, so every
    string it shows is the owner's vocabulary and the kit refuses it.
  - **A consumer gates presence itself.** `credentials` carries an operator activation
    control, and a statically imported component is filtered by nothing — so the consumer
    wraps the render in `useSurfaceVisibility()({ module: 'credentials' })`. With the module
    switched off the caller must render nothing rather than a modal over an API that answers 503.
  - **`@endora-commerce/mod-credentials` becomes a peer dependency of
    `@endora-commerce/mod-settings`.** The reach survives into emitted JavaScript, so a
    consumer that bundles `mod-settings`' admin layer has to resolve the owner.

  **`@endora-commerce/admin-kit`:** `toAbsoluteAssetUrl` now trims its argument and returns a
  protocol-relative URL (`//cdn.example.com/x.png`) unchanged. It previously prefixed such a
  URL with the API origin, producing `https://api.example.com//cdn.example.com/x.png`, which
  loads nothing. Existing callers passing an absolute, `data:`, `blob:` or host-relative URL
  are unaffected. `resolveIcon` answers for two more names, `Languages` and `Eraser`.

  **`@endora-commerce/contracts`:** `KnownIconNameSchema` gains `'Languages'` and `'Eraser'`.
  Additive — no previously valid icon name is rejected.

  **`@endora-commerce/mod-i18n`:** ten `appShell.*` keys are **removed** from the shared
  bundle — `appShell.nav.{cache,credentials,dictionary,dictionaryAudit,settingGroups,settings}`
  and `appShell.palette.sub.{credentials,dictionary,dictionaryAudit,platformConfiguration}`.
  Their replacements are `nav.*.label` keys in the three modules' own bundles, resolved in each
  module's own namespace. **A consumer rendering one of those ten keys by hand will render the
  raw key**; there is no compatibility alias, because a key with one consumer in two bundles is
  the duplication this feature removes.

  **Both shipped languages, everywhere.** Every new key — the six `nav.*.label`s,
  `mod-settings`' `editor.credentialRef.preview` and `mod-dictionaries`' four
  `actions.openDictionary*` strings — ships in `en` and `pl`.

  **`mod-dictionaries` declares two command-palette actions**, `open-dictionary` and
  `open-dictionary-audit`, both on `dictionary.write`. They replace hand-written rows in the
  admin's own palette table, so what an operator sees is unchanged; what changes is that the
  server now filters them against the effective enabled-set, which the hand-written rows were
  never asked about.

  **Build.** `./admin` resolves at `dist/admin/index.js` and `./admin-ui` at
  `dist/admin-ui/index.js`, both emitted by each package's `tsconfig.ui.json`. A checkout that
  has not run `pnpm run build:packages` cannot resolve either. All four packages' `build` and
  `typecheck` scripts now run two `tsc` invocations, and `@endora-commerce/admin-kit`, `react`,
  `react-router-dom` and `lucide-react` become peer dependencies where a screen names them.

- 43e1968: `price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
  four icon names join the allowlist.

  **Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
  `contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
  each now declares its screens there too, at the paths and codes the hand-written host
  registrations carried. Sixteen routes and nine sidebar entries between them. The exported
  symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
  consumer already reading the zones needs no edit; what is new is that the same object now
  answers for the screens.
  - `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
    `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
    code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
    gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
    section at weight 100. The display-mode screen is reached from a button on the roster and the
    detail screen from the roster itself, so neither has a row of its own.
  - `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
    `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
    all. **No sidebar row**, which is the host table's own decision kept: quick order is the
    other way of getting lines into one order, reached from the `order.entry.tabs` strip this
    package already contributes into.
  - `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
    `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
    `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
    code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
    the order the host table had. Both of this module's admin surface directories moved: the
    warehouse screens and their client are here too, the sidebar having always attributed
    `/warehouses` to this module.
  - `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
    `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
    and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
    weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
    `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
    declarations already describe. Its admin client moved with the screens and is now
    `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
  `TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
  `KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
  compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
  from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
  them four rows would have had to degrade to names already on the allowlist.

  **`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
  of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

  **`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
  targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
  shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
  unchanged; what changes is that the advertisement is now resolved from the manifest against the
  effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
  hand-written row was a second copy of `open-inventory` and is simply gone.

  **`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
  four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
  `appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
  bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
  `nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
  `nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
  breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
  shared bundle gets nothing; resolve it in the owning module's namespace instead.

- 214cbdb: `CategoryTreePicker` now resolves its strings in the `core` namespace instead of `catalog`
  (feature 091, ruling R-1: a translation namespace is module knowledge and the kit holds none).
  It is the last of the three components the ruling names; `AssetPicker` and `AssetUploader`
  moved in the preceding release.

  **What a consumer has to do: nothing, if it renders inside the platform's own
  `TranslationProvider`.** All seven keys moved with the component and kept their spelling —
  `categoryTreePicker.loading`, `.filter.placeholder`, `.aria.treeLabel`, `.empty.noCategories`,
  `.empty.noMatches`, `.expand`, `.collapse` — so only the namespace changed, and no rendered text
  changes.

  **What a consumer that supplies its own bundle has to do:** move those seven keys from the
  `catalog` scope of the bundle into `core`. A key left behind does not fail to compile and does
  not 404 — it renders `core.categoryTreePicker.loading` into the screen as a label.

- 3c8102e: `LineChart` joins the admin icon allowlist.

  `KnownIconNameSchema` gains `'LineChart'` and `resolveIcon` maps it to the lucide component
  of that name — the pair AGENTS.md's command-palette checklist requires in one merge request,
  because a name on the allowlist with no entry in the map renders the generic `Sparkles`
  fallback.

  It is added rather than substituted because a module's sidebar entry now declares its icon
  by name (`AdminNavDeclarationSchema.icon` is this same enum). `analytics`' entry was a
  direct `lucide-react` import in `admin/src/components/AppShell.tsx`; picking a name already
  on the list would have changed the glyph an operator sees, which is a visible regression
  bought for nothing.

- c94c52d: `api_keys`, `webhooks` and `comparisons` ship their admin surfaces, on a new `./admin` subpath
  each; `KnownIconNameSchema` gains two members and the kit's icon map the glyphs behind them.

  Each of the three module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. The routes are unchanged — `/api-keys`,
  `/webhooks`, `/comparisons` and `/comparisons/:id` — and each package contributes a sidebar
  entry as well.

  Five things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of all
    three, and `react-router-dom` of `comparisons`.** They were backend-only packages before
    this. The kit is where every screen's design-system import now resolves, and React is peered
    rather than depended on so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.**
    `integrations:manage` for `/api-keys` and `/webhooks`, `comparisons:read` for both comparison
    routes — in each case the code the screen's own API enforces. A host `<Route>` was ungated,
    so a consumer who deep-links one of these paths for an operator without the code now gets the
    admin's not-found treatment where the screen used to render and its API answered 403.
  - **`KnownIconNameSchema` gains `Webhook` and `Scale`.** A nav entry and a palette action name
    their icon; both glyphs were `lucide-react` imports inside the admin's own `AppShell.tsx`
    until this change, so keeping the sidebar looking the same meant adding the names rather than
    substituting two already on the allowlist. `@endora-commerce/admin-kit`'s `resolveIcon` maps
    both. Widening a `z.enum` is additive for a producer and narrowing for a consumer that
    exhaustively switches on `KnownIconName`; nothing in this repository does.
  - **Each of the three declares its first command-palette action** — `open-api-keys`,
    `open-webhooks` and `open-comparisons` — with both labels in the package's own `i18n/` bundle.
    A consumer resolving palette entries from the manifests will see one more per module.

  Nothing is removed and no existing export changes shape, so a consumer of any of the three
  `./backend`, `./migrations` or root subpaths is unaffected.

- 4013a8b: `promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
  surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
  icon map the glyph behind it.

  Each of the four module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
  and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
  `/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
  ten `/product-feeds*` paths.

  Six things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
    dependencies of all four.** They were backend-only packages before this. The kit is where
    every screen's design-system import now resolves, and React is peered rather than depended on
    so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
    for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
    `product_feeds:read` — in each case the code the screen's own API enforces on its entry
    handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
    operator without the code now gets the admin's not-found treatment where the screen used to
    render and its API answered 403. The write codes each of these modules also owns
    (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
    `product_feeds:write`) gate controls **inside** a screen and are unchanged.
  - **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
    `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
    `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
    name rather than substituting one already on the allowlist.
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
    producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
    in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
    `Rss` are already on the list, each added by an earlier palette action of that same module.
  - **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
    `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
    `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
    own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
    `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
    deliberate, because the only place two modules could share it is the admin kit and the kit
    holds no module knowledge.
  - **`product_feeds`' download anchors now read the API origin from
    `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
    directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
    and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
    variable is set the two are identical, so this is a repair to the unset case and not a change
    to any configured one.

  Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
  own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
  `nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
  key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
  breadcrumb trails the admin holds for the payment-gateway settings screens.

  Nothing is removed and no existing export changes shape, so a consumer of any of the four
  `./backend`, `./migrations`, `./ports` or root subpaths is unaffected.

- fc34995: `pwa` ships an admin surface that is a sidebar entry and nothing else.

  `@endora-commerce/mod-pwa/admin` is a new subpath exporting `contributions` — an
  `AdminContributions` object with **one `nav` entry and no `routes`**. That combination is
  legal and was, until now, unexercised: the type's own documentation says _"a module shipping
  only a nav entry pointing at a host route is legal"_, and every conversion before this one
  moved a route. The entry advertises `/settings/pwa`, labelled `nav.pwa.label` in this
  package's own `i18n/{en,pl}.json` rather than in the shared bundle, in section `system` at
  weight 1400, gated on `pwa:read`.

  Two things a consumer has to know:
  - **The screen at that path is not in this package.** `PwaPage` lives in the admin
    application, under a directory `settings` owns, so the route is still declared by the host.
    A consumer that renders the registry's nav without the admin's own route table will show an
    entry pointing at a path it does not serve. That resolves when `settings` ships its own
    admin layer.
  - **`Smartphone` joins the icon allowlist.** `KnownIconNameSchema` gains the name and the
    kit's `resolveIcon` maps it to the lucide component of that name — the pair AGENTS.md's
    command-palette checklist requires in one merge request, because a name on the allowlist
    with no entry in the map renders the generic `Sparkles` fallback. It is added rather than
    substituted so the sidebar keeps the glyph it already drew.

- 9b2a43e: Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
  zone a tab strip.

  `@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
  `OrderEntryTabsZoneProps`, which is empty: the contributions _are_ the tabs, so the mount has
  no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
  `<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
  an `<AdminZone>` mount is.

  `@endora-commerce/admin-kit` gains two exports:
  - `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
    and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
    per-contributor error boundary and the `weight` ordering are unchanged. **It renders
    nothing at all when fewer than two contributions survive presence and permission**: one tab
    is not a choice. The floor is a constant rather than a prop, deliberately — two is a
    property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
    refuses.
  - `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
    own selected state, because in a contributed strip no component sees the whole set. That
    costs `RouteTabs`' _longest-wins_ tie-break: two contributed tabs whose paths are prefixes
    of one another would both read as selected. `RouteTabs` itself is unchanged and is still
    the primitive to use whenever one component knows every tab.

  `@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
  _Standard order_ tab at weight 100. `@endora-commerce/mod-quick-order` gains the _Quick
  order_ tab at weight 200. Both are gated on `orders:write`, which is the code their routes
  enforce. Each label now ships in its own module's bundle
  (`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

  **If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
  both module ids and both routes and belonged to neither module; mount the zone instead:

  ```diff
  -import { OrderEntryTabs } from '@/components/OrderEntryTabs';
  -<OrderEntryTabs />
  +import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
  +<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
  ```

- e7bbadc: Field protection is published surface, and both PIM connectors contribute it.

  `@endora-commerce/admin-kit` gains a subpath, `./field-protection`, exporting
  `useFieldProtection`, `FieldProtectionToggle`, `FieldProtectionSummary`,
  `FieldProtectionPricePanel`, `describeFieldPath`, `controlIdPrefix` and the types
  `FieldProtectionSource`, `FieldProtectionView`, `FieldProtectionEntry`,
  `FieldProtectionPricePath` and `FieldProtectionApi`. It holds the per-scope store, the
  mount de-duplication and the optimistic write with its rollback, and it holds no HTTP
  knowledge at all: `load`, `save`, the translator and the source label arrive on one
  `FieldProtectionSource` prop from the integration that owns them.

  ```ts
  import { FieldProtectionToggle } from '@endora-commerce/admin-kit/field-protection';

  const source = {
    scopeKey: `my_pim:${productId}`,   // keys the store and prefixes the DOM ids
    sourceLabel: 'My PIM',             // what the operator calls the integration
    t: useTranslation('my_pim'),       // reads fieldProtection.* out of your bundle
    load: async () => (await client.get(productId)).data,
    save: async (protections) => (await client.replace(productId, { protections: [...protections] })).data,
  };

  <FieldProtectionToggle source={source} fieldPath="name" languageCode="pl-PL" />;
  ```

  `@endora-commerce/mod-pim-ergonode` gains an `./admin` subpath declaring three zone
  contributions — `product.editor.details.before`, `product.editor.pricing.before` and
  `product.editor.field.after` — and `@endora-commerce/mod-pim-pimcore` adds the same three
  to the ones it already declared, together with `pimcoreProtectionsClient` on its `./admin`
  export. Neither ships a control of its own any more, so a platform carrying both PIMs
  renders one control per connected integration instead of two implementations of one
  concept.

  Consumers that imported `FieldProtectionToggle`, `FieldProtectionSummary`,
  `ErgonodePriceProtectionPanel` or `ErgonodeAttributeValueProtection` from
  `admin/src/modules/pim_ergonode/components/FieldProtectionToggle` render an
  `<AdminZone>` instead: the file is deleted and no re-export shim replaces it, because the
  whole point of the change is that a host names no integration.

### Patch Changes

- 68044b1: `CustomFieldValuesPanel` now tells a failed definitions load apart from an entity type
  with no custom fields.

  The `defs.length === 0` early return sat **above** the error `Alert`, so both cases
  rendered nothing: a broken `GET /api/v1/admin/custom-fields/definitions` was
  indistinguishable from "no custom fields are defined for this entity type", and an
  operator had no way to know a retry was worth anything. This is the defect the panel's
  publication (`admin-kit@minor`, "One defect travels with it, deliberately unfixed")
  recorded rather than repaired, so that the move stayed reviewable.

  The empty return is now conditional on the load having answered:

  ```diff
  -if (defs.length === 0) return null;
  +if (defs.length === 0 && error === null) return null;
  ```

  An empty entity type still renders nothing — that behaviour is unchanged, and is asserted
  beside the repair. A failed load renders the card with the error `Alert` and **no save
  button**: there is nothing to edit and nothing to write. A read that succeeds also clears
  a previous entity type's failure, which it did not need to before, `error` now being what
  decides the empty branch.

  **The 503 case the old ordering was argued to be accidentally right for does not exist.**
  `custom_fields` declares `activation.nonDeactivatable`, which since issue #258 makes it a
  module the composition is required to have: `composeModules` refuses a composition that
  would reach its boot phase without it, and D-69 refuses every disable and every uninstall.
  A platform that cannot serve this endpoint does not boot, so `MODULE_DISABLED` is
  unreachable here and the repair needed two branches rather than three.

  No prop, no export and no translation key changes.

- 31975ca: `KnownIconNameSchema` gains `'PlugZap'`, with the matching entry in the kit's
  `resolveIcon` map. A module declaring a sidebar entry or a palette action names its icon as a
  string rather than importing the component, so a glyph the allowlist does not carry cannot be
  declared at all.

  `@endora-commerce/contracts` also publishes the Pimcore connector's own surface — the
  `Pimcore*` DTOs, the delivered-record envelope, `PIM_PIMCORE_SETTING_CODES` and seventeen
  `PIM_PIMCORE_*` members of `ERROR_CODES` — and three catalogue shapes the connector's ports
  need.

  No existing export changes shape.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
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
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
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
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
