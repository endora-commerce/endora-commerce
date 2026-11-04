# Research: Blog — operator prefix, pagination, per-language URLs and authors

**Feature**: `specs/171-blog-i18n-authors/` | **Date**: 2026-11-03

Every decision below was taken against `master` at `d31bab44b`. File references are to that tree.

## Findings that change the starting point

- **F1 — The prefix validator is not wired.** `BlogSettingsResolver.assertValidPrefix`
  (`packages/modules/blog/src/backend/services/blog-settings-resolver.ts:108-128`) is called only by
  `backend/test/integration/blog/url-prefix-validation.test.ts`; the blog never registers it with the
  settings module, so any string is accepted and the resolver silently falls back to `blog` for an
  invalid one. US1 wires it (R3).
- **F2 — Neither `blog` nor `admin_users` is migrated to the Command Bus.** Both write through
  `em.transactional`/`em.flush` with hand-placed audit (`admin_users`) or none per field (`blog`).
  Principle XIII lets an un-migrated module keep its path for existing writes; **new** writes must be
  Commands. See R11.
- **F3 — `assets_library` depends on `admin_users`** (`assets_library/src/manifest.ts:152`), so
  `admin_users` cannot register an asset-reference descriptor without a dependency cycle. See R9.
- **F4 — `admin_users` emits no domain events.** A cache keyed on author data would need a new event
  to stay fresh. See R10.
- **F5 — The blog already depends on `cms` and `sales_channels`** (`blog/src/manifest.ts:130-139`), but
  not on `admin_users`.
- **F6 — The storefront middleware already rewrites** (it strips the 167 language prefix with
  `NextResponse.rewrite`, `storefront/middleware.ts:217-225`), and the language switcher already
  prefers a page's own `hreflang` links over a swapped prefix
  (`storefront/components/HeaderPreferenceSwitchers.tsx:48-87`).

## R1 — Serving the blog under an operator prefix

**Decision**: Keep the route directory `storefront/app/blog/[[...slug]]` and map the public prefix onto
it in the middleware. After 167's locale parse, the middleware reads the channel's **blog routing**
(R2) through the existing per-process `createChannelCache` (60 s freshness, never rejects) and, on
`parsed.logicalPath`:

- first segment = the current prefix of the parsed language (and ≠ `blog`) → internal rewrite to
  `/blog/<rest>`, with `x-pathname` keeping the public logical path;
- first segment = `blog` while the current prefix of that language is not `blog` → **301** to the same
  rest under the current prefix (canonicalisation; the platform's own default address);
- first segment = a former prefix of that language (R4) → **301** to the current prefix, only when
  the routing answer lists former prefixes (it does so only while `seo` is present, R7);
- anything else → unchanged.

When the routing read fails or the blog is off (404/503), the middleware does nothing: `/blog` keeps
answering as it does today and a custom prefix is a 404 — the right result for an absent module
(Principle XVII).

**Rationale**: one routing seam that 167 already established; no page moves; the App Router keeps
one blog route; the per-channel cache gives the same staleness window operators already accept for
167's languages.

**Alternatives considered**:
- *Next.js `rewrites()` in `next.config.js`* — static at build time; cannot vary per channel.
- *Serve the blog from the CMS catch-all `(content)/[...slug]`* — makes CMS route the blog,
  inverting the dependency (blog depends on cms) and touching every CMS request.
- *Add the prefixes to `GET /api/v1/storefront/sales-channel`* — that answer is a fixed
  `sales_channels` literal with no contribution seam; the blog would have to write into another
  module's response (Principle I).

## R2 — One path helper, built by the backend

**Decision**: Add `blogPath({ view, key?, page?, languageCode, channel, prefix })` to
`packages/contracts/src/blog.ts`, built on 167's `storefrontPagePath`
(`packages/contracts/src/storefront-language-path.ts:118`) exactly as `productPath` is
(`packages/contracts/src/product-url-keys.ts:53`). `view` ∈ `index | post | category | tag`. The
backend computes every blog URL — card `url`, tile `url`, tag `url`, breadcrumbs, `alternates` — and
the storefront composes none (the catalog precedent). The six `BLOG_PREFIX` constants, the JSON-LD
fallback, `canonicalPath(seo.route)` for the blog and `LatestPosts`' `/blog/<slug>` fallback are
replaced by payload URLs. Channel URL facts come from `salesChannelResolutionPort` (as CMS reads them,
`cms/src/backend/index.ts:463-467`).

**Rationale**: SC-001 is only reachable if no consumer can build a blog URL on its own.

**Alternatives considered**: *A storefront-side helper fed `urlPrefix`* — the sitemap already does
this and it is the reason a prefixed URL can disagree with a payload URL; it also cannot know
per-language keys (R6).

## R3 — The prefix setting

**Decision**: Keep `blog.url_prefix` (`string`, the channel default) and add
`blog.url_prefix_by_language` (`json`, `{ "<language code>": "<prefix>" }`, empty object by default),
both channel-scoped through the settings module's existing `subset` writes. Register **one** write
validator for both codes with `SettingWriteValidatorRegistryPort` (the CMS precedent,
`cms/src/backend/index.ts:596-605`). It refuses, per targeted channel, using the post-write
projection:
- a malformed prefix (`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`), a language code the channel does not
  have;
- a prefix in `BLOG_RESERVED_URL_PREFIXES` or the storefront reserved segments
  (`cms.reserved_slug_segments`);
- a prefix equal to a language prefix of any channel (167 FR-040's rule, mirrored);
- a prefix equal to the first slug segment of a CMS page in the channel (through a new read on CMS's
  port; the blog already depends on `cms`).

**Rationale**: changing the `valueType` of a live setting would need a data migration of every stored
value and breaks deployments that set it by CLI; a second key is additive.

**Alternatives considered**: *Convert `blog.url_prefix` to json* — rejected as above. *A language
scope in the settings module* — a platform change for one consumer.

## R4 — Former prefixes

**Decision**: A blog-owned table `blog_url_prefixes` holds, per (channel, language|null), the
**current** prefix and every **former** one. A `settings.value_changed` subscriber for the two codes
(the blog already subscribes for `blog.*`, `blog/src/backend/index.ts:208-212`) re-resolves the
affected channels and, where the current prefix differs from the stored one, marks the stored row
former and inserts the new current row; an install hook seeds the current rows. A former prefix is
dropped when it becomes current again, and an operator can delete one (blog settings panel). Former
prefixes are claimed segments for R3 and R5 so a CMS page cannot sit under a redirect.

**Rationale**: `settings.value_changed` carries no old value (F: `settings-admin.service.ts:573-580`),
so the blog must remember what it served.

**Alternatives considered**: *Reading the old value from the audit log* — couples the blog to the
audit store's shape. *No redirects for prefixes* — violates OR-8.

## R5 — CMS refuses a page under a blog prefix

**Decision**: CMS gains a small contribution registry, `cmsReservedSegmentRegistry`
(`register({ contributorModuleId, segmentsFor(salesChannelId) })`), consulted by
`assertSlugNotReserved` (`cms/src/backend/services/cms-page-service.ts:207-221`) next to the language
prefixes, and by the page list's "shadowed" marker. The blog registers its current and former
prefixes at boot. A contributor whose module is off contributes nothing.

**Rationale**: the blog depends on `cms`, so the blog contributing into CMS keeps the edge's
direction; CMS never names the blog.

**Alternatives considered**: *CMS reading blog settings* — inverts the dependency.

## R6 — Per-language URL keys

**Decision**: One table `blog_url_keys(id, entity_kind, entity_id, language_code, key)` for posts and
categories, and one `blog_url_redirects(id, entity_kind, entity_id, language_code, key)`. The
**effective key** of an entity at (channel, language) is its key row for the language, else its
existing `slug`. A key is unique per (channel, language) across posts and categories together,
counting current keys, the slug where no key exists, and redirects; this is enforced in a service
under `pg_advisory_xact_lock` per (channel, language, key) — the same lock family as
`blog-slug-collision.ts`, widened by the language. Replacing a key turns the former key into a
redirect row of that language; a post's first key in a language turns its slug into a redirect in
that language only. Redirect rows point at the entity, so they never chain. A key equal to another
entity's redirect is refused with `BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED` and accepted on a retry
carrying `confirmTakeover` — the catalog's protocol (`catalog/.../url-key.service.ts:386-391`).

The **channel × language override** of the catalog is **not** carried over: the blog has no
per-channel naming need, and its slug is already one value mirrored to every channel. This narrows
spec FR-030 (amended).

**Rationale**: reuses a shape reviewers already know; one table for both kinds makes the
cross-kind uniqueness probe one query.

**Alternatives considered**: *A jsonb `slug` map on `blog_posts`* — no index can serve the
per-language lookup; redirects would still need a table. *Separate post/category key tables* — two
probes and two lock families for one URL space.

## R7 — Resolving a blog URL and serving redirects

**Decision**: `GET /api/v1/blog/by-slug` resolves at (channel, language): (1) a key row of the
language of an entity in the channel, (2) an entity's slug where it has no key in the language,
(3) a redirect row of the language, (4) an entity's slug where it **has** a key in the language
(pre-feature links). (3) and (4) answer `{ kind: 'redirect', path, permanent: true }` with status 200,
the catalog's resolution contract; the storefront page calls `permanentRedirect(path)`. Redirects are
served only while `seo` is effectively present, as for products (163 Q-C; `seoPresent` in
`url-key-resolution.service.ts:142`); otherwise (3)/(4) answer as an unknown key. Each step requires
the entity's assignment to the request language (R8).

## R8 — "Exists in a language"

**Decision**: The request language is first matched to the channel's language codes with the
contracts' `sameLanguage` (so `en-US` meets an assigned `en`); every storefront query then adds
`exists (select 1 from blog_post_languages l where l.blog_post_id = p.id and l.language = ?)` (and the
category equivalent), including counts, related posts, the primary category of a card and the
breadcrumb. `pickName`'s "any authored language" fallback is removed from storefront reads.

The completeness rule (FR-022) is enforced at **publication**, not at every save: a transition to
`published`, or a save of a published post, is refused with `BLOG_LANGUAGE_INCOMPLETE` (details per
language and field) unless every assigned language has a name, an effective key and non-empty
content. Drafts may be incomplete, because the editor saves content one language at a time
(`BlogPostEditor.tsx:265-269`). Categories need a name per assigned language. This narrows spec
FR-022 (amended).

## R9 — Avatar reference

**Decision**: `assets_library` registers the `admin_user_avatar` reference descriptor itself, reading
through `adminUserReadPort`, which gains `findByAvatarAssetIds(ids)`. `assets_library` already depends
on `admin_users` (F3).

**Alternatives considered**: *`admin_users` registers it* — needs a dependency on `assets_library`,
which is a cycle.

## R10 — Author data and the cache

**Decision**: The cached post payload and cards carry `authorId` only. After a cache read, the
resolver enriches the answer with one batched `adminUserReadPort.findByIds(ids)` per request and
resolves avatar URLs through the existing `resolveAssetUrl`; a record with `deletedAt` set yields no
author, an inactive one is shown (OR-4). The blog adds `admin_users` to its `dependencies`
(`admin_users` is non-deactivatable).

**Rationale**: FR-064 without a new event (F4) and without busting every channel's cache on a
profile edit; the extra read is one indexed query per page.

**Alternatives considered**: *A new `admin_users.admin_user.profile_changed.v1` event and
`invalidateAll`* — a new event contract for a cache optimisation the read does not need.

## R11 — Write paths

**Decision**:
- **New writes are Commands**: `blog.url_keys.update`, `blog.url_redirect.delete`,
  `blog.url_prefix.forget` (delete a former prefix).
- **Fields added to existing writes stay on the existing path**: the post's `authorAdminUserId`
  (blog post patch), the administrator's `avatarAssetId` and `bio` (`updateSelf` / `update`, which
  audit `admin_user.update` by hand). Migrating `blog` or `admin_users` to the Command Bus is outside
  this feature. This narrows spec FR-052 and FR-071 (amended).

## R12 — Pagination

**Decision**:
- `GET /api/v1/blog/posts` accepts `page` (≥ 1, default 1) and `perPage` (1–24); `limit` remains as
  a synonym of `perPage`. With neither present, the page size stays the current default of **6**, so
  an existing caller sees no change (narrows FR-010's default, amended).
- The response gains `pagination` beside `data`.
- Filters are `categorySlug`, `tagCode` and `authorId`, combinable.
- The order is `published_at desc nulls last, created_at desc, id desc` (stable tie-breaker).
- The total comes from `count(*) over ()` in the page query.
- Past the last page, the API answers an empty `data` with the totals.

The storefront index takes `?page=`. `BlogIndexResponse` gains `posts: { data, pagination }`, and
`latestPosts` is kept, deprecated, equal to `posts.data`, for one minor release. Category tiles are
sent on page 1 only. The storefront answers 404 for a page past the last one on index, category and
tag views. Cache keys gain page, per-page and filters.

## R13 — Admin surfaces

- **Post editor:**
  - The single slug field becomes the URL key of the active language tab, showing the effective
    key; the base slug stays in the post settings.
  - A redirect list appears below it while `seo` is present.
  - An author picker uses a new `GET /api/v1/admin/blog/author-candidates` (gated `blog.write`). It
    returns id, display name and avatar URL of active, non-deleted administrators.
- **Category editor:** the same URL-key field per language.
- **Blog settings:** the per-language prefix map and the former-prefix list with delete.
- **Profile page** (`packages/admin-shell/src/modules/profile/ProfilePage.tsx`) and the admin-user
  editor:
  - an avatar field using `AssetFieldPicker` (`acceptMimePrefix="image/" allowUpload`, as the blog's
    main image does);
  - a biography textarea per content language.
- No new permission codes and no new palette entries; existing blog screens stay reachable
  (Principle XVI unaffected).
