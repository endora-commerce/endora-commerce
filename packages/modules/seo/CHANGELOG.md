# @endora-commerce/mod-seo

## 0.109.0

### Minor Changes

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

### Patch Changes

- bdef54c: The product editor's SEO tab ends with a new admin zone, `product.editor.seo.after` (props: the product id). `seo` contributes the link to its meta-tag editor there, shown while `seo` is on and the admin holds `catalog:write`; `catalog` no longer names `seo`. The tab's former "Page title (preview)" input, which saved nothing, is gone.
- 4cb0a7d: Product data scopes — checkpoint C/E/Q review fixes.

  - **Platform:** new `withSystemScopeActingFor(adminUserId, reason, fn)` in `@endora-commerce/platform/tenancy` — a worker's system scope acting for the admin who queued the work, so its Commands are audited with that admin.
  - **Catalog — audit:** a queued bulk Archive / Restore and a queued bulk scoped-status edit audit each product with the admin who requested the operation (it was a null actor). The API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` of an existing product is now the audited `product.update` Command, its entry naming the key (`apiKeyId` in the after-state); it is still never checked by the completeness gate.
  - **Catalog — Archive / Restore** lock the product row, so a concurrent single and bulk Archive transition the product once: one audit entry, one `product.archived.v1`.
  - **Catalog:** a composition that cannot build the completeness gate logs one warning instead of running unchecked silently.
  - **SEO:** the cached sitemaps are marked stale on a change of the global status, archive, visibility or organization list, and on `product.archived.v1`, as they already were on the scoped values and URL keys.
  - **Behaviour change for API clients (contracts, SEO):** an override's `ogImageUrl` must be an `http(s)` URL or a path starting with a single `/` (`ogImageUrlSchema`); `javascript:`, `data:` and other schemes are refused with `400 VALIDATION_FAILED`. The read shape accepts any stored string.
  - **Contracts:** `effectiveOrderRules` and `effectiveKeys` are documented as applying no availability — a buyer-facing caller filters with `filterAvailable` first.

- 62b9a1c: Search, the sitemap and product feeds follow product data scopes per sales channel and language.

  - **Search:** a channel index carries every member that is on in at least one channel language; each document gains `liveLanguages`, `publishFromMs`, `publishUntilMs` and the channel-effective `visibility` and `allowedOrganizationIds` (all filterable). A query filters on the request language, the publication window at query time and the caller's audience, so a page is cut from available hits only; hydration asks `catalog` again for every hit. On the first reindex-scheduler tick after the upgrade (about a minute after start) the worker process makes those fields filterable (and `localizedNames` searchable) on every existing channel index without a reindex, changing a setting only where it is missing, so queries keep using the index; documents indexed before the upgrade are served as before. **Upgrade step:** run one reindex per sales channel (the `search_reindex` bulk operation or the reindex CLI) so the window and per-language filters are exact. `SearchIndexerOptions` requires `availability`; `SearchQueryService` takes the availability port as its sixth argument.
  - **Sitemap:** lists a product when it is available in the channel to an anonymous visitor at generation time — on in a channel language, inside its publication window, admitted by the channel's audience rule — with one URL per live language (`?lang=<code>` outside the channel's default). A product off globally but on in the channel is listed; one switched off in the channel is not.
  - **Product feeds:** the eligibility floor is effective availability at the feed's channel and language for an anonymous reader (scoped status, publication window, channel audience) instead of the global status; the selection preview counts the same set.
  - **Search, effective names:** documents carry `localizedNames.<language>` — the Name shown at the channel in each live language (channel overrides applied) — and a query searches `localizedNames.<request language>` beside the fields it always searched. Should an index still lack `localizedNames` as a searchable field, the query is asked again without that restriction, so search keeps working.

  **Release note — after upgrading:** run one `search_reindex` per sales channel. Until then the window, per-language and effective-name parts of search are approximate (documents indexed before the upgrade are served as before). The storefront listing's name sort now follows the effective name shown in the request's channel and language instead of the product slug, so its order changes for products whose name and slug sort differently; name-sort cursors issued before the upgrade start the list again.

- 9598e15: The SEO screen's meta-tag editor loads a scope as soon as it is selected (Load refreshes it), keeps the channel and language selectors disabled while a request is in flight and ignores an answer for a scope no longer selected, so an override can only be saved to the scope on screen. Switching away from unsaved changes and **Use inherited** now ask first; for a product the editor waits for the product's sales channels. The screen opens with an entity selected when its address carries `?entityType=product&entityId=<id>`, which is where the product editor's SEO link now points; an `entityId` that is not a UUID is ignored, and the editor encodes the id in every request path it builds.
- 4de595c: The SEO meta editor routes (`GET`, `PUT`, `DELETE /api/v1/admin/seo/meta/:entityType/:entityId`) answer `404 NOT_FOUND` for an `entityId` that is not a UUID, where PostgreSQL's refusal used to surface as a 500.
- 1a6c47e: The SEO screen's meta-tag editor addresses a product override by sales channel as well as language: the channel list holds the product's own sales channels, a channel offers its own languages or the whole channel, the effective values say where each one comes from (channel and language, whole channel, language, or the product itself), and **Use inherited** removes the override at exactly the selected scope. The admin meta read answers `sources` beside `resolved`. Categories keep the language rows only.
- a76d6ee: SEO overrides per sales channel and per sales channel × language.

  - Migration `20261025T215911_seo_meta_override_channel_scope.ts` adds `seo_meta_overrides.sales_channel_id`, makes `locale` nullable (at least one of the two is set) and replaces the `(entity_type, entity_id, locale)` unique with one partial unique per scope. Existing rows are language overrides, unchanged.
  - `GET|PUT|DELETE /api/v1/admin/seo/meta/:entityType/:entityId` take an optional `channelId` (query for GET and DELETE, body for PUT) beside `locale`; naming neither is still the `en-US` row. Only a product takes a channel (`422 VALIDATION_FAILED` otherwise); a channel the product is not in, or a language the channel does not offer, is `422 SCOPE_INVALID` on PUT and allowed on DELETE. Each field resolves channel × language → channel → language → derived.
  - Writes are the Commands `seo_meta_override.upsert` and `seo_meta_override.delete`: one audit entry per request, with the full override before and after (an update's `before` is no longer `null`); deleting nothing writes no entry. `MetaTagResolverService` takes the `commandBus` instead of an audit sink.
  - New port `seoProductMetaPort` (`resolveForProduct`, `listScopesForProduct`).

- 678fed1: The sitemap lists one URL per language a product is live in, each on the product's effective URL key in that language (`catalogProductUrlKeyReadPort`), with `?lang=` off the channel's default language. A `product.updated.v1` that changes a product's scoped status, publication window, audience or URL keys marks every channel's cached sitemap stale, so the next request regenerates it.
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

- 248a9df: Routes a visitor reaches before signing in, or that arrive with no storefront channel, declare
  `salesChannelAccess: 'open'` and stay reachable when an operator closes a sales channel to
  anonymous visitors: administrator sign-in and sign-out, second-factor verification and set-up
  tickets and federated sign-in (both surfaces), `GET /api/v1/i18n/config`, the dictionary reads the
  registration form uses, the crawler policy, product-feed downloads by token, and the newsletter
  confirmation, unsubscribe and tracking links.
- f61fea3: `GET /api/v1/storefront/seo/crawler-files` declares `salesChannelAccess: 'open'`, so a sales
  channel closed to anonymous visitors still answers it, and the answer carries the channel's
  `anonymousAccess`. A storefront uses it to keep serving `robots.txt` and `llms.txt` on such a
  store: `robots.txt` disallows everything for every crawler and names no sitemap, and `llms.txt`
  names the store and says its content is for signed-in customers only. The custom `robots.txt`
  instructions and the additional `llms.txt` content are not served on a closed store; they are
  kept and return when the store is opened again. An open store's answer is unchanged apart from
  the new member.
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

- 4be4642: The storefront serves an `llms.txt` per sales channel, and an operator can add to it: **Settings → SEO → Additional llms.txt content**.

  **For an operator.** `/llms.txt` is a plain-text file that tells AI assistants what a shop is and
  where its public pages are. The storefront now serves one for each sales channel: a part it
  generates — the shop's name, links to the home page, the catalog, search, the blog and the contact
  page, and the sitemap — followed by the text you save in the new setting. The setting is empty by
  default, takes a value for all sales channels and a value per channel like any other, and holds at
  most 64 KiB, the limit of the `robots.txt` instructions. A saved change is served within about two
  minutes. The addresses in the generated part use the storefront's one public origin
  (`NEXT_PUBLIC_SITE_URL`, fixed when the storefront is built), as the sitemap does: a storefront
  that serves several sales channels names that origin in every channel's file, with each
  channel's own shop name.

  Two things to know before relying on it:

  - **A sales channel whose _Default robots_ is `NOINDEX` has no `llms.txt`.** The storefront answers
    `/llms.txt` with "not found" there, whatever the setting holds: a shop that asks search engines
    to stay away does not invite AI assistants in. The text is kept and is served again when the
    channel allows indexing. `robots.txt` is unaffected — it stays open on such a channel, as before.
  - **Switching the `seo` module off withdraws the file**, with the _Default robots_ policy and the
    custom `robots.txt` instructions. The module's description and its activation setting now say so.

  Below the field there is a preview, the same as the one beside _Custom robots.txt instructions_:
  one block that is the file, your lines marked inside it, under a heading that reads _llms.txt as
  served now_ or _llms.txt after saving_. On a `NOINDEX` channel it says _llms.txt is not served_,
  with the reason, in place of the block. The messages for a storefront that cannot be reached, has
  no address configured or did not confirm that it serves the file are the ones the `robots.txt`
  preview shows, and the request the backend makes for it is bound the same way — one `GET
<origin>/llms.txt?part=base`, no redirect followed, three seconds, 512 KiB, `text/plain` only,
  nothing of the administrator's request in it. As before, private and loopback addresses are not
  refused, and this preview tells a holder of `settings:read` slightly more about a configured
  address than the `robots.txt` one does: a `404` without the storefront's header is reported as
  "did not confirm that it serves llms.txt" rather than as "could not be reached", so an address
  where some HTTP server answers can be told from one where nothing does.

  No migration, no new environment variable, no new permission.

  The `seo` bundles also gain the name of the settings group and the name and description of the
  _SEO enabled_ setting, in English and Polish (`settingGroups.seo.name`,
  `settingLabels.seo.enabled.*`).

  **`robots.txt` no longer depends on _Default robots_ being readable.** A _Default robots_ value
  that is not one of the four choices — which takes a row written around the settings API — made
  `GET /api/v1/storefront/seo/crawler-files` answer `500`, so a storefront that had just started
  answered that channel's `robots.txt` with `503`, although the file has never depended on that
  setting. The endpoint now answers, and names what it could not read (below). Such a channel keeps
  its `robots.txt`; its `llms.txt`, which does depend on the setting, answers `503` until the value
  is repaired by saving _Default robots_ again. A storefront that has not been updated benefits
  too: its `robots.txt` is served as well.

  **In `@endora-commerce/contracts`.**

  - `storefrontCrawlerFilesSchema` gains an optional member, **`unreadable`**: the names of the
    members the backend could not read from what is stored — `CRAWLER_FILES_UNREADABLE_POLICY`
    (`'policy'`: `index` and `follow` are then both `false` and mean "not known") and
    `CRAWLER_FILES_UNREADABLE_LLMS_TXT` (`'llmsTxtAdditional'`: that member is then `''` and means
    "not known"). It is absent when everything was read. **Additive**: a consumer that does not read
    it is unaffected unless it reads `index`, `follow` or `llmsTxtAdditional` from this endpoint, in
    which case it should treat a named member as unknown rather than as its value. Unreadable
    `robots.txt` instructions still fail the whole answer with `500`.
  - `llmsTxtAdditional` now carries the channel's saved text; it was always `''`.
  - `GET /api/v1/admin/seo/crawler-files/preview?file=llms` now answers; it answered `400`. The
    `not-served` state means the storefront answered `404` **with** the `X-Endora-Crawler-Files`
    header — no file for that channel; a `404` without the header is `storefront-outdated`, with no
    `base`.

  **For a custom storefront.** To be previewed, `/llms.txt?part=base` answers the generated part
  alone, as `text/plain`, with `X-Endora-Crawler-Files: 1`; a channel with no file answers `404` with
  the same header. Answer `503` rather than a file while `unreadable` names `policy` or
  `llmsTxtAdditional`.

  **In `@endora-commerce/cli`.** The storefront that `endora new storefront` writes serves
  `/llms.txt` as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it has no
  `llms.txt`**: the Settings screen shows the text, the preview says that the storefront did not
  confirm that it serves the file, and nothing serves it. To take the feature, apply these changes
  from the reference storefront to the storefront project, keeping any edits of your own. They
  assume the project has already taken the _Default robots_ and _Custom robots.txt instructions_
  changes that the other entries of this release describe — `lib/seo/crawler-policy.ts`, `lib/seo/robots-txt.ts`,
  `lib/seo/robots-system-rules.ts`, `lib/seo/robots-directive.ts` and `app/robots.txt/route.ts`
  exist, and `app/robots.ts` is deleted. If not, apply those entries first.

  - **add** `app/llms.txt/route.ts` — the route;
  - **add** `lib/seo/llms-txt.ts` — what the route answers, and when it answers `404` and `503`;
  - **add** `lib/seo/llms-txt-base.ts` — the generated part. It lists `SITEMAP_STATIC_ROUTES` from
    your `app/sitemap.ts`; **if you changed that list, give each of your routes a title in
    `LLMS_TXT_PAGE_TITLES`**, and name in `LLMS_TXT_CONDITIONAL_PAGES` any of them that can answer
    "not found";
  - **add** `lib/seo/llms-txt-pages.ts` — whether a conditional page is served right now (today:
    the blog), remembered per channel by the cache `lib/seo/crawler-policy.ts` exports;
  - **add** `lib/seo/crawler-file-response.ts` — the headers and the temporary failure the two files
    share;
  - **replace** `lib/seo/robots-txt.ts` and `lib/seo/crawler-policy.ts` with the new versions. The
    first now takes its headers from `crawler-file-response.ts`; the second reads `unreadable` and exports the channel cache the page question uses;
  - **edit** `lib/seo/robots-directive.ts`: `isDocumentPath` must answer `false` for `/llms.txt`, as
    the reference's version does. **Do not skip this one**: without it the storefront still serves
    the file, but while the backend is unreachable it answers `/llms.txt` with the outage page
    instead of the last version it knew;
  - **edit** `app/reserved-segments.ts`: add `'llms.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - **make sure there is no `public/llms.txt`.** A file there is served instead of the route — for
    every channel, with no operator text, and on a channel set to `NOINDEX` — and neither the build
    nor the server says so. `curl -sI https://<your shop>/llms.txt | grep -i x-endora-crawler-files`
    shows the header when the route is the one answering.

  `middleware.ts` and `app/layout.tsx` do not change in this release. The new files import
  `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so the storefront project needs
  `@endora-commerce/contracts` at this release — as the custom `robots.txt` instructions, another
  entry of this release, already require. Then
  rebuild the storefront — the build's route list shows `ƒ /llms.txt`.

  The reference storefront's tests for these files (`test/seo/llms-txt-base.test.ts`,
  `test/seo/llms-txt-route.test.ts`, and the additions to `test/seo/crawler-policy.test.ts`,
  `test/seo/robots-txt-route.test.ts`, `test/seo/middleware-robots.test.ts` and
  `test/seo/middleware-effect.test.ts`) are optional to copy.

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

- ddc9382: A sales channel's storefront can be taken out of search engines with one setting: **Settings → SEO → Default robots**.

  The setting offers `INDEX, FOLLOW` (the default), `NOINDEX, FOLLOW`, `INDEX, NOFOLLOW` and
  `NOINDEX, NOFOLLOW`, for all sales channels or per channel. For a channel whose value restricts
  something, the storefront adds the directive to what it serves for that channel: an
  `X-Robots-Tag` header on pages (not-found pages and the offline page included), on
  `/sitemap.xml`, on `/_next/image` and on the files under `public/`, and one extra
  `<meta name="robots">` in the `<head>` of the pages it renders for a request. Not-found pages
  and the statically built `/offline` page carry the header without the extra element — both
  already declare `noindex, nofollow` themselves — and redirects declared in `next.config.js`
  and the files under `/_next/static` carry neither. It only adds restrictions — a page that
  declares `noindex` for itself keeps its own tag — and `robots.txt` is not changed. With the
  default nothing is added. A saved change is in force on the storefront within a minute or two.

  **Switching the `seo` module off withdraws the directive**, so a channel set to `NOINDEX` becomes
  indexable again until the module is switched back on. The stored value is kept.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the setting `seo.default_robots`, serves the public,
    channel-resolved `GET /api/v1/storefront/seo/robots-policy` (`{ "data": { "index", "follow" } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    a permissive answer — when the stored value is not one of the four choices), and declares two
    command-palette actions: `open-seo` (`catalog:write`) and `open-search-engine-robots`, which
    opens the Settings screen for holders of `settings:read`.
  - `@endora-commerce/contracts` exports `storefrontRobotsPolicySchema`,
    `storefrontRobotsPolicyResponseSchema` and the types `StorefrontRobotsPolicy` and
    `StorefrontRobotsPolicyResponse`. The schema drops members it does not know, so a later
    release can add one without an older consumer refusing the answer.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes reads the policy
    and applies it. Its middleware now runs for every path except `/_next/static` (it used to skip
    public files, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` and `/_next/image`); for
    those paths it only adds the header. Measured on the reference storefront, that costs a public
    file about one millisecond. A storefront that already knows a channel's policy never waits
    more than a fraction of a second for a refresh; only the first read after a start is waited
    for, up to two seconds, once.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting.** `endora new storefront` copies the reference once and the project owns it afterwards.
  With an upgraded backend and an older storefront the Settings screen shows _Default robots_ and
  nothing acts on it — a channel set to `NOINDEX` stays indexable. To take the feature, copy these
  four files from the reference storefront into the storefront project, keeping any edits of your
  own. They import nothing from a package that an earlier storefront does not already have, so
  **no dependency has to be upgraded for them to build and run**:

  - `lib/seo/crawler-policy.ts` — new: reads the policy, caches it for a minute per channel, and
    keeps the last value it read while the backend cannot be reached;
  - `lib/seo/robots-directive.ts` — new: what the policy puts on a response;
  - `middleware.ts` — changed: the policy read, the response header, the request header for the
    layout, and the widened `config.matcher`;
  - `app/layout.tsx` — changed: renders the extra `<meta name="robots">` in both documents it
    returns. Do not move the directive into the layout's `metadata` export: a page's own `robots`
    replaces a layout's there, so it would be dropped on every page that declares one.

  Then rebuild the storefront. `curl -sI https://<your shop>/ | grep -i x-robots-tag` shows the
  header once a restricting value is saved.

  The reference storefront's tests for these files (`test/seo/crawler-policy.test.ts`,
  `robots-directive.test.ts`, `middleware-robots.test.ts`, `middleware-effect.test.ts`,
  `layout-robots.test.ts`, `layout-outage-render.test.tsx` and
  `test/conformance/robots-directive.spec.ts`) are optional to copy. One of them,
  `crawler-policy.test.ts`, compares the storefront's own check of the answer with the published
  schema and therefore needs `@endora-commerce/contracts` at this release or later in the
  storefront project; nothing else does.

  Two limits are stated in the module's documentation: files the backend serves (product images
  and other uploaded media) carry no `X-Robots-Tag`, and a storefront that starts while its backend
  is unreachable serves pages without the default directive until its first successful read.

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

- 2c8635b: Fix UnoPim media downloads: a stored media path now resolves to `<baseUrl>/storage/<path>`, the address Laravel's public disk actually serves, instead of `<baseUrl>/media/<path>`, which answered 404 for every file. An absolute `http://` media address is also left as-is rather than being appended to the base URL.

  Allow local development instances to fetch UnoPim media over HTTP when the development-only environment override is enabled.

  Import UnoPim attribute and option labels per locale, split comma-separated multiselect values, and map boolean source values onto the auto-created yes/no options. `CatalogProductWritePort` now exposes `patchAttributeOption` so a later import can refresh option labels.

  The UnoPim import-run detail now includes the recorded per-record issues so the operator can see why a run finished with issues.

  Import now reads UnoPim 3 `GET /configurable-products` in addition to `GET /products`, and maps `super_attributes` / `variants` onto Endora configurable products. Previously only the simple-product list was walked, so configurable parents were created as simple products.

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
