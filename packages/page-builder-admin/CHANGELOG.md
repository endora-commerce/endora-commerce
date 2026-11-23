# @endora-commerce/page-builder-admin

## 0.112.0

### Minor Changes

- 38adf84: The admin's one unsaved-changes guard (issue #1446, UX audit DS-13).

  - `@endora-commerce/admin-kit/components` publishes `useUnsavedChangesGuard({ dirty, onSave?, onDiscard?, guardTabsOutside?, title?, message? })`, which returns `{ confirm(action), asking, dialog }`. While `dirty` it asks **Save and continue / Discard changes / Stay here** in the admin's own dialog before a same-origin link (the sidebar, a Back link), an opted-in host tab or a `confirm(action)` call drops the changes, and arms the browser's `beforeunload` prompt; the blocked link or tab is replayed after the answer. Render `dialog` once. Also published: `UnsavedChangesDialog` (the question on its own) and `UnsavedChangesHint` (the "Unsaved changes" status beside a Save button, a polite live region).
  - `@endora-commerce/admin-kit/lib` publishes `isDraftEqual(a, b)`, the structural comparison a screen computes its `dirty` with (key order and `undefined`-valued keys ignored, as JSON does). `useUnsavedChangesPrompt` is unchanged for its callers and now shares its interception with the guard.
  - `@endora-commerce/page-builder-admin`: `PageBuilderEditorLayout` takes `dirty`, `onSave` and `onDiscard` and arms the guard over the whole editor; `hasUnsavedCanvas` compares a Page Builder editor's active and stashed canvases with what was saved.
  - `@endora-commerce/mod-i18n`: the `core` copy for the guard (`form.unsavedChanges.title|body|save|saving|discard|stay|hint`), in English and Polish.

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

- 17ac8f1: A page builder that is still loading now shows a skeleton of the builder — a toolbar over the blocks drawer, the canvas and the fields panel — instead of a grey sentence above an empty bordered box (issue #1540). The new `PageBuilderLoadingSkeleton` export is a polite `role="status"` region marked `aria-busy`, with its label as visually hidden text and its pulse off under `prefers-reduced-motion`. The CMS page, block and template editors, the blog editors and the document-template editor use it; the CMS editors now mount Puck once the block config is known, and a failed config read still shows the degraded canvas.

### Patch Changes

- f093a02: Every dialog the Page Builder, the e-mail builder and the CMS editor open over the canvas is now the kit's `ModalDialog` on the `overlay` layer (issue #1493, UX audit CONTENT-03). Save as template, apply template, copy from language, clear canvas, Translate, the column-layout pickers, the colour palette, the asset library, the product and category searches, the variable picker and the e-mail preview all trap focus, close on Escape, return focus to the button that opened them, and are named by their title. Before, each drew its own scrim, and none of them trapped focus. The result of saving or applying a template, or of copying from a language, now appears next to its button. Before, it was announced only to screen readers. A failure stays inside the dialog. Clear canvas opens with focus on Cancel. The column-layout pickers, the variable picker and the catalogue searches read their copy from `core` in English and Polish, and their search fields are labelled. `MODAL_OVERLAY_Z_INDEX` rises from 10000 to 2147483646, so an `overlay` dialog also opens above the rich-text editor's own dialogs, from which the asset library is opened.
- a6d6f08: The Page Builder editors keep the canvas directly under the header at every width (issue #1511, UX audit CONTENT-01).

  - Below 1800 px an open settings panel is a sheet laid over the right of the canvas, sticky under the top bar and scrolling on its own, instead of a two-column wall of cards above the canvas. Escape closes the sheet and returns focus to **Show settings**. From 1800 px the panel is still a column beside the canvas. The sheet is not modal: the canvas stays usable beside it, and the fields keep what was typed when it is closed or the window is resized.
  - At every width the settings are one panel titled **Settings**, with a heading per group (Metadata, Breadcrumbs, Scope, SEO, URL keys, Tags, …) instead of one card per group. A new blog post or category, which has no canvas yet, shows the same panel as the page.
  - Unchanged: the panel still opens for a new entity and when a save is refused over a field in it, and the operator's choice to show or hide it is still remembered.
  - `PageBuilderEditorLayout` now draws the one card its `settings` share: a consumer passes its groups as `EditorSection`s with `as="h3"` (and the kit's `ScopePicker` with `titleAs="h3"`), not as `Card`s.

- 99042ee: Content that the Page Builder seeds into a document now follows the content locale being edited, not always English (issue #1684). The defaults are "Czytaj więcej" on a Polish page, and "Read more" on an English page or in a language with no defaults. This covers:
  - the summary that the rich-text toolbar's **Read more passage** inserts, in the CMS editors and in the e-mail builder;
  - the read-more label of a newly dropped `blog.LatestPosts` block.

  `@endora-commerce/page-builder-core` exports:
  - `PAGE_BUILDER_CONTENT_DEFAULTS`, the per-language table, with one entry per shipped language;
  - `contentDefaultFor(locale, key)`;
  - `withContentDefaultProps(config, locale, map)`, which seeds a block's default props in a locale (type `ContentDefaultPropsMap`);
  - `PageBuilderContentLocaleProvider` (`locale` is the BCP-47 content language a host edits) and `useContentDefault()`.

  Outside a provider, and without a locale, the defaults are English, as before.

  `@endora-commerce/cms-components` exports `CMS_CONTENT_DEFAULT_PROPS` and `LATEST_POSTS_CONTENT_DEFAULT_PROPS`. A stored `blog.LatestPosts` block with no `readMoreLabel` now reads the default of the language it renders in (`useBlockRenderEnvironment().language`).

  The CMS `PageBuilderEditor` mounts the provider and seeds its config with its `activeLanguage`. `EmailEditorPane` mounts the provider with its `previewLanguage`.

- 79d15cf: The Admin UI has one, light theme (issue #1810). `@endora-commerce/admin-kit/theme.css` no longer declares the `.dark { --background: … }` token block: nothing applied it, and applied by hand it was incomplete, with a light page under dark cards and unreadable outline buttons. An instance that set `.dark` on an element by itself now gets the light tokens; to restyle the admin, redeclare the `:root` tokens instead.

  The `dark:` utilities are gone too: `Badge`'s `success` and `warning` variants, the `ScopedField` "unsaved" badge, the shell's not-found notice, and the amber and emerald notices and icons in the admin screens of admin users, catalog bulk operations, the page-builder translate action and header actions, CRM propagation outcomes, custom-field carry drift, document-template item tables, tax-ID scope, product feeds and settings. Without a `dark` variant definition, Tailwind 4 compiles `dark:` to `@media (prefers-color-scheme: dark)`, so on an operating system set to dark these elements turned dark on a light page. They now render the same on every system.

- 8a0ec92: `ConfirmDialog` takes a `layer` prop and `useConfirmDialog` takes `{ layer }` options (UX audit follow-up, issue #1567). Both pass it to `ModalDialog`: `layer: 'overlay'` opens the question above the fullscreen Page Builder and Puck's floating action bar, which sat over a confirmation opened at the default `z-50`. The default stays `page`, so existing call sites are unchanged. The new `UseConfirmDialogOptions` type is exported from `./components`.

  The Page Builder's "Clear canvas" question, under the toolbar's "More" menu, is now `useConfirmDialog({ layer: 'overlay' })` instead of a hand-built `ModalDialog`. It behaves as before: focus starts on Cancel, Escape cancels, and focus returns to "More".

- 3d723ff: The newsletter screens, the PWA screen with its push audience builder, the transactional e-mail, e-mail block and e-mail template lists, and the e-mail builder's preview are now shown in the operator's language, English or Polish. They used to be in English whatever language was chosen.

  Statuses, audiences, trigger types, field types, display modes and scopes are shown by name rather than by code (`draft`, `tag_list`, `minimal-ui`, `channel`). Every input has a label tied to it instead of a placeholder that disappears on typing. A campaign's language is chosen from the languages the active sales channels offer instead of typed as a code.

  The page descriptions of these screens were removed, and the PWA push hint was shortened. Keys that nothing read were deleted: `newsletter.nav.*` and `newsletter.editor.*` from `newsletter`, `page.description`, `list.title`, `editor.preview`, `editor.viewport.*`, `editor.variables.*` and `editor.livePreview` from `transactional_emails`, and `settings.description` from `pwa`.

- Updated dependencies [c878440]
- Updated dependencies [c878440]
- Updated dependencies [65f9a7b]
- Updated dependencies [3fdbe86]
- Updated dependencies [bfc68c7]
- Updated dependencies [9eaa409]
- Updated dependencies [d908737]
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
  - @endora-commerce/page-builder-core@0.112.0
  - @endora-commerce/cms-components@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/email-components@0.112.0

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
- 2e603f7: Admin screens confirm destructive and consequential actions in the kit's `ConfirmDialog` rather
  than the browser's `window.confirm()` (issue #313). This covers deleting, revoking, removing and
  resetting across these modules, switching a module off on the Modules screen, undoing a bulk
  edit, making a sales channel the default, and preparing a customer's basket from a quote. The
  dialog names the action on its confirm button (for example _Delete_, _Revoke_, _Unassign_), and a
  destructive question opens with focus on Cancel.

  The three native `alert()` calls are now notices on the page: deleting an attachment type that is
  still in use (`catalog`), unassigning a channel's default warehouse (`inventory`), and activating a
  megamenu binding that replaces another (`megamenu`, announced through a live region). Renaming a
  setting group (`settings`) uses a one-field dialog instead of `prompt()`. Removing a colour from
  the page builder's palette (`page-builder-admin`) is confirmed inline in its row, because the
  palette is already a modal.

  Several of these questions were untranslated English literals. They are now bundle keys in
  English and Polish: the country, currency and language deletes (`dictionaries`), the e-mail block
  and template deletes (`transactional_emails`), the setting-group delete and rename and the setting
  reset (`settings`), and the sales-channel delete and rebind questions (`sales_channels`). The
  assets-library folder delete no longer says "OK = … / Cancel = …". `mod-i18n` adds
  `common.confirm.title` and the subscription-cancel button labels.

  Two native dialogs stay on purpose: the unsaved-changes navigation guard
  (`use-unsaved-changes-prompt`), which has to answer synchronously inside the click it intercepts,
  and the settings screen's discard-on-channel-switch guard, which is the same kind of guard. They
  will be replaced together in a later change.

- cd05402: The four packages now declare `sideEffects` in `package.json`, so a bundler can drop the modules a consumer imports through a barrel but never uses:

  - `@endora-commerce/contracts`: `false`. Its modules build Zod schemas, constants and pure helpers, and none of them does anything when it is imported.
  - `@endora-commerce/cms-components`: `["*.css"]`, so `@endora-commerce/cms-components/styles.css` imported from JavaScript is still kept.
  - `@endora-commerce/email-components`: `["*.css"]`, for the published `tailwind.css`.
  - `@endora-commerce/page-builder-admin`: `["*.css", "./dist/email/EmailEditorPane.js"]`. The e-mail editor pane imports the CMS and Puck stylesheets, so it is kept.

  The exported API does not change, and a consumer does not need to change anything. In this repository's admin build, the JavaScript loaded with the entry page shrank from 931.6 kB to 649.6 kB (gzip: 266.1 kB to 193.4 kB), and in the storefront build the first-load JavaScript of the CMS, catalogue, product and checkout pages shrank by 73 to 79 kB per page (`/` 729 kB to 650 kB, `/checkout` 271 kB to 198 kB). The stylesheets are the same.

- Updated dependencies [baa0dae]
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
- Updated dependencies [f5caa4e]
- Updated dependencies [d14a4fd]
- Updated dependencies [86a92af]
- Updated dependencies [ee2a111]
- Updated dependencies [c7ec2fa]
- Updated dependencies [bfa1ac4]
- Updated dependencies [52831b7]
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
  - @endora-commerce/admin-kit@0.111.0
  - @endora-commerce/contracts@0.111.0
  - @endora-commerce/cms-components@0.111.0
  - @endora-commerce/email-components@0.111.0
  - @endora-commerce/page-builder-core@0.111.0

## 0.110.0

### Minor Changes

- 2da23d2: A form picker for the `forms.Form` block (`specs/170-forms-module/` FR-004).

  - `@endora-commerce/page-builder-admin`: `FormPickerControl` and `createFormPickerField` — a Puck field choosing one of the forms the editor may see, with its status, a link creating a new form in a new tab, and the not-found, forbidden and load-failed states (the block keeps its form when the list cannot be read).
  - `@endora-commerce/mod-i18n`: the picker's words, `pageBuilder.formPicker.*`, in English and Polish.

- 3f020ba: **`ScopedField` — one inherited-value control for scoped product fields (feature 174).** `@endora-commerce/admin-kit` exports `ScopedField` and its types (`ScopedFieldProps`, `ScopedFieldControlProps`, `ScopedFieldViewWithParent`, `ScopedInheritedValue`): a field at Global, a channel, or a channel and language, showing "Use value from _parent scope_", an own value, or a deliberately empty value. `use-unsaved-changes-prompt` honours a `[data-own-unsaved-guard]` opt-out.

  **Breaking:** the product browser and the page-builder catalog pickers read a product's `name` as a string (the Global name); a caller passing a per-language name map passes the string instead.

  `CategoryTreePicker`'s list is a labelled `role="group"` instead of `role="tree"`: its rows are checkboxes, not `treeitem`s, and it has no tree keyboard model. A test that queried `getByRole('tree', …)` queries `getByRole('group', …)`.
  - `@endora-commerce/admin-kit/ui` exports `DropdownMenuSeparator` (the existing primitive), so a menu can set its destructive item apart.
  - `CategoryTreePicker`: clicking a category name toggles it, each expand control names its branch (`categoryTreePicker.expand` / `.collapse` take `{name}`), the list id is per instance, the loading line is a status, and its controls are 44 px below 1024 px. The `ScopedField` "Edit at" control is 44 px there too.

### Patch Changes

- c01aaa3: The e-mail editor preview shows the sample Unsubscribe link for newsletter templates only (issue #862). Since #861, a transactional e-mail is sent without the link, but `EmailEditorPane` still supplied a sample `unsubscribeUrl` for every template. It now supplies it only when `builderContext` is `'newsletter'`, in the HTML preview and in the canvas previews of embedded blocks. The newsletter preview is unchanged.

  `previewNode(content, builderContext?)` takes the editor's context as an optional second argument. It defaults to `'email'`, so a call without it draws no sample Unsubscribe link. Pass `'newsletter'` to keep the link in a newsletter canvas.

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
- Updated dependencies [a9398c8]
- Updated dependencies [0b56038]
- Updated dependencies [cc1496f]
- Updated dependencies [717e4c6]
- Updated dependencies [cea1470]
- Updated dependencies [cea1470]
- Updated dependencies [29d7e90]
- Updated dependencies [7f2fa6e]
- Updated dependencies [57145f7]
- Updated dependencies [58a1632]
- Updated dependencies [e46d233]
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
- Updated dependencies [974be57]
- Updated dependencies [32b4d0c]
- Updated dependencies [3355e60]
- Updated dependencies [7ce9b8a]
  - @endora-commerce/contracts@0.110.0
  - @endora-commerce/cms-components@0.110.0
  - @endora-commerce/admin-kit@0.110.0
  - @endora-commerce/email-components@0.110.0
  - @endora-commerce/page-builder-core@0.110.0

## 0.109.0

### Minor Changes

- e03e6a9: **BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
  - **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
  - **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
  - **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
  - **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has _All · Active · Inactive · Archived_ with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's _Set status_ offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
  - **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.

- 0e33ca9: Brand tokens for page-builder content: one set of colours, colour schemes, fonts, a type scale, button sizes, spacing and layout widths that every block reads, set globally and optionally overridden per sales channel.

  - `@endora-commerce/contracts` exports the token shape and its rules: `cmsBrandTokensSchema` / `CmsBrandTokens`, `DEFAULT_BRAND_TOKENS`, `BRAND_TYPE_TOKENS`, `BRAND_SPACE_TOKENS`, `BRAND_SCHEMES`, `brandFontSourceSchema` (system, library asset or `https:` stylesheet), the contrast helpers `assessBrandContrast`, `contrastRatio`, `relativeLuminance`, `CONTRAST_REQUIRED_BODY` / `CONTRAST_REQUIRED_LARGE`, and the HTTP shapes `putCmsBrandTokensRequestSchema`, `putCmsBrandTokensResponseSchema`, `cmsBrandTokensAdminReadSchema`, `cmsBrandTokensStorefrontResponseSchema`. `CMS_STOREFRONT_CACHE_TAGS.brand` (`cms:brand`) is the storefront cache tag a save revalidates.
  - `@endora-commerce/mod-cms` stores the tokens in a new `cms_brand_tokens` table (migration `20261022T163218_cms_brand_tokens`), serves `GET`/`PUT /api/v1/admin/cms/brand-tokens` (read with `cms.read`, write with the new permission `cms.brand`; optimistic version check, audited, a stale write is `409`) and `GET /api/v1/storefront/cms/brand-tokens` (answers on a closed sales channel too). The page-builder descriptor carries the effective `brandTokens` and accepts `?salesChannelId=`. The Admin UI adds a _Brand_ screen at `/cms/brand` with live preview and contrast warnings (saving is never blocked by them), reachable from the content navigation and the command palette (`open-cms-brand`); the page editor's preview applies the page's channel tokens.
  - `@endora-commerce/cms-components` exports `brandTokensToCss` (also at `@endora-commerce/cms-components/brand/brand-css`), which renders the tokens as `--cmsb-*` custom properties plus font links. Every block style that reads a `--cmsb-*` variable keeps the previous literal as its fallback, so a storefront that never emits the variables renders exactly as before.
  - `@endora-commerce/page-builder-core` re-exports the token types from its barrel and the values from the new `@endora-commerce/page-builder-core/brand-tokens` subpath. Colour fields may store a brand role as `token:<role>`: `BRAND_COLOR_ROLES`, `brandColorRole`, `brandColorFallback` and `resolveColorValue` (`token:primary` → `var(--cmsb-color-primary, <default>)`); the palette context gains an opt-in `brandRoles` flag, and `backgroundToStyle` resolves tokens.
  - `@endora-commerce/page-builder-admin`: `PageBuilderColorPaletteProvider` takes an optional `brandColors`; when set, the palette lists the brand colours first and a pick stores the role token. Leave it unset where content is rendered without the brand stylesheet, such as e-mail.
  - `@endora-commerce/mod-settings` lists the `cms-brand` cache namespace on the cache screen; `@endora-commerce/mod-i18n` adds the `pageBuilder.colorPalette.*` labels (English and Polish).

- 0e33ca9: `cms.ContentSlider` becomes the _Carousel_, with four item blocks, and **`cms.ImageSlider` is removed.**

  The Carousel keeps every option it had and adds a header (heading, lead, button), slides per view per breakpoint (1–8, fractions show the next slide), a gap token or custom pixels, a `fade` effect, controls placement (`overlay`, `below`, `header`), bleed to the viewport edge, an autoplay that is off by default, pauses on hover and focus and never runs under reduced motion. A stored slider maps through `contentSliderFromLegacy`: its arrows stay over the edges and its dots below, exactly as before. Its slides accept the new item blocks `cms.CarouselImage`, `cms.CarouselSplit` (media beside text and up to two buttons), `cms.LinkTile` and `cms.DownloadTile` (one download link with a file-type badge; renders nothing for customers when its asset is gone).

  `CarouselShell` (`@endora-commerce/cms-components/components/carousel/CarouselShell`) is rewritten for accessibility and layout stability: a named `region`, slides as numbered groups, arrows as named buttons with `aria-controls`, dots with `aria-current`, controls hidden when everything fits, and slide widths in CSS so server and client render the same markup. Its props are a superset of the old ones (`effect`, `controlsPlacement`, `bleed`, `header`, `label`, `labels`, responsive `slidesPerView` and `gap`); `CarouselSlides` is new. The carousel's accessible names follow the page language through `CmsRenderProvider`'s new `carouselLabels`. `@endora-commerce/page-builder-core` exports `CAROUSEL_SLIDE_TYPES` (from `./editor` and `./editor/puck-guards`), which lets the item blocks into a carousel's slides; `@endora-commerce/page-builder-admin` exports `createFileAssetField` for the download tile.

  **Breaking — `cms.ImageSlider` is gone.** The block is no longer declared or rendered, and these exports of `@endora-commerce/cms-components` are removed: `ImageSlider`, `imageSliderTitleStyle`, the `components/image-slider-item` subpath (`normalizeImageSliderItem`, `syncImageSliderItemImage`) and the types `ImageSliderProps`, `ImageSliderItem` and `ImageSliderTitlePlacement`. A page that still stores a `cms.ImageSlider` node keeps that node untouched in storage, but the storefront renders nothing for it (the rest of the page renders as before). To rebuild one, add a Carousel and one `cms.CarouselImage` per slide — every image-slider item option has a counterpart, and `carouselImageFromImageSliderItem(item)` performs the mapping for code that converts stored content:

  ```ts
  // before
  { type: 'cms.ImageSlider', props: { items: [item, …], slidesPerView, showArrows, … } }
  // after
  { type: 'cms.ContentSlider', props: { slides: items.map((item) => ({ type: 'cms.CarouselImage', props: { id: newId(), ...carouselImageFromImageSliderItem(item) } })), … } }
  ```

- 0e33ca9: `cms.Heading`, `cms.Button`, `cms.Hero`, `cms.FeatureList`, `cms.Stats` and `cms.Testimonial` are reshaped onto the shared block props and brand tokens. Every option they had is kept; the new ones are added beside it.

  **Stored content keeps rendering as before.** Each reshaped block maps a document saved in its old shape at render time and again, once, when the editor opens it: `headingFromLegacy`, `buttonFromLegacy`, `heroFromLegacy`, `featureListFromLegacy`, `statsFromLegacy` and `testimonialFromLegacy` are exported from `@endora-commerce/cms-components`. No migration rewrites stored pages, and the translation declarations keep the old paths, so an unopened page stays translatable.

  - `cms.Heading`: `text` is `InlineRichText` (a stored string is read as text), `level` h1–h6 or `p`, a `size` from the brand type scale or a custom size per breakpoint, `align`, a colour token, and an advanced group for font, weight, style and line height. Text is edited on the canvas again, through `INLINE_RICH_TEXT_FIELD_TRANSFORMS` (`@endora-commerce/cms-components/editor/inline-rich-text-canvas`), which the host passes to Puck's `fieldTransforms`.
  - `cms.Button`: one `button: ButtonSpec` (style, fill and size per breakpoint, icon) plus `align`.
  - `cms.Hero`: eyebrow, rich title, subheading, statement and body, up to six buttons, image or video media (background or above the content, per breakpoint), overlay, minimum height, gaps and social proof. Only the hero that leads the page — its first top-level block, or the first block of a first top-level `cms.Section` — loads its image eagerly with high fetch priority.
  - `cms.FeatureList`, `cms.Stats`, `cms.Testimonial`: rich item bodies, custom gap and size values, an avatar as a `ResponsiveImage`; columns are CSS custom properties per breakpoint instead of a client-side breakpoint switch.
  - `@endora-commerce/page-builder-admin`: `createButtonListField({ responsive })` stores per-breakpoint style and fill.

  Behaviour changes to note:

  - A stored video hero no longer autoplays unconditionally: videos start only when on screen, never under reduced motion, and use `preload="none"` with the poster.
  - A stored heading's `fontWeight` and `lineHeight` now apply even without a custom `fontSize` (they were ignored before).
  - A stored URL button whose URL is unsafe (`javascript:` or protocol-relative) renders without a link.
  - The exported props types `HeadingProps`, `ButtonProps`, `HeroProps`, `FeatureListProps`, `StatsProps` and `TestimonialProps` changed shape. Fields of the old shape remain as optional members (marked `@deprecated` where a new field replaces them); code that reads them may need a change — for example `HeadingProps.text` is now `InlineRichText | string`, read it with `inlineRichTextToPlain(text)`.

- 0e33ca9: The page builder's component options panel is easier to read and no longer scrolls sideways at its usual width (about 20rem).

  - `@endora-commerce/page-builder-core`: every custom field control renders with `PB_FIELD_INPUT_CLASS`, which keeps it inside its column. The controls had named a Puck CSS-module class that Puck 0.23 renamed, so they rendered unstyled, as wide as their content, and the panel scrolled sideways wherever a colour field or a long select appeared. The colour field's swatch, text box and Palette button stay on one row that fits the panel, and each control has its own accessible name. A value per breakpoint nested inside an object or array item (an image's aspect ratio) shows one label and a Mobile / Tablet / Desktop switch instead of three columns of controls, and a breakpoint with its own value is marked; a top-level value per breakpoint stays a field of the Responsive tab. Top-level fields are separated by a rule again. New exports: `PB_FIELD_INPUT_CLASS`, `PB_FIELD_LABEL_CLASS`, `PB_FIELD_HINT_CLASS`, `FieldControlLabel`, `ResponsiveTiers`, `FIELD_TIERS`, and `PAGE_BUILDER_FIELD_TEXT`, `PageBuilderFieldTextProvider` and `useFieldText`, through which a host translates the package's own field controls. `PuckFieldLabel` takes Puck's `el`.
  - `@endora-commerce/page-builder-admin`: `PageBuilderFieldText` translates those controls from the `core` bundle and is mounted by `PageBuilderColorPaletteProvider`, so the page and e-mail editors both get it. The image field's aspect ratio uses the same breakpoint switch. The link and image fields use the shared input and label classes.
  - `@endora-commerce/cms-components`: the table and catalog fallback controls use the shared input class.
  - `@endora-commerce/mod-i18n`: `pageBuilder.fieldText.*` in English and Polish.

- 0e33ca9: The rich text's image dialog picks an image from the asset library where the host provides a picker, and its width row lays out properly.

  - `@endora-commerce/page-builder-core` exports `PageBuilderImagePickerProvider`, `useImagePicker()` and the types `PageBuilderImagePicker`, `PageBuilderImagePickerProps` and `PickedImage` (`{ url, alt? }`): a host's image picker for controls that cannot import the admin. Without a provider `useImagePicker()` answers `null`.
  - The image dialog of `RichContentEditorField` (`@endora-commerce/cms-components`), used by every rich text in the page and e-mail builders, offers **Image source: Asset library / URL** when a picker is provided: the library first for a new image, the URL for an existing one. The chosen image's address is inserted, and its alternative text when the field is empty. Without a picker only the URL, as before. The stored image node does not change.
  - The **Width** number takes the row and its unit select a fixed 76 px; they no longer fight over one width.
  - `@endora-commerce/page-builder-admin` provides the asset library as that picker inside `PageBuilderColorPaletteProvider`, and exports `AdminImagePicker` and `pickedImageFromAsset(asset, language)`: the asset's stable `fileUrl`, made absolute, and its alternative text in the admin's language first.
  - `@endora-commerce/mod-i18n` carries the dialog's new copy (`pageBuilder.fieldText.richImage.*`) in English and Polish.

- 0e33ca9: A block's settings are shown where they apply and in one order — content, layout, look, spacing, visibility — and new blocks follow the section's colours.

  Nothing stored changes; the defaults below apply to newly inserted blocks only.

  - **Sliders** (`withoutUnusedCarouselFields`): the autoplay interval only with autoplay on; the arrows' look only while the arrows show; the disabled-arrow look (and its colour, for **Color**) only on a carousel that stops at its ends; the controls' placement and alignment only while arrows or dots show. The `controls` field is a cached copy, so the input keeps its focus.
  - **Shown where they apply**: a carousel image's caption look with a caption; a CTA card's image side with an image; a row's **Vertical position** with a minimum height; an accordion's **Divider position** where its items have lines; **Muted** only for a video file that does not autoplay (an autoplaying file is always muted); the social icon colour only with **Use brand colors** off (now before it).
  - **Order**: the media-and-text layout after the footnote; the link tile's image, title, link label and link first; the CTA card's look after its content; the stats' metrics before the image; the feature list's image next to the features; the background panel's text side after the buttons; a carousel image's link after its caption; the video's accessible title under its sources; the image and its alt text together on the General tab; the latest posts' number and category on the Data tab, the category picked from the blog's categories (`createBlogCategorySlugField`, still storing the slug).
  - **Item open at first** (`cms.Accordion`) and **Tab shown at first** (`cms.Tabs`) are chosen among the items (`createItemIndexField`), storing the index they always stored.
  - **Media and text** and the **carousel split slide** take a **Poster source** (asset library or URL) for both posters, with `posterUrl`; unset, the library image wins as before.
  - **Sources**: every image and video source offers the asset library first, and a new image starts on it; an image stored with no source and a URL keeps its URL source.
  - **New blocks**: a text has no colour of its own, icons and social links take `currentColor`, an announcement bar the brand's primary colours, so they read on a dark section.
  - Wording: the hero overlay's directions as the image's ("Darker at the bottom"…), the product card's **Button label**, **Card style** and plain words for its optional sizes, a custom maximum width's one range (160–2000 px), the video's maximum width "% of the available width".

- 0e33ca9: Shared prop shapes for page-builder blocks, with one renderer and one editor field each, so every block links, shows buttons, images and short formatted text the same way.

  - `@endora-commerce/contracts` exports the shapes as Zod schemas and types: `linkValueSchema` / `LinkValue` (URL, page, product, category, file or a section anchor on the same page; `javascript:` and protocol-relative URLs refused), `buttonSpecSchema` / `ButtonSpec` (label, link, style, fill, size, icon and per-breakpoint values), `responsiveImageSchema` / `ResponsiveImage` (desktop and mobile source, alt text, aspect ratio per breakpoint, fit, focal point), `inlineRichTextSchema` / `InlineRichText` (bold, italic, link, line break and the `gradient` / `accent` / `muted` emphasis), `colorValueSchema` (hex or `token:<role>`), `responsiveSchema(inner)` / `Responsive<T>`, and the space, scheme and width enums. The zod-free helpers (`normalizeAnchor`, `isSafeLinkUrl`, `isAspectToken`, `plainTextToInlineRichText`, `inlineRichTextToPlain`, the regular expressions and token lists) are also importable from `@endora-commerce/contracts/page-builder-values` without bundling Zod.
  - `@endora-commerce/page-builder-core` re-exports these types and helpers from its barrel.
  - `@endora-commerce/cms-components` exports the renderers: `ButtonView`, `Picture` (art-directed `<picture>`, lazy unless `priority`), `InlineRich` / `countInlineRichWords`, `resolveLinkHref`, `colorValueToCss` / `iconColorProps`, and the inline rich-text editor field `createInlineRichTextField` with `InlineRichTextEditor`, `inlineRichTextExtensions` and the `emphasisMark` TipTap mark. Button styles are the new `cmsc-btn` classes in the shipped stylesheet.
  - `@endora-commerce/page-builder-admin` exports the editor fields: `createLinkField` / `LinkFieldControl` / `LINK_KINDS`, `createButtonListField` (up to six buttons, optionally per breakpoint), `createButtonSpecField`, `DEFAULT_BUTTON_SPEC`, `createResponsiveImageField` / `ResponsiveImageControl`, `createFileAssetField` and `listPageBuilderLinkPages`. `createButtonLinkSlugField`, the previous slug-only link picker, is exported from here as well and keeps the stored value it always wrote.
  - `@endora-commerce/mod-i18n` adds the `pageBuilder.linkField.*` and `pageBuilder.imageField.*` labels (English and Polish).

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

- 0e33ca9: `cms.Video` plays a self-hosted file, `cms.Image` gains art direction, an aspect ratio per breakpoint, an overlay and a caption, and images in rich text take a size, an alignment and an inline mode. Every existing option keeps its meaning, and content saved before renders as it did.

  **`cms.Video`.** A new `source` (`embed`, today's, or `file`) adds a self-hosted video: `videoAssetId` (or a direct file URL in `url`), an optional `mobileVideoAssetId` shown below the tablet width, and a `posterAssetId`. A file loads nothing until it plays (`preload="none"`), plays inline, and never carries the `autoplay` attribute; with `autoplay` it is muted and started only while on screen, never for a visitor who prefers reduced motion. `aspectRatio` keeps `16:9`, `4:3` and `1:1` and now takes every aspect token and a custom `w:h`, per breakpoint, on the editor's Responsive tab. A stored video with no `source` is an embed.

  **`cms.Image`.** New optional props: `mobileSrc` / `mobileAssetId` (a `<picture>` source below the tablet width), `ratio` (per breakpoint; the frame reserves the space), `overlay` (`none`, `solid` or `gradient`, with direction and strength), and `caption` with `captionPlacement` (`below` or `beside`). `caption` is translatable. The image is now lazy-loaded and decoded asynchronously; with none of the new props set its markup and look are otherwise unchanged.

  **Video frames.** The hero's video above the content and the `cms.MediaText` video take `media.ratio` per breakpoint; unset is the 16:9 frame they had.

  **Rich-text images.** The TipTap `image` node gains `size` (a width in px or %) and `align` (`left`, `center`, `right`), rendered as `class="cmsc-rich-img cmsc-rich-img--<align>"` and `style="width: …"`; a new inline node `inlineImage` sets an image in the line of text. The editor's image dialog inserts and edits both. The sanitiser keeps a `width` in px or % on an `<img>` only; its policy's `cleanStyle` receives the element name as an optional second argument. New exports from `@endora-commerce/cms-components`: `richImageNode`, `inlineImageNode`, `RICH_IMAGE_SIZE_RE`, `RICH_IMAGE_ALIGNS`, `ImageDialog`, `RichImageChoice`; `overlayStyle` is exported from the section frame.

  **Fields.** `@endora-commerce/page-builder-core` exports `createAspectRatioField` (a responsive aspect-ratio field: a preset or a custom `w:h`, per breakpoint) and three field-text keys (`ratio.auto`, `ratio.custom`, `ratio.customValue`, translated in `mod-i18n`). `@endora-commerce/page-builder-admin` exports `ResponsiveRatioControl`, the image field's per-breakpoint ratio control, for ratios nested in a composite value. In the CMS editor the video's files and poster, and the image's mobile image, are picked from the asset library; every field of `cms.Video` and `cms.Image` is labelled in English and Polish.

- 3ccf23b: An art-directed image, or a section background, can keep its mobile art up to the desktop breakpoint.

  - `@endora-commerce/contracts`: `responsiveImageSchema` and `sectionBackgroundSchema` gain an optional `desktopFrom: 'tablet' | 'desktop'` (`DESKTOP_FROM_TIERS`, `DesktopFromTier` in `page-builder-values`). Unset means `tablet`, the 768 px switch, as before.
  - `@endora-commerce/page-builder-core` re-exports `DESKTOP_FROM_TIERS` and `DesktopFromTier`. The section background field offers **Mobile image or video shown on** once a mobile image or video is set; the default stores nothing.
  - `@endora-commerce/page-builder-admin`: the responsive image field offers **Mobile image shown on** once a mobile image is set.
  - `@endora-commerce/cms-components`: `Picture` writes `(max-width: 1023.98px)` on the mobile `<source>` for `desktopFrom: 'desktop'` (new export `pictureMobileMedia`). A section background's tiled image and video pair carry `data-desktop-from="desktop"` on `.cmsc-section__media`, and `useBreakpointVideo` takes an optional third argument, `{ mobileMedia }`, the query under which the mobile video plays.
  - `@endora-commerce/mod-i18n` carries the English and Polish copy.

- 3ccf23b: Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

  - `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
  - A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
  - A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
  - `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).

- ecdd2f7: New Page Builder block `cms.PageNavigation` ("Page navigation", category Interactive): a row of jump links to sections of the same page.

  - **Storefront:** a `<nav>` with an accessible name around plain `<a href="#anchor">` links, so it works without JavaScript. A client island highlights the link of the section in view (`aria-current="true"`, `cmsc-pb-page-nav__link--active`), keeps it visible inside a list that scrolls sideways on narrow screens without moving the page, and, for a sticky bar, writes its height to `--cmsc-page-nav-h` so a jumped-to target clears the header and the bar. Following a link scrolls smoothly unless the reader prefers reduced motion. With no valid link the block renders nothing.
  - **Options:** links (label and section anchor, at most 20), accessible name, look `pill` (default) or `underline`, alignment per breakpoint, "Stick to the top while scrolling", spacing, border, hide on. Colours come from the brand tokens and the section's colour scheme.
  - **`@endora-commerce/cms-components`:** exports `PageNavigation`, `pageNavigationItems`, `PAGE_NAVIGATION_MAX_ITEMS`, `usePageNavigationSpy`, the `PageNavigationProps`/`PageNavigationItem` types, and a new optional render-context entry `pageNavigationText` (`CmsPageNavigationText`, hook `useCmsRenderPageNavigationText`) for the default accessible name in the page language. New stylesheet section `.cmsc-pb-page-nav*`.
  - **`@endora-commerce/page-builder-admin`:** exports `createAnchorField(label)`, the link field's in-page anchor picker (the page's section anchors, or free text normalised to the anchor grammar) as a field of its own. The link field is unchanged.
  - **`@endora-commerce/mod-cms`:** declares the block (translatable `label` and `items[].label`) with en/pl labels, and gives its links the anchor picker in the editor. Module documentation page _Page navigation_.

- ecdd2f7: `newsletter.Signup` picks its topics from the newsletter's tags and can collect subscriber attributes.

  - **Topics:** in the admin, a topic's tag is chosen by name from the newsletter's tags (`GET /api/v1/admin/newsletter/tags`); the block still stores the tag code. A stored code the list does not hold stays selected, and without the list (no `newsletter:read`, the module off) the code is typed as before.
  - **Subscriber attributes (new, optional `attributes`):** up to 10 of the newsletter's custom fields, rendered after the e-mail field and before the topics — a yes/no field as a checkbox, a text, number or date field as the matching input (text at most 500 characters). Each item stores `key`, `type` and `fieldLabel` (picked together in the admin from `GET /api/v1/admin/newsletter/custom-fields`; typed as a key and a type select elsewhere), plus an optional `label`, `placeholder` (not for a yes/no field) and `required`. The form posts `attr.<key>` and one hidden `attrSpec` per attribute; a required attribute left empty is refused in the browser and by the storefront handler with the new `fields` reason, whose message is the block's `messages.fields`, else the page language's text (`CmsRenderProvider`'s new optional `newsletterSignupText`), else English. With no attributes the block's markup is unchanged.
  - `@endora-commerce/page-builder-admin` exports `createNewsletterTagCodeField`, `createNewsletterCustomFieldField`, their controls and `withNewsletterAttributePick`; `mod-cms` swaps them into the block in its editor.
  - `mod-newsletter` declares `attributes[].label`, `attributes[].placeholder` and `messages.fields` as translatable, and ships the new field labels in English and Polish.

### Patch Changes

- 0e33ca9: Carousels can stop at their ends instead of wrapping around, carousel image captions and link tile texts can change colour on hover, and a responsive value saved without a mobile value now applies from the breakpoint that has one.

  Nothing changes for a block that does not use the new options: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

  - **Carousel ends.** `loop` (`boolean`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. Unset or `true` keeps today's wrap-around: the previous arrow on the first page goes to the last page, and the next arrow on the last page back to the first. With `false`, `CarouselShell` stops at the first and last page. The arrow at an end gets the native `disabled` attribute and keeps its name, so a screen reader announces it as unavailable. On the first page the previous arrow is already disabled in the server HTML. The arrows follow the scroll position. An arrow disabled while it has focus passes the focus to the other arrow. Autoplay stops on the last page.
  - **Disabled arrow look.** `controls.disabledArrowLook` (`'dim' | 'outline-light' | 'color'`) and `controls.disabledArrowColor` (a brand colour token or a hex value). `dim` is the default (`opacity: 0.4`). The other two looks set the root class `cmsc-pb-carousel--arrow-off-light` or `--arrow-off-color` (with `--pb-arrow-off-color`), and only a carousel that does not loop gets one.
  - **Hover colours.** `cms.CarouselImage.captionHoverColor` and `cms.LinkTile.titleHoverColor` / `labelHoverColor` take a brand colour token or a hex value. The colour applies on hover and on keyboard focus, with a 0.2 s colour transition, or none under reduced motion. Only an item given a colour gets the class (`cmsc-pb-carousel-image--hover-caption`, `cmsc-pb-link-tile--hover-title`, `--hover-label`) and the custom property.
  - **Responsive values without `base`.** `isResponsiveProp` now also accepts an object that holds only `tablet` and/or `desktop`. `normalizeResponsive` gives such a value the caller's fallback as its base, so the breakpoints below the first one with a value render as unset. Before, the whole value was read as unset. The editor's scoped field readers, `ResponsiveRatioControl` and the hand-rolled readers in `cms.Button`, block alignment and `cms.FeatureList` read it the same way. An object with any other key is still a plain value.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

  - `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
  - The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.

- 0e33ca9: The image, icon, logo strip, announcement bar and map marker links are the shared link: a page, product, category, file, a section of the page or a URL, with **Open in new tab**.

  A URL stored before (`href`, with the image's and the icon's `linkTarget`) reads as a link of kind `url` with the same target — a logo's as a new tab, as it always opened — and a safe one renders as before; an unsafe one renders no link (see the safe-URL change).

  - `cms.Image`, `cms.Icons`, `cms.AnnouncementBar` and each `cms.LogoStrip` item gain `link` (`LinkValue`); `cms.Map`'s `markers[].link` takes a string or a `LinkValue`, and the marker's popup links its label. The blocks' `resolveData` carries a stored URL into `link` when the block is opened in the editor.
  - `@endora-commerce/cms-components` exports `blockLink`, `blockLinkTarget` and `carriedBlockLink`, the reading these blocks share.
  - The admin gives each of them the link field with its pickers. A link's **Open in new tab** shows once the link leads somewhere (or already opens a new tab).
  - A map marker is listed by its label or its position, up to 50 markers.

- Updated dependencies [42b1038]
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
- Updated dependencies [3ccf23b]
- Updated dependencies [0e33ca9]
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
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
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
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [eeed924]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
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
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/cms-components@0.109.0
  - @endora-commerce/page-builder-core@0.109.0
  - @endora-commerce/email-components@0.109.0

## 0.108.0

### Patch Changes

- 3a9dc6e: Raise `vite` to `^7.3.7`. It includes a dev-server fix that keeps module ids, not URLs, in `safeModulePaths`. `@endora-commerce/admin-shell`'s generated README lists the new peer range.
- Updated dependencies [0bd5a2b]
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
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
- Updated dependencies [e6f3a78]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/cms-components@0.108.0
  - @endora-commerce/page-builder-core@0.108.0
  - @endora-commerce/email-components@0.108.0

## 0.107.0

### Minor Changes

- 8397b0f: Page Builder translation. A **Translate** action in the Page Builder toolbar translates the canvas of the language tab being edited — or only the selected component or text — with the LLM configured in Settings → Page Builder (`cms.page_builder.translation.enabled`, `…llm_credentials`, `…max_source_characters`; off by default), behind the new permission `cms.translate`, through `GET /api/v1/admin/cms/page-builder/translation` and `POST /api/v1/admin/cms/page-builder/translate`. The result is an unsaved change with _Restore previous content_; every request that sent text is audited as `cms.page_builder.translate`.

  For block authors: `BlockDefinition` gains an optional `translatable: [{ path, format? }]` (`format` `plain` | `tiptap` | `html`, paths like `items[].title`) naming the props that are prose; it is served on the Page Builder descriptor. A block without it is never sent to a model. Every CMS-context block of `cms` and `catalog` declares it. `PageBuilderHeaderActions` gains an optional `extraActions` slot, and the blog post and category editors pass the editor what the action needs.

### Patch Changes

- ad55813: E-mail HTML previews are drawn in sandboxed frames that do not run scripts: the e-mail editor's full preview and the newsletter campaign preview carry `sandbox=""`, and the e-mail editor's inline preview of an embedded block or template is drawn in a script-less frame sized to its content instead of being injected into the editor's document. The inline frame's title is the new `core` key `pageBuilder.emailPreview.embedTitle` (English and Polish).
- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
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
- Updated dependencies [5b4312a]
- Updated dependencies [39c8e03]
- Updated dependencies [1525d86]
- Updated dependencies [ad55813]
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
  - @endora-commerce/page-builder-core@0.107.0
  - @endora-commerce/cms-components@0.107.0
  - @endora-commerce/email-components@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/page-builder-core@0.106.0
  - @endora-commerce/cms-components@0.106.0
  - @endora-commerce/email-components@0.106.0

## 0.105.0

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [964ada7]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
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
  - @endora-commerce/admin-kit@0.105.0
  - @endora-commerce/cms-components@0.105.0
  - @endora-commerce/page-builder-core@0.105.0
  - @endora-commerce/email-components@0.105.0

## 0.104.0

### Minor Changes

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
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/cms-components@0.104.0
  - @endora-commerce/email-components@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/cms-components@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/email-components@0.103.1
  - @endora-commerce/page-builder-core@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: The e-mail editor draws a module's contributed e-mail block with the renderer the send path runs. `EmailEditorPane` loads the `email` block contributions of the present modules, shows each on the canvas and in the HTML preview, and gives a declared block with no contributed renderer an editor built from its declared fields. A stored block the editor cannot render — a switched-off module's — is now a visible placeholder that keeps its props; it used to be drawn as nothing. New exports from `./email`: `emailBlockEditorConfig`, `composeEmailBlocks`, `loadEmailBlockRenderers`, `EmailBlockRenderersProvider`, `useEmailBlockRenderers` and their types. The pane must be rendered under `AdminContributionsProvider`, which the admin shell already mounts.

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/email-components@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/cms-components@0.103.0

## 0.102.0

### Minor Changes

- 255b60b: The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
  its package at 0.21 (`npm install @measured/puck` now prints _"Puck has moved"_), and these
  packages now import `@puckeditor/core` 0.23 — the code, the types and the stylesheet
  (`@puckeditor/core/puck.css`).

  **What a consumer changes.** If your project declares the editor itself — an admin application
  that bundles `@endora-commerce/page-builder-admin`, `@endora-commerce/mod-cms` or any of the
  modules above, or a storefront rendering pages through `@endora-commerce/cms-components`:

  ```bash
  pnpm remove @measured/puck
  pnpm add @puckeditor/core@^0.23.0
  ```

  and rename the specifier in any import of your own (`'@measured/puck'` → `'@puckeditor/core'`,
  `'@measured/puck/puck.css'` → `'@puckeditor/core/puck.css'`). A project scaffolded with
  `create-endora-commerce` / `endora new instance` gets the new name at its root from this release
  on; an existing instance renames the one line in its root `package.json`. Leaving
  `@measured/puck` installed does not satisfy the peer — the two names are different packages —
  so a bundler resolves `@puckeditor/core` to nothing and the editor fails to build.

  **Stored content is unchanged.** Puck 0.21–0.23 changed no part of the page data shape: CMS
  pages, blocks, templates, blog bodies, e-mail templates, newsletter blocks and invoice templates
  persisted under 0.20 render and edit as they did, with no migration and no read-time adapter.

  **The editor looks and behaves as it did.** Three 0.21–0.23 defaults that reshape the editor are
  pinned back for every builder host through new exports of `@endora-commerce/page-builder-core/editor`:
  `withPuckLegacySideBar(plugins)` keeps the stacked Components + Outline side bar instead of the
  0.21 Plugin Rail, `PUCK_LEGACY_VIEWPORTS` keeps the 0.20 Small / Medium / Large viewports without
  the 0.21 full-width one (the CMS host keeps passing its own breakpoints), and `PUCK_LEGACY_DND`
  keeps the 0.20 fluid drag-and-drop instead of the 0.23 insertion line. A host of your own built on
  these packages can pass the same three to its `<Puck>`.

  `@puckeditor/core` 0.23 requires Node 20 or later, below this platform's own floor (22.17).

### Patch Changes

- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/cms-components@0.102.0
  - @endora-commerce/email-components@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/cms-components@0.101.1
  - @endora-commerce/contracts@0.101.1
  - @endora-commerce/email-components@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
  - @endora-commerce/cms-components@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0
  - @endora-commerce/email-components@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [61bc20a]
  - @endora-commerce/cms-components@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/email-components@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/cms-components@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/email-components@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

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
  - @endora-commerce/page-builder-core@0.9.7

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-core@0.9.6

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
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/cms-components@0.9.5
  - @endora-commerce/email-components@0.9.5
  - @endora-commerce/page-builder-core@0.9.5

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-core@0.9.2

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
  - @endora-commerce/cms-components@0.9.1
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/page-builder-core@0.9.1

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
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/cms-components@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/email-components@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.2

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

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
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/page-builder-core@0.8.0
  - @endora-commerce/cms-components@0.8.0

## 0.7.0

### Minor Changes

- 1f07b01: New package: `@endora-commerce/page-builder-admin`, the admin-side page-builder chrome and
  the e-mail builder (feature 091 P5b; owner ruling D-192, widened in name only by
  `admin-component-contribution.md` Z1.2).

  Two subpaths. **`.`** publishes the chrome any builder composes — `PageBuilderHeaderActions`
  with `PageBuilderHeaderShell` and `PageBuilderTemplateActions`, the `createImage*` /
  `createSlideImage` / `createVideo*` asset field factories, the `create*Slug*` catalog field
  factories, `PageBuilderColorPaletteProvider`, `ColorPaletteModal`,
  `PageBuilderOverlayBridge`, `QuickTooltip` / `wrapQuickTooltip`, the `action-bar-target`
  store and `emptyPageBuilderData` / `isEmptyPageBuilderData`. **`./email`** publishes the
  e-mail builder those primitives compose — `EmailEditorPane`, `EmailVariablesProvider`,
  `EmailSubjectWithVariables`, `mergeEmailVariables`, `createEmailBuilderEditorPlugin` and the
  three template operations `saveCanvasAsEmailTemplate`, `listEmailTemplatesForApply` and
  `loadEmailTemplateCanvas`.

  **Why a fourth `page-builder` family member rather than a directory in `cms`.** All of it
  lived in `admin/src/modules/cms/components/` and `admin/src/modules/_shared/email-builder/`,
  and none of it names `cms`: `cms` held the chrome because `cms` was the first builder
  written. `cms` publishing it would make `transactional_emails` depend on `cms` in order to
  build an e-mail, and the admin kit refuses it on shape — every file here is a Puck component
  or field factory, so the kit would put `@measured/puck` behind the admin design system for
  all 66 module packages.

  **It is in the `linked` group** with `@endora-commerce/page-builder-core`,
  `@endora-commerce/cms-components` and `@endora-commerce/email-components`, and it peers on
  all three plus `@endora-commerce/admin-kit`. The peer ranges are load-bearing rather than
  tidy: `PageBuilderColorPaletteProvider` wraps `page-builder-core`'s `ColorPaletteProvider`
  context and `EmailVariablesProvider` is a context of its own, so a consumer that resolves two
  copies of either gets a `null` context at runtime and no type error.

  **Nothing here is new code.** Every binding is the one that stood in `admin/src`, and
  `admin/src` keeps a re-export shim at each old path, so an existing `@/modules/cms/components/…`
  specifier resolves to the package's own binding rather than to a copy.

  `@endora-commerce/cms-components` is patched because nothing of its own changed: it is listed
  so the release records that this package compiles its source and peers on its range.

### Patch Changes

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
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [11fc9f3]
- Updated dependencies [afedd32]
- Updated dependencies [f66ce9b]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
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
- Updated dependencies [1f07b01]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
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
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
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
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/cms-components@0.7.0
  - @endora-commerce/email-components@0.7.0
