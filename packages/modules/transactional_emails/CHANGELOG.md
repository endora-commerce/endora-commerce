# @endora-commerce/mod-transactional-emails

## 0.112.0

### Minor Changes

- 38571c4: **Breaking change:** `transactional_emails` now refuses a write that newly stores an asset id unless the administrator can see that file in the asset library. This covers a file that does not exist as well (issue #1354, the rest of #544). Before, these writes stored the id without checking it, so a file hidden from the administrator could be sent to every recipient.

  The check applies to:

  - E-mail content (`PUT /api/v1/admin/transactional-emails/:code/content`).
  - E-mail block and e-mail template content (`PUT .../blocks/:id/content/:language`, `PUT .../templates/:id/content/:language`).
  - The `transactional_emails.logo_asset_id` setting, set from the branding screen (`PUT .../branding`) or through the settings API.

  Asset ids are read from string values under keys ending in `assetId`, the rule the e-mail renderer uses. A refused write answers `404 ASSET_NOT_FOUND` with `details.assetId` and stores nothing. A hidden file and a missing one get the same answer.

  Ids the record already stores are not checked, so existing content saves as before. For e-mail content that means any id in the e-mail's default content or in any of its saved bodies, so a channel or language override that keeps the platform-wide images saves too.

  **What to do:** an integration or import that writes e-mail bodies or the e-mail logo must use asset ids that exist. When it runs as an administrator, that administrator must be able to see the files in the library. The asset library documentation lists the new paths.

- 4fd20c2: The e-mail branding — the header logo and the accent colour every transactional e-mail renders with — has an admin screen again (issue #1466). `/transactional-emails/branding` is a route, a sidebar entry under Messaging and the palette action `open-email-branding`, all gated on `transactional_emails:read`; its one Save needs `transactional_emails:write`. A Save sends only the fields changed for the selected scope, so a sales channel keeps inheriting the all-channels value of anything it does not override. The unused `BrandingPanel` component, which no screen imported, is removed; it was not exported from the package.
- 843ed42: A sales channel's e-mail branding override can be removed again, so the channel inherits the all-channels value (issue #1588).

  - `@endora-commerce/contracts`: `SettingsAdminPort` gains `resetValuesForSubset(code, channelCodes, actor)`, returning `SettingsResetValuesResult` (`resetChannelIds`, `newVersion`). It removes only the named channels' own values and refuses an empty subset with `SETTING_EMPTY_SUBSET`; the platform-wide value is never touched. An implementation of the port outside this repository must add the method. New schemas `emailBrandingFieldSchema` and `resetEmailBrandingQuerySchema` (types `EmailBrandingField`, `ResetEmailBrandingQuery`).
  - `@endora-commerce/mod-settings`: `SettingsAdminService.resetValuesForSubset` implements the port method over the existing `resetValues`.
  - `@endora-commerce/mod-transactional-emails`: `DELETE /api/v1/admin/transactional-emails/branding?salesChannelId=…&fields=logoAssetId,accentColor` (`transactional_emails:write`) removes the channel's own value for the named fields and answers the resolved branding. On the Email branding screen, a field a channel sets differently shows "Set for this channel" and a "Use all-channels value" control; it is staged, and Save removes the channel's value rather than copying the all-channels one in.

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

### Patch Changes

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

- d7de1ac: More admin lists tell "nothing here yet" apart from "your filters match nothing" (issue #1448). They used one grey sentence for both, so an operator who had never filtered read "No entries match the current filter.", and an operator whose filters hid every row had no way back but to undo each filter by hand. They now show the kit `EmptyState`: the `no-data` variant, with an icon, a title and one line, when there is nothing to list, and the `no-results` variant, whose _Clear filters_ button resets the filters and returns focus to the first filter field, when the filters hide everything.

  - **Audit log**: "Nothing recorded yet" on an unfiltered empty log. _Clear filters_ also clears the filters held in the URL.
  - **Invoices**: "No invoices yet" until an order is invoiced.
  - **Languages, Countries and Currencies** (dictionaries): Countries and Currencies used to draw an empty table when the search matched nothing, and Languages printed its "no match" sentence even when nothing was filtered. _Clear filters_ on Languages also resets the status filter.
  - **Transactional e-mails**: "No transactional e-mails" when no module declares one, and a no-match state for the search. The list no longer shows an empty state before it has loaded. The `transactional_emails` key `list.empty` is replaced by `list.emptyFiltered`.
  - **Newsletter subscribers**: "No subscribers yet", and a no-match state for the search and tag filters. A server scope notice still takes precedence. The list no longer shows an empty state before it has loaded. `subscribers.empty` now reads "No subscriber matches these filters."
  - **Comparisons**: "No comparisons yet", and a no-match state with the list's first _Clear filters_. A server scope notice still takes precedence.
  - **Product-feed template builder**: a field search that matches nothing shows the `no-results` state rather than a bare sentence. The search box gains an accessible name.

  New keys, in English and Polish: `core` `auditLog.emptyState.*` and `invoices.emptyState.*`; `dictionaries` `languages.emptyState.*`, `countries.empty`, `countries.emptyState.*`, `currencies.empty` and `currencies.emptyState.*`; `transactional_emails` `list.emptyFiltered` and `list.emptyState.*`; `newsletter` `subscribers.emptyState.*`; `comparisons` `list.emptyState.*`.

- b27a76c: Every content editor now warns before unsaved changes are lost (issue #1461, UX audit CONTENT-02). The CMS page, block and template editors, the blog post and category editors, the transactional e-mail and e-mail block/template editors, the document-template editor, the megamenu editor and the newsletter campaign and automation editors compare their draft with the last saved version, show "Unsaved changes" beside Save, and ask Save / Discard / Stay before Back, the sidebar or a closed tab throws the work away. The e-mail and document-template editors also ask before a channel or language switch reloads the canvas, and saving a megamenu binding no longer reloads the stored item tree over an unsaved one.
- 36344ed: Content screens no longer nest a button inside a link, and their labels now name their fields (issue #1465).

  - **Newsletter**: _Export CSV_, _New campaign_, _New automation_ and the campaign's _Stats_ are each one link styled as a button (`<Button asChild>`), not a button inside a link. Before, each took two tab stops.
  - **CMS page, block and template editors** and the **megamenu editor**: Name, Slug, Code, Status and Description are wired through `FormField`. The page's public address describes its slug field.
  - **Megamenu item editor**: the URL, link target, variant, asset type, embed side and root category fields are tied to their labels. The per-language labels form a group, and each input is named by the group and its language.
  - **PWA**: the colour captions no longer appear as labels for nothing, and the push audience choice is a radio group named "Audience".
  - **Search boxes** on the CMS pages list, the blog post and tag lists and the transactional e-mails list are search fields with a translated name (EN + PL). Before, only a placeholder named them. The e-mails list placeholder now comes from the bundle.
  - **Prompt actions panel**: the instruction input has a name ("Instruction" / "Polecenie"). The busy line now sits in a status region that is mounted before it has text, so screen readers announce it.

  A structural admin test now rejects a button nested in a link, or a link nested in a button, anywhere in the admin sources.

- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
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

- 9f37a4c: The settings and admin screens show an action's result beside the control that caused it. They no longer show it as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result region.

  - Dictionaries (Languages, Currencies, Countries): "Made default", "Saved" and "Deleted" appear in the list toolbar, beside the add button.
  - E-mail branding, global search configuration, the ordering defaults panel (when it has its own Save) and the PWA screen: "Saved" appears beside Save. On the PWA screen, each action's result appears beside its own button: reset to global, icon upload, VAPID key generation, and push send. Changing the scope clears them.
  - Taxes, admin users and admin roles: the saved tax rule, the reset password and the deleted role appear beside the header's "New …" button.
  - Customer groups, payment methods and delivery methods: a save appears beside the form's title. On customer groups, a deletion is announced to screen readers only, because the deleted row is already gone from the list.
  - SEO: a regenerated sitemap appears in the sitemap card's header.
  - Webhooks: "Replay queued" appears in the deliveries card's toolbar.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- b2c1723: The transactional e-mails list is easier to scan (issue #1536). Each e-mail is switched on and off with a switch instead of a filled "Switch on" button, and the switch says when the change is still being saved. The Module column shows the module's name in the admin's language instead of its id, and the list can be filtered by module. The "Content" column says whether an e-mail uses the default content or is customized for all channels or per channel. While loading, the list shows a placeholder, and a failed load can be retried. In the e-mail editor, the header says where the content comes from in words, the scope list and the e-mail branding page name sales channels by their names, and the Save button reads "Saving…" while a save runs. Every module that sends a transactional e-mail now ships its name in English and Polish.
- b98739c: The product editor and the Email branding page ask about unsaved changes through the admin kit's one unsaved-changes guard (issue #1606), so the dialog, its focus (Stay here first) and its buttons — **Save and continue**, **Discard changes**, **Stay here** — are the same as on every other admin editor. Each screen keeps its own question: the product editor's "Save your changes at <scope>?" with the number of unsaved changes, and Email branding's "Unsaved branding changes", with the scope-switch message when the scope is switched. A link elsewhere in the admin (the sidebar, for instance) is now asked about in that dialog rather than in the browser's two-button confirmation; on the product editor, **Stay here** after the browser's Back between scopes still puts the scope back in the address.

  Translation keys removed from both `en` and `pl` (the buttons now use `core` `form.unsavedChanges.*`): catalog `productEditor.guard.save`, `productEditor.guard.discard`, `productEditor.guard.stay`; transactional_emails `branding.switchScope.save`, `branding.switchScope.discard`, `branding.switchScope.stay`. A deployment that overrides a removed key can drop the override. On Email branding the buttons now read _Save and continue_ / _Discard changes_ / _Stay here_ instead of _Save and switch_ / _Discard and switch_ / _Stay_.

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
- Updated dependencies [2d6d031]
- Updated dependencies [3d723ff]
- Updated dependencies [72637e0]
  - @endora-commerce/page-builder-core@0.112.0
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0
  - @endora-commerce/page-builder-admin@0.112.0
  - @endora-commerce/email-components@0.112.0

## 0.111.0

### Minor Changes

- d362c3c: Deleting a system email block or a system email template is refused with an error code of its own
  instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #638, part of #86). **A
  caller that matches on `VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP
  status is unchanged. Until now each was answered with an English sentence in every language,
  because the error envelope never replaces the message of `VALIDATION_FAILED`.

  | Route                                                     | Was                                                              | Is                                        | `details`                    |
  | --------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------- |
  | `DELETE /api/v1/admin/transactional-emails/blocks/:id`    | `409 VALIDATION_FAILED`, _"System blocks cannot be deleted."_    | `409 TRANSACTIONAL_EMAIL_SYSTEM_BLOCK`    | `blockId`, `blockCode`       |
  | `DELETE /api/v1/admin/transactional-emails/templates/:id` | `409 VALIDATION_FAILED`, _"System templates cannot be deleted."_ | `409 TRANSACTIONAL_EMAIL_SYSTEM_TEMPLATE` | `templateId`, `templateCode` |

  The row's own code travels as `blockCode` / `templateCode` rather than `code`, because the error
  envelope reads `details.code` as a refusal token. Both codes are members of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `transactional_emails` manifest, and the module's
  documentation page names them. No setting, permission or migration changes.

### Patch Changes

- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- e283396: `templateEmailPort` renders a template in the sales channel and language its caller names (`TemplateEmailSendInput.salesChannelId` / `language`), falling back to the system-default channel for a missing or deleted channel and to the channel's default language for a missing language. A caller that names neither is unchanged.
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

- 4efb051: The module page lists every module's registered e-mails and describes how delivery records are anonymised with a customer account. Documentation only.
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
  - @endora-commerce/page-builder-admin@0.111.0
  - @endora-commerce/page-builder-core@0.111.0

## 0.110.0

### Patch Changes

- b2db8c3: English module names and admin sidebar labels are now sentence case, like the rest of the UI. The manifest `name` changes for 22 modules and for the platform's `_lifecycle` module ("Quote Requests" becomes "Quote requests", "API Keys" becomes "API keys", "Module Lifecycle" becomes "Module lifecycle"). The English `module.name` for Quick order, Quote requests and Shopping lists changes the same way. That string heads their permission groups on the organization role form and appears on the modules screen. The admin sidebar labels in blog ("Blog posts", "Blog categories", "Blog tags"), cms ("CMS pages", "CMS blocks", "CMS templates", "CMS hooks"), custom_fields ("Custom fields"), import_export ("Import / export"), newsletter ("Tags & fields") and transactional_emails ("Transactional emails", "Email blocks", "Email templates") change the same way. Product names (Google Analytics, Google Tag Manager, LinkedIn Ads, Meta Ads) keep their capitals. Polish strings do not change. If your code compares a manifest `name` against the old title-case string, update the comparison. Better, compare the module `id`.
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
- cc1496f: The remaining English Page Builder block labels now use sentence case: "Simple Text" becomes
  "Simple text", "Rich Content" becomes "Rich content", "Insert Block" becomes "Insert block",
  "Insert Template" becomes "Insert template" and "Spacer / Divider" becomes "Spacer / divider".
  The quote request field in the admin search configuration becomes "Quote request number".
  The Polish import and export navigation label and page title become "Import / eksport". Other
  Polish strings are unchanged. Product names keep their capitals: Page Builder among them.

  The documentation pages that quote these labels are updated to match, and the admin search
  page now writes its group labels as "Quote requests" and "Sales opportunities", as the screen
  has shown them since the previous release.

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
  - @endora-commerce/email-components@0.110.0
  - @endora-commerce/page-builder-core@0.110.0

## 0.109.0

### Minor Changes

- c73366c: A template variable's `sampleValueKey` (issue #560) is resolved, through `_i18n`'s `adminI18nService`, in the language being edited: the e-mail detail (the editor's variable list and live preview) and the server preview both show that language's sample. The manifest's `sampleValue` answers when the key does not resolve, when the content language has no shipped bundle, or when the resolver refuses. The module now declares `_i18n` in its `dependencies`; `_i18n` cannot be switched off, so no operator loses an activation control.
- 87af080: `409 TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` now carries the email's registry code as `details.emailCode`; `details.code` no longer carries it, and the error has no `details.code` at all. The owning module's reason is still `details.reason`. The code gains a sentence in English and Polish naming the email (`The "account_activation" email is always on and cannot be switched off.`), which is the message now — until now the envelope read the email code as a refusal token, found no sentence and answered the registry's English reason in every language. A client that read the email code from `details.code` reads `details.emailCode` instead; one that showed the message as the reason reads `details.reason`.

### Patch Changes

- d86466f: The command-palette actions of the content and marketing modules (`analytics`, `assets_library`, `blog`, `cms`, `google_analytics`, `google_tag_manager`, `linkedin_ads`, `megamenu`, `meta_ads`, `newsletter`, `pwa`, `seo`, `transactional_emails`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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
  - @endora-commerce/email-components@0.109.0

## 0.108.0

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
  - @endora-commerce/page-builder-admin@0.106.0
  - @endora-commerce/page-builder-core@0.106.0
  - @endora-commerce/email-components@0.106.0

## 0.105.0

### Minor Changes

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

### Patch Changes

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
  - @endora-commerce/page-builder-admin@0.105.0
  - @endora-commerce/page-builder-core@0.105.0
  - @endora-commerce/email-components@0.105.0

## 0.104.0

### Patch Changes

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
- Updated dependencies [9d6dfbc]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/page-builder-admin@0.104.0
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/email-components@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/email-components@0.103.1
  - @endora-commerce/page-builder-admin@0.103.1
  - @endora-commerce/page-builder-core@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: Transactional e-mail and its admin preview render the e-mail blocks other modules contribute through `emailBlockRendererRegistry`. Saved e-mail content, e-mail blocks and e-mail templates may now hold a block any composed module declares for the `email` context — save-time validation used to refuse every name outside the built-in set. A block whose module is switched off contributes nothing; a renderer that throws is logged with the block and its owner, and the message is still rendered and sent. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
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
  - @endora-commerce/page-builder-admin@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/platform@0.103.0

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

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/page-builder-admin@0.102.0
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
  - @endora-commerce/page-builder-admin@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

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
  - @endora-commerce/page-builder-admin@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/email-components@0.100.2
  - @endora-commerce/page-builder-admin@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/email-components@0.100.1
  - @endora-commerce/page-builder-admin@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

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
  - @endora-commerce/page-builder-admin@0.9.7
  - @endora-commerce/page-builder-core@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-admin@0.9.6
  - @endora-commerce/page-builder-core@0.9.6
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
  - @endora-commerce/page-builder-admin@0.9.5
  - @endora-commerce/page-builder-core@0.9.5
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
  - @endora-commerce/page-builder-admin@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/page-builder-admin@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-admin@0.9.2
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
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/page-builder-admin@0.9.1
  - @endora-commerce/page-builder-core@0.9.1
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
  - @endora-commerce/page-builder-admin@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-admin@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.8.1

### Patch Changes

- e9649df: `Migration20260801T111001TransactionalEmailsEmailDefaultsReseed` no longer writes `newsletter`'s
  table (`specs/120-migration-closure-bridge-ownership/` Phase 5, FR-019; feature 097's already-written
  retiring condition, executed).

  Two statements are removed from `up()`, in place:

  ```sql
  update "newsletter_email_blocks" set "content" = …, "version" = "version" + 1, "updated_at" = now()
    where "code" = 'newsletter_default_header' and "is_system" = true;
  update "newsletter_email_blocks" set "content" = …, "version" = "version" + 1, "updated_at" = now()
    where "code" = 'newsletter_default_footer' and "is_system" = true;
  ```

  `newsletter_email_blocks` is `@endora-commerce/mod-newsletter`'s table, and this module cannot
  legally reach it: `transactional_emails` declares `activation: { nonDeactivatable: true }` while
  `newsletter` declares an activation control, so naming `newsletter` in this module's `dependencies`
  would turn that control into a dead switch — the lifecycle orchestrator refuses a disable with live
  dependents, and a `--cascade` would have to disable a module that refuses.

  **The removal loses nothing on a fresh database.** `newsletter`'s own
  `Migration20260629T200954NewsletterInit` seeds those two blocks from the identical
  `envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES)` call against the same
  `@endora-commerce/email-components` defaults, so the statements wrote bytes their owner had already
  written and bumped `version` for nothing. The only database on which they did anything is one that
  ran `newsletter_init` before those components changed — and there the module that should refresh
  `newsletter`'s system blocks is `newsletter`. **No replacement migration is added here**, and none
  should be: that refresh is `newsletter`'s to ship, in a `newsletter`-owned migration that needs no
  cross-module edge at all.

  **The class is not renamed and no stamp moves.** `mikro_orm_migrations` persists the class name and
  holds no checksum — measured again on `@mikro-orm/migrations@6.6.13`, whose `ensureTable()` builds
  `id` / `name` / `executed_at`, whose `logMigration` inserts `{ name }`, and whose pending set is
  `umzug`'s name diff — so a database that has applied this migration is offered nothing from it and
  its schema does not move.

  **What an instance gets is the ability to migrate at all.** Until now a consumer that installed this
  package without `@endora-commerce/mod-newsletter` aborted its first migration on
  `relation "newsletter_email_blocks" does not exist`, inside the install of a module the platform
  refuses to run without. The `endora new instance` acceptance criterion now applies its 118 migrations
  and exits 0, where it previously failed on this class.

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
  - @endora-commerce/page-builder-admin@0.8.1
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
  - @endora-commerce/page-builder-admin@0.8.0
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Minor Changes

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

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

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

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

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
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [b9d15af]
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
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/page-builder-admin@0.7.0
