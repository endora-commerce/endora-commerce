# @endora-commerce/mod-document-templates

## 0.112.0

### Minor Changes

- 49328cf: **Breaking change:** a write that newly stores an asset id is now refused unless the administrator can see that file in the asset library. This covers a file that does not exist as well (issue #544). Before, these writes stored the id without checking it. A file hidden from the administrator, for example one attached only to a Task they cannot read, then appeared in the library for every reader or in public output.

  The check applies to:

  - CMS page, block and template content, and a page's sharing image (`shareImageAssetId` on page create and update).
  - A category's page content and a product's Page Builder content attributes.
  - A blog post's content and a blog category's description.
  - Document template content and the template preview. The preview renders the image bytes into the PDF, so it checks every image it names.
  - These settings: `shop.logo_asset_id`, `pwa.icon_asset_id` and `cms.default_share_image_asset_id`.
  - A sales channel's `logoAssetId`, on create and update.

  A refused write answers `404` and stores nothing. A hidden file and a missing one get the same answer. The cms, document template, settings, pwa and sales channel paths answer `ASSET_NOT_FOUND` with `details.assetId`. The catalog and blog paths answer `NOT_FOUND` with `Asset <id> not found.`, as their main-image refusal already does.

  Ids the record already stores are not checked, so existing content saves as before, including a body that still embeds a file that has since been purged. Only an id the write adds is checked.

  **What to do:** an integration or import that writes content bodies, logos or these settings must use asset ids that exist. When it runs as an administrator, that administrator must be able to see the files in the library. `sales_channels` now declares `assets_library` as a dependency. `settings` already did, so module order does not change.

### Patch Changes

- c878440: Un-awaited Promises found by the typed lint rules now enabled for the whole repository (issue #1027) are awaited, handled or marked as deliberate fire-and-forget. No behaviour changes:

  - `resumeWorkersFor` no longer awaits BullMQ's synchronous `Worker.resume()`; the API interceptor pre-handler is typed as Fastify's async hook.
  - The breakpoint video hook ignores a refused autoplay through `Promise.resolve(video.play()).catch(...)`.
  - Admin screens wrap async form and button handlers in `void` (each handler catches its own errors), and the admin-search matchers of catalog, orders and quote requests are typed as returning `unknown`, because a Knex builder is thenable.

- fd27113: Content and system admin screens drop the page descriptions that repeated their title or spoke the implementation (issue #1436, UX audit 2026-11-17, DS-02). No description any more on: the CMS page, block and template editors, Brand, the blog post editor (once saved) and category editor (non-system), the Forms list, New form and Entries, the megamenu editor, the Comparisons list and detail, Settings, Settings groups, Cache, Modules, Command hooks, API description, Users, Roles, API keys, Webhooks, Taxes, Audit log, Credentials, the global-search configuration and results. The Brand cards for colour schemes, spacing and preview drop their intro line, and the Home stock-alert card its subtitle.

  Moved behind a ⓘ beside the title (`help`): the Modules screen's note on installation versus activation, the document-template default rule, and the Meta Ads note that standard events are always reported.

  Shortened to one line: the document templates, Meta Ads and LinkedIn Ads descriptions, the blog addresses description, the new post and new category notes, the CMS page editor's field notes (page fields, language version, breadcrumb parent and overlay, parent path, share image), the Brand scope and type-scale notes, the forms share-answer note, the megamenu click-navigates note, the Cache screen's two action notes, the API reference note, the reset-password note and the global-search settings note.

  Translation keys removed from both `en` and `pl`: `core` `platform.modules.description`, `platform.modules.cliHint` (now `platform.modules.help`), `platform.commandHooks.description`, `platform.apiDescription.description`, `home.stockAlerts.subtitle`, `adminUsers.page.descriptionPrefix`, `adminUsers.rolesLink`, `adminRoles.page.descriptionPrefix`, `adminRoles.usersLink`, `apiKeys.page.description`, `webhooks.page.description`, `taxes.page.description`, `auditLog.page.description`; cms `pageEditor.description`, `blockEditor.description`, `templateEditor.description`, `brand.description`, `brand.schemes.hint`, `brand.spacing.hint`, `brand.preview.hint`, `brand.layout.tierHint`; blog `postEditor.description.edit`, `categoryEditor.description.default`; forms `list.description`, `create.description`, `entries.description`; megamenu `editor.description`; comparisons `list.page.description`, `detail.page.description`; settings `page.description`, `groups.page.description`, `cache.page.description`; credentials `page.subtitle`; admin_search `page.configuration.description`, `page.results.description`. New keys: `core` `platform.modules.help`, document_templates `page.help`, meta_ads `customEvents.help`. A deployment that overrides a removed key can drop the override.

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

- b27a76c: Every content editor now warns before unsaved changes are lost (issue #1461, UX audit CONTENT-02). The CMS page, block and template editors, the blog post and category editors, the transactional e-mail and e-mail block/template editors, the document-template editor, the megamenu editor and the newsletter campaign and automation editors compare their draft with the last saved version, show "Unsaved changes" beside Save, and ask Save / Discard / Stay before Back, the sidebar or a closed tab throws the work away. The e-mail and document-template editors also ask before a channel or language switch reloads the canvas, and saving a megamenu binding no longer reloads the stored item tree over an unsaved one.
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

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- 77d6f5c: The document-template screens follow the admin's shared patterns (issues #1532 and #1535, UX audit CONTENT-12 and CONTENT-18).

  _Document templates_ is a kit list page. It has one _New template_ button in the header, and the document type is the first field of its dialog. The type is preselected from `?type=` or the first type, and is not asked when only one type is available. The per-type cards, each with its own filled _New template_, are replaced by a section per type with one table. The table's _Applies to_ column replaces the scope sub-headings. A template's name is the link to its editor. _Duplicate…_, _Set as default_ / _Clear default_ and _Delete_ are in the row's action menu, and _Delete_ is last, apart from the others and confirmed. The built-in layout's row has _Preview PDF_ and _Create from this_ in its menu. The result of an action appears beside the header's button instead of in a banner.

  The editor is laid out in `PageBuilderEditorLayout`, like the CMS, blog and e-mail editors. There is no card around the canvas, and the language and merge fields are on the row above it, without a border of their own. Save is the shared split button with _Save and exit_. "Saved" and the default change appear beside it. The _Default_ badge is next to the title. _Preview PDF_ opens the PDF in a dialog with an _Open in a new tab_ link, both in the editor and for a built-in layout on the list, instead of a `window.open` that a pop-up blocker could stop.

- 17ac8f1: A page builder that is still loading now shows a skeleton of the builder — a toolbar over the blocks drawer, the canvas and the fields panel — instead of a grey sentence above an empty bordered box (issue #1540). The new `PageBuilderLoadingSkeleton` export is a polite `role="status"` region marked `aria-busy`, with its label as visually hidden text and its pulse off under `prefers-reduced-motion`. The CMS page, block and template editors, the blog editors and the document-template editor use it; the CMS editors now mount Puck once the block config is known, and a failed config read still shows the degraded canvas.
- 306a659: The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — _Organizations_, _Price books_, _CMS pages_ — instead of _Back to organizations_, _All warehouses_, _Back to list_ or a bare _Back_ (follow-up of issue #1549). A generic _Back_ remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

  The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.

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
- Updated dependencies [3d723ff]
- Updated dependencies [72637e0]
  - @endora-commerce/page-builder-core@0.112.0
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/page-builder-admin@0.112.0

## 0.111.0

### Patch Changes

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
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
  - @endora-commerce/page-builder-admin@0.111.0
  - @endora-commerce/page-builder-core@0.111.0

## 0.110.0

### Patch Changes

- 6459048: Polish invoice PDFs no longer print English labels (issue #437). The invoice document type's built-in layout carried English literals in its label props (_Issue date_, _Sale date_, _Payment due_, _Payment method_, _Seller_, _Buyer_, the VAT summary's _Total_, and the totals block's _Paid_, _Amount due_, _Total_ and _In words_) and in its footer text (_Thank you for your business._). A label prop wins over the translation, so an invoice, proforma or correction printed with that layout said _Paid_ where it should say _Zapłacono_. Every one of these props is empty in the built-in layout now (`GENERIC_INVOICE_TEMPLATE_SEED_REVISION` 3), and an empty prop is drawn in the document's language. The footer follows the labels: an empty or blank footer text prints the default footer in the document's language. Until now it printed an empty footer, while the editor's canvas already showed the default.

  `Migration20261107T110328DocumentTemplatesInvoiceSeededLabels` (`mod-document-templates`) does the same to stored invoice templates. In every language layout of every `invoices.invoice` template, it empties a prop only where the prop holds **exactly** the English literal the built-in layout seeded, and it advances `version` on each template it changes. Every other value stays as it is: a translated label, a reworded one, or a footer with a line added. Other document types are untouched.

  **Behaviour change on upgrade.** If an invoice template kept a seeded English label because you wanted English on Polish invoices, the label prints in Polish after the upgrade. Type the English label into the block again to keep it. The same applies to the English sample footer.

- d69e765: A path parameter that is not a UUID is answered exactly as a well-formed id that names nothing, on every customer- and admin-facing id route, mutations included, instead of `500` (issue #781). The shape is checked with `isUuidShape` from `@endora-commerce/contracts` before the database is asked, so a malformed id gets the route's own answer for an unknown record: its own not-found code (`404`), or the empty list or `204` the route gives an unknown id. Examples: `POST /api/v1/orders/:id/cancel` answers `404 ORDER_NOT_FOUND`; the returns comment, delivery-method and cancel routes and `POST /api/v1/organization/carts/:id/approve` and `/reject` answer `404 NOT_FOUND`.

  Routes whose params schema demanded a UUID answered a malformed id `400 VALIDATION_FAILED`; they now answer `404` like an unknown id (owner ruling of 2026-11-05): `/api/v1/organizations/mine/roles/:id`, `/api/v1/admin/organizations/:id/roles[/:roleId]` and `…/permission-catalogue`, `/api/v1/organizations/mine/members/:id[/role]`, every `/api/v1/admin/product-feeds/:id…`, `/api/v1/admin/feed-templates/:id` and `/api/v1/admin/feed-taxonomies/revisions/:taxonomyId…` route, `/api/v1/admin/document-templates/:id…`, `/api/v1/admin/quote-requests/:id/document-templates`, `…/document-template` and `…/pdf`, the blog `url-redirects/:redirectId` and `addresses/:id` deletes, `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId`, and `GET`, `PATCH` and `DELETE /api/v1/admin/import-export/profiles/:id` (`404 IMPORT_PROFILE_NOT_FOUND`). A client that told a malformed id from an unknown one by the `400` can no longer do so.

  Every private copy of the UUID pattern is replaced by `isUuidShape`, `UUID_SHAPE_PATTERN` or, where a filter has always asked for RFC 9562 version and variant bits (the CRM board filters), `uuidSchema`; what each check accepts is unchanged, except that the invoice-ledger delivery retry now accepts any uuid-shaped id and answers an unknown one `404` from the lookup.

- ca120cc: Every settings group a module declares now has a translated heading on the Settings screen (#884). Each module's bundle gains `settingGroups.<group code>.name` in English and Polish, so a Polish operator no longer reads group headings such as _Orders_, _Carts_ or _Security / MFA_ in English. `@endora-commerce/mod-admin-notifications` and `@endora-commerce/mod-shipments` ship translation bundles for the first time: their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
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
  - @endora-commerce/page-builder-core@0.110.0

## 0.109.0

### Patch Changes

- 0e33ca9: The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

  - `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
  - The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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

## 0.108.0

### Minor Changes

- 1df7a5e: The Line items table prints a document's groups.

  - **Contracts.** `DocumentCollectionDeclaration` gains an optional `sections(data)` answering `DocumentItemSection[]` (`{ key, kind: 'group' | 'ungrouped', label, itemIndexes, summary }`, with `documentItemSectionSchema` and `DOCUMENT_UNGROUPED_SECTION_KEY`); `isValidSectionPartition(sections, itemCount)` checks one. `itemsTableGroupingSchema` is now a union of `{ by: 'sections', otherItemsLabel, showItemCount }`, `{ by: 'none' }` and the existing field shape (with `by: 'field'` optional) — `itemsTableSectionsGroupingSchema`, `itemsTableNoGroupingSchema`, `itemsTableFieldGroupingSchema`; `itemsTableGroupingMode(raw)` reads a stored value. `documentCollectionDetailSchema` gains `sampleSections` (default `[]`). `documentSectionTexts(language)` answers the default _Other items_ heading and the plural item count in English and Polish.
  - **Changed meaning of a stored `grouping: null`.** It meant _No grouping_; it now means **the document's groups**, which is also what an absent setting means. A document with no group prints exactly as before (the flat definition is unchanged), so this changes nothing until a document has groups — then every template, including those saved before this release, prints them without being edited. A table that must stay flat whatever the document says stores `{ by: 'none' }` (_No grouping_ in the editor).
  - **Document templates.** In that mode, a document holding a group prints per section a heading row (the group's name, the item count when enabled), its rows and one subtotal row per totals row of the table over the section's totals, then _Other items_ and the document's totals. The renderer reads `sections()` once per collection per render; a host that throws, or answers a partition that does not cover its lines, is logged and the table prints flat. Route 2 serves `sampleSections`; the editor's _Grouping_ field offers _Document's groups_, _By field_ and _No grouping_, the _Other items_ heading and _Show item count_, and the canvas draws the sample's groups.
  - **Quote requests.** The quote's `lines` collection declares its sections (`quoteLineSections`), each with the quote's totals rule over its own lines; the editor's sample quote has two groups and an ungrouped line.

### Patch Changes

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

## 0.107.0

### Minor Changes

- dd939be: New module `document_templates` (`specs/152-compare-pdf-template/`): operator-designed Page
  Builder layouts for the PDF documents the platform produces.

  - Table `document_templates` (one migration): templates per document type and scope (all sales
    channels or one), at most one default per scope, one layout per language, optimistic versions.
  - `documentTypeRegistry` — a contribution registry a module pushes its document type into from a
    contribution-only boot hook; a type and each contributed block are answered only while their
    module is present.
  - `documentRenderPort` — the gated Page Builder → pdfmake engine:
    `render({ documentType, salesChannelId, language, data, templateId? })` resolves the channel
    default, the global default, then the built-in layout; `templateId` is honoured only for
    `selection: 'per_document'` types. Images come from the assets library only; pdfmake's URL
    access is denied.
  - Six general-purpose blocks (`document_templates.Heading`, `Text`, `Image`, `Spacer`, `Divider`,
    `PageBreak`), offered to types that opt in.
  - Admin API `/api/v1/admin/document-templates` (12 routes; `document_templates:read` /
    `document_templates:write`), every write a Command with one audit row.
  - Admin: _Document templates_ list and editor (palette = the template's document type), sidebar
    entry and the `open-document-templates` palette action.
  - Activation `document_templates.enabled` (default on). It cannot be switched off while
    `invoices` is on.

- d571d8c: The **Line items table** (`document_templates.ItemsTable`, `specs/153-quote-request-pdf-template/`).

  - A document type that declares a line collection is offered the table: columns chosen from the
    collection's field catalogue (1–16, each with header, width, alignment, format, empty text and a
    visibility rule _always_ / _only if any line has a value_ / _never_), an optional detail row,
    totals and grouping with subtotals. It is printed as a real table that repeats its header row on
    every page and never splits a line's row; its settings are validated when a template is saved
    (`DOCUMENT_TEMPLATE_INVALID` naming the setting).
  - The admin editor gains the table's column, detail row, totals and grouping editors, with
    **Internal** badges on fields customers do not otherwise see, and a canvas drawn with the same
    formatting as the PDF.
  - `GET /api/v1/admin/document-templates/types/:code` answers the type's `collections` (fields in
    the asked language, sample lines and totals).
  - `documentRenderPort.listChoices` answers the templates a person may pick for one document of a
    per-document type.
  - The command palette entry is also found by _quote pdf_, _offer template_, _szablon oferty_ and
    _zapytanie ofertowe pdf_.

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
