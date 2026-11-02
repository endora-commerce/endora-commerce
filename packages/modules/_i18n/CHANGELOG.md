# @endora-commerce/mod-i18n

## 0.109.0

### Minor Changes

- e64ed74: **BREAKING — a `POST /api/v1/admin/quote-requests` that omits `salesChannelId`, for an Organization not assigned to the channel the admin request resolves to (the system default, or `X-Sales-Channel`), now answers `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` where it answered `201`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. The server is the sole enforcer of the channel (owner decision 2026-10-29 "A"): the channel the request lands on, named or not, must be one of the Organization's active channels. A caller with no request scope — a worker, a CLI script, an in-process call to `RfqAdminService.createOnBehalf` — has no resolved channel and must name `salesChannelId`; without it the call is refused with the same code (`details.code: 'no_channel'`).

  An operator names the sales channel a quote request is created on for a customer. `adminCreateQuoteRequestSchema` gains an optional `salesChannelId`; `POST /api/v1/admin/quote-requests` stores the request on that channel, snapshots its line names in the channel's default language, and reports `PRODUCT_UNAVAILABLE_IN_SCOPE` warnings for that channel, refusing — before anything is written — a channel that is not one of the Organization's active channels (read through the kernel's `SalesChannelMembershipPort.listChannelsForEntity`; `RfqAdminServiceDeps` gains `channelMembership`) with the new `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`. Absent, the request is raised where the admin request resolves (the system default, or `X-Sales-Channel`) — and that channel is checked the same way, as above. The _Create quote request_ screen offers the customer's organization's active channels — preselecting the only one, else requiring a choice —, prefills agreed prices on the chosen channel (`PricePrefillRequest.salesChannelId`), and, when the answer warns, lists the unavailable products before leaving the screen. Until a channel is settled it neither prefills prices nor sends anything: a failed or refused read says so (`rfqCreate.channelsLoadError`) with a retry, inactive while it runs.

- e03e6a9: **BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
  - **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
  - **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
  - **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
  - **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has _All · Active · Inactive · Archived_ with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's _Set status_ offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
  - **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.

- 0e33ca9: The rich text's image dialog picks an image from the asset library where the host provides a picker, and its width row lays out properly.

  - `@endora-commerce/page-builder-core` exports `PageBuilderImagePickerProvider`, `useImagePicker()` and the types `PageBuilderImagePicker`, `PageBuilderImagePickerProps` and `PickedImage` (`{ url, alt? }`): a host's image picker for controls that cannot import the admin. Without a provider `useImagePicker()` answers `null`.
  - The image dialog of `RichContentEditorField` (`@endora-commerce/cms-components`), used by every rich text in the page and e-mail builders, offers **Image source: Asset library / URL** when a picker is provided: the library first for a new image, the URL for an existing one. The chosen image's address is inserted, and its alternative text when the field is empty. Without a picker only the URL, as before. The stored image node does not change.
  - The **Width** number takes the row and its unit select a fixed 76 px; they no longer fight over one width.
  - `@endora-commerce/page-builder-admin` provides the asset library as that picker inside `PageBuilderColorPaletteProvider`, and exports `AdminImagePicker` and `pickedImageFromAsset(asset, language)`: the asset's stable `fileUrl`, made absolute, and its alternative text in the admin's language first.
  - `@endora-commerce/mod-i18n` carries the dialog's new copy (`pageBuilder.fieldText.richImage.*`) in English and Polish.

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

- 3ccf23b: An art-directed image, or a section background, can keep its mobile art up to the desktop breakpoint.

  - `@endora-commerce/contracts`: `responsiveImageSchema` and `sectionBackgroundSchema` gain an optional `desktopFrom: 'tablet' | 'desktop'` (`DESKTOP_FROM_TIERS`, `DesktopFromTier` in `page-builder-values`). Unset means `tablet`, the 768 px switch, as before.
  - `@endora-commerce/page-builder-core` re-exports `DESKTOP_FROM_TIERS` and `DesktopFromTier`. The section background field offers **Mobile image or video shown on** once a mobile image or video is set; the default stores nothing.
  - `@endora-commerce/page-builder-admin`: the responsive image field offers **Mobile image shown on** once a mobile image is set.
  - `@endora-commerce/cms-components`: `Picture` writes `(max-width: 1023.98px)` on the mobile `<source>` for `desktopFrom: 'desktop'` (new export `pictureMobileMedia`). A section background's tiled image and video pair carry `data-desktop-from="desktop"` on `.cmsc-section__media`, and `useBreakpointVideo` takes an optional third argument, `{ mobileMedia }`, the query under which the mobile video plays.
  - `@endora-commerce/mod-i18n` carries the English and Polish copy.

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

- 11b0eb8: The contract surface of the new `tasks` and `projects` modules, one shared reference grammar,
  and a new sidebar section.

  **`@endora-commerce/contracts`** gains, exported from the package root:

  - `tasks.ts` — the Tasks admin API schemas (`TaskListQuerySchema`, `CreateTaskBodySchema`,
    `UpdateTaskBodySchema`, `TaskSummarySchema`, `TaskDetailSchema`, `TaskContextSchema` and their
    siblings, with inferred types), `TASKS_EVENTS` and the event payload types, `TASKS_ERROR_CODES`,
    and the interfaces another module uses: `TaskReadPort`, `TaskWritePort`,
    `TaskContextRegistryPort` with `TaskContextDescriptor`;
  - `projects.ts` — the Projects admin API schemas (`ProjectListQuerySchema`,
    `CreateProjectBodySchema`, `CloseProjectBodySchema`, `ProjectTemplateBodySchema`,
    `ProjectAnalyticsQuerySchema`, `ProjectDetailSchema` and their siblings), `PROJECTS_EVENTS` and
    the event payload types, `PROJECTS_ERROR_CODES`, and `ProjectReadPort`,
    `ProjectStageGuardRegistryPort` with `ProjectStageGuard`;
  - `record-references.ts` — the `[[<type>:<uuid>]]` reference grammar under neutral names
    (`recordReferenceTypeSchema`, `formatRecordReferenceToken`, `extractRecordReferenceTokens`,
    `splitRecordReferenceText`, `mentionedAdminUserIds`, `RecordReferenceSchema`), the `@@` lookup
    answer `RecordDocumentLookupResponseSchema`, and the shared `RecordHistoryPageSchema`;
  - `record-rich-text.ts` — the formatted-text grammar (`parseRecordRichText`,
    `formatRecordRichText`, `recordRichTextToPlain`, `isSafeRecordRichHref`).

  `ERROR_CODES` gains the codes the two modules raise — `TASK_NOT_FOUND`, `TASK_CONTEXT_INVALID`,
  `TASK_ASSIGNEE_INVALID` and the `PROJECT_*` codes of `PROJECTS_ERROR_CODES`.

  **`AdminZoneNameSchema` has a new member, `'task.detail.after'`**, with its props
  `TaskDetailZoneProps { taskId }` in `AdminZonePropsMap` — the zone a Task's screen mounts after its
  content. A consumer that switches exhaustively over `AdminZoneName` gets a compile error until it
  handles the new member.

  **The reference grammar reads five types where it read three**: `quote_request` and `task` join
  `product`, `order` and `admin_user`. Every CRM name — `opportunityReferenceTypeSchema`,
  `formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
  `splitOpportunityReferenceText`, `OpportunityReferenceSchema`, `parseOpportunityRichText` and the
  rest of `crm.ts` §9 and `crm-rich-text.ts` — is still exported, now as an alias of the shared
  one. A text stored before reads as it did. A consumer that switches exhaustively over
  `OpportunityReferenceType`, or indexes a `Record` by it, gets a compile error until it handles
  the two new members.

  **`assetReferenceKindSchema` has a new member, `'project_attachment'`** — a file a Project
  uses, which the media library then refuses to delete. A consumer that switches exhaustively over
  `AssetReferenceKind` gets a compile error until it handles the new member.

  **`AdminNavSectionNameSchema` has a new member, `'work'`**, and `@endora-commerce/admin-shell`
  declares the section after _CRM_, labelled "Projects & tasks" / "Projekty i zadania"
  (`appShell.section.work` in `@endora-commerce/mod-i18n`). It renders only while a module
  contributes a visible entry to it. A consumer that switches exhaustively over
  `AdminNavSectionName` gets a compile error until it handles the new member.

### Patch Changes

- 0e33ca9: Brand tokens for page-builder content: one set of colours, colour schemes, fonts, a type scale, button sizes, spacing and layout widths that every block reads, set globally and optionally overridden per sales channel.

  - `@endora-commerce/contracts` exports the token shape and its rules: `cmsBrandTokensSchema` / `CmsBrandTokens`, `DEFAULT_BRAND_TOKENS`, `BRAND_TYPE_TOKENS`, `BRAND_SPACE_TOKENS`, `BRAND_SCHEMES`, `brandFontSourceSchema` (system, library asset or `https:` stylesheet), the contrast helpers `assessBrandContrast`, `contrastRatio`, `relativeLuminance`, `CONTRAST_REQUIRED_BODY` / `CONTRAST_REQUIRED_LARGE`, and the HTTP shapes `putCmsBrandTokensRequestSchema`, `putCmsBrandTokensResponseSchema`, `cmsBrandTokensAdminReadSchema`, `cmsBrandTokensStorefrontResponseSchema`. `CMS_STOREFRONT_CACHE_TAGS.brand` (`cms:brand`) is the storefront cache tag a save revalidates.
  - `@endora-commerce/mod-cms` stores the tokens in a new `cms_brand_tokens` table (migration `20261022T163218_cms_brand_tokens`), serves `GET`/`PUT /api/v1/admin/cms/brand-tokens` (read with `cms.read`, write with the new permission `cms.brand`; optimistic version check, audited, a stale write is `409`) and `GET /api/v1/storefront/cms/brand-tokens` (answers on a closed sales channel too). The page-builder descriptor carries the effective `brandTokens` and accepts `?salesChannelId=`. The Admin UI adds a _Brand_ screen at `/cms/brand` with live preview and contrast warnings (saving is never blocked by them), reachable from the content navigation and the command palette (`open-cms-brand`); the page editor's preview applies the page's channel tokens.
  - `@endora-commerce/cms-components` exports `brandTokensToCss` (also at `@endora-commerce/cms-components/brand/brand-css`), which renders the tokens as `--cmsb-*` custom properties plus font links. Every block style that reads a `--cmsb-*` variable keeps the previous literal as its fallback, so a storefront that never emits the variables renders exactly as before.
  - `@endora-commerce/page-builder-core` re-exports the token types from its barrel and the values from the new `@endora-commerce/page-builder-core/brand-tokens` subpath. Colour fields may store a brand role as `token:<role>`: `BRAND_COLOR_ROLES`, `brandColorRole`, `brandColorFallback` and `resolveColorValue` (`token:primary` → `var(--cmsb-color-primary, <default>)`); the palette context gains an opt-in `brandRoles` flag, and `backgroundToStyle` resolves tokens.
  - `@endora-commerce/page-builder-admin`: `PageBuilderColorPaletteProvider` takes an optional `brandColors`; when set, the palette lists the brand colours first and a pick stores the role token. Leave it unset where content is rendered without the brand stylesheet, such as e-mail.
  - `@endora-commerce/mod-settings` lists the `cms-brand` cache namespace on the cache screen; `@endora-commerce/mod-i18n` adds the `pageBuilder.colorPalette.*` labels (English and Polish).

- 0e33ca9: A colour that inherits the surrounding text colour shows as **Inherited (text color)** in the colour field instead of the raw `currentColor`.

  - `createColorField({ label, inherit: true })`: the field's empty state is `currentColor`. It shows an empty box with the **Inherited (text color)** placeholder and a swatch marked as inherited; picking a colour sets it, and **Inherit** (or emptying the box) returns to `currentColor`. Stored values are unchanged.
  - `cms.Icons` **Color** and `cms.Social` **Icon color** use it; a new icon or social list still stores `currentColor`.
  - Any colour field shows a stored `currentColor` or `inherit` as inherited, and the empty box's `transparent` placeholder is translated. New `core` keys `pageBuilder.fieldText.color.inherited`, `.inherit`, `.inheritFor` and `.transparent` (English and Polish).

- 0e33ca9: An inline icon can have its own size and vertical offset, and a Section's or a Section group's image background and decorative backdrop can have a size, a repeat and a position.

  Nothing changes for content that does not use them: an icon with no size or offset is drawn at 1 em on the line as before, and a background with none of the new values renders the same markup and look.

  - **Inline icon size and offset.** The `inlineIcon` node of `InlineRichText` accepts optional `size` (`'0.5em'`–`'3em'` or `'8px'`–`'200px'`, `isInlineIconSize`) and `offset` (em of the text, −1 to 1, `isInlineIconOffset`), each also as `null`. `InlineRich` draws the icon at that size and moves it with `vertical-align`; `inlineIconPresentation` is exported for editors that draw it. `inlineIconNode` writes them as `data-cms-icon-size` / `data-cms-icon-offset`, the same through the DOM-free serializer and TipTap's, and reads them back. The icon dialog of the inline rich-text field sets both, edits a selected icon (**Edit icon**), and is translated through the page builder's field text.
  - **Background size, repeat and position.** `sectionBackgroundSchema` gains `size` and `repeat` for an image (`'cover' | 'contain' | 'auto' | {px} | {percent}` and `'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'`), and `decorativeSize`, `decorativeRepeat` and `decorativePosition` for the decorative backdrop; `BACKGROUND_SIZE_KEYWORDS`, `BACKGROUND_REPEATS` and `backgroundSizeToCss` are exported. An image with a natural or fixed size or a repeat is painted as a CSS background (`.cmsc-section__tile`, with the mobile image below 768 px); `contain` keeps the picture. The backdrop's values are written on the section or the group's paint layer. The Section background field offers them, with `cover`, no repeat and the top position as the defaults.

  `@endora-commerce/mod-i18n` adds the English and Polish `pageBuilder.fieldText.section.*` and `pageBuilder.fieldText.inlineIcon.*` labels; the `cms` module's documentation describes both.

- 0e33ca9: The page builder's component options panel is easier to read and no longer scrolls sideways at its usual width (about 20rem).

  - `@endora-commerce/page-builder-core`: every custom field control renders with `PB_FIELD_INPUT_CLASS`, which keeps it inside its column. The controls had named a Puck CSS-module class that Puck 0.23 renamed, so they rendered unstyled, as wide as their content, and the panel scrolled sideways wherever a colour field or a long select appeared. The colour field's swatch, text box and Palette button stay on one row that fits the panel, and each control has its own accessible name. A value per breakpoint nested inside an object or array item (an image's aspect ratio) shows one label and a Mobile / Tablet / Desktop switch instead of three columns of controls, and a breakpoint with its own value is marked; a top-level value per breakpoint stays a field of the Responsive tab. Top-level fields are separated by a rule again. New exports: `PB_FIELD_INPUT_CLASS`, `PB_FIELD_LABEL_CLASS`, `PB_FIELD_HINT_CLASS`, `FieldControlLabel`, `ResponsiveTiers`, `FIELD_TIERS`, and `PAGE_BUILDER_FIELD_TEXT`, `PageBuilderFieldTextProvider` and `useFieldText`, through which a host translates the package's own field controls. `PuckFieldLabel` takes Puck's `el`.
  - `@endora-commerce/page-builder-admin`: `PageBuilderFieldText` translates those controls from the `core` bundle and is mounted by `PageBuilderColorPaletteProvider`, so the page and e-mail editors both get it. The image field's aspect ratio uses the same breakpoint switch. The link and image fields use the shared input and label classes.
  - `@endora-commerce/cms-components`: the table and catalog fallback controls use the shared input class.
  - `@endora-commerce/mod-i18n`: `pageBuilder.fieldText.*` in English and Polish.

- 0e33ca9: A rich-text "read more" can place its summary and open upwards, an accordion gains look options, both open and close with an animation, and a highlighted phrase can take any brand colour or hex.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Read more position and reveal above.** The rich-text `readMore` node gains `chevronPosition` (`'start' | 'center' | 'end'`, `'start'` by default) and `revealAbove` (`false` by default). They add `cmsc-read-more--center` / `--end` and `cmsc-read-more--reveal-above` to the `<details>`, the same through the DOM-free serializer and TipTap's, and are parsed back from them. The sanitiser is unchanged. Reveal above shows the open passage's content above its summary through CSS order only: the summary stays the first child and the one control. The rich-text toolbar gains **Read more position** and **Show the revealed text above the summary**.
  - **Animated open and close.** A read-more passage animates its `::details-content` height and an accordion panel its height and opacity, only without reduced motion and only where the browser supports `interpolate-size` (instant elsewhere). An accordion animates only after hydration (`data-animate`), so a panel open by default does not animate on page load. Every accordion panel stays in the server HTML, `hidden` while closed.
  - **Accordion look.** `cms.Accordion` gains `icon` (`'plus' | 'chevron'`), `itemStyle` (`'plain' | 'boxed'`), `dividers` (`'none' | 'between' | 'all'`, for plain items) and `titlePadding` / `titlePaddingPx` (a spacing token or Custom px per breakpoint, on the Responsive tab). Each is unset by default and writes nothing then.
  - **Emphasis colour.** The inline rich-text `emphasis` mark accepts an optional `color` (`#rrggbb` or `token:<role>`, `null` as unset) in `inlineRichTextSchema`. It renders `data-cms-em-color` and an inline `color` on the variant's span, in `InlineRich` and through both TipTap serializers. A colour outside that grammar renders today's span. The rich-text sanitiser keeps `data-cms-em-color` on a `<span>` with a colour value only. The inline toolbar gains **Highlight colour** (brand colours, a hex, **Remove colour**). The translation codec carries the mark unchanged.
  - **Labels.** The new toolbar and dialog labels are page-builder field text (`pageBuilder.fieldText.emphasisColor.*`, `pageBuilder.fieldText.readMore.*`), and the accordion fields are labelled in English and Polish.

- 0e33ca9: Shared prop shapes for page-builder blocks, with one renderer and one editor field each, so every block links, shows buttons, images and short formatted text the same way.

  - `@endora-commerce/contracts` exports the shapes as Zod schemas and types: `linkValueSchema` / `LinkValue` (URL, page, product, category, file or a section anchor on the same page; `javascript:` and protocol-relative URLs refused), `buttonSpecSchema` / `ButtonSpec` (label, link, style, fill, size, icon and per-breakpoint values), `responsiveImageSchema` / `ResponsiveImage` (desktop and mobile source, alt text, aspect ratio per breakpoint, fit, focal point), `inlineRichTextSchema` / `InlineRichText` (bold, italic, link, line break and the `gradient` / `accent` / `muted` emphasis), `colorValueSchema` (hex or `token:<role>`), `responsiveSchema(inner)` / `Responsive<T>`, and the space, scheme and width enums. The zod-free helpers (`normalizeAnchor`, `isSafeLinkUrl`, `isAspectToken`, `plainTextToInlineRichText`, `inlineRichTextToPlain`, the regular expressions and token lists) are also importable from `@endora-commerce/contracts/page-builder-values` without bundling Zod.
  - `@endora-commerce/page-builder-core` re-exports these types and helpers from its barrel.
  - `@endora-commerce/cms-components` exports the renderers: `ButtonView`, `Picture` (art-directed `<picture>`, lazy unless `priority`), `InlineRich` / `countInlineRichWords`, `resolveLinkHref`, `colorValueToCss` / `iconColorProps`, and the inline rich-text editor field `createInlineRichTextField` with `InlineRichTextEditor`, `inlineRichTextExtensions` and the `emphasisMark` TipTap mark. Button styles are the new `cmsc-btn` classes in the shipped stylesheet.
  - `@endora-commerce/page-builder-admin` exports the editor fields: `createLinkField` / `LinkFieldControl` / `LINK_KINDS`, `createButtonListField` (up to six buttons, optionally per breakpoint), `createButtonSpecField`, `DEFAULT_BUTTON_SPEC`, `createResponsiveImageField` / `ResponsiveImageControl`, `createFileAssetField` and `listPageBuilderLinkPages`. `createButtonLinkSlugField`, the previous slug-only link picker, is exported from here as well and keeps the stored value it always wrote.
  - `@endora-commerce/mod-i18n` adds the `pageBuilder.linkField.*` and `pageBuilder.imageField.*` labels (English and Polish).

- 0e33ca9: `cms.Video` plays a self-hosted file, `cms.Image` gains art direction, an aspect ratio per breakpoint, an overlay and a caption, and images in rich text take a size, an alignment and an inline mode. Every existing option keeps its meaning, and content saved before renders as it did.

  **`cms.Video`.** A new `source` (`embed`, today's, or `file`) adds a self-hosted video: `videoAssetId` (or a direct file URL in `url`), an optional `mobileVideoAssetId` shown below the tablet width, and a `posterAssetId`. A file loads nothing until it plays (`preload="none"`), plays inline, and never carries the `autoplay` attribute; with `autoplay` it is muted and started only while on screen, never for a visitor who prefers reduced motion. `aspectRatio` keeps `16:9`, `4:3` and `1:1` and now takes every aspect token and a custom `w:h`, per breakpoint, on the editor's Responsive tab. A stored video with no `source` is an embed.

  **`cms.Image`.** New optional props: `mobileSrc` / `mobileAssetId` (a `<picture>` source below the tablet width), `ratio` (per breakpoint; the frame reserves the space), `overlay` (`none`, `solid` or `gradient`, with direction and strength), and `caption` with `captionPlacement` (`below` or `beside`). `caption` is translatable. The image is now lazy-loaded and decoded asynchronously; with none of the new props set its markup and look are otherwise unchanged.

  **Video frames.** The hero's video above the content and the `cms.MediaText` video take `media.ratio` per breakpoint; unset is the 16:9 frame they had.

  **Rich-text images.** The TipTap `image` node gains `size` (a width in px or %) and `align` (`left`, `center`, `right`), rendered as `class="cmsc-rich-img cmsc-rich-img--<align>"` and `style="width: …"`; a new inline node `inlineImage` sets an image in the line of text. The editor's image dialog inserts and edits both. The sanitiser keeps a `width` in px or % on an `<img>` only; its policy's `cleanStyle` receives the element name as an optional second argument. New exports from `@endora-commerce/cms-components`: `richImageNode`, `inlineImageNode`, `RICH_IMAGE_SIZE_RE`, `RICH_IMAGE_ALIGNS`, `ImageDialog`, `RichImageChoice`; `overlayStyle` is exported from the section frame.

  **Fields.** `@endora-commerce/page-builder-core` exports `createAspectRatioField` (a responsive aspect-ratio field: a preset or a custom `w:h`, per breakpoint) and three field-text keys (`ratio.auto`, `ratio.custom`, `ratio.customValue`, translated in `mod-i18n`). `@endora-commerce/page-builder-admin` exports `ResponsiveRatioControl`, the image field's per-breakpoint ratio control, for ratios nested in a composite value. In the CMS editor the video's files and poster, and the image's mobile image, are picked from the asset library; every field of `cms.Video` and `cms.Image` is labelled in English and Polish.

- 3ccf23b: Rich text gains a text size on selected words and more bullet-list markers.

  Nothing changes for content that does not use them: a rich text saved before renders the same markup.

  - **Text size.** The rich text toolbar's **Text size** sizes the selection with a type-scale step (`<span class="cmsc-fs cmsc-fs--<step>">`, sized per breakpoint by the stylesheet). It is stored as the `textSize` mark; the renderer and the sanitizer also accept a `font-size` in px from 8 to 200 on a `<span>` (`<span class="cmsc-fs" style="font-size: Npx">`), which the toolbar does not offer.
  - **List marker.** A bulleted list's **List marker** is **Disc** (default), **Check mark** (as the check list before), **Chevron** or **None** (`cmsc-list--chevron`, `cmsc-list--none`).
  - The server and the editor write the same markup. New `core` keys `pageBuilder.fieldText.textSize*` and `pageBuilder.fieldText.listMarker*` (English and Polish).

- 3ccf23b: Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

  - `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
  - A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
  - A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
  - `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).

- bec2e83: Polish error messages are Polish sentences. 137 `errors.*` entries in these modules' `i18n/pl.json`
  bundles were placeholders — the word "Błąd:" followed by the error code lowercased, for example
  "Błąd: product not found." — and a request with `Accept-Language: pl` received them verbatim as
  `error.message`. Each is now a sentence in Polish, for example "Nie znaleziono produktu."

  Error codes, HTTP statuses and the English sentences are unchanged; a client matching on the code
  sees no difference.

- 1a88646: English error messages are English sentences. 137 `errors.*` entries in these modules'
  `i18n/en.json` bundles were the error code in Title Case with a full stop, for example
  "Product Not Found." or "Asset Legacy Locator Cannot Harden.", and a request in English received
  them verbatim as `error.message`. Each is now a sentence in sentence case, for example
  "Product not found." or "This file cannot be made private because it is stored at an address the
  platform did not issue. Upload it again first."

  Two Polish sentences were corrected to match what the code refuses: `CANNOT_MODIFY_SYSTEM_DEFAULT`
  (`mod-sales-channels`) now says the default sales channel can be neither deactivated nor deleted,
  and `MEGAMENU_TARGET_OUT_OF_SCOPE` (`mod-megamenu`) now names a page as well as a category.

  Error codes and HTTP statuses are unchanged; a client matching on the code sees no difference. A
  client that matched on the English message text must match the new sentences.

- f261ed3: The sales channel's `isPublic` flag is retired in favour of the pricing display-mode chain
  (issue #492; closes #467). The flag was documented as anonymous-price visibility, but every read of
  it withheld prices from **everyone** on the channel, signed-in buyers included, beside a chain that
  already says "prices after sign-in" per channel: `pricing.unauthenticated_display_mode = none`.

  **Behaviour change.** Signed-in buyers on a channel that had `isPublic = false` now see prices
  according to the display-mode chain (their organization's override, else the channel's
  `pricing.default_display_mode`), where they used to see none — on the catalogue listing, the product
  page, product links, search, comparisons, and the price sort and range, which are no longer refused
  to them. Anonymous visitors on such a channel still see no prices: the migration below carries that
  half of the flag over. A channel that had `isPublic = false` **and** its own value for
  `pricing.unauthenticated_display_mode` keeps that value, so its anonymous visitors now see prices if
  that value is a priced mode. A new channel, the boot-time default channel included, no longer starts
  with prices hidden from everyone; it follows the chain like any other.

  The display-mode chain itself is unchanged (owner ruling of 2026-10-28): a product or category
  override takes precedence over the channel's `pricing.unauthenticated_display_mode`, also for
  anonymous visitors, so a product overridden to `gross_only` shows its price to guests on a channel
  whose guest mode is `none`. An organization override still applies to signed-in buyers only.

  - **`@endora-commerce/platform`.** New migration `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
    (core): every channel with `is_public = false` and no value of its own for
    `pricing.unauthenticated_display_mode` gets `"none"` as its per-channel value, then
    `sales_channels.is_public` is dropped. It refuses — rather than migrating into showing prices — a
    database that has a non-public channel but no registered `pricing.unauthenticated_display_mode`
    setting; start the platform once on the previous release, so the settings reconciler registers
    it, and migrate again. Because the column is dropped, stop processes running the previous release
    before migrating. `SalesChannel.isPublic` and `CachedChannel.isPublic` are removed;
    `SALES_CHANNELS_CACHE_KEY_PREFIX` moves from `sales-channels:v3:` to `sales-channels:v4:`, so no
    process reads an entry cached in the other shape. The default-channel reconciler no longer sets
    the flag.
  - **`@endora-commerce/contracts`.** `ResolvedSearchChannel.isPublic` is removed — drop it from the
    context you hand `SearchQueryPort`. No public HTTP shape carried the flag, so no response changes
    shape. The `SALES_CHANNEL_AUDIT_ACTIONS` documentation now says who writes each row: the identity
    Commands (with `stateBefore` / `stateAfter` snapshots) since #484.
  - **`@endora-commerce/mod-catalog`.** `CatalogResolvedChannel.isPublic` and the `isPublic` field of
    `ProductLinkService`'s storefront context are removed. The catalogue no longer skips pricing on
    a channel: prices follow the viewer's display mode (a viewer whose mode is `none` gets the
    withheld answer, `resolvedPrice.displayMode: 'none'`, where the channel used to answer
    `resolvedPrice: null`). The price controls are refused only where the page's display mode is
    `none`; the reason "This sales channel does not publish prices…" is gone.
  - **`@endora-commerce/mod-search`.** The service's `ResolvedSearchChannel.isPublic` is removed, and
    hits are always resolved for the viewer.
  - **`@endora-commerce/mod-comparisons`.** A comparison is priced for the viewer on every channel.
  - **`@endora-commerce/mod-sales-channels`.** The channel form's _Open to anonymous visitors_ hint
    gains a second line pointing to the guest display mode, with a link to _Pricing settings_
    (`identity.anonymousAccess.pricesHint`, `identity.anonymousAccess.pricesLink`, English and
    Polish). New channels are no longer written with the flag.
  - **`@endora-commerce/mod-price-lists`, `@endora-commerce/mod-i18n`.** _Pricing settings_ states,
    under the two default modes, that a channel's own value wins over them and that a product or
    category override takes precedence over both, for anonymous visitors too
    (`priceLists.displayModes.settings.precedenceHint`).
  - **`@endora-commerce/demo-composition`.** The `pl_b2b_vip` channel is created without the flag and
    a new step, _the VIP channel hides prices until sign-in_, sets its
    `pricing.unauthenticated_display_mode` to `none`; its signed-in buyers see prices. `pl_retail`
    publishes prices to everyone, as before.
  - **`@endora-commerce/mod-settings`, `@endora-commerce/cli`.** Comments only: the cache-clear
    namespace names the new key prefix, and the channel-resolution rule no longer cites the flag.

- ffb2aec: Every signed-in administrator can now read and acknowledge their own notifications on the Admin UI's bell, whatever their role. Before, the bell and its API needed `admin:read`, so a narrow role such as a sales representative had Task and CRM notifications recorded for them that they could never open.

  - `@endora-commerce/mod-admin-notifications`: `GET /api/v1/admin/notifications`, `POST /api/v1/admin/notifications/:id/read` and `POST /api/v1/admin/notifications/mark-all-read` are gated on an administrator session with no permission code. `admin:read` now decides only whether the `all_admins` broadcasts are listed, counted and acknowledgeable; for an administrator without it, a broadcast's id answers `404` like any notification that is not theirs. `AdminNotificationService.listForAdmin`, `markRead`, `markAllRead` and `countUnreadForAdmin` take a required `includeBroadcasts` flag. The module now depends on `admin_roles`, whose permission service answers that question. The permission's label is now _View notifications sent to all admins_.
  - `@endora-commerce/admin-shell`: the header shows the notification bell to every administrator while the Admin notifications module is on.
  - `@endora-commerce/mod-i18n`: the English and Polish labels of `admin:read` follow the new meaning.
  - `@endora-commerce/mod-tasks`: the module page says that every administrator reads their own notifications without a permission.

- 5038a3a: Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings) and error codes are unchanged.

  - `@endora-commerce/mod-mfa`: the four TOTP setting names (now "Admin UI — allow two-step verification", "Admin UI — enforce two-step verification", "Storefront — allow two-step verification", "Storefront — enforce two-step verification"; the `MFA_DEACTIVATION_BLOCKED` sentence quotes the new name), the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
  - `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
  - `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
  - `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
  - `@endora-commerce/contracts`: the validation message of the MFA disable request body.
  - `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.

- 70092cf: Three refusal tokens now have a sentence in English and Polish: `errors.FORBIDDEN.reorder_disabled`, `errors.INTERNAL.customer_account_organization_missing` and `errors.VERSION_CONFLICT.organization_version_mismatch`. Those refusals used to answer with the raising code's English message in every language.
- f40ce92: Kit pickers speak the admin's language and announce their state; no prop changes.

  - `Combobox` keeps a polite live region (`role="status"`) mounted beside its input and writes the open list's status into it — the loading message, the empty message, or `Results: {count}` — so a screen reader hears a finished load, an empty result and a failed search (WCAG 2.2 SC 4.1.3). It is empty while the list is closed. Its default `loadingMessage` and `emptyMessage` now come from the `core` bundle (`common.combobox.loading`, `common.combobox.noResults`) instead of English literals. A test that finds the status text with `getByText` now matches two elements, the visible row and the live region; query the listbox (`getByRole('listbox')`) or the region (`getByRole('status')`) instead.
  - `AdminUserPicker`, `CustomerPicker`, `CategorySelect`, `CustomerGroupPicker` and `SalesChannelPicker` take their default placeholder, accessible name, empty, prompt and error copy from the `core` bundle in English and Polish (`adminUserPicker.*`, `customerPicker.*`, `categorySelect.*`, `customerGroupPicker.*`, `salesChannelPicker.*`). Props that override them are unchanged.
  - `AdminUserPicker` and `CustomerPicker` prompt for a name or e-mail address until their first search answers, instead of saying "No matching …" before anything has been searched.
  - `SalesChannelPicker` labels channels by the admin language's locale (`pl` → `pl-PL`), so a Polish admin sees the Polish channel name; before, every label fell back to `en-US`. A failed load now shows its error even when the caller passes `emptyMessage`.

  `@endora-commerce/mod-i18n` ships the new `core` keys in `en.json` and `pl.json`.

- 5114576: An invoice's `paidTotal` deducts every refund made before it was issued, each once: what `payments` recorded, plus the issued refunds of the order's settled returns that never pass through `payments` — a credit-limit top-up, and a money refund of an order not paid through a gateway — and an order an operator marked `refunded` counts as refunded everything received — its total with nothing captured, what was captured otherwise — taken as the larger of the recorded refunds and what was received, never their sum. An order refunded in full that way is not invoiced (`422 INVOICE_ORDER_REFUNDED`). `@endora-commerce/mod-returns` publishes the new `returnRefundReadPort` (`ReturnRefundReadPort`, `OrderReturnRefund` in `@endora-commerce/contracts`), which `@endora-commerce/mod-invoices` reads as a `degrades-without` dependency.

  `InvoiceDetail.amountDue` is now `max(0, grossTotal − paidTotal)` and never negative, and the new required `InvoiceDetail.overpayment` is `max(0, paidTotal − grossTotal)`. The invoice PDF's totals block prints it as _Nadpłata_ (`showOverpayment`, `labelOverpayment`), the admin invoice screen as _Overpayment_, and `{{var invoice.overpayment}}` is a new merge field. A consumer that built an `InvoiceDetail` by hand adds the field.

- Updated dependencies [5d192d3]
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
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
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
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
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
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Minor Changes

- 0bd5a2b: Placement enforces minimum order quantities, records whether each line was returnable, and admin and API order intake are bounded to 200 lines.

  - **Behaviour change for API clients — placement refuses a basket below a minimum.** Checkout, one-click buy, reorder, a basket filled from a quote request, admin Create order and the external order API answer `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`, checked right after the basket is read and **before** the order value and credit checks, the order number and any stock or credit reservation — a refusal writes nothing. A line whose product record is gone answers `404 PRODUCT_NOT_FOUND` with `details.cartItemIds`.
  - **Quote exemption only while the quote is valid.** Lines seeded from an accepted quote request are exempt only while that quote request still exists, belongs to the buyer's organization, is `Approved` and within its validity, is recorded by no order, and still has a line at the agreed price in the basket. With `mod-quote-requests` switched off no line is exempt.
  - **Product names in the response language.** Every minimum refusal (placement, preview, admin create, the external API) names products in the language its sentence is written in — an admin's stored preference, otherwise the q-sorted `Accept-Language`. `OrderPlacementPort.placeOrder` takes an optional `{ language }`.
  - **New port `orderQuoteSourcePort` (`OrderQuoteSourcePort`).** `quoteSourceHonoursExemptions({ organizationId, quoteRequestId, basketLines })` answers whether a basket's quote-seeded lines keep their exemption — the checkout preview's lock-free check, published so `mod-carts` judges submit for approval as placement does. Advisory: placement confirms the source again. `false` while `mod-quote-requests` is off.
  - **Checkout preview:** `POST /api/v1/orders/preview-total` answers `belowMinimumLines[]` with the same exemptions (`kind: 'product_unavailable'` for a vanished product).
  - **Admin order preview:** a line whose product total is below its minimum is unavailable at zero price with the message code `BELOW_MINIMUM_QUANTITY` and its `minimum`, judged after the four existing codes.
  - **Behaviour change for API clients — 200-line bound.** `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview` and the external `POST /api/v1/external/orders` refuse more than 200 lines with `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, before any line is evaluated. On the external API this is a public API change: it is checked before the `Idempotency-Key` header is required and leaves no idempotency record. Admin create and the external API also refuse a request whose product total is below the pieces minimum, `details.lines[]` keyed by `index`. Both refusals — below a minimum, or a product the customer may not see — are decided **before** the customer's basket is replaced, so a refused request leaves the basket exactly as it was (it used to be cleared, or partly re-seeded with the lines that passed).
  - **Returnable at purchase.** Every placement path stamps `order_items.returnable_at_purchase` from the product's **Returnable** flag (fail-closed: a product that cannot be read is recorded not returnable). Older lines hold `null`. `OrderReturnContextPort` lines carry it as `returnableAtPurchase`.
  - **Create order screen** shows a below-minimum line's reason; `mod-i18n`'s `core` bundle gains `orderCreate.line.belowMinimum` and `orderCreate.line.belowMinimumUnknown` in English and Polish.
  - Migration `20261016T082022_orders_order_item_returnable_at_purchase.ts`.

- 0bd5a2b: Quote requests validate packaging units by id and apply minimum order quantities — refused for buyers, flagged for sales reps.

  - **Behaviour change for API clients — packaging validation.** A customer line (create, draft edit, cart → quote request) may carry `packagingUnitId`; it must be a current unit of the line's product, and the server stores that unit's catalogue name and base quantity. A line sending a packaging name and base quantity without an id is accepted only when both match one of the product's units. Anything else is refused whole with `422 PACKAGING_UNIT_MISMATCH`, `details.lines[]` with `index` and `reason`; every failure of an id has the single reason `unknown_unit` (a name gives `name_unknown` or `base_quantity_mismatch`). **A buyer request with a non-matching packaging label is now refused, including a draft edit of an existing request whose stored label no longer matches a catalogue unit.** `packagingUnitId` is returned on the admin and customer reads.
  - **Behaviour change for API clients — buyer writes refused below a minimum.** Customer create (`POST /api/v1/quote-requests`, also from the cart, quick order, a shopping list or an order clone), draft edit (`PATCH /api/v1/quote-requests/:id`) and resubmit answer `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`. Order: hidden or unpublished products as unknown first, then packaging, then minimums. A draft edit does not refuse a line left unchanged; a line is matched to its stored row by the packaging unit's id first, so a unit renamed in the catalogue since does not make the line "changed" (it keeps its exemption and its stored reference price). Resubmit is judged as a new request; **a resubmit of a request whose product no longer exists now answers `404 PRODUCT_NOT_FOUND`**.
  - **Product names in the response language.** The minimum and packaging refusals of a buyer's create (also from the cart, quick order and a shopping list), draft edit and resubmit name products in the language their sentence is written in (q-sorted `Accept-Language`, else the channel default); `createForCustomer` takes `options.language`.
  - **Sales-rep writes warn.** Create on behalf, Modify, the admin's order clone and the admin quick-order build write below-minimum lines; `GET /api/v1/admin/quote-requests/:id` gives each such line `minimumWarning` (`{ kind, minimum, packagingUnitName? }`), shown as a _Below minimum_ badge on the quote request screen. It never reaches the customer read.
  - `RfqCustomerPort.createForCustomer` accepts `options.minimums` (`'enforce' | 'warn'`).
  - `mod-i18n`'s `core` bundle gains `rfq.detail.minimum.pieces`, `rfq.detail.minimum.packagingUnit` and `rfq.detail.minimum.packagingUnitUnnamed` in English and Polish.
  - Migration `20261018T122118_quote_requests_item_packaging_unit_id.ts` adds `quote_request_items.packaging_unit_id`.

- 0bd5a2b: Returns honour the per-line returnable flag recorded at purchase; complaints stay unrestricted.

  - **Behaviour change for API clients.** `GET /api/v1/orders/:orderId/returnable` gives each line `returnable` and, when it may not be returned, `notReturnableReason: 'product_not_returnable'`. **`eligible: false` with the new reason `no_returnable_lines` still allows a complaint** — `eligible` answers for `return`-kind cases only.
  - `POST /api/v1/returns` with `kind: 'return'` naming a line recorded as not returnable is refused with `422 RETURN_LINE_NOT_RETURNABLE` (`details.productName`, `orderItemIds[]`, `lines[]`). Complaints are never restricted.
  - **Behaviour change — a complaint on a non-returnable line refunds nothing by default.** A `complaint` line recorded as not returnable at purchase is stored with `approvedRefundAmount` `0`; its `defaultRefundAmount` stays the amount paid (the settlement cap). The admin settlement form now pre-fills each line from its stored approved amount rather than from the amount paid, and the case view marks such a line **Not returnable at purchase** (`mod-i18n` `core` key `returns.detail.notReturnableAtPurchase`, English and Polish). The case detail's items carry `returnableAtPurchase`, read through `OrderReturnContextPort`.
  - **Duplicate order lines in one request are summed** per order line, for both kinds, and checked against the remaining quantity (`qty_exceeds_returnable`). An unknown line is reported before any quantity error.
  - Lines of orders placed before this release carry no recorded value and count as returnable. **FR-034: products default to not returnable, so lines of orders placed after the upgrade are not returnable until their products are marked** in the catalogue (Bulk edit → Returnable); orders placed before the upgrade are unaffected.
  - New bundle sentence `errors.RETURN_LINE_NOT_RETURNABLE` in English and Polish.

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

- c8aa175: Quote request lines can be arranged in named, ordered groups.

  - **Admin API.** `PATCH /api/v1/admin/quote-requests/:id` and `POST /api/v1/admin/quote-requests` accept `groups` (`{ key, id?, name }`, in display order) and a per-line `groupKey`. A body with `groups` replaces the grouping (an `id` keeps a group across a rename; a stored group not named is deleted; its lines become ungrouped); a body with `items` and no `groups` keeps every paired line in its group; `groups` without `items` answers 400; a group id of another quote answers `422 VALIDATION_FAILED` at `groups.<i>.id`. The grouping is written under the existing row lock and recorded on the `quote_request.modify` / `quote_request.create_on_behalf` audit entry (`stateBefore.groups`, `stateAfter.groups` as `{ name, lineCount }`). A save that only regroups is an ordinary revision.
  - **Replies.** Every quote reply answers `itemGroups` (admin: every group, empty ones included; customer: groups holding a line only) and each item's `groupId` and `position`, with `items` **in display order** — the reply read had no order before. The customer comparison may carry `{ kind: 'grouping' }`; the admin history lists the five new change kinds. Customer bodies accept no grouping (`PATCH` refuses `groups`; a create body's keys are stripped as before); a customer draft edit keeps every paired line's group; resubmission copies none.
  - **One product on several lines.** A quote may hold one product and variant on several lines, in different groups or in one. Lines without an id pair with stored lines by group and quantity first (draft edits, API clients, revision comparisons); the customer comparison pairs revision lines one to one instead of by product, and an entry about a product on several lines names its group (`groupName`), as the admin history's line reference does. A `PATCH` line may carry `splitFromId`: a new line split off a stored line keeps its variant, packaging unit, proposal, note, currency and reference. The _Modify_ tab offers _Split line_; the create screen lets a product be added again and keys its price prefill by line.
  - **Read port.** `quoteRequestReadPort.listItems` answers lines in display order with `position` and `group`.
  - **PDF data.** The document data carries `groups` and each line's `groupId` / `position`, lines in display order; the quote PDF prints them as sections (see the document-sections changeset).
  - **Admin screens.** The detail _Modify_ tab and the create screen group lines with the line groups editor, with a summary per group; _Overview_ shows the groups read-only.
  - **Migration** `20261020T171341_quote_requests_quote_request_item_groups.ts` creates `quote_request_item_groups` and adds `quote_request_items.group_id` (on delete set null) and `position` (default 0, no backfill).
  - `mod-i18n`'s `core` bundle gains `rfq.detail.history.change.{group_added,group_removed,group_renamed,line_group,line_order}`, `rfq.detail.history.ungrouped` and `rfq.detail.history.lineInGroup` in English and Polish.

- e1b173f: The shared `core` bundle gains the editable grid's strings, in English and Polish (feature 161): `editableGrid.instructions`, `editableGrid.editorLabel` and the live-region sentences `editableGrid.announce.{pasted,pasteSkipped,filled,cleared,undone,redone,nothingToUndo,nothingToRedo,readOnly}`. Additive; no key changes or goes.
- 53e88c7: _Send feedback_ beside the release in the Admin UI sidebar (an icon of its own when the sidebar is collapsed), shown while the `admin_feedback` module is present. It opens a dialog — the feedback (required), the sender's e-mail (the signed-in administrator's, editable) and an optional phone — that posts to `POST /api/v1/admin/feedback`, and says every outcome: thanks, sending switched off on the instance, too many messages, or not delivered, always with `support@endora.software` to write to by hand and with what was typed kept. New `appShell.feedback.*` keys in the core bundle (EN, PL); `theme.css` gains `.b2b-sidebar__feedback` and `.b2b-sidebar__feedback-rail-row`.
- 8f0fd0e: A typed money amount with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED`, never rounded (issue #417, owner ruling of 2026-10-24).

  - `@endora-commerce/contracts`: new `money-input` module — `twoDecimalAmount(schema)` for a number schema, `twoDecimalAmountString(schema)` for a decimal string, `addAmountPrecisionIssue(ctx, path)` for a `superRefine` that decides per field, `hasAtMostTwoDecimals(value)`, `isAmountPrecisionIssue(issue)` and the `AMOUNT_PRECISION_EXCEEDED` constant; new `ERROR_CODES.AMOUNT_PRECISION_EXCEEDED`.
  - `@endora-commerce/platform`: the error envelope answers `400 AMOUNT_PRECISION_EXCEEDED` when every failed issue of a request is the precision issue, whether the route validated through the type provider or parsed the body itself; a request failing anything else as well stays `VALIDATION_FAILED`, the precision issue listed among its details.
  - `@endora-commerce/mod-i18n`: declares the code in the platform block, with its sentence in English and Polish.

- a8919dc: A unit price keeps up to four decimal places, unrounded, from the price book to the invoice line; only the line value is rounded (owner ruling of 2026-10-25).

  - `@endora-commerce/contracts`: new `unitPriceHalfUp(value)` (a unit price at its four places, as `numeric(14,4)` stores it), `unitPriceFractionDigits(value)` and `unitPriceDisplayText(value)` (the one display rule: two places when places three and four are zero, otherwise the significant places, up to four), `grossUnitPriceHalfUp(net, rate, unit?)` (a displayed gross unit price: two places for a two-place net, four for a sub-cent one) and `UNIT_PRICE_PLACES`. In `money-input`: `fourDecimalUnitPrice(schema)`, `fourDecimalUnitPriceString(schema)`, `hasAtMostFourDecimals(value)`, `isUnitPricePrecisionIssue(issue)` and the `UNIT_PRICE_PRECISION_EXCEEDED` constant; new `ERROR_CODES.UNIT_PRICE_PRECISION_EXCEEDED`. A quote's `desiredUnitPrice` (`createQuoteRequestLineSchema`) and `agreedUnitPrice` (`adminCreateQuoteRequestLineSchema`, `adminPatchQuoteRequestLineSchema`) now accept four places; a fifth is refused with the new code. Typed money amounts keep `twoDecimalAmount`. A `money` document value (`documentValueSchema`, `DocumentValue`) takes an optional `unitPrice: true`, and `formatDocumentValue` shows such a value with its significant places, up to four, never fewer than the format's `decimals`.
  - `@endora-commerce/platform`: the error envelope answers `400 UNIT_PRICE_PRECISION_EXCEEDED` when every failed issue of a request is the unit-price precision issue; a request refused for an amount and a unit price at once stays `VALIDATION_FAILED`.
  - `@endora-commerce/mod-i18n`: declares `UNIT_PRICE_PRECISION_EXCEEDED` in the platform block, with its sentence in English and Polish.

### Patch Changes

- 815daa8: The shared admin bundle drops 161 `priceLists.*` strings, in English and Polish, that nothing reads since feature 160 replaced the price-list screens with the price-book editor: the old list, create and detail pages (tabs, products, bulk add, picker), the Application rule builder, the per-currency bracket editor and the linked-lists panel. The `priceLists.displayMode.*` and `priceLists.displayModes.*` strings the display-mode screens use, and `priceLists.loading` and `priceLists.dismiss`, stay.
- 256e488: The `price_lists` manifest describes price books (feature 160): the module description reads _Price books — base, catalogue, buyer and sale prices per currency, sales channel and audience — and price display modes._, and the permissions _View price books and display modes_ (`price_lists:read`) and _Edit price books, base prices and display modes_ (`price_lists:write`), in English and Polish. They named brackets, pricing rules and a rule-based engine the module no longer has.
- 4d07648: The price display-mode page is titled _Pricing settings_ (feature 161, FR-025). Old: `priceLists.displayModes.title` "Price display modes" / "Tryby prezentacji cen" and its settings card `priceLists.displayModes.settings.title` "Pricing settings" / "Ustawienia cenowe". New: the page title is "Pricing settings" / "Ustawienia cenowe" and the card "Default display modes" / "Domyślne tryby prezentacji cen". No key is added or removed.
- 5669aee: The core bundle titles the quote request history's new `custom_field_carry_skipped` entry ("Custom field values not carried from a sales opportunity"), in English and Polish.
- 56b075d: The _Place order_ action on an approved Quote Request in the Admin UI works. It posted to the storefront's `POST /api/v1/quote-requests/:id/convert-to-order`, which is customer-only: an administrator's session answered `401`, which the Admin UI reads as an expired session, so the operator was signed out — and an accepted call would have seeded the administrator's own basket.

  `@endora-commerce/mod-quote-requests` adds `POST /api/v1/admin/quote-requests/:id/prepare-customer-basket`, behind the module's `rfqs:handle` permission and the sales-representative scope of the other admin actions. It puts the approved request's lines into the basket of the customer who owns the request, at the agreed unit prices — replacing what that basket held, exactly as the customer's own conversion does and under the same rules — and records `quote_request.prepare_customer_basket` in the audit log. The customer completes the order at checkout. `@endora-commerce/contracts` exports its response schema, `adminPrepareCustomerBasketResponseSchema` (`cartId`, `customerAccountId`, `itemCount`).

  The Admin UI button calls it after a confirmation that names the replaced basket, and is labelled _Prepare the customer's basket_ (`@endora-commerce/mod-i18n`, English and Polish).

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
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
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0

## 0.107.0

### Minor Changes

- 70bb5e5: New `core` strings, in English and Polish, for the admin quote-request screen: `rfq.detail.reference.*` (reference price, proposal and difference columns; _price at request_ / _current price_ / _no price_; _per base unit_), `rfq.detail.history.*` (history entries, changes, actors, roles, loading, error and truncation notices; the truncation notice takes the event window as `{count}`) and `rfq.detail.modify.lineGroup` (_Line {number}_, the accessible name of a Modify line that has no product name yet). Removed: `rfq.detail.column.desired` and `rfq.detail.modify.desiredPrice`, which the screen no longer renders; the proposal column is now labelled by `rfq.detail.reference.column.proposed`.
- bf9881f: The command palette finds records as well as screens and actions.

  On every open the palette asks `GET /api/v1/admin/global-search/capability`; when the answer names
  at least one record type, typing at least the minimum search length searches records after a 250 ms
  pause (the previous request aborted, a stale answer ignored) and shows one group per record type
  after _Actions_, with server-resolved titles, a status badge, a "more results" hint and a note for a
  type that could not be searched. Records join the palette's one Arrow/Enter list; a final row opens
  `/global-search?q=…`. A refused or failed probe — global search switched off or not installed —
  leaves the palette exactly as it was. A live region announces the number of records found.

  The `core` bundle gains five keys in English and Polish: `appShell.palette.records.searching`,
  `.more`, `.unavailable`, `.seeAll` and `.announce`, so a host needs `@endora-commerce/mod-i18n` at
  this version.

- dd939be: The shared admin bundle drops the `invoiceTemplates.*` keys and `appShell.nav.invoiceTemplates`
  (the invoice template screens moved to the `document_templates` module, which ships its own
  strings), and relabels `adminRoles.permission.invoices:write` in English and Polish
  (`specs/152-compare-pdf-template/`).
- 2933bf0: `@endora-commerce/admin-kit/components` publishes two new components. `ModalDialog` (with `ModalDialogProps`) is the dialog primitive `crm` used to keep to itself: a titled panel over a scrim with an accessible name, a focus trap, Escape and scrim to close, and a `busy` flag that makes both inert. It gains two optional props, `initialFocusRef` (focused on open instead of the first focusable element) and `finalFocusRef` (focused after close instead of the opener, read at close time); without them it behaves as before. `useFocusTrap` accepts the same two refs through a new optional third argument (`FocusTrapOptions`). `SavedViewsControl` (with `SavedViewsControlProps` and `SavedViewState`) is the saved-views selector with _Save view_ and _Delete view_, both through dialogs rather than the browser's native prompts: the caller passes the list's saved-view endpoint, its current state and an `onApply` callback, and the control lists, creates and deletes views through the kit's `apiClient`. A name the server refuses as taken (`409`) is shown in the save dialog with the name field marked invalid until the next keystroke. It never sends an update.

  `crm` imports `ModalDialog` from the kit instead of its own copy, which is deleted. No behaviour changes.

  The `core` bundle gains eighteen `savedViews.*` keys in English and Polish — the copy `SavedViewsControl` and its dialogs render.

- 5865c59: The API description is available to administrators with the `platform.api_description.read` permission and to API keys with the `platform.api_description.read` scope.

  **`@endora-commerce/platform`.**

  - New permission `platform.api_description.read` (_Read the API description_), declared by `_lifecycle`'s manifest with English and Polish labels. The platform administrator grants it through an admin role.
  - `GET /api/v1/_openapi.json` and `GET /api/v1/_docs` now answer only an administrator holding the code or an API key whose scopes include it. Anybody else is answered `401 UNAUTHORIZED` (no administrator session or key, a customer session included) or `403 FORBIDDEN` (an administrator or a key without the code). Both stay outside the sales-channel access rule (`salesChannelAccess: 'open'`). Responses carry `Cache-Control: private, no-store`.
  - New admin route `GET /api/v1/admin/api-description`, gated on the same code, serving the same document to the Admin UI.
  - `buildServer` no longer mounts the two routes. It decorates the root instance with `apiDescription(): OpenAPIV3_1.Document` (built on first call, as before), and `_lifecycle` mounts the routes where `auth`'s `requireAdmin` port is available. A composition that mounts no `_lifecycle` serves no API description; one that called `buildServer` and read `/api/v1/_openapi.json` in-process reads `app.apiDescription()` instead, or sends credentials. `registerOpenApiRoutes` is removed; it was reachable only through the host-internal `./http/openapi` subpath.
  - The reference page loads `swagger-ui-dist@5.33.3` from jsDelivr with Subresource Integrity on both files (`swagger-ui.css` `sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW`, `swagger-ui-bundle.js` `sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K`) and `crossorigin="anonymous"`; it used to load an unpinned version.
  - A command-palette action, _API description_, targets `/api-description` and requires the new code.

  **`@endora-commerce/contracts`.** `apiKeyScopeSchema` gains `'platform.api_description.read'`, so an administrator who holds the code can issue an API key that reads the API description.

  **`@endora-commerce/admin-shell`.** New kernel-served screen `/api-description` (_System → API description_, gated on `platform.api_description.read`): the document's title, version and endpoint count, a JSON download, and a link that opens the interactive reference on the API's own address in a new tab, carrying the administrator session.

  **`@endora-commerce/mod-i18n`.** The screen's strings and its navigation label in English and Polish (`platform.apiDescription.*`, `appShell.nav.platformApiDescription`).

  **`@endora-commerce/mod-api-keys`.** The module page lists the new scope.

### Patch Changes

- 2420ff9: The `core` bundle gains, in English and Polish, the strings of the price list's bulk add through
  the product browser: `priceLists.detail.picker.alreadyOnList`, `priceLists.detail.bulkAdd.error`,
  the cause-specific `priceLists.detail.bulkAdd.error.conflict`,
  `priceLists.detail.bulkAdd.error.forbidden`, `priceLists.detail.bulkAdd.error.invalid` and
  `priceLists.detail.bulkAdd.error.notFound`, `priceLists.detail.bulkAdd.failed` (with `{count}`
  and `{products}`), `priceLists.detail.bulkAdd.failed.product_not_found` and
  `priceLists.detail.products.add.noPermission`. `priceLists.detail.picker.title` now reads "Add
  products" / "Dodaj produkty". The single-product drawer's `priceLists.detail.picker.empty`,
  `priceLists.detail.picker.error.load`, `priceLists.detail.picker.searchPlaceholder` and
  `priceLists.detail.picker.subtitle` are removed, as are `priceLists.detail.picker.cancel`,
  `priceLists.detail.products.error.add` and `priceLists.detail.products.loadingProduct`; nothing
  reads them any more.
- 97d24cf: The `core` bundle gains the `productBrowser.*` strings in English and Polish, used by the admin
  kit's `ProductBrowserDialog`, `ProductBrowserTrigger` and the rule-aware `ProductPicker`: the
  trigger and its missing-permission hint, the status tabs, the type filter, the search
  placeholder, the column headers, translated product statuses and types, the reasons a product
  cannot be selected, the selection footer (`productBrowser.action.confirm` is "Add {count}" /
  "Dodaj {count}"), the per-confirm limit notice, and the loading, empty, load-error and
  confirm-error states. No existing key changes.
- 519fecb: **Create order** shows **Items** and **Order summary** only once both the customer and the sales
  channel are chosen — the two inputs pricing needs; payment method, delivery method and addresses
  do not gate them. Until then one hint names what is missing. The summary still appears only after
  the first priced line. Clearing either field hides both sections without discarding the lines,
  which come back when the field is set again and still count as unsaved work for the
  leave-the-page prompt. A page opened with `customerAccountId` and `salesChannelId` in the query
  string shows **Items** at once.

  The `core` bundle gains `orderCreate.gate.missingCustomer`, `orderCreate.gate.missingChannel` and
  `orderCreate.gate.missingBoth` in English and Polish. No existing key changes.

- 708a3e3: The admin order preview says why a line cannot be ordered, and refuses a sales channel that does not exist.

  **Two new message codes on `POST /api/v1/admin/orders/preview`.** A line is now also unavailable
  when the customer's Organization may not see the product (`PRODUCT_NOT_VISIBLE_TO_CUSTOMER`) or
  when the product is not in the assortment of the sales channel named by the request body's
  `salesChannelId` (`PRODUCT_NOT_IN_SALES_CHANNEL`). Each unavailable line carries exactly one
  `messages` entry, the first that applies in the order `PRODUCT_NOT_FOUND`,
  `PRODUCT_NOT_VISIBLE_TO_CUSTOMER`, `PRODUCT_NOT_IN_SALES_CHANNEL`, `QUOTE_ONLY`
  (`ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` in `@endora-commerce/contracts`). An unavailable line
  keeps the existing shape — `unitPrice: '0'`, `lineTotal: 0`, `unavailable: true` — and adds
  nothing to the subtotal or VAT. The request and response schemas are unchanged; `messages[].code`
  stays a string, so a client that does not know a code keeps parsing the response. A soft-deleted
  product is priced as before.

  **Behaviour change: an unknown `salesChannelId` is now refused.** The preview used to fall back
  silently to any active channel when the body's `salesChannelId` named none, and priced the
  basket on that other channel. It now answers **404 `NOT_FOUND`** (the route's existing
  not-found error) before any line is evaluated, so the channel a preview is priced on
  and the channel its assortment is checked against are always the one the operator chose. The
  route is admin-only (`orders:write`); an admin client that sends a stale channel id now receives
  the error instead of a preview priced on a different channel. Order creation
  (`POST /api/v1/admin/orders`) is not changed by this release.

  **Create order adds products through the product browser.** Inside **Items** — shown once the
  customer and the sales channel are chosen — **Browse products** opens the shared picker on the
  Active tab, where grouped and bundle parents, draft and inactive products, and products already on
  the order are listed with their reason and cannot be ticked; up to 200 ticked products, across
  pages and filters, are added in one step as lines of quantity 1. Beside it a quick search by name
  or SKU appends one product under the same rules. The per-line product search and **Add item** are
  gone: each line shows the product's name and SKU, an editable quantity (a whole number of 1 or
  more — anything else marks the line, keeps it out of the preview and blocks submit), the unit
  price, the line total and a remove action. A line the preview reports unavailable shows that
  cause's reason instead of a price — "The customer cannot see this product" for
  `PRODUCT_NOT_VISIBLE_TO_CUSTOMER`, "Not in this sales channel's assortment" for
  `PRODUCT_NOT_IN_SALES_CHANNEL`, and **No price** for `PRODUCT_NOT_FOUND`, `QUOTE_ONLY` and any code
  the screen does not know — and blocks submit until it is removed; a refused preview (such as a
  sales channel deleted meanwhile) shows **Could not calculate prices** and marks no line. The
  created order still carries exactly the lines and quantities on screen, in the unchanged payload
  shape. The `core` bundle gains `orderCreate.items.browse`, `orderCreate.items.quickSearch`,
  `orderCreate.items.empty`, `orderCreate.line.notVisible`, `orderCreate.line.notInChannel` and
  `orderCreate.line.quantityInvalid` in English and Polish, and loses `orderCreate.addItem`, which
  nothing reads any more.

- b4fbb1c: **Create quote request** adds lines through **Browse products** — the admin kit's shared product
  browser, many products at once — and a quick search by name or SKU beside it; the per-row product
  search and **Add line** are gone. Draft and inactive products can be added; grouped and bundle
  parents are shown with a reason and cannot; a product already on the request is marked as already
  added. Each line shows name and SKU, an editable whole-number quantity (default 1), an editable
  agreed unit price and remove.

  The agreed unit price is prefilled from the customer's price lists through a queue with at most
  four requests in flight, and a response is applied only while it still answers the line's current
  product, quantity and customer. **A hand-typed agreed price is no longer overwritten** — before,
  changing the quantity or the customer replaced it. A prefilled price answers one quantity, so
  once the quantity is no longer a valid one that price is cleared and the line is marked. On a
  customer change every price not typed by hand is cleared and resolved again for the new
  customer, so it may become empty; lines added before a customer is chosen are prefilled once one
  with an organization is.

  **Incomplete lines block submit instead of being dropped**: a line with no agreed price or an
  invalid quantity is marked and the request cannot be sent until it is fixed or removed; every line
  on screen is sent. The running total counts the lines with both a valid quantity and a price.

  The `core` bundle gains `rfqCreate.items.browse`, `rfqCreate.items.quickSearch`,
  `rfqCreate.items.empty`, `rfqCreate.line.priceMissing` and `rfqCreate.line.quantityInvalid` in
  English and Polish, and loses `rfqCreate.addItem`, which nothing reads any more.

- d571d8c: The quote request History gains the _PDF sent to the customer_ entry and its recipients, template,
  language and message lines, in English and Polish (`specs/153-quote-request-pdf-template/`).
- ad55813: E-mail HTML previews are drawn in sandboxed frames that do not run scripts: the e-mail editor's full preview and the newsletter campaign preview carry `sandbox=""`, and the e-mail editor's inline preview of an embedded block or template is drawn in a script-less frame sized to its content instead of being injected into the editor's document. The inline frame's title is the new `core` key `pageBuilder.emailPreview.embedTitle` (English and Polish).
- 882e88f: The order list's saved views now run on the admin kit's `SavedViewsControl` (#288).

  - Saving a view opens one in-app dialog that asks for the name and whether to share the view, instead of two browser prompts. The name is checked as it is submitted — empty, too long, containing characters that cannot be used, or already used by one of your own views — and a server refusal is shown inside the dialog with what you typed kept.
  - Deleting a view asks for confirmation in an in-app dialog that names the view and, for a shared view, warns that it disappears for every admin who can open the list. _Delete view_ is offered only for a view you may delete.
  - Both dialogs are keyboard-operable (focus moves into the dialog, stays there and returns to the control afterwards; Escape cancels) and translated in English and Polish. A shared view is announced as shared in the selector, in words rather than a star.
  - Loading a view saved without a sort applies the list's default sort (newest first) instead of failing.
  - Loading a view returns the list to its first page and clears the row selection, without first requesting the old page under the view's filters.

  `@endora-commerce/mod-i18n` drops the four `orders.views.*` keys the replaced component read; the control reads the `savedViews.*` keys added earlier in this feature.

- Updated dependencies [fcf4d09]
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
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
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

- a65b215: An administrator changing their own password has to supply the current one.

  **Breaking for API clients of `PATCH /api/v1/admin/me`.** The route used to store whatever
  `password` it was sent: a signed-in session was the only proof asked for, so anybody holding one —
  an unattended browser, a copied cookie — could replace the password and keep the account. A
  request that carries `password` must now carry `currentPassword` as well:

  ```jsonc
  // before
  { "password": "<new password>" }
  // now
  { "password": "<new password>", "currentPassword": "<current password>" }
  ```

  - `password` without `currentPassword` is refused with `400 VALIDATION_FAILED`, the issue naming
    the `currentPassword` field.
  - A wrong `currentPassword` is refused with `403 CURRENT_PASSWORD_INVALID`. It is 403 and not the
    401 the buyer-side change-password route answers with, because the Admin UI treats every 401 as
    an expired session and signs the administrator out.
  - A refused request changes nothing: a first or last name sent in the same request is not applied
    either.
  - A request without `password` is unchanged — first and last name stay editable without any
    password, and a `currentPassword` sent alone is ignored.

  The current password is checked with the same hash verification sign-in uses. Nothing else about a
  password change moves: the administrator's sessions and second factor are left as they were.

  `updateAdminUserSelfRequestSchema` in `@endora-commerce/contracts` gains the optional
  `currentPassword` field and the rule that ties it to `password`; `UpdateAdminUserSelfRequest` gains
  the field. `AdminUserService` in `@endora-commerce/mod-admin-users` gains `updateSelf(id, input)`,
  which the route calls, and `AdminUserService.update` no longer accepts `password` — it was the
  unverified write, and the route was its only caller.

  The other ways to set an administrator's password are untouched: creating an account,
  `POST /api/v1/admin/admin-users/:id/password` (a peer reset, gated by `admin_users:manage`) and the
  `admin_users create` command.

  **Admin UI.** The profile screen has a "Current password" field above "New password". It is asked
  for only when a new password is typed, and a wrong one is reported on the field itself, not in
  the page banner.

  **Sentences.** `errors.CURRENT_PASSWORD_INVALID` in the `core` bundle reads "The current password
  is incorrect." / "Obecne hasło jest nieprawidłowe." instead of the placeholders "Current Password
  Invalid." / "Błąd: current password invalid." — the buyer-side change-password route answers with
  the same code, so its message changes too. Three keys join the bundle in English and Polish:
  `profile.field.currentPassword`, `profile.field.currentPasswordHelp` and
  `profile.error.currentPasswordRequired`.

- 9260c36: An administrator's sessions are revoked when the credential behind them is withdrawn.

  Three writes used to leave every session of the account answering:

  - **Changing your own password** (`PATCH /api/v1/admin/me`) replaced the hash and nothing else, so
    a browser signed in elsewhere — the one the password was being changed because of — stayed
    signed in for up to thirty days. It now revokes **every other session of the account**: the
    sign-ins on other browsers and devices and the impersonation sessions the administrator started.
    The session the request was made from is kept, no new cookie is issued, and the profile screen
    stays open. A refused change (wrong or missing `currentPassword`) and a name-only edit revoke
    nothing.
  - **Deactivating an administrator** (`PATCH /api/v1/admin/admin-users/:id` with
    `status: 'inactive'`) and **deleting one** (`DELETE /api/v1/admin/admin-users/:id`) now revoke
    every session of the account. A permission check already refused an inactive account, but a
    route gated on the session alone — `GET` and `PATCH /api/v1/admin/me` among them — kept
    answering it, and reactivating the account brought the old sessions back.

  A peer reset (`POST /api/v1/admin/admin-users/:id/password`) already revoked every session and is
  unchanged. API keys are not sessions and are not touched; neither is the account's second factor.

  **A revoked session could come back.** `SessionService.destroyAllForAdmin` and
  `destroyAllForCustomer` cleared the Redis cache entries and then deleted the rows, so a request from
  a session being revoked could read the row in between and cache it again — after which it answered
  from the cache until its thirty-day expiry. Rows are deleted first now, and `loadSession` looks for
  the row again after filling the cache and takes the entry back out when it is gone.

  **Logins begun with the old password are withdrawn.** A pending second-factor challenge or setup
  ticket issued after the old password verified could still be completed after a password change, a
  peer reset, a deactivation or a delete. `MfaLoginPort` gains a required method,
  `invalidatePending(subject)` (**breaking for implementers**), which `mfa` implements with a
  per-subject generation counter in its challenge store, and `AdminUserService` calls it wherever it
  revokes sessions. `AdminUserService`'s constructor takes the lazily resolved MFA port as an optional
  fifth argument.

  **Write first, revoke second.** The self-service change, the peer reset, deactivation and deletion
  now persist the new state and then revoke, where the peer reset used to revoke first: a sign-in with
  the old password between the two steps kept a session nothing revoked. A refusal from the session
  port therefore surfaces as the request's error with the new password already in force.

  **Audit.** A self-service password change is now recorded as `admin_user.change_password` with
  `via: 'self_service'` — the action a peer reset already records with `via: 'peer_reset'` — where it
  used to be an `admin_user.update` indistinguishable from a rename. The entry carries neither the
  password nor its hash. A request that changes the name as well records an `admin_user.update`
  entry beside it; a password-only request no longer records one.

  **A session of an account that is not active is refused, revoked or not.** Revocation is a step
  each write has to remember, so the admin guard no longer relies on it: `requireAdmin` and
  `requireAdminAny` answer `401 UNAUTHORIZED` to a session whose administrator account is
  deactivated, deleted or gone. **This changes a status code:** a permission-gated route used to
  answer such a session `403 FORBIDDEN`, and a route with no permission code answered it in full. An
  active account that lacks the permission is still answered 403. The extra account read is made
  only on a route with no permission code and after a refused permission check, so a granted
  permission costs what it did. While `admin_roles` or `admin_users` is absent from the deployment the
  check is not made — it has nobody to ask — so `GET /api/v1/admin/module-presence` keeps answering in
  that state as before.

  **A new password equal to the current one is refused** on `PATCH /api/v1/admin/me` with
  `400 NEW_PASSWORD_UNCHANGED` ("The new password is the same as the current one. Choose a different
  password." / "Nowe hasło jest takie samo jak obecne. Wybierz inne hasło."). It would have reported
  a change, and signed the other sessions out, without changing the credential. The check runs after
  the current password is verified. The buyer-side change-password route and the peer reset do not
  make this check: the peer does not know the target's password, and comparing would tell them.

  **Log redaction.** The request logger censored `*.password`, `*.passwordHash` and `*.secret` but not
  `*.currentPassword` or `*.newPassword`, the two other names a password travels under in a request
  body. Both are on the list now, which `buildServer` and `createLogger` share instead of each
  carrying its own copy.

  **API — two breaking changes, named first.**

  - `AdminPermissionChecker` in `@endora-commerce/platform` gains a required method,
    `isActiveAdministrator(adminUserId): Promise<boolean>`; `PermissionService` in
    `@endora-commerce/mod-admin-roles` implements it. A hand-written checker passed to
    `createRequireAdmin` / `createRequireAdminAny` has to add it.
  - `AdminAuthService.changePassword` in `@endora-commerce/mod-admin-users` is **removed**, and the
    class's constructor loses its fourth argument (the audit port). The method had no caller,
    answered a wrong current password with 401 and revoked nothing; `AdminUserService.updateSelf` is
    the one implementation.
  - `AuthSessionPort.destroyAllForAdmin` in `@endora-commerce/contracts` takes an optional second
    argument, `{ exceptSessionId }` (`AuthDestroyAllForAdminOptions`), which spares that one session
    when it is one of the administrator's own; `SessionService.destroyAllForAdmin` in
    `@endora-commerce/mod-auth` implements it. A port implementation that ignores the argument still
    type-checks but revokes the calling session too.
  - `AdminUserService.updateSelf` takes an optional third argument, `{ sessionCookieValue }`, from
    which it works out which session to keep.
  - `ERROR_CODES.NEW_PASSWORD_UNCHANGED` joins `@endora-commerce/contracts`, owned by `admin_users`.

  A refused password change is not written to the audit log, as a failed sign-in is not.

  **Admin UI.** After a password change the profile screen says that the other sessions were signed
  out (`profile.info.passwordChanged`, English and Polish) instead of "Profile updated."

- 149ee85: The Admin UI tells an administrator whose account holds no role why the panel is empty. Such an
  account can sign in — `GET /api/v1/admin/me` answers 200 with `role: null` and no permissions —
  while every permission-gated route refuses it with `403 ADMIN_ROLE_REQUIRED`. The shell mounted
  normally, every gated sidebar and palette entry filtered itself out, and the sentence explaining
  the refusal was never shown because no page was left to request it. `AppShell` now renders a
  warning notice above the routed screen whenever the signed-in session's `role` is `null`, saying
  that the account has no role and that another administrator, or `admin:create` on the command line,
  has to assign one. The notice is an `Alert` from the design system, so it is announced
  (`role="alert"`) as well as shown.

  Two keys join the `core` bundle in English and Polish: `appShell.noRole.title` and
  `appShell.noRole.description`.

  No API, setting or permission changes.

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

- 2bbf525: `POST /api/v1/admin/i18n/reload` and `GET /api/v1/admin/i18n/coverage` now require a permission.
  Both required an administrator session and no permission code, so any administrator could call
  them whatever their role granted — including an account that holds no role at all, which every
  permission-checked route refuses. The reload is a write: it replaces the translation bundles for
  the whole instance.

  **Breaking for callers without the permission.** The reload now requires `settings:write` and the
  coverage report `settings:read`; a caller holding neither is answered `403`. These are the codes
  the screen that calls the reload already requires — the **Reload translations** button is on the
  cache screen under Settings, which is `settings:write` — so no shipped Admin UI screen loses
  anything. A script or integration that called either route with an administrator session whose
  role lacks the code has to be granted it.

  `GET /api/v1/admin/i18n/bundles` and `PATCH /api/v1/admin/me/preferred-language` are unchanged and
  stay open to every administrator session.

  No new permission code, setting or migration.

- 602e5ba: The Webhooks form says which events an Organization binding applies to.

  The help under the Organization field said a bound subscription receives "only that organization's
  order events". Quote-request and credit-limit events are delivered now and are scoped the same way,
  and product events are not about an Organization at all: they reach platform-wide subscriptions
  only. The English and Polish sentences say so.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
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

## 0.104.0

### Patch Changes

- 32775d5: The Admin UI's sidebar has a "CRM" section, placed after _Sales_. The shell declares no row in
  it: every entry is a module's contribution (`section: 'crm'`), so the heading renders only
  while a module contributes an entry the operator may see. Its label is `appShell.section.crm`
  in the core bundle, in English and Polish.
- 4d5f0dd: The admin dashboard shows its numbers on the first visit.

  After signing in, or after reloading the page on `/`, the four KPI tiles read "—" and the stock
  alerts card read "No products are currently low on stock" until the operator opened another screen
  and came back. `HomePage` decided which requests to send once, when it mounted, and it mounts in the
  same render as `ModulePresenceProvider` — which answers "absent" for every module until its first
  response arrives. So every request was skipped, and nothing went back for them when the answer
  changed.

  - **Each tile and the stock alerts card now owns its request**, and sends it when it is first
    shown. A surface belonging to a module that is off, or to a permission the role does not hold,
    still costs no request.
  - **A tile says what state its number is in.** A placeholder while the request is pending, and a
    message with a _Retry_ button when it fails — where it used to keep the same "—" for both and for
    a response that carried no number.
  - **The stock alerts card no longer reports a failure as an empty warehouse.** It has its own
    loading and error states; "No products are currently low on stock" is shown only when the
    request succeeded and returned none.

  Seven strings are added to the `core` bundle, in English and Polish: `home.kpi.error`,
  `home.kpi.loading`, `home.kpi.retry`, `home.kpi.retryLabel`, `home.stockAlerts.error`,
  `home.stockAlerts.loading` and `home.stockAlerts.retry`.

- 9d6dfbc: Every Page Builder editor is laid out the same way: the blog post, blog category and
  transactional e-mail editors join the CMS ones.

  **`@endora-commerce/page-builder-admin` publishes the editor shell.** New exports on `.`:
  `PageBuilderEditorLayout`, `usePageBuilderEditorSettingsPanel`,
  `PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY`, `PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH` and the
  types `PageBuilderEditorLayoutProps` and `PageBuilderEditorSettingsPanel`. It is the layout the CMS
  editors already have — canvas as the main column, the entity's cards in a settings panel that is a
  column beside it from 1800 px, a block above it below that, collapsed by default there, always open
  for a new entity, revealed when a save is refused, the choice remembered per browser — moved out of
  `cms` so that a module does not have to depend on `cms` to lay out an editor. Three shapes: with a
  settings panel; without one (`settings` omitted — the canvas has the page); and `builder={null}`
  for an entity that has no canvas yet, where the cards are the page and nothing collapses. Its four
  strings are `pageBuilder.editorLayout.*` in the `core` bundle (`@endora-commerce/mod-i18n`).

  **Blog post and blog category editors.** The Page Builder is the main column and the fields are in
  the settings panel, grouped: Metadata, Scope, Search engines (SEO), then for a post Tags, Related
  posts, Related products and Lifecycle. **One Save replaces "Save metadata" and "Save content" /
  "Save description"**: it is in the header with "Save and exit", sends the same requests (the fields,
  then the canvas only if it was edited), and a save that cannot go through names what is missing and
  opens the panel instead of leaving a disabled button. Publish / Unpublish moved to the header;
  Archive is in the Lifecycle card. The canvas now follows the language tab, and saving tags or
  related content no longer puts the stored content back under unsaved canvas edits. A new post or
  category, which has no canvas until it exists, shows the fields as the page. `mod-blog` gains
  `@endora-commerce/page-builder-admin` as an optional peer dependency, next to the
  `@endora-commerce/mod-cms` one it already had. Removed bundle keys: `common.saveContent`,
  `common.saveDescription`, `common.saveMetadata`, `messages.contentSaved`,
  `messages.descriptionSaved`.

  **Transactional e-mail, e-mail block and e-mail template editors.** The canvas takes the full
  editor width and starts on the first screen; the scope, the language and the subject sit on one row
  above it instead of in three stacked cards. These editors deliberately have **no** settings panel:
  those fields say which message is on the canvas or are part of it. Their labels and messages are
  now translated (`pl` included) instead of hard-coded English. A save without a subject is refused
  on the screen, with a sentence that names the field and the cursor put in it, instead of the API's
  generic validation error; `EmailSubjectWithVariables` (`@endora-commerce/page-builder-admin/email`)
  gains the optional `invalid` and `describedBy` props that carry it.

  **`mod-cms`**: no visible change. Its three editors import the shell from
  `@endora-commerce/page-builder-admin`; the `editorLayout.*` keys left its bundle for `core`. The
  shell was never exported from `cms` (`./admin-ui` still publishes only `PageBuilderEditor`), so no
  import breaks. The remembered choice keeps its storage slot, `b2b-admin.cms-editor.settings-panel`,
  so operators who already chose keep their choice — and it now applies to the blog editors too.
  One behaviour differs: when a refused save opens the panel, the page scrolls to the top of the
  editor, so the message is on screen with the fields under it, rather than to the panel alone.

  No request, response or payload shape changed.

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
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

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

- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
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
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
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
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.9.7

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.9.6

### Patch Changes

- 922d0c3: The invoice template editor offers blocks other modules declare, and keeps blocks it cannot show

  The editor now reads `GET /api/v1/admin/invoice-templates/page-builder/config` and merges it into its own configuration through `withDescribedInvoiceBlocks`:
  - A block that a present module declares, and that this module has no editor binding for, can be inserted and configured from the _Invoice sections_ palette. Its fields come from the descriptor. On the canvas it appears as a short note naming the module that draws it on the PDF. _Preview PDF_ shows the real output.
  - A stored block that nothing covers keeps its place and its props, and shows a note saying it is not available on this instance and is not printed. This covers a module that is off, a module that is not installed, and a name nobody recognises. The block is not offered in the palette.
  - If the descriptor cannot be fetched, the editor keeps its own blocks and still shows every stored block it cannot render as that note. No block is dropped.

  `mod-i18n` adds the three `invoiceTemplates.describedBlock.*` strings in English and Polish.

- 170cd2f: The invoice PDF and the admin invoice screen print the invoice's KSeF number whatever any module's state
  - **PDF.** `invoices.InvoiceHeader` prints `<labelKsefNumber>: <number>` directly under the title row when the invoice has a KSeF number. The label defaults to `Numer w KSeF` and can be changed in the template builder. There is no prop to hide the row. The row is left out only while a block that prints the number itself (a registration with `printsKsefReferenceNumber: true`) is present and placed in the template. For the built-in layout, present is enough. The number is printed exactly once, including for a number an accounting vendor recorded while the KSeF module is off or absent.
  - **Admin.** The invoice detail screen shows a _KSeF number_ row whenever the invoice has one. The `invoice.detail.after` zone is unchanged.
  - The KSeF module sets `printsKsefReferenceNumber: true` on `ksef.InvoiceSection`, so an invoice that places that section prints its number once, from the section, as before. That module has since left this repository; its release with the change is cut from the paid-modules repository.
  - `mod-i18n` adds `invoiceDetail.field.ksefNumber` in English and Polish.

- 2584b73: The KSeF module's two permission labels move into its own bundle

  `adminRoles.permission.ksef:read` and `adminRoles.permission.ksef:write` ("View KSeF status",
  "Manage KSeF integration", with their Polish translations) leave `@endora-commerce/mod-i18n`'s
  shared bundle and ship in `@endora-commerce/mod-ksef`'s own `i18n/` bundle, where the other
  integrations' permission labels already are. The role editor shows the same text as before when
  both packages are upgraded together; with the new `mod-i18n` and an older `mod-ksef`, the two
  permissions show their codes until the module is upgraded too.

  The `mod-ksef` half of this change is released from the paid-modules repository, which the module left for
  (feature 134); this repository no longer versions `@endora-commerce/mod-ksef`.

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/platform@0.13.3

## 0.9.5

### Patch Changes

- ba12af9: The Ergonode connector's two permission labels move into its own bundle

  `adminRoles.permission.pim_ergonode:read` and `adminRoles.permission.pim_ergonode:write` ("View
  Ergonode integration", "Manage Ergonode integration", with their Polish translations) leave
  `@endora-commerce/mod-i18n`'s shared bundle. `@endora-commerce/mod-pim-ergonode` ships them in its
  own `i18n/` bundle from its next release, which is cut from the paid-modules repository now that the
  connector has left this one; until an instance runs that release beside this `mod-i18n`, the two
  permissions show their codes in the role editor.

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/platform@0.13.2

## 0.9.4

### Patch Changes

- f89d305: Add the `payment_method.list.integrations` admin zone so separately installed payment gateways can contribute their own configuration cards. Remove the five extracted gateways' breadcrumb and shared translation records from the free packages.
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
  - @endora-commerce/platform@0.13.1

## 0.9.3

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0

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
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0

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

## 0.8.0

### Minor Changes

- 016524f: Retire the two module-package **value** imports the production composition root
  still held.

  `backend/src/composition.ts` names a module package 23 times over 21 packages.
  Nineteen of those packages are reached type-only; two were reached by value, and
  a value import does not retire by moving a type. That matters because
  `specs/110-instance-repository/` T118 moves this root's contribution wiring, ORM
  boot, request-scope hook, error-envelope options and tenant-context resolution
  into `@endora-commerce/platform`, **where a platform file may not import a
  module** (D-52, D-53). Each of the two needed a seam of its own, and they did not
  want the same one.

  **`@endora-commerce/mod-auth` — a port.** `promoteAdminActor` is no longer
  exported from `./backend`. The implementation has not moved and must not: `auth`
  reads it itself from `require-admin.ts`, and promotion is about `request.actor`
  and `request.adminActor`, two decorations this module's plugin applies. It is
  registered instead under the container name `promoteAdminActor`, which is the
  step the old export's own doc block and
  `test/contract/kernel/harness-parity.test.ts` both recorded as open — _"actor
  promotion published as a port, resolved from the container"_.

  ```diff
  -import { promoteAdminActor } from '@endora-commerce/mod-auth/backend';
  -promoteAdminActor(request);
  +import type { AdminActorPromotion } from '@endora-commerce/platform/kernel/ports/require-admin.js';
  +// resolved from the container, never captured — the gate is transient
  +const promote = container.cradle.promoteAdminActor as AdminActorPromotion;
  +promote(request);
  ```

  The module gains two things. The port, above. And **the actor types**, published
  as `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey`,
  because retiring the value import took something nobody had noticed it was
  carrying: `plugin.ts` holds a `declare module 'fastify'` block adding `actor` and
  `adminActor` to `FastifyRequest`, an ambient augmentation reaches a consumer only
  if the declaring file is in that consumer's program, and the value import was the
  only thing putting it there. Thirty reads of `request.actor` stopped compiling
  the moment it went. A consumer that reads `request.actor` now writes a
  **type-only** import from `./backend` and the augmentation travels with it.

  **`@endora-commerce/mod-i18n` — a relocation, and a port was structurally
  unavailable.** `buildErrorTranslationTargets`, `describeErrorCodeCollisions` and
  their five shapes are gone from `./backend`; they are
  `@endora-commerce/platform`'s now, at `kernel/i18n/error-translation.ts`, beside
  `request-language.ts` — the producer of the other `ErrorEnvelopeOptions` member a
  composition root injects.

  ```diff
  -import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +// the platform's; no published subpath carries it, and no module calls it
  ```

  The line it moved across is _the routing is derived from manifests, the
  translation is a service_. `I18nService.translate` — what the envelope's
  `translateErrorMessage` closure calls — stays here and is unchanged. The
  derivation translated nothing: it read `manifest.errorCodes` off the resolved
  manifest set, which is a composition-root input, and it had **no consumer inside
  this package at all** — the barrel re-exported it and nothing here called it,
  which is T040b's criterion 8, the test `absolutizePublicUrl` moved out of `email`
  under. A port was not a design choice rejected on taste: the production root
  calls this _before_ `composeModules`, so there is no container to resolve one
  from, and moving the call after composition would move the collision warning with
  it — a diagnostic logged where it is so that an operator reads it before the
  first request that renders wrong.

  The aggregate return type is renamed `ErrorTranslationRouting`.
  `http/error-envelope.ts` declares an `ErrorTranslationTargets` of its own — the
  record this one's `targets` member is assigned to — and two types of one name in
  one package, one being the input to the other's consumer, is a confusion with a
  real cost. Nothing outside the package named the aggregate.

  **`@endora-commerce/platform`** gains both targets and publishes neither on a
  barrel: no module calls the derivation and no module resolves the promotion port,
  so `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies both
  _unreached_, and putting a host-only name into the module-facing contract is what
  that classification exists to prevent. `AdminActorPromotion` sits in
  `kernel/ports/require-admin.ts` beside `RequireAdminFactory` and
  `RequireCustomerGuard`, which is where a Fastify-shaped port type lives —
  `@endora-commerce/contracts` declares no dependency on Fastify.

  Behaviour is unchanged. `composition.ts` computes the same map at the same point
  in the boot, logs the same collision warning, and promotes the same actor in the
  same closure; the existing composition, error-envelope and harness-parity tests
  are the assertion and none of them moved.

### Patch Changes

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
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Major Changes

- 469a5f4: Removed `ERROR_TRANSLATION_KEYS` and `composeErrorTranslationTargets` from
  `@endora-commerce/mod-i18n/backend`. Error-code routing is now nothing but the modules' own
  `errorCodes` declarations, composed by `buildErrorTranslationTargets`, which was already
  published and is unchanged.

  `ERROR_TRANSLATION_KEYS` was a static table generated by a private prefix chain
  (`moduleIdForErrorCode`) over the closed `ERROR_CODES` enumeration, so a module written outside
  this repository could not produce a translated error at all: its code was in neither, and the
  envelope answered whatever English the raising code wrote, for ever. The chain's last line was
  `return 'core'`, so a code no rule matched was routed silently to the platform bundle and
  rendered as a raw code with nothing anywhere reporting it.

  **If you named `ERROR_TRANSLATION_KEYS`**, build the map from the manifests instead. The input is
  every registered manifest — core, this deployment's overlay modules and every installed package.

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
  -const target = ERROR_TRANSLATION_KEYS[code];
  +import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +const { targets, collisions } = buildErrorTranslationTargets(await resolvedManifestEntries());
  +const target = targets[code];
  ```

  **If you called `composeErrorTranslationTargets`**, call `buildErrorTranslationTargets` with the
  same argument. It was a transitional shape that laid the declarations over the chain so the
  migration could be delivered one owning module per merge request; all eighteen owners have
  declared, so there is nothing left to lay them over.

  Two behavioural differences follow, and both are the point rather than side effects. A code **no
  registered manifest declares** is now absent from the map, so the envelope answers the raising
  code's own message — there is no fall-through to the platform bundle. And a code **more than one
  module declares** is absent too, and named in `collisions` with every claimant and the file it
  was declared in: nobody wins, because routing one raiser's condition under another's sentence is
  good prose about the wrong thing, with no symptom a client can detect.

  `ErrorTranslationTarget`, `ErrorTranslationTargets`, `ErrorCodeDeclarationSource`,
  `ErrorCodeClaim`, `ErrorCodeCollision` and `describeErrorCodeCollisions` are unchanged.

  `@endora-commerce/platform` carries a documentation correction only: the
  `ErrorEnvelopeOptions.errorTranslationTargets` doc block no longer describes the injected map as
  a static table, and records that a deployment's overlay module can now own a code by declaring
  it. No emitted behaviour changes.

### Minor Changes

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

- 3eef7a2: `newsletter` and `transactional_emails` ship their admin surfaces.

  **New `./admin` subpath on two packages.** `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-transactional-emails` each export `contributions` — an
  `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and nothing else.
  Seventeen routes and nine sidebar entries between them, all at the paths and codes the
  hand-written host registrations carried:
  - `mod-newsletter` — `/newsletter/subscribers` (the landing route), `/newsletter/campaigns`,
    `/newsletter/campaigns/:id`, `/newsletter/campaigns/:id/stats`, `/newsletter/automations`,
    `/newsletter/automations/:id`, `/newsletter/tags` and `/newsletter/blocks` on
    `newsletter:read`; `/newsletter/campaigns/new`, `/newsletter/automations/new` and
    `/newsletter/provider` on `newsletter:write`, which is the code the API enforces on the
    `POST`s those three screens exist to make and the code the provider row already carried.
    Six sidebar rows, in the `newsletter` section at weights 100 through 600.
  - `mod-transactional-emails` — `/transactional-emails` (the landing route),
    `/transactional-emails/blocks`, `/transactional-emails/blocks/:id`,
    `/transactional-emails/templates`, `/transactional-emails/templates/:id` and
    `/transactional-emails/:code`, all on `transactional_emails:read`. Three sidebar rows, in
    the `messaging` section at weights 100, 200 and 300.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **Both packages declare `@endora-commerce/page-builder-admin` as a peer dependency**, and
  that is what makes the two a batch rather than two rows. Their whole recorded admin debt was
  six reaches into `admin/src/modules/_shared/email-builder/`; P5b published that directory as
  `@endora-commerce/page-builder-admin/email`, so the six became bare specifiers into an
  `exports` map and there was nothing left to repair. Three `newsletter` screens (the campaign
  editor, the automation builder and the block editor) and three `transactional_emails` ones
  (both fragment editors and the e-mail editor, through this module's own `EmailEditorPane`
  adapter) mount `EmailEditorPane` and `EmailVariablesProvider` from it. `manifests:generate`
  derives the peer from those specifiers; a consumer installing either package from a registry
  must be able to resolve it.

  **Two new components on `mod-transactional-emails`, both internal to its `./admin` layer.**
  `EmailBlockEditorPage` and `EmailTemplateEditorPage` each render `EmailFragmentEditor` with
  one `kind`. The admin host used to pass that as a prop from its route table
  (`element={<EmailFragmentEditor kind="block" />}`), and an `AdminRouteDeclaration.component`
  is a factory returning a module whose `default` is read — there is nowhere in a declaration
  to put an argument.

  **Three new palette actions**, replacing hand-written rows in the admin shell, with the same
  destinations, codes and keywords:
  - `mod-newsletter` — `open-newsletter-campaigns` → `/newsletter/campaigns` and
    `open-newsletter-automations` → `/newsletter/automations`, both `newsletter:read`.
  - `mod-transactional-emails` — `open-email-blocks` → `/transactional-emails/blocks`,
    `transactional_emails:read`.

  Both packages' `i18n/{en,pl}.json` gain the nav labels (`nav.subscribers.label` and its five
  siblings; `nav.transactionalEmails.label`, `nav.emailBlocks.label`,
  `nav.emailTemplates.label`) and the new actions' label and description keys, module-relative
  and in both shipped languages.

  **`@endora-commerce/mod-i18n` loses fifteen keys**: `appShell.nav.newsletter*` (six),
  `appShell.nav.transactionalEmails`, `appShell.nav.emailBlocks`, `appShell.nav.emailTemplates`
  and the six `appShell.palette.sub.*` keys the deleted palette rows named. Nothing renders
  them after this change — the labels are the two modules' own now. `appShell.section.messaging`
  and `appShell.section.newsletter` stay: the shell still owns the section taxonomy.

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

- 59c59c6: `cms` and `blog` ship their admin screens, and `cms` publishes its page-builder canvas.

  **Two packages' `./admin` subpath is new, and `@endora-commerce/mod-cms` gains a second UI
  subpath.** Eighteen routes and seven sidebar entries between them, at the paths the
  hand-written host registrations carried, plus `./admin-ui` on `cms` for the one component
  another module renders. The exported symbol on `./admin` is the same one every other module
  package uses — `contributions`, an `AdminContributions` object, and nothing else.
  - `@endora-commerce/mod-cms` — **new `./admin` subpath**, exporting `contributions`. Eleven
    routes: `/cms` and `/cms/pages` (the landing route) on `cms.read`, `/cms/pages/:id`,
    `/cms/blocks`, `/cms/blocks/:id`, `/cms/templates`, `/cms/templates/:id` and `/cms/hooks`
    on `cms.read`, and `/cms/pages/new`, `/cms/blocks/new` and `/cms/templates/new` on
    **`cms.write`**. `/cms` is a second declaration of the page list rather than a redirect,
    because a redirect would be the consuming application's route and not this module's. Four
    sidebar rows, in the `content` section at weights 100 to 400.
  - `@endora-commerce/mod-blog` — **new `./admin` subpath**, exporting `contributions`. Seven
    routes: `/blog/posts` (the landing route), `/blog/posts/:id`, `/blog/categories`,
    `/blog/categories/:id` and `/blog/tags` on `blog.read`, and `/blog/posts/new` and
    `/blog/categories/new` on **`blog.write`**. Three sidebar rows, in the `content` section at
    weights 600 to 800.

  **The five create routes take the write code, and that is a behaviour change for a consumer
  rendering these routes.** Each create screen exists to write — `POST /api/v1/admin/cms/pages`
  and its four siblings enforce the write code — and each module's own palette action
  (`new-page`, `new-post`) already advertised that code. The routes were ungated while they
  belonged to the admin application, so a read-only operator could open a form whose save then
  refused. The five create controls are gated on the same code in this release — the _New page_,
  _New block_, _New template_, _New post_ and _New category_ buttons and the category tree's
  _+ Child_ — so the dead end is closed at both ends. `@endora-commerce/mod-sales-channels`
  ships the identical split for `/sales-channels/new` and `@endora-commerce/mod-credentials` for
  `/credentials/new`.

  **`CategoryTreeNode` takes a new required prop.** It is not exported from any subpath, so this
  affects nobody outside the package; it is recorded because the prop is `canCreate: boolean`
  and required rather than optional — a caller that forgets it does not compile, which is the
  direction a permission gate has to fail in.

  **`@endora-commerce/mod-cms` — new `./admin-ui` subpath, exporting `PageBuilderEditor` and the
  `PageBuilderData` type.** This is the Puck canvas the CMS page, block and template editors
  render and that `@endora-commerce/mod-blog`'s post and category editors render too. Its props
  are `data` in and `onChange` back, so the consumer decides that it appears — a published
  component rather than something the owner contributes to a place of its own choosing. It is
  not in `@endora-commerce/admin-kit` because it is a `@measured/puck` host and the kit is what
  every module's admin layer compiles against, and not in
  `@endora-commerce/page-builder-admin` because it calls this module's API client, reads this
  module's translation namespace and lays the CMS page container out — that package holds the
  builder chrome that names no module at all.

  **`@endora-commerce/mod-blog` gains `@endora-commerce/mod-cms` as a peer dependency**, which
  is what a published component costs: the reach survives into the emitted JavaScript, so a
  consumer bundling `blog`'s admin layer must resolve `cms`. It is not a `dependency` — a module
  reaches another through a port declared in its manifest, never through npm — and it is not
  optional. A consumer that installs `@endora-commerce/mod-blog` without `@endora-commerce/mod-cms`
  will fail to resolve `@endora-commerce/mod-cms/admin-ui` at bundle time. There is no runtime
  half to worry about: `blog`'s module manifest already declares `cms` in its `dependencies`, so
  a platform where `cms` is absent or switched off is one where `blog` cannot be activated
  either.

  **`@endora-commerce/mod-cms` and `@endora-commerce/mod-blog` ship new i18n keys, and
  `@endora-commerce/mod-i18n` loses seven.** `nav.cmsPages.label`, `nav.cmsBlocks.label`,
  `nav.cmsTemplates.label`, `nav.cmsHooks.label`, `nav.blogPosts.label`,
  `nav.blogCategories.label` and `nav.blogTags.label` are in the two modules' own
  `i18n/{en,pl}.json`; `appShell.nav.cmsPages`, `appShell.nav.cmsBlocks`,
  `appShell.nav.cmsTemplates`, `appShell.nav.cmsHooks`, `appShell.nav.blogPosts`,
  `appShell.nav.blogCategories` and `appShell.nav.blogTags` are removed from the shared bundle
  in both shipped languages, nothing rendering them any more. **A consumer resolving one of
  those seven keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **Neither module declares a new palette action, and neither loses one.** `cms` has declared
  `new-page` and `blog` `new-post` all along, and the admin application's own palette table
  never carried a hand-written row for either — so unlike batches 10, 13 and 14 there was
  nothing to convert.

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

- 1fdeada: Add `composeErrorTranslationTargets(manifests)`, the error-code routing map a composition root
  injects while feature 090's migration is in flight.

  `buildErrorTranslationTargets` (shipped in the previous release) answers only from the modules'
  own `errorCodes` declarations, which is the end state. Nothing declares a code yet, so injecting
  it alone would empty the map and take every operator-visible sentence in both shipped languages
  out of reach at once. `composeErrorTranslationTargets` is the transitional shape:
  - a code its owner has declared routes to that owner;
  - a code nobody has declared yet keeps the answer `ERROR_TRANSLATION_KEYS` gives it;
  - a code more than one module declares routes to **neither**, and is absent from the map even
    when the incumbent table has an answer for it — the incumbent is not a tie-break
    (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §3.4).

  The collisions come out of the same call, so the report and the routing cannot disagree.

  ```ts
  const { targets, collisions } = composeErrorTranslationTargets(await resolvedManifestEntries());
  buildServer({ errorEnvelope: { errorTranslationTargets: targets } });
  ```

  It is deleted together with `ERROR_TRANSLATION_KEYS` when the last module migrates; callers then
  pass the same argument to `buildErrorTranslationTargets`. No routing answer changes in this
  release — the two are asserted equal over the whole of `ERROR_CODES`.

- 0e8e473: `linkedin_ads` and `meta_ads` ship their admin surfaces, on a new `./admin` subpath each.

  Each package now exports `contributions` from `@endora-commerce/mod-linkedin-ads/admin` and
  `@endora-commerce/mod-meta-ads/admin` — three routes (the mapping list, `/new` and `/:id`)
  and one sidebar entry — as an `AdminContributions` object. Every component is a
  dynamic-import factory, and the two editor routes share one factory value, so a consumer's
  bundler emits one chunk for the editor rather than two.

  Three things a consumer has to know:
  - **The sidebar label moved namespace.** `appShell.nav.linkedinAds` and
    `appShell.nav.metaAds` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.linkedInAds.label` and `nav.metaAds.label` in each package's own `i18n/`,
    resolved in the module's own scope. Anything reading an old key gets a raw key back. The
    text itself is unchanged in both languages. The screens' own keys did not move — they
    were already in each module's bundle.
  - **Each admin API client gains `listSalesChannels()`.** The two screens label a mapping's
    channel, and they used to do it by importing `sales_channels`' admin client out of the
    admin application. They now call `GET /api/v1/admin/sales-channels?activeOnly=false&pageSize=100`
    themselves and type the answer with `SalesChannelListResponse` from
    `@endora-commerce/contracts`. It is deliberately duplicated in the two packages rather
    than shared: the only place two modules could share it is `@endora-commerce/admin-kit`,
    and the kit holds no module knowledge.
  - **Each package peers on `@endora-commerce/admin-kit`, `react` and `react-router-dom`.**
    They are peers rather than dependencies for the reason `page-builder-core` is: the
    application must resolve exactly one copy, and a provider in one copy against a consumer
    in the other is a `null` context at runtime rather than a type error.

- 3c8102e: `analytics` ships its admin surface, on a new `./admin` subpath.

  The package now exports `contributions` from `@endora-commerce/mod-analytics/admin` — one
  route (`/analytics`) and one sidebar entry — as an `AdminContributions` object. The
  component is a dynamic-import factory, so a consumer's bundler splits the screen without
  being asked.

  Three things a consumer has to know:
  - **Every string the dashboard renders moved namespace.** The fourteen `analytics.*` keys
    and `appShell.nav.analytics` were in `@endora-commerce/mod-i18n`'s shared `core` bundle;
    they are now `page.title`, `range.7days`, `nav.analytics.label` and so on in this
    package's own `i18n/`, resolved in the `analytics` scope. Anything reading an old key
    gets a raw key back. The text itself is unchanged in both languages.
  - **The module declares a command-palette action, `open-analytics`.** It had an admin
    screen and a sidebar entry since feature 018 and no ⌘K entry, which Principle XVI says is
    not enough. It gates on `analytics:read`, the code `GET /api/v1/admin/analytics/summary`
    enforces.
  - **The package peers on `@endora-commerce/admin-kit`, `react` and `lucide-react`.** They
    are peers rather than dependencies for the reason `page-builder-core` is: the application
    must resolve exactly one copy, and a provider in one copy against a consumer in the other
    is a `null` context at runtime rather than a type error.

- a92d972: `google_analytics` ships its admin surface, on a new `./admin` subpath.

  The package now exports `contributions` from `@endora-commerce/mod-google-analytics/admin`
  — three routes (`/google-analytics`, `/google-analytics/new`, `/google-analytics/:id`) and
  one sidebar entry — as an `AdminContributions` object. Every component is a dynamic-import
  factory, so a consumer's bundler splits the screens without being asked; the two editor
  routes share one factory, so they are one chunk and not two.

  Two things a consumer has to know:
  - **The sidebar label moved namespace.** It was `appShell.nav.googleAnalytics` in
    `@endora-commerce/mod-i18n`'s shared `core` bundle and is now
    `nav.googleAnalytics.label` in this package's own `i18n/`, resolved in the
    `google_analytics` scope. Anything reading the old key gets a raw key back.
  - **The package peers on `@endora-commerce/admin-kit`, `react` and
    `react-router-dom`.** They are peers rather than dependencies for the reason
    `page-builder-core` is: the application must resolve exactly one copy, and a provider in
    one copy against a consumer in the other is a `null` context at runtime rather than a type
    error.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 10bca4a: `_i18n` is a module package — the 66th of 67, and the one whose boot pass loads
  every other module's translation bundles.

  It publishes a root export (its manifest, its `lifecycleParticipant` and its two
  `cliCommands`), `./migrations`, and `./backend`, which carries `registerModule`,
  the `entities` array and the surface the host and the test tree reach:

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from './modules/_i18n/services/error-translation.js';
  -import type { AdminI18nCradle } from './modules/_i18n/backend.js';
  +import { ERROR_TRANSLATION_KEYS, type AdminI18nCradle } from '@endora-commerce/mod-i18n/backend';
  ```

  Also published from `./backend`, each because something outside the module
  constructs or calls it: `I18nService`, `MissingKeyLogger`, `loadModuleBundles`
  and `BundleLoadError`, `reconcileBundles`, and `registerI18nAdminRoutes` with
  `I18nAdminDeps`. Nothing else moved — the container names are unchanged
  (`adminI18nService`, `adminI18nReconciler`), the module id stays `_i18n`, and the
  `translation_bundles` migration keeps its class name.

  **The npm name drops the leading underscore**: `_i18n` publishes as
  `@endora-commerce/mod-i18n`, which is what `manifests:generate` has always
  derived and what `_lifecycle` will do too.

  **The bundles ship from the package root, not from `dist`.** `packages/modules/_i18n/i18n/`
  is in `files` beside `dist`, because the platform anchors a module's `bundlesDir`
  to the module's own directory — for a package that is the directory holding its
  `package.json`. That is the same rule every module package with translations
  already follows; it matters more here only because this module is the one doing
  the loading. Verified from the compiled tree rather than assumed: `node`, over
  `backend/dist`, loads bundles for all 46 modules that declare them, none empty.

  Two things this move retired rather than changed:
  - `i18n-service.ts` re-exported `SUPPORTED_LANGUAGES` and `BundleLoadError`
    "for tests / consumers" and had neither. The first is
    `@endora-commerce/contracts`', the second is published by `./backend`. Import
    them from there.
  - `error-translation.ts` is now reached through `./backend`, so the map both
    composition roots inject into the error envelope is no longer a root's import
    out of the application's module tree. The drain that entry was waiting for —
    declaring the code→key mapping beside the codes in
    `@endora-commerce/contracts` — is still available and still worth doing.

- 5a2878a: Fourteen `rfq.detail.*` keys in `en` and `pl` for the quote-request validity deadline the
  operator now sets from the request's own detail screen.

  `rfq.detail.validity.*` covers the deadline field, its five help sentences (the preview of the
  date a save would write, the three "what leaving this blank keeps" answers, and the refusal for
  a value the contract would reject) and the two remedies a lapsed request offers depending on
  whether it can still be modified. `rfq.detail.badge.validityEnded` and
  `rfq.detail.meta.validityEnded` are the third sentence about a field that previously had two:
  a deadline already behind us used to render through `rfq.detail.meta.expires`, which reads as a
  promise still standing.

  No key is renamed or removed; a consumer on the previous bundle resolves everything it did
  before.

- 09df879: The shared admin page-builder chrome's copy moves out of `mod-cms`' bundle and into
  `mod-i18n`'s, which the admin serves under the synthetic `core` scope (feature 091 P5a;
  ruling R-1: a translation namespace is module knowledge, and this copy is nobody's).

  **`@endora-commerce/mod-cms`' bundle loses 33 keys**, every one of them under
  `pageBuilder.*` and every one of them read only by `PageBuilderHeaderActions.tsx` — the
  header shell, the template actions and the header tools that `cms`, `invoices` and the
  e-mail builder all render. The blocks that moved whole are
  `pageBuilder.saveAsTemplate.*` (9), `pageBuilder.applyTemplate.*` (9),
  `pageBuilder.copyLanguage.*` (8, minus `emptySource`), `pageBuilder.clearCanvas.*` (5) and
  `pageBuilder.fullscreen.*` (2). The bundle keeps its other 65 `pageBuilder.*` keys —
  `components.*`, `categories.*`, `drawer.*`, `copyLanguage.emptySource` and the rest — which
  belong to `cms`' own screens, and it keeps `common.saving`, `fields.name` and `fields.code`,
  which its editors read.

  **`@endora-commerce/mod-i18n` gains those 33 plus three new `common.*` entries**:
  `common.state.saving`, `common.field.name` and `common.field.code`. They are additions
  rather than moves because `cms` reads its own copies of the same three concepts from its own
  screens; no existing `core` key carried those values.

  **What a consumer that supplies its own bundle has to do:** move the 33 `pageBuilder.*` keys
  from the `cms` scope into `core`, and add the three `common.*` entries. A key left behind
  does not fail to compile and does not 404 — it renders `core.pageBuilder.clearCanvas.button`
  into the operator's screen as a label.

  `common.state.saving` is `"Saving…"` / `"Zapisywanie…"`, with the typographic ellipsis its
  `common.state.loading` sibling uses, where `cms`' own `common.saving` is `"Saving..."`. That
  is the one rendered character this release changes.

- 1f07b01: The fifteen `pageBuilder.colorPalette.*` strings move from `mod-cms`' bundle into
  `mod-i18n`'s, in both shipped languages (feature 091, P5b — the remedy P5a applied to the
  other thirty-three chrome keys, arriving for the one chrome file P5a's set did not include).

  `ColorPaletteModal` is the shared page-builder chrome's, not `cms`' screen: `cms`,
  `invoices` and the e-mail builder all render it, and it now ships in
  `@endora-commerce/page-builder-admin`. A package cannot depend on one module's bundle for
  strings three modules read, and a namespace is resolved at runtime by string — so a key the
  namespace does not carry renders `cms.pageBuilder.colorPalette.title` into the operator's
  screen instead of failing. The keys therefore live where the reader does, which for chrome
  is the synthetic `core` scope `mod-i18n` serves.

  **If you ship a translation override** keyed `cms.pageBuilder.colorPalette.*`, re-key it to
  `core.pageBuilder.colorPalette.*`. The fifteen keys, their values and both languages are
  otherwise unchanged; no other `cms` key moves, and the other sixty-five `pageBuilder.*` keys
  in `mod-cms`' bundle are its own screens' and stay.

- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- ca3fd67: `@endora-commerce/mod-pim-unopim/admin` declares the module's screens

  The `contributions` export gains `routes` and `nav` beside the three `zones` it already
  carried. Seven routes — `/pim-unopim`, its four mapping screens, `/pim-unopim/runs` and
  `/pim-unopim/runs/:runId` — and one sidebar entry in the `catalog` section at weight 400,
  all gated on `pim_unopim:read`. Every route component is a dynamic-import factory whose
  module has a default export, which is what the admin's registry loads.

  An application composing this package no longer needs to register any of it. If you were
  importing these screens from `admin/src/modules/pim_unopim/`, that directory is gone: the
  seven pages, the admin API client (now `./admin`'s `api/unopim-client.js`), `format.ts` and
  the section-tab, run-badge and issue-list components all ship inside the package. So do
  `PimRunStatusBadge` and `PimIssueList`, which were briefly shared with
  `@endora-commerce/mod-pim-ergonode` through a host directory; that module renders its own
  badge, so these are `pim_unopim`'s. They are **not** exported — a second connector wanting
  that chrome should get it from a published subpath rather than by reaching in.

  `@endora-commerce/mod-i18n`'s shared bundle loses nine keys in both shipped languages: the
  seven `appShell.nav.pimUnopim*` entries the host sidebar and its breadcrumb rules rendered,
  which the module's own `nav.pimUnopim.label` replaces, and the two
  `adminRoles.permission.pim_unopim:*` labels, which move into this module's own bundle where
  a module's permission labels belong. No wording changed.

### Patch Changes

- f8ffc57: `currencies` and `inventory` declare their own permission codes, and their admin routes enforce
  them instead of the catalogue's and the order module's. `currencies` also takes back the four
  routes `languages` was registering on its behalf.

  **Breaking for anyone whose roles reach either module's admin API, and for anyone importing
  `I18nRoutesDeps` from `@endora-commerce/mod-languages/backend`.**

  ## `currencies` — four routes and a new owner

  The routes moved module _and_ code. They were registered by `languages` and gated on
  `catalog:write` — all four, the list read included, so seeing the currency table required the
  authority to delete a row from it:

  ```
  GET    /api/v1/admin/currencies            languages, catalog:write -> currencies, currencies:read
  PUT    /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  POST   /api/v1/admin/currencies/:code/default  languages, catalog:write -> currencies, currencies:write
  DELETE /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  ```

  `registerI18nRoutes`' `I18nRoutesDeps` no longer takes `currencyAdmin`; `currencyRead` stays, for
  `GET /api/v1/i18n/config`, which composes both catalogues into one public payload and is
  unchanged. The new entry point is `registerCurrencyRoutes` in
  `@endora-commerce/mod-currencies/backend` — but a host does not call it: the module registers its
  own routes through `ctx.routes`, which is what makes the module-presence gate structural instead
  of a note in a comment.

  `@endora-commerce/mod-currencies` gains `auth` in its manifest `dependencies` (it resolves
  `requireAdmin` now) and `fastify` in its peer dependencies.

  ## `inventory` — 21 gates

  Nine reads on `orders:read` and twelve writes on `catalog:write`, all of them over this module's
  own tables: warehouses, stock levels, display-band thresholds, the back-in-stock queue, the CSV
  importer, and the channel↔warehouse assignment that decides which stock a channel may sell.
  Every one is now `inventory:read` or `inventory:write`.

  The channel↔warehouse routes are the ones to look at if you embed
  `admin/src/modules/warehouses/ChannelMembershipPanel`: a role that may edit a sales channel and
  holds no inventory code now sees no panel, where before it saw one backed by `catalog:write`.

  `open-inventory`, the module's ⌘K action, moves from `orders:read` to `inventory:read` with its
  route.

  ## No data migration, in both cases

  Granting the new codes to every holder of `catalog:write` or `orders:read` would reproduce the
  distribution the split exists to remove, which would make this a change of spelling rather than
  of authority. A role that reached these screens through the borrowed codes is granted the new
  ones explicitly on `/admin-roles`, where the manifests put them automatically.

  `@endora-commerce/mod-i18n` carries the four `adminRoles.permission.*` labels and the inventory
  screens' refusal notice, in `en` and `pl`.

- 9611d37: Error-code ownership: the `KSEF_*` and `PIM_ERGONODE_*` families are declared by the modules
  that own their nouns.

  `manifest.errorCodes` on `@endora-commerce/mod-ksef` gains its seven codes and on
  `@endora-commerce/mod-pim-ergonode` its thirteen; `@endora-commerce/mod-i18n` drops the same
  twenty from its own declaration, which is what decides where the error envelope looks for a
  sentence (D-129's remaining sweep, MR 2 of eight; D-121 tier T1;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes and nothing else. No wire
  shape moves — `error.code` is unchanged — and no sentence moves either: none of the twenty has
  a translation in `en` or `pl` today, in any bundle, so a Polish reader sees exactly what they
  saw before. What a downstream author gains is that writing one of those sentences is now a
  change to the module's own `i18n/{en,pl}.json` rather than to the platform's.

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

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

- 3b07abc: Error-code ownership: Tier B's four remaining modules declare the codes they own, each shipping its
  first i18n bundle.

  `manifest.errorCodes` gains five codes on `@endora-commerce/mod-credit-limits`
  (`ACTIVE_RESERVATIONS_EXIST`, `ADJUSTMENT_BELOW_ACTIVE`, `CREDIT_LIMIT_ALREADY_GRANTED`,
  `CREDIT_LIMIT_NOT_GRANTED`, `LIMIT_INSUFFICIENT`), three on `@endora-commerce/mod-api-keys`
  (`API_KEY_CHANNEL_MISMATCH`, `API_KEY_NOT_BOUND`, `API_KEY_OUT_OF_SCOPE`), two on
  `@endora-commerce/mod-addresses` (`ADDRESS_IN_USE`, `ADDRESS_NOT_OWNED`) and one on
  `@endora-commerce/mod-webhooks` (`WEBHOOK_DELIVERY_NOT_REPLAYABLE`); `@endora-commerce/mod-i18n`
  drops the same eleven from its own declaration, which is what decides where the error envelope
  looks for a sentence (D-129's remaining sweep, MR 5 of eight; D-121 tier T1 throughout; D-186 §2
  and §3 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  All four declare an error code for the first time, and all four gain an `i18n` bundle they never
  had, declared as `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. No wire shape moves:
  `error.code` is unchanged for all eleven.

  **Nine sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Limit Insufficient."` in `en` and
  `"Błąd: limit insufficient."` in `pl` — which D-186 §2 refuses to carry into a module's own bundle,
  where it would read as that module's answer rather than as an unwritten sentence. Six of the nine
  are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.ADJUSTMENT_BELOW_ACTIVE`, `errors.CREDIT_LIMIT_ALREADY_GRANTED`,
    `errors.CREDIT_LIMIT_NOT_GRANTED` and `errors.LIMIT_INSUFFICIENT` in
    `@endora-commerce/mod-credit-limits`
  - `errors.ADDRESS_NOT_OWNED` in `@endora-commerce/mod-addresses`
  - `errors.WEBHOOK_DELIVERY_NOT_REPLAYABLE` in `@endora-commerce/mod-webhooks`

  The other three keep no sentence. `ACTIVE_RESERVATIONS_EXIST` and `ADDRESS_IN_USE` are raised by
  nothing in the platform, so there was no refusal to describe. `API_KEY_OUT_OF_SCOPE` is raised, and
  is still not rewritten: its reader is an integration rather than a person, and the raise names the
  scope the key is missing (`API key lacks the required scope: <scope>.`) — the envelope substitutes
  the message wholesale and that raise carries no `details`, so a fixed sentence would take
  information away from the only audience that meets it. A consumer that reads those three keys out
  of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them.

  `@endora-commerce/mod-api-keys` therefore ships a bundle that installs **zero** entries, which is a
  state no module in this platform has been in before. `loadModuleBundles` answers
  `{"byLanguage":{}}` for it and the boot reconciler counts it as installed.

  `API_KEY_CHANNEL_MISMATCH` is raised by the platform's sales-channel resolver and now takes its
  sentence from a switchable module's bundle (D-186 §3). The coupling is bounded: the raise needs an
  `api_key` actor, which only `@endora-commerce/mod-auth`'s request hook produces and only by calling
  `@endora-commerce/mod-api-keys`' gated `apiKeyResolver`, so with the module absent the code cannot
  be produced at all.

- 958fe88: Error-code ownership: `admin_roles` declares the three codes it owns and ships its first i18n
  bundle.

  `ADMIN_ROLE_CODE_TAKEN`, `ADMIN_ROLE_IN_USE` and `ADMIN_ROLE_PROTECTED` move from
  `@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-admin-roles`'. For a consumer the
  observable difference is **which bundle answers for them**: the sentences are no longer served from
  the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
  ships `@endora-commerce/mod-admin-roles` gets them and one that does not gets the raising code's own
  English.

  Two of the three arrive with prose written for the first time — they carried a machine-shaped
  restatement of their own code (`"Admin Role Code Taken."`), which is deleted rather than moved.

  **`protectedRoleRefusal(code)` is a new export** of `@endora-commerce/mod-admin-roles/backend`, beside
  the existing `roleInUseRefusal`. It is the refusal `AdminRoleService.remove` now throws for a
  module-seeded role, extracted for the same reason its neighbour was: the translated sentence names
  the role through a `{role}` placeholder, and only a test that renders a real refusal can see that
  the placeholder has something to fill it.

  **The 409 `ADMIN_ROLE_PROTECTED` response now carries `details: { role: '<role code>' }`.** It
  carried no `details` before. This is additive — the member is `role` and never `code`, which is the
  refusal token the error envelope keys `errors.<CODE>.<token>` on.

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

- 04cba90: Close D-129's sweep: the platform error-code block is 21 codes with a reason each, and a gate
  that says so.

  **`@endora-commerce/contracts`** — `errorCodeTokenRe`'s doc block said the envelope "falls back
  to `errors.<CODE>`" when a token key is missing. It does not, and it never did:
  `localizeErrorEnvelope` composes one key — `errors.<CODE>.<token>` when the raise carries a
  `details.code`, `errors.<CODE>` when it does not — asks for it once and never re-asks. The
  correction matters to anyone declaring `tokens`, because it decides whether a code whose every
  raise is tokened needs its base sentence at all. It does, but for the check rather than for the
  operator (D-190). No shape changes; this is the published `.d.ts` telling the truth.

  **`@endora-commerce/mod-i18n`** — the same 21 declarations, regrouped by the ground that put each
  one there, with the block's doc comment rewritten to read as the platform block's home rather
  than as what a migration left behind. Nothing a consumer resolves moves: the codes, their
  `tokens` and every `errors.*` key in the bundle are unchanged.

  D-129's sweep is now complete — 79 codes moved into 20 modules over seven merge requests, 21
  stayed. Each of the 21 is annotated with its D-121 tier and the sentence that argues it, and
  `_i18n`'s declarations are held equal to those annotations in both directions, with the
  annotations' own membership held against the frozen chain capture plus the re-homing and minting
  ledgers. A twenty-second code cannot reach the platform block by nobody deciding.

- df749d7: `delivery_methods` declares `delivery_methods:read` and `delivery_methods:write`, and its admin
  routes enforce them instead of `catalog:read` / `catalog:write`.

  **Breaking for anyone whose roles reach either module's admin API.** The three
  `delivery_methods` routes moved:

  ```
  GET    /api/v1/admin/delivery-methods         catalog:read   -> delivery_methods:read
  PUT    /api/v1/admin/delivery-methods/:code   catalog:write  -> delivery_methods:write
  DELETE /api/v1/admin/delivery-methods/:id     catalog:write  -> delivery_methods:write
  ```

  And the shared route `@endora-commerce/mod-payment-methods` registers moved with them:

  ```
  GET    /api/v1/admin/order-statuses
    payment_methods:read OR catalog:read  ->  payment_methods:read OR delivery_methods:read
  ```

  That route is read by two admin editors — the payment-method screen and the delivery-method one
  — which is why it is an any-of. The `catalog:read` member was a placeholder for the delivery
  editor's gate while `delivery_methods` still borrowed the catalogue's authority; it is now that
  module's own read code, so no catalogue holder reaches the shared list any more.

  There is no data migration and that is deliberate: granting the new codes to every holder of
  `catalog:read` would reproduce the distribution the change exists to remove, which would make it a
  change of spelling rather than of authority. A role that was configuring delivery methods through
  the catalogue codes is granted `delivery_methods:read` / `delivery_methods:write` on
  `/admin-roles`, where the manifest puts them automatically.

  `@endora-commerce/mod-i18n` carries the two `adminRoles.permission.delivery_methods:*` labels and
  the screen's refusal notice, in `en` and `pl`.

- 1cdcee4: `_i18n`'s bundle stops carrying eight permission labels four modules already ship.

  `adminRoles.permission.mfa:reset`, `mfa:manage`, `prompt_actions:use`,
  `pwa:read`, `pwa:write`, `pwa:send_push`, `stripe:read` and `stripe:write` are
  removed from `i18n/en.json` and `i18n/pl.json`. Each of them is declared by
  `@endora-commerce/mod-mfa`, `mod-prompt-actions`, `mod-pwa` and `mod-stripe` in
  those packages' own bundles, in both shipped languages, and has been since
  feature 042 — the copy here was the one the admin actually rendered, because
  `/admin-roles` resolved the key in the synthetic `core` namespace alone. Feature
  091's Phase 3 makes the lookup read the merged bundle, so the module's own copy
  is now the answer and this one was a duplicate.

  No exported binding changes. A consumer that reads this package's bundle for one
  of those eight keys should read the owning module's bundle instead; the
  platform's merged bundle answers identically.

- 5fc21d1: Four keys for the InPost module's admin surfaces: `adminRoles.permission.inpost:manage`,
  `appShell.nav.inpost`, and `legacyMethods.integrations.inpost.{name,description}`, in both
  shipped languages.

  Nothing else in `i18n/{en,pl}.json` moves. That is worth stating: the branch this arrives
  on had regenerated both bundles with a tool that dropped 97 keys and replaced 18
  hand-written sentences with placeholders, and the merge rebuilt them from `master` plus
  these four rather than carrying that.

- 4fa03c3: `_i18n` declares the platform's 100 error codes, and `translate` answers to the module id as
  well as to the bundle namespace.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3, the last owner
  (`specs/090-module-owned-error-codes/core-block-home.md`). The list is the prefix chain's own
  answer for every code it routes to `core`, copied verbatim from the frozen capture and asserted
  equal to it in both directions. `core` is not a module id: it is the synthetic namespace this
  package's bundle is exposed under, so the module that owns the platform bundle is this one, and
  declaring the block here moves no sentence and edits no bundle.

  **One behavioural change, and it is the reason this is not a manifest-only patch.**
  `I18nService.translate(moduleId, …)` now resolves `_i18n` to the same bundle as `core`. Before
  this, the merged bundle map held a `core` key and no `_i18n` key, so
  `translate('_i18n', 'errors.INTERNAL', 'pl')` returned the placeholder — and both composition
  roots turn a placeholder back into the raising code's untranslated English. With the block
  declared, the composed routing map answers `_i18n` where the chain answered `core`, so without
  the normalisation 41 error codes would have lost their sentences in both shipped languages, with
  no log and no failing check.

  If you call `translate` yourself: `core` keeps working exactly as before and is still what the
  admin SPA asks for; `_i18n` now works too. The **placeholder** a miss returns is still built from
  the id you passed, so a caller comparing the answer to `` `${moduleId}.${key}` `` is unaffected.
  `getCoverageSnapshot` is unchanged — a fallback logged for `_i18n` is attributed to `core`, the
  namespace its bundle side is keyed by, rather than reported as a second module with no bundle.

  No routing code is touched: the prefix chain still answers for every code whose owner has not
  declared it yet, and it is deleted in the next merge request.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

- 69261b8: `taxes` declares `taxes:read` and `taxes:write`, and its admin routes enforce them instead of
  `catalog:write`.

  **Breaking for anyone whose roles reach this module's admin API.** All four routes moved, and
  unlike the three modules that preceded it, every one of them was gated on the catalogue's
  **write** code — there was no read gate to move:

  ```
  GET    /api/v1/admin/taxes           catalog:write -> taxes:read
  GET    /api/v1/admin/taxes/preview   catalog:write -> taxes:read
  PUT    /api/v1/admin/taxes/:code     catalog:write -> taxes:write
  DELETE /api/v1/admin/taxes/:id       catalog:write -> taxes:write
  ```

  So `taxes:read` is a capability that did not exist before rather than a rename of one: an
  operator can now be shown a VAT rate without being handed the authority to change it. Grant it
  alone for a finance or support role; grant the pair to configure rates.

  Nothing that _computes_ tax is affected. `orders`, `carts`, `product_feeds` and `quote_requests`
  resolve a rate through the `taxService` port in process; these routes serve the admin
  configuration screen and nothing else.

  There is no data migration and that is deliberate: granting the new codes to every holder of
  `catalog:write` would reproduce the distribution the change exists to remove, which would make it
  a change of spelling rather than of authority. A role that was configuring tax rules through the
  catalogue code is granted `taxes:read` / `taxes:write` on `/admin-roles`, where the manifest puts
  them automatically.

  `@endora-commerce/mod-i18n` carries the two `adminRoles.permission.taxes:*` labels and the
  screen's refusal notice, in `en` and `pl`.

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
  - @endora-commerce/platform@0.7.0
