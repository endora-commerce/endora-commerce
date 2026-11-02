# @endora-commerce/mod-megamenu

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

### Patch Changes

- 4bc5c7f: Every asset reference these modules report is tagged with the `assetId` it points at, and each descriptor answers a batch of assets in one statement (`specs/166-asset-reference-visibility/`). The catalog's category content, CMS content and blog content scans used to run one JSON-path query per asset; each is now one query per batch, walking a document once however many assets are asked. Their references stay unrestricted: they never hide a library file.
- 91dfab5: Linking an existing library file by id refuses a file the administrator may not see in the library exactly as a missing one, and links nothing (`specs/166-asset-reference-visibility/` FR-006). This covers a product's gallery item, attachment and download file (on create), a category's main image, a blog post's and a blog category's main image, and a menu item's asset target and icon. Before, these links made such a file visible to every library reader. A file id that names no file now answers `404 NOT_FOUND` for the product download, the category image and the blog images, where it used to fail with a server error; the menu keeps its `400 MEGAMENU_ASSET_KIND_MISMATCH`.
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
- 489a0b6: Documentation: two pages said their wiring was done in `composition.ts`. The megamenu module
  registers its CMS and asset reference scanners in its own boot hook, and the promotions gate on
  organization status is a required `PromotionService` argument that the `promotions` module wires
  to `organizationReadPort.loadEffectiveOrganization`, not a raw SQL lookup.
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

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
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

- 4eeb5cd: `cms` publishes `CmsBlockReadPort`, and `megamenu` resolves its own cross-module targets.

  **New on `@endora-commerce/contracts`:** `CmsBlockReadPort`, `CmsBlockRecord` and
  `CmsLocalizedBlockRecord`. Two methods, which is the whole of the demand.
  `findById(id)` answers _does this block exist_ and carries `active` on the record
  rather than filtering on it, because the two callers disagree about a deactivated
  block on purpose. `findLocalizedById(id, language)` answers _what does it render as
  here_ and is the reason the port exists: the per-language envelope —
  `content.languages[<code>]`, a legacy `schema_version` riding along, an absent key
  meaning "nothing authored" — is `cms`' storage layout, and a consumer that had to
  know it would be reading the column with extra steps. `null` covers all three
  absences, because a caller inlining a block has the same thing to do in each.

  **New on `@endora-commerce/mod-cms`:** the port is registered as `cmsBlockReadPort`
  with `ctx.di.providePort`, so it fails closed with 503 `MODULE_DISABLED` when an
  operator switches the CMS off. Nothing else changed in this package.

  **Removed from `@endora-commerce/mod-megamenu/backend`: `TargetValidatorDeps` and
  `StorefrontDeps`.** Both existed so a composition root could write eight closures
  against them — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
  the storefront URL shapes — and this module's own barrel argued they had to stay in
  a root until one of the three owners grew an existence-check port. All three have:
  `catalogCategoryReadPort`, `cmsPageReadPort` and `assetReadPort` came out of feature
  075, and `cmsBlockReadPort` above is the one that was still missing. The module now
  resolves those four plus `assetsLibraryPort` with `lazyPort` and declares the edges
  in its manifest, where `catalog` joins `cms`, `assets_library`, `languages`,
  `sales_channels`, `auth` and `dictionaries`.

  **If you contributed `megamenuValidatorDeps` or `megamenuStorefrontDeps`**, delete
  both contributions: the container names are read by nobody and registering them now
  does nothing. There is no replacement to write, and the interfaces are deleted
  rather than relocated — what replaces them is module-private and holds no closure.
  Make sure the composition registers the five ports, which it does by composing
  `catalog`, `cms` and `assets_library`.

  Two behaviours were divergent between the reference deployment and the test harness
  and are now single-valued, both settling on the deployment's answer: a category
  target resolves to `/c/<slug>` (the harness built `/catalog/<slug>`, which the
  reference storefront serves from nowhere), and a deactivated or soft-deleted
  category drops its menu item and its children (the harness narrowed on neither).
  A CMS page target is deliberately _not_ narrowed on status or `active`, which is
  what both roots did.

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

- b13810a: Both manifests declare `demo: false`.

  It records a decision rather than adding a capability: neither module has demo data of its own.
  The demo shop's megamenu mirrors another module's demo category tree and binds to the demo sales
  channels, and the demo's prices are a backfill over another module's demo products into this
  module's default list. Each is more than one module's rows in one step, so each belongs to the
  instance's own demo composition and to no module.

  **If you read `manifest.demo`**, these two now answer `false` where they answered `undefined`.
  The two are deliberately different states: `false` is a decision that the module owes nothing,
  `undefined` is a module nobody has looked at yet.

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

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

- 94e8f3f: Publish `OrganizationTreeService`, `TargetValidatorDeps` and `StorefrontDeps`
  from each package's `./backend` subpath.

  The composition root contributes these shapes and must name their types. It
  reached the source files by relative path, which is `TS6059` under the
  backend's build `rootDir` — even for an `import type`, since a type-only
  import still joins the program — so `pnpm --filter backend run build` was red
  and the production image could not be built.

- efa4111: Six more modules become workspace packages (feature 080, T040b batch five):
  `admin_actions`, `admin_roles`, `admin_users`, `megamenu`, `organizations` and
  `price_lists`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the fifty-three packages before them.

  **`@endora-commerce/mod-organizations` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `PersonalOrganizationProvisionApi` and `PersonalOrganizationProvisionInput`
  instead of reaching into the owner's directory.

  ```ts
  import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
  ```

  The implementation stays behind the container name
  `personalOrganizationProvisionPort`, resolved with `lazyPort`, so the gate that
  answers 503 `MODULE_DISABLED` when `organizations` is switched off is still the
  registration and not a call anyone has to remember to write.

  **Three packages publish a runtime binding by name, beside the `entities`
  array.** D-168 keeps entity classes off `./backend`; these are not entities, and
  each is exported because a host program must hold the _same_ copy the platform
  composed rather than a second one evaluated from source (D-160.6.1):
  - `@endora-commerce/mod-admin-roles/backend` — `PermissionCatalogueService`,
    `listAssignablePermissionCodes`, and the inventory scanner
    (`ConstantResolver`, `defaultScanRoots`, `scanEnforcedPermissionCodes`,
    `scanEnforcedPermissionGates`). The acceptance instance probe and
    `check:action-route-permissions` read them.
  - `@endora-commerce/mod-price-lists/backend` — `DefaultPriceListMigrator`,
    `DEFAULT_PRICE_LIST_ID` and `PriceListService`. The development catalog seed
    runs the migrator; a second copy would `em.create` a `PriceList` class the ORM
    never registered, which fails at the first insert rather than at load.

  **Nothing about a module's behaviour changed.** No manifest `dependencies` array
  moved, so the migration order is the same function of the same inputs: the
  committed registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base over all 164
  entries.

### Patch Changes

- 8365d54: `megamenu` declares the ten error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  All ten already carry a written sentence in both `en` and `pl` in this package's
  own `i18n/` bundles, and those ten are exactly the `errors.*` keys those bundles
  hold, so no sentence moves and none is added.

  No `tokens`: all sixteen raise sites of these ten codes were read across
  `packages` and `backend/src`, and every one of them passes three arguments to
  `HttpError` and no fourth at all, so none can carry the `details.code`
  discriminator the envelope reads.

  Two of the ten reach no envelope, and both are reported rather than repaired
  here. `MEGAMENU_DEPTH_EXCEEDED` is a soft, non-blocking warning delivered in
  `meta.warnings` on a **200** (feature 015 FR-011), so it is never thrown.
  `MEGAMENU_REFERENCED` names a refusal this module contributes to — its asset and
  CMS reference scanners do block the upstream delete — but the refusal is
  answered under the deleting module's code, `ASSET_REFERENCED` or
  `CMS_REFERENCED`. Both keep their declarations, because ownership follows the
  frozen capture and this change moves no answer.

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
