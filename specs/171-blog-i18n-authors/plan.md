# Implementation Plan: Blog — operator prefix, pagination, per-language URLs and authors

**Branch**: `feat/171-blog-i18n-authors` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/171-blog-i18n-authors/spec.md`

## Summary

The work extends the `blog` module in four independently shippable slices, in the owner's order
(OR-1):

1. **The storefront honours the operator's blog prefix.**
   - The middleware maps the public prefix onto the fixed `app/blog` route.
   - Every blog URL is built by the backend with one helper, `blogPath`, on top of 167's
     `storefrontPagePath`.
   - The never-wired prefix validator is registered.
2. **Pagination.**
   - `GET /api/v1/blog/posts` gains `page`, `perPage`, `tagCode`, `authorId` and a `pagination`
     block.
   - The storefront index is paginated.
3. **Per-language URLs.**
   - The storefront honours `blog_post_languages` / `blog_category_languages`, answering 404 outside
     them.
   - A publish guard enforces complete languages.
   - Posts and categories get per-language URL keys with redirects, mirroring the catalog's 163 model
     without its channel overrides.
   - The prefix becomes per language, with former prefixes redirecting.
4. **Authors.**
   - Administrators get an avatar and a per-language biography.
   - A post names one administrator as author, resolved through `adminUserReadPort` after the cache
     read, so a profile edit is visible at once.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, ioredis (blog cache),
Next.js 15 (storefront middleware/App Router), React 19 admin. **No new dependency.**
**Storage**: PostgreSQL. 3 new blog tables, 1 new blog column, 2 new `admin_users` columns; Redis
blog cache (existing)
**Testing**: Vitest. Backend unit/contract/integration under `backend/test/{unit,contract,integration}/blog`
and `…/admin_users`; co-located `*.test.ts` in the modules; storefront Vitest (`storefront/test/content`,
middleware tests); admin Vitest
**Target Platform**: Linux server (backend), Next.js storefront, Vite admin
**Project Type**: web — modular monorepo (packages/modules + backend composition + admin + storefront)
**Performance Goals**:
- A blog storefront read stays one cached payload plus at most one batched author read per request.
- The listing count comes from a window function in the page query, not a second query.
- The middleware adds no request-time backend call beyond the 60 s per-channel cache.

**Constraints**:
- Additive API changes only (Principle II).
- The blog off behaves as absent, including redirects (XVII).
- Channel-confined reads (XII).
- New writes are Commands (XIII).

**Scale/Scope**: hundreds to low thousands of posts per channel, 2–5 languages per channel

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 (below).*

| Principle | Assessment |
| --- | --- |
| I. Modular (NN) | Pass. Blog reads administrators only through `adminUserReadPort`. CMS learns blog prefixes through a CMS-owned registry the blog contributes to (the edge already points blog → cms). `assets_library` registers the avatar reference itself, avoiding an `admin_users` → `assets_library` cycle (research R9). |
| II. API-first | Pass. Every shape goes into `packages/contracts` first (`contracts/*.md`). Changes are additive; `latestPosts` and `limit` are kept. |
| III. TDD (NN) | Pass by plan. Each FR maps to a failing test first (see *Test map*). |
| IV. YAGNI | Pass. No dependency. The catalog's channel × language key override is deliberately not copied (research R6). There is no author event (research R10). |
| V/VI/VIII | Pass. English identifiers; table/column names follow `blog_*` / snake_case; strings ship EN + PL. |
| VII. SEO | **Improves.** Per-language URLs, `hreflang` from real alternates, 301s for former keys/prefixes, `Person` author in JSON-LD, 404 instead of wrong-language duplicates. Pages stay SSR. |
| IX. UI reuse | Pass. `AssetFieldPicker`, `ContentLanguageTabs`, the catalog URL-keys panel pattern, and the existing settings panel. |
| X. Queues | N/A. No long-running work. |
| XI. Tenancy (NN) | Pass. Blog and admin users are platform-global (`@GlobalEntity`), as today. No organisation-scoped data is touched. |
| XII. Channel scoping (NN) | Pass. Every storefront read and the key probe are confined to the resolved channel. The routing endpoint answers one channel. Cross-channel tests are required (*Test map*). `blog_url_prefixes.sales_channel_id` is not a membership bridge. |
| XIII. Command Bus (NN) | **Pass with a recorded boundary.** New writes (`blog.url_keys.update`, `blog.url_redirect.delete`, `blog.url_prefix.forget`) are Commands. New *fields* on existing un-migrated writes (post patch; `admin_user.update`) stay on those paths, which the principle's incremental-migration clause allows. Spec FR-052/FR-071 are narrowed accordingly. |
| XIV. Custom fields | N/A. These are first-class fields owned by the modules' own UIs, not "add a field" requests. |
| XV. Untouched core | N/A. Core feature work, no overlay. |
| XVI. Palette | Pass. No new screen; existing blog and profile screens stay reachable. |
| XVII. Toggleable (NN) | Pass. Routing endpoint, rewrites, redirects, keys and the author UI are absent with the blog off. The CMS registry skips an off contributor. The avatar field reports `MODULE_DISABLED` with `assets_library` off. Off-state tests are required. |

**Post-design re-check (after Phase 1)**: unchanged. The only new cross-module edges are
blog → admin_users (`dependencies`) and admin_users ⇢ assets_library (`nonBindingDependencies`, lazy at
request time). Neither creates a cycle.

## Spec amendments made by this plan

Recorded in `spec.md` and justified in `research.md`:

| FR | Change |
| --- | --- |
| FR-010 | Default page size without `perPage`/`limit` stays 6 (back-compat). (R12) |
| FR-022 | Completeness is enforced at publication, not on draft saves. (R8) |
| FR-030 | No channel × language key override. (R6) |
| FR-052, FR-071 | Only new writes are Commands; new fields ride existing write paths. (R11) |

## Project Structure

### Documentation (this feature)

```text
specs/171-blog-i18n-authors/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R1–R13, findings F1–F6
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── storefront-api.md
│   ├── admin-api.md
│   ├── routing-and-settings.md
│   └── ports.md
├── checklists/requirements.md
└── tasks.md                        # /speckit.tasks
```

### Source Code (repository root)

```text
packages/contracts/src/
├── blog.ts                         # blogPath, pagination query/response, author/alternates/redirect schemas, url-key + routing schemas, error codes
├── admin.ts                        # adminUser + update request schemas: avatarAssetId, bio
└── admin-users.ts                  # AdminUserRecord fields, findByAvatarAssetIds

packages/modules/blog/
├── src/manifest.ts                 # + blog.url_prefix_by_language, + admin_users dependency
├── src/migrations/                 # url keys, url redirects, url prefixes, posts.author_admin_user_id
├── src/backend/
│   ├── entities/                   # BlogUrlKey, BlogUrlRedirect, BlogUrlPrefix; BlogPost.authorAdminUserId
│   ├── services/
│   │   ├── blog-url-key-service.ts         # new — probe, plan, apply (Command)
│   │   ├── blog-url-resolution.ts          # new — key → entity | redirect at (C, L)
│   │   ├── blog-url-prefix-service.ts      # new — validator, prefix history, routing read
│   │   ├── blog-author-resolver.ts         # new — batched author enrichment
│   │   ├── blog-storefront-resolver.ts     # language filter, pagination, urls, alternates, author ids
│   │   ├── blog-post-service.ts            # author field, publish guard, key-aware slug probe
│   │   ├── blog-category-service.ts        # name-per-language guard, key-aware probe
│   │   ├── blog-slug-collision.ts          # widened to (channel, language, key)
│   │   ├── blog-settings-resolver.ts       # per-language prefix resolution
│   │   └── blog-cache.ts                   # page/perPage/filter key parts
│   ├── routes.storefront.ts        # /posts pagination, /by-channel page, /routing, redirect resolution
│   ├── routes.admin.ts             # url-keys, redirects, author-candidates, addresses
│   └── index.ts                    # validator + CMS contributor registration, routing deps
├── src/admin/
│   ├── pages/BlogPostEditor.tsx    # per-language key, redirects, author picker
│   ├── pages/BlogCategoryEditor.tsx
│   └── components/{UrlKeysPanel,AuthorPicker,PrefixSettings}.tsx
├── i18n/{en,pl}.json
└── docs/blog/index.md (+ PL translation)

packages/modules/admin_users/
├── src/migrations/                 # avatar_asset_id, bio
├── src/backend/entities/admin-user.entity.ts
├── src/backend/services/{admin-user-service.ts,admin-user-ports.ts}
└── src/manifest.ts                 # nonBindingDependencies: assets_library

packages/admin-shell/src/modules/profile/ProfilePage.tsx    # avatar + bio section
packages/modules/admin_users/src/admin/pages/AdminUsersPage.tsx   # same fields for others
packages/modules/assets_library/src/backend/                # admin_user_avatar reference descriptor
packages/modules/cms/src/backend/                           # cmsReservedSegmentRegistry, CmsPageReadPort.firstSegmentsInChannel
packages/cms-components/src/components/LatestPosts.tsx      # card url/author

storefront/
├── middleware.ts                   # blog routing step
├── lib/blog/blog-routing.ts        # createChannelCache over /api/v1/blog/routing
├── lib/api/blog.ts                 # pagination params, redirect member, module-off on all reads
├── app/blog/[[...slug]]/{page.tsx,seo.ts}
├── app/blog/_components/*          # payload urls, author block, page-past-end 404
├── app/sitemap.ts, lib/seo/llms-txt-*.ts
└── test/…

backend/test/{unit,contract,integration}/blog/, …/admin_users/, …/cms/
backend/src/db/migrations-registry.generated.ts   # composer:generate
```

**Structure Decision**: the existing modular layout. All domain work sits in the owning modules
(`blog`, `admin_users`, `assets_library`, `cms`), shapes in `packages/contracts`, and routing in the
storefront middleware. No new package.

## Delivery slices (one merge request each, in order)

| Slice | Stories | Notes |
| --- | --- | --- |
| S1 | US1 | Independently valuable bugfix. Introduces `blogPath`, `/routing`, the middleware step, the validator and `blog_url_prefixes` (default-language rows only). |
| S2 | US2 | Contract + resolver + storefront index pagination. |
| S3 | US3, US4, US5 | Language filter + publish guard, then keys/redirects, then per-language prefixes. US3 can merge alone. |
| S4 | US6, US7 | `admin_users` fields first (US6), then the blog author (US7). |

Each slice regenerates `composer:generate` / `manifests:generate` when it adds a migration or a
manifest edge, ships its changesets (`specs/conventions/release-intent.md`), and updates the EN + PL
docs it touches.

## Test map (failing first)

| FR | Test (new unless noted) |
| --- | --- |
| FR-001–004 | `storefront/test/seo/middleware-blog-routing.test.ts` (rewrite, 301 from `/blog`, former prefix, routing absent → unchanged); `storefront/test/content/blog.test.tsx` (payload urls only); `backend/test/contract/blog/storefront-routing.test.ts` |
| FR-002 | `packages/contracts/src/blog-path.test.ts`; crawl assertion in `storefront/test/content/blog-links.test.tsx` |
| FR-010–013 | `backend/test/contract/blog/posts-list.test.ts` (extend), `…/integration/blog/pagination.test.ts` (extend: stable order, totals, filters, cross-channel) |
| FR-014 | storefront index/category/tag past-last-page 404 |
| FR-020–022 | `backend/test/integration/blog/language-existence.test.ts` (every read path, `en-US`→`en`, cross-channel), `…/publish-guard.test.ts` |
| FR-030–034 | `blog-url-key-service.test.ts` (co-located; plan purity), `…/integration/blog/url-keys.test.ts` (uniqueness across kinds, takeover, redirects, seo off, membership change), `…/contract/blog/storefront-by-slug.test.ts` (extend: redirect member, alternates) |
| FR-040–042 | `…/integration/blog/url-prefix-validation.test.ts` (extend: wired through settings write), `…/integration/blog/url-prefix-history.test.ts`, `…/integration/cms/reserved-segment-contributors.test.ts` |
| FR-050–052 | `…/contract/admin_users/me-profile.test.ts`, `…/integration/assets_library/admin-avatar-reference.test.ts` |
| FR-060–066 | `…/contract/blog/author-candidates.test.ts` (no e-mail, `blog.write` only), `…/integration/blog/author-lifecycle.test.ts` (inactive shown, deleted hidden, edit visible without cache bust) |
| FR-072 | `…/integration/blog/off-state.test.ts` (extend: routing, redirects, keys) |

## Risks

- **Stale routing for 60 s after a prefix change.** Accepted. This is the same window as 167's
  languages; the former-prefix redirect covers links followed in that window.
- **Published posts assigned to a language they were never written in will disappear from it.**
  Quickstart §4 lists them before deploy, and the changeset calls it out.
- **`admin_users` ⇢ `assets_library` non-binding edge.** It needs the right `nonBindingDependencies`
  kind. Verify against `module-composition.md` and `test/unit/db/module-graph.test.ts` in S4.
- **Recorded read sizes.** New files move check-estate read sizes. Follow
  `specs/conventions/check-estate.md` and do not widen bands.

## Complexity Tracking

No constitution violations to justify. The narrowings above are recorded as spec amendments, not
violations.
