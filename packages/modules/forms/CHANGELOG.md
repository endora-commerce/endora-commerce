# @endora-commerce/mod-forms

## 0.112.0

### Patch Changes

- c878440: Un-awaited Promises found by the typed lint rules now enabled for the whole repository (issue #1027) are awaited, handled or marked as deliberate fire-and-forget. No behaviour changes:

  - `resumeWorkersFor` no longer awaits BullMQ's synchronous `Worker.resume()`; the API interceptor pre-handler is typed as Fastify's async hook.
  - The breakpoint video hook ignores a refused autoplay through `Promise.resolve(video.play()).catch(...)`.
  - Admin screens wrap async form and button handlers in `void` (each handler catches its own errors), and the admin-search matchers of catalog, orders and quote requests are typed as returning `unknown`, because a Knex builder is thenable.

- fd27113: Content and system admin screens drop the page descriptions that repeated their title or spoke the implementation (issue #1436, UX audit 2026-11-17, DS-02). No description any more on: the CMS page, block and template editors, Brand, the blog post editor (once saved) and category editor (non-system), the Forms list, New form and Entries, the megamenu editor, the Comparisons list and detail, Settings, Settings groups, Cache, Modules, Command hooks, API description, Users, Roles, API keys, Webhooks, Taxes, Audit log, Credentials, the global-search configuration and results. The Brand cards for colour schemes, spacing and preview drop their intro line, and the Home stock-alert card its subtitle.

  Moved behind a ⓘ beside the title (`help`): the Modules screen's note on installation versus activation, the document-template default rule, and the Meta Ads note that standard events are always reported.

  Shortened to one line: the document templates, Meta Ads and LinkedIn Ads descriptions, the blog addresses description, the new post and new category notes, the CMS page editor's field notes (page fields, language version, breadcrumb parent and overlay, parent path, share image), the Brand scope and type-scale notes, the forms share-answer note, the megamenu click-navigates note, the Cache screen's two action notes, the API reference note, the reset-password note and the global-search settings note.

  Translation keys removed from both `en` and `pl`: `core` `platform.modules.description`, `platform.modules.cliHint` (now `platform.modules.help`), `platform.commandHooks.description`, `platform.apiDescription.description`, `home.stockAlerts.subtitle`, `adminUsers.page.descriptionPrefix`, `adminUsers.rolesLink`, `adminRoles.page.descriptionPrefix`, `adminRoles.usersLink`, `apiKeys.page.description`, `webhooks.page.description`, `taxes.page.description`, `auditLog.page.description`; cms `pageEditor.description`, `blockEditor.description`, `templateEditor.description`, `brand.description`, `brand.schemes.hint`, `brand.spacing.hint`, `brand.preview.hint`, `brand.layout.tierHint`; blog `postEditor.description.edit`, `categoryEditor.description.default`; forms `list.description`, `create.description`, `entries.description`; megamenu `editor.description`; comparisons `list.page.description`, `detail.page.description`; settings `page.description`, `groups.page.description`, `cache.page.description`; credentials `page.subtitle`; admin_search `page.configuration.description`, `page.results.description`. New keys: `core` `platform.modules.help`, document_templates `page.help`, meta_ads `customEvents.help`. A deployment that overrides a removed key can drop the override.

- 4fdc335: More admin screens follow the DS-03 rule that a frame inside a card is a defect unless it is a field (issue #1437, UX audit 2026-11-17).

  - **My profile** is one form card with three sections (identity, author profile, password) under the one Save, and the language preference, which is saved on its own, is the one card beside it. The language Save's result is a status line beside its button, with an icon, in place of a red or green box inside the card. The language select is named by its heading. The screen is on the kit's primitives.
  - **Organization detail, price display mode** (`price_lists`, `organization.detail.after`): the panel has a heading (_Pricing_) and renders as an `EditorSection`, so it follows the mount — one titled card at page level, a section inside a host card. It was a card without a heading.
  - **Return detail** (`returns`): comments and the accepted clauses are rows divided by a rule, not a bordered box each.
  - **Settings** (`settings`): a group's settings are rows divided by a rule inside the group card, not a bordered box each; a changed row keeps its tint and its _Unsaved_ badge.
  - **Form entry notes** (`forms`): notes are rows divided by a rule, not a bordered box each.

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

- 07bbd58: The Forms and Form entries lists are now standard list pages. Their filters sit in a toolbar row above the results instead of a card header, with _Clear all filters_ at the end of the row while a filter is applied. On the entries list the search, the form and the status are always visible, the statuses are one multi-select, and the sales channel and the date range are behind _More filters_, which shows how many of them are in use. The Forms list now remembers the page size you choose. Cards across the forms screens (the builder, its settings and notifications panels, and the entry detail) use the shared card spacing, so the settings and notifications panels are slightly more compact.
- 1064839: `@endora-commerce/admin-kit/ui` publishes `EmptyState` (issue #1448): the block a list, a tab or a panel shows when it has nothing to show — a decorative icon, a title, at most one line and at most one action, drawn with the design system's `.b2b-empty` classes.

  It has two variants. `no-data` (the default) takes `icon`, `title`, an optional `description` and an optional `action`. `no-results` takes `onClearFilters` and renders the kit's own title, line and _Clear filters_ button (new `core` keys `common.emptyState.clearFilters`, `common.emptyState.noResults.title` and `common.emptyState.noResults.body`, in English and Polish); `icon`, `title` and `description` override them.

  After _Clear filters_ the kit moves focus to `focusAfterClear` (a ref, normally the list's search box) on the next frame, so focus never drops to `<body>` when the button unmounts (WCAG 2.2 SC 2.4.3). Without one, and only if focus was lost, it focuses the page's `<h1>`, else the closest container of the block still in the document. Every list that uses the `no-results` variant here passes its search box; `EntryFilters`, `OpportunityFilterFields` and `TaskFilters` gain an optional `searchRef` for that.

  ```tsx
  <EmptyState variant="no-results" title={t('list.emptyFiltered')} onClearFilters={clearFilters} />
  <EmptyState icon={<ClipboardList size={20} />} title={t('list.empty.title')} action={createButton} />
  ```

  The forms and form-entries lists, the CRM opportunities list, the task and _My tasks_ lists, the task settings lists, the project and project-template lists, the custom-fields table, the price-book list, and the product-feed list, runs, delivery and templates screens now use it. The forms list now says "No forms yet" with a line of its own (a reader is told who can create one), and it hides the header's _New form_ while the empty state carries it. The form-entries list's empty state gains a title.

- 87fb9c3: On the Settings screen a boolean setting is a switch instead of a `true` / `false` list, and an enum setting's options read as labels in English and Polish instead of machine codes (issue #1479). The switch changes the draft like every other field; the page's one Save still writes it. The default and global values under a field read as "On" / "Off" and as option labels too.

  A module labels its enum setting's options in its own bundle, under `settingLabels.<setting code>.options.<option value>`; an option without a label is shown as its value. Every enum setting shipped in the platform now has those labels, except `seo.default_robots`, whose directive pairs are the vocabulary.

- 9a27b93: New kit composite `BoardCardFieldsEditor` (`@endora-commerce/admin-kit/components`), with the types `BoardCardFieldChoice`, `BoardCardFieldsConfig`, `BoardCardFieldsEditorCopy` and `BoardCardFieldsEditorProps` (issue #1506). It edits which fields a board card shows and in what order: `load` and `save` answer `{ fields, available, maxFields }` (the catalogue and the limit come from the server), `fieldLabel` names a field, and `copy` carries the three lines that name the module's record. Its other copy is `core`'s new `boardCardFields.*` keys in `@endora-commerce/mod-i18n`.

  CRM's and Tasks' own `BoardCardFieldsEditor` copies are removed, along with their duplicated `boardCard.*` keys (the title, `shown.titleAlways`, `available.builtin` and `available.noCustom` stay). CRM's `ITEM_COUNT_LABEL_KEY` and `opportunity.tabs.counted` are removed too, because the kit's `common.tabs.counted` reads the same. The Opportunity and Project record tabs now use the kit `RecordTabs`, and the form builder's tabs use `Tabs` / `TabPanel`. The form builder's strip now looks like every other strip in the admin.

- ba15054: The form builder says which settings apply at once (issues #1512 and #1539). The Retention section on the Settings tab and the Shop notification section on the Notifications tab, which save on their own, now carry the "Applies immediately" badge on their headings; every other section is saved and published with the Save and Publish bar. The sentences that used to explain this in prose are removed, the section descriptions and field hints are cut to one line each in English and Polish, and the result of a section's own save appears beside its button. The content-language bar above the tabs is a plain row divided from the tabs by a rule instead of a separate card, and its untranslated-text marks use the warning colour of the theme.
- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- 306a659: The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — _Organizations_, _Price books_, _CMS pages_ — instead of _Back to organizations_, _All warehouses_, _Back to list_ or a bare _Back_ (follow-up of issue #1549). A generic _Back_ remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

  The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.

- 7ea72af: The way back from a detail, create or settings screen is now always the page header's back link above the title (issue #1549). Organization, New organization, Tax ID scope, Change tax ID, Convert to company, Order statuses, Return, Form entry, Category content, Product content and Comparison drew it as an outline Back button among the header actions, an arrow link above the header, or a button at the bottom of the page. Order statuses now goes back to "Orders" rather than a bare "Back". A form entry that is missing or cannot be loaded shows a "Form entry" heading with the same back link. The admin-kit README names `PageHeader` `back` as the one pattern.
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
- Updated dependencies [72637e0]
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/cms-components@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/email-components@0.112.0

## 0.111.0

### Minor Changes

- 13148d3: Issue #470 (D-288) — a form entry export's audit entry no longer carries the search text. `forms.entries.export` is recorded against the global form, but it writes about `@CustomerScoped` entries, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §2, §5).

  - `forms.entries.export` no longer records `filter.q`. With a search text, `filter` records `hasQuery: true` and `queryLength` instead; without one, neither. The statuses, submission dates, sales channel id, form id and row count are unchanged.
  - `FORMS_AUDIT_KEYS` and `FORMS_EXPORT_FILTER_AUDIT_KEYS`, constants in `src/backend/services/entry-audit-state.ts` (not on a published barrel), list every key the entry Commands' audit state may hold, held by a sentinel test.
  - No screen reads values back from the audit log, so no value store is added. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** See _A form entry export's search text leaves the platform audit log_ in the upgrade guide.

### Patch Changes

- f5db373: **A public form is read and submitted in the channel language `Accept-Language` asks for, read as a q-weighted list** (issue #1011). `GET /api/v1/storefront/forms/:formId` and `POST /api/v1/storefront/forms/:formId/entries` tried the header's tags in the order written, ignoring their `q` weights, and matched each only exactly, so `Accept-Language: en-US;q=0.2, pl-PL;q=0.9` was English and `pl` fell back to the channel default on a `pl-PL` channel. Without an offered `?language=`, the language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. That language picks the form's texts, the confirmation page and the language an entry is stored with. An offered `?language=` still wins, an unoffered one is still passed over, and a request with neither behaves as before.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- 4933779: The module's documentation page says that a form entry export's audit entry records whether a search text was used and its length, not the text. English and Polish.
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
  - @endora-commerce/cms-components@0.111.0
  - @endora-commerce/email-components@0.111.0

## 0.110.0

### Minor Changes

- 2da23d2: New module `forms` (`@endora-commerce/mod-forms`): a form builder whose forms are placed on CMS pages as the `forms.Form` Page Builder block, with stored entries, e-mail notifications, spam protection, retention and an outbound webhook event.

  - **Tables** `forms`, `form_versions`, `form_entries`, `form_entry_notes` (migration `20261102T111501_forms_init`). A form is a working copy plus immutable published versions; every entry keeps the version it was submitted against. Entries are tenant-scoped (organisation of the signed-in submitter, or none for an anonymous one) and channel-scoped.
  - **Admin API** under `/api/v1/admin/forms` (forms, versions, preview, publish, close, reopen, duplicate, delete, notifications, retention and `retention-impact`) and `/api/v1/admin/forms/entries` (list, read, mark read, status with undo, notes, delete one or many, CSV `export`). Permissions `forms:read`, `forms:write`, `forms:entries_read`, `forms:entries_write`, `forms:entries_export`; every write runs through the Command Bus and is audited without the submitted answers.
  - **Public API** `GET /api/v1/storefront/forms/:formId` (the published definition, cache tag `forms:form:<id>`) and `POST /api/v1/storefront/forms/:formId/entries` (server-side validation with the shared evaluator, honeypot, 10 submissions per client address in 10 minutes, 256 KB body limit, optional CAPTCHA, availability window, entry limit, signed-in-only forms).
  - **Queues** `forms-notifications` (shop message per recipient and an optional confirmation e-mail, retried with backoff; a job carries an entry id and a language only) and `forms-maintenance` (every 15 minutes: retention deletion, erasure of entries of anonymised customer accounts, counter repair).
  - **Settings** `forms.enabled`, `forms.captcha_provider` (`none`, Cloudflare Turnstile or hCaptcha), `forms.captcha_site_key`, `forms.captcha_secret_key`. Palette actions `open-forms`, `new-form`, `open-form-entries`.
  - **Event** `forms.entry.submitted.v1`, offered to outbound webhooks; it carries only the answers of fields marked _Share with integrations_.
  - **Error codes** `FORM_NOT_FOUND`, `FORM_KEY_TAKEN`, `FORM_DEFINITION_INVALID`, `FORM_REVISION_CONFLICT`, `FORM_HAS_ENTRIES`, `FORM_NOT_ACCEPTING`, `FORM_SUBMISSION_TOO_LARGE`, `FORM_SUBMISSION_INVALID`, `FORM_ENTRY_NOT_FOUND`, `FORM_ENTRY_STATUS_CONFLICT`, `FORM_SCOPE_REQUIRED`, `FORM_CAPTCHA_FAILED`, `FORM_CAPTCHA_UNAVAILABLE`.
  - Operator-toggleable: with `forms` off its routes, workers, subscribers, block, admin screens and webhook event type are absent; nothing is deleted, and erasure owed while it was off runs on the first maintenance tick after it is back.

### Patch Changes

- dbc1cef: `GET /api/v1/storefront/forms/:formId` answers a malformed id (one that is not a UUID) with `200 { formId, availability: 'unavailable' }`, the body an unknown id gets, instead of `400 VALIDATION_FAILED` (owner ruling of 2026-11-05, issue #781), so the read no longer tells a malformed id from a form that does not exist. `formId` echoes the requested value. To match, the `unavailable` arm of `publicFormDefinitionSchema` in `@endora-commerce/contracts` types `formId` as a non-empty string rather than a UUID; the available arm still requires a UUID. `POST /api/v1/storefront/forms/:formId/entries` still answers a malformed id `400`.
- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

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
- Updated dependencies [cc1496f]
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
  - @endora-commerce/cms-components@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0
