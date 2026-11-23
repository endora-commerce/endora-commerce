# @endora-commerce/mod-crm

## 0.112.0

### Minor Changes

- 074f500: Admin zone contributions now choose a tab or a sidebar by naming the zone for that place (issues #1452 and #1526). Four zones are new: `organization.detail.sales` is the body of the organization's Sales tab, after the sales representatives, and carries `{ organizationId }` with no save session; `order.detail.sidebar`, `quote_request.detail.sidebar` and `opportunity.detail.sidebar` are sidebar cards, and each contribution is a section of the card. The order and quote request screens draw their sidebar only while something fills it. The organization's Sales tab is shown to someone who may assign sales representatives or who sees one of its panels. CRM opportunities and projects moved from the organization's Commerce tab to its Sales tab. The linked opportunity, the project and the tasks moved from the end of the order, quote request and opportunity screens into their sidebars. No zone was removed or renamed: contributions to the `.detail.after` zones keep working unchanged.
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

- f915a24: Saved views on the CRM Opportunities page and the Projects list (issue #1734), on the same rules as the order, quote request, return and task lists (`specs/147-saved-views/`).

  - `@endora-commerce/contracts` exports `createOpportunitySavedViewRequestSchema`, `updateOpportunitySavedViewRequestSchema`, `createProjectSavedViewRequestSchema` and `updateProjectSavedViewRequestSchema` (with their `Create…`/`Update…` types): `{ name, shared, filters, sort? }`; `visibleColumns` is stripped, since neither list has a column picker. Two error codes join `ERROR_CODES`: `CRM_SAVED_VIEW_NAME_TAKEN` and `PROJECT_SAVED_VIEW_NAME_TAKEN` (the latter also in `PROJECTS_ERROR_CODES`).
  - `@endora-commerce/mod-crm` adds `GET`, `POST /api/v1/admin/crm/opportunities/list-views` and `PATCH`, `DELETE …/list-views/:id` (`crm:read`), a `crm_opportunity_list_saved_views` table, and the kit's saved-views control on the list and the board. One view serves both: it stores every filter of the page and the list's sort, never the view.
  - `@endora-commerce/mod-projects` adds `GET`, `POST /api/v1/admin/projects/list-views` and `PATCH`, `DELETE …/list-views/:id` (`projects:read`), a `project_list_saved_views` table, and the control on the Projects list.

  Run the migrations: each module brings one new table and touches no existing one.

- 398e6d2: Record-tab zones: a module can add a whole tab — a label, an optional count and a panel — to another module's record tab strip. `@endora-commerce/contracts` adds the zone `opportunity.detail.tabs` (props `OpportunityDetailZoneProps`), `RECORD_TAB_ZONE_NAMES` with `RecordTabZoneName` and `isRecordTabZoneName`, `RecordTabDeclarationSchema`, an optional `tab` on a zone contribution (required on a record-tab zone, refused on every other one) and the TypeScript-only `count` factory (`AdminCountFactory`). `@endora-commerce/admin-kit` adds `recordTabComponent()` on `./contributions`, which takes only a record-tab zone and type-checks the panel and the count loader (`RecordTabCounter`) against the zone's props, and `useRecordTabZone()` on `./zones`, which returns the visible contributed tabs with their labels and counts and renders the selected panel; `zoneComponent()` now refuses a record-tab zone at compile time. The CRM opportunity screen renders `opportunity.detail.tabs` after its _Events_ tab and selects a contributed tab from `?tab=<id>`. The Tasks module's panel on an opportunity left `opportunity.detail.sidebar` and is now a _Tasks_ tab (`?tab=tasks`) on `opportunity.detail.tabs`, whose count is the open linked Tasks; the order and quote-request sidebars keep their _Tasks_ sections. `check:admin-zones` reads `useRecordTabZone('<zone>', …)` as a render site and `recordTabComponent('<zone>', …)` as a contribution.

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
- 3dab0be: The Notes, Messages, Attachments and Change history tabs of an opportunity and a project no longer explain how they work (issue #1487). Notes and Messages say one line, "Internal. Customers never see this.", and the message composer says "Cannot be edited after sending." under the field. The Attachments and Change history tabs open straight on their content. English and Polish both change.

  Removed bundle keys: `attachments.hint` and `history.hint` in CRM, `attachments.hint` and `changeHistory.hint` in Projects. New key in both: `comments.messages.composerHint`.

  In the admin kit, `CommentThreadCopy` takes an optional `composerHint`, a line under the composer that describes the field (`aria-describedby`). `CommentComposer` takes the matching `hint`. `RecordHistoryCopy.hint` is now optional, and no paragraph is drawn without it.

- 45fd8dc: More admin screens show an action's result beside the control that caused it, not as a success banner (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a banner, and an error clears the result.

  - Organization detail, moderation: "Organization approved", "blocked" and the other transitions appear beside the moderation buttons.
  - Organization detail, hierarchy: "Organization parent updated" appears under the parent picker.
  - Organization detail, VAT validation: the outcome appears beside "Validate now". Only a validated identifier is shown as a success; format-only and deferred validations are a warning, a rejected identifier is shown in the error colour.
  - Organization detail, roles: a created, saved or deleted role is reported beside the Create role button in the tab's header. Opening the editor or a delete clears it.
  - CRM opportunity: coming back from creating an order or a quote request, the linking progress and its result appear beside the Create button that started it, instead of a banner under the section heading. A document that was created but not linked is a warning, with its link.
  - CMS brand settings: "Brand settings saved" and "The channel follows the global brand settings again" appear beside Save in the page header. The next edit, a channel switch or starting an override clears it.

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

- e6a14bf: The opportunity screen says its status once, in the badge beside the title (issues #1561, #1566). The stage bar no longer has a _Current status_ block: it shows only the moves, under _Move to…_, and a closed opportunity still says how and when it closed. The optional reason of a move is folded behind an _Add a reason_ button: opening it focuses the field, the next move sends the reason, and the field folds again. Folding it by hand drops what was typed. In the sidebar, a computed value's one-line hint links to the statuses that count (`/crm/workflow#value-counting`) for a holder of `crm:configure`. The translation key `opportunity.stage.current` is removed; `opportunity.stage.heading`, `opportunity.status.addReason` and `value.hint.configure` are new.
- 9868c7c: The admin dictionary screens put their _Add_ in one place, the page header (issue #1562, UX audit WORK-13).

  - **Tasks › Tags** and **Tasks › Priorities**: _Add tag_ / _Add priority_ is the filled button in the page header instead of an outline button in a card header, and the card title that repeated the page title ("Tags", "Priorities") is gone. The count column now reads "Tasks (visible to you)", as does the workflow screen's status count, because the server counts only the Tasks the operator can see. A row's delete button is drawn in the destructive tone.
  - **CRM › Tags**: the empty list shows the admin's empty state (icon, title, one line, _Add tag_), and the header's _Add tag_ is hidden while the list is empty, so the screen has one primary action. The count column reads "Opportunities (visible to you)".
  - **Projects › Roles** and **Loss reasons**: the same empty state with its _Add_ replaces the bare "Nothing to show.", and the header's _Add_ is hidden while the dictionary is empty.
  - **Dictionaries** (Countries, Currencies, Languages): the active tab's _Add country_ / _Add currency_ / _Add language_ moves from the tab's card into the page header, opens the editor and moves focus to its code field. The card no longer repeats the tab's name above the table; the table is named by it. The empty state carries the _Add_ while a dictionary is empty. A row's _Edit_, _Set default_ and red _Delete_ buttons become one row menu, "Actions for PL", with _Delete_ last; on the default row _Delete_ and _Set default_ are disabled and _Delete_ says why.

  The i18n keys `tags.list.title` and `priorities.list.title` (tasks) and `dictionary.empty` (projects) are removed. The CRM `tags.empty` is now a short title, with the sentence moved to the new `tags.emptyBody`. The API is unchanged.

- 6735d52: My Tasks opens with the list (issue #1563): the daily digest setting is a closed disclosure in the page header that says its state ("Daily digest: off" / "Daily digest: on, 08:00") and opens the same control below the header. The `DigestControl` component is replaced by the `useDigestDisclosure()` hook, which returns the header `trigger` and the `panel`.

  The task, opportunity, project and project-template create forms mark required fields through the kit's `FormField` — an asterisk and `aria-required` — with their hints and errors linked to the field (issue #1564). On the new-project form the template choice is the first field of the first card instead of a card of its own. The CRM lookup pickers accept `ariaDescribedBy` and `invalid`.

- 820f089: The admin kit exports `formatDate(value, language)`, and `formatDateTime(iso, language)` takes the admin UI language: a medium date, and a moment as that date with the short time, never the browser's locale (UX audit #1567). The Opportunity sidebar's deadline and Record dates, the Projects date labels (the Project panel's Stage deadline among them) and the Tasks date labels use them, so one screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`. On the Opportunity sidebar the value stays on one line and the value-mode switch sits below it instead of squeezing it to one character per line.
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

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 5fb3cd3: Six small Admin defects from the demo click-through are fixed (issue #1808).

  - The Inventory stock overview shows each product's name in the Product column, not its SKU.
  - Custom-field labels are shown in the admin's language. A host that does not set the language (order, customer and organization detail, among others) used to show a Polish operator the field's default label, which may be its code.
  - The "New channel" button no longer reads "+ + New channel". The blog category tree's "Add subcategory" button and the quote's "Add line" button show a plus icon instead of a typed "+".
  - On the opportunities list the two filters say what they filter: "Open and closed" (the outcome) and "All workflow statuses" (the stage in the workflow). The Number and Organization columns stay on one line; a long organization name is cut with an ellipsis.
  - The product editor's low-stock threshold placeholder reads "Inherited" and fits its input. The help text under it still explains the inheritance.
  - The newsletter subscriber search shows "Search by e-mail" in the box.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 79d15cf: The Admin UI has one, light theme (issue #1810). `@endora-commerce/admin-kit/theme.css` no longer declares the `.dark { --background: … }` token block: nothing applied it, and applied by hand it was incomplete, with a light page under dark cards and unreadable outline buttons. An instance that set `.dark` on an element by itself now gets the light tokens; to restyle the admin, redeclare the `:root` tokens instead.

  The `dark:` utilities are gone too: `Badge`'s `success` and `warning` variants, the `ScopedField` "unsaved" badge, the shell's not-found notice, and the amber and emerald notices and icons in the admin screens of admin users, catalog bulk operations, the page-builder translate action and header actions, CRM propagation outcomes, custom-field carry drift, document-template item tables, tax-ID scope, product feeds and settings. Without a `dark` variant definition, Tailwind 4 compiles `dark:` to `@media (prefers-color-scheme: dark)`, so on an operating system set to dark these elements turned dark on a light page. They now render the same on every system.

- 0e81803: The analytics screen helpers that CRM and Projects each kept a copy of now live in the admin kit
  (issue #464): `FigureCard`, `useFigure`, `useChartColors` and `prefersReducedMotion` from
  `@endora-commerce/admin-kit/components`, and the range presets (`RANGE_PRESETS`, `presetRange`,
  `isDayRange`, `DayRange`, `RangePreset`) from `@endora-commerce/admin-kit/lib`. `FigureCard`
  takes the module's error sentence as `errorFallback`, and an optional `footer` drawn under every
  answer. Both analytics screens use the kit copies and behave as before; Projects keeps its own
  wrapper for the period and counts line under each figure.
- 5e76569: The opportunity board-card editor keeps keyboard focus on the field being worked on after a move, a removal or an add, instead of dropping it to the page (WCAG 2.4.3). This matches the Tasks editor.
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

- 52831b7: The `crm_event_reminder` e-mail links into the admin panel (follow-up to issue #185). With
  `ADMIN_BASE_URL` set, it sends the new variable `event.adminUrl`. That is
  `<ADMIN_BASE_URL>/crm/opportunities/<opportunityId>?tab=events&event=<eventId>`, the address of
  the bell entry. The default template, in English and Polish, shows an **Open the event** /
  **Otwórz wydarzenie** button to it. With `ADMIN_BASE_URL` unset the variable is not sent and the
  button is left out. A relative or guessed link is never sent. A customised template that does
  not name `event.adminUrl` renders as before. The manifest declares the variable for the
  template editor.
- 65f7abc: Issue #455 — a Project's _Linked records_ tab and its link picker name each record's status the way the record's own module names it, in the reader's language, instead of showing the stored code (`new`, `proposal`, `Pending`).

  - **`@endora-commerce/contracts`** adds `statusName(code, language)` to `OpportunityReadPort` and `statusName(status, language)` to `QuoteRequestReadPort`, each answering a `Promise<string>`, and the optional `statusName` to `ProjectLinkSchema` beside `status`. A test double that implements either port in full needs the new method.
  - **`@endora-commerce/mod-crm`** implements `OpportunityReadPort.statusName` by its own rule: the configured name in that language, else the status's default name, else the code.
  - **`@endora-commerce/mod-quote-requests`** implements `QuoteRequestReadPort.statusName` in the wording its global-search results already use (a code outside the six statuses answers as it is), and each row of `GET /api/v1/admin/quote-requests` now also carries `statusName` in the response language.
  - **`@endora-commerce/mod-projects`** serves `statusName` on `GET` and `POST /api/v1/admin/projects/:id/links` (an Order's name from `orderReadPort.findStatusDefinition`), and the admin tab and picker show it.

  **On upgrade.** Nothing to migrate; `status` keeps answering the code.

- 1978586: Issue #470 (D-288) — a sales opportunity's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without organization reach, so a tenant's opportunity data no longer reaches it.

  - Every `crm.opportunity.*` Command now records the opportunity's number, status and other codes, the assignee and sales channel ids, dates, and `changedFields` / `changedCustomFields` (the sorted names of what changed). It no longer records the title, description, manual value, currency, contact person, organization, tag names, custom field values, a transition's or a skipped propagation's reason, an event's name or an attachment's file name.
  - Those values go to a new CRM-owned table, `crm_opportunity_value_changes` (`CrmOpportunityValueChange`, scoped through the opportunity, `on delete cascade`). The same Command writes it, so it commits or rolls back with the audit entry, and the entry points at the row by `valueChangeId`. The migration `Migration20261109T163616CrmOpportunityValueChanges` creates it.
  - `GET /api/v1/admin/crm/opportunities/:id/history` reads the values back from that table. It reads them by the opportunity's id, after the opportunity was loaded through the scoped EntityManager, and serves them in `before` / `after` in the shape the entries had before, so the response contract is unchanged. Custom field values, and now the names of changed custom fields, still go only to `custom_fields:read` holders.
  - `CRM_AUDIT_KEYS` is the allowlist of keys a `crm.opportunity.*` audit state may hold. The audit snapshot and every Command's recorded state are tested against it, with a sentinel test per Command.
  - Audit entries written before the upgrade are not rewritten.

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new CRM opportunity entries show field names instead of values. The opportunity's own **Change history** tab is unchanged. See _Opportunity values leave the platform audit log_ in the upgrade guide.

- 48b2505: CRM analytics count days and months in the reporting time zone (issue #474): the
  `analytics.reporting_time_zone` setting the `analytics` module owns, read through its
  `reportingTimeZonePort`. A range runs from midnight of its first day to midnight after its last,
  both in that zone, and the month a won opportunity is ranked in is that zone's month. The setting
  defaults to `UTC`, in which every figure is what it was before. While `analytics` is switched off
  the figures are counted in `UTC`; the manifest declares the new `degrades-without` edge on
  `analytics`.

  Every `GET /api/v1/admin/crm/analytics/*` answer adds `timeZone`, the zone it was counted in
  (issue #475), beside `data`. The analytics screen names that zone under its filters and takes the
  range presets (_This month_, …) from that zone's calendar instead of the browser's.

  Upgrading: an instance whose operator has set the reporting time zone to anything but `UTC` sees
  CRM figures counted in that zone from this release on.

- ef9630f: Attaching a library file that is not private to an Opportunity has an error code of its own instead
  of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #639, part of #86). **A caller
  that matches on `VALIDATION_FAILED` for this refusal now sees `CRM_ATTACHMENT_NOT_PRIVATE`.** The
  HTTP status is unchanged. Until now it was answered with an English sentence in every language,
  because the error envelope never replaces the message of `VALIDATION_FAILED`.

  | Route                                                  | Was                                                                                                           | Is                               | `details`               |
  | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- |
  | `POST /api/v1/admin/crm/opportunities/:id/attachments` | `422 VALIDATION_FAILED`, _"An attachment must be a private file. Upload it to the media library as private."_ | `422 CRM_ATTACHMENT_NOT_PRIVATE` | `assetId`, `visibility` |

  The code is named in parallel with `projects`' `PROJECT_ATTACHMENT_NOT_PRIVATE` (issue #634), as
  `CRM_ATTACHMENT_TOO_LARGE` and `PROJECT_ATTACHMENT_TOO_LARGE` are. A file that is not in the media
  library, or that the caller may not see, stays `422 VALIDATION_FAILED`, and so does an Event reminder
  set in the past (`details.rule: 'reminder_in_past'`), which the event form words from its rule. The
  code is a member of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `crm` manifest, and
  the module's documentation page names it. No setting, permission or migration changes.

- 42a9a4b: One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

  `mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

  **Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in _Upgrading an instance_ ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.

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
- 38f8f5b: The unread-message count of a Sales Opportunity now counts exactly the messages the _Messages_ tab lists: a message row marked deleted is no longer counted, and a read marker older than the instant unread messages started being counted no longer makes the messages before that instant unread again, so marking messages read only ever lowers the number (issue #222).
- 54ae028: The permission inventory scanner (`scanEnforcedPermissionGates`) now reads
  `hasAnyPermission(['a', 'b'])` as one gate site that carries every code in the array, in the same
  way as `requireAdminAny([...])` (issue #458). It reads an array argument only up to the array's
  closing bracket. If code after the array narrows it at runtime, as in `['a', 'b'].filter(f)`, the
  scanner still reads `a` and `b`, and ignores any string in the narrowing. The `@@` document-list
  gate in CRM and in Projects now uses `hasAnyPermission`, so the scanner checks all four codes in
  each gate. Before, it marked them as runtime values and did not check them. Who can open the
  `@@` list does not change.
- 6bfd758: `@@` in an Opportunity's or a Project's text now opens the document list for a role that holds only the module's own codes (issue #498). `useCrmReferences` offers the `document` trigger to a `crm:write` holder whose role includes `crm:read`, and `useProjectReferences` to a `projects:write` holder whose role includes `projects:read`, because `GET /crm/lookups/documents` and `GET /projects/lookups/documents` already answer the module's own group (Opportunities, Projects) to every writer. Before, such a role kept `@@` as the characters it typed and was shown no _Insert document_ button, although the server had a group to offer it. A Projects group with nothing in it is an empty list, not a reason to hide `@@`. No API change.
- 939c455: The attachment lists of Tasks, Projects and CRM Opportunities resolve every file's download link in one batched `assetReadPort.resolveUrls` read instead of one `assetsLibraryPort.getAsset` call per file (issue #545). The full asset detail asked every registered asset-reference descriptor about each attached file, so a list of N files issued about 12 × N reference statements. The links are unchanged: the same signed, expiring URL for a private file, with `download=1`. A host that composes these services itself must provide `resolveUrls` on the `assets` dependency (it is part of the published `AssetReadPort`).
- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 93146d1: Resolving the references in a text no longer reads the reader's administrator record when the text mentions a Product (issue #963). The reference services of `crm`, `tasks` and `projects` still looked up the reader's preferred language and then discarded it, a leftover from per-locale product names: a Product is named by its single Global `name`. The labels shown do not change.
- 4933779: The module's documentation page no longer lists global search among what the module does not do (opportunities are searched since the admin-search provider was added), names `findByIds` and `search` on `OpportunityReadPort`, and words a sales representative's view of opportunities and the Calendar by the organizations they reach. It says that CRM has no time-zone setting for events, rather than that the platform has none. English and Polish.
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

- 5303aab: The opportunity board never offers a `page_builder` custom-field definition as a card field (`specs/172-product-content-attributes/`). No behaviour change today: the type is admissible on products only.
- 3f020ba: Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
- 0dc1e3f: An Order that joins the Opportunity of its Quote Request now locks the Opportunity before it carries custom-field values into it, and bumps the Opportunity's version when it carries any. A concurrent edit of the Opportunity's custom fields is no longer overwritten, and a client holding the previous version is told it is stale.
- f37b9e4: A custom-field carry into a Sales Opportunity that fails no longer stops the Opportunity from being created for a placed Order or Quote Request, or an Order from joining the Opportunity of its Quote Request. The Opportunity is created or joined without the carried values, and the operator's log names the document that did not carry, as the carry into a document created from an Opportunity already did.
- ff60e93: A linked quote request's value, and its share of a computed opportunity value, is now the amount `quoteRequestReadPort.amountOf` publishes (issue #456). CRM no longer values the lines itself.
  - A linked quote request carries `agreement`, and is marked "Partially agreed" or "Not yet agreed" on the opportunity's links and in the value panel.
  - A quote request without any price has no `total` and adds nothing.
  - A quote request whose currency differs from the opportunity's is now left out as a whole, rather than counting its lines in the opportunity's currency.
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
- b3ec2a8: The refusal of an Opportunity or Project attachment that a browser would open and run (HTML, SVG,
  XML, JavaScript) now has its own sentence in English and Polish. Before, the error envelope
  answered the asset library's generic "Files of this type cannot be uploaded to the asset library",
  which named the wrong place and none of the refused types (issue #623).

  The code and status are unchanged (`415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`); **`details` gained
  `code: 'attachment_active_content'`**, so a client that compares `details` for equality will see
  it. The sentence lives in `@endora-commerce/mod-assets-library`'s bundle, which owns the code:
  "HTML, SVG, XML and JavaScript files cannot be attachments: a browser would open and run them." /
  "Pliki HTML, SVG, XML i JavaScript nie mogą być załącznikami: przeglądarka by je otworzyła i
  uruchomiła." The thrower's English message is the same sentence.

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

- 4bc5c7f: Opportunity attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Opportunities a reader may not see — those outside their Organization reach, or every one without `crm:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/crm/opportunities/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the existing refusals.
- 55864a1: Opportunities can refer to Opportunities and Projects (`specs/165-task-management/` R-5).

  - Migration `crm_opportunity_reference_kinds` widens `crm_opportunity_references_target_type_check` to the seven reference kinds; its `down` restores the five.
  - An Opportunity's description and notes resolve `[[opportunity:…]]` and `[[project:…]]` references per reader, and the `@@` list offers Opportunities and Projects when their module is on and the reader may read them. A referenced Project shows as unavailable while Projects is off.
  - `opportunityReadPort` gains `findByIds` and `search`.
  - The tag picker and the board's _Move to…_ menu now come from `@endora-commerce/admin-kit`; nothing changes for the user.

- b8b6eed: An Opportunity's texts follow the reference standard shared with Projects: `@@` is one document
  list — Orders · Quote requests · Tasks — and a Quote Request or a Task can be referred to in the
  description, a note or a message. The Opportunity's screens are drawn with the admin kit's
  collaboration components, and the screen ends with a zone other modules can fill.

  **`@endora-commerce/mod-crm`**:

  - **`@@` opens the document list**, where it searched the Organization's Orders alone. _Insert
    document_ replaces _Insert order_. Orders and Quote Requests are the Opportunity's
    Organization's (on the create form, the Organization chosen there); Tasks are any the reader
    may see. Each group is offered only to a holder of `orders:read`, `rfqs:handle` or `tasks:read`
    respectively, and only while its module is on; a role holding none of the three keeps `@@` as
    typed.
  - **`[[quote_request:<uuid>]]` and `[[task:<uuid>]]` are stored and resolved** like the other
    three types: `references` names a Quote Request by its number (`/quote-requests/<id>`) and a
    Task by its number (`/tasks/<id>`), and answers `available: false` without a label for a reader
    without `rfqs:handle` / `tasks:read`, for a Task its context hides, for a target that is gone,
    and while Quote Requests / Tasks are switched off. Texts stored before are unchanged byte for
    byte, and read as they did.
  - New route `GET /api/v1/admin/crm/lookups/documents?opportunityId=…&q=…` (`crm:write`; or
    `organizationId=…` before the Opportunity exists) answering `RecordDocumentLookupResponse`, at
    most ten documents per group — the shape Projects serves at `GET /projects/lookups/documents`.
  - New migration `crm_opportunity_reference_documents`: the `crm_opportunity_references`
    target-type check admits `quote_request` and `task`. Its `down` deletes the rows of those two
    types first; the texts keep their tokens.
  - A new `degrades-without` edge on `tasks` (`taskReadPort`): with Tasks off or absent, Task
    references read as unavailable and Tasks are not offered after `@@`. Tasks stays switchable
    while CRM is on.
  - Notes, messages, references, attachments, the change history and the list pager are drawn with
    the `@endora-commerce/admin-kit/components` collaboration components; apart from `@@` above,
    what these screens show and do is unchanged. The package no longer declares `@tiptap/react` or
    `@tiptap/starter-kit` — the editor is the kit's. A chip's token attribute is now
    `data-reference-token` (was `data-crm-token`), and an Order chip's `data-order-reference` (was
    `data-crm-order-reference`); a chip copied from the earlier editor still pastes as a chip.
  - The Opportunity's screen mounts the `opportunity.detail.after` zone once, after the card
    holding its tabs, handing over the Opportunity's id and nothing else. With nobody contributing
    — no module, one that is switched off, or a person without the contribution's permission — the
    screen is unchanged. CRM names no contributor; the first is the Projects module's _Project_
    panel.

  **`@endora-commerce/contracts`**:

  - `OpportunityDocumentLookupQuerySchema` (`opportunityId?`, `organizationId?`, `q?`) and its type,
    the query of the new route; the answer is `RecordDocumentLookupResponseSchema`.
  - `AdminZoneNameSchema` gains `'opportunity.detail.after'`, with its props
    `OpportunityDetailZoneProps { opportunityId }` in `AdminZonePropsMap`. A consumer that switches
    exhaustively over `AdminZoneName` gets a compile error until it handles the new member.

### Patch Changes

- 77c01b1: The opportunity board no longer loses a filter when two of them change in the same moment. Two filter boxes whose typing pause ended together — two different fields, or the lowest and the highest of one field — each started from the address of the last render, so the second wrote over the first and only one reached the server and the address. Every change to the board's filters is now applied to the filters as they stand, and a field's filter is merged into the one the board holds, not the one its box was last given.
- bd7968e: Every sidebar screen of these eight modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords. Each action carries the permission code of the screen it opens, so the palette never offers a screen the operator is refused.

  - `@endora-commerce/mod-catalog` declares `open-attribute-sets`, `open-attachment-types` and `open-bulk-operations` (`catalog:read`).
  - `@endora-commerce/mod-crm` declares `open-crm-tags` and `open-crm-workflow` (`crm:configure`).
  - `@endora-commerce/mod-inventory` declares `open-warehouses`, `open-low-stock` and `open-stock-notifications` (`inventory:read`), and `import-stock` (`inventory:write`).
  - `@endora-commerce/mod-newsletter` declares `open-newsletter-tags` and `open-newsletter-blocks` (`newsletter:read`), and `open-newsletter-provider` (`newsletter:write`).
  - `@endora-commerce/mod-orders` declares `new-order` for the order-entry form (`orders:write`).
  - `@endora-commerce/mod-projects` declares `open-project-roles` and `open-project-loss-reasons` (`projects:configure`).
  - `@endora-commerce/mod-promotions` declares `open-promotion-rules` (`promotions:read`).
  - `@endora-commerce/mod-settings` declares `open-setting-groups` (`settings:read`) and `clear-cache` (`settings:write`).

- 8eb0fcb: The command-palette actions of the work-management modules (`crm`, `projects`, `tasks`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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

- bc1b52c: **Behaviour change for API clients.** On `GET /api/v1/admin/crm/opportunities` without `cardValues=true`, a `custom:` reference in `fieldFilters` is now governed by the custom-field definition's list-filter option instead of the board card: a field with the option on is filtered whether or not the card shows it, and a field with the option off is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it. More than 10 `custom:` references or 100 chosen values in total are refused with 400 `VALIDATION_FAILED`. An operator that does not apply to a field's type, or an inverted range (a minimum above its maximum, a start date after its end), is refused with 400 `VALIDATION_FAILED` rather than ignored or answered empty. `builtin:` references keep the card rule. With `cardValues=true` (a board lane continued in the list) and on `GET /api/v1/admin/crm/board` nothing changes.

  `GET /api/v1/admin/crm/opportunities/custom-field-filters` (`crm:read`) lists the Opportunity custom fields the list offers as filters.

- 7995063: Custom-field filters on the Opportunities list, governed by the list-filter option.

  - The list offers one filter per Opportunity custom field whose _Use as list filter_ option is
    on — whether or not the board card shows the field — beside its existing filters.
  - A filter is sent as a `custom:<key>` reference in `fieldFilters`, never with `cardValues`, so
    the list-filter rule applies; any change returns the list to its first page.
  - The filters live in the address as `cf.<key>.<op>`, so a filtered list can be bookmarked and
    shared.
  - A filter that is no longer available is reported by the field's name, with _Remove this
    filter_.
  - The panel shows the first three custom-field filters and puts the rest behind _More filters
    (n)_; a hidden field with an active filter is always shown.
  - The board, its card-field filters and its lanes are unchanged.

- cf7a9c0: The Opportunity screen is edited in place, its free text is formatted, and an Order reference says what the Order is.

  - **Inline editing.** The header's _Edit_ and its form are gone: the title, the description, the expected close date, the contact person, the Sales Channel and a typed value are each edited where they are shown, with _Save_ and _Cancel_. A save sends that field alone under `If-Match`; on `409 VERSION_CONFLICT` the newer Opportunity is shown and the draft kept.
  - **Formatted text (WYSIWYG).** Descriptions, notes, messages and Event descriptions are written in a TipTap editor with a toolbar (bold, italic, strikethrough, lists, links) and keep the `@`, `@@` and `@@@` reference shortcuts. What is stored is the text grammar of `@endora-commerce/contracts` — no HTML. **New optional peer dependencies `@tiptap/react` and `@tiptap/starter-kit` (`^3`)** for the admin layer; the admin application already carries them.
  - **Order references** show the status, total, date and customer, open the Order with a way back to the Opportunity, and have a button that opens it in a new tab. Every link from an Opportunity to an Order or a Quote Request carries `?returnTo=`.
  - Admin API: an Order reference in `references[]` carries `order` (see `@endora-commerce/contracts`).

- b0e1abd: A custom-field value that was not carried is recorded with the field's label, so its history line can name the field.

  - **`customFieldCarryPort`** names every skipped key with the **source** definition's label as
    it reads at that moment — `label: { labelDefault, labels }` — a `target_missing` skip
    included.
  - **Records keep the label.** The Order system note (`systemNote.skipped`), the Quote Request
    `custom-field-carry-skipped` event and its `custom_field_carry_skipped` history entry, and the
    Sales Opportunity audit member `customFieldCarry.skipped` store each skip's label next to its
    key and reason. It is a snapshot: renaming the field later does not change history. Skips
    recorded earlier have no label and read as before.
  - An administrator who cannot read custom-field definitions can now be shown which field was
    not carried and why. The values themselves stay visible only to readers with
    `custom_fields:read`.

- 96c07f5: Sales Opportunities created for, or joined by, an Order or a Quote Request receive the document's carried custom-field values.

  - **On automatic creation.** An Opportunity created for a placed Order or a submitted Quote
    Request receives every value whose Order or Quote Request definition carries to Opportunities.
    The values are stored by the `crm.opportunity.create` Command, run on the system's behalf, and
    are not re-validated against the Opportunity's other fields, so a required field cannot stop
    the creation.
  - **On joining.** An Order placed from a Quote Request linked to an Opportunity carries its values
    into that Opportunity's **empty** fields inside the `crm.opportunity.link_add` Command; a value
    the Opportunity already holds is kept. An operator's manual link and an origin link carry
    nothing into the Opportunity.
  - **History.** When anything was carried or skipped, the creation or link entry's `after` gains
    `customFieldCarry: { source: { entityType, recordId }, carried, skipped }` (each skipped key
    with its reason), and the link entry gains `customFieldValues` when values were carried. These
    entries are what `GET /api/v1/admin/crm/opportunities/:id/history` returns.
  - **From an Opportunity into its documents.** Once an Order or a Quote Request an administrator
    created from an Opportunity is linked to it, the Opportunity's values are pushed to the
    document's owner (`orderCustomFieldCarryPort`, `quoteRequestCustomFieldCarryPort`), which carries
    them into empty fields and records what it skipped on the document. Only a link just made
    carries; a refused origin carries nothing. The Quote Request receiver is reached only while
    `quote_requests` is present — a new `degrades-without` entry for
    `quoteRequestCustomFieldCarryPort` in the manifest.
  - `OpportunityOriginLinkServiceDeps` gains the required `carryIntoDocument`.
  - `OpportunityServiceDeps` and `OpportunityLinkServiceDeps` gain the required `customFieldCarry`
    (`CustomFieldCarryPort`); `AutomaticOpportunityInput` and `AutomaticLink` gain an optional
    `carry`.

### Patch Changes

- ee26beb: Documentation for custom-field list filters, in English and Polish.

  - `@endora-commerce/mod-custom-fields` ships its first documentation page: the records that take
    custom fields, creating and editing a field and the limits of editing, the _Use as list
    filter_ option, how each type filters, and the list APIs.
  - The `orders`, `quote_requests` and `crm` pages describe the custom-field filters on their admin
    lists. The `quote_requests` page also says that its fields follow the module's activation. The
    `crm` page explains how the Opportunities list's filters differ from the board's card-field
    filters.

- cec838d: The opportunity's _Change history_ labels the `customFieldCarry` member of a creation or a join: which kind of record the values came from and one line per key not carried with its reason, the field named by the label stored with the skip, for every reader of the opportunity. A reason the screen has no sentence for reads "the value could not be carried", never its code. A carry that skipped nothing adds no row.
- 6f1e0ec: **Behaviour change for API clients — an Opportunity's change history serves custom-field values only to `custom_fields:read`.** `GET /api/v1/admin/crm/opportunities/:id/history` now leaves `customFieldValues` out of every entry's `before` and `after` for a caller who holds `crm:read` without `custom_fields:read` (the `requires` of `crm:read` is advisory, so such a role exists); the rest of each entry is unchanged, and `after.customFieldCarry` — keys, reasons and labels, never a value — is still served to every reader. Decided server-side, once per page, through `OwnerReadChecks.customFields`, a new member of that interface. A carry into a document created from an Opportunity that throws after the link has committed is now written to the log as a warning, with the document and the Opportunity, instead of reaching the event subscriber.
- 8f08235: The opportunity's _Change history_ follows the server's custom-field rule on screen too. For a reader without `custom_fields:read` it shows no _Custom fields_ row, even if a response still carries values, and reads no field definitions. An edit whose only change was custom-field values no longer stands empty under its heading: it says "Custom field values changed. Your role does not give access to them." („Zmieniono wartości pól niestandardowych. Twoja rola nie daje do nich dostępu.").
- 108955f: The formatted text field no longer throws `[tiptap error]: The editor view is not available` when React runs its effects with an editor the editor hook has already destroyed — effects reconnected after a lazy tab is revealed or a Suspense boundary resolves. Every effect that touches the editor's view now waits for the editor that replaces it.
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

### Patch Changes

- 2933bf0: `@endora-commerce/admin-kit/components` publishes two new components. `ModalDialog` (with `ModalDialogProps`) is the dialog primitive `crm` used to keep to itself: a titled panel over a scrim with an accessible name, a focus trap, Escape and scrim to close, and a `busy` flag that makes both inert. It gains two optional props, `initialFocusRef` (focused on open instead of the first focusable element) and `finalFocusRef` (focused after close instead of the opener, read at close time); without them it behaves as before. `useFocusTrap` accepts the same two refs through a new optional third argument (`FocusTrapOptions`). `SavedViewsControl` (with `SavedViewsControlProps` and `SavedViewState`) is the saved-views selector with _Save view_ and _Delete view_, both through dialogs rather than the browser's native prompts: the caller passes the list's saved-view endpoint, its current state and an `onApply` callback, and the control lists, creates and deletes views through the kit's `apiClient`. A name the server refuses as taken (`409`) is shown in the save dialog with the name field marked invalid until the next keystroke. It never sends an update.

  `crm` imports `ModalDialog` from the kit instead of its own copy, which is deleted. No behaviour changes.

  The `core` bundle gains eighteen `savedViews.*` keys in English and Polish — the copy `SavedViewsControl` and its dialogs render.

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

### Minor Changes

- 60cfd18: The tabs of an Opportunity say how much is behind them. _Notes_ and _Attachments_ show their number
  of items, as _Links_ already did; _Events_ keeps the number of Events that have not ended yet; and
  _Messages_ shows how many messages the signed-in administrator has not read. A tab with nothing
  behind it shows no number. Each number is read aloud with what it counts — "Notes, items: 3",
  "Events, upcoming: 2", "Messages, unread: 1" — and follows a change made on its own tab without a
  reload of the page.

  Unread messages are counted per administrator: a message somebody else wrote after the point you
  have read up to. Opening the _Messages_ tab reads them, for a holder of `crm:read` alone as well,
  and one administrator's reading changes nothing for another. Reading is not a change to the
  Opportunity and leaves nothing in its change history.

  `OpportunityDetail` (`GET /api/v1/admin/crm/opportunities/:id`, and every answer that carries the
  Opportunity) gains three members: `noteCount`, `attachmentCount` and `unreadMessageCount`. One new
  route, `POST /api/v1/admin/crm/opportunities/:id/messages/read` with `{ throughMessageId }`, gated
  `crm:read`, answers `{ unreadMessageCount }`. `upcomingEventCount` is unchanged.

  One migration, `20261009T163307_crm_opportunity_message_reads`, creates
  `crm_opportunity_message_reads` and `crm_message_read_baselines`. It records the instant it ran, and
  messages written before it are unread for nobody — so an upgrade does not hand every administrator
  every existing conversation to catch up on. No new permission and no new Setting.

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

- 34fe84f: A scheduled tick that finds nothing to do no longer writes a `tenant.escape_hatch` audit row. Four
  repeating jobs entered a system scope on every tick, and each entry is one row in
  `audit_log_entries` because ticks are further apart than the audit writer's ten-second aggregation
  window: the order follow-up sweep and the CRM event reminders (every 60 seconds, 1,440 rows a day
  each), the product feed stale-claim reaper and the price list status sweep (every 5 minutes, 288 a
  day each) — on an instance where none of them did anything.

  Each now asks first whether a pass would do anything, with a statement that runs outside any scope
  and returns one boolean and nothing else, and enters the system scope only when the answer is yes.
  A tick with work is recorded exactly as before. A question that fails counts as yes, so a failing
  probe can cost an audit row and never save one. Every probe goes through one helper,
  `anyRowExists` (`services/scheduled-work-probe.ts`, an identical file in each of the four modules),
  which builds the `select exists(…)` itself and returns a boolean, so a probe has no select list to
  widen. In `mod-orders`, `mod-crm` and `mod-product-feeds` the probe and the pass read the same
  statement of each condition, so the question cannot become narrower than the work. The rule is written down in
  `docs/docs/architecture/tenant-scoping.md` § _A scheduled tick with nothing to do enters no scope_.

  Not changed: the rows a process writes while it starts (`boot: …`), and the search reindex timer,
  which reads a setting before it can know whether it has work.

  For code that builds these consumers itself — inside 0.x, and nothing in the published surface of
  `@endora-commerce/platform` moves:

  - `mod-orders`: `TransitionEffectSweepDeps.effects` also needs `hasSweepWork`; new
    `OrderTransitionEffectService.hasSweepWork()` and `runTransitionEffectSweepTick()`.
  - `mod-crm`: `startEventReminders()` also takes `isPresent` and `hasWork`; new
    `EventReminderService.hasSweepWork()` and `runEventReminderJob()`.
  - `mod-product-feeds`: `createFeedReaperWorker(redis, hasWork, processor)` takes the question as its
    second argument; new `FeedRunReaperService.hasClaimedRuns()`, `runFeedReaperJob()` and
    `runFeedRunReaperTick()`.
  - `mod-price-lists`: new `PriceListStatusWorker.hasDueTransitions()` and `statusSweepTick()`.

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

### Minor Changes

- d5ab69f: An operator chooses which fields a card on the Opportunity board shows, and the board is
  filtered by the fields its cards show. Additive: an instance nobody configures shows the card
  it showed before.

  **`@endora-commerce/mod-crm`.** A new Setting, `crm.board_card_fields` — a JSON array of field
  references, platform-wide, defaulting to the card as it was (`builtin:number`,
  `builtin:organization`, `builtin:value`, `builtin:assignee`, `builtin:tags`). It is edited in
  the new _Board card_ section of **CRM → Workflow**, which the board links to for a holder of
  `crm:configure`. A field is `builtin:<key>` or `custom:<definition key>`; a custom field
  whose definition is deleted drops out of the cards, the filters and the section without an
  error. At most six fields are shown, the title besides.

  - `GET /api/v1/admin/crm/board/card-fields` (`crm:read`) answers `{ fields, available,
maxFields }`; `PUT` on the same path (`crm:configure`) takes `{ fields: string[] }` and
    answers the same.
  - `GET /api/v1/admin/crm/board` answers `cardFields` beside `columns`, and every card carries
    `cardValues` — the values of the chosen fields a summary does not already hold, keyed by
    reference, and of no other field.
  - `GET /api/v1/admin/crm/board` and `GET /api/v1/admin/crm/opportunities` accept
    `fieldFilters`, a URL-encoded JSON object of operators per field reference (`contains`,
    `in`, `is`, `min`, `max`, `from`, `to`). A reference that is not on the card is ignored. The
    list also accepts `cardValues=true`.
  - The board's filters are now carried in its address (`/crm/board?assignee=me&f.custom:lead_source.in=referral`),
    so a filtered board can be reloaded and shared.

  The module now resolves two more ports, both of owners it already depends on:
  `customFieldDefinitionReadPort` (`custom_fields`) and `settingsAdminService` (`settings`).

  **`@endora-commerce/contracts`.** New exports: `OPPORTUNITY_BOARD_CARD_MAX_FIELDS`,
  `OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS`, `OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS`,
  `opportunityBoardFieldRefSchema`, `opportunityBoardFieldKindSchema`,
  `OpportunityBoardCardFieldSchema`, `SetOpportunityBoardCardFieldsRequestSchema`,
  `OpportunityBoardCardConfigSchema` (and its response envelope), `OpportunityFieldFilterSchema`,
  `OpportunityFieldFiltersSchema` and their inferred types. `OpportunityBoardSchema` gains the
  required member `cardFields`; `OpportunitySummarySchema` gains the optional `cardValues`;
  `OpportunityListQuerySchema` and `OpportunityBoardQuerySchema` gain the optional `fieldFilters`
  (parsed from its JSON text) and the list query the optional `cardValues`.

- eb04e42: Events on a Sales Opportunity, their reminders, and a CRM Calendar (User Stories 21 and 22).
  The module's page — `docs/crm.md`, sections _Events and reminders_ and _The calendar_ — is the
  full description; this is what an upgrader and an integrator need.

  **What installing this version does.**

  - **One new table, `crm_opportunity_events`** — the module's fourteenth, created by its fourth
    migration (`20261008T135701_crm_opportunity_events`). Run the migrations. An Event belongs to
    one Opportunity, is deleted with it, and carries no organization of its own.
  - **One new hard dependency: `transactional_emails`**, beside the existing ones. It owns the
    sender the reminder e-mail goes out through and the registry its default subject and body are
    pushed into. That module cannot be switched off, so the edge holds no operator's switch.
    `admin_notifications` stays a dependency the module degrades without; `auth`, already a
    dependency, now also answers whether a reminder's recipient is online
    (`AuthSessionReadPort.lastSeenByAdminUser`, new in this release).
  - **A second queue consumer**, on the queue `crm-event-reminders`: a scheduler that fires every
    60 seconds and a worker that reads the due reminders from the table. It needs the worker
    process the value recalculation already needs; an instance that runs none delivers no
    reminder. Nothing but the clock is kept in Redis.
  - **One transactional e-mail, `crm_event_reminder`** ("Event reminder", group `crm`), with
    defaults in `en-US` and `pl-PL` and the variables `event.name`, `event.when` and
    `opportunity.number`. An operator edits it or switches it off on the Transactional Emails
    screen.
  - **No new permission, setting, error code or environment input.** Reading Events and the
    Calendar needs `crm:read`; adding, editing and deleting an Event needs `crm:write`.

  **Five routes**, under `/api/v1/admin/crm`, with the shapes `@endora-commerce/contracts`
  publishes in this release:

  - `GET /opportunities/:id/events` (`crm:read`), `POST /opportunities/:id/events`,
    `PATCH` and `DELETE /opportunities/:id/events/:eventId` (`crm:write`). An Event is a name, an
    optional plain-text description, **one day** — a start and an end on it, or all day — the IANA
    `timeZone` it was planned in, and an optional reminder time. Any holder of `crm:write` who can
    see the Opportunity edits and deletes any of its Events. An Opportunity the caller may not see
    answers 404 `CRM_OPPORTUNITY_NOT_FOUND`; a well-formed Event the rules refuse answers 422
    `VALIDATION_FAILED` with `details.field` and `details.rule`. Each write is an entry of the
    Opportunity's change history (`crm.opportunity.event_add`, `.event_update`, `.event_remove`)
    that carries the name and the times and never the description's text.
  - `GET /calendar/events?from=&to=&scope=` (`crm:read`): the Events of **open** Opportunities
    the caller may see, over at most 45 days, at most 500 of them (`meta.truncated`). The scope
    is the server's decision: a caller who may see every organization gets `all` and may ask for
    `mine`; a caller restricted to a set of organizations is always answered with `mine` — the
    Opportunities assigned to them.
  - `GET /opportunities/:id` now counts the Events that have not ended, in `upcomingEventCount`.

  **Reminders.** A reminder goes, when it is due, to the person the Opportunity is assigned to at
  that moment; failing that — nobody assigned, or an assignee who does not qualify — to the person
  who added the Event; failing both, to nobody (`no_recipient`). To qualify, a person must be an
  active administrator, hold `crm:read`, and reach the Opportunity's Organization — the same three
  tests for both. It is always written to the notification bell, and sent as an e-mail as well
  when the recipient has made no request to the Admin UI in the last five minutes, or when
  `admin_notifications` is switched off. It is delivered at most once; while its Opportunity is
  closed or the module is switched off it waits; found more than 24 hours late it is not sent and
  is reported as `missed`.

  - **How it says when.** `event.when` of the e-mail and the `when` param of the bell entry are
    worded for the one recipient, in the language of their Admin UI and in the Event's own zone:
    `October 8, 2026, 6:42 PM (Europe/Warsaw)`, `8 października 2026, 18:42 (Europe/Warsaw)`; the
    date alone for an all-day Event.
  - **The name, on one line.** A line break in an Event's name is said as a space, in the bell
    sentence and in the subject of the e-mail. The bell stores a title of at most 255 characters,
    so for a very long name the stored English sentence is cut to fit; the translated sentence
    the reader is shown keeps the name whole.
  - **An Event deleted, or a reminder removed or moved, is not reminded of** — also when the
    sweep had already claimed it. `interrupted` is reported only for a reminder whose sending
    process died before recording the result; it is not sent again.

  Three things an operator should know before relying on it:

  - **The reminder e-mail carries no link.** It names the Opportunity by its number. An absolute
    link needs the address of the instance's Admin UI, which this module does not read; the bell
    entry links to the Opportunity.
  - **With no SMTP connection configured, the e-mail is written to the server's log and reported
    as sent**, so the Event shows "sent — notification bell and e-mail" for a message that reached
    no mailbox. The bell entry is unaffected.
  - **A reassignment moves every Event and every pending reminder** to the new assignee, with no
    row written: an Event holds no assignee.

  **In the Admin UI.**

  - **A Calendar screen**, `/crm/calendar` (`crm:read`), in the CRM group of the sidebar between
    _Board_ and _Analytics_, and a fifth command-palette action, `open-crm-calendar`. Four views —
    **Month**, **Week**, **Day** and **Agenda** — with _Today_, _Previous_ / _Next_ and _Go to
    date_; every Event is a link to its Opportunity. The view, the date and _Mine / All_ are in the
    address: `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`. _Mine / All_ is drawn
    from what the server says the reader may ask for. Under 640 px the Calendar is the Agenda. The
    screen holds no write.
  - **An "Events" tab** on the Opportunity screen, third after _Links_, its label counting the
    Events that have not ended: the list — upcoming, then past — with what became of each reminder
    in words, a calendar of that Opportunity alone, and, for a holder of `crm:write`, adding,
    editing and deleting. The dialog's reminder checkbox reads _Set a reminder_ / _Ustaw
    przypomnienie_, and its hint says who is reminded. `/crm/opportunities/:id?tab=events&event=<id>` — what a reminder and a
    Calendar entry link to — marks that Event. A closed Opportunity keeps the tab and says that its
    Events are off the Calendar and its reminders held.
  - Times are shown in the browser's time zone, which the screen names, and written the way the
    language of the Admin UI writes them; the week starts on Monday in both languages.
  - Bundle keys: `calendar.*`, `events.*`, `opportunity.tabs.events`, `nav.calendar.label`,
    `actions.openCrmCalendar.*`, `notifications.eventReminder*`, three
    `auditLog.crm.opportunity.event_*` labels and five `history.field.*` labels are new in English
    and Polish.

  No third-party runtime dependency is added: the calendar is drawn by this package with `Date`
  and `Intl`. The package gains one peer dependency on a sibling,
  `@endora-commerce/email-components`, for the default body of the reminder e-mail.

  **Not in this release:** Events over several days and repeating Events; dragging on the Calendar
  or creating an Event from it; kinds, colours and participants; synchronisation with an external
  calendar; Events in webhooks, analytics, import or export.

  For an overlay that mounts this module's components: `OPPORTUNITY_TABS` has a seventh member,
  `events`, at index 2. Not part of the package's `exports`.

- ce0471f: A new module package, `@endora-commerce/mod-crm` (module id `crm`): sales opportunities with a
  configurable status workflow that linked orders follow. Backend and Admin UI. This is the
  module's first release.

  **What installing it does.** Thirteen `crm_`-prefixed tables and a default workflow of six
  statuses (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) arrive with the next
  migration run — three migrations. An instance that does not install it is unaffected. The module
  is optional: `crm.enabled`, on by default, switched on `/platform/modules`; while it is off
  every route answers `503 MODULE_DISABLED`, its screens, panels, permissions and settings are
  withdrawn, and nothing is deleted. It depends on `orders`, `organizations`, `sales_channels`,
  `catalog`, `assets_library`, `custom_fields`, `audit_logs` and the platform's account and
  settings modules, and degrades without `quote_requests`, `admin_notifications` and `webhooks`. One queue consumer,
  `crm-value-recalculation`. Peers: `fastify`, `@fastify/multipart`, MikroORM, `bullmq`,
  `ioredis`, `zod`, and — optional, for the admin layer only — `@endora-commerce/admin-kit`,
  `react`, `react-router-dom`, `lucide-react`. Its own demo data is three tags (`Key account`,
  `Upsell`, `Tender`); the demo sales pipeline that carries them is a step of
  `@endora-commerce/demo-composition`. `./backend` also exports `nextOpportunityNumber(em)`, the
  next `OPP-…` number from the module's sequence, for that step.

  **Permissions**, none granted to any role automatically: `crm:read`, `crm:write`,
  `crm:configure`, `crm:analytics`. `crm:read` advises `orders:read` and `custom_fields:read`.
  What another module owns is shown to somebody who may read it there: a linked or mentioned
  order needs `orders:read`, a quote request `rfqs:handle`, a mentioned product `catalog:read`;
  without it the document is listed as unavailable and nothing of it is shown.

  **The API**, all under `/api/v1/admin/crm`, tenant-scoped throughout (an opportunity of an
  organization the caller may not see answers `404 CRM_OPPORTUNITY_NOT_FOUND`):

  - **Workflow** — `GET /workflow`; `POST|PATCH|DELETE /statuses`; `PUT /transitions`;
    `PUT /order-status-mappings` (both directions); `PUT /value-counting-statuses` (answers 202
    and recalculates in the background). A change that would break the workflow answers
    `422 CRM_WORKFLOW_INVALID` naming the rule in `details.rule`.
  - **Opportunities** — list (search, filters by state, status, organization, assignee, tags,
    sales channel, creation date; sorting; cursor paging), create, read, `PATCH` under
    `If-Match` (409 for a stale version, 400 for a header that is not one), delete
    (`crm:configure`), `POST …/transition`, `POST …/assign`, `PUT …/tags`.
  - **Linked documents** — `POST|PATCH|DELETE …/links` for orders and quote requests. A document
    belongs to at most one opportunity, of its own organization.
    `GET /documents/:kind/:id/opportunity` answers the opportunity a document is linked to.
  - **Orders follow, and lead.** A move asks every linked order that follows the opportunity to
    enter the mapped order status, through the Orders module's own transition rules, after the
    opportunity's change has committed. A refusal is not an error: the response is 200, the
    opportunity has moved, and each order's outcome is in `propagation`, addressed afterwards by
    `…/propagations/:id/retry` and `…/dismiss`. In the other direction a linked order reaching
    a mapped status moves its opportunity through the opportunity's own workflow; a closed
    opportunity is never reopened, and the two directions do not loop.
  - **Value** — entered by hand, or computed from linked orders (gross total) and quote requests
    (net sum of lines) in a counting status; one currency, nothing converted, documents left out
    listed in `excludedDocuments`.
  - **Tags** (`/tags`), **notes and internal messages** (`…/comments`: a note is its author's to
    edit or delete, a message is immutable), **attachments** (`…/attachments/upload` under
    `crm:write` alone, stored in the media library as a private file, at most 25 MB, active
    content refused; attaching an existing library file by id also needs `assets.read`).
  - **Change history** — `GET …/history`, read from the platform's audit trail under `crm:read`,
    reaching back 499 entries and answering `truncated: true` on its last page when there are more;
    the text of a note or a message is never in it, and the tab shows every audited value in
    words — custom field values under the fields' own labels, an order status by name to a
    reader holding `orders:read`.
  - **References** — `[[product:<uuid>]]`, `[[order:<uuid>]]` and `[[admin_user:<uuid>]]` in a
    description, note or message are resolved into `references` beside the text — and beside a
    description in the change history. A mentioned person is named and never linked.
  - **Mentions** — in the Admin UI, typing `@`, `@@` or `@@@` in those fields opens a search
    of people, the organization's orders or products at the caret and inserts the choice. The
    field shows every reference by its name while it is being written or edited, never the
    token; what is stored and sent is the token text, unchanged. A person newly mentioned in a
    saved text gets one bell entry, `crm.opportunity.mention`, naming the opportunity by number
    and the author by name; never the author themself, nobody without `crm:read`, nobody who
    cannot see the organization.
  - **Bell entries in the reader's language** — the three kinds the module records
    (`crm.opportunity.assigned`, `crm.opportunity.message`, `crm.opportunity.mention`) carry a
    `titleMessage` in the `crm` bundle (`notifications.*.title`, English and Polish) beside the
    English `title`, so the Admin UI shows each reader their own language and falls back to the
    English sentence while the module is switched off. The params are the opportunity's number
    and, for a mention, the author's name — nothing the sentence does not already say.
  - **Board** — `GET /board`: a column per status with count, value totals per currency and the
    first cards.
  - **Analytics** (`crm:analytics`) — five live reads under `/analytics/`: handling time, time
    in status, rep effectiveness, top opportunities, average value. Per currency, UTC.
  - **Lookups** — `/lookups/organizations`, `/sales-channels`, `/assignees`, `/contacts`,
    `/mentionable`, `/quote-requests`, so the module's pickers need no permission of the modules that own those
    rows.

  **Automatic creation**, both off by default: `crm.auto_create_from_orders` (per sales channel)
  and `crm.auto_create_from_quote_requests`. A document created from within an opportunity — the
  _Create order_ and _Create quote request_ buttons, carried as an `origin` on the owner's create
  request — is linked to that opportunity and gets none of its own.

  **An order placed from a linked quote request joins the opportunity by itself**
  (`linkSource: "quote_conversion"`), whether the opportunity is open or closed, and such a pair
  is counted once in a computed value — the order's figure, not the two added. It relies on the
  order recording the quote request it was placed from, which `@endora-commerce/mod-orders` does
  from the same release.

  **The Admin UI** (`./admin`, `./tailwind.css`): a "CRM" sidebar section with _Opportunities_,
  _Board_, _Analytics_, _Tags_ and _Workflow_; the create screen and the opportunity's own screen
  with _Overview_, _Notes_, _Messages_, _Attachments_ and _Change history_; four command-palette
  actions (`open-opportunities`, `new-opportunity`, `open-opportunity-board`,
  `open-crm-analytics`); and three panels contributed to other modules' screens — _Open
  opportunities_ on an organization, _Linked opportunity_ on an order and on a quote request.
  The board moves a card by dragging (mouse, touch, keyboard) or from the card's "Move to…"
  menu. English and Polish.

  **For other modules.** Events: `crm.opportunity.created.v1`, `…status_changed.v1`,
  `…closed.v1` (these three are also offered as outbound webhooks), `…assigned.v1`,
  `…document_linked.v1`, and per transition `crm.opportunity.status.from_<x>_to_<y>.before`,
  `…from_<x>.before`, `…from_<x>_to_<y>.after`, `…to_<y>.after`. Container names:
  `opportunityReadPort`, `opportunityTransitionPort` (both fail closed while the module is off)
  and `opportunityTransitionGuardRegistry`, into which a module pushes a guard that may refuse a
  move by throwing `OpportunityTransitionVetoError`. The module contributes to the registries of
  `sales_channels` (attribution), `assets_library` (an attached file cannot be deleted from the
  library), `audit_logs` (recent activity names an opportunity), `custom_fields` (the
  `opportunity` host type) and `webhooks`.

  The module's documentation page, `docs/crm.md`, describes all of it for an operator and for a
  developer.

### Patch Changes

- bcd577c: The Sales Opportunity screen is laid out anew: a header and, under it, a stage bar and tabs
  beside a card of facts. Nothing about the API changes, and no action the screen had is gone.

  - **Stage bar.** It names the current status and shows only the statuses the workflow allows a
    move to from it — the Opportunity's own `allowedTransitions` — sorted into **Back** (an earlier
    status in the operator's order, and reopening) and **Forward** (a later status, and every
    closing one). It lists no other status, marks none as completed and counts no stage: the
    workflow is a graph. For a holder of `crm:write` each move is a button that performs the same
    `POST …/transition`, with the same optional reason, as the status buttons it replaces; a
    reader sees the moves as text. `GET /api/v1/admin/crm/workflow` (`crm:read`) is read only to
    order two open statuses; when that read fails every move is still offered, the ones it could
    not place under a plain heading.
  - **A "Links" tab** (PL: "Powiązania") now holds _Linked orders_ and _Linked quote requests_,
    with the number of linked documents on its label. They are no longer on _Overview_.
  - **The selected tab is in the address**: `/crm/opportunities/:id?tab=links|notes|messages|attachments|history`.
    A bare address opens _Overview_, as before. The return address the module hands the Order and
    Quote Request create screens (`?created=…`) opens _Links_.
  - **A card of facts** in the right column, from the header down beside the stage bar and the
    tabs — value and deadline, customer and assignee, classification, record — replaces the
    _Details_ list of _Overview_. On a narrow screen it comes after the stage bar and before the
    tabs. The value's mode, the
    assignee and the tags are still changed in place; everything else through **Edit**, which moved
    to the header.
  - What became of the linked Orders after a status change is shown under the stage bar on every
    tab.
  - Bundle keys: `opportunity.stage.*`, `opportunity.facts.*`, `opportunity.tabs.links`,
    `opportunity.tabs.label`, `opportunity.field.number`, `opportunity.field.closed` and
    `opportunity.description.empty*` are new in English and Polish; `opportunity.detail.subtitle`,
    `opportunity.status.current` and `opportunity.status.moveTo` are removed.

  For an overlay that mounts this module's components: `components/StatusControl` is replaced by
  `components/StageBar` (same props), and `OpportunityTabProps` gains `orderStatuses`, `editing`
  and `onEditingChange`. Neither is part of the package's `exports`.

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
