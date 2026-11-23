# @endora-commerce/mod-projects

## 0.112.0

### Minor Changes

- f915a24: Saved views on the CRM Opportunities page and the Projects list (issue #1734), on the same rules as the order, quote request, return and task lists (`specs/147-saved-views/`).

  - `@endora-commerce/contracts` exports `createOpportunitySavedViewRequestSchema`, `updateOpportunitySavedViewRequestSchema`, `createProjectSavedViewRequestSchema` and `updateProjectSavedViewRequestSchema` (with their `Create…`/`Update…` types): `{ name, shared, filters, sort? }`; `visibleColumns` is stripped, since neither list has a column picker. Two error codes join `ERROR_CODES`: `CRM_SAVED_VIEW_NAME_TAKEN` and `PROJECT_SAVED_VIEW_NAME_TAKEN` (the latter also in `PROJECTS_ERROR_CODES`).
  - `@endora-commerce/mod-crm` adds `GET`, `POST /api/v1/admin/crm/opportunities/list-views` and `PATCH`, `DELETE …/list-views/:id` (`crm:read`), a `crm_opportunity_list_saved_views` table, and the kit's saved-views control on the list and the board. One view serves both: it stores every filter of the page and the list's sort, never the view.
  - `@endora-commerce/mod-projects` adds `GET`, `POST /api/v1/admin/projects/list-views` and `PATCH`, `DELETE …/list-views/:id` (`projects:read`), a `project_list_saved_views` table, and the control on the Projects list.

  Run the migrations: each module brings one new table and touches no existing one.

- bfab5bd: **Breaking:** `GET /api/v1/admin/quote-requests` now answers one page instead of every quote request. The server applies `assignmentScope`, `organizationId`, `status`, `q` (a fragment of the business id, the organization name or the customer's name, or a whole id), `sort` (`updatedAt:desc` by default, `updatedAt:asc`, `total:desc`, `total:asc`) and the page (`page`, default 1; `pageSize`, default 25, at most 200). The `pagination` block is now true for the response: it adds `page`, `pageSize` and `total`, and `limit` and `hasMore` describe the page returned (`nextCursor` stays `null`; ask for the next `page`). An invalid `pageSize`, `page`, `sort`, `assignmentScope` or `organizationId` is refused with 400.

  To migrate, a client that read the whole list from one call must page through it with `page` and `pageSize`, or read `pagination.total` when it only needs the count. The contracts publish the query and the envelope as `adminQuoteRequestListQuerySchema` and `adminQuoteRequestListResponseSchema`.

  `SalesRepAssignmentPort` gains `listOrganizationIdsWithAssignments()`; an implementation of the port outside this repository must add it. The admin Quote Requests list now asks the server for each page, filter and sort, and offers a lowest-total sort. The home page's pending-quotes tile and the project link picker read the paged list.

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

- 074f500: Admin zone contributions now choose a tab or a sidebar by naming the zone for that place (issues #1452 and #1526). Four zones are new: `organization.detail.sales` is the body of the organization's Sales tab, after the sales representatives, and carries `{ organizationId }` with no save session; `order.detail.sidebar`, `quote_request.detail.sidebar` and `opportunity.detail.sidebar` are sidebar cards, and each contribution is a section of the card. The order and quote request screens draw their sidebar only while something fills it. The organization's Sales tab is shown to someone who may assign sales representatives or who sees one of its panels. CRM opportunities and projects moved from the organization's Commerce tab to its Sales tab. The linked opportunity, the project and the tasks moved from the end of the order, quote request and opportunity screens into their sidebars. No zone was removed or renamed: contributions to the `.detail.after` zones keep working unchanged.
- 7624db6: Adds `InlineEdit` and `InlineEditTitle` to the admin kit's `./components`: the admin's one model for editing a record's facts where they are shown (issue #1453). Each fact has its own pencil, _Save_ and _Cancel_, and sends only itself. `InlineEdit` takes a `group` option for an editor of several controls, which names itself through the new `labelId`. `MultiSelect` and `TagMultiSelect` take an optional `id` for the trigger. The copy is in `core`: `common.inlineEdit.edit`, `common.inlineEdit.saved` and `common.inlineEdit.error`.

  CRM now uses the kit's component (its own copy is removed), and the Opportunity's assignee is edited the same way as the facts beside it, instead of through an always-open lookup. On a Task, the page-wide _Edit_ form is replaced: the title, description, due date, start date, priority, tags and assignees are each edited in place. On a Project's _Overview_, the description, the start date and who sees the Project are edited in place. The start date could not be changed there before (issue #1525).

- 87fb9c3: On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

  A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.

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

- 9868c7c: The admin dictionary screens put their _Add_ in one place, the page header (issue #1562, UX audit WORK-13).

  - **Tasks › Tags** and **Tasks › Priorities**: _Add tag_ / _Add priority_ is the filled button in the page header instead of an outline button in a card header, and the card title that repeated the page title ("Tags", "Priorities") is gone. The count column now reads "Tasks (visible to you)", as does the workflow screen's status count, because the server counts only the Tasks the operator can see. A row's delete button is drawn in the destructive tone.
  - **CRM › Tags**: the empty list shows the admin's empty state (icon, title, one line, _Add tag_), and the header's _Add tag_ is hidden while the list is empty, so the screen has one primary action. The count column reads "Opportunities (visible to you)".
  - **Projects › Roles** and **Loss reasons**: the same empty state with its _Add_ replaces the bare "Nothing to show.", and the header's _Add_ is hidden while the dictionary is empty.
  - **Dictionaries** (Countries, Currencies, Languages): the active tab's _Add country_ / _Add currency_ / _Add language_ moves from the tab's card into the page header, opens the editor and moves focus to its code field. The card no longer repeats the tab's name above the table; the table is named by it. The empty state carries the _Add_ while a dictionary is empty. A row's _Edit_, _Set default_ and red _Delete_ buttons become one row menu, "Actions for PL", with _Delete_ last; on the default row _Delete_ and _Set default_ are disabled and _Delete_ says why.

  The i18n keys `tags.list.title` and `priorities.list.title` (tasks) and `dictionary.empty` (projects) are removed. The CRM `tags.empty` is now a short title, with the sentence moved to the new `tags.emptyBody`. The API is unchanged.

- 6735d52: My Tasks opens with the list (issue #1563): the daily digest setting is a closed disclosure in the page header that says its state ("Daily digest: off" / "Daily digest: on, 08:00") and opens the same control below the header. The `DigestControl` component is replaced by the `useDigestDisclosure()` hook, which returns the header `trigger` and the `panel`.

  The task, opportunity, project and project-template create forms mark required fields through the kit's `FormField` — an asterisk and `aria-required` — with their hints and errors linked to the field (issue #1564). On the new-project form the template choice is the first field of the first card instead of a card of its own. The CRM lookup pickers accept `ariaDescribedBy` and `invalid`.

- 820f089: The admin kit exports `formatDate(value, language)`, and `formatDateTime(iso, language)` takes the admin UI language: a medium date, and a moment as that date with the short time, never the browser's locale (UX audit #1567). The Opportunity sidebar's deadline and Record dates, the Projects date labels (the Project panel's Stage deadline among them) and the Tasks date labels use them, so one screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`. On the Opportunity sidebar the value stays on one line and the value-mode switch sits below it instead of squeezing it to one character per line.
- 3821b39: Fifteen work and content list screens now use the kit `ListPage` (issue #1749). They are the Opportunities list and the CRM tags; Projects, Project templates, Project roles and loss reasons; Tasks, My tasks, Task priorities and Task tags; the newsletter's campaigns, automations, subscribers and e-mail blocks; and the transactional e-mail templates and blocks. Each one now has the kit loading skeleton, a load error with **Retry**, the result count at the end of the toolbar row, and its filters in a toolbar row instead of a card. A reload keeps the rows on screen. When the server refuses a custom-field filter, the list says so and offers **Remove filter**.

  - **Tasks, My tasks, Projects, Opportunities:** the pager is the kit list footer, with the same _Previous_ / _Next_ and rows per page as before.
  - **Newsletter subscribers:** the list is paged. It used to show the first 50 and stop. The search and the tag filter run as you type.
  - **Newsletter e-mail blocks:** the block editor is no longer open above the list. **New block** opens it in place of the list, as _Edit_ does.
  - **Transactional e-mail templates and blocks:** the create form that stood above the list is a dialog behind **Create template** / **Create block**. A row's _Delete_ is in its menu, and the delete runs inside the confirmation.
  - New `en` / `pl` keys: `crm` `tags.count`; `projects` `templates.list.toolbar`, `templates.list.count`, `dictionary.toolbar`, `dictionary.count`, `list.count`; `tasks` `tags.count`, `priorities.count`, `mine.count`; `newsletter` `campaigns.count`, `automations.count`, `subscribers.toolbar`, `emailBlocks.count`; `transactional_emails` `templates.count`, `templates.empty`, `templates.rowActions`, `blocks.count`, `blocks.empty`, `blocks.rowActions`.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 0e81803: The analytics screen helpers that CRM and Projects each kept a copy of now live in the admin kit
  (issue #464): `FigureCard`, `useFigure`, `useChartColors` and `prefersReducedMotion` from
  `@endora-commerce/admin-kit/components`, and the range presets (`RANGE_PRESETS`, `presetRange`,
  `isDayRange`, `DayRange`, `RangePreset`) from `@endora-commerce/admin-kit/lib`. `FigureCard`
  takes the module's error sentence as `errorFallback`, and an optional `footer` drawn under every
  answer. Both analytics screens use the kit copies and behave as before; Projects keeps its own
  wrapper for the period and counts line under each figure.
- 9d6f006: Issue #504: the Project/Stage picker on a Task's screen (`GET /api/v1/admin/tasks/lookups/contexts`) now reads one bounded page per search. Before, each search listed every Project the caller could see, described them all and asked about each candidate separately, so it got slower as the number of Projects grew.

  - `TaskContextDescriptor` gains an optional `search({ q, limit, changeableOnly })`, with the new types `TaskContextSearchQuery` and `TaskContextSearchHit`. A context owner that implements it answers the picker's page itself. The lookup asks it once per search and no longer calls `allVisibleContextIds`, `describe` or `canChangeTasks` for that owner. An owner without it keeps the previous scan.
  - The `project` Task context implements it with `ProjectAccess.searchVisibleByLabel`, which is one statement with both visibility rules and a limit, plus one read of the page's Stages. A caller without `projects:write` gets an empty list without any Project being read.

  The picker offers the same Projects as before: the ones the caller may see and change, matched on number and title without regard to case or diacritics, sorted by label, at most 20.

- 83589de: A project's Stages tab lists each stage as one compact row instead of an always-open form (issue #1523). _Edit_ opens one stage at a time, and that stage's single _Save_ writes its fields and the tasks it creates on entry together; the separate _Save_ for the stage's tasks is gone. Opening another stage over unsaved changes, and deleting a stage, now ask first. The result of a change is said next to _Add stage_. On a project's Overview and on _New project_, the sentence under _Who sees this project_ names the module setting by the label the Settings screen gives it, and is one clause long (issue #1565). No API, setting, permission or migration changes.
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

- 67f1463: Issue #1226 (D-288; owner rulings O-1 and O-4) — a project's audit entries no longer carry the free text of its stages, stage tasks and attachments.

  - `projects.project.stage_move`, `close` and `reopen` drop `stageName`; `projects.project.create` records `stageIds` in place of `stages` (the list of stage names); `stage_create`, `stage_update` and `stage_delete` drop `name`; each task under `tasks` of `stage_tasks_set` drops `title` and is named by `position`; `attachment_add` drops `fileName`.
  - A stage's name, a stage's task titles and an attachment's file name go to the existing `project_value_changes` store (`ProjectValueState.name`, `.taskTitles`, `.fileName`), written in the same Command. The entry names them in `changedFields` (`['name']`, `['taskTitles']`, `['fileName']`) and points at the row by `valueChangeId`; a deleted stage's entry carries both on its state before. No migration is needed.
  - `GET /api/v1/admin/projects/:id/history` serves those names from the store in the shape older entries carried: `name` on a stage's entries, `title` on each task under `tasks`, `fileName` on `attachment_add`.
  - An internal `PROJECTS_AUDIT_KEYS` allowlist (not exported from the package) lists every key a `projects.project.*` audit state may carry, held by sentinel tests (`specs/conventions/audit-state.md` §6).
  - Audit entries written before the upgrade keep their names (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a stage by id, a stage task by position and a file by id. The project's **Change history** tab still names them; a stage task whose title a change did not touch is named by its place. See _Stage names, task titles and file names leave the project audit entries_ in the upgrade guide.

- bfdbeaf: Projects: optimistic concurrency for a Project's configuration (issue #449), additive. Two new tokens, neither of them the Project `version` that moves, closes, reopens and edits name — no write of the configuration moves that one, so a client that edits a Stage and then moves the Project with the version it read is served as before.

  - **A Stage's own edits.** `ProjectStageSchema` gains `version`. `UpdateProjectStageBodySchema` (`PATCH …/stages/:stageId`) and `SetProjectStageTasksBodySchema` (`PUT …/stages/:stageId/tasks`) take an optional `version` — the Stage's; each write moves it. A body of `PATCH …/stages/:stageId` naming only `version` is still refused as having nothing to change.
  - **The Project's sets.** `ProjectDetailSchema` gains `configurationVersion`. `CreateProjectStageBodySchema`, `ReorderProjectStagesBodySchema`, `SetProjectMovesBodySchema`, `SetProjectOrganizationsBodySchema` and `SetProjectMembersBodySchema` take an optional `configurationVersion`; each of those writes, and `DELETE …/stages/:stageId`, moves it. `SetProjectMovesResultSchema` gains `configurationVersion`, the value after the write.

  Sent and stale, either token answers `409 PROJECT_CHANGED` and nothing is written; a body without it is served as before. Both start at 1 — a migration adds `project_stages.version` and `projects.configuration_version` with that default.

  `PUT …/organizations` changes the set in one transaction: a failure part-way leaves it as it was. The audit trail still records one `projects.project.organization_add` or `projects.project.organization_remove` entry per Organization, now as child Commands of `projects.project.organizations_set`, which records no entry of its own. The Projects admin sends the Stage's version on a Stage or Stage Task edit and the Project's `configurationVersion` on adding and reordering Stages and on the workflow, and reads the Project again on a `409`.

- 48cefef: Issue #470 (D-288; owner ruling O-1, 2026-11-10: a title is a value) — a project's audit entries no longer carry its title.

  - The Project audit snapshot drops `title`. `projects.project.create` and `projects.project.update` name a title change in `changedFields` (`['title']`, beside `'value'`). The title before and after goes to the existing `project_value_changes` store (`ProjectValueState.title`), and the entry points at it by `valueChangeId`.
  - `GET /api/v1/admin/projects/:id/history` serves the title from that store, as it already does the value. No migration is needed.
  - Audit entries written before the upgrade keep their title (owner ruling O-4).

  **Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new project entries name a project by its number instead of its title. The project's **Change history** tab is unchanged. See _Project titles leave the platform audit log_ in the upgrade guide.

- 48b2505: Every `GET /api/v1/admin/projects/analytics/*` answer adds `timeZone`, the reporting time zone its
  days were counted in (`UTC` while `analytics` is switched off), beside `from`, `to`,
  `projectCount` and `excluded` (issue #475). The analytics screen names that zone under its
  filters and takes the range presets (_This month_, …) from that zone's calendar instead of the
  browser's, so around midnight a preset means the days the figures are counted over.
- 0b991d6: Three `projects` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish (issue #634, part of #86). **A caller that matches on
  `VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
  Until now each was answered with an English sentence in every language, because the error envelope
  never replaces the message of `VALIDATION_FAILED`, and the stage maximum was written into that text.

  | Route                                                                               | Was                                                                                                           | Is                                   | `details`               |
  | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------- |
  | `POST /api/v1/admin/projects/:id/stages`                                            | `422 VALIDATION_FAILED`, _"A project has at most 50 stages."_                                                 | `422 PROJECT_STAGE_LIMIT`            | `projectId`, `maximum`  |
  | `POST /api/v1/admin/projects/:id/attachments`                                       | `422 VALIDATION_FAILED`, _"An attachment must be a private file. Upload it to the media library as private."_ | `422 PROJECT_ATTACHMENT_NOT_PRIVATE` | `assetId`, `visibility` |
  | `POST /api/v1/admin/projects/templates`, `PUT /api/v1/admin/projects/templates/:id` | `422 VALIDATION_FAILED`, _"An archived project role is not added to a template."_                             | `422 PROJECT_TEMPLATE_ROLE_ARCHIVED` | `roleId`                |

  A project created with no stages, a file that is not in the media library and a template role that
  is not a project role stay `422 VALIDATION_FAILED`. The three codes are members of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `projects` manifest, and the module's documentation
  page names them. No setting, permission or migration changes.

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
- cbfe104: Projects admin: nothing typed is discarded without a question (issue #452). On the create form, choosing a Template while Stages are typed by hand, or while the description is one written by hand, asks first in the admin's confirmation dialog; Cancel leaves the form as it was, and choosing "No template" again brings back the typed Stages and description. The Template editor guards unsaved edits with the admin kit's unsaved-changes prompt (links and leaving the page), asks before Cancel discards them, and asks before Duplicate, which copies the saved Template and not what is on screen. New strings in English and Polish under `create.template.replace.*`, `templates.editor.unsaved.*` and `templates.editor.duplicateUnsaved.*`.
- 4b12959: The Projects list in the admin (`/projects`) now keeps its filters and its sort in the address
  (issue #454). The parameters carry the names `GET /api/v1/admin/projects` takes — `q`, `state`,
  `organizationId`, `memberId` (an administrator's id, or `me` for _Only my projects_), `roleId`,
  `templateId`, `stageName`, `sort`, `order` — and custom-field filters use the admin kit's
  `cf.<key>.<op>` parameters. Back, a reload and a shared link keep the filters, and another screen
  can link to a narrowed list. A parameter the list does not take (an unknown state, a value that is
  not an id, a sort the server does not serve) is ignored, and a Role or Template the screen's choices
  no longer hold is removed from the address once they are read. The Organization and member filters
  show the name of a value they were given in the address. On the Organization screen, the Projects
  panel's _All projects_ link now opens `/projects?organizationId=<id>`.
- 65f7abc: Issue #455 — a Project's _Linked records_ tab and its link picker name each record's status the way the record's own module names it, in the reader's language, instead of showing the stored code (`new`, `proposal`, `Pending`).

  - **`@endora-commerce/contracts`** adds `statusName(code, language)` to `OpportunityReadPort` and `statusName(status, language)` to `QuoteRequestReadPort`, each answering a `Promise<string>`, and the optional `statusName` to `ProjectLinkSchema` beside `status`. A test double that implements either port in full needs the new method.
  - **`@endora-commerce/mod-crm`** implements `OpportunityReadPort.statusName` by its own rule: the configured name in that language, else the status's default name, else the code.
  - **`@endora-commerce/mod-quote-requests`** implements `QuoteRequestReadPort.statusName` in the wording its global-search results already use (a code outside the six statuses answers as it is), and each row of `GET /api/v1/admin/quote-requests` now also carries `statusName` in the response language.
  - **`@endora-commerce/mod-projects`** serves `statusName` on `GET` and `POST /api/v1/admin/projects/:id/links` (an Order's name from `orderReadPort.findStatusDefinition`), and the admin tab and picker show it.

  **On upgrade.** Nothing to migrate; `status` keeps answering the code.

- a998fee: Issue #457 — a Project with many linked Quote Requests and Opportunities no longer reads them one at a time.

  - **`@endora-commerce/contracts`** adds two batched reads to `QuoteRequestReadPort`: `findByIds(ids)`, which answers what `findById` answers for each id in one read (a missing, out-of-scope or malformed id is absent), and `amountsOf(quoteRequestIds)`, a `Map` keyed by quote id holding what `amountOf` answers for each (a quote `amountOf` answers `null` for has no entry). Every implementation of the port must provide both; consumers are unaffected.
  - **`@endora-commerce/mod-quote-requests`** implements both under the caller's tenant scope: `findByIds` in one statement, `amountsOf` in two (the quotes, then their lines), whatever the number of ids.
  - **`@endora-commerce/mod-projects`** reads a Project's linked Quote Requests through `findByIds` and `amountsOf`, and its linked Opportunities through `OpportunityReadPort.findByIds`, one batch per kind. `GET /api/v1/admin/projects/:id/links` now costs the same number of statements for one linked record of each kind as for many; what it shows is unchanged.

- 54ae028: The permission inventory scanner (`scanEnforcedPermissionGates`) now reads
  `hasAnyPermission(['a', 'b'])` as one gate site that carries every code in the array, in the same
  way as `requireAdminAny([...])` (issue #458). It reads an array argument only up to the array's
  closing bracket. If code after the array narrows it at runtime, as in `['a', 'b'].filter(f)`, the
  scanner still reads `a` and `b`, and ignores any string in the narrowing. The `@@` document-list
  gate in CRM and in Projects now uses `hasAnyPermission`, so the scanner checks all four codes in
  each gate. Before, it marked them as runtime values and did not check them. Who can open the
  `@@` list does not change.
- 021a254: Issue #460 — a Project's _Change history_ names what its entries refer to and draws the nested changes, on the kit `RecordHistory`'s label and renderer props.

  - People (members, listed people), Organizations, Stages and Roles are shown by name, never as ids. Names come from the Project, the Roles dictionary and the entries' actors. A Stage the Project no longer has keeps the name an older entry recorded for it. Anything else that cannot be named reads as _no longer on this project_.
  - A change of the members lists who was added (with their roles), whose roles changed and who was removed. A change of the workflow lists the moves it allowed and withdrew. A change of a Stage's tasks lists the tasks added, changed and removed. An entry about one Stage names that Stage first.
  - A comment's kind, a Stage entry's notes and a loss reason are shown in the reader's language. A Stage's own fields (planned duration, responsible roles, deadline, completion gate and the rest) have labels.
  - `ProjectHistory` now takes the Project (`project`) instead of `projectId`.

  Nothing new is recorded in the audit log, and nothing is migrated.

- 20cda0c: Issue #461 — the Projects `@` list (`GET /api/v1/admin/projects/lookups/mentionable`) judges who may see the Project for every candidate administrator at once, instead of several reads per person.

  - **`@endora-commerce/contracts`** adds `PermissionReadPort.resolveRoles(adminUserIds)` — a `Map` holding, for every id asked, what `resolveRole` answers — and `AdminTenantScopePort.resolveForAdmins(adminUserIds)` — a `Map` holding, for every id asked, the scope `resolveForAdmin` answers. Every implementation of these ports must provide the new method; consumers are unaffected.
  - **`@endora-commerce/mod-admin-roles`** implements `resolveRoles` in two statements whatever the number of ids, and adds `holdersOf(adminUserIds, permission)` beside `hasPermission` on the `permissionService` container entry: the ids `hasPermission` answers yes for, refusing with `ADMIN_ROLE_REQUIRED` as `hasPermission` does when an active administrator asked holds no role.
  - **`@endora-commerce/mod-organizations`** implements `resolveForAdmins` with the same rule as `resolveForAdmin` — one batched role read, and the roll-up question asked once for the sales representatives only. A failure of that question leaves every representative asked unresolved, holding no organization, as one call at a time would. `SalesRepAssignmentService` gains `hasRollupCapabilities(adminUserIds)`.
  - **`@endora-commerce/mod-projects`** adds `ProjectAccess.canSeeAsMany(adminUserIds, projectId)`: the accounts, their roles and their reach each read once, and both visibility rules evaluated for everybody in one statement. `canSeeAs` is now that check for one person. The mentionable lookup asks it once; the people it offers, their order and the limit of 20 are unchanged.

- fbb3ec7: Projects: a Stage deadline alert whose sweep died between claiming and settling it is now marked `interrupted` (issue #462), as CRM's reminder sweep marks its own. The first pass thirty minutes after the claim (`STAGE_ALERT_CLAIM_STALE_MS`) sets the outcome and logs a warning naming the delivery rows; the alert is never retried, since a bell entry or an e-mail may already have gone out. A pass that outlives the bound still records what it delivered, over the presumption. `ProjectStageAlertOutcome` gains `interrupted`; the new type `StageAlertDeliveryOutcome` is what a delivery itself can come to. A migration widens the outcome check of `project_stage_alert_deliveries` and adds a partial index on `claimed_at` for unsettled claims; nothing else in the table changes.
- 6bfd758: `@@` in an Opportunity's or a Project's text now opens the document list for a role that holds only the module's own codes (issue #498). `useCrmReferences` offers the `document` trigger to a `crm:write` holder whose role includes `crm:read`, and `useProjectReferences` to a `projects:write` holder whose role includes `projects:read`, because `GET /crm/lookups/documents` and `GET /projects/lookups/documents` already answer the module's own group (Opportunities, Projects) to every writer. Before, such a role kept `@@` as the characters it typed and was shown no _Insert document_ button, although the server had a group to offer it. A Projects group with nothing in it is an empty list, not a reason to hide `@@`. No API change.
- 939c455: The attachment lists of Tasks, Projects and CRM Opportunities resolve every file's download link in one batched `assetReadPort.resolveUrls` read instead of one `assetsLibraryPort.getAsset` call per file (issue #545). The full asset detail asked every registered asset-reference descriptor about each attached file, so a list of N files issued about 12 × N reference statements. The links are unchanged: the same signed, expiring URL for a private file, with `download=1`. A host that composes these services itself must provide `resolveUrls` on the `assets` dependency (it is part of the published `AssetReadPort`).
- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 93146d1: Resolving the references in a text no longer reads the reader's administrator record when the text mentions a Product (issue #963). The reference services of `crm`, `tasks` and `projects` still looked up the reader's preferred language and then discarded it, a leftover from per-locale product names: a Product is named by its single Global `name`. The labels shown do not change.
- 4933779: The module's documentation page states the Organization rule by reach (an Organization assigned to the representative or to no representative), names `findByIds` and `search` on `ProjectReadPort`, says the media library hides a file used only by projects the reader may not see, and renders the analytics routes as part of the API table again. English and Polish.
- 04bdf9c: A note, a message or an attachment written on a Project now locks the Project and asks again, under the lock, whether the writer may still see it (issue #471), as the Project's own writes already did. When another administrator takes the Project out of the writer's sight or reach between the check and the write — adding an Organization the writer does not reach, or taking them off a members-only Project — adding a note or a message, editing or deleting a note, and attaching or removing a file answer `404 PROJECT_NOT_FOUND` and write nothing; an upload refused this way takes its stored file back. Writes on one Project's notes, messages and attachments now run one at a time with the Project's other writes.
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
- 34eedab: Projects dictionaries no longer race (issue #453). Two creates of one default name on `/api/v1/admin/projects/roles` or `…/loss-reasons` arriving at the same moment collided on the code's unique index (reported in the issue as a `500`, answered today as `409` `VERSION_CONFLICT`) instead of answering `PROJECT_DICTIONARY_NAME_TAKEN`; a create now takes the dictionary's advisory lock inside its Command before it checks the name, picks the code and reads the next position (a rename takes it before its name check), so the second create answers `409` `PROJECT_DICTIONARY_NAME_TAKEN` and no `_2` row is written. A Role delete could also commit while a Stage save stored that Role's id in `responsible_role_ids`, which has no foreign key; the delete now takes the Role's lock exclusively before asking whether it is in use, and every Stage, Stage Task, Template, new-Project and Member write that names Roles takes each one's lock shared, in sorted order, and checks again inside it that each still exists (`422` if not: `PROJECT_MEMBER_INVALID` for a Member's Role, which used to surface as a `500` on the foreign key, `VALIDATION_FAILED` otherwise). Stage saves share the lock and do not wait for each other.
- ff60e93: A linked quote request's amount is the one `quoteRequestReadPort.amountOf` publishes (issue #456).
  - The link carries `agreement`, and the Linked records tab marks the quote request "Partially agreed" or "Not yet agreed".
  - A quote request without any price shows `—`.
  - Each line value is now rounded to the cent before the sum, as the quote desk and CRM do. Projects used to round the sum only.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- d24be0e: The module documentation pages have readable titles instead of the module id (for example _Carts_ instead of `carts`), in the docs sidebar, the module map and the browser tab, in English and Polish. Page headings and screen names in the page text are sentence case, as in the Admin UI (#795). File names and URLs are unchanged.
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

- 4bc5c7f: Project attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Projects a reader may not see — by membership and `projects:read`, the rule the Projects screens use. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/projects/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
- 11b0eb8: A new module package, `@endora-commerce/mod-projects` (module id `projects`): Projects for zero or
  more Organizations — or for none, an internal Project — run through Stages of their own by
  Members holding Project Roles, opened, completed, lost and reopened.

  - **Activation and settings.** `projects.enabled` (on by default, switchable on
    `/platform/modules`), `projects.visibility` (`members` by default, or `everyone`) and
    `projects.alerts_time_zone` (`Europe/Warsaw`). Off is non-destructive: every route answers
    `503` `MODULE_DISABLED`, every screen, panel, palette action and search hit is gone, no alert
    is sent, and everything is back as it was when it is switched on again.
  - **Migrations.** `projects_init` (Projects, their Stages, workflow, Organizations, Members and
    their Roles, listed viewers, Stage Tasks, Stage history, links, notes and messages, references,
    attachments, Templates, Project Roles and loss reasons with their seeded rows, alert
    deliveries), `projects_link_organization` and `projects_value_changes` (the values a write
    changed, which a Project's change history shows).
  - **Permissions.** `projects:read`, `projects:write`, `projects:configure` (Templates, Project
    Roles, loss reasons), `projects:analytics`, and `projects:see_all`, which lifts the visibility
    rule but never Organization reach; each of the last four requires `projects:read`. A Project
    Role grants no permission.
  - **Admin API** under `/api/v1/admin/projects`: the list (filters, search, sort, `total`, custom
    field filters) and a Project's CRUD; its Organizations, Members, Stages, workflow, moves, close
    and reopen, and Stage history; Stage Tasks and the completion gate; linked Orders, Quote
    Requests and Opportunities, and the Project a record or a Task belongs to; notes, messages,
    mentions, references, attachments (multipart upload) and change history; Templates; the two
    dictionaries; seven analytics figures, over days counted in the reporting time zone of Analytics
    (`analytics.reporting_time_zone`, `UTC` by default, `UTC` while Analytics is off); and the module's own lookups. Every read goes through
    the module's `ProjectAccess` — Organization reach and visibility — and an invisible Project
    answers exactly as a missing one.
  - **Admin UI.** The list, _New project_, a Project's screen with its tabs, Templates, Project
    Roles, Loss reasons and Analytics, in the sidebar's _Projects & tasks_ section; four palette
    actions (`open-projects`, `new-project`, `open-project-templates`, `open-project-analytics`);
    Projects in admin global search, by number, title or Organization name; a _Project_ panel on
    the Order, Quote Request, Opportunity and Task screens, and a _Projects_ panel on the
    Organization screen. English and Polish.
  - **Collaboration.** Notes and messages with `@` mentions and `@@` / `@@@` references, through the
    admin kit's components; a message notifies the Project's Members, a mention the person named,
    through the bell (`admin_notifications`, optional).
  - **Deadline alerts.** A Stage's alert days send a bell entry and the transactional e-mail
    `projects_stage_deadline_alert` (defaults in English and Polish, editable) to every Member who
    may see the Project, from a BullMQ job scheduler every fifteen minutes.
  - **Custom fields.** _Project_ is a record type on `/custom-fields`; values are validated on save,
    shown on the Project, and offered as list filters. A Project's change history shows each change
    of a custom field or of the value with the value before and after it, kept by the module itself;
    the platform audit log, which is not kept per Organization, names the changed fields only.
  - **For other modules.** `projectReadPort` (`findById`, `findByRecord`), gated;
    `projectStageGuardRegistry`, through which a guard refuses a move, close or reopen; the `project`
    Task context in Tasks' registry, which lets a Task into a Project, out of one or be deleted from
    one only for a holder of `projects:write` who sees the Project; the events `projects.project.created.v1`,
    `projects.stage.moved.v1`, `projects.project.closed.v1`, `projects.project.reopened.v1`,
    `projects.record.linked.v1` and `projects.record.unlinked.v1`; and `nextProjectNumber(em)` on
    `./backend`, the door to the `PRJ-…` number sequence.
  - **Dependencies.** Binding on `_i18n`, `admin_roles`, `admin_users`, `assets_library`,
    `audit_logs`, `auth`, `catalog`, `custom_fields`, `orders`, `organizations`, `settings` and
    `transactional_emails`; degrades without `analytics` (analytics count in UTC), `tasks` (no Tasks tab, Stage Tasks or completion
    gates), `crm`, `quote_requests` and `admin_notifications`. The package declares
    `@fastify/multipart` `^10`, `bullmq` `^5` and `ioredis` `^5` as peer dependencies, beside the
    platform's own.

  Its contract — the API schemas, `ProjectReadPort` and `ProjectStageGuardRegistryPort` — is in
  `@endora-commerce/contracts` (see that package's entry).

- 55864a1: Projects follows the new Tasks shapes and gains two reference kinds (`specs/165-task-management/`).

  - Migration `projects_reference_kinds` widens `project_references_target_type_check` to the seven reference kinds; its `down` restores the five. A Project's texts resolve `[[opportunity:…]]` and `[[project:…]]` references, and the `@@` list offers Opportunities and Projects.
  - `projectReadPort` gains `findByIds` and `search`, through the Project access seam.
  - Stage Tasks are created with a source key (the Stage Task definition's id), so retrying a Stage whose Tasks were partly created creates only the missing ones (#450). The Project's Task context answers `existingContexts`, so Tasks of a deleted Project or Stage are cleaned up by Tasks' maintenance pass.
  - The completion gate counts a Task as finished by its status category; the Tasks tab shows each Task's configured status and all its assignees.

### Patch Changes

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
