# @endora-commerce/mod-api-keys

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

- 6658f0f: A bound API key whose service account is blocked, deleted or anonymized is refused with an error
  code of its own instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #644,
  part of #86). **A caller that matches on `VALIDATION_FAILED` for this refusal now sees the specific
  code.** The HTTP status is unchanged. Until now all three branches of binding rule B3 shared one
  English issue, _"Service account must be an active customer account of the bound organization."_,
  in every language.

  | Route                                                                                                                                      | Was                                                               | Is                                     | `details`                                                                                                                                   |
  | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `POST /api/v1/admin/api-keys` (the service account of the bound organization is blocked, deleted or anonymized, and nothing else is wrong) | `422 VALIDATION_FAILED`, one issue on `binding.customerAccountId` | `422 API_KEY_SERVICE_ACCOUNT_INACTIVE` | `code: "blocked"` or `code: "removed"` (deleted or anonymized), `field: "binding.customerAccountId"`, `customerAccountId`, `organizationId` |

  When any other binding rule fails as well, the answer stays the aggregate `422 VALIDATION_FAILED`
  and still lists the inactive account, now as _"Service account is blocked."_ or _"Service account
  has been removed."_ An account that does not exist and an account of another organization stay
  `VALIDATION_FAILED`, each with its own issue: _"Service account does not exist."_ and _"Service
  account does not belong to the bound organization."_ The code is a member of `ERROR_CODES` in
  `@endora-commerce/contracts`, declared by the `api_keys` manifest with the tokens `blocked` and
  `removed`, and the module's documentation page names it. No setting, permission or migration
  changes.

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

- eb4dbc6: API key replies are described by their contract (issue #599, section 6):

  - `@endora-commerce/contracts` publishes `apiKeyListResponseSchema` / `ApiKeyListResponse` for `GET /api/v1/admin/api-keys`, a `data` array of `apiKeySchema` rows. The rows were already described, but the list envelope was not.
  - `mod-api-keys` builds every key reply as the contract's `ApiKey` instead of `Record<string, unknown>`. The list handler returns `ApiKeyListResponse` and the create handler returns `{ data: CreateApiKeyResponse }`. The admin API keys page uses the contract's `ApiKeyListResponse` instead of a hand-written interface. Nothing on the wire changes.

- b064fec: Documentation only. The module page (English and Polish) says that `requireApiKey` and `requireBoundApiKey` are provided as ports.
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

- b2db8c3: English module names and admin sidebar labels are now sentence case, like the rest of the UI. The manifest `name` changes for 22 modules and for the platform's `_lifecycle` module ("Quote Requests" becomes "Quote requests", "API Keys" becomes "API keys", "Module Lifecycle" becomes "Module lifecycle"). The English `module.name` for Quick order, Quote requests and Shopping lists changes the same way. That string heads their permission groups on the organization role form and appears on the modules screen. The admin sidebar labels in blog ("Blog posts", "Blog categories", "Blog tags"), cms ("CMS pages", "CMS blocks", "CMS templates", "CMS hooks"), custom_fields ("Custom fields"), import_export ("Import / export"), newsletter ("Tags & fields") and transactional_emails ("Transactional emails", "Email blocks", "Email templates") change the same way. Product names (Google Analytics, Google Tag Manager, LinkedIn Ads, Meta Ads) keep their capitals. Polish strings do not change. If your code compares a manifest `name` against the old title-case string, update the comparison. Better, compare the module `id`.
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
- 17d6004: `403 API_KEY_NOT_BOUND` and `403 API_KEY_CHANNEL_MISMATCH` are answered in the caller's language.
  Neither code had a bundle sentence, so the refusal was English whatever `Accept-Language` said.
  The module's bundle now holds both in English and Polish; the English sentences read exactly as the
  messages did ("This endpoint requires a distributor-bound API key.", "API key is bound to a
  different sales channel."), and with `Accept-Language: pl` the answers are "Ten endpoint wymaga
  klucza API powiązanego z dystrybutorem." and "Klucz API jest powiązany z innym kanałem sprzedaży."

  The codes, the statuses and `details` are unchanged: neither refusal carries a value, so neither
  sentence has a placeholder.

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

- fe48d6d: Administrators hand out only the permissions their own role holds. A holder of the wildcard `*` is unaffected.

  - `PUT /api/v1/admin/admin-roles/:code` refuses a role holding a permission the actor lacks, and refuses to change a role that already holds one, with `403 ADMIN_ROLE_GRANT_EXCEEDED` (`details.permissions` names the missing codes). A role the platform or a module seeds — `platform_admin` included, with its `requiresTwoFactor` flag — is changed only by a holder of `*`; anybody else is answered `409 ADMIN_ROLE_PROTECTED` with `details.code: 'modify'`.
  - `POST` and `PATCH /api/v1/admin/admin-users` assign a role only if the actor holds every permission it grants (`403 ADMIN_ROLE_GRANT_EXCEEDED`). An account whose role holds a permission the actor lacks is not edited, given a password, deactivated or deleted by them: `403 ADMIN_USER_OUTRANKS_ACTOR`.
  - `POST /api/v1/admin/api-keys` issues a key only with scopes the issuing administrator's role holds: `403 API_KEY_SCOPE_NOT_HELD`, with the missing scopes in `details.scopes`. `api_keys` now declares `admin_roles` as a dependency.

  `AdminRolePort.upsertByCode(input, options?)` takes an optional `{ grantor: { permissions } }`. Pass it for a write made on an administrator's behalf; leave it out for a platform write — a module seeding its roles, an upgrade step, the bootstrap command — which is not held to the ceiling. `@endora-commerce/contracts` exports `permissionsNotHeld(requested, held)` and `ADMIN_PERMISSION_WILDCARD`, and three new `ERROR_CODES` members.

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

### Patch Changes

- eda5003: `403 API_KEY_OUT_OF_SCOPE` names the missing scope in `details`, and is answered in the caller's
  language. The refusal's message — "API key lacks the required scope: catalog:write." — was the only
  place the scope appeared, so an integration had to cut it out of prose, and the code had no bundle
  sentence at all, so the answer was English whatever `Accept-Language` said.

  The error now carries `details.requiredScope`, and the module's bundle holds a sentence in English
  and Polish that interpolates it. The English sentence reads exactly as the message did; with
  `Accept-Language: pl` the answer is "Klucz API nie ma wymaganego zakresu: catalog:write."

  `details` names the scope the route requires and nothing else — not the key, and not the scopes it
  does hold; those stay in the `api_key.out_of_scope` audit row. The code and the status are
  unchanged.

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
