# @endora-commerce/mod-quick-order

## 0.112.0

### Patch Changes

- 988436f: Sales admin screens drop the page descriptions that repeated their title or addressed developers (issue #1436, UX audit 2026-11-17, DS-02). The Orders, Customers, Returns, Quote requests, Carts and Organizations lists, the order and quote-request create screens, Order statuses, Return statuses, Payment methods, Credit limits, the promotion editor, Promotion statistics, Order on behalf, New organization, Change tax ID and Convert to company no longer show a description. The payment and delivery method Integrations cards drop their one-line intro.

  Kept descriptions are now one line: Return delivery methods ("A return cost of 0 means the shop pays for the return."), Delivery methods ("Price changes don't affect orders already placed."), Promotion rules, Online customers and Customer groups ("A customer's own group overrides their organization's."). New organization says that members are invited from the organization's page beside its Save, as `create.hint.inviteMembers`.

  Translation keys removed from both `en` and `pl`: `core` `orders.page.description`, `orderCreate.description`, `orderStatusConfig.description`, `rfq.list.description`, `rfqCreate.description`, `organizations.page.description`, `returns.description`, `returns.statuses.description`, `legacyMethods.payment.description`, `legacyMethods.integrations.description`, `legacyMethods.integrations.shippingDescription`, `creditLimits.page.description`, `promotions.edit.description`, `promotionStats.description`, and the unused `rfq.detail.convert.description` and `rfq.detail.approveDescription`; customers `list.description`; carts `carts.page.description`; quick_order `onBehalf.page.description`; organizations `create.description`, `changeTaxId.page.description` and `convertToCompany.page.description`. A deployment that overrides one of these keys can drop the override.

- 932821f: Editor panels render as sections of the card they sit in, not as cards inside it (issue #1437, UX audit DS-03).

  New in `@endora-commerce/admin-kit/ui`: `EditorSection`, a heading (`h2` by default, `as` like `CardTitle`), an optional one-line `description`, an `action`, and a rule between consecutive sections. It has a `chrome` prop: `'section'` (the default) or `'card'` for a section that stands alone on a page. Also new: `EditorSectionChromeProvider`, `useEditorSectionChrome`, and the types `EditorSectionChrome`, `EditorSectionHeading`, `EditorSectionProps` and `EditorSectionChromeProviderProps`. `Section` now renders through `EditorSection` without the divider; it looks and reads as before.

  **Breaking visual change for modules (0.x, so released as a minor):**

  - `CustomFieldValuesPanel` no longer draws its own `Card`. It renders as a section of the host's card. A panel mounted on its own, between cards, must pass `chrome="card"` to keep its card: `<CustomFieldValuesPanel chrome="card" … />`. It also takes `titleAs` (`'h3'` inside a titled card).
  - `RecordHistory` and `CommentThread` list their entries as rows divided by a rule instead of a bordered box per entry. Both take `chrome="card"` to draw a titled card around themselves.
  - `<AdminZone>` takes `chrome`. A contribution built on `EditorSection` renders as a section by default, and as a card of its own under `<AdminZone … chrome="card" />`. Use that prop for a zone mounted at page level. A contribution that draws its own `Card` is unchanged.

  The CRM, Projects, Tasks, quote-request and quick-order panels contributed to the order, quote-request, opportunity, task, organization and customer screens are now built on `EditorSection`. Those screens mount their zones with `chrome="card"`, so the panels look as they did. The custom-field panels on the customer, organization, order-create, quote-request-create, opportunity-create, project-create and task screens keep their card. Project stages, template stages and project-create members are listed as divided rows.

- 998ac87: Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
- 9f37a4c: The settings and admin screens show an action's result beside the control that caused it. They no longer show it as a success banner at the top of the page (issue #1499, UX audit SALES-17; owner decision DEC-12 a). Each result is an `InlineStatus`, a polite status region that is mounted before it has any text, so screen readers announce it. Errors are still a page-level banner, and an error clears the result region.

  - Dictionaries (Languages, Currencies, Countries): "Made default", "Saved" and "Deleted" appear in the list toolbar, beside the add button.
  - E-mail branding, global search configuration, the ordering defaults panel (when it has its own Save) and the PWA screen: "Saved" appears beside Save. On the PWA screen, each action's result appears beside its own button: reset to global, icon upload, VAPID key generation, and push send. Changing the scope clears them.
  - Taxes, admin users and admin roles: the saved tax rule, the reset password and the deleted role appear beside the header's "New …" button.
  - Customer groups, payment methods and delivery methods: a save appears beside the form's title. On customer groups, a deletion is announced to screen readers only, because the deleted row is already gone from the list.
  - SEO: a regenerated sitemap appears in the sitemap card's header.
  - Webhooks: "Replay queued" appears in the deliveries card's toolbar.

- df16345: The Settings screen shows less on every row (UX audit SHELL-09, SHELL-23). A row no longer carries a value-type badge, a source badge or a "Default … · 0 per-channel overrides" footer: one muted line appears only when the value in force differs from the default or channels override it. A changed row is marked by a bar at its edge, a switched-off module's group states its read-only reason once, the "Editing for" channel picker sits in the toolbar beside the search, and the hard-coded "system" group badge is gone. Single-line controls sit to the right of the setting's name.

  A setting's description is now at most 120 characters (`check:text-budget`), with the long explanations left to each module's documentation page, and it never falls back to another language: in Polish the screen shows the Polish description or none. Every module that declares settings now ships `settingLabels.<code>.name` and `.description` in English and Polish, so the screen no longer shows English names in Polish. Where a manifest declared one of the shortened descriptions, its `description` is the same shorter sentence.

- bfc21d3: Shorter admin copy on the order, quote-request, organization, promotion, invoice and return screens (UX audit text-to-cut pass, issue #1567):

  - Removed lines that repeated what the screen already shows: the description on the invoices list, the line under the customer's price-negotiation override, the line above the default payment / delivery / address fields, and the description of the organization's Roles section.
  - Shortened to one line: the read-only note on price negotiation, the warehouse-precedence hint, the order-confirmation e-mails hint, the parent-organization hint, the empty sales-reps note, the sales-channel hints on order and quote-request creation, the saved-rule copy hint on promotions, and the pending-effects notice on an order.
  - Shortened notices: the "carrier not contacted" shipment notice and the "different refund method" warning on a return.

  Removed translation keys (EN and PL): `invoices.description`, `defaultPreferences.description` (core bundle), `negotiation.customer.description` (quote requests), `roles.tab.description` (organizations). A theme or overlay that overrode them can drop the override.

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

- 75027ef: On the organization detail screen, the ordering defaults panel is part of the page's one Save (issue #407, `specs/180-one-save-zone-editors/` WP-7). Its own _Save preferences_ button and its "Saved" line are not shown there. Each changed value counts as one change of the part "Ordering defaults" (`defaultPreferences.partLabel`, English and Polish), and the page's Save writes them through the same `PUT /api/v1/admin/quick-order/preferences`. The values are checked against the contracts request schema before anything is written. The customer detail's contribution forwards that screen's session in the same way, so the panel becomes part of the customer screen's one Save as soon as the screen passes a live session (#1241). Until then the screen passes the inert handle, and the panel keeps its own Save there.
- a851643: Issue #470 (D-288) — a default ordering preference's audit entry no longer names the tenant. The preference row is `@GlobalEntity`, but each one is about an Organization or a customer account, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §5).

  - `quick_order.default_preference.update` no longer records `scopeId` (the Organization's or the customer account's id) in `stateBefore` / `stateAfter`. It keeps `scope` and the ids of the chosen payment method, delivery method and addresses; `stateAfter` adds `changedFields`, the sorted names of the fields whose value changed. The entry is still recorded against the preference row (`objectId`).
  - `QUICK_ORDER_AUDIT_KEYS`, a constant in `src/backend/services/default-preference-audit-state.ts` (not on a published barrel), lists every top-level key the state may hold, held by a sentinel test.
  - No screen reads values back from the audit log, so no value store is added. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

  **Behaviour change on upgrade.** See _Default ordering preferences leave the Organization and the account out of the audit log_ in the upgrade guide.

- 75f89d2: One-click buy refused by the operator setting or the buyer's defaults has an error code of its own
  instead of `VALIDATION_FAILED`, and a sentence in English and Polish for each reason (issue #641,
  part of #86). **A caller that matches on `VALIDATION_FAILED` or on
  `details.code: "one_click_unavailable"` for this refusal now sees the specific code.** The HTTP
  status is unchanged. Until now it was answered with the English _"One-click buy is not
  available."_ in every language, because the error envelope never replaces the message of
  `VALIDATION_FAILED`.

  | Route                                                                                     | Was                                                                                               | Is                          | `details`                                                |
  | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
  | `POST /api/v1/quick-order/one-click` (setting off for the channel)                        | `422 VALIDATION_FAILED`, `details: { code: "one_click_unavailable", reason: "setting_disabled" }` | `422 ONE_CLICK_UNAVAILABLE` | `code: "setting_disabled"`, `reason: "setting_disabled"` |
  | `POST /api/v1/quick-order/one-click` (a default is missing or not offered in the channel) | `422 VALIDATION_FAILED`, `details: { code: "one_click_unavailable", reason: "missing_defaults" }` | `422 ONE_CLICK_UNAVAILABLE` | `code: "missing_defaults"`, `reason: "missing_defaults"` |

  `details.code` is now the eligibility reason, so each reason reads as its own sentence, and
  `details.reason` keeps the value a client may already branch on. `ONE_CLICK_UNAVAILABLE` is a
  member of `ERROR_CODES` in `@endora-commerce/contracts` and the `quick_order` manifest's first
  declared code, with the tokens `setting_disabled` and `missing_defaults`. The storefront's cart page
  names the new code and both reasons where the product page's one-click action lands. The module's
  documentation page names the code. No setting, permission or migration changes.

- 49b43de: **Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

  `AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.

- 42a9a4b: One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

  `mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

  **Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in _Upgrading an instance_ ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.

- 8ae3f58: **Behaviour change: a line quantity has an upper bound, refused with a new error code, `LINE_QUANTITY_EXCEEDED`; and the quote request and return line arrays have a line-count bound** (issue #351). A quantity past the integer column it is stored in used to pass validation and answer `500`; it is now refused, in the reader's language.

  New in `@endora-commerce/contracts`: `LINE_QUANTITY_MAX` (`1 000 000`, the same value as `ORDER_MINIMUM_MAX`, so the largest minimum stays orderable), `lineQuantitySchema` (a whole number in 1…`LINE_QUANTITY_MAX`), `boundedLineQuantity(schema)`, `isLineQuantityExceededIssue(issue)`, `LINE_QUANTITY_EXCEEDED` (also in `ERROR_CODES`) and `REQUEST_LINE_ITEMS_MAX` (`200`). `ADMIN_ORDER_MAX_ITEMS` and `QUICK_ORDER_BUILD_MAX_ITEMS` are now that constant under their own names; their value does not change.

  **The new code.** Every request schema carrying a line quantity uses `lineQuantitySchema`: `addCartItemRequestSchema`, `updateCartItemRequestStrictSchema`, `createQuoteRequestSchema` / `patchQuoteRequestSchema` lines, `adminCreateQuoteRequestSchema` / `adminPatchQuoteRequestSchema` lines, `adminCreateOrderRequestSchema` / `adminOrderPreviewRequestSchema` items, `apiPlaceOrderRequestSchema` lines, `quickOrderBuildRequestSchema` items, `quickOrderOneClickRequestSchema`, `addShoppingListItemRequestSchema`, `updateShoppingListItemRequestSchema`, `createReturnCaseRequestSchema` lines, `catalogBulkPriceRequestSchema` lines, `cartSnapshotSchema` lines, and the packaging unit's `baseQuantity` in `createPackagingUnitRequestSchema` / `updatePackagingUnitRequestSchema`. A quantity past the bound is a Zod issue tagged `LINE_QUANTITY_EXCEEDED`. The error envelope in `@endora-commerce/platform` answers a request whose only failures are that issue with `400 LINE_QUANTITY_EXCEEDED` and a translated sentence (`@endora-commerce/mod-i18n` ships it in English and Polish), with `details` naming the field. A request that fails anything else as well stays `400 VALIDATION_FAILED`, with the issue among its details. `POST /api/v1/external/orders` and `POST /api/v1/external/catalog/prices` parse their bodies themselves and keep answering `422 VALIDATION_FAILED`; the detail's `issue` there is `LINE_QUANTITY_EXCEEDED`.

  `@endora-commerce/mod-carts`: two cases are refused with `422 LINE_QUANTITY_EXCEEDED`, `details: { quantity, maximum }`, and write nothing: an add onto an existing basket line whose sum would pass the bound, and a packaging-unit add whose pieces (`baseQuantity × units`) would pass it. This covers the single and batch add, reorder and shopping list to cart. Signing in sums the anonymous basket into the customer's and keeps a summed line at the bound instead of failing the sign-in. `updateCartItemRequestSchema` (the line edit) now accepts any quantity from `0` (remove) to the bound; it stopped at `999`.

  **Line counts.** The line arrays of `adminCreateQuoteRequestSchema`, `adminPatchQuoteRequestSchema` and `createReturnCaseRequestSchema` are bounded at `REQUEST_LINE_ITEMS_MAX`, as the customer's quote request create and edit already were: one line more is `400 VALIDATION_FAILED`. The value is shared but the refusal is not. The order intakes (admin create and preview, `POST /api/v1/external/orders`) and the quick-order build keep refusing more than 200 items with `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, and the basket's own cap stays `422 CART_LINE_CAP_EXCEEDED`.

  `@endora-commerce/admin-kit`: `parsePositiveInt` returns `null` past `LINE_QUANTITY_MAX`, so the admin order and quote request create screens mark such a line invalid before sending it. `@endora-commerce/mod-quick-order`: an imported row past the bound, and every row of a duplicate whose sum passes it, is rejected as `quantity_invalid` instead of being recognised into a build that would be refused. `@endora-commerce/mod-quote-requests`: the Modify tab's quantity input carries the bound as its `max`.

### Patch Changes

- 0233568: **The quick-order type-ahead and the buyer's build to a quote request read `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #1011). `GET /api/v1/quick-order/search` and `POST /api/v1/quick-order/build` with target `quote_request` took the header's first tag alone as the language a product's availability is judged in, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` asked about English and `de-DE, pl;q=0.5` about the channel default: a product available only in Polish was not found by the type-ahead, and a build naming it was refused with `404`. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. The type-ahead's hit names follow the same language. A request without the header behaves as before.
- ed57923: Published tarballs no longer carry source maps (issue #107). Every package publishes `dist` and
  not `src`, so each `.js.map` and `.d.ts.map` pointed at source files no consumer had; they were
  about a third of a tarball's unpacked size. Each package's `files` list now ends with
  `"!dist/**/*.map"`: `@endora-commerce/mod-quick-order` packs 69 files instead of 131 (243.6 kB
  unpacked instead of 359.9 kB), and `@endora-commerce/test-kit` packs 25 instead of 47. The
  compiled JavaScript, the type declarations and every other shipped file are unchanged, and so is
  every export. A stack trace from an installed package now names the compiled `dist` file rather
  than a source path that does not exist in the install.
- a859fae: **Every storefront route that fills the basket in a batch judges its lines in the request's language** (issue #1293). `POST /api/v1/quick-order/build` with target `cart`, `POST /api/v1/shopping-lists/:id/convert-to-cart`, `POST /api/v1/cart/from-shopping-list/:id` and `POST /api/v1/cart/from-quote-request/:id` reached the basket's batch add without the request's language, so every line was asked about at the sales channel's default language whatever the buyer browsed in: a product switched off in the default language but on in the buyer's was refused (`404` from quick order) or skipped (`product_not_found` / `not_purchasable` from the conversions). They now pass the channel language `Accept-Language` asks for, resolved through `requestScopeLanguage` as `POST /api/v1/cart/items` does since #1011, through `CartWritePort.addItems`' new `languageTag`; `mod-carts` honours it on the port and on its own conversion routes. A request without the header behaves as before.
- 8e7f794: **One-click buy judges its product in the request's language** (issue #1308). `POST /api/v1/quick-order/one-click` wrote its line into the working basket and placed the order without the request's scope language, so the product was asked about at the sales channel's default language whatever the buyer browsed in: a product switched off in the default language but on in the buyer's was refused with `404 PRODUCT_NOT_FOUND`. The route now passes the channel language `Accept-Language` asks for, resolved through `requestScopeLanguage` as `POST /api/v1/cart/items` does since #1011, to `CartWritePort.addItems` and `OrderPlacementPort.placeOrder` through their new `languageTag`; `mod-carts` honours it on the port, and `mod-orders` judges the working basket and names the order's lines in it. A request without the header behaves as before.
- 3870af9: **Every member of an Organization may read that Organization's default ordering preferences** (issue #359). `GET /api/v1/quick-order/preferences?scope=organization&scopeId=<own organization id>` used to answer `403 FORBIDDEN` to anyone but the Organization's _Administrator_, so a storefront could not say what a buyer's "use the organization default" stood for. It now answers `200` with the stored row (or `null`) for the caller's own Organization; another Organization's row is still refused. Writing the organization scope is unchanged and stays reserved to the _Administrator_. The rule is `canReadPreference` beside `canManagePreference` in the module's `default-preference-authz` service.
- 4d0a26d: Documentation only (issue #407). The shipped `docs/` pages, in English and Polish, now describe the one Save on every editor with zone panels. Each page says what Save covers, what is checked before anything is written, the order the parts are written in, what a partial save reports and that the next Save writes only the part that failed. It also says how the leave guard works and which sections carry the "Applies immediately" badge.

  - catalog: "Editing a product at a scope" covers the base prices and the Inventory tab's product settings under Save, plus the actions that apply immediately. A new "Editing a category" section on the module page covers the category editor's Save.
  - price_lists: the display-mode override saves with the organization and category editors. The base-price panel's **Discard changes** is described.
  - organizations, customers: a section on each screen's one Save and its immediate actions.
  - quick_order, quote_requests: their panels save with the host screen's Save.
  - sales_channels: the edit page's Save and its count. Deactivate and Re-activate keep unsaved edits, and warehouse routing applies immediately.

  No code, API or string changes.

- 4efb051: The module page states a sales representative's reach on the admin preference routes and the request-language rule for search, build and one-click buy. Documentation only.
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

### Minor Changes

- 86e8761: One-click purchase and quick order by organization permission (`specs/170-organization-roles/`, WP-06; part of issue #653).

  - Declares the organization permission `quick_order.one_click` (_One-click purchase_, member-default).
  - `GET /api/v1/quick-order/one-click/eligibility` answers `permission_required` when the member's role lacks `quick_order.one_click`, and `cart_approval_required` when it holds it but lacks `carts.order_without_approval`, before the setting and the defaults. `POST /api/v1/quick-order/one-click` is refused `403 ORGANIZATION_PERMISSION_REQUIRED` naming the first missing of the two, before any basket is written — one-click no longer bypasses cart approval.
  - `POST /api/v1/quick-order/import` needs `carts.create`; `POST /api/v1/quick-order/build` needs `carts.create` for target `cart` and `quote_requests.create` for target `quote_request`. The admin on-behalf build stays gated by `orders:write` only.
  - Organization-scope defaults, and other members' defaults, are managed by a member holding the _Administrator_ role (`403 FORBIDDEN` otherwise), no longer by the legacy account role.

- 9bfb0b8: The legacy two-value organization role is removed (`specs/170-organization-roles/`, WP-12). Breaking for every consumer that still names it. A member holds a role **id**, and what they may do follows from that role's permissions. Old → new:

  - `organizationRoleSchema` and `OrganizationRole` (`'organization_admin' | 'regular_user'`, from `common.ts`) are removed. Use `OrganizationRoleRef` (`{ id, name, kind }`) and `OrganizationRoleKind` (`administrator`, `member`, `custom`) instead.
  - `CustomerAccountRole` is removed, and so are `CustomerAccountRecord.role` and `CustomerAccountCreateInput.role`. Read and write `organizationRoleId` instead; it is required on create.
  - `CustomerAccountReadPort.countByOrganizationRole(organizationId, role, options)` is removed. Use `countAdministrators(organizationId, options)`, which takes the same options. `listByOrganization` still answers the Organization's _Administrator_ holders first, then by creation date.
  - `CustomerRolePort.changeRole(organizationId, customerAccountId, newRole)` is removed. Use `customerAccountRoleCommandPort.changeRole({ organizationId, customerAccountId, roleId })`, the `customer_account.change_role` Command. `customerRolePort` keeps `listMembers` and `removeMember`.
  - `RfqCustomerContext.isOrgAdmin` is removed. Ask `OrganizationPermissionPort.isAdministrator(subject)` instead (research R-30). `carts`, `orders`, `quick_order` and `shopping_lists` no longer pass it.
  - `OrganizationRecord.requiresCartApproval`, `OrganizationCartApprovalWritePort` (the container name `organizationCartApprovalWritePort` is no longer registered), `CartApprovalPolicyWriteResult`, `setCartApprovalPolicySchema` / `SetCartApprovalPolicy` and `cartApprovalPolicyResponseSchema` / `CartApprovalPolicyResponse` are removed, together with the `organization.set_cart_approval_policy` Command. Approval now follows the member's `carts.order_without_approval` permission (OR-3), and the policy endpoints were already removed.
  - On responses, `role` is no longer described on `customerAccountSchema`, `customerLoginResponseSchema`'s `customerAccount` or `impersonationStartResponseSchema`'s `impersonatedCustomerAccount`. `organizationRole` is now **required** on all three, and `permissions` is required on the first two: every producer sends them. `POST /api/v1/admin/organizations/:id/impersonate` (`admin_users`) no longer sends `role` and now sends `organizationRole`, read through `organizationRoleReadPort` (an acknowledged dependency on `organizations`); `POST /api/v1/admin/customers/:id/impersonate` (`customers`) always sends it.
  - The request schemas `inviteMemberRequestSchema` (`{ email, role? }`), `changeMemberRoleRequestSchema` (`{ role }`), `adminDirectMemberRequestSchema` (`role?`) and `adminPatchMemberRoleRequestSchema` (`{ role, expectedUpdatedAt? }`) are removed. Use `inviteMemberToRoleRequestSchema`, `assignMemberRoleRequestSchema`, `adminDirectMemberToRoleRequestSchema` and `adminAssignMemberRoleRequestSchema`, which take `roleId`. They stay strict, so a body that still sends `role` is refused with `400`.
  - The customers CSV export (`import_export`) carries `organization_role_name` (a predefined role's English label, or a custom role's name) and `organization_role_kind` (`administrator`, `member`, `custom`) in place of its `role` column. It reads them through `organizationRoleReadPort`, a new non-binding `degrades-without` edge on `organizations`. The export is export-only, so no import is affected.
  - `carts`' published bundles (`i18n/en.json`, `i18n/pl.json`) drop five unread keys that described the removed policy and the administrator-only approval: `approval.banner.pending`, `approval.banner.rejected`, `approval.banner.policy_on`, `approval.banner.policy_off` and `reject.email.body`.
  - The `CustomerAccount` entity loses `role`. `Organization` loses `requiresCartApproval`, and `OrganizationInvitation` loses `role`, so its `organizationRoleId` is now required. Nothing writes the legacy value any more.
  - New migrations `Migration20261104T094535OrganizationsDropLegacyRoleColumns` (M4) and `Migration20261104T094540CustomerAccountsDropLegacyRoleColumn` (M5):
    - M4 drops `organizations.requires_cart_approval`, `organization_invitations.role` and the invitation default trigger that read it.
    - M5 drops `customer_accounts.role` with its index.
    - M5 also redefines the account default: an account inserted without a role holds _Administrator_ in a personal Organization, else _Member_.
    - Each `down()` re-derives the dropped values from the role reference.

- a8bd4b8: The buyer's quick-order import admits either target's permission (`specs/170-organization-roles/`, owner ruling OR-10, FR-030b). `POST /api/v1/quick-order/import` used to require `carts.create`; it now serves a member holding `carts.create` **or** `quote_requests.create`, judged after `requireCustomer` and before the file is parsed. A member holding neither is still refused `403 ORGANIZATION_PERMISSION_REQUIRED` with `details.permission = 'carts.create'`, malformed file included, and a code whose module is switched off grants nothing. `POST /api/v1/quick-order/build` is unchanged: a cart still needs `carts.create`, a quote request `quote_requests.create`. No member loses access on upgrade, because _Member_ holds both codes.
- 717e4c6: The buyer's quick-order preview is kept by the module (issue #809): `GET`, `PUT` and `DELETE /api/v1/quick-order/preview`. There is one preview per buyer session, in Redis, under a key made of the buyer's Organization, the buyer and a digest of the session. Another session or another Organization reads nothing, and no preview id is ever sent. `GET` answers `{ data: preview | null }` and is never cached. `PUT` replaces the preview and starts its one-hour TTL; a read does not extend it. It needs `carts.create` or `quote_requests.create`, like the import. Its line cap is the effective `quick_order.import_max_rows`, read on each write, and counts only the rows the import read: rows past the import's limit (`row_limit_exceeded`) are kept as one `summary.overflowCount`, with `summary.rowLimit`. A write that grows a preview past the cap is refused with `422 VALIDATION_FAILED` (`details: { code: 'too_many_lines', maximum }`, `maximum` being the setting); a write that adds no line is accepted even above a cap lowered since. A body over 2 MiB is refused with `413`. `DELETE` answers `204`. All three need a signed-in buyer and answer `503 MODULE_DISABLED` while the module is off; stored previews are kept. The module now resolves the platform's `redis` client, so `ioredis` (`^5`) is a new peer dependency, already present in every application that composes the platform.

### Patch Changes

- 3f020ba: Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
- b2db8c3: English module names and admin sidebar labels are now sentence case, like the rest of the UI. The manifest `name` changes for 22 modules and for the platform's `_lifecycle` module ("Quote Requests" becomes "Quote requests", "API Keys" becomes "API keys", "Module Lifecycle" becomes "Module lifecycle"). The English `module.name` for Quick order, Quote requests and Shopping lists changes the same way. That string heads their permission groups on the organization role form and appears on the modules screen. The admin sidebar labels in blog ("Blog posts", "Blog categories", "Blog tags"), cms ("CMS pages", "CMS blocks", "CMS templates", "CMS hooks"), custom_fields ("Custom fields"), import_export ("Import / export"), newsletter ("Tags & fields") and transactional_emails ("Transactional emails", "Email blocks", "Email templates") change the same way. Product names (Google Analytics, Google Tag Manager, LinkedIn Ads, Meta Ads) keep their capitals. Polish strings do not change. If your code compares a manifest `name` against the old title-case string, update the comparison. Better, compare the module `id`.
- da994d4: A default ordering address must now be one of the target organization's own, live addresses (`addresses`). `PUT /api/v1/quick-order/preferences` and `PUT /api/v1/admin/quick-order/preferences` refuse any other address — the buyer's personal-book (`customers`) address, or another organization's — with `403 ADDRESS_NOT_OWNED`, the code `orders` uses, instead of failing on the preference table's foreign key with a 500 (issue #769). The resolved defaults likewise accept organization-book addresses only, so the module no longer reads `customerAddressReadPort`: the `customers` non-binding dependency and the exported `customerAddressesOrAbsent` helper are removed.
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

- 07f3764: Minimum order quantity and "returnable" per sales channel (product data scopes, FR-100).

  - **Behaviour change:** a product's channel override of its minimum order quantity or its returnable flag (`product_channel_scopes`, written through `PATCH /api/v1/admin/catalog/products/:id/scopes`) now applies in that channel. Adding to the basket (single, batch and quick-order build), the basket view, submitting a basket for approval, the checkout preview, placement, the admin order preview, quote requests (create, draft edit, resubmit, the operator's per-line warning) and the buyer's quick-order import judge the minimum of the basket's, order's or request's channel; a channel minimum of 1 means no minimum there. Placement stamps `order_items.returnable_at_purchase` from the order channel's flag, so returns follow it. Without an override nothing changes.
  - **Storefront read model:** `minOrderQuantity` on the product detail and listing summaries is the request channel's value.
  - **Contracts:** new `withChannelOrderRules(records, rules)` puts the rules of `catalogProductAvailabilityPort.effectiveOrderRules` into a set of product records for one seam; `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning the global values.

- dd6deb2: "Archived" is read from the product's archived time, never from its status (the catalogue's status is now `active` | `inactive` and `inactive` no longer archives).

  - **Product import:** a `status` of `draft` or `archived` is refused per record with `invalid status: <value>`; `inactive` switches the product off without archiving it.
  - **Quick-order import:** `product_archived` is reported for an archived product whatever its status. A product merely switched off is not `product_archived`; for a buyer it is the channel's `product_not_found`.
  - **Shopping-list conversion:** an archived product is skipped as `product_archived` whatever its status; a product switched off is the availability answer's `product_not_found`.
  - **Reorder:** an archived product is reported `discontinued` and left out; a product merely switched off is seeded and left to the basket and to placement to refuse.

- 2c6d505: The type-ahead (`GET /api/v1/quick-order/search`) passes the request's `Accept-Language` pick to `catalogQuickSearchPort`, so a product switched off in that language of the sales channel is not offered.

  A pasted SKU list (`POST /api/v1/quick-order/import`) recognises only products available in the request's channel (at its default language); any other is rejected as `product_not_found`, the unknown SKU's reason. The operator's `POST /api/v1/admin/quick-order/import` is unchanged.

- df0a90e: A buyer's quote line is judged at the request's scope language, as a basket line is. `CreateForCustomerOptions` gains `languageTag` — the request's first `Accept-Language` tag, resolved against the channel's own languages — and `RfqService.createForCustomer`, `patchDraft` and `resubmit` ask `catalogProductAvailabilityPort` and snapshot line and unit names at it; absent, at the channel's default language. `language` is now a message language only: it used to decide the scope too, so a buyer asking in a language the message bundles do not carry (`de-DE` answered in Polish) was quoted a product switched off in that language. The customer quote routes, the basket's conversion to a quote request (`CartConversionService.convertToQuoteRequest`'s options gain `languageTag`) and the buyer's quick-order build to a quote request (`QuickOrderBuildOptions.languageTag`) pass the tag.
- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- b7baf8a: Admin order creation, one-click buy and the external order intake no longer empty and close the
  customer's active basket (issue #169). They place the order from a separate **working basket**
  written from the request's lines, through the same `placeOrder`; the customer's basket — one
  filled from an accepted quote request included — is left exactly as it was, whether the order is
  placed or refused.

  - **`@endora-commerce/contracts`** — `CartWritePort.addItems`' option `replaceExisting` is
    replaced by `workingBasket`. Old: `addItems(actor, lines, { onLineError: 'throw', replaceExisting: true })`
    emptied the active basket and wrote the lines into it. New:
    `addItems(actor, lines, { onLineError: 'throw', workingBasket: true })` writes them into a new
    cart in status `working` and returns it; the active basket is not touched. Pass the returned
    `cart.id` as `OrderPlacementPort.placeOrder`'s new option `workingBasketId` to place from it.
    `cartStatusSchema` gains `'working'`.
  - **`@endora-commerce/mod-carts`** — migration `cart_status_working` widens `carts_status_check`
    to `working`. `CartPlacementApplyPort` gains `readWorkingForPlacement(em, ctx & { cartId })` and
    `discardWorkingBasket({ cartId, customerAccountId })`; an implementation of the port has to
    provide both. A working basket ends `completed` with `completed_order_id` set, or is deleted
    when the placement is refused; it is never listed (admin carts list, organization carts list,
    the customer's carts panel) and never swept.
  - **`@endora-commerce/mod-orders`** — `OrderService.placeOrder` accepts `workingBasketId`; admin
    order creation and the external intake place from a working basket.
  - **`@endora-commerce/mod-quick-order`** — one-click buy places from a working basket.

- c73366c: The command-palette actions of `credentials`, `orders`, `organizations`, `quick_order` and `returns` keep only English `keywords` in their manifests; their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #560). A Polish operator finds the same screens by the same words. The template-variable samples `order.shippingAddressText` (`order_confirmation`) and `statusLabel` (`new_org_registration`) are English in the manifest and carry their Polish form under a `sampleValueKey`.
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

### Minor Changes

- 0bd5a2b: Quick order applies minimum order quantities to the file, bounds builds to 200 lines and caps imports at 10 000 rows.

  - **Behaviour change for API clients — import preview.** Each product's pieces minimum is judged on its total across the whole file (duplicate rows merged, variants summed), never with the cart. On the buyer's import every row of such a product is rejected with `below_minimum`, `minimum` and `productTotal`; on the operator's import (`/api/v1/admin/quick-order/import`) the row stays recognized with `warning: { reason: 'below_minimum', minimum, productTotal }` and the summary counts it in `warningCount`. The on-behalf screen badges the row.
  - **Behaviour change for API clients — build bound.** **Builds of more than 200 lines are refused, including to a quote request**: `POST /api/v1/quick-order/build` and its admin twin answer `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, before anything else.
  - **Build to a cart is a partial success:** lines that meet their minimums are added and the others come back in `rejected[]` (`reason: 'below_minimum'`, `kind`, `minimum`, `packagingUnitName`). A hidden or unpublished product fails the build as unknown before anything is added. A build to a quote request is refused below a minimum for a buyer and flagged for an operator.
  - **One-click buy** orders a product's minimum order quantity instead of 1. **A one-click refused for its line (below a minimum, no price, unknown product) now leaves the buyer's basket as it was**; it used to empty it. The basket is replaced only once the line passes, through `CartWritePort.addItems` with `replaceExisting`; a refusal at placement still leaves it holding the one-click line.
  - Refusals name products in the language the response is answered in (q-sorted `Accept-Language`, else the channel default; an operator's stored preference on the admin build), on build, build to a quote request and one-click buy.
  - `quick_order.import_max_rows` is clamped to 1–10 000 whatever its stored value.

### Patch Changes

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

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

- 34f97ae: Callers of the cart ports name the basket's sales channel (`specs/154-sales-channel-access/`):
  quick-order builds and one-click buy fill the basket of the request's channel (one-click now
  always places on that channel), converting an approved quote request seeds the basket of the
  request's channel (`RfqService.convertToOrder` takes the channel), and converting a shopping list
  fills the basket of the request's channel (`ShoppingListService.convertToCart` takes the channel
  as its fourth argument).
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

- 9b2a43e: Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
  zone a tab strip.

  `@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
  `OrderEntryTabsZoneProps`, which is empty: the contributions _are_ the tabs, so the mount has
  no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
  `<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
  an `<AdminZone>` mount is.

  `@endora-commerce/admin-kit` gains two exports:
  - `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
    and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
    per-contributor error boundary and the `weight` ordering are unchanged. **It renders
    nothing at all when fewer than two contributions survive presence and permission**: one tab
    is not a choice. The floor is a constant rather than a prop, deliberately — two is a
    property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
    refuses.
  - `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
    own selected state, because in a contributed strip no component sees the whole set. That
    costs `RouteTabs`' _longest-wins_ tie-break: two contributed tabs whose paths are prefixes
    of one another would both read as selected. `RouteTabs` itself is unchanged and is still
    the primitive to use whenever one component knows every tab.

  `@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
  _Standard order_ tab at weight 100. `@endora-commerce/mod-quick-order` gains the _Quick
  order_ tab at weight 200. Both are gated on `orders:write`, which is the code their routes
  enforce. Each label now ships in its own module's bundle
  (`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

  **If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
  both module ids and both routes and belonged to neither module; mount the zone instead:

  ```diff
  -import { OrderEntryTabs } from '@/components/OrderEntryTabs';
  -<OrderEntryTabs />
  +import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
  +<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
  ```

- 184fa9f: Two detail-screen zone members, four contributors, and the end of two live component
  duplications.

  `@endora-commerce/contracts` adds two members to `AdminZoneNameSchema`, each with its entry
  in `AdminZonePropsMap`:

  | Member                      | Props                                            | Rendered by                                         |
  | --------------------------- | ------------------------------------------------ | --------------------------------------------------- |
  | `organization.detail.after` | `OrganizationDetailZoneProps { organizationId }` | the end of the organization detail screen, **once** |
  | `customer.detail.after`     | `CustomerDetailZoneProps { customerId }`         | the end of the customer detail screen, **once**     |

  `OrganizationDetailZoneProps` and `CustomerDetailZoneProps` are new exported interfaces. The
  second is not an alias of the first: the prop is named for the entity the mount carries, and
  the two members are two places.

  **One mount per screen is a rule, not a layout choice.** Neither member carries a prop that
  could tell two mounts apart, so a second mount of either renders every contribution twice
  and nothing in the renderer can distinguish them.

  `@endora-commerce/mod-quick-order` gains an `./admin` subpath — its first — with two zone
  contributions and `DefaultPreferencesPanel`, which moves into the package. The panel's two
  preference calls are rebuilt from the published `apiClient`; `quick-order-client.ts` stays in
  the admin application, where the on-behalf-of screen still uses it.

  ```tsx
  // Both contributions declare `orders:write`, which is the code every admin
  // route this module owns enforces. There is no `quick_order:*` permission.
  zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
    weight: 300,
    requiredPermission: 'orders:write',
  });
  ```

  `@endora-commerce/mod-carts` gains its first zone contribution and a new route,
  `GET /api/v1/admin/organizations/:id/cart-approval-policy`, gated on `customers:manage` and
  answering `cartApprovalPolicyResponseSchema` — the same code and the same shape as the
  `PATCH` that has been there since feature 027. `CartApprovalService` gains `getPolicyByAdmin`.
  The contribution reads its own initial state through that route instead of taking the
  `initialRequiresCartApproval` prop the old panel took, because a zone's props cannot carry a
  value only one of four contributors wants.

  That panel had been imported by nothing, and the copy it rendered was in no bundle under any
  spelling — `t('carts.policy.title')` under the `carts` namespace resolves to
  `bundle['carts']['carts.policy.title']`, which never existed. Ten `policy.*` keys are added to
  this package's own bundle in both shipped languages, and the capability reaches an operator
  for the first time.

  `@endora-commerce/mod-price-lists` and `@endora-commerce/mod-sales-channels` each gain a
  second contribution over a component they already ship, and each loses its duplicate:
  `DisplayModeOverrideRow` and `EntityChannelMembership` existed twice in the tree for the
  length of the previous release, because the organization detail screen still imported the
  `admin/src` copy. Both copies are gone and nothing imports them.

  **Operator-visible copy change.** The organization detail's pricing card is now
  `price_lists`' own: the screen used to pass `organizations.detail.pricingLabel` and
  `organizations.detail.pricingHint` into a control it does not own and wrap it in a card
  titled `organizations.detail.pricingCard`. A host cannot hand copy to a contributor it does
  not know, so the control renders `priceLists.displayMode.rowLabel` and its own hint, and all
  three host keys are removed from the `core` bundle in both languages. Two further `core` keys
  go with them — `priceLists.linked.displayModeLabel` and `priceLists.linked.displayModeHint`,
  which the previous release left unread.

  No contribution declares a `match`, and each says why in its own file: `match` narrows the
  mounts of one place, and each of these members has one host and one mount. Every zone test
  asserts it absent.

### Patch Changes

- 6f5687c: These four packages now declare a `test` script and ship a `vitest.config.ts`, so the unit
  tests they already carried beside their sources are collected and run.

  They were not. `specs/deferred-defects.md`'s _"Co-located tests inside a module package run
  nowhere"_ is the entry this closes: no vitest configuration included `packages/**` and no
  module package declared a test command, so fifteen files across these four packages were
  collected by no run, reported by no job and counted in no total. They were not failing —
  as far as the pipeline was concerned they did not exist, which in review reads as coverage.
  All fifteen pass on first collection: 103 tests, and the CI job that will now run them,
  `test:frontend`, goes from 229 files / 1240 tests to 244 / 1343.

  **If you consume one of these packages**, nothing you import changes: `files` still ships
  `dist` and `i18n`, `tsconfig.build.json` still roots the emit at `src/`, and the test files
  and the configuration are in neither. The only difference is that `pnpm test` inside the
  package now does something.

  **If you write a module package**, two rules now hold and are enforced rather than
  documented:
  - The generated `test` script is a bare `vitest run` — never `--passWithNoTests`. Measured
    on vitest 2.1.9 over a package with no test file, bare `run` exits 1 with _"No test files
    found"_ and the flag turns that into 0. A package that declares a runner and collects
    nothing must fail, or the repair reproduces the defect it fixes.
  - `manifests:generate` and `manifests:check` **refuse** a package that holds a test file and
    declares no `vitest.config.ts`, naming the file. That is what stops the gap reopening
    silently for the next package.

  A package's `vitest.config.ts` must `mergeConfig` the repository root's
  `vitest.config.base.ts`: that is where issue #255's foreign-workspace-link refusal lives,
  and a configuration that skips it can execute another checkout's sources while reporting on
  this branch.

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

- 764b379: **`customerFilterCond`'s `allowed-set` arm stops returning `{}`, and the function takes an
  argument.**

  `customerFilterCond()` is now `customerFilterCond(organizationColumn: CustomerOrganizationColumn)`,
  where `CustomerOrganizationColumn` is `'present' | 'absent'` — both exported from
  `@endora-commerce/platform/tenancy`'s `filters` module. Any direct caller must pass one:

  ```ts
  // before
  const where = customerFilterCond();
  // after — `'present'` iff the entity you are filtering carries `organizationId`
  const where = customerFilterCond('absent');
  ```

  `@CustomerScoped()` itself is source-compatible and takes no new argument. It derives the answer
  per query from the ORM's discovered metadata, so an entity that gains an `organizationId` column
  starts being filtered on it with no further change.

  **The behaviour change is confined to the `allowed-set` mode** — the mode a scoped
  (assignment-limited) administrator resolves to. It previously contributed **no predicate at all**
  to any `@CustomerScoped` entity, so such an entity behaved as if it were `@GlobalEntity` for that
  actor. It now contributes `{ organizationId: { $in: allowed } }` when the entity carries the
  column, and a predicate that matches nothing when it does not. `all`, `system` and `single-org`
  are unchanged, and a buyer resolves `single-org`.

  A surface that has already established the caller's authority by other means and reads a
  `@CustomerScoped` entity with no organization column will now read nothing under a scoped
  administrator. Cross that deliberately with `withSystemScope(reason, fn)` after the check that
  establishes the authority; do not catch.

  `@endora-commerce/mod-quick-order`'s `registerQuickOrderAdminRoutes` takes a new required dep,
  `customerAccounts: CustomerAccountReadPort`. It is the tenant boundary of the admin build route:
  `onBehalfOf` names the customer account and organization the built Cart or Quote Request is
  written to, and it arrives in the request body, where no read filter can reach it.

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
