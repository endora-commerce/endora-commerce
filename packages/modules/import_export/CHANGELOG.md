# @endora-commerce/mod-import-export

## 0.110.0

### Minor Changes

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

- 3f020ba: **Breaking — the products CSV addresses scopes by column, and the old per-language headers refuse the whole file (feature 174).**

  - Headers are `<field>`, `<field>@<channel code>` and `<field>@<channel code>/<language>`; cells use the write encoding: an empty cell is no change, `NULL` (whole cell) is deliberately empty, `INHERIT` removes the own value, and `\NULL` / `\INHERIT` are the literal words. Export writes the tokens; the formula guard `'` is added on export and stripped on import, on select, enum and multiselect cells too.
  - **A file with a 163 per-language header such as `name_en` or `description_pl` is refused as a whole.** Rename each to the scope it should write — `name_en` becomes `name@<channel>/en-US`, or `name` for the Global value — before importing.
  - **Import profiles** (`/api/v1/admin/import-export/profiles`, `catalog:write`) map a source file's locales and channels to scopes; `GET /api/v1/admin/import-export/channel-targets` lists the channels a mapping may target.
  - The import report is capped and carries `truncated: { errors, fieldErrors }`; the 10 MiB body limit applies to `POST /api/v1/admin/import/products` only.
  - The report's `imported` counts a row only when at least one of its cells applied: a row whose every cell was refused (a field error each) counts 0. A row error that refuses the whole product is shown by its label in the admin, never as a raw code.
  - A non-empty cell under a Page Builder content attribute's `attribute:<key>` column is refused as the field error `content_attribute`; the rest of the row is imported.

### Patch Changes

- 5303aab: A products import row that fills a column named after a Page Builder content attribute (`specs/172-product-content-attributes/`) gets a per-row error naming the attribute, and is not imported; the row's other cells are still validated. Products exports never carry content attributes.
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

- dcbd154: The products export carries one `status@<channel code>` column per sales channel and one `status@<channel code>/<language>` column per channel language — the override at that scope, empty where it inherits — and the import reads them back (an empty cell removes the override; a value that is not a status rejects the file). A file without these columns leaves every scope as it is. Adapters may answer `exportTable()` when their columns depend on the data.
- dd6deb2: "Archived" is read from the product's archived time, never from its status (the catalogue's status is now `active` | `inactive` and `inactive` no longer archives).

  - **Product import:** a `status` of `draft` or `archived` is refused per record with `invalid status: <value>`; `inactive` switches the product off without archiving it.
  - **Quick-order import:** `product_archived` is reported for an archived product whatever its status. A product merely switched off is not `product_archived`; for a buyer it is the channel's `product_not_found`.
  - **Shopping-list conversion:** an archived product is skipped as `product_archived` whatever its status; a product switched off is the availability answer's `product_not_found`.
  - **Reorder:** an archived product is reported `discontinued` and left out; a product merely switched off is seeded and left to the basket and to placement to refuse.

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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

- 14bcf1d: Feature 160 (D-287 P1) on the edges of pricing.

  - **customer_accounts** — demo data of its own: the _VIP_ customer group (code `demo-vip`) of the owner's E3 pricing scenario; `demo reset` withdraws it by its code.
  - **import_export** — the products import refuses a file carrying a `default_price`, `defaultPrice`, `price`, `price_override` or `priceOverride` column with `400 PRICE_SET_IN_PRICE_BOOKS` and imports nothing: a product has no price of its own, so the column would otherwise be dropped without a word. Adapters may declare such columns with the new `refusedHeader`.
  - **demo-composition** — the price-list backfill step (`DefaultPriceListMigrator` over each product's `defaultPrice`) is replaced by _base prices and price books over the demo catalogue_, which calls `price_lists`' `seedDemoPriceBooks` with the demo's ids, and _demo organisation joins the VIP customer group_; the `color` attribute is flagged as a price-rule attribute.

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

- ecd23de: Each import/export entity now requires the permission that protects the same rows on the module
  that owns them, instead of `catalog:write` for every entity.

  | Entity                   | Export           | Import            |
  | ------------------------ | ---------------- | ----------------- |
  | `products`, `categories` | `catalog:read`   | `catalog:write`   |
  | `stock`                  | `inventory:read` | `inventory:write` |
  | `customers`              | `customers:read` | —                 |
  | `orders`                 | `orders:read`    | —                 |
  - `GET /api/v1/admin/import-export/entities`, `GET /api/v1/admin/export/:entity.csv` and
    `POST /api/v1/admin/import/:entity` require one of these codes; the export and import routes
    then require the entity's own code and answer `403` without it. An import of an export-only
    entity is refused with `403` for a caller who may not export it, and with `405` otherwise.
  - The entity listing offers a caller only the entities they may export or import, and each entry
    carries `canExport` and `canImport`.
  - The admin screen and its sidebar entry open for an operator holding any of the codes above, and
    each entity card shows only the export and import controls the operator's role permits.

  **For an operator upgrading.** A role that used `catalog:write` to export customers, orders or
  stock, or to import stock, needs `customers:read`, `orders:read`, `inventory:read` or
  `inventory:write` granted on `/admin-roles`. A role holding `catalog:read` can now export
  products and categories.

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

- 4c9892c: `@endora-commerce/mod-import-export` ships an `./admin` layer: the import/export centre's screen,
  its route and its sidebar entry now live in this package instead of in the admin application.

  ```ts
  import { contributions } from '@endora-commerce/mod-import-export/admin';
  // { routes: [{ path: '/import-export', component: () => import(…), … }], nav: [ … ] }
  ```

  The entry exports data and nothing else — one route whose component is a dynamic-import factory,
  and one sidebar declaration. A host that consumes it renders `[...hostRoutes, ...registryRoutes]`
  and gates each contribution on the module's effective presence and the permission its own API
  routes enforce (`catalog:write`); it must not import the screen directly.

  The module's user-facing strings moved with it, from the platform's shared `core` i18n namespace
  into this package's own `i18n/en.json` and `i18n/pl.json` under the `import_export` namespace, and
  lost their `importExport.` prefix in the process (`importExport.page.title` → `page.title`). The
  sidebar label is `nav.importExport.label`; the platform's `appShell.nav.importExport` is gone.

  The package now emits its UI layer under `tsconfig.ui.json` (`jsx: react-jsx`, the `DOM` lib) and
  peers on `react`, `lucide-react` and `@endora-commerce/admin-kit`.

- 3ad96d8: Ten new packages: the first **batch** of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time before them; these ten move together, and
  the properties below are the same ten times over.

  **One changeset, not ten, and that is a judgement rather than a shortcut.** A changeset is
  written for the consumer of a package, and for a package that did not exist a moment ago
  there is no upgrader to instruct — every one of the ten says the same thing, _"this package
  now exists, here are its subpaths, and here is what it deliberately does not export"_. Ten
  files carrying one rationale would be nine copies of a derived fact. What genuinely differs
  per package is its layer inventory, and that is the table below.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                | Subpaths                         | Entities                          | Migrations | Ships          |
  | -------------------------------------- | -------------------------------- | --------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-health-checks`   | `.`, `./backend`                 | —                                 | —          | `dist`         |
  | `@endora-commerce/mod-audit-logs`      | `.`, `./backend`                 | —                                 | —          | `dist`         |
  | `@endora-commerce/mod-addresses`       | `.`, `./backend`                 | `Address`                         | —          | `dist`         |
  | `@endora-commerce/mod-currencies`      | `.`, `./backend`                 | `Currency`                        | —          | `dist`         |
  | `@endora-commerce/mod-languages`       | `.`, `./backend`, `./migrations` | `Language`                        | 1          | `dist`         |
  | `@endora-commerce/mod-seo`             | `.`, `./backend`, `./migrations` | `SeoMetaOverride`, `SitemapCache` | 1          | `dist`         |
  | `@endora-commerce/mod-analytics`       | `.`, `./backend`, `./migrations` | `AnalyticsEvent`                  | 1          | `dist`         |
  | `@endora-commerce/mod-import-export`   | `.`, `./backend`                 | —                                 | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shipments`       | `.`, `./backend`, `./migrations` | `Shipment`                        | 2          | `dist`         |
  | `@endora-commerce/mod-payment-methods` | `.`, `./backend`, `./migrations` | `PaymentMethod`                   | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168). The classes in that column are imported to build the array and are exported
  under no name, so `import type { PaymentMethod } from '@endora-commerce/mod-payment-methods/backend'`
  does not compile in a consumer's tree, whoever the consumer is. A foreign key still works —
  `shipments.order_id -> orders.id` is between two column names and needs the table, never the
  owner's class.

  **Three of the ten own no table, and say so with an empty array rather than by omission.**
  `health-checks`, `audit-logs` and `import-export` export `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export with
  `[]`, so "this module has no table" and "somebody forgot the array" would otherwise arrive as
  one silence, whose only symptom is a query against a table nobody created.

  **`./migrations` publishes a `migrations` array plus each class by name.** The asymmetry with
  `./backend` is deliberate — `mikro_orm_migrations` persists the class name, so it is a string
  every already-migrated database holds, while an entity class name is contract to nobody.

  **Two behavioural removals, both in `./backend`, both affecting no caller in this repository.**
  `@endora-commerce/mod-currencies/backend` no longer re-exports `CURRENCY_CHANGED_EVENT` and
  `@endora-commerce/mod-languages/backend` no longer re-exports `LANGUAGE_CHANGED_EVENT`. Both
  constants live in `@endora-commerce/contracts` and have since feature 075's Phase P; the
  re-exports were that phase's compatibility shim, kept for consumers that turned out not to
  exist. Import them from `@endora-commerce/contracts`, which is where the one and only
  `dictionaries` consumer already reads them.

  ```ts
  // before — from the module barrel
  import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/mod-currencies/backend';
  // after — from the contracts package, where the constant is declared
  import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/contracts';
  ```

### Patch Changes

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
