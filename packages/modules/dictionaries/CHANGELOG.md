# @endora-commerce/mod-dictionaries

## 0.112.0

### Patch Changes

- b2b41eb: Page headers are shorter and every page has a heading (issue #1436). Home, Profile, the products list, product create and edit, the inventory and warehouse screens and Pricing settings now draw their title as a real page heading. Page descriptions that repeated the title or described the implementation are removed (categories, bulk operations, new price book, SEO, assets library, dictionary, products list, inventory, warehouses, home, profile); the rest are one short line, in English and Polish. Longer explanations — warehouses, Pricing settings, import/export and category taxonomy revisions — moved behind an ⓘ beside the title.
- d7de1ac: More admin lists tell "nothing here yet" apart from "your filters match nothing" (issue #1448). They used one grey sentence for both, so an operator who had never filtered read "No entries match the current filter.", and an operator whose filters hid every row had no way back but to undo each filter by hand. They now show the kit `EmptyState`: the `no-data` variant, with an icon, a title and one line, when there is nothing to list, and the `no-results` variant, whose _Clear filters_ button resets the filters and returns focus to the first filter field, when the filters hide everything.

  - **Audit log**: "Nothing recorded yet" on an unfiltered empty log. _Clear filters_ also clears the filters held in the URL.
  - **Invoices**: "No invoices yet" until an order is invoiced.
  - **Languages, Countries and Currencies** (dictionaries): Countries and Currencies used to draw an empty table when the search matched nothing, and Languages printed its "no match" sentence even when nothing was filtered. _Clear filters_ on Languages also resets the status filter.
  - **Transactional e-mails**: "No transactional e-mails" when no module declares one, and a no-match state for the search. The list no longer shows an empty state before it has loaded. The `transactional_emails` key `list.empty` is replaced by `list.emptyFiltered`.
  - **Newsletter subscribers**: "No subscribers yet", and a no-match state for the search and tag filters. A server scope notice still takes precedence. The list no longer shows an empty state before it has loaded. `subscribers.empty` now reads "No subscriber matches these filters."
  - **Comparisons**: "No comparisons yet", and a no-match state with the list's first _Clear filters_. A server scope notice still takes precedence.
  - **Product-feed template builder**: a field search that matches nothing shows the `no-results` state rather than a bare sentence. The search box gains an accessible name.

  New keys, in English and Polish: `core` `auditLog.emptyState.*` and `invoices.emptyState.*`; `dictionaries` `languages.emptyState.*`, `countries.empty`, `countries.emptyState.*`, `currencies.empty` and `currencies.emptyState.*`; `transactional_emails` `list.emptyFiltered` and `list.emptyState.*`; `newsletter` `subscribers.emptyState.*`; `comparisons` `list.emptyState.*`.

- 84ed7b6: Empty lists now tell "nothing here yet" apart from "your filters match nothing" (issue #1448). The products, inventory, warehouses, back-in-stock and pricing-override lists used to show one sentence for both. Now a list that its filters emptied offers _Clear filters_, and a list with no records offers its create action, if the operator may use it. The sales channels, credentials, online customers, invoice ledger deliveries, dictionary audit and command hooks screens show the kit's empty state instead of a plain grey sentence.

  - **`EmptyState`'s documentation** says where the block belongs. Use it for the page's or the tab's primary region. Keep a one-line sentence for pickers, inline sub-lists and side widgets.
  - **Header create buttons.** While a list is empty, its header no longer repeats the create button that the empty state carries: products, warehouses, inventory import, sales channels and credentials.
  - **Removed keys.** `catalog` drops `productsList.empty.prefix`, `.button`, `.suffix` and `.readOnly`. The empty catalog now uses `productsList.empty.noData.*`.
  - **Peer dependencies.** `mod-sales-channels`, `mod-credentials` and `mod-invoice-ledger` gain an optional peer dependency on `lucide-react` `^1`, which their admin screens now import.

- 3f66b6f: The Dictionary screen (`/dictionaries`) is translated throughout (issue #1456): the title, the tab names, every table header and form label, the region and symbol-position options, and every success and error message now come from the module's bundle in English and Polish. The Countries / Currencies / Languages switcher is a real tab list (arrow keys, Home/End, one tab stop). Each search box has an accessible name, the icon-only row buttons are named, and rows are no longer drag-and-drop: one pair of Move up / Move down buttons per breakpoint reorders them, on the Currencies tab too.
- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
- 9f37a4c: The settings and admin screens show an action's result beside the control that caused it. They no longer show it as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result region.

  - Dictionaries (Languages, Currencies, Countries): "Made default", "Saved" and "Deleted" appear in the list toolbar, beside the add button.
  - E-mail branding, global search configuration, the ordering defaults panel (when it has its own Save) and the PWA screen: "Saved" appears beside Save. On the PWA screen, each action's result appears beside its own button: reset to global, icon upload, VAPID key generation, and push send. Changing the scope clears them.
  - Taxes, admin users and admin roles: the saved tax rule, the reset password and the deleted role appear beside the header's "New …" button.
  - Customer groups, payment methods and delivery methods: a save appears beside the form's title. On customer groups, a deletion is announced to screen readers only, because the deleted row is already gone from the list.
  - SEO: a regenerated sitemap appears in the sitemap card's header.
  - Webhooks: "Replay queued" appears in the deliveries card's toolbar.

- 9868c7c: The admin dictionary screens put their _Add_ in one place, the page header (issue #1562, UX audit WORK-13).

  - **Tasks › Tags** and **Tasks › Priorities**: _Add tag_ / _Add priority_ is the filled button in the page header instead of an outline button in a card header, and the card title that repeated the page title ("Tags", "Priorities") is gone. The count column now reads "Tasks (visible to you)", as does the workflow screen's status count, because the server counts only the Tasks the operator can see. A row's delete button is drawn in the destructive tone.
  - **CRM › Tags**: the empty list shows the admin's empty state (icon, title, one line, _Add tag_), and the header's _Add tag_ is hidden while the list is empty, so the screen has one primary action. The count column reads "Opportunities (visible to you)".
  - **Projects › Roles** and **Loss reasons**: the same empty state with its _Add_ replaces the bare "Nothing to show.", and the header's _Add_ is hidden while the dictionary is empty.
  - **Dictionaries** (Countries, Currencies, Languages): the active tab's _Add country_ / _Add currency_ / _Add language_ moves from the tab's card into the page header, opens the editor and moves focus to its code field. The card no longer repeats the tab's name above the table; the table is named by it. The empty state carries the _Add_ while a dictionary is empty. A row's _Edit_, _Set default_ and red _Delete_ buttons become one row menu, "Actions for PL", with _Delete_ last; on the default row _Delete_ and _Set default_ are disabled and _Delete_ says why.

  The i18n keys `tags.list.title` and `priorities.list.title` (tasks) and `dictionary.empty` (projects) are removed. The CRM `tags.empty` is now a short title, with the sentence moved to the new `tags.emptyBody`. The API is unchanged.

- 966e32b: Six admin list screens are the kit `ListPage` now (issue #1749): Sales channels, Credentials, Online customers, Invoice ledger deliveries, Dictionary audit and Comparisons. Each has the kit's loading skeleton, a load error with **Retry**, the result count announced at the end of the toolbar row, and its filters in a toolbar row instead of a card.

  - **Credentials:** _Preview_, _Edit_ and _Delete_ are in the row's menu, and the name opens the configuration. _Delete_ runs inside the confirmation, so a configuration a setting still uses is refused there, with the settings to detach.
  - **Online customers:** the customer's name opens the customer; the _Open_ button is gone. A refresh, by hand or on the timer, keeps the rows on screen.
  - **Invoice ledger deliveries** and **Comparisons:** the _Load more_ button is replaced by the kit pager (_Previous_ / _Next_ and rows per page), as on the invoices list. Comparisons puts the date range behind _More filters_, and the owner opens the comparison.
  - **Dictionary audit:** _Copied_ and _Cache invalidated_ are said beside the buttons, not in a banner.
  - `@endora-commerce/mod-invoice-ledger` no longer ships `mergeLedgerDeliveryPages`, the _Load more_ helper; it was internal to the screen.
  - New `en` / `pl` keys: `sales_channels` `list.toolbar.label`, `list.count`; `credentials` `page.count`, `action.menu`; `customers` `online.count`; `invoice_ledger` `deliveries.toolbar.label`; `comparisons` `list.toolbar.label`.

- 0686447: Always pass the admin UI language to `formatDate(value, language)` and `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), taking it from `useTranslationContext()` or `useAppLanguage()` (`@endora-commerce/admin-kit/i18n`). **Upgrade note:** calling either without a language is now `@deprecated`. It still falls back to the browser's locale, but that fallback will be removed in a later release, so `formatDateTime(order.placedAt)` should become `formatDateTime(order.placedAt, language)` now. The kit's field-protection summary reads the language without requiring `AppLanguageContext`, so an integration zone rendered without it keeps working.

  Every admin date now goes through them, so a screen no longer mixes `17.11.2026`, `11/25/2026` and `Nov 22, 2026`: the lists, detail pages and panels of every module that called `formatDateTime` without a language, and the screens that called `toLocaleDateString` / `toLocaleString` directly (the CRM board card, the Projects stage bar and templates list, the Organization sales reps tab — which wrote every date in Polish — the blog post editor, comparisons, the dictionaries audit, display-mode overrides, the feed schedule's next run, the online-customers refresh time, the product list's update date, and the kit's comment thread, record history, field-protection summary and order reference). `endora new module` scaffolds its list's date the same way.

- 9eee781: The Admin UI in Polish no longer shows four kinds of text in English (issue #1809).

  - **Order statuses** are named in the admin's language on the Orders list, the order detail, the bulk status dialog and the Order statuses screen. The names were always stored per language; the screens read the English one.
  - **CMS hooks**: the 23 seeded hooks, such as "Search Page Bottom", are named and described in the admin's language until an operator renames them. A renamed or custom hook keeps the operator's text.
  - **Transactional e-mails**: each e-mail's name, description and the reason it cannot be switched off come from the sending module's bundle (`transactionalEmails.<code>.name`, `.description`, `.reason`), in the language the response is read in.
  - **Platform → Modules**: each module's name, description and the reason it cannot be switched off come from the module's own bundle (`module.name`, `module.description`, `module.nonDeactivatableReason`). `GET /api/v1/admin/modules` gains an optional `nonDeactivatableReason` field on each row. `auth`, `currencies`, `email` and `languages` now ship translation bundles.

  Each of these falls back to the English declared in code when a bundle has no entry. `endora new module` now writes `module.description` into the scaffolded bundles.

- 19eb7c0: `currencies` now creates its own `currencies` table in the new
  `Migration20261117T065542CurrenciesTable` (issue #611), and the package publishes a
  `./migrations` subpath. The migration creates the table, its two indexes, the `symbol_position`
  and `decimal_places` columns and their two checks. It inserts the `PLN` (default) and `EUR` rows
  only when it created the table itself. Until now `languages`'
  `Migration20260425T161557LanguagesCurrenciesInit` created the table and its rows, and
  `dictionaries`' `Migration20260506T112634DictionariesDictionaryInit` added the columns and checks.
  Both keep their class names and no longer name `currencies` in `up()` or `down()`. Every statement
  in the new migration is guarded, so a database that has already applied the old migrations does
  not change, and a currency an operator edited or deleted stays as it is.
  `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `languages` or `dictionaries` writing
  `currencies`.
- 72ea983: `dictionaries` now adds `countries_default_currency_fk` in the new
  `Migration20261117T065601DictionariesDefaultCurrencyFk` (issue #611). Until now
  `Migration20260506T112634DictionariesDictionaryInit` added it. `currencies` now creates its own
  table in a migration that runs after every older migration, so the old migration could no longer
  reference that table on a database migrated from empty. The old migration keeps its class name.
  The new one adds the foreign key only when it is missing, with the same definition, so a database
  that has already applied the old migration does not change.
- 61c2351: Shorter admin copy on two catalogue-area screens (UX audit text-to-cut, #1567):

  - **Dictionaries**: the page description is one short line ("Countries, currencies and languages your shop uses.").
  - **Product feeds › Settings**: the price-book hint now reads "Pick a book in force now, for everyone, in this channel and its currency." and fits the 80-character hint budget.

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

- b6fd6df: Creating a country, currency or language whose code exists, and making an inactive one the
  default, have error codes of their own instead of `VALIDATION_FAILED`, and a sentence in English and
  Polish (issue #643, part of #86). **A caller that matches on `VALIDATION_FAILED` for these refusals
  now sees the specific code.** The HTTP status is unchanged. Until now each was answered with an
  English sentence in every language, because the error envelope never replaces the message of
  `VALIDATION_FAILED`.

  | Route                                                                                                              | Was                                                                       | Is                                      | `details`                       |
  | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
  | `POST /api/v1/admin/dictionary/countries` (code exists)                                                            | `409 VALIDATION_FAILED`, _"Country XX already exists."_                   | `409 DICTIONARY_ENTRY_CODE_TAKEN`       | `code: "country"`, `entryCode`  |
  | `POST /api/v1/admin/dictionary/countries/:code/default` (inactive)                                                 | `409 VALIDATION_FAILED`, _"Cannot mark an inactive country as default."_  | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "country"`, `entryCode`  |
  | `POST /api/v1/admin/dictionary/currencies` (code exists)                                                           | `409 VALIDATION_FAILED`, _"Currency XXX already exists."_                 | `409 DICTIONARY_ENTRY_CODE_TAKEN`       | `code: "currency"`, `entryCode` |
  | `POST /api/v1/admin/dictionary/currencies/:code/default`, `POST /api/v1/admin/currencies/:code/default` (inactive) | `409 VALIDATION_FAILED`, _"Cannot mark an inactive currency as default."_ | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "currency"`, `entryCode` |
  | `POST /api/v1/admin/dictionary/languages` (code exists)                                                            | `409 VALIDATION_FAILED`, _"Language xx already exists."_                  | `409 DICTIONARY_ENTRY_CODE_TAKEN`       | `code: "language"`, `entryCode` |
  | `POST /api/v1/admin/dictionary/languages/:code/default`, `POST /api/v1/admin/languages/:code/default` (inactive)   | `409 VALIDATION_FAILED`, _"Cannot mark an inactive language as default."_ | `409 DICTIONARY_DEFAULT_ENTRY_INACTIVE` | `code: "language"`, `entryCode` |

  `details.code` is a token naming the dictionary, and each token has its own sentence. The entry's
  own code travels as `entryCode`, because the envelope reads `details.code` as the token. Both codes
  are members of `ERROR_CODES` in `@endora-commerce/contracts` and are declared once, by the
  `dictionaries` manifest, which owns the `DICTIONARY_*` family the three dictionaries share;
  `currencies` and `languages` raise them. The documentation pages of all three modules name them.
  The `decimalPlaces` range refusal of a currency update stays `VALIDATION_FAILED`. No setting,
  permission or migration changes.

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

- 28fc1c7: Dictionary admin replies are described by their contract (issue #599, section 6):

  - `@endora-commerce/contracts` publishes `dictionaryTranslationListResponseSchema` / `DictionaryTranslationListResponse` for `GET /api/v1/admin/dictionary/translations/:entryType/:entryCode`, and `dictionaryOrphanRowSchema` / `DictionaryOrphanRow` with `dictionaryOrphanReportResponseSchema` / `DictionaryOrphanReportResponse` for `GET /api/v1/admin/dictionary/audit/orphans`. No schema described either reply before.
  - `mod-dictionaries` builds every country, currency, language, language-country and translation reply as the contract's type (`Country`, `DictionaryCurrency`, `DictionaryLanguage`, `LanguageCountry`, `DictionaryTranslation`) instead of `Record<string, unknown>`, and each handler declares its reply type. The admin dictionary client and the orphan audit page use the contract types instead of hand-written interfaces. Nothing on the wire changes.

- ef656f9: `languages` now creates `languages.native_label`, `is_rtl`, `fallback_code` and the
  `languages_fallback_fk` self-reference itself, in the new
  `Migration20261114T003519LanguagesDictionaryColumns` (issue #611). Until now only
  `dictionaries`' `Migration20260506T112634DictionariesDictionaryInit` created them, although they
  belong to `languages`' `Language` entity. That migration keeps its class name and no longer alters
  `languages` in `up()` or `down()`. The new migration uses `if not exists` and a `pg_constraint`
  check with the same types, defaults and constraint name, so a database that has already applied
  the old migration does not change. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists
  `dictionaries` writing `languages`. The `currencies` columns the same `dictionaries` migration adds
  stay where they are: `currencies` does not create its own table yet.
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

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 4851e49: The seeded English labels of the Polish zloty and the Icelandic krona are spelled as ISO 4217
  spells them in English (`Polish zloty`, `Icelandic krona`). Only a fresh install sees the
  change — the reconciler never rewrites an existing currency row — and the Polish name
  (`Polski złoty`) is a translation row, unchanged.
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

- 248a9df: Routes a visitor reaches before signing in, or that arrive with no storefront channel, declare
  `salesChannelAccess: 'open'` and stay reachable when an operator closes a sales channel to
  anonymous visitors: administrator sign-in and sign-out, second-factor verification and set-up
  tickets and federated sign-in (both surfaces), `GET /api/v1/i18n/config`, the dictionary reads the
  registration form uses, the crawler policy, product-feed downloads by token, and the newsletter
  confirmation, unsubscribe and tracking links.
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

- 7af6470: The Dictionary's Languages tab lists every ISO 639-1 language, each with the countries that use it.

  - **183 languages are seeded, inactive.** `mod-dictionaries` ships a static catalogue — code,
    English name, native name, text direction and ISO 3166-1 country codes — and its boot reconciler
    inserts the rows that are missing, so an existing installation receives them on its first boot
    after the upgrade. No migration and no new dependency. `en-US` and `pl-PL` stay the only active
    languages: the storefront registry, `GET /api/v1/i18n/config`, the catalogue's translation chains
    and the product feeds read the _active_ set and are unchanged. An operator activates a language on
    its row to start using it.
  - **Seeding never overwrites.** A language row that exists is left exactly as it is — label, sort
    order and activation included. A seeded row that is deleted returns on the next boot; leave it
    inactive instead. A language is linked only to countries the dictionary holds, never as the
    country's primary language, and a country added later is linked on the next boot.
  - **`LanguageSeedPort` gains `ensureSeeded(rows: readonly LanguageSeedRow[]): Promise<number>`**,
    and `@endora-commerce/contracts` exports `LanguageSeedRow`. It inserts every row whose `code` is
    missing with `is_active = false` and returns how many it inserted. An implementation of the port
    outside `mod-languages` has to add the method; a caller of `backfillNativeLabels` changes nothing.
  - **Admin.** The Countries column shows country-code chips instead of a count; the list is searchable
    by country, filterable by status and paged; translation completeness is requested for active
    languages only, and the translations panel offers active languages only (the backend already
    refused a label in an inactive one). `GET /api/v1/admin/dictionary/languages` builds its answer in
    two statements instead of one per language.
  - **A code that used to be unknown is now inactive.** A write naming a catalogue language that has
    not been activated — `de` on a sales channel, say — answers `409 DICTIONARY_ENTRY_INACTIVE` where
    it answered `409 DICTIONARY_ENTRY_NOT_FOUND`.
  - `mod-orders`: the order-status screen asks the dictionary for its full page of languages, so an
    active language cannot fall outside the first hundred rows.

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
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
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

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

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

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

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

- ad62954: Fourteen more modules become workspace packages (feature 080, T040b batch three):
  `autopay`, `comparisons`, `credentials`, `dictionaries`, `google_tag_manager`,
  `ksef`, `meta_ads`, `paypal`, `payu`, `quick_order`, `search`, `stripe`, `taxes`
  and `tpay`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes — exactly as the twenty-nine
  packages before them.

  **For a consumer of `@endora-commerce/mod-ksef`, one export is new and
  load-bearing.** `KsefUnavailableError` is now published by name on `./backend`:

  ```ts
  import { KsefUnavailableError } from '@endora-commerce/mod-ksef/backend';
  ```

  Anything implementing `KsefApiClientPort` — an overlay's client, a test double,
  a second gateway — must throw **that** class for an outage.
  `classifySubmissionError` decides "retry" from `instanceof`, so a caller holding
  a constructor of its own, or the class from a relative import into this
  package's source, gets its outage classified as `UNEXPECTED`: the submission is
  parked for an operator instead of queued for the sweep, silently. There is no
  behaviour change for a caller that already throws the module's own class.

  Nothing else in any of the fourteen changed shape. The move is a relocation:
  same entities, same migrations, same class names, same tables. The committed
  migration registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base — 158 entries,
  `declaration=2db29d89…`, `execution=c794685f…` — because packaging changes no
  manifest `dependencies` and the order is a function of those.

### Patch Changes

- 4a0441b: `dictionaries` declares the eight error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

  Six of the eight are raised outside this package — `currencies` and `languages`
  own the rows this module is the screen over, and nine consumer modules re-raise
  `DICTIONARY_ENTRY_INACTIVE` from a caught `DictionaryReferenceError`. Ownership
  follows the domain noun and not the thrower, so the sentences stay here.

  No `tokens` are declared: none of the eight carries a refusal discriminator.
  `UNKNOWN_CURRENCY_CODE` and `UNKNOWN_LANGUAGE_CODE` are not here — they read
  like this module's and are `sales_channels`', which declares them.

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
