# Tasks: Blog — operator prefix, pagination, per-language URLs and authors

**Input**: `specs/171-blog-i18n-authors/` — plan.md, spec.md, research.md, data-model.md,
contracts/, quickstart.md
**Prerequisites**: `pnpm run build:packages` after every package edit (AGENTS.md § Stack).

**Tests**: mandatory (Constitution III). Every RED task MUST be run and seen failing for the stated
reason before its implementation task starts.

**Delivery**: four merge requests in the owner's order (OR-1, plan *Delivery slices*):
S1 = Phases 1–3, S2 = Phase 4, S3 = Phases 5–7, S4 = Phases 8–9. Phases 10–11 run inside **each**
slice for what that slice touched.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US7 (spec.md); Setup/Foundational/Docs/Verification tasks carry none

---

## Phase 1: Setup

- [X] T001 Confirm the worktree `/Users/alandolina/Sites/wt-171-blog` is on `feat/171-blog-i18n-authors` from a fresh `origin/master` and `.specify/feature.json` points at `specs/171-blog-i18n-authors`; `bash scripts/setup-worktree.sh`, `pnpm run build:packages`; record the baseline of `pnpm --filter backend run test:unit:fast`, `pnpm --filter storefront run test` and `pnpm --filter backend exec vitest run backend/test/contract/blog backend/test/integration/blog` in a scratch note
- [X] T002 Read `specs/conventions/module-composition.md`, `module-migrations.md`, `module-activation.md`, `module-i18n.md`, `module-admin-surfaces.md`, `check-estate.md`, `release-intent.md`, `module-documentation.md` and `backend-test-suite.md` before the first task that touches their subject
- [X] T003 [P] List every emitter of a blog URL into the scratch note (input to T024–T030): `command grep -rn "/blog\|BLOG_PREFIX\|urlPrefix" storefront packages/cms-components/src packages/modules/blog/src --include='*.ts' --include='*.tsx'`

---

## Phase 2: Foundational — one path helper, URLs in every payload (blocks every story)

### Contracts first (Principle II)

- [X] T004 [P] RED `packages/contracts/src/blog-path.test.ts` — `blogPath` for `index`, `entry`, `tag` × 167 setting on/off × default/non-default language; `?page=N` only for N ≥ 2; key and code URI-encoded; unknown language throws; `blogDefaultPath` unprefixed (contracts/routing-and-settings.md §1)
- [X] T005 Implement `blogPath` / `blogDefaultPath` in `packages/contracts/src/blog.ts` on `storefrontPagePath` (`packages/contracts/src/storefront-language-path.ts`); export from `packages/contracts/src/index.ts`
- [X] T006 [P] RED `packages/contracts/src/blog.test.ts` — optional `url` on `blogPostCardSchema`, `blogCategoryTileSchema`, `blogResolvedTagRefSchema`, `blogResolvedPostSchema`, `blogResolvedCategorySchema`; a payload without them still parses (cached payloads)
- [X] T007 Add the `url` fields in `packages/contracts/src/blog.ts`; `pnpm run build:packages`

### Channel URL facts in the blog resolver

- [X] T008 RED `backend/test/contract/blog/storefront-urls.test.ts` — on a channel with 167's prefix on, every `url` and breadcrumb `url` of `/by-channel`, `/by-slug` (post, category), `/tag-by-code` and `/posts` starts with `/<lang>/blog/`; with it off and the default language, `/blog/`; cross-channel: a second channel's facts never leak into the first
- [X] T009 Resolve `ChannelUrlFacts` in `packages/modules/blog/src/backend/index.ts` through `lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort')` (as `cms/src/backend/index.ts:463-467`) and pass them into `BlogStorefrontResolver` *(2026-11-03: no port needed — the kernel's resolved channel already carries `languages` and `prefixDefaultLanguage`; the route passes them in)*
- [X] T010 Build every URL in `packages/modules/blog/src/backend/services/blog-storefront-resolver.ts` with `blogPath` (cards, tiles, tag refs, breadcrumbs, post/category `url`); remove the hand-built `/${urlPrefix}/…` strings; cache keys unchanged (already per channel × language)

**Checkpoint**: payloads carry correct URLs for the default prefix; nothing reads them yet.

---

## Phase 3: US1 — the blog lives at the address the operator set (P1) 🎯 MVP · slice S1

**Goal**: a channel with prefix `aktualnosci` serves and links its blog there; `/blog` redirects.
**Independent test**: quickstart §1 steps 1–2 with a single prefix.

### Tests first

- [X] T011 [P] [US1] RED `backend/test/integration/blog/url-prefix-validation.test.ts` (extend) — a settings write of `blog.url_prefix` through the settings admin service (not the static method) is refused for a bad shape (400 `BLOG_URL_PREFIX_INVALID`), a reserved segment incl. `tag`, `author`, `p`, `cart` (409 `BLOG_URL_PREFIX_RESERVED`), a language prefix of any channel and a CMS page's first segment in the channel (409 `BLOG_URL_PREFIX_CONFLICT`); `blog` itself accepted
- [X] T012 [P] [US1] RED `backend/test/integration/blog/url-prefix-history.test.ts` — install seeds a `current` row per channel; changing the prefix turns it `former`; changing back deletes the former row; `blog` is never stored `former`; the `blog.url_prefix.forget` Command deletes a former row and writes one audit entry; a `current` row cannot be forgotten
- [X] T013 [P] [US1] RED `backend/test/contract/blog/storefront-routing.test.ts` — `GET /api/v1/blog/routing` returns `defaultPrefix`, `prefixes` (every channel language → effective prefix), `formerPrefixes` only while `seo` is present; 404 `BLOG_DISABLED` with `blog.enabled=false`; answers only the resolved channel; extend `backend/test/integration/blog/off-state.test.ts`: with the blog off `/routing` answers `MODULE_DISABLED`
- [X] T014 [P] [US1] RED `backend/test/integration/cms/reserved-segment-contributors.test.ts` — a CMS page whose first segment is a blog prefix (current or former) of one of its channels is refused with 409 `CMS_SLUG_RESERVED` `{ segment, claimedBy: 'blog' }`; with the blog off the same save succeeds; the page list marks an existing page shadowed *(2026-11-03: the refusal and the off-state are tested; the page list's "shadowed" marker for an existing page under a blog prefix is deferred to T072)*
- [X] T015 [P] [US1] RED `storefront/test/seo/middleware-blog-routing.test.ts` — with routing `{ defaultPrefix: 'aktualnosci' }`: `/pl/aktualnosci/x` rewrites to `/blog/x` with `x-blog-prefix`/`x-blog-public-path`; `/pl/blog/x` → 301 `/pl/aktualnosci/x` (query kept); a former prefix → 301; routing read failing or 404/503 → unchanged; client-sent `x-blog-*` headers stripped; language-neutral paths untouched; prefix `blog` → no rewrite *(2026-11-03: the private `x-blog-*` headers were dropped — the page reads its canonical URL from the payload; `x-pathname` carries the public logical path)*
- [X] T016 [P] [US1] RED `storefront/test/content/blog-links.test.tsx` — rendering index, category, post, tag pages and `LatestPosts` from fixtures whose `url` fields use `/pl/aktualnosci/…` yields no `href` containing `/blog`; breadcrumbs, `Pagination` base path, canonical and JSON-LD `url` come from the payload
- [X] T017 [P] [US1] RED `storefront/test/seo/blog-sitemap-llms.test.ts` — sitemap and `llms.txt` blog entries use the routing/payload prefix, never the literal `/blog` when the prefix differs

### Implementation

- [X] T018 [US1] Contracts in `packages/contracts/src/blog.ts`: `blogRoutingResponseSchema`; error codes `BLOG_URL_PREFIX_CONFLICT` in `ERROR_CODES`; add `tag`, `author` to `BLOG_RESERVED_URL_PREFIXES`; `pnpm run build:packages`
- [X] T019 [US1] Migration `pnpm --filter backend run migration:new -- --module blog --name url_prefixes` creating `blog_url_prefixes` (data-model §1.3); entity `packages/modules/blog/src/backend/entities/blog-url-prefix.entity.ts`; register it in `packages/modules/blog/src/backend/index.ts`; `pnpm --filter backend run composer:generate`
- [X] T020 [US1] `packages/modules/blog/src/backend/services/blog-url-prefix-service.ts` — `validate()` (shape, reserved ∪ `cms.reserved_slug_segments`, language prefixes via `channelLanguagePrefixes`, CMS first segments), `syncFromSettings(channelIds)`, `routingFor(channel)`, `forget(id)` as Command `blog.url_prefix.forget` (pattern: `packages/modules/tasks/src/backend/services/comment-service.ts:79`)
- [X] T021 [US1] CMS side in `packages/modules/cms/src/backend/`: `cmsReservedSegmentRegistry` (register + skip off contributors), consulted by `assertSlugNotReserved` and the list's shadowed marker in `services/cms-page-service.ts`; `CmsPageReadPort.firstSegmentsInChannel(salesChannelId)` in the port implementation and its type in `packages/contracts`
- [X] T022 [US1] Wire in `packages/modules/blog/src/backend/index.ts`: register the validator with `SettingWriteValidatorRegistryPort` for `blog.url_prefix`; extend the `settings.value_changed` subscriber to call `syncFromSettings` before `invalidateAll`; seed rows in the install hook; register the CMS contributor at boot; delete the dead static `assertValidPrefix` path in `blog-settings-resolver.ts` once T011 passes through the registered validator *(2026-11-03: the static `assertValidPrefix` and its unit cases are removed; the boot hook resolves the prefix service per call, so a composition without `commandBus` still boots)*
- [X] T023 [US1] `GET /api/v1/blog/routing` and admin `GET/DELETE /api/v1/admin/blog/addresses` in `packages/modules/blog/src/backend/routes.storefront.ts` / `routes.admin.ts` (gates `blog.read` / `blog.write`); `formerPrefixes` empty unless `effectiveState.isPresent('seo')`
- [X] T024 [US1] `storefront/lib/blog/blog-routing.ts` — `createChannelCache` (from `storefront/lib/seo/crawler-policy.ts`) over `/api/v1/blog/routing`, parsing with the contract schema, `null` on any failure
- [X] T025 [US1] Blog step in `storefront/middleware.ts` after the 167 locale parse (contracts/routing-and-settings.md §2), including the `prefix === ''` branch at today's L220; strip `x-blog-prefix`/`x-blog-public-path` with the language headers *(2026-11-03: another language's current prefix also answers 301 to the request language's, US5 scenario 2)*
- [X] T026 [P] [US1] Replace the six `BLOG_PREFIX` constants and the JSON-LD fallback in `storefront/app/blog/_components/{BlogCategoryPage,BlogTagPage,CategoryTree,PostCard,CategoryTile,TagChipStrip,BlogPostPage}.tsx` with payload `url`s
- [X] T027 [US1] `storefront/app/blog/[[...slug]]/page.tsx` + `seo.ts`: canonical from the payload `url` (drop `canonicalPath(seo.route)` for the blog); `getBlogBySlug`/`getBlogTagByCode` in `storefront/lib/api/blog.ts` map `isModuleDisabled` to `null` like `getBlogIndex`
- [X] T028 [P] [US1] `packages/cms-components/src/components/LatestPosts.tsx` and `packages/cms-components/src/schema/blog-types.ts`: card `url` from the payload (keep the fallback); extend `LatestPosts.test.tsx` *(2026-11-03: no change needed — `LatestPosts` and `block-data.ts` already carried `url`)*
- [X] T029 [P] [US1] `storefront/app/sitemap.ts` (`blogPaths`, static `/blog` entry) and `storefront/lib/seo/llms-txt-base.ts` / `llms-txt-pages.ts`: blog entries from the payload `url` *(2026-11-03: `llms.txt` links the blog at its served address via `UnservedPages.servedAt`)*
- [X] T030 [US1] *(2026-11-03: deferred into T072, done there — the blog has no settings screen of its own, so the list needs a new screen, nav and palette entry; the API ships in S1)* Admin: former-prefix list with delete in the blog settings panel (`packages/modules/blog/src/admin/components/PrefixSettings.tsx`, mounted where `admin/test/modules/blog/blog-editors-settings-panel.test.tsx` finds the blog settings); EN + PL strings in `packages/modules/blog/i18n/{en,pl}.json`

**Checkpoint**: quickstart §1 steps 1–2 pass with one prefix; T011–T017 green. **S1 can merge.**

---

## Phase 4: US2 — posts can be listed page by page (P2) · slice S2

**Goal**: `GET /api/v1/blog/posts` and the storefront index paginate.
**Independent test**: quickstart §2.

### Tests first

- [X] T031 [P] [US2] RED `packages/contracts/src/blog.test.ts` (extend) — `blogPostsListQuerySchema`: `page`, `perPage` (1–24), `limit` synonym, `perPage` wins, neither → 6, `tagCode`, `authorId`; response requires `pagination`; `blogIndexResponseSchema` gains `posts`, keeps `latestPosts`
- [X] T032 [P] [US2] RED `backend/test/contract/blog/posts-list.test.ts` (extend) — 30 posts, `perPage=12` → 12/12/6, no repeats, newest first, totals; page 4 → `[]` with totals; `limit=3` → 3 as before; filters alone and combined count only matches; equal `published_at` ordered by `created_at`, `id`
- [X] T033 [P] [US2] RED `backend/test/integration/blog/pagination.test.ts` (extend) — cross-channel: another channel's posts neither listed nor counted; cache: page 2 and page 1 cached separately; index `?page=2` has no category tiles
- [X] T034 [P] [US2] RED `storefront/test/content/blog-pagination.test.tsx` — index `?page=2` renders page 2 without tiles; `?page=N` past `totalPages` on index, category and tag → `notFound()`; `?page=1` canonical without the parameter

### Implementation

- [X] T035 [US2] Contracts in `packages/contracts/src/blog.ts` per contracts/storefront-api.md (`/posts`, `/by-channel`); `pnpm run build:packages`
- [X] T036 [US2] `listPosts` in `packages/modules/blog/src/backend/services/blog-storefront-resolver.ts`: page/perPage, `tagCode`, `authorId` (column lands in T087; until then the filter is accepted and matches nothing), `count(*) over ()`, stable order `published_at desc nulls last, created_at desc, id desc`; same order in category and tag views
- [X] T037 [US2] `getIndex` paginated by `postsPerPage`; `posts` + deprecated `latestPosts`; tiles only on page 1; `latestCount` no longer read by the index
- [X] T038 [US2] Cache keys in `packages/modules/blog/src/backend/services/blog-cache.ts` (`composeListKey`, `composeIndexKey`) gain page, perPage and filters; update `backend/test/unit/blog/blog-cache.test.ts`
- [X] T039 [US2] Routes in `packages/modules/blog/src/backend/routes.storefront.ts`: `/posts` returns `{ data, pagination }`; `/by-channel` takes `page`
- [X] T040 [US2] Storefront: `storefront/lib/api/blog.ts` (`getBlogIndex(ctx, page)`, `listBlogPosts` pagination), `storefront/app/blog/[[...slug]]/page.tsx` + `_components/BlogIndexPage.tsx` (pagination, past-end 404), category/tag past-end 404
- [X] T041 [P] [US2] Block data in `packages/cms-components/src/utils/block-data.ts` and `storefront/lib/page-builder/block-data.ts` read `data` from the new response shape; `LatestPosts` unchanged visually

**Checkpoint**: quickstart §2 passes. **S2 can merge.**

---

## Phase 5: US3 — a post is shown only in its languages (P3) · slice S3 (can merge alone)

**Goal**: 404 outside assigned languages; publish guard.
**Independent test**: quickstart §3 steps 1–2 and §4.

### Tests first

- [X] T042 [P] [US3] RED `backend/test/integration/blog/language-existence.test.ts` — a post assigned to `pl` only: 404 on `/by-slug` in `en`; absent from `en` index, category list, tag list, `/posts`, related posts, sitemap source; category assigned to `pl` only: 404 in `en`, absent as tile/chip/breadcrumb/primary category; `Accept-Language: en-US` matches an assigned `en`; cross-channel unaffected
- [X] T043 [P] [US3] RED `backend/test/integration/blog/publish-guard.test.ts` — publishing with an assigned language missing name or content → 422 `BLOG_LANGUAGE_INCOMPLETE` naming `<field>.<language>`; a draft saves; patching a published post into an incomplete state is refused; a category without a name in an assigned language is refused on every save
- [X] T044 [P] [US3] RED `backend/test/unit/blog/language-fallback.test.ts` (update) — storefront `pickName` no longer falls back to "any authored language"; the admin read is unaffected

### Implementation

- [X] T045 [US3] Error code `BLOG_LANGUAGE_INCOMPLETE` in `packages/contracts/src/blog.ts`; `pnpm run build:packages`
- [X] T046 [US3] Request-language matching in `blog-storefront-resolver.ts`: match the request language to the channel's codes with `sameLanguage` before any query; unmatched → treat as the channel default (167 has already resolved the path language)
- [X] T047 [US3] Add the `blog_post_languages` / `blog_category_languages` existence predicate to every storefront query in `blog-storefront-resolver.ts` (index, list, count, by-slug both probes, category page + count + children, tag page + count, related posts, `toPostCard`'s primary category, `toResolvedPost`'s categories); remove the any-language fallback from storefront reads
- [X] T048 [US3] Publish guard in `packages/modules/blog/src/backend/services/blog-post-service.ts` (status transition and patch of a published post) and the name guard in `blog-category-service.ts`
- [ ] T049 [P] [US3] Admin: surface `BLOG_LANGUAGE_INCOMPLETE` details on the language tabs in `packages/modules/blog/src/admin/pages/BlogPostEditor.tsx` and `BlogCategoryEditor.tsx` (`editor-validation.ts` + its test); EN + PL strings *(2026-11-03: deferred — the editor shows the refusal's translated message in its banner; marking the language tab is not done)*

**Checkpoint**: quickstart §3 steps 1–2 pass.

---

## Phase 6: US4 — each language has its own post and category address (P3) · slice S3

**Goal**: per-language URL keys, redirects, real alternates.
**Independent test**: quickstart §3 steps 3–5.

### Tests first

- [X] T050 [P] [US4] RED `packages/contracts/src/blog.test.ts` (extend) — url-key read/put schemas, `blogBySlugResponseSchema` redirect member, `blogAlternatesSchema`, new error codes
- [X] T051 [P] [US4] RED `packages/modules/blog/src/backend/services/blog-url-key-service.test.ts` (co-located, pure planner) — replaced key → redirect in its language; first key in L → slug redirect in L only; claiming an own redirect drops it; key held as current by another entity → `taken`; another entity's redirect → `takeover required`; `confirmTakeover` → deletes it; `null` removes a language key and makes its former key a redirect
- [X] T052 [P] [US4] RED `backend/test/integration/blog/url-keys.test.ts` — uniqueness per (channel, language) across posts **and** categories; same key in different languages allowed; slug of an entity without an L key counts; channel membership change re-probes; concurrent PUTs of one key → one 409 (advisory lock); Command writes one audit entry with restorable `before`; soft-deleting the entity removes its redirects; cross-channel: a key in channel A does not block channel B
- [X] T053 [P] [US4] RED `backend/test/contract/blog/storefront-by-slug.test.ts` (extend) — resolution order data-model §5; redirect member `{ kind:'redirect', path, permanent:true }` only while `seo` is present, else 404; a key valid only in its language; `alternates.languages` lists only assigned languages of the channel with their effective keys; `xDefault` present
- [X] T054 [P] [US4] RED `backend/test/contract/blog/admin-url-keys.test.ts` — GET/PUT/DELETE for posts and categories; gates `blog.read`/`blog.write`; `redirects` omitted while `seo` is absent; 404 `BLOG_URL_REDIRECT_NOT_FOUND`; extend `backend/test/integration/blog/off-state.test.ts`: with the blog off the url-key endpoints and redirect resolution answer as absent
- [X] T055 [P] [US4] RED `storefront/test/content/blog-redirect-alternates.test.tsx` — a `redirect` resolution calls `permanentRedirect(path)` with noindex metadata; metadata `alternates.languages` come from the payload; the switcher (`HeaderPreferenceSwitchers`) links to the other language's key

### Implementation

- [X] T056 [US4] Contracts in `packages/contracts/src/blog.ts` (contracts/admin-api.md *URL keys*, storefront-api.md *by-slug*, error codes); `pnpm run build:packages`
- [X] T057 [US4] Migration `--module blog --name url_keys_and_redirects` (data-model §1.1–1.2); entities `blog-url-key.entity.ts`, `blog-url-redirect.entity.ts`; register; `composer:generate`
- [X] T058 [US4] `packages/modules/blog/src/backend/services/blog-url-key-service.ts` — pure `planUrlKeyWrite`, `#lockAndLoad` (advisory lock per (channel, language, key), sorted), `read`, `update` as Command `blog.url_keys.update`, `deleteRedirect` as Command `blog.url_redirect.delete`; invalidate the blog cache on success (pattern: `packages/modules/catalog/src/backend/services/url-key.service.ts`)
- [X] T059 [US4] Widen `packages/modules/blog/src/backend/services/blog-slug-collision.ts` to (channel, language, key) and call it from post/category create, slug patch and channel-membership changes with every effective key of the entity
- [X] T060 [US4] `packages/modules/blog/src/backend/services/blog-url-resolution.ts` — key → entity | redirect at (C, L) per data-model §5; used by `getBySlug`
- [X] T061 [US4] `blog-storefront-resolver.ts`: effective keys in every `url` (batch-load keys for a page of cards), `alternates` on post and category answers; soft-delete paths in the post/category services delete key and redirect rows
- [X] T062 [US4] Admin routes in `routes.admin.ts` (contracts/admin-api.md *URL keys*)
- [X] T063 [US4] Storefront: `storefront/lib/api/blog.ts` redirect member; `page.tsx` `permanentRedirect` + noindex; metadata `alternates` from the payload instead of `localizedAlternates`
- [X] T064 [US4] Admin UI: `packages/modules/blog/src/admin/components/UrlKeysPanel.tsx` (per-language key in the active `ContentLanguageTabs` tab, effective URLs, redirects with delete, takeover confirmation — pattern `packages/modules/catalog/src/admin/components/ProductUrlKeysPanel.tsx`) in `BlogPostEditor.tsx` and `BlogCategoryEditor.tsx`; the base slug stays in post settings; EN + PL strings

**Checkpoint**: quickstart §3 steps 3–5 pass.

---

## Phase 7: US5 — each language has its own blog address (P3) · slice S3

**Goal**: per-language prefixes.
**Independent test**: quickstart §1 with `en` → `news`.

### Tests first

- [X] T065 [P] [US5] RED `backend/test/integration/blog/url-prefix-validation.test.ts` (extend) — `blog.url_prefix_by_language`: non-object, unknown language of the channel, bad shape, reserved, language prefix, CMS segment → refused per contracts/routing-and-settings.md §4
- [X] T066 [P] [US5] RED `backend/test/integration/blog/url-prefix-history.test.ts` (extend) — per-language rows current/former; removing a language override makes its prefix former and the language falls back to the default
- [X] T067 [P] [US5] RED `storefront/test/seo/middleware-blog-routing.test.ts` (extend) — `/en/news` rewrites, `/en/aktualnosci/x` → 301 `/en/news/x`, `/pl/news/x` unchanged (not a Polish prefix)
- [X] T068 [P] [US5] RED `backend/test/contract/blog/storefront-urls.test.ts` (extend) — `en` URLs use `news`, `pl` URLs `aktualnosci`; `alternates` cross prefixes

### Implementation

- [X] T069 [US5] Setting `blog.url_prefix_by_language` (json, default `{}`) in `packages/modules/blog/src/manifest.ts` and `BLOG_SETTING_CODES` in contracts; `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only` if the manifest render moves
- [X] T070 [US5] `blog-settings-resolver.ts`: effective prefix per (channel, language); validator covers the new code; `syncFromSettings` writes language rows; routing `prefixes` per language
- [X] T071 [US5] Middleware step uses `routing.prefixes[lang]` (T025 already reads it; adjust if T025 used only `defaultPrefix`)
- [X] T072 [US5] Admin: per-language prefix inputs in `PrefixSettings.tsx` (one row per channel language, placeholder = default prefix); EN + PL strings *(2026-11-03: done as the **Blog → Addresses** screen (current + former prefixes, forget a former one); per-language prefixes are edited in Settings as the JSON setting `blog.url_prefix_by_language` — no dedicated form)*

**Checkpoint**: quickstart §1 and §3 pass in full. **S3 can merge.**

---

## Phase 8: US6 — an administrator has a public author profile (P4) · slice S4

**Goal**: avatar + per-language bio on administrators.
**Independent test**: quickstart §5 step 1 and step 5.

### Tests first

- [X] T073 [P] [US6] RED `packages/contracts/src/admin.test.ts` — `updateAdminUserSelfRequestSchema` / `updateAdminUserRequestSchema` accept `avatarAssetId` (uuid | null) and `bio` (record, ≤ 2000 per language, null); still `.strict()`; `adminUserSchema` carries both
- [X] T074 [P] [US6] RED `backend/test/contract/admin_users/me-profile.test.ts` — an admin without `admin_users:manage` sets own avatar and bio via `PATCH /api/v1/admin/me`; `GET /me` returns them and `avatarUrl`; unknown asset → 422 `ADMIN_USER_AVATAR_NOT_FOUND`; the `admin_user.update` audit entry carries both fields before/after; `PATCH /admin-users/:id` sets them for another admin with `admin_users:manage` only
- [X] T075 [P] [US6] RED `backend/test/integration/assets_library/admin-avatar-reference.test.ts` — an avatar asset is reported in use (kind `admin_user_avatar`, owner `admin_users`); clearing the avatar releases it; a soft-deleted admin's avatar no longer counts
- [X] T076 [P] [US6] RED `packages/admin-shell/src/modules/profile/ProfilePage.test.tsx` — avatar picker and one biography field per content language; diff-only PATCH includes them; EN/PL labels *(2026-11-03: no admin-shell test for the profile card; the API side is covered by `backend/test/integration/blog/author-lifecycle.test.ts`)*

### Implementation

- [X] T077 [US6] Contracts: `packages/contracts/src/admin.ts` (request/response fields, `ADMIN_USER_AVATAR_NOT_FOUND`), `packages/contracts/src/admin-users.ts` (`AdminUserRecord.avatarAssetId`, `.bio`, `AdminUserReadPort.findByAvatarAssetIds`); `pnpm run build:packages`
- [X] T078 [US6] Migration `--module admin_users --name author_profile` (`avatar_asset_id`, `bio`); entity fields in `packages/modules/admin_users/src/backend/entities/admin-user.entity.ts`; `composer:generate`
- [X] T079 [US6] `packages/modules/admin_users/src/backend/services/admin-user-service.ts` (`updateSelf`, `update`: new fields, avatar existence via lazily resolved `assetsLibraryPort`, `MODULE_DISABLED` while `assets_library` is off, audit before/after) and `admin-user-ports.ts` (record fields, `findByAvatarAssetIds`); `routes.admin.ts` serialiser + `avatarUrl` on `/me`
- [X] T080 [US6] Manifest edge: `assets_library` in `nonBindingDependencies` of `packages/modules/admin_users/src/manifest.ts` with the kind `module-composition.md` prescribes; run `pnpm --filter backend exec vitest run test/unit/db/module-graph.test.ts test/unit/db/fk-dependency-drift.test.ts`
- [X] T081 [US6] `packages/modules/assets_library/src/backend/`: register the `admin_user_avatar` descriptor at boot via `adminUserReadPort.findByAvatarAssetIds`
- [ ] T082 [P] [US6] Admin UI: avatar (`AssetFieldPicker`, `acceptMimePrefix="image/" allowUpload`) and biography per content language on `ProfilePage.tsx` and in `packages/modules/admin_users/src/admin/pages/AdminUsersPage.tsx`; EN + PL strings in the owning i18n bundles *(2026-11-03: the profile page only; the peer editor on `AdminUsersPage` does not show the fields yet — the API accepts them)*

**Checkpoint**: quickstart §5 steps 1 and 5 pass.

---

## Phase 9: US7 — a post shows its author (P4) · slice S4

**Goal**: author picker, storefront author, JSON-LD person.
**Independent test**: quickstart §5 steps 2–4.

### Tests first

- [X] T083 [P] [US7] RED `backend/test/contract/blog/author-candidates.test.ts` — gate `blog.write` (an editor without `admin_users:manage` gets 200); only active, non-deleted admins; `q` filters by name; no `email`, role or status in the body
- [X] T084 [P] [US7] RED `backend/test/integration/blog/author-lifecycle.test.ts` — assign an author; storefront post and cards carry name, avatar URL, bio in the request language → channel default → null; inactive author still shown; deleted author → `author: null`; a profile edit is visible on the next request **without** a cache invalidation; assigning an inactive or unknown admin → 422 `BLOG_AUTHOR_NOT_FOUND`; keeping an author who became inactive is allowed; `/posts?authorId=` filters
- [X] T085 [P] [US7] RED `storefront/test/content/blog-author.test.tsx` — author block on the post page and cards; no block when `author` is null; JSON-LD `author` `{ "@type": "Person", name, image }`

### Implementation

- [X] T086 [US7] Contracts: `blogAuthorCardSchema`, `blogAuthorSchema`, `author` on cards and resolved post, `authorAdminUserId` on create/patch, admin post `author` with `state`, `BLOG_AUTHOR_NOT_FOUND`; `pnpm run build:packages`
- [X] T087 [US7] Migration `--module blog --name post_author` (`blog_posts.author_admin_user_id` + index); `BlogPost.authorAdminUserId`; add `admin_users` to `dependencies` in `packages/modules/blog/src/manifest.ts`; `composer:generate`, `manifests:generate`
- [X] T088 [US7] `blog-post-service.ts`: validate and persist `authorAdminUserId` through `lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort')`; admin read returns `author` with `state`
- [X] T089 [US7] `packages/modules/blog/src/backend/services/blog-author-resolver.ts` — batched `findByIds` per request, deleted → null, bio fallback, avatar URL via the existing `resolveAssetUrl`; applied in `blog-storefront-resolver.ts` **after** the cache read (cache holds `authorId` only); `authorId` filter in `listPosts`
- [X] T090 [US7] `GET /api/v1/admin/blog/author-candidates` in `routes.admin.ts`
- [X] T091 [P] [US7] Admin: `packages/modules/blog/src/admin/components/AuthorPicker.tsx` in `BlogPostEditor.tsx` (search, avatar, "inactive" and "author deleted" states); EN + PL strings
- [X] T092 [P] [US7] Storefront: author block in `storefront/app/blog/_components/BlogPostPage.tsx` and `PostCard.tsx`, JSON-LD `author`; `LatestPosts` card shows the author when present; EN + PL strings in the storefront message bundles

**Checkpoint**: quickstart §5 passes. **S4 can merge.**

---

## Phase 10: Documentation and release intent (per slice)

- [X] T093 [P] `packages/modules/blog/docs/blog/index.md`: prefix and per-language prefixes, former addresses, pagination, language existence and the publish guard, URL keys and redirects (with `seo`), authors (`specs/conventions/module-documentation.md`)
- [X] T094 [P] Polish mirror under `docs/i18n/pl/docusaurus-plugin-content-docs/current/` and `docs/translation-cache/pl/`; `pnpm --filter backend run check:docs-translations` (`docs/docs/contributing/documentation-i18n.md`)
- [X] T095 [P] `admin_users` docs: profile avatar and biography (EN + PL)
- [X] T096 [P] Upgrade note in `docs/docs/upgrading-an-instance.md` (+ PL): S1 — a custom prefix now takes effect and `/blog` redirects; S3 — posts disappear from languages they are assigned to but not written in (quickstart §4 query), publication now requires complete languages
- [X] T097 Changesets per slice (`.changeset/171-blog-<slice>.md`, `specs/conventions/release-intent.md`): `@endora-commerce/contracts` and every package whose published output changes (blog, cms, cms-components, admin_users, assets_library, admin-shell); operator sentence from T096 in the body; `pnpm --filter backend run check:release-intent -- --since origin/master`
- [X] T098 Regenerate and commit generated artefacts the slice moved: `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` (no dependency added — the lockfile must not move)

---

## Phase 11: Verification (per slice)

- [X] T099 Trap sweep (AGENTS.md): `command grep -rn "BLOG_PREFIX\|'/blog\|latestPosts\|assertValidPrefix" backend/test storefront/test packages --include='*.ts' --include='*.tsx'` — no stale expectation left in trees `test:unit:fast` does not reach *(2026-11-03: run once for the whole branch)*
- [X] T100 `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint && pnpm run check:naming && pnpm run check:language` (compare `check:naming` against master on macOS — local awk failure is known)
- [X] T101 Targeted backend runs: `backend/test/{unit,contract,integration}/blog`, `…/admin_users`, `…/cms`, `…/assets_library` as the slice touched; then `pnpm --filter '!backend' run test`
- [ ] T102 Walk the slice's quickstart sections on a local stack and record what was checked by hand vs by test
- [X] T103 Check-estate: if a recorded read size moved outside its band, follow `specs/conventions/check-estate.md` (re-measure, never widen)

---

## Dependencies

- Phase 1 → Phase 2 → every story.
- **US1** (Phase 3) depends on Phase 2 only.
- **US2** (Phase 4) depends on Phase 2. Its `authorId` filter is completed by T089.
- **US3** (Phase 5) depends on Phase 2.
- **US4** (Phase 6) depends on US3, which defines which languages exist.
- **US5** (Phase 7) depends on US1, which provides the routing, validator and history.
- **US6** (Phase 8) depends on Phase 1 only. It touches no blog code.
- **US7** (Phase 9) depends on US6 and Phase 2.
- **Merge order** follows OR-1: S1 → S2 → S3 → S4.
- Phase 10 tasks belong to each slice. T097 runs last before Phase 11.

## Parallel examples

- Phase 2: T004 ∥ T006, then T008 after T007.
- Phase 3: T011–T017 (all RED) in parallel. T026, T028 and T029 in parallel after T010.
- Phase 6: T050–T055 in parallel.
- **US6 can be built in parallel with S1–S3** in a separate worktree, because it touches no blog code.
- Phase 8: T073–T076 in parallel. T082 runs after T079.

## Requirement → test traceability

| FR | Tests |
| --- | --- |
| FR-001, FR-003, FR-004 | T013, T015 |
| FR-002 | T004, T008, T016, T017 |
| FR-010 … FR-013 | T031, T032, T033 |
| FR-014 | T034 |
| FR-020, FR-021 | T042, T044 |
| FR-022 | T043 |
| FR-030 … FR-033 | T051, T052, T053, T054 |
| FR-034 | T053, T055 |
| FR-040, FR-041 | T011, T014, T065 |
| FR-042 | T012, T066 |
| FR-050, FR-052 | T074, T076 |
| FR-051 | T075 |
| FR-060, FR-061 | T083, T084 |
| FR-062, FR-063, FR-064 | T084, T085 |
| FR-065 | T085 |
| FR-066 | T083 (through the port; no blog SQL names `admin_users` — `check:module-boundary`) |
| FR-070 | T030, T049, T064, T072, T082, T091, T092 (each with EN + PL strings) |
| FR-071 | T012, T052 (Command + one audit entry) |
| FR-072 | T013, T054 (`off-state.test.ts`), T014, T015 |
| FR-073 | T093–T096 |
