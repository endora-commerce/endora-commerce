# @endora-commerce/mod-webhooks

## 0.112.0

### Minor Changes

- 40b76aa: Five admin lists no longer draw a create form open above their rows, nor a red button in every row (issue #1501, UX audit SHELL-14). Each is the kit `ListPage`: one _New …_ in the header, row actions in a `RowActionMenu` with the destructive one last and confirmed through `useConfirmDialog`, and an `EmptyState` offering the first record.

  - **Users** (`/admin-users`): _New user_ opens the create form in a dialog; _Reset password_ opens a dialog instead of a form expanded under the row; _Deactivate_ / _Reactivate_ and _Remove_ are in the row menu. The role is shown as a value with a _Change…_ dialog (`StatusChangeControl`) instead of an unlabelled select that saved as soon as an option was picked.
  - **API keys**: the create form is a route of its own, `/api-keys/new` (`contributions.routes[1]`, gated on `integrations:manage` like the list); it ends on the one-time bearer token, shown in place of the form. _Revoke_ is in the row menu.
  - **Webhooks**: the subscribe form is a route of its own, `/webhooks/new` (`contributions.routes[1]`, same gate); it ends on the one-time signing secret. _Pause_ / _Resume_ and _Delete_ are in the row menu.
  - **Taxes**: _New tax rule_ opens the upsert form in a dialog, and the new _Edit_ row action opens it prefilled, the code read-only.
  - **Setting groups** (`/settings/groups`): _New group_ opens a dialog with labelled _Code_ and _Display name_ fields; _Rename_ and _Delete_ are in the row menu, which is disabled, with the reason, on the system-protected group. Its load, create and delete errors are translated.

### Patch Changes

- fd27113: Content and system admin screens drop the page descriptions that repeated their title or spoke the implementation (issue #1436, UX audit 2026-11-17, DS-02). No description any more on: the CMS page, block and template editors, Brand, the blog post editor (once saved) and category editor (non-system), the Forms list, New form and Entries, the megamenu editor, the Comparisons list and detail, Settings, Settings groups, Cache, Modules, Command hooks, API description, Users, Roles, API keys, Webhooks, Taxes, Audit log, Credentials, the global-search configuration and results. The Brand cards for colour schemes, spacing and preview drop their intro line, and the Home stock-alert card its subtitle.

  Moved behind a ⓘ beside the title (`help`): the Modules screen's note on installation versus activation, the document-template default rule, and the Meta Ads note that standard events are always reported.

  Shortened to one line: the document templates, Meta Ads and LinkedIn Ads descriptions, the blog addresses description, the new post and new category notes, the CMS page editor's field notes (page fields, language version, breadcrumb parent and overlay, parent path, share image), the Brand scope and type-scale notes, the forms share-answer note, the megamenu click-navigates note, the Cache screen's two action notes, the API reference note, the reset-password note and the global-search settings note.

  Translation keys removed from both `en` and `pl`: `core` `platform.modules.description`, `platform.modules.cliHint` (now `platform.modules.help`), `platform.commandHooks.description`, `platform.apiDescription.description`, `home.stockAlerts.subtitle`, `adminUsers.page.descriptionPrefix`, `adminUsers.rolesLink`, `adminRoles.page.descriptionPrefix`, `adminRoles.usersLink`, `apiKeys.page.description`, `webhooks.page.description`, `taxes.page.description`, `auditLog.page.description`; cms `pageEditor.description`, `blockEditor.description`, `templateEditor.description`, `brand.description`, `brand.schemes.hint`, `brand.spacing.hint`, `brand.preview.hint`, `brand.layout.tierHint`; blog `postEditor.description.edit`, `categoryEditor.description.default`; forms `list.description`, `create.description`, `entries.description`; megamenu `editor.description`; comparisons `list.page.description`, `detail.page.description`; settings `page.description`, `groups.page.description`, `cache.page.description`; credentials `page.subtitle`; admin_search `page.configuration.description`, `page.results.description`. New keys: `core` `platform.modules.help`, document_templates `page.help`, meta_ads `customEvents.help`. A deployment that overrides a removed key can drop the override.

- 9f37a4c: The settings and admin screens show an action's result beside the control that caused it. They no longer show it as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result region.

  - Dictionaries (Languages, Currencies, Countries): "Made default", "Saved" and "Deleted" appear in the list toolbar, beside the add button.
  - E-mail branding, global search configuration, the ordering defaults panel (when it has its own Save) and the PWA screen: "Saved" appears beside Save. On the PWA screen, each action's result appears beside its own button: reset to global, icon upload, VAPID key generation, and push send. Changing the scope clears them.
  - Taxes, admin users and admin roles: the saved tax rule, the reset password and the deleted role appear beside the header's "New …" button.
  - Customer groups, payment methods and delivery methods: a save appears beside the form's title. On customer groups, a deletion is announced to screen readers only, because the deleted row is already gone from the list.
  - SEO: a regenerated sitemap appears in the sitemap card's header.
  - Webhooks: "Replay queued" appears in the deliveries card's toolbar.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- 98c0411: The Admin UI sidebar's _System_ section, which had 18 entries, is now two sections (issue #1519, UX audit SHELL-11, owner decision DEC-02):

  - **Access**: Users, Roles, API keys, Credentials, Audit log.
  - **Platform**: Modules, Settings, Custom fields, Import/export, Bulk operations, Webhooks, Global search, PWA, Command hooks, API description.

  Host rows are now sorted by weight together with the contributed rows. Before, they always came first, so the API description sat above Settings.

  An administrator's own two-step verification is no longer in the sidebar. It is the **Security** tab of **My profile** (`/profile/security`), opened from the avatar or from the palette's _Account security_ action, which now targets that tab. `/security` redirects there, so old bookmarks still work. With `mfa` off, the profile has no tab strip and `/profile/security` opens the profile.

  **For module authors.** `AdminNavSectionNameSchema` gains `'access'` and `'platform'`, and `AdminZoneNameSchema` gains `'profile.security'`, the body of the Profile's Security tab, with empty props. `'system'` is deprecated but still accepted: the shell puts such an entry under _Platform_, so a module that ships separately keeps its row. It will be removed in a major release.

  **Upgrade notes.**

  - An administrator who had collapsed _System_ sees both _Access_ and _Platform_ collapsed. The preference is rewritten the next time they toggle a group.
  - A pin of `/security` in the sidebar's Pinned section no longer shows, because that destination is no longer a sidebar entry. The stored pin is kept but not displayed.

- 59228fc: The API-key and webhook create forms offer their binding as a choice instead of explaining it
  (issue #1551, UX audit SHELL-15). _New API key_ opens on **Platform key** or **Organization
  key**: the organization, sales channel and service account appear only for the second, and each
  type offers only the scopes it may hold — no order scopes on a platform key, no `catalog:write`
  on an organization key — so the three validation messages that restated the binding rule and the
  two paragraphs explaining it are gone. _New webhook_ asks **All organizations** or **One
  organization**, with the organization picker only for the second. The remaining field help is
  one line each, and the signing-secret screen has a one-line title with the receiver note beneath.
  What a key or a subscription can do, and the API, are unchanged.

  Removed translation keys (`mod-i18n`): `apiKeys.create.bindingHelp`, `bindingTitle`,
  `modesHelp`, `scopesHelp`, `serviceAccountHelp`, `expiresHelp`;
  `apiKeys.validation.bindingIncomplete`, `bindingRequiredForOrders`, `catalogWriteBound`;
  `webhooks.create.organizationHelp`. A deployment overriding them should move the override to the
  new `apiKeys.create.kind.*`, `apiKeys.create.{scopes,serviceAccount,expires}.hint`,
  `webhooks.create.scope.*` and `webhooks.revealed.body` keys.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

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
- Updated dependencies [72637e0]
  - @endora-commerce/platform@0.112.0
  - @endora-commerce/contracts@0.112.0
  - @endora-commerce/admin-kit@0.112.0

## 0.111.0

### Minor Changes

- 357cc2a: `webhook_deliveries` gets a retention window (issue #928). A new platform-wide setting, `webhooks.delivery_retention_days` (number, default 365, read as the default outside 1–3650 whole days), and a daily BullMQ Job Scheduler (`webhooks.delivery-retention`, attached through `ctx.worker` where `webhooksRunWorkers` is true, so no tick runs while the module is off) delete every `succeeded`, `failed` or `dead_lettered` delivery row created before the window, with its payload and the receiver's response. `pending` and `in_flight` rows are never deleted. A deleted row can no longer be replayed. The module now declares `zod` as a peer dependency, for the setting's read.

### Patch Changes

- 62b4e98: Finished `webhook.deliver` jobs are removed from Redis by age, in line with the delivery-history retention window `webhooks.delivery_retention_days` (issue #1003). A job carries the event's payload and the subscription's signing secret, and until now the queue bounded its finished jobs by count only (500 completed, 5 000 failed), so on a quiet instance they stayed in Redis indefinitely.

  - `webhookJobRetention(retentionDays)` (in `services/webhook-queue.ts`) returns the `removeOnComplete` / `removeOnFail` options: the window as `age`, with the count bounds kept. `createWebhookQueue` uses it with the default window as the queue's default job options.
  - The event bridge reads the window once per event and passes it on every job it enqueues, so a changed setting applies to the next job. `EventBridgeOptions.retentionDays` is optional; without it the default window applies.
  - BullMQ applies `age` only when another job finishes, so the daily retention tick also removes the completed and failed jobs past the window. `WebhookDeliveryRetentionService` takes the delivery queue as an optional third argument, and `purge()` now answers `{ retentionDays, deleted, jobsRemoved }`.

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

- dc9bbea: Webhook admin replies are described by their contract (issue #599, section 6):

  - `@endora-commerce/contracts` publishes `webhookListResponseSchema` / `WebhookListResponse` for `GET /api/v1/admin/webhooks`, `createWebhookResponseSchema` / `CreateWebhookResponse` for `POST /api/v1/admin/webhooks` (the subscription plus its signing secret, answered this once), `webhookDeliveryListResponseSchema` / `WebhookDeliveryListResponse` for `GET /api/v1/admin/webhooks/deliveries`, and `webhookEventTypeListResponseSchema` / `WebhookEventTypeListResponse` for `GET /api/v1/admin/webhooks/event-types`. The rows were already described, but these envelopes were not.
  - `mod-webhooks` builds every subscription and delivery reply as the contract's `Webhook` / `WebhookDelivery` instead of `Record<string, unknown>`, and each handler declares its reply type. The admin Webhooks page uses the contract types instead of hand-written interfaces. Nothing on the wire changes.

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

## 0.110.0

### Patch Changes

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

## 0.109.0

### Patch Changes

- b0a1e48: The command-palette actions of the administration modules (`admin_feedback`, `admin_roles`, `admin_search`, `admin_users`, `api_keys`, `audit_logs`, `mfa`, `settings`, `webhooks`, the kernel-served `module_lifecycle`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`użytkownicy`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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

## 0.105.0

### Minor Changes

- 602e5ba: Six more events are delivered to webhooks: three product events, two quote-request events and the
  credit-limit adjustment.

  They were emitted on the in-process event bus and delivered to nobody. Each is now offered on the
  Webhooks screen, accepted by the API and delivered, while the module that owns it is present:

  | Event                      | Owner            | Payload, beside `eventId` and `occurredAt`                      |
  | -------------------------- | ---------------- | --------------------------------------------------------------- |
  | `product.created.v1`       | `catalog`        | `productId`, `sku`                                              |
  | `product.updated.v1`       | `catalog`        | `productId`, `changedFields` (field names only)                 |
  | `product.archived.v1`      | `catalog`        | `productId`                                                     |
  | `rfq.created.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `rfq.expired.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `credit_limit.adjusted.v1` | `credit_limits`  | `organizationId`, `amount` (the granted limit after the change) |

  **The owning module offers its own events.** `catalog`, `quote_requests` and `credit_limits` push
  their event names into `webhooks`' `webhookEventRegistry` from a boot hook and declare the edge as
  `contributes-to` — the mechanism `crm` already uses. `webhooks` names none of them, and its two
  built-in types are unchanged. With `quote_requests` or `credit_limits` switched off, their types are
  not offered and a new subscription to them is refused; stored subscriptions are kept and receive
  nothing until the module is back.

  **Who receives them.** Product events carry no `organizationId`, so they reach platform-wide
  subscriptions only. Quote-request and credit-limit events reach platform-wide subscriptions and the
  subscriptions bound to that Organization, never one bound to another.

  **The payloads are published contracts.** `@endora-commerce/contracts` exports a strict schema for
  each — `CATALOG_WEBHOOK_EVENT_SCHEMAS`, `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`,
  `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` — with the matching `*_WEBHOOK_EVENT_TYPES` and
  `*_WEBHOOK_EVENTS` constants and one `…EventV1Schema` and type per event.

  Three changes of behaviour in the owning modules:

  - **`catalog` now emits `product.archived.v1` when a product's status moves to `inactive`.** The
    event was emitted only by a deprecated method nothing called, so no path an administrator, an
    import or a PIM synchronisation takes ever announced it. It is emitted once per transition, after
    the `product.updated.v1` of the same write, on every update path. A subscriber on the in-process
    bus — the search indexer removes the product from the index on it — now receives it. The
    archiving write waits for the subscribers of both events before it returns, so a reactivation
    that follows at once cannot be undone by a removal still on its way; on the unaudited update
    path (the API-key upsert, a bulk edit) that makes an archiving write as slow as its subscribers,
    where it used to return without waiting.
  - **`rfq.expired.v1` carries `organizationId`.** Without it the event could reach no subscription
    bound to an Organization. An additive field.
  - **`CreditLimitService` constructed without a Command Bus emits `credit_limit.adjusted.v1` after
    its transaction has committed**, not from inside it, so an adjustment whose commit fails is not
    announced. The composed module always has a Command Bus and was not affected.

  **A contributed event type is delivered only while its owner is present.** `webhooks` asked for
  its own presence before delivering and not for the contributing module's, so an event carrying the
  name of a switched-off module was still delivered to the subscriptions stored for it. The bridge
  now asks per event, for every contributed type — the `crm` ones included. The two built-in order
  events are unaffected.

  Not delivered, and documented as such: a product being deleted (`product.deleted.v1` stays
  in-process), and a product being reactivated (there is no un-archive event; it shows as `status` in
  `changedFields`). `rfq.expired.v1` is sent only by the quote-request expiry sweep, so it occurs
  only on an instance where that sweep runs.

  **Volume.** Nothing is batched: a bulk edit, an import or a PIM synchronisation writes products one
  by one, so a subscription to `product.updated.v1` receives one delivery per product written. An
  event type no subscription names enqueues nothing.

- 8ee69de: The Webhooks screen offers only event types that are delivered, and the API refuses the rest.

  The subscription form offered thirteen event types while the backend delivered two of them,
  `order.created.v1` and `order.status_changed.v1`. A subscription to any of the other eleven was
  saved without complaint and never received anything, and the API accepted any non-empty string, a
  misspelled name included.

  **Breaking for API clients.** `POST /api/v1/admin/webhooks` and
  `PATCH /api/v1/admin/webhooks/:id` now answer `422` with the new error code
  `WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE` when `eventTypes` names an event type that is neither built in
  nor contributed by a module that is switched on; `error.details.eventTypes` carries the refused
  names. A client that sent other strings must send only the names the screen offers: the two above,
  plus the answer of `GET /api/v1/admin/webhooks/event-types`. The request schema's shape is
  unchanged.

  **Subscriptions that already exist are untouched.** There is no migration. A stored subscription
  that carries a name nothing delivers is still listed, can still be paused, renamed, re-pointed and
  deleted, and may keep that name through an `eventTypes` update — only a name a write _adds_ is
  checked. The screen marks such names as not delivered. They receive nothing, as they did before.

  `@endora-commerce/contracts` exports the list both sides now read:
  `WEBHOOK_BUILT_IN_EVENT_TYPES`, the `WebhookBuiltInEventType` type,
  `deliverableWebhookEventTypes(contributed)` and `ERROR_CODES.WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`.
  The backend subscribes its delivery bridge from the constant and the form offers from it, so the
  two cannot drift apart again. A module that wants its events delivered contributes them through
  `webhookEventRegistry`, as before.

  No event type is delivered that was not delivered before, and none stopped being delivered.

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

## 0.104.0

### Minor Changes

- 32775d5: Other modules can offer event types of their own as outbound webhooks.

  `webhookEventRegistry` (`WebhookEventRegistryPort`) is a new container name: a module pushes
  `{ ownerModuleId, eventType }` from a boot hook and declares the edge as
  `nonBindingDependencies: [{ moduleId: 'webhooks', name: 'webhookEventRegistry', kind: 'contributes-to' }]`.
  Each contributed type is bridged to the delivery queue through this module's own gated
  subscription, and its payload is sent whole — so an event a module offers is that module's
  public contract. `GET /api/v1/admin/webhooks/event-types` (`integrations:manage`) lists the
  contributed types whose owner is switched on, and the subscription form offers them after its
  own list. While an owner is switched off its types are not offered; subscriptions naming them
  are kept and receive nothing.

  Nothing changes for an instance in which nobody contributes: the two built-in event types and
  the form's own list are as they were.

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

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
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
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.7

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

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

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
  - @endora-commerce/platform@0.13.1

## 0.10.4

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

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Two tables are created by the packages that own them: `api_keys` and `customer_groups`
  (`specs/120-migration-closure-bridge-ownership/` Phase 3, FR-014 and the owner's ruling of
  2026-09-12).

  Both were created by whichever module needed them first rather than by the one that owns them. That
  is normally harmless — 27 such creations stay where they are, because a consumer who omits the
  creating module gets an empty table and nothing worse — and these two were not, because each also
  produced a reference from outside the referencing module's dependency closure: a fresh database
  could not be migrated by a member set that omitted the creator.

  **They move between two already-applied migration bodies, and that is the whole design.** The
  ordinary repair — take the statement out and re-add it in a new migration — is right for a
  _reference_, which can only move later in the computed order. It is wrong for a _creation_: a new
  migration runs after the entire frozen historical prefix, and both tables are referenced by
  migrations inside it, so the creation would have landed after its own consumers and broken a fresh
  database. Each creation therefore moves into the frozen body that carries the **earliest** reference
  to it, so no position in between is affected.

  **No class is renamed.** `mikro_orm_migrations` persists the class name and holds no checksum
  (measured on `@mikro-orm/migrations@6.6.13`), so neither edited body is re-offered to a database
  that has applied it, and nothing is pending anywhere from this change.

  **`create table if not exists`, and it is load-bearing rather than defensive.** A database that
  applied the _donating_ migration and has not yet reached the _receiving_ one — anything a release or
  more behind — already has the table while the receiving migration is pending. A verbatim creation
  fails there; the guarded one is a no-op. Both spellings were measured against a fully migrated
  database: guarded skips, unguarded raises `relation already exists`.

  **`@endora-commerce/mod-api-keys`** — `Migration20260724T173916ApiKeysDistributorBinding` now creates
  `api_keys` and its `key_hash` index, above its own `alter table`, and drops the table in `down()`.
  Its position already preceded both frozen references — its own `alter`, and `orders`' foreign key.

  **`@endora-commerce/mod-webhooks`** — `Migration20260425T091359WebhooksUs7Init` no longer creates
  `api_keys`. The two modules were one surface until the US7 split and the creation stayed behind;
  this package names `api_keys` in no statement of its own. A consumer installing `mod-webhooks`
  without `mod-api-keys` no longer receives the table, which is the point: it is not this package's.

  **`@endora-commerce/mod-customer-accounts`** — `Migration20260611T140403CustomerAccountsLifecycle`
  now creates `customer_groups`, above the foreign key it already had to it, and drops the table in
  `down()`. This package's `CustomerGroup` entity has always owned the table.

  **`@endora-commerce/mod-price-lists`** — `Migration20260426T075235PriceListsPricingInit` no longer
  creates `customer_groups`. Tiered pricing needed customer groups first and created them where it
  needed them; nothing in this package references the table — `price_list_assignments.customer_group_id`
  is a nullable column with an index and no foreign key.

### Patch Changes

- f20bc38: Documentation: these packages' pages no longer link Endora's own documentation
  site by relative path.

  A page each package ships under `docs/` linked `../architecture/…` or
  `../integrations/…` — a page above the modules category, which is site content
  and travels with no package. Installed anywhere but the Endora repository, the
  link named a page that is not there, and a documentation build over the
  installed set therefore failed under Docusaurus's `onBrokenLinks: 'throw'` —
  whatever else was installed alongside. The guides are now named in prose.

  No exported symbol, schema, route or translation key changes.

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

## 0.7.0

### Minor Changes

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

### Patch Changes

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
  - @endora-commerce/platform@0.7.0
