# @endora-commerce/demo-composition

## 0.109.0

### Minor Changes

- 9b3e7f0: The megamenu becomes the storefront's navigation bar (`specs/168-megamenu-navigation-bar/`, issue #522).

  **Breaking** (owner ruling: no backward compatibility for stored menus or the megamenu wire contract):

  - A top-level item is a **tab** and must carry a `presentation` — `link`, `dropdown`, `mega` or `catalog` — and may carry an `alignment` (`start`, `end`); no other item may carry either. `PUT /api/v1/admin/megamenu/menus/:id/items` refuses a tab without one, a tab of kind `asset`, `cms-block-embed` or `category-tree` (`400 MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`), a `link` tab with children or of kind `group` (`400 MEGAMENU_LINK_TAB_INVALID`), and an `external-link`, `button` or `group` with no label (`400 MEGAMENU_LABEL_REQUIRED`).
  - `ResolvedMenuItem.id` and `parentId` are strings, not uuids: a category a `category-tree` expands to has the id `<tree item id>:<category id>`. Tabs carry `presentation` and `alignment`. A `category-tree` never appears in a resolved tree.
  - The migration `20261029T162855_megamenu_navigation_bar` adds `presentation`, `alignment` and `audience` to `megamenu_items` and makes every stored top-level item a start-aligned `mega` tab; nothing else is converted. The Redis prefix moves to `megamenu:v2:`.
  - The storefront header renders the menu's tabs and nothing else: the hard-coded _Wszystkie kategorie_ trigger and Quick Order button are gone, and so is the mobile drawer's Quick Order promo. A deployment that wants them configures them as tabs; the demo menu does.

  Added:

  - `@endora-commerce/contracts`: item kinds `group` (a heading; a column of a `mega` panel) and `category-tree` (`{ rootCategoryId, depth: 1–3 }`); `megamenuPresentationSchema`, `megamenuAlignmentSchema`, `megamenuAudienceSchema`, `MEGAMENU_TAB_KINDS`, `MEGAMENU_LABEL_INHERITING_KINDS`; `CmsPageReadPort.findStorefrontLinks`; `effectiveCustomerGroupId`, moved from `@endora-commerce/mod-price-lists`, which re-exports it.
  - `@endora-commerce/mod-megamenu`: a `category-tree` expands to the catalogue's live categories on every resolution, from one catalogue read; an empty label on a category link, page link or tree inherits the target's name; a page link follows the page's name, slug and parent path per language. Every item has an audience — everyone, guests, signed-in customers, or customers whose effective customer group is one of the chosen ones — and the storefront API answers each visitor only their items, with `Cache-Control: private, no-store` for an identified caller. Every write runs as a Command with one audit entry (`megamenu.*`), and the module joins the Command Bus coverage check. New dependencies on `customer_accounts` and `organizations`, both non-deactivatable. The editor shows a tab's presentation and alignment, offers the kinds a level allows, sets audiences with customer groups, configures category trees, and marks hidden items in the tree.
  - `@endora-commerce/mod-megamenu`: a tab with a link of its own and a panel can follow its link on click (`clickNavigates`, migration `20261029T190956_megamenu_tab_click_navigates`); the storefront renders it as its link plus a separate toggle for the panel. The `catalog` presentation is named _Panel with side list_ in the editor, and its _All in …_ link appears only for a category.
  - `@endora-commerce/mod-cms`: `findStorefrontLinks(ids, { salesChannelId, language, channelDefaultLanguage })` on the page read port — a page's localised name and its URL in the channel's tree for that language.
  - `@endora-commerce/mod-settings`: the cache flush names `megamenu:v2:*`.
  - `@endora-commerce/mod-catalog`: the demo categories carry Polish names.
  - `@endora-commerce/demo-composition`: the demo menu is a _Wszystkie kategorie_ catalogue tab over the demo category tree, and a Quick Order button at the end of the bar.

- 5aa5bc2: The demo shop has Projects and Tasks to show.

  Two new composition steps, each guarded by the presence of every module it touches:

  - **projects for the demo organisation, and a Template** (`projects`, `organizations`,
    `admin_users`, `orders`) — the Template _Showroom fit-out_ (four Stages, the first gated by two
    Stage Tasks) and four Projects made from it: one open in that first Stage, one completed, one
    lost and one internal, with the demo administrator as Project Manager and the demo Sales Reps
    as Members. The open and the completed Project each hold one of the demo organisation's Orders
    where one exists.
  - **stage tasks of the demo projects** (`tasks`, `projects`, `admin_users`) — the Tasks those
    Projects' Stages made, created by the demo administrator. Where `tasks` is absent the step is
    a reported skip and the Projects are seeded all the same.

  Both are withdrawn by id on `demo reset`. **`demo reset` also withdraws the Projects an
  administrator opened for the demo organisation since**, which used to refuse the reset (the
  organisation's foreign key from `project_organizations` is `on delete restrict`): two new
  sections of the used-demo withdrawal delete the Tasks of those Projects, then the Projects that
  are the demo organisation's alone, whole. A Project it shares with another organisation stays;
  only the demo organisation's place on it and its links to the demo organisation's records go. An
  internal Project is never matched. The package gains `@endora-commerce/mod-projects` and
  `@endora-commerce/mod-tasks` as optional peer dependencies.

- fa73678: The demo shop has Tasks of its own to show (`specs/165-task-management/` R-23).

  - A new composition step, **standalone tasks of the demo administrators** (`tasks`,
    `admin_users`, `orders`), seeds ten Tasks of no Project: a parent with three sub-tasks, two
    tags and the seeded priorities, start and due dates, assignees across the demo administrator
    and Sales Reps, two comments that refer to a person and to other Tasks, one private Task and
    one draft of the demo administrator's. The call-back Task links the demo organisation's newest
    Order where one exists. Where `tasks` is absent the step is a reported skip. It is withdrawn by
    id on `demo reset`, its two tags with it.
  - The demo Projects' Stage Tasks now carry their Stage Task definition's id as their source key,
    as a materialisation writes it, so retrying a demo Stage's Task creation adds none.

### Patch Changes

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

- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [f91e55f]
- Updated dependencies [e4d86da]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [cdf36fd]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [9d71126]
- Updated dependencies [1a6c47e]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [ff1c5da]
- Updated dependencies [bf60414]
- Updated dependencies [36cdf11]
- Updated dependencies [b12a2a1]
- Updated dependencies [22604fa]
- Updated dependencies [514cbf7]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [a76d6ee]
- Updated dependencies [d560d58]
- Updated dependencies [0e33ca9]
- Updated dependencies [634edd0]
- Updated dependencies [dcbd154]
- Updated dependencies [678fed1]
- Updated dependencies [ed54c82]
- Updated dependencies [fd2ac2d]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [473ef09]
- Updated dependencies [22604fa]
- Updated dependencies [6789af2]
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
- Updated dependencies [3aba2e1]
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
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [8ef189b]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [4bc5c7f]
- Updated dependencies [4bc5c7f]
- Updated dependencies [91dfab5]
- Updated dependencies [4bc5c7f]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [77c01b1]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [bec2e83]
- Updated dependencies [a166cfd]
- Updated dependencies [24ef6aa]
- Updated dependencies [1a88646]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [bd7968e]
- Updated dependencies [ffb2aec]
- Updated dependencies [c73366c]
- Updated dependencies [c73366c]
- Updated dependencies [87af080]
- Updated dependencies [b0a1e48]
- Updated dependencies [c99b4cd]
- Updated dependencies [d86466f]
- Updated dependencies [8eb0fcb]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [df95f59]
- Updated dependencies [70092cf]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [04fa275]
- Updated dependencies [ed85493]
- Updated dependencies [8f61649]
- Updated dependencies [32ff3c1]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [55864a1]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [55864a1]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [11b0eb8]
- Updated dependencies [55864a1]
- Updated dependencies [8f7c38e]
- Updated dependencies [11b0eb8]
- Updated dependencies [55864a1]
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/mod-catalog@0.109.0
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/mod-price-lists@0.109.0
  - @endora-commerce/mod-inventory@0.109.0
  - @endora-commerce/mod-admin-users@0.109.0
  - @endora-commerce/mod-megamenu@0.109.0
  - @endora-commerce/mod-crm@0.109.0
  - @endora-commerce/mod-projects@0.109.0
  - @endora-commerce/mod-tasks@0.109.0
  - @endora-commerce/mod-organizations@0.109.0
  - @endora-commerce/mod-custom-fields@0.109.0
  - @endora-commerce/mod-admin-roles@0.109.0
  - @endora-commerce/mod-credit-limits@0.109.0
  - @endora-commerce/mod-customer-accounts@0.109.0

## 0.108.0

### Minor Changes

- 14bcf1d: Feature 160 (D-287 P1) on the edges of pricing.

  - **customer_accounts** — demo data of its own: the _VIP_ customer group (code `demo-vip`) of the owner's E3 pricing scenario; `demo reset` withdraws it by its code.
  - **import_export** — the products import refuses a file carrying a `default_price`, `defaultPrice`, `price`, `price_override` or `priceOverride` column with `400 PRICE_SET_IN_PRICE_BOOKS` and imports nothing: a product has no price of its own, so the column would otherwise be dropped without a word. Adapters may declare such columns with the new `refusedHeader`.
  - **demo-composition** — the price-list backfill step (`DefaultPriceListMigrator` over each product's `defaultPrice`) is replaced by _base prices and price books over the demo catalogue_, which calls `price_lists`' `seedDemoPriceBooks` with the demo's ids, and _demo organisation joins the VIP customer group_; the `color` attribute is flagged as a price-rule attribute.

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [20af5d5]
- Updated dependencies [bc1b52c]
- Updated dependencies [7995063]
- Updated dependencies [1846a38]
- Updated dependencies [b124db8]
- Updated dependencies [ee26beb]
- Updated dependencies [44c1615]
- Updated dependencies [3d1e47c]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [14bcf1d]
- Updated dependencies [14bcf1d]
- Updated dependencies [337fb65]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [256e488]
- Updated dependencies [14bcf1d]
- Updated dependencies [e47b84b]
- Updated dependencies [b583f89]
- Updated dependencies [715ddcf]
- Updated dependencies [8d62ff8]
- Updated dependencies [e358ccb]
- Updated dependencies [6865b14]
- Updated dependencies [9434cbc]
- Updated dependencies [df3b5c2]
- Updated dependencies [f3bab60]
- Updated dependencies [badca15]
- Updated dependencies [7f33967]
- Updated dependencies [2974ffa]
- Updated dependencies [e3aef9b]
- Updated dependencies [a71bc5a]
- Updated dependencies [a2cfed7]
- Updated dependencies [86050a0]
- Updated dependencies [87ac085]
- Updated dependencies [c092719]
- Updated dependencies [20d563e]
- Updated dependencies [26ad8db]
- Updated dependencies [87f673d]
- Updated dependencies [0194c0c]
- Updated dependencies [528aec6]
- Updated dependencies [bf6e980]
- Updated dependencies [ad341ed]
- Updated dependencies [d99d6c1]
- Updated dependencies [5001ba1]
- Updated dependencies [84f4165]
- Updated dependencies [2b9689b]
- Updated dependencies [0ef7316]
- Updated dependencies [ceeab70]
- Updated dependencies [456b948]
- Updated dependencies [5f7cbdf]
- Updated dependencies [8026d81]
- Updated dependencies [301a69f]
- Updated dependencies [af57b55]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [ae25fed]
- Updated dependencies [c781cd6]
- Updated dependencies [a9c72e8]
- Updated dependencies [fdd86e3]
- Updated dependencies [af57b55]
- Updated dependencies [615a5c9]
- Updated dependencies [ef1318e]
- Updated dependencies [29626f4]
- Updated dependencies [004c513]
- Updated dependencies [c9b9d27]
- Updated dependencies [4d07648]
- Updated dependencies [74faecb]
- Updated dependencies [ce572ca]
- Updated dependencies [4d919e6]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [b0e1abd]
- Updated dependencies [0d0a1c6]
- Updated dependencies [cec838d]
- Updated dependencies [96c07f5]
- Updated dependencies [6f1e0ec]
- Updated dependencies [8f08235]
- Updated dependencies [55d957b]
- Updated dependencies [9a2d1f8]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [108955f]
- Updated dependencies [53e88c7]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8e4f87a]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [efaf8a3]
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
- Updated dependencies [4d49029]
- Updated dependencies [d2d3d9a]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
- Updated dependencies [e6f3a78]
  - @endora-commerce/mod-catalog@0.108.0
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/mod-crm@0.108.0
  - @endora-commerce/mod-custom-fields@0.108.0
  - @endora-commerce/mod-organizations@0.108.0
  - @endora-commerce/mod-price-lists@0.108.0
  - @endora-commerce/mod-customer-accounts@0.108.0
  - @endora-commerce/mod-credit-limits@0.108.0
  - @endora-commerce/mod-admin-roles@0.108.0
  - @endora-commerce/mod-admin-users@0.108.0
  - @endora-commerce/mod-inventory@0.108.0
  - @endora-commerce/mod-megamenu@0.108.0

## 0.107.0

### Minor Changes

- cc623f7: `demo reset` withdraws the demo organisation's rows in `pwa`'s new
  `push_notification_preferences` table (a customer's account-wide push choices), as it already did
  for `push_subscriptions`. The section is skipped, and reported as such, on an instance where `pwa`
  was never installed.

### Patch Changes

- 5d52b9f: The demo organisation is assigned the system-default sales channel the retail store adopts, so
  the demo buyer may shop there once sales-channel access is enforced; the reset withdraws the
  assignment with the buyer.
- Updated dependencies [fcf4d09]
- Updated dependencies [cad6a6e]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [70bb5e5]
- Updated dependencies [70bb5e5]
- Updated dependencies [76f9757]
- Updated dependencies [76f9757]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [bf9881f]
- Updated dependencies [bf9881f]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [ac24f80]
- Updated dependencies [ac24f80]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [649fe8d]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
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
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/mod-price-lists@0.107.0
  - @endora-commerce/platform@0.107.0
  - @endora-commerce/mod-catalog@0.107.0
  - @endora-commerce/mod-customer-accounts@0.107.0
  - @endora-commerce/mod-crm@0.107.0
  - @endora-commerce/mod-organizations@0.107.0
  - @endora-commerce/mod-admin-users@0.107.0
  - @endora-commerce/mod-admin-roles@0.107.0
  - @endora-commerce/mod-credit-limits@0.107.0
  - @endora-commerce/mod-custom-fields@0.107.0
  - @endora-commerce/mod-inventory@0.107.0
  - @endora-commerce/mod-megamenu@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/mod-admin-roles@0.106.0
  - @endora-commerce/mod-admin-users@0.106.0
  - @endora-commerce/mod-catalog@0.106.0
  - @endora-commerce/mod-credit-limits@0.106.0
  - @endora-commerce/mod-crm@0.106.0
  - @endora-commerce/mod-custom-fields@0.106.0
  - @endora-commerce/mod-customer-accounts@0.106.0
  - @endora-commerce/mod-inventory@0.106.0
  - @endora-commerce/mod-megamenu@0.106.0
  - @endora-commerce/mod-organizations@0.106.0
  - @endora-commerce/mod-price-lists@0.106.0

## 0.105.0

### Minor Changes

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

### Patch Changes

- Updated dependencies [1ba6b26]
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
- Updated dependencies [fcab32c]
- Updated dependencies [8ee69de]
- Updated dependencies [8d4440f]
- Updated dependencies [34fe84f]
- Updated dependencies [e308af9]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [fd3f055]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/mod-admin-users@0.105.0
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/mod-admin-roles@0.105.0
  - @endora-commerce/mod-price-lists@0.105.0
  - @endora-commerce/mod-catalog@0.105.0
  - @endora-commerce/mod-crm@0.105.0
  - @endora-commerce/mod-inventory@0.105.0
  - @endora-commerce/mod-organizations@0.105.0
  - @endora-commerce/mod-customer-accounts@0.105.0
  - @endora-commerce/mod-custom-fields@0.105.0
  - @endora-commerce/mod-credit-limits@0.105.0
  - @endora-commerce/mod-megamenu@0.105.0

## 0.104.0

### Minor Changes

- 22e2cea: The demo sales pipeline plans Events. The step `sales opportunities for the demo organisation`
  now writes eight Events on six of the eight open demo opportunities — site visits, calls and two
  all-day deadlines — so the CRM Calendar and an opportunity's Events tab have something to show
  on a freshly seeded shop.

  - They are dated from the day of the seed: seven in the coming two weeks and one five days back.
  - **None has a reminder.** A seeded demo writes no notification and sends no e-mail.
  - The closed opportunities have none: the Calendar shows active opportunities only.
  - An all-day demo Event is a whole UTC day (`timeZone: 'UTC'`); a timed one is planned in
    `Europe/Warsaw`, inside the working day.

  Nothing the package exports changes: the pipeline's declarations are not on its barrel.

  `pnpm run cli demo reset` removes the Events with their opportunities. An opportunity that was
  already seeded before this change is left exactly as it is, as every re-seed leaves it — it
  gains no Event; reset and seed again to get them.

- 11ae65b: The demo shop gains a sales pipeline. A new step, `sales opportunities for the demo
organisation`, creates twelve CRM opportunities for the demo organisation — two in each status of
  the default workflow (`new`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) — assigned
  across the two demo sales representatives with one left unassigned, with status history dated
  over the three months before the seed, the `crm` module's demo tags, the demo buyer as contact
  person on four of them, six notes and internal messages, and references to a demo product and to
  a person. Eleven carry a value entered by hand and one is set to be calculated from its linked
  documents. None is linked to an order or a quote request: the demo shop has neither.

  `pnpm run cli demo seed` adds the pipeline to a shop that is already seeded and leaves an
  opportunity that is already there untouched; `pnpm run cli demo reset` removes exactly these
  twelve, by id. The step runs only when `crm`, `organizations`, `admin_users`,
  `customer_accounts` and `catalog` are all installed and switched on, and is reported as skipped
  otherwise. The rows are written directly rather than through CRM's commands, so a seeded
  opportunity's History tab is empty.

  **Run `demo reset` with CRM switched on.** While `crm` is off the step is skipped in both
  directions, the opportunities keep referencing the demo organisation, and the reset stops at
  `organizations` with a foreign-key refusal.

  Two peers are new: `@endora-commerce/mod-crm` (optional, like every module this package wires)
  and `@endora-commerce/contracts`, which an instance already installs for its modules.

### Patch Changes

- 2d39d97: A product attribute carries a new flag, **`isPriceRule`** — whether the attribute may be used as a
  price-building rule in a Price List. It is the pricing sibling of `isPromoRule` and travels the
  same way: `false` by default, set on create, hot-toggled through
  `PATCH /api/v1/admin/catalog/attributes/:key`, and shown as a column and a checkbox on the admin
  Attributes screen.

  - **`@endora-commerce/contracts`** — `createAttributeRequestSchema` and
    `updateAttributeRequestSchema` accept an optional `isPriceRule`;
    `adminAttributeResponseSchema` and `CatalogAttributeView` always carry it; `CatalogAttributeFlag`
    and `CatalogAdminAttributeFlag` gain `'isPriceRule'`, so
    `catalogAttributeReadPort.listByFlag('isPriceRule')` answers the attributes a price rule may name.
    **If you build a `CatalogAttributeView` yourself** — a test double of `CatalogAttributeReadPort`
    is the usual case — add `isPriceRule: false`; the field is required, which is why this is a
    minor in a `0.x` series.
  - **`@endora-commerce/mod-catalog`** — a migration adds `product_attributes.is_price_rule`
    (`boolean not null default false`), and `GET /api/v1/admin/catalog/attributes/by-flag` accepts
    `flag=isPriceRule`.
  - **`@endora-commerce/demo-composition`** — `createAttributeFixture` accepts `isPriceRule`.

  Nothing prices from the flag yet: a Price List's application rule still matches on sales channel,
  customer group, organization, category and currency only. This release records the flag and
  publishes it for the price-rule work to consume.

- Updated dependencies [dbf6778]
- Updated dependencies [44d35a6]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [eb04e42]
- Updated dependencies [ce0471f]
- Updated dependencies [bcd577c]
- Updated dependencies [32775d5]
- Updated dependencies [7af6470]
- Updated dependencies [fd640a0]
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/mod-admin-roles@0.104.0
  - @endora-commerce/mod-catalog@0.104.0
  - @endora-commerce/mod-megamenu@0.104.0
  - @endora-commerce/mod-crm@0.104.0
  - @endora-commerce/mod-custom-fields@0.104.0
  - @endora-commerce/mod-admin-users@0.104.0
  - @endora-commerce/mod-credit-limits@0.104.0
  - @endora-commerce/mod-customer-accounts@0.104.0
  - @endora-commerce/mod-inventory@0.104.0
  - @endora-commerce/mod-organizations@0.104.0
  - @endora-commerce/mod-price-lists@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- Updated dependencies [7f6a4ba]
  - @endora-commerce/mod-inventory@0.103.1
  - @endora-commerce/mod-admin-roles@0.103.1
  - @endora-commerce/mod-admin-users@0.103.1
  - @endora-commerce/mod-catalog@0.103.1
  - @endora-commerce/mod-credit-limits@0.103.1
  - @endora-commerce/mod-custom-fields@0.103.1
  - @endora-commerce/mod-customer-accounts@0.103.1
  - @endora-commerce/mod-megamenu@0.103.1
  - @endora-commerce/mod-organizations@0.103.1
  - @endora-commerce/mod-price-lists@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- 7f579d2: **A demo seed or reset that stops part-way no longer leaves the demo administrators without a
  role.** An administrator without a role is refused, and a demo run is not one transaction, so the
  pairing of the three demo accounts with their roles can no longer wait for a late step:
  - `demo seed` creates each demo administrator already holding its role. An account that an
    earlier, interrupted run left without a role is given it on the next `demo seed`; a role
    somebody chose for one of these accounts is never replaced.
  - The composition step "demo administrators take their roles" now runs first and only fills in a
    missing role. Its withdrawal no longer unassigns anything.
  - `demo reset` deletes the demo accounts with their role still on them, then the demo's own
    `sales_representative` role. The `platform_admin` role stays.

  `demo seed` now fails, naming the role, if a role a demo administrator needs does not exist,
  rather than creating the account without one.

  **Several processes can start at once on a database that does not hold the
  platform-administrator role yet.** Each process ensures the role at boot; the ones that lose the
  race now find the role the winner created instead of failing to start.

- Updated dependencies [08192f0]
- Updated dependencies [a609ce3]
- Updated dependencies [7f579d2]
- Updated dependencies [f052b7f]
- Updated dependencies [9eb7ed9]
- Updated dependencies [9eb7ed9]
- Updated dependencies [f2a2dca]
- Updated dependencies [11c0962]
  - @endora-commerce/mod-admin-roles@0.103.0
  - @endora-commerce/mod-admin-users@0.103.0
  - @endora-commerce/mod-organizations@0.103.0
  - @endora-commerce/mod-catalog@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/mod-credit-limits@0.103.0
  - @endora-commerce/mod-inventory@0.103.0
  - @endora-commerce/mod-custom-fields@0.103.0
  - @endora-commerce/mod-customer-accounts@0.103.0
  - @endora-commerce/mod-megamenu@0.103.0
  - @endora-commerce/mod-price-lists@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/mod-inventory@0.102.0
  - @endora-commerce/mod-catalog@0.102.0
  - @endora-commerce/mod-megamenu@0.102.0
  - @endora-commerce/mod-organizations@0.102.0
  - @endora-commerce/mod-price-lists@0.102.0
  - @endora-commerce/mod-admin-roles@0.102.0
  - @endora-commerce/mod-admin-users@0.102.0
  - @endora-commerce/mod-credit-limits@0.102.0
  - @endora-commerce/mod-custom-fields@0.102.0
  - @endora-commerce/mod-customer-accounts@0.102.0

## 0.101.1

### Patch Changes

- Updated dependencies [69a3717]
  - @endora-commerce/mod-admin-users@0.101.1
  - @endora-commerce/mod-catalog@0.101.1
  - @endora-commerce/mod-credit-limits@0.101.1
  - @endora-commerce/mod-customer-accounts@0.101.1
  - @endora-commerce/mod-custom-fields@0.101.1
  - @endora-commerce/mod-inventory@0.101.1
  - @endora-commerce/mod-megamenu@0.101.1
  - @endora-commerce/mod-organizations@0.101.1
  - @endora-commerce/mod-price-lists@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/mod-admin-roles@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [be758bb]
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [5749604]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/mod-admin-users@0.101.0
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-catalog@0.101.0
  - @endora-commerce/mod-admin-roles@0.101.0
  - @endora-commerce/mod-credit-limits@0.101.0
  - @endora-commerce/mod-custom-fields@0.101.0
  - @endora-commerce/mod-customer-accounts@0.101.0
  - @endora-commerce/mod-inventory@0.101.0
  - @endora-commerce/mod-megamenu@0.101.0
  - @endora-commerce/mod-organizations@0.101.0
  - @endora-commerce/mod-price-lists@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: `demo seed` on an instance scaffolded by the CLI now builds a working demo shop. Before, it created every module's own demo rows and nothing that joins them: `admin@demo.local` and both sales representatives had no admin role (`/admin/me` answered `permissions: []`, so the admin sidebar was empty), and the 203 demo products were sold on no sales channel, so the storefront listed none. The wiring — roles, channel and category bindings, the menu, prices, stock, the demo buyer, attributes, images, attachments and the credit limit — was a file in the platform repository's own host, which no instance had.

  It is now the new package `@endora-commerce/demo-composition`. The platform's operator CLI finds an installed package declaring `"endora": { "type": "demo-composition" }` when the instance's `cli.ts` passes no `demoComposition` loader, and runs it; with none installed, `demo seed` behaves as before and its notice now names the package to add. `endora install --demo` and the new `endora new instance --demo` add the package to the instance's module list and write no file into the tree.

  The demo adopts the instance's system-default sales channel as its retail channel and keeps that channel's code when the operator chose one (`DEFAULT_SALES_CHANNEL_CODE`); only the platform's fallback code, `default`, is renamed `pl_retail`, as before. It used to rename any code, which would have moved the demo off the channel a storefront is built against.

  `@endora-commerce/platform/demo` — the host-internal subpath no module may name — no longer exports `NO_DEMO_COMPOSITION_NOTICE` or the `DemoCompositionLookup` type; their only consumer outside the platform was the loader this change removes. `DemoCompositionInput` stays, as the argument `createDemoComposition` takes.

  To fix an existing instance: `pnpm add -w @endora-commerce/demo-composition` at the instance root (it is a pnpm workspace, so plain `pnpm add` refuses), then `pnpm run cli demo seed` again. The seed is idempotent, so the rows already there are joined rather than duplicated.

- Updated dependencies [54c7417]
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-admin-roles@0.100.2
  - @endora-commerce/mod-admin-users@0.100.2
  - @endora-commerce/mod-catalog@0.100.2
  - @endora-commerce/mod-credit-limits@0.100.2
  - @endora-commerce/mod-custom-fields@0.100.2
  - @endora-commerce/mod-customer-accounts@0.100.2
  - @endora-commerce/mod-megamenu@0.100.2
  - @endora-commerce/mod-organizations@0.100.2
  - @endora-commerce/mod-price-lists@0.100.2
  - @endora-commerce/mod-inventory@0.100.2
