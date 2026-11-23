# @endora-commerce/mod-tasks

## 0.112.0

### Minor Changes

- bfbcac2: The admin kit publishes `ViewModeToggle` from `@endora-commerce/admin-kit/components`: the _List | Board_ switch that Tasks and My Tasks used, now named from the shared `common.viewMode.*` strings. The Tasks module no longer ships its own copy, and its `view.label`, `view.list` and `view.board` strings are removed.

  CRM's Opportunities list and board are one page. `/crm/opportunities` shows the list, and `/crm/opportunities?view=board` shows the board, switched by the toggle in the page header. The two views share one address: the search, organization, assignee, tag, sales-channel and creation-date filters carry over when the view changes. The list's state, status, sort and custom-field filters are now in the address too, so a reload or a shared link keeps them. **Clear all filters** clears the filters of both views. The sidebar loses its _Board_ row. `/crm/board`, and the command palette's _Opportunity board_ that targets it, redirect to the board view and keep the filters a bookmark carried. The CRM strings `nav.board.label` and `board.title` are removed.

- ee6062c: **A status or priority list is reordered in one request** (issue #1560). Three new endpoints take the
  whole list in its new order and change it in one audited Command, so a move is one history entry and
  one undo step, and a list is never left half-moved:

  | Route                                      | Permission        | Command                  | Answers                                |
  | ------------------------------------------ | ----------------- | ------------------------ | -------------------------------------- |
  | `PUT /api/v1/admin/crm/statuses/order`     | `crm:configure`   | `crm.status.reorder`     | the workflow, as `GET /crm/workflow`   |
  | `PUT /api/v1/admin/tasks/statuses/order`   | `tasks:configure` | `tasks.status.reorder`   | the workflow, as `GET /tasks/workflow` |
  | `PUT /api/v1/admin/tasks/priorities/order` | `tasks:configure` | `tasks.priority.reorder` | the list, as `GET /tasks/priorities`   |

  The body is `{ orderedCodes: string[] }` and must be exactly the configured codes, each once.
  Anything else — a code that is not configured, a row left out, a row named twice — answers
  `409 ORDER_STALE`, a new code in
  `ERROR_CODES` with an English and Polish sentence in `@endora-commerce/mod-i18n` — the list changed
  since the caller loaded it, so reload it. The weights are rewritten 10, 20, 30, … in the new order.
  The audit entry records `{ order: [codes] }` before and after.

  New in `@endora-commerce/contracts`: `ReorderOpportunityStatusesRequestSchema`,
  `ReorderTaskStatusesBodySchema`, `ReorderTaskPrioritiesBodySchema` (and their types) and
  `ERROR_CODES.ORDER_STALE`.

  In the admin, the CRM status settings and the Tasks status and priority settings move a row with
  up/down buttons on the row instead of a position number in the status or priority dialog; the
  position field is gone from the dialogs, and a new status or priority goes last. A move shows at
  once, is undone with a message if the server refuses it, and reloads the list with a message if
  somebody else changed it meanwhile. The `PATCH` endpoints still accept `weight`. No setting,
  permission or migration changes.

- 51c5072: New endpoint `GET /api/v1/admin/tasks/count`, gated by `tasks:read`. It answers `{ data: { count } }`: the number of Tasks `GET /api/v1/admin/tasks` would return to the same caller under the same filters, across all pages. The same visibility rules apply, so another administrator's private Task or draft, and a Task in a context the caller cannot see, are not counted. It takes every filter of the list (`TaskCountQuerySchema`) and refuses `sort`, `dir`, `cursor`, `limit` and `cardValues`. `@endora-commerce/contracts` exports `TaskCountQuerySchema`, `TaskCountSchema` and `TaskCountResponseSchema`, and the Tasks admin client gains `tasksApi.countTasksBy(query)`. While the `tasks` module is off, the route answers `503 MODULE_DISABLED`, like every other `tasks` route.

### Patch Changes

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

- 1064839: `@endora-commerce/admin-kit/ui` publishes `EmptyState` (issue #1448): the block a list, a tab or a panel shows when it has nothing to show — a decorative icon, a title, at most one line and at most one action, drawn with the design system's `.b2b-empty` classes.

  It has two variants. `no-data` (the default) takes `icon`, `title`, an optional `description` and an optional `action`. `no-results` takes `onClearFilters` and renders the kit's own title, line and _Clear filters_ button (new `core` keys `common.emptyState.clearFilters`, `common.emptyState.noResults.title` and `common.emptyState.noResults.body`, in English and Polish); `icon`, `title` and `description` override them.

  After _Clear filters_ the kit moves focus to `focusAfterClear` (a ref, normally the list's search box) on the next frame, so focus never drops to `<body>` when the button unmounts (WCAG 2.2 SC 2.4.3). Without one, and only if focus was lost, it focuses the page's `<h1>`, else the closest container of the block still in the document. Every list that uses the `no-results` variant here passes its search box; `EntryFilters`, `OpportunityFilterFields` and `TaskFilters` gain an optional `searchRef` for that.

  ```tsx
  <EmptyState variant="no-results" title={t('list.emptyFiltered')} onClearFilters={clearFilters} />
  <EmptyState icon={<ClipboardList size={20} />} title={t('list.empty.title')} action={createButton} />
  ```

  The forms and form-entries lists, the CRM opportunities list, the task and _My tasks_ lists, the task settings lists, the project and project-template lists, the custom-fields table, the price-book list, and the product-feed list, runs, delivery and templates screens now use it. The forms list now says "No forms yet" with a line of its own (a reader is told who can create one), and it hides the header's _New form_ while the empty state carries it. The form-entries list's empty state gains a title.

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

- 074f500: Admin zone contributions now choose a tab or a sidebar by naming the zone for that place (issues #1452 and #1526). Four zones are new: `organization.detail.sales` is the body of the organization's Sales tab, after the sales representatives, and carries `{ organizationId }` with no save session; `order.detail.sidebar`, `quote_request.detail.sidebar` and `opportunity.detail.sidebar` are sidebar cards, and each contribution is a section of the card. The order and quote request screens draw their sidebar only while something fills it. The organization's Sales tab is shown to someone who may assign sales representatives or who sees one of its panels. CRM opportunities and projects moved from the organization's Commerce tab to its Sales tab. The linked opportunity, the project and the tasks moved from the end of the order, quote request and opportunity screens into their sidebars. No zone was removed or renamed: contributions to the `.detail.after` zones keep working unchanged.
- 7624db6: Adds `InlineEdit` and `InlineEditTitle` to the admin kit's `./components`: the admin's one model for editing a record's facts where they are shown (issue #1453). Each fact has its own pencil, _Save_ and _Cancel_, and sends only itself. `InlineEdit` takes a `group` option for an editor of several controls, which names itself through the new `labelId`. `MultiSelect` and `TagMultiSelect` take an optional `id` for the trigger. The copy is in `core`: `common.inlineEdit.edit`, `common.inlineEdit.saved` and `common.inlineEdit.error`.

  CRM now uses the kit's component (its own copy is removed), and the Opportunity's assignee is edited the same way as the facts beside it, instead of through an always-open lookup. On a Task, the page-wide _Edit_ form is replaced: the title, description, due date, start date, priority, tags and assignees are each edited in place. On a Project's _Overview_, the description, the start date and who sees the Project are edited in place. The start date could not be changed there before (issue #1525).

- 56eebb9: **Shorter copy on the CRM, Tasks and Projects admin screens** (issue #1486, UX audit WORK-11). The page
  descriptions and hints that restated a title or described the controls below them are gone, and the
  ones kept — a rule the screen does not show — fit on one line. Translation keys removed from both the
  `en` and `pl` bundles: CRM `opportunity.list.description`, `opportunity.create.description`,
  `opportunity.create.requiredHint`, `opportunity.stage.hint`, `opportunity.status.reasonHint`,
  `board.description`, `workflow.description`, `workflow.statuses.description`, `assignment.changeHint`,
  `tags.description`, `analytics.description`, `value.hint.manual`, `boardCard.description`,
  `calendar.description`; Tasks `list.description`, `mine.description`, `create.requiredHint`,
  `field.assigneeHint`, `comments.hint`, `workflow.description`, `workflow.statuses.description`,
  `workflow.field.categoryHint`, `boardCard.description`, `tags.description`, `tags.list.description`,
  `priorities.description`, `priorities.list.description`; Projects `list.description`,
  `create.requiredHint`, `create.stages.hint`, `editor.hint`, `editor.movesHint`, `tasks.hint`, `templates.editor.intro`,
  `templates.editor.rolesHint`, `templates.editor.stagesHint`, `lossReasons.description`. A deployment overriding one of these keys
  can drop the override.
- 0ecb287: The CRM board, the opportunity list, the Projects list and the Tasks screens use the kit's list toolbar (issue #1505). Each shows a few filters in one row and folds the rest behind **More filters**. While the panel is closed, the button counts the folded filters in use, as **More filters (2)**.

  - **Opportunity board**: search, assignee and Organization. Tags, Sales Channel, creation range and the card-field filters are behind _More filters_.
  - **Opportunity list**: search, state, status and assignee, with the sort on the right. Organization, tags, Sales Channel, creation range and **every** custom-field filter are behind _More filters_. The list no longer keeps the first three custom-field filters always open.
  - **Projects list**: search, state, Organization, **My projects** and member, with the sort on the right. Role, template, stage name and custom-field filters are behind _More filters_.
  - **Tasks and My Tasks**: search, status, assignee, the due range and **Overdue**. The sort and saved views are on the right.
  - On/off filters (_Overdue_, _My drafts_, _Private_, _My projects_) are now toggle chips that report their state with `aria-pressed`, instead of checkboxes. Their labels are shorter.
  - **Clear filters** is now the kit's **Clear all filters**, and focus moves to the search box after it.

- 9a27b93: New kit composite `BoardCardFieldsEditor` (`@endora-commerce/admin-kit/components`), with the types `BoardCardFieldChoice`, `BoardCardFieldsConfig`, `BoardCardFieldsEditorCopy` and `BoardCardFieldsEditorProps` (issue #1506). It edits which fields a board card shows and in what order: `load` and `save` answer `{ fields, available, maxFields }` (the catalogue and the limit come from the server), `fieldLabel` names a field, and `copy` carries the three lines that name the module's record. Its other copy is `core`'s new `boardCardFields.*` keys in `@endora-commerce/mod-i18n`.

  CRM's and Tasks' own `BoardCardFieldsEditor` copies are removed, along with their duplicated `boardCard.*` keys (the title, `shown.titleAlways`, `available.builtin` and `available.noCustom` stay). CRM's `ITEM_COUNT_LABEL_KEY` and `opportunity.tabs.counted` are removed too, because the kit's `common.tabs.counted` reads the same. The Opportunity and Project record tabs now use the kit `RecordTabs`, and the form builder's tabs use `Tabs` / `TabPanel`. The form builder's strip now looks like every other strip in the admin.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- a8261aa: The task screen has the layout of an opportunity (issue #1524). There are three cards instead of up to twelve: a main card with the details, the custom fields and the sub-tasks; a sidebar card with where the task belongs, its linked records, its reminders and its related tasks; and a tabbed card with Comments and Attachments, each with a count, and History. The selected tab is kept in the address as `?tab=attachments` or `?tab=history`. The status is shown once, as the badge beside the title. The Details section offers only the "Move to…" menu, beside Edit (issue #1566).

  The `task.detail.after` zone is now the last section of the task screen's sidebar card, not a stack of cards below the page. A contribution built on `EditorSection` takes the zone's `chrome="section"` and is drawn as a section of that card. The zone's name and props are unchanged. A contribution that draws a card of its own should drop it.

- b2c1723: The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
- 1fa98ed: Each work module's configuration is one sidebar entry with tabs (issue #1557, UX audit WORK-06):

  - **CRM → Configuration** (`/crm/workflow`): **Workflow** | **Tags**. The tag list moves to `/crm/workflow/tags`; `/crm/tags` redirects there. The separate _Tags_ and _Workflow_ rows are gone.
  - **Task configuration** (`/tasks/settings`): **Workflow** | **Priorities** | **Tags** | **General**. The workflow is the tab at `/tasks/settings`; `/tasks/settings/workflow` redirects there and keeps `#board-card`. The workflow header no longer has text links to the other screens, and they no longer have a back link. _General_ is a short card with the time zone, and the result shows beside _Save_.
  - **Project configuration** (`/projects/settings`): **Templates** | **Roles** | **Loss reasons**. Templates is the tab at `/projects/settings`, the editor is at `/projects/settings/templates/:id`, and the dictionaries are at `/projects/settings/roles` and `/projects/settings/loss-reasons`. The old addresses redirect. The three separate rows are gone.

  Every command-palette action still opens its tab. `open-task-workflow`, `open-crm-tags`, `open-project-templates`, `open-project-roles` and `open-project-loss-reasons` now target the new addresses. New i18n keys: `nav.configuration.label` and `configuration.tab.*` in all three modules. Retired keys: `nav.tags.label` and `nav.workflow.label` (crm); `nav.templates.label`, `nav.roles.label` and `nav.lossReasons.label` (projects); `nav.settings.label`, `settings.description`, `settings.link`, `settings.nav`, `settings.priorities.link`, `settings.tags.link` and `settings.back` (tasks).

- 82c5d94: The workflow configuration screens say plainly which changes are saved at once and which wait for _Save_ (issue #1559, UX audit WORK-08).

  - **CRM › Configuration**: the workflow is four tabs instead of five stacked cards, on the same strip as **Tags** (`/crm/workflow/tags`, last) rather than on a second strip under it: **Statuses & moves** (`/crm/workflow`), **Order sync** (`/crm/workflow/order-sync`), **Value** (`/crm/workflow/value`) and **Board card** (`/crm/workflow/board-card`). Each tab has one save model. On _Statuses & moves_, the statuses and the allowed status changes are two sections of one card, both marked "Applies immediately", with no Save. _Order sync_ holds both mapping tables in one card under one _Save mappings_, and _Value_ holds its two lists under one _Save counting statuses_. Both Saves sit in the admin's sticky action bar with "Unsaved changes" and the result beside the button, and leaving the tab with unsaved choices asks first. The board's _Card fields_ link, `/crm/workflow#board-card`, now opens the _Board card_ tab, and `/crm/workflow#value-counting` opens the _Value_ tab. The three new routes are gated on `crm:configure`, as the screen is.
  - **Tasks › Settings › Workflow**: the statuses and the moves between them are two sections of one card, both marked "Applies immediately". The board card stays in a card of its own, with its own Save.

  New CRM i18n keys: `workflow.tab.statuses`, `workflow.tab.orderSync`, `workflow.tab.value`, `workflow.tab.boardCard`; the CRM `configuration.tab.workflow` key is removed, as the strip names the four workflow tabs instead. The API is unchanged.

- 9868c7c: The admin dictionary screens put their _Add_ in one place, the page header (issue #1562, UX audit WORK-13).

  - **Tasks › Tags** and **Tasks › Priorities**: _Add tag_ / _Add priority_ is the filled button in the page header instead of an outline button in a card header, and the card title that repeated the page title ("Tags", "Priorities") is gone. The count column now reads "Tasks (visible to you)", as does the workflow screen's status count, because the server counts only the Tasks the operator can see. A row's delete button is drawn in the destructive tone.
  - **CRM › Tags**: the empty list shows the admin's empty state (icon, title, one line, _Add tag_), and the header's _Add tag_ is hidden while the list is empty, so the screen has one primary action. The count column reads "Opportunities (visible to you)".
  - **Projects › Roles** and **Loss reasons**: the same empty state with its _Add_ replaces the bare "Nothing to show.", and the header's _Add_ is hidden while the dictionary is empty.
  - **Dictionaries** (Countries, Currencies, Languages): the active tab's _Add country_ / _Add currency_ / _Add language_ moves from the tab's card into the page header, opens the editor and moves focus to its code field. The card no longer repeats the tab's name above the table; the table is named by it. The empty state carries the _Add_ while a dictionary is empty. A row's _Edit_, _Set default_ and red _Delete_ buttons become one row menu, "Actions for PL", with _Delete_ last; on the default row _Delete_ and _Set default_ are disabled and _Delete_ says why.

  The i18n keys `tags.list.title` and `priorities.list.title` (tasks) and `dictionary.empty` (projects) are removed. The CRM `tags.empty` is now a short title, with the sentence moved to the new `tags.emptyBody`. The API is unchanged.

- 6735d52: My Tasks opens with the list (issue #1563): the daily digest setting is a closed disclosure in the page header that says its state ("Daily digest: off" / "Daily digest: on, 08:00") and opens the same control below the header. The `DigestControl` component is replaced by the `useDigestDisclosure()` hook, which returns the header `trigger` and the `panel`.

  The task, opportunity, project and project-template create forms mark required fields through the kit's `FormField` — an asterisk and `aria-required` — with their hints and errors linked to the field (issue #1564). On the new-project form the template choice is the first field of the first card instead of a card of its own. The CRM lookup pickers accept `ariaDescribedBy` and `invalid`.

- 820f089: The admin kit exports `formatDate(value, language)`, and `formatDateTime(iso, language)` takes the admin UI language: a medium date, and a moment as that date with the short time, never the browser's locale (UX audit #1567). The Opportunity sidebar's deadline and Record dates, the Projects date labels (the Project panel's Stage deadline among them) and the Tasks date labels use them, so one screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`. On the Opportunity sidebar the value stays on one line and the value-mode switch sits below it instead of squeezing it to one character per line.
- 0d4c134: Accessibility follow-ups from the UX audit (issues #1599, #1600, #1607).

  - **Scope picker** (CMS pages, blocks and templates; blog posts and categories): the _Languages_ heading now names the group of language checkboxes, so a screen reader announces "Languages, group" when focus enters it. It used to be a label attached to nothing.
  - **New order — delivery and billing address**: the _Pick existing_ / _Enter new_ buttons are a group named _Address source_, and pressing the option already chosen no longer clears a typed address or a picked one.
  - **Pricing settings — Show the list price beside the buyer's price**, and the **Private** setting on a new task and on a task's page, are now the standard on/off switch rather than a checkbox announced as a switch. A task's _Private_ switch that cannot be turned on (other people are assigned) stays focusable and says why.
  - The unused, never-displayed _Quote requests_ settings tab component in the Settings module, and its strings, are removed. The quote-request settings are unchanged.

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

- 3821b39: Fifteen work and content list screens now use the kit `ListPage` (issue #1749). They are the Opportunities list and the CRM tags; Projects, Project templates, Project roles and loss reasons; Tasks, My tasks, Task priorities and Task tags; the newsletter's campaigns, automations, subscribers and e-mail blocks; and the transactional e-mail templates and blocks. Each one now has the kit loading skeleton, a load error with **Retry**, the result count at the end of the toolbar row, and its filters in a toolbar row instead of a card. A reload keeps the rows on screen. When the server refuses a custom-field filter, the list says so and offers **Remove filter**.

  - **Tasks, My tasks, Projects, Opportunities:** the pager is the kit list footer, with the same _Previous_ / _Next_ and rows per page as before.
  - **Newsletter subscribers:** the list is paged. It used to show the first 50 and stop. The search and the tag filter run as you type.
  - **Newsletter e-mail blocks:** the block editor is no longer open above the list. **New block** opens it in place of the list, as _Edit_ does.
  - **Transactional e-mail templates and blocks:** the create form that stood above the list is a dialog behind **Create template** / **Create block**. A row's _Delete_ is in its menu, and the delete runs inside the confirmation.
  - New `en` / `pl` keys: `crm` `tags.count`; `projects` `templates.list.toolbar`, `templates.list.count`, `dictionary.toolbar`, `dictionary.count`, `list.count`; `tasks` `tags.count`, `priorities.count`, `mine.count`; `newsletter` `campaigns.count`, `automations.count`, `subscribers.toolbar`, `emailBlocks.count`; `transactional_emails` `templates.count`, `templates.empty`, `templates.rowActions`, `blocks.count`, `blocks.empty`, `blocks.rowActions`.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 398e6d2: Record-tab zones: a module can add a whole tab — a label, an optional count and a panel — to another module's record tab strip. `@endora-commerce/contracts` adds the zone `opportunity.detail.tabs` (props `OpportunityDetailZoneProps`), `RECORD_TAB_ZONE_NAMES` with `RecordTabZoneName` and `isRecordTabZoneName`, `RecordTabDeclarationSchema`, an optional `tab` on a zone contribution (required on a record-tab zone, refused on every other one) and the TypeScript-only `count` factory (`AdminCountFactory`). `@endora-commerce/admin-kit` adds `recordTabComponent()` on `./contributions`, which takes only a record-tab zone and type-checks the panel and the count loader (`RecordTabCounter`) against the zone's props, and `useRecordTabZone()` on `./zones`, which returns the visible contributed tabs with their labels and counts and renders the selected panel; `zoneComponent()` now refuses a record-tab zone at compile time. The CRM opportunity screen renders `opportunity.detail.tabs` after its _Events_ tab and selects a contributed tab from `?tab=<id>`. The Tasks module's panel on an opportunity left `opportunity.detail.sidebar` and is now a _Tasks_ tab (`?tab=tasks`) on `opportunity.detail.tabs`, whose count is the open linked Tasks; the order and quote-request sidebars keep their _Tasks_ sections. `check:admin-zones` reads `useRecordTabZone('<zone>', …)` as a render site and `recordTabComponent('<zone>', …)` as a contribution.
- 9d6f006: Issue #504: the Project/Stage picker on a Task's screen (`GET /api/v1/admin/tasks/lookups/contexts`) now reads one bounded page per search. Before, each search listed every Project the caller could see, described them all and asked about each candidate separately, so it got slower as the number of Projects grew.

  - `TaskContextDescriptor` gains an optional `search({ q, limit, changeableOnly })`, with the new types `TaskContextSearchQuery` and `TaskContextSearchHit`. A context owner that implements it answers the picker's page itself. The lookup asks it once per search and no longer calls `allVisibleContextIds`, `describe` or `canChangeTasks` for that owner. An owner without it keeps the previous scan.
  - The `project` Task context implements it with `ProjectAccess.searchVisibleByLabel`, which is one statement with both visibility rules and a limit, plus one read of the page's Stages. A caller without `projects:write` gets an empty list without any Project being read.

  The picker offers the same Projects as before: the ones the caller may see and change, matched on number and title without regard to case or diacritics, sorted by label, at most 20.

- 5e76569: Tasks admin UX follow-ups:

  - The filter bar always shows search, status, assignees and the due range. The other filters sit behind _More filters_, which shows how many of them are in use while it is closed.
  - The Tasks list pages with the kit's `CursorPagination`. The rows-per-page choice goes up to 100 and is remembered for each admin, so the default page is now the kit's 20 instead of 50.
  - Task links and _Add task_ on a record's Tasks panel carry `?returnTo=`. _Back_ on the task screen and the create screen, and the screen shown after deleting a task, lead back to that record.
  - _Configure card_ scrolls to the board-card section once the workflow screen has loaded.
  - On the create form, the _Private_ switch comes before the assignees and says whom it removed. _Remove from the record_ asks first, because it changes who can see the task.
  - A refused submit focuses the first invalid field: on the create form, the edit form, and the status, priority and tag dialogs.
  - _Make sub-task of…_ sits on the _Sub-task of_ line. _Create task_ and _Save as draft_ each show busy only when they are the one pressed. The board-card editor asks before you leave it with unsaved changes. The digest control's load error offers _Retry_.
  - Polish copy calls the workflow "przebieg zadań" throughout, and the list's assignee column and filter are plural.

  The i18n keys `list.previous` and `list.next` are removed.

- d243d1a: Tasks admin: the Tags and Priorities settings screens show a proper empty state — an icon, what the list is for, and one primary _Add tag_ / _Add priority_ action — instead of a bare sentence. On a Task's screen _Delete task_ moves from beside _Edit_ in the Details section to the page header, and its confirmation is the kit's `ConfirmDialog`, which opens on _Cancel_. The i18n keys `tags.empty` and `priorities.empty` are replaced by `tags.empty.title` / `tags.empty.body` and `priorities.empty.title` / `priorities.empty.body`.
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

- 52831b7: The Task e-mails link into the admin panel (follow-up to issue #185). With `ADMIN_BASE_URL` set:

  - `tasks_task_reminder` sends `task.adminUrl` (`<ADMIN_BASE_URL>/tasks/<taskId>`). The default
    template shows an **Open the task** / **Otwórz zadanie** button to it.
  - `tasks_daily_digest` sends `digest.adminUrl` (`<ADMIN_BASE_URL>/tasks/mine`) and an `adminUrl`
    on each item of `digest.tasks` (`<ADMIN_BASE_URL>/tasks/<taskId>`). In the default template
    each listed task's number and title link to the task, and an **Open My tasks** /
    **Otwórz Moje zadania** button opens _My tasks_.

  With `ADMIN_BASE_URL` unset none of these variables is sent. The digest lines are then plain text
  and the buttons are left out. A customised template that does not name the variables renders as
  before. `TaskDigestEntry` gains a required `taskId`.

- c0a6d85: Issue #470 (D-288; owner ruling O-1, 2026-11-10: a title is a value) — a task's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without regard to what the reader may see.

  - `tasks.task.create`, `tasks.task.update`, `tasks.task.status_change`, `tasks.task.delete`, `tasks.task.custom_fields_change` and `tasks.attachment.add` no longer record the title, the context note, custom field values or an attachment's file name. They record `changedFields` / `changedCustomFields` and a `valueChangeId` instead. `TASKS_AUDIT_KEYS` is the snapshot's allowlist.
  - The values go to a new table owned by the Tasks module, `task_value_changes` (`TaskValueChange`, `@RuleScoped` like the task, `on delete cascade`). The same Command writes it. The migration `Migration20261110T054810TasksValueChanges` creates it.
  - `GET /api/v1/admin/tasks/:id/history` reads the values back by the task's own id, after `findVisibleRow`, and serves them in the shape entries had before. A context the reader may not see is still blanked, its note included.
  - The history serves custom field values, and the names of changed custom fields, only to a `custom_fields:read` holder (owner ruling 2026-11-10; feature 162 P2 = a, as CRM and Projects). `OwnerReadChecks` gains `customFields`.
  - Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new task entries show field names instead of values. The task's own **History** tab is unchanged, except that custom field values now need `custom_fields:read` there. See _Task values leave the platform audit log_ in the upgrade guide.

- 23e8b43: Changing `tasks.time_zone` now re-derives what Tasks counted in the old zone (issue #505), by any
  write path — the Tasks _General settings_ screen, `PUT /api/v1/admin/tasks/settings/time-zone`
  or the generic settings write:

  - a relative reminder on a Task with a due date alone counts from 09:00 of that date in the new
    zone; its delivery rows go, so it fires again at the new moment;
  - `due_on` of a Task with a due time becomes that time's date in the new zone.

  The work is a new first pass of the `tasks-reminders` tick, so it lands within a minute. Each Task
  changed gets one `tasks.task.update` audit entry with `reason: 'time_zone_changed'`, its `dueOn`
  before and after and `remindersMoved`. New exports: `TaskTimeZoneRederiveService`
  (`services/time-zone-rederive-service.ts`), `rederiveTaskDueCommand` and
  `TASKS_REDERIVE_SCOPE_REASON`. `TasksRemindersJobDeps` gains a required `rederive` pass, and
  `followDueMoment` now answers how many relative reminders it moved.

- ca66684: Attaching a library file that is not private to a Task is refused under the module's own
  attachment code instead of `VALIDATION_FAILED`, with a sentence in English and Polish (issue #642,
  part of #86). **A caller that matches on `VALIDATION_FAILED` for this refusal now sees
  `TASK_ATTACHMENT_REFUSED`.** The HTTP status is unchanged. Until now it was answered with an English
  sentence in every language, because the error envelope never replaces the message of
  `VALIDATION_FAILED`.

  | Route                                      | Was                                                                                                           | Is                            | `details`                                                               |
  | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
  | `POST /api/v1/admin/tasks/:id/attachments` | `422 VALIDATION_FAILED`, _"An attachment must be a private file. Upload it to the media library as private."_ | `422 TASK_ATTACHMENT_REFUSED` | `code: 'not_private'`, `reason: 'not_private'`, `assetId`, `visibility` |

  `not_private` is a new refusal token of the existing `TASK_ATTACHMENT_REFUSED`, declared in the
  `tasks` manifest's `tokens`, so a caller already handling that code (`413` too large, `415` active
  content) handles this one too. A file that is not in the media library, or that the caller may not
  see, stays `422 VALIDATION_FAILED`, as does relating a Task to itself (`400`). The module's
  documentation page names the refusal. No setting, permission or migration changes.

### Patch Changes

- baa0dae: The custom-fields panel on the Opportunity, Project and Task Overview no longer clears stored values the operator did not touch (issue #1007). Each screen used to add a `null` for every stored key missing from the panel's bag before sending its `PATCH`, written when the panel reported a cleared field as `undefined`. The panel has reported a cleared field as `null` since issue #176, and leaves out every key it does not offer for editing (a `read` or `hidden` field, or a value with no definition) and, now, every key the operator did not change. The screens forward the panel's bag as it is, so a save writes the changed fields only and the server's merge keeps every other stored value.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- f39d37f: Each manifest exports `customFieldWrites` (`specs/175-buyer-input-custom-fields/`), the `CustomFieldWriteDeclaration[]` naming the admin routes that write its custom-field host's values: opportunity, project and task create (`POST`) and update (`PATCH …/:id`), and the customer values patch (`PATCH /api/v1/admin/customers/:id/custom-fields`). A type-only declaration read by `check:custom-field-writes`; no runtime behaviour changes.
- 939c455: The attachment lists of Tasks, Projects and CRM Opportunities resolve every file's download link in one batched `assetReadPort.resolveUrls` read instead of one `assetsLibraryPort.getAsset` call per file (issue #545). The full asset detail asked every registered asset-reference descriptor about each attached file, so a list of N files issued about 12 × N reference statements. The links are unchanged: the same signed, expiring URL for a private file, with `download=1`. A host that composes these services itself must provide `resolveUrls` on the `assets` dependency (it is part of the published `AssetReadPort`).
- 93146d1: Resolving the references in a text no longer reads the reader's administrator record when the text mentions a Product (issue #963). The reference services of `crm`, `tasks` and `projects` still looked up the reader's preferred language and then discarded it, a leftover from per-locale product names: a Product is named by its single Global `name`. The labels shown do not change.
- 4933779: The module's documentation page counts the four passes of the `tasks-reminders` tick, the time-zone pass included, and says a reminder e-mail carries its link only when `ADMIN_BASE_URL` is set. English and Polish.
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

### Patch Changes

- 3f020ba: Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
- 0b64c13: English page titles, dialog titles, command-palette action labels, settings group names and
  documentation page titles now use sentence case, like the module names and sidebar labels
  before them. For example, "Quote Requests" becomes "Quote requests", "CMS Pages" becomes
  "CMS pages" and the "Quick Order" settings group becomes "Quick order". Polish strings are
  unchanged. Product names keep their capitals: Page Builder, Google Analytics, LinkedIn and
  Meta among them.

  The admin search group labels change the same way: "Quote Requests" becomes "Quote requests"
  and "Sales Opportunities" becomes "Sales opportunities". The demo megamenu's English button
  label becomes "Quick order". The demo seed does not rewrite a menu it has already created, so an
  existing demo database keeps "Quick Order" until it is seeded afresh or the label is edited on
  the megamenu screen.

  The settings group names are updated in the database the next time the settings manifest
  reconciler runs at boot. Nothing has to be migrated.

- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
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

- 4bc5c7f: Task attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Tasks a reader may not see — private, draft, or of a context record hidden from them — by the rule the Tasks screens use, including `tasks:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/tasks/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
- 87af080: `422 TASK_PRIORITY_UNKNOWN` now carries the unknown priority code as `details.priorityCode`; `details.code` no longer carries it, and the error has no `details.code` at all. The envelope read that value as a refusal token, looked up a sentence that could not exist and answered the thrower's English in every language. The message is now the translated sentence naming the code — `The priority "whenever" does not exist.` / `Priorytet „whenever” nie istnieje.` A client that read the code from `details.code` reads `details.priorityCode` instead.
- 11b0eb8: A new module package, `@endora-commerce/mod-tasks` (module id `tasks`): Tasks for
  administrators — a number (`TSK-…`), a title, a description, an assignee, a due date and one of
  four statuses — standing on their own or belonging to a record another module owns.

  - **Activation.** `tasks.enabled` (on by default, switchable on `/platform/modules`). Off is
    non-destructive: every route answers `503` `MODULE_DISABLED`, every screen, palette action and
    search hit is gone, other modules can neither read nor create Tasks, and everything is back as
    it was when it is switched on again.
  - **Migration.** `tasks_init` — the `tasks` table and its number sequence.
  - **Permissions.** `tasks:read`, and `tasks:write`, which requires it.
  - **Admin API** under `/api/v1/admin/tasks`: the list (status, assignee, due dates, overdue,
    context, search), _My tasks_, a Task's create, read, update and delete, its change history, and
    the assignee lookup. A Task whose context the caller may not see answers exactly as a missing
    one.
  - **Admin UI.** _My tasks_ (`/tasks/mine`), the Tasks list, _New task_ and a Task's screen, in the
    sidebar's _Projects & tasks_ section; three palette actions (`open-tasks`, `open-my-tasks`,
    `new-task`); Tasks in admin global search, by number or title. A Task's screen mounts the
    `task.detail.after` zone for other modules' panels. English and Polish.
  - **Assignment.** Assigning a Task to somebody else notifies them through the bell
    (`admin_notifications`, optional) — and only when they may see the Task's context.
  - **For other modules.** `taskContextRegistry`, an ungated contribution seam through which a
    module owns a Task context type and decides who sees its Tasks (fail-closed: a context nobody
    present owns hides its Tasks) and who may put a Task into one of its records, take one out or
    delete one (`canChangeTasks`; a refused delete is `403` `FORBIDDEN`, and a Task's detail carries
    the answer as `context.canChangeTasks`, so its screen offers no Delete it would refuse); `taskReadPort` and `taskWritePort`, gated; the events
    `tasks.task.created.v1`, `tasks.task.status_changed.v1`, `tasks.task.assigned.v1` and
    `tasks.task.deleted.v1`; and `nextTaskNumber(em)` on `./backend`, the door to the `TSK-…`
    number sequence.
  - **Dependencies.** Binding on `_i18n`, `admin_users`, `audit_logs`, `auth` and `settings`;
    degrades without `admin_notifications`.

  Its contract — the API schemas, `TaskReadPort`, `TaskWritePort` and `TaskContextRegistryPort` —
  is in `@endora-commerce/contracts` (see that package's entry).

- 55864a1: Tasks grows into a work-management module (`specs/165-task-management/`): several assignees, a configurable status workflow with permitted transitions, priorities, tags, a rich-text description with references, comments with mentions, attachments, custom fields, sub-tasks and related Tasks, links to Opportunities, Orders and Quote Requests with a Tasks panel on each, a board beside the list (the choice remembered per user), saved filters, reminders and an opt-in daily digest, drafts and private Tasks.

  **Upgrading.** One migration, `tasks_task_management`, keeps every existing Task: its status stays as a seeded code (`todo`, `in_progress`, `done`, `cancelled`, every transition permitted) and its single assignee becomes the first of its assignees. Its `down` restores the previous shape with the first assignee.

  - New permissions `tasks:configure` (the workflow, tags, priorities, board card and time zone) and `tasks:see_private` (reading and deleting other people's private Tasks); grant them to the roles that need them.
  - New palette actions on `tasks:configure`, one per settings screen: `open-task-workflow`, `open-task-priorities`, `open-task-tags` and `open-task-general-settings` (the time zone).
  - New settings `tasks.board_card_fields` and `tasks.time_zone` (default `Europe/Warsaw`), and two transactional e-mails, `tasks_task_reminder` and `tasks_daily_digest`.
  - New dependencies, all non-deactivatable: `custom_fields`, `assets_library`, `transactional_emails`, `orders`, `catalog`. The module stays operator-toggleable and degrades without `crm`, `quote_requests` and `projects`.
  - A worker on the queue `tasks-reminders` runs where workers run: a Job Scheduler every 60 s delivers due reminders (the bell exactly once, the e-mail at most once; a reminder more than 24 h late — after downtime or while Tasks was off — is recorded as expired and not sent) and, at most every 15 minutes, the daily digests and a maintenance pass (#450): the Tasks of a context whose record was deleted while Tasks was off — a Project — are deleted as the system (`tasks.task.delete`, `reason: context_gone`), and those of a deleted group — a Stage — lose it (`tasks.task.update`, `reason: context_group_gone`). Only a context owner that is on and answers the new optional `TaskContextDescriptor.existingContexts` is asked, so nothing is taken for gone while its owner is off. The package gains the peers `bullmq`, `ioredis` and `@endora-commerce/email-components`.
  - `taskReadPort` now also hides drafts and other people's private Tasks; `taskWritePort.createMany` honours `sourceKey`, so a retried batch creates only what is missing (#450).
  - Removing a priority in use takes `?replacement=<code>` or `?replacement=none`, and moves every Task holding it — drafts and private Tasks included — each change in that Task's history (`reason: priority_removed`). Deleting a tag takes it off every Task and writes one audit row on the tag with how many Tasks carried it.
  - A draft is published with `POST /api/v1/admin/tasks/:id/publish`, by its Creator, once: only then is `tasks.task.created.v1` emitted and are its assignees and mentioned people told. While it is a draft no `tasks.task.*` event is emitted for it at all — for other modules it does not exist yet.
  - `DELETE /api/v1/admin/tasks/:id` answers **200** with `{data: {subtasksDetached}}` instead of 204, and its gate is `tasks:read` (the service asks for `tasks:write`, or `tasks:see_private` on a private Task, and answers the same 403 otherwise): deleting a parent makes its sub-tasks top-level, and the answer says how many of them the caller may see. A client that checked for 204 checks for a 2xx.
  - **Assigning a Task of a record is refused for somebody who may not see the record** (#506): `POST` and `PATCH /api/v1/admin/tasks` answer 422 `TASK_ASSIGNEE_INVALID` with `details: {code: 'context_hidden', name, adminUserId}`, naming the person, for an assignee the context's `canSeeAs` refuses — and when a Task moves to another record, for the assignees it keeps. Before, such an assignment was accepted and the person was simply not told. `GET /api/v1/admin/tasks/lookups/assignees` takes `contextType` and `contextId` (the create form inside a record) and, like `taskId`, offers only who may see it. `taskWritePort.createMany` does not ask this: the context owner names its assignees (a Project's Stage holder).

### Patch Changes

- ffb2aec: Every signed-in administrator can now read and acknowledge their own notifications on the Admin UI's bell, whatever their role. Before, the bell and its API needed `admin:read`, so a narrow role such as a sales representative had Task and CRM notifications recorded for them that they could never open.

  - `@endora-commerce/mod-admin-notifications`: `GET /api/v1/admin/notifications`, `POST /api/v1/admin/notifications/:id/read` and `POST /api/v1/admin/notifications/mark-all-read` are gated on an administrator session with no permission code. `admin:read` now decides only whether the `all_admins` broadcasts are listed, counted and acknowledgeable; for an administrator without it, a broadcast's id answers `404` like any notification that is not theirs. `AdminNotificationService.listForAdmin`, `markRead`, `markAllRead` and `countUnreadForAdmin` take a required `includeBroadcasts` flag. The module now depends on `admin_roles`, whose permission service answers that question. The permission's label is now _View notifications sent to all admins_.
  - `@endora-commerce/admin-shell`: the header shows the notification bell to every administrator while the Admin notifications module is on.
  - `@endora-commerce/mod-i18n`: the English and Polish labels of `admin:read` follow the new meaning.
  - `@endora-commerce/mod-tasks`: the module page says that every administrator reads their own notifications without a permission.

- 8eb0fcb: The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- df95f59: The manifests now declare the refusal tokens of every error code they raise with a computed `details.code`. `mod-tasks` declares `TASK_WORKFLOW_INVALID`'s ten rule tokens and `TASK_STATUS_IN_USE_TOO_MANY`'s `priority`; `mod-custom-fields` (`CUSTOM_FIELD_OPTION_IN_USE`, `CUSTOM_FIELD_STORED_VALUES_EXIST`, `CUSTOM_FIELD_VALUE_TYPE_LOCKED`), `mod-document-templates` (`DOCUMENT_TEMPLATE_INVALID`) and `mod-projects` (`PROJECT_MOVE_NOT_PERMITTED`) declare `tokens: []`, stating that those raises never carry a token. Every token already had its sentence in English and Polish, so no rendered message changes.
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
