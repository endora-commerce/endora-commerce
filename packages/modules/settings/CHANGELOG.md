# @endora-commerce/mod-settings

## 0.109.0

### Minor Changes

- 0e33ca9: The shop's identity gains a logo and social profiles, for the storefront's `Organization` structured data.

  - `@endora-commerce/mod-settings` registers `shop.logo_asset_id` (an asset id, `''` while unset) and `shop.social_profiles` (a list of URLs, `[]` by default). Social profile URLs must be `https:`; anything else is refused with `422 VALIDATION_FAILED` and nothing is stored. The shop-info read resolves the logo to its public URL (a missing or non-public asset reads as `null`) and returns only `https:` profiles. No existing default changes.
  - **`@endora-commerce/mod-settings` now declares a dependency on `assets_library`** to resolve the logo. Both modules are non-deactivatable, so no installation changes, but a deployment that composes `settings` without `assets_library` now fails the module dependency check.
  - `@endora-commerce/contracts`: `ShopInfoSchema` gains `logoUrl` (`string | null`) and `socialProfiles` (`string[]`), both required in the response.

### Patch Changes

- 0e33ca9: Brand tokens for page-builder content: one set of colours, colour schemes, fonts, a type scale, button sizes, spacing and layout widths that every block reads, set globally and optionally overridden per sales channel.

  - `@endora-commerce/contracts` exports the token shape and its rules: `cmsBrandTokensSchema` / `CmsBrandTokens`, `DEFAULT_BRAND_TOKENS`, `BRAND_TYPE_TOKENS`, `BRAND_SPACE_TOKENS`, `BRAND_SCHEMES`, `brandFontSourceSchema` (system, library asset or `https:` stylesheet), the contrast helpers `assessBrandContrast`, `contrastRatio`, `relativeLuminance`, `CONTRAST_REQUIRED_BODY` / `CONTRAST_REQUIRED_LARGE`, and the HTTP shapes `putCmsBrandTokensRequestSchema`, `putCmsBrandTokensResponseSchema`, `cmsBrandTokensAdminReadSchema`, `cmsBrandTokensStorefrontResponseSchema`. `CMS_STOREFRONT_CACHE_TAGS.brand` (`cms:brand`) is the storefront cache tag a save revalidates.
  - `@endora-commerce/mod-cms` stores the tokens in a new `cms_brand_tokens` table (migration `20261022T163218_cms_brand_tokens`), serves `GET`/`PUT /api/v1/admin/cms/brand-tokens` (read with `cms.read`, write with the new permission `cms.brand`; optimistic version check, audited, a stale write is `409`) and `GET /api/v1/storefront/cms/brand-tokens` (answers on a closed sales channel too). The page-builder descriptor carries the effective `brandTokens` and accepts `?salesChannelId=`. The Admin UI adds a _Brand_ screen at `/cms/brand` with live preview and contrast warnings (saving is never blocked by them), reachable from the content navigation and the command palette (`open-cms-brand`); the page editor's preview applies the page's channel tokens.
  - `@endora-commerce/cms-components` exports `brandTokensToCss` (also at `@endora-commerce/cms-components/brand/brand-css`), which renders the tokens as `--cmsb-*` custom properties plus font links. Every block style that reads a `--cmsb-*` variable keeps the previous literal as its fallback, so a storefront that never emits the variables renders exactly as before.
  - `@endora-commerce/page-builder-core` re-exports the token types from its barrel and the values from the new `@endora-commerce/page-builder-core/brand-tokens` subpath. Colour fields may store a brand role as `token:<role>`: `BRAND_COLOR_ROLES`, `brandColorRole`, `brandColorFallback` and `resolveColorValue` (`token:primary` → `var(--cmsb-color-primary, <default>)`); the palette context gains an opt-in `brandRoles` flag, and `backgroundToStyle` resolves tokens.
  - `@endora-commerce/page-builder-admin`: `PageBuilderColorPaletteProvider` takes an optional `brandColors`; when set, the palette lists the brand colours first and a pick stores the role token. Leave it unset where content is rendered without the brand stylesheet, such as e-mail.
  - `@endora-commerce/mod-settings` lists the `cms-brand` cache namespace on the cache screen; `@endora-commerce/mod-i18n` adds the `pageBuilder.colorPalette.*` labels (English and Polish).

- 61fc321: The storefront language is part of the URL path (`/pl/p/wiertarka`, `/en/p/drill`, issue #396).

  **Upgrade note for operators: existing sales channels keep their addresses.** The migration
  `Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage` adds the per-channel setting
  _Prefix the default language in URLs_ and switches it **off** on every channel that exists when it
  runs, so default-language URLs stay unprefixed; channels created later start **on**. To adopt
  prefixes for the default language too, switch _Prefix the default language in URLs_ on in
  _Sales channels_ → the channel. Other languages are prefixed either way: a former
  `/p/<key>?lang=<L>` link answers a permanent redirect to `/<prefix>/p/<key>`. A CMS page whose slug
  starts with a channel language prefix can no longer be saved.

  `@endora-commerce/contracts`:

  - New: `channelUrlLanguages`, `channelUrlLanguageAliases`, `storefrontPagePath`,
    `storefrontPagePathFor`, `storefrontDefaultPath`, `channelUrlLanguageSchema`,
    `channelUrlLanguageAliasSchema`, `URL_LANGUAGE_PREFIX_PATTERN`, types `ChannelUrlFacts`,
    `ChannelUrlLanguage`, `ChannelUrlLanguageAlias`; `productDefaultPath(key)`.
  - **`productPath` takes the channel's URL facts and never appends `?lang=`:**
    `productPath({ key, languageCode, channelDefaultLanguage })` (`/p/drill?lang=en-US`) becomes
    `productPath({ key, languageCode, channel })` (`/en/p/drill`), where `channel` is any
    `{ languages, defaultLanguage, prefixDefaultLanguage }` — the cached channel satisfies it.
  - `productKeyResolutionSchema`'s `redirect` requires `permanent` (`false` for a key of another
    channel language, answered 307); `productPagePathsSchema` requires `xDefault`.
  - Sales channel shapes carry `prefixDefaultLanguage` (create defaults to `true`); the public
    channel read answers `prefixDefaultLanguage`, `urlLanguages` and `urlLanguageAliases`.
  - `cmsPageUrl` (163 R24) takes the channel's URL facts and composes the prefixed path:
    `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` (`/about-us?lang=en-US`) becomes
    `cmsPageUrl({ path, languageCode, channel })` (`/en/about-us`). The resolved CMS page's `url` and
    `alternates`, and the storefront page index, therefore carry each language's own slug under its
    prefix.
  - `CmsPageRecord` gains optional `languages` and `translations` (the `seo` sitemap lists each
    language at its own slug); `cmsPageSummarySchema` gains an optional
    `shadowedByLanguagePrefix` (any of the page's slugs, per-language ones included).

  Emitters (catalog, seo sitemap, product feeds, organizations, customers, newsletter, comparisons,
  mfa, invoices) compose prefixed storefront URLs; the product feed `link` uses the product's key in
  the feed language; the invoice e-mail links the storefront order page; the admin password reset
  links `/password-reset/confirm`. `cms-components` localizes block links through the render
  context's `localizePath`.

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

- bd7968e: Every sidebar screen of these eight modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords. Each action carries the permission code of the screen it opens, so the palette never offers a screen the operator is refused.

  - `@endora-commerce/mod-catalog` declares `open-attribute-sets`, `open-attachment-types` and `open-bulk-operations` (`catalog:read`).
  - `@endora-commerce/mod-crm` declares `open-crm-tags` and `open-crm-workflow` (`crm:configure`).
  - `@endora-commerce/mod-inventory` declares `open-warehouses`, `open-low-stock` and `open-stock-notifications` (`inventory:read`), and `import-stock` (`inventory:write`).
  - `@endora-commerce/mod-newsletter` declares `open-newsletter-tags` and `open-newsletter-blocks` (`newsletter:read`), and `open-newsletter-provider` (`newsletter:write`).
  - `@endora-commerce/mod-orders` declares `new-order` for the order-entry form (`orders:write`).
  - `@endora-commerce/mod-projects` declares `open-project-roles` and `open-project-loss-reasons` (`projects:configure`).
  - `@endora-commerce/mod-promotions` declares `open-promotion-rules` (`promotions:read`).
  - `@endora-commerce/mod-settings` declares `open-setting-groups` (`settings:read`) and `clear-cache` (`settings:write`).

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
  - @endora-commerce/mod-credentials@0.109.0

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
  - @endora-commerce/mod-credentials@0.108.0

## 0.107.0

### Patch Changes

- 248a9df: The cache-clear namespace list names the sales-channel cache's current key prefix
  (`sales-channels:v3:*`).
- 53b3482: The Quote Request expiry sweep holds each request to `quote_requests.expiry_days` resolved for its own sales channel. It read the default channel's value and applied it to requests of every channel, so a channel set to `0` was not exempt and a channel with its own number of days was held to the default's. A request with no channel is held to the default channel's value, as before, and the `expired` history entry records the value that applied.

  **On upgrading:** a channel that already has its own value starts following it on the sweep's first runs. A channel with a lower value than the default expires its backlog of requests that have been quiet that long, and a channel set to `0` stops expiring. Read the per-channel values of _Auto-expire pending after (days)_ before upgrading if that matters.

  `@endora-commerce/mod-settings`: the setting's help text says so in English and Polish.

- 9dc6a06: The Settings screen no longer shows one sales channel's values under another channel's heading. A settings list that was still loading when the administrator changed "Editing for" (after a reset, a save or a conflict refresh) used to re-baseline every unedited row with the previously selected context when it arrived — a channel override could appear empty, or show the "All channels" text, and could be edited and saved under the wrong channel. The response is now read in the context selected when it arrives.
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
  - @endora-commerce/mod-credentials@0.107.0

## 0.106.0

### Minor Changes

- fc23f9e: An operator can add rules to a sales channel's `robots.txt`: **Settings → SEO → Custom robots.txt instructions**.

  The text is appended to the rules the storefront generates itself — after them, separated by one
  blank line — for all sales channels or per channel. The generated rules (the closed address
  families and the `Sitemap:` line) are unchanged and cannot be edited or removed from the Settings
  screen. With no text, `robots.txt` is byte for byte what it was. Resetting the setting removes the
  text. A saved change is served within about two minutes.

  The text is served as written: every character is kept, in order. Two things about line breaks
  are made uniform — every line break is served as a line feed (`LF`), whether it was saved as `LF`,
  `CRLF` or `CR`, and the file ends with exactly one — and one byte order mark (`U+FEFF`) at the
  very start of the text is not served, because a crawler does not recognise the line it is
  attached to. Nothing in the text is validated.

  The generated lines cannot be changed, but their effect on one crawler can: a group written for a
  crawler by name replaces the `*` group for that crawler. Repeat the generated rules in such a
  group if they should still apply to it. Indexing does not depend on it — the pages those rules
  close declare `noindex` themselves.

  **`robots.txt` does not take pages out of search results.** It controls what a crawler may fetch.
  To keep a storefront out of search use _Default robots_ = `NOINDEX`, and do not add `Disallow: /`
  on top of it: a crawler that may not fetch a page never reads its `noindex`. The setting's
  description says so, in English and in Polish.

  A text may be at most **64 KiB** (65 536 bytes of UTF-8). A larger one is refused when saved, with
  `400` `SEO_CRAWLER_TEXT_TOO_LARGE` and a message naming the limit, and the stored text is kept.

  **`/robots.txt` on the reference storefront is no longer a build-time file.** It is rendered per
  request, for the request's sales channel:

  - `200` with the generated rules and the channel's text; `Content-Type: text/plain; charset=utf-8`,
    `Cache-Control: public, max-age=60`, `Vary: X-Sales-Channel`, `X-Endora-Crawler-Files: 1`. Before,
    the file was prerendered and sent with `Cache-Control: public, max-age=0, must-revalidate` and
    `Content-Type: text/plain`;
  - the generated rules alone while the `seo` module is switched off, and against a backend that
    does not have this feature;
  - **`503` with `Retry-After: 120`** when the channel's text cannot be read and the storefront
    process has never read it — rather than a file that silently omits the operator's rules. A
    process that has read the text once goes on serving that version for as long as the backend
    cannot be reached. A storefront started while its backend is down therefore answers
    `robots.txt` with `503` until the backend is back; pages are unaffected;
  - `GET /robots.txt?part=system` answers the generated rules alone, without the route asking the
    backend, and is sent with `Cache-Control: no-store`.

  **If a reverse proxy or a CDN stands in front of a storefront that serves more than one sales
  channel**, check two things, because the file now differs per channel and the channel is named by
  the `X-Sales-Channel` request header: the proxy must set that header itself, per host, and not
  pass through a value a visitor sent; and a shared cache that ignores `Vary` on such a header must
  include it in its cache key or not cache `/robots.txt`. In nginx that is one line in the
  storefront's `location` block — `proxy_set_header X-Sales-Channel "<this host's channel code>";`
  for a multi-channel deployment, or `proxy_set_header X-Sales-Channel "";` to drop the header on a
  single-channel one, which is otherwise unaffected. The `nginx.example.conf` an instance was
  scaffolded with does not carry the line; this repository's `deploy/nginx.example.conf` now shows
  both, commented.

  The origin in the `Sitemap:` line is still `NEXT_PUBLIC_SITE_URL` as inlined at build time.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the multi-line setting `seo.robots_txt_custom` (default
    empty) with its name and description in `en` and `pl`; serves the public, channel-resolved
    `GET /api/v1/storefront/seo/crawler-files`
    (`{ "data": { "index", "follow", "robotsTxtCustom", "llmsTxtAdditional", "shop": { "name" } } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    an empty text — when a stored value cannot be served); and declares the error code
    `SEO_CRAWLER_TEXT_TOO_LARGE`. `llmsTxtAdditional` is always `""` in this release.
  - `@endora-commerce/contracts` exports `storefrontCrawlerFilesSchema`,
    `storefrontCrawlerFilesResponseSchema`, the types `StorefrontCrawlerFiles` and
    `StorefrontCrawlerFilesResponse`, `composeCrawlerFile(base, extra)` (the join described above),
    `CRAWLER_TEXT_MAX_BYTES` and `ERROR_CODES.SEO_CRAWLER_TEXT_TOO_LARGE`. The schemas drop members
    they do not know.
  - `@endora-commerce/contracts` and `@endora-commerce/mod-settings`: `SettingWriteValidationInput`
    gains **`proposedValue`** — the value a settings write proposes, beside the per-channel
    projection it already carried. An all-channels write reaches no channel that has a value of its
    own, so on an instance where every channel has one the proposed value was in no channel's
    projection, and a validator whose rule is about the value itself could not see it. A module that
    contributes a `SettingWriteValidator` needs no change; code that _constructs_ a
    `SettingWriteValidationInput` (a test calling a validator directly) must now supply the member.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes serves `robots.txt`
    as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting**: its `robots.txt` stays the file it was built with, and the Settings screen shows a text
  nothing serves. To take the feature, apply these changes from the reference storefront to the
  storefront project, keeping any edits of your own:

  - **delete** `app/robots.ts`. It must go, and nothing will tell you if it has not: with both it
    and `app/robots.txt/route.ts` present, Next builds without a warning, goes on serving the old
    build-time file and never reaches the new route. The build's route list shows which one won —
    `○ /robots.txt` is the old file, `ƒ /robots.txt` is the new route;
  - **add** `app/robots.txt/route.ts` — the route;
  - **add** `lib/seo/robots-txt.ts` — what the route answers, and when it answers `503`;
  - **add** `lib/seo/robots-system-rules.ts` — the generated rules, moved out of `app/robots.ts`
    unchanged. **If you edited the `disallow` list in your `app/robots.ts`, carry your edits into
    `ROBOTS_SYSTEM_RULES` here**;
  - **replace** `lib/seo/crawler-policy.ts` with the new version. It now reads the crawler files as
    well as the default robots policy, and gives up a backend read that a frozen process left
    hanging instead of waiting on it for ever. If the project does not have this file yet, it has
    not taken the _Default robots_ feature either — add the file, and see that release's notes for
    `middleware.ts` and `app/layout.tsx`;
  - **edit** `app/reserved-segments.ts`: add `'robots.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - in `test/seo/route-declarations.test.ts`, if you copied it, replace the import of
    `'../../app/robots'` with `ROBOTS_SYSTEM_RULES` and `robotsSitemapUrl` from
    `'../../lib/seo/robots-system-rules'`, as the reference's version does.

  `lib/seo/robots-txt.ts` imports `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so
  **the storefront project needs `@endora-commerce/contracts` at this release or later** — unlike
  the _Default robots_ files, which needed no upgrade. `middleware.ts` and `app/layout.tsx` do not
  change in this release. Then rebuild the storefront;
  `curl -sI https://<your shop>/robots.txt | grep -i x-endora-crawler-files` shows the header once
  the new route is serving.

  The reference storefront's tests for these files (`test/seo/robots-system-rules.test.ts` with its
  fixture `test/seo/__fixtures__/robots-before.txt`, `test/seo/robots-txt-route.test.ts` and the
  additions to `test/seo/crawler-policy.test.ts`) are optional to copy. The fixture is the
  reference's own generated rules with `http://localhost:3000` as the origin; a project that edited
  its list edits the fixture to match.

- 9dd3b81: A `string` setting can be declared multi-line, and the Settings screen then edits it in a multi-line field that keeps line breaks exactly.

  **For a module author.** Add `multiline: true` to the setting's entry in the module's settings
  manifest:

  ```ts
  defineModuleSettingsManifest({
    moduleCode: 'your_module',
    settings: [
      {
        code: 'your_module.footer_note',
        name: 'Footer note',
        valueType: 'string',
        defaultValue: '',
        multiline: true,
      },
    ],
  });
  ```

  Nothing else changes: the value is still a `string`, is read through `SettingsService.get` as
  before, and resolves per sales channel like every other setting. What is typed is what is stored —
  line breaks, blank lines, indentation and a trailing line break included.

  `SettingManifestEntrySchema` accepts `multiline` only on `valueType: 'string'` and not together with
  `enumOptions`; any other combination fails when the manifest is parsed, with the issue on
  `multiline`. The flag is presentation, kept in step with the manifest by `ManifestReconciler` on
  every boot in both directions, so adding or removing it later is not a breaking change and never
  touches a stored value. `SettingDtoSchema` gains an optional `multiline: boolean`, which
  `GET /api/v1/admin/settings` and `GET /api/v1/admin/settings/:code` now always send — read it if
  your module renders its own editor for a setting.

  **For an operator upgrading.** This release carries one platform migration,
  `Migration20261011T135250CoreSettingsMultiline`, which adds `settings.multiline boolean not null
default false`. It rewrites no row and needs no backfill. It is one of the platform's own
  migrations, so an instance receives it with `@endora-commerce/platform` and `pnpm run upgrade
<version>` applies it with the release's other migrations. Every existing setting stays single-line,
  so the Settings screen looks and behaves exactly as it did until a module you install declares the
  flag.

  Take the migration back only together with the packages. `down` drops the column and loses nothing
  but the flag, which the next boot of a release that has it would restore — but this release's code
  expects the column: over a database without it, a new setting cannot be registered and a declared
  `multiline` cannot be stored, and the instance fails at boot. Reverting the migration is safe as
  part of downgrading `@endora-commerce/platform` and `@endora-commerce/mod-settings` to the previous
  version, and not on its own.

  The Settings screen also names the multi-line field after the setting for assistive technology, and
  the line under it that previews the default and current value shows one shortened line for such a
  setting rather than the whole text.

- be99bb5: The Settings screen previews the `robots.txt` a sales channel's storefront serves, and a module can now contribute beside a setting it declared.

  **For an operator.** Below **Settings → SEO → Custom robots.txt instructions** there is now a
  preview of the file the selected sales channel's storefront serves, as **one block that is the
  file**: the lines the storefront generates, labelled read-only, then a blank line, then your own
  lines, marked with a bar and a label. With nothing unsaved the heading reads _robots.txt as served
  now_. As you type, the block follows the field and the heading becomes _robots.txt after saving_ —
  the file the storefront will serve once you save; until then it keeps serving the previous version.
  Under **All channels** you pick the channel to preview, and the preview names the channels that
  have a value of their own and are therefore not affected. On a channel whose _Default robots_ is
  `NOINDEX` it says that `robots.txt` stays open on purpose, and warns when your text forbids every
  crawler to fetch anything. An administrator who may read settings but not change them sees it too,
  and one who may not list sales channels is shown the system default channel. Nothing the storefront
  serves changes when you preview.

  The setting's description above the field is shorter: the preview now shows what the description
  used to explain.

  The generated rules are not copied into the backend or the Admin UI: each time, the backend asks
  the channel's storefront for them. So **the storefront must be reachable from the backend at the
  address the channel is configured with** — the channel's **Storefront URL** setting, else
  `STOREFRONT_BASE_URL`. When it is not, the preview says so and shows your text on its own; saving is
  never blocked. The three messages and what to do about each:

  - _The storefront could not be reached_ — no answer within three seconds, a refused connection,
    an error, a redirect, or an answer that is not a plain-text file. Check that the storefront runs
    and that the configured address is the one it answers at itself. The server log line
    `seo: the crawler-file preview could not show the storefront’s part` carries the reason.
  - _This sales channel has no storefront address configured_ — set **Storefront URL** for the
    channel, or `STOREFRONT_BASE_URL`.
  - _This storefront did not confirm that it supports custom instructions_ — it answered without the
    `X-Endora-Crawler-Files` header. Usually the storefront was scaffolded from a release before these
    settings existed: it serves only its generated rules and ignores both the custom instructions and
    _Default robots_. A proxy that strips the header, or a storefront updated only in part, looks the
    same. A matching notice now appears on the _Default robots_ row, so a shop is not believed to be
    out of search while its storefront may be ignoring the setting. Update the storefront's files as
    the notes of the release that introduced those settings list, and check that the header arrives.

  What the backend sends is one request per preview: `GET <origin>/robots.txt?part=system`, to the
  origin of the configured address only, with the channel's code in `X-Sales-Channel`. It follows no
  redirect, waits at most three seconds, reads at most 512 KiB, accepts only `text/plain`, sends no
  cookie or credentials, and stores nothing. A path or query in the configured address is not used.
  Private and loopback addresses are **not** refused, because an instance's own storefront is
  routinely reached at one; who may point a channel at an address is whoever holds `settings:write`,
  as before.

  No migration, no new setting, no new environment variable, no new permission.

  **For a module author: `settings.setting.after`.** `AdminZoneNameSchema` has a new member, mounted
  by the Settings screen once per setting row, below the field. Contribute to it to show what a
  setting you declared amounts to — a preview, a consequence, a warning:

  ```ts
  import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

  export const contributions: AdminContributions = {
    zones: [
      zoneComponent('settings.setting.after', () => import('./zones/FooterNotePreview.js'), {
        match: { settingCode: 'your_module.footer_note' },
        requiredPermission: 'settings:read',
      }),
    ],
  };
  ```

  The component receives `SettingsSettingAfterZoneProps`: `settingCode`, `ownerModule`,
  `channelCode` (the sales channel being edited, or `null` for the all-channels value), `draftText`
  (the text in the field **now**, saved or not, for a `string` setting; `null` for every other value
  type) and `dirty`. Narrow with `match` on `settingCode` or `ownerModule` — an unmatched
  contribution's chunk is never fetched. The props go one way: a contribution cannot change the
  value or hold up the row's save, and it should say in words when what it shows is not saved yet.
  The zone is not mounted for a `secret` setting, so a contribution never receives a secret's draft.
  A contribution vanishes with its module, and a failing one does not take the row with it.

  **If you render `SettingRowEditor` yourself.** `@endora-commerce/mod-settings`' row editor now
  mounts a zone, so it must be rendered under `AdminContributionsProvider` and the session
  providers, as every host screen that mounts a zone is. The Admin UI already does; a test that
  renders the row or `SettingsPage` on its own needs the providers around it.

  **In `@endora-commerce/contracts`.** New: `adminCrawlerFilePreviewQuerySchema`,
  `adminCrawlerFilePreviewResponseSchema`, `adminCrawlerFilePreviewSchema`,
  `adminCrawlerFilePreviewStateSchema`, `adminCrawlerFileSchema`, their inferred types, and
  `CRAWLER_FILES_CAPABILITY_HEADER` (`X-Endora-Crawler-Files`) — the response header by which a
  storefront says it serves crawler files the current way. A custom storefront that implements
  `?part=system` should send it; without it the preview treats the storefront as outdated. The
  endpoint is `GET /api/v1/admin/seo/crawler-files/preview?file=robots&salesChannelCode=<code>`,
  gated by `settings:read`. `salesChannelCode` is optional and means the system default channel; the
  answer names the channel it is about. `file=llms` is declared in the schema and answers `400` until
  `llms.txt` is served.

  `@endora-commerce/mod-seo` now declares `lucide-react` as an optional peer dependency, as the other
  module packages with an admin surface do; an application that has the Admin UI already has it.

  **In `@endora-commerce/cli`: `check:channel-resolution` no longer reports a header that is sent.**
  The rule's first signal flags every `x-sales-channel` string literal, because a module must not
  read that header from a request — the resolver does. A module that makes a request of its own to
  another server and names the sales channel in it was reported as well. The key of an object literal
  under a `headers:` property — `fetch(url, { headers: { 'X-Sales-Channel': channel.code } })` — is
  now exempt, as a CORS policy's `allowedHeaders` array already was. What stays reported: an
  element access on a headers object, a `.get(...)` argument, the name held in a constant, a
  computed key, a destructuring declaration, and a destructuring _assignment_
  (`({ headers: { 'x-sales-channel': code } } = request)`, also as the variable of a `for…of` or
  `for…in`), which has the exempted shape and is refused by its position.

- 35c7a72: A module can now translate the names and descriptions of its own settings on the admin Settings screen.

  The screen used to show the `name` and `description` a settings manifest declares, in English, whatever
  language the administrator works in. It now looks in the **owning module's own bundle** first, under
  three key families, and falls back to the declared string when a key is absent:

  | Key                                        | Replaces                    |
  | ------------------------------------------ | --------------------------- |
  | `settingLabels.<setting code>.name`        | the setting's `name`        |
  | `settingLabels.<setting code>.description` | the setting's `description` |
  | `settingGroups.<group code>.name`          | the group's `name`          |

  The code is written whole, dots included, and the keys are flat like every other key in a bundle. For a
  module `your_module` that declares the setting `your_module.base_url` in the group `your_section`, add to
  `i18n/pl.json` (and the English wording to `i18n/en.json`):

  ```json
  {
    "settingGroups.your_section.name": "Twoja sekcja",
    "settingLabels.your_module.base_url.name": "Bazowy adres URL",
    "settingLabels.your_module.base_url.description": "Adres, pod którym usługa jest dostępna."
  }
  ```

  Resolution is per key — the administrator's language, then English, then the manifest string — so
  settings can be translated one at a time. Only the bundle of the module whose settings manifest declared
  the row is read (its `moduleCode`, which has to equal the module `id`); a key for another module's
  setting is ignored. The text is shown as written, with no parameter substitution. The choices of an
  `enumOptions` setting are stored values and stay untranslated.

  The filter on the Settings screen matches the translated name and description as well as the declared
  ones.

  **Nothing changes for an operator until a module ships these keys.** This release adds the lookup only;
  no existing setting is translated by it, and a module that adds no key renders exactly as before. The
  manifest `name` and `description` stay required: they are what the API returns and the last fallback.

### Patch Changes

- e3b74a6: The audit trail of a setting-value change now records the value before the change as well as the value after it.

  Until now `setting.global_value_set` and `setting.value_set` carried `stateAfter` only, and the two resets (`setting.global_value_reset`, `setting.value_reset`) recorded that a value was removed without recording which. Each of the four now also carries `stateBefore`:

  ```json
  {
    "settingCode": "your_module.base_url",
    "value": "https://old.example",
    "valueType": "string",
    "stored": true
  }
  ```

  plus `salesChannelId` on the two per-channel actions. The audit log viewer already renders `stateBefore` beside `stateAfter`, so the previous value appears there with no further change.

  **What `value` is.** The value **stored** at the level being written — the all-channels value for an all-channels write or reset, that channel's own value for a per-channel one. It is not the value the channel resolved to, which keeps it on the same footing as `stateAfter`: a first write records `"value": null, "stored": false`, not the manifest default and not an inherited all-channels value. `stored` is what separates "nothing was stored" from a stored `null`, which a `json` setting may legitimately hold.

  **Secrets.** A `secret` setting's previous value is recorded as `"[redacted]"`, exactly as its new value already was — neither the plaintext nor the stored ciphertext reaches the audit trail. A `credential_ref` records the configuration code on both sides, as before.

  Nothing about the write itself changes, `stateAfter` keeps its shape, a refused write still records nothing, and there is no migration: `audit_log_entries.state_before` already existed. Entries written before this release keep an empty before-state.

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0
  - @endora-commerce/mod-credentials@0.106.0

## 0.105.0

### Minor Changes

- ab6a417: `400 SETTING_VALUE_SHAPE_MISMATCH` says what the setting accepts. Two refusals share the code — a
  value of the wrong type, and a value an enumerated setting does not offer — and both were answered
  with "Setting value does not match the required shape.", while the messages that sentence replaced
  named the expected type and listed the options.

  Each refusal now names itself in `details.code` and has its own sentence, in English and Polish:

  - `wrong_type` — `details.settingCode`, `details.valueType`: "The value of "inventory.threshold"
    must be of type "number"."
  - `not_an_option` — `details.settingCode`, `details.allowedValues` (the options joined with ", "),
    `details.enumOptions` (the same options as an array): "The value of "pricing.display_mode" must
    be one of: gross_only, net_only, both, none."

  **One shape changes for a client that read `details`.** The wrong-type refusal used to answer
  `details` as a bare array of `{ path, issue }`; that array is now `details.issues`, inside the
  object that carries the fields above. The option refusal used to carry no `details` at all. The
  code and the status are unchanged.

### Patch Changes

- 5d27c85: The Quote Requests settings tab says what the auto-expiry setting does when it is turned on.

  The help under "Auto-expire pending after (days)" now says, in English and Polish, that the rule
  counts days without activity, that an offer whose validity date is still ahead is never expired by
  it, that turning it on or lowering it expires every open request already inactive that long, and
  that the default sales channel's value applies to all channels.

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
  - @endora-commerce/mod-credentials@0.105.0

## 0.104.0

### Patch Changes

- 5e2ade8: Saving content in the Admin UI now reaches the storefront on the next request. Until now a saved CMS
  page, block, template or hook — and an edited megamenu — appeared only after the storefront's own
  60-second cache window, and the **Cache** screen could not shorten that: it cleared Redis, which the
  save had already done, and never told the storefront.

  - **`@endora-commerce/contracts`** exports the cache-tag vocabulary both sides must spell alike:
    `CMS_STOREFRONT_CACHE_TAGS`, `MEGAMENU_STOREFRONT_CACHE_TAG`, the event name
    `CMS_CONTENT_CHANGED_EVENT` (`cms.content_changed.v1`) and its payload type `CmsContentChange`.
    The tag strings are the ones the storefront already used, with one addition: the published-page
    index (the sitemap's source) is tagged `cms:page-index` instead of `cms:page`.
  - **`@endora-commerce/mod-cms`** publishes `cms.content_changed.v1` on the EventBus after every page,
    block, template and hook write has committed, and answers it by posting the matching tags to the
    storefront's `/api/revalidate`. A block save now also drops the cached hooks that inline that
    block, which it did not before.
  - **`@endora-commerce/mod-megamenu`** revalidates the `megamenu` tag on every menu write, and
    subscribes to `cms.content_changed.v1` so a saved block or page drops the menus that embed or link
    to it.
  - **`@endora-commerce/mod-blog`** drops its cache when a category is created and when a tag is
    renamed without a code change; both used to leave the old listing in place for five minutes.
  - **`@endora-commerce/mod-settings`** — clearing the `cms` or `megamenu` namespace on the Cache
    screen, or with `settings cache-clear`, now revalidates the storefront's copy too.

  Nothing to configure beyond what an instance already sets: revalidation runs when
  `STOREFRONT_BASE_URL` and `REVALIDATE_SECRET` are present on the backend and the same secret is on
  the storefront, is skipped otherwise, and never fails a save when the storefront cannot be reached.

  **An existing storefront tree** keeps working — its tags are the same strings — with one exception
  worth taking: change the tag on its `getCmsPageIndex` fetch from `cms:page` to
  `CMS_STOREFRONT_CACHE_TAGS.pageIndex`, or a newly published page reaches `sitemap.xml` only when the
  60-second window runs out.

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
  - @endora-commerce/mod-credentials@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/mod-credentials@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [c13dc4f]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/mod-credentials@0.103.0
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
- 489a0b6: Documentation: the Settings page now describes how settings are actually registered and
  removed. A module declares its settings manifest as the `settings` field of its module
  manifest; there is no array in `backend/src/composition.ts` to append to. The CLI section named
  `modules:install` / `modules:uninstall`, which do not exist, with an `--force` flag that
  `module:install` refuses; it now documents `module:install <id> [--dry-run] [--json]` and
  `module:uninstall <id> [--hard --force] [--json]`, and that `--remove-settings` /
  `--preserve-settings` survive only as aliases. The reconciler table no longer says a changed
  `valueType` or `defaultValue` can be forced through, and the value-type list now includes
  `secret` and `credential_ref`.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/mod-credentials@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/mod-credentials@0.101.1
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
  - @endora-commerce/mod-credentials@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-credentials@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/mod-credentials@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0
  - @endora-commerce/mod-credentials@0.9.8

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
  - @endora-commerce/mod-credentials@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/mod-credentials@0.9.6
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
  - @endora-commerce/mod-credentials@0.9.5
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
  - @endora-commerce/mod-credentials@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/mod-credentials@0.9.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-credentials@0.9.2

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
  - @endora-commerce/mod-credentials@0.9.1
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
  - @endora-commerce/mod-credentials@0.9.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-credentials@0.8.2
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

### Patch Changes

- a71344d: `endora new instance` writes the admin member, and `endora generate` renders what it is built from.

  **`@endora-commerce/cli`** — two new surfaces and one moved one.
  - `endora generate` is a new command. Run anywhere inside a scaffolded instance, it renders the
    admin contribution registry and the admin stylesheet enumeration over the module packages that
    instance installed, and reports every candidate the discovery excluded. Programmatically:
    `runGenerate({ cwd, dryRun })`, with `generateReport`, `findInstanceRoot`, `artefactIsCurrent`,
    `GenerateInputError` (exit 1) and `GenerateHostError` (exit 2).
  - `endora new instance` now writes `admin/` — `package.json`, `tsconfig.json`, `index.html`,
    `vite.config.ts`, `src/main.tsx` and `src/index.css` — and the workspace, the root scripts and
    the `.gitignore` follow. The member is still omitted, in the same grammar, when
    `@endora-commerce/admin-shell` or `@endora-commerce/admin-kit` does not resolve, or when a range
    one of them should have declared is not there; the omission now names which.
  - `@endora-commerce/cli/lib/admin-artefacts.js` and `@endora-commerce/cli/lib/tailwind-sources.js`
    are new module specifiers. They hold the two artefacts' renderer, which this repository's
    `composer:generate` and a client's `endora generate` now share; the emitted bytes are unchanged.

  **`@endora-commerce/admin-shell`** — `AdminRoot` is a new export: the four wrappers `App` has to be
  mounted inside, which a project used to have to reproduce. Three of the four are this package's
  requirements rather than the project's, `unstable_useTransitions={false}` most of all — without it
  every module screen's URL changes and the outlet does not, with no error anywhere. `App`,
  `AuthProvider` and `registerAdminServiceWorker` are unchanged and still exported.

  The package now declares `vite`, `@vitejs/plugin-react`, `tailwindcss` and `@tailwindcss/vite` as
  **optional** peer dependencies. Nothing is required of an existing consumer that already has them;
  what they add is a statement, readable by a tool, of what kind of application a host that mounts
  this shell is.

  **`@endora-commerce/mod-settings`** — `ConfigurationReferenceInput` loads
  `@endora-commerce/mod-credentials`' preview modal lazily. `credentials` is an optional peer, so an
  admin bundle built in a tree that did not install it previously failed at build time on a named
  import of an unresolved stub, taking every module's screens with it over one button. The render was
  already gated on the module's presence and is unchanged.

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
  - @endora-commerce/mod-credentials@0.8.1
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
  - @endora-commerce/mod-credentials@0.8.0

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

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

### Patch Changes

- f563590: `settings` declares the ten error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  Nine of the ten already carry a written sentence in both `en` and `pl` in this
  package's own `i18n/` bundles, and those nine are exactly the `errors.*` keys
  those bundles hold, so no sentence moves and none is added.
  `SETTING_SECRET_KEY_MISSING` is an `UNTRANSLATED_ERROR_CODES` entry today and
  stays one.

  No `tokens`: all seventeen raise sites of these ten codes were read across
  `packages` and `backend/src`, and none passes a `details.code` discriminator —
  the two that pass a fourth argument at all pass the Zod-style
  `Array<{path, issue}>`, which the envelope ignores by construction.

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
- Updated dependencies [baba4c6]
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
- Updated dependencies [73da94f]
- Updated dependencies [ad62954]
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
  - @endora-commerce/mod-credentials@0.7.0
  - @endora-commerce/platform@0.7.0
