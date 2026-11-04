# Data Model: Blog — operator prefix, pagination, per-language URLs and authors

**Feature**: `specs/171-blog-i18n-authors/` | **Date**: 2026-11-03

All new blog tables are `@GlobalEntity()` like the rest of the module (blog content is channel-scoped,
not organisation-scoped). Migrations are scaffolded per module with
`pnpm --filter backend run migration:new -- --module <id> --name <slug>`
(`specs/conventions/module-migrations.md`); no number is chosen by hand.

## 1. `blog` module

### 1.1 `blog_url_keys` (new) — US4

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `entity_kind` | varchar(16) | `post` \| `category` (check constraint) |
| `entity_id` | uuid | `blog_posts.id` or `blog_categories.id`; no FK (two targets) — the services delete rows with the entity |
| `language_code` | varchar(16) | |
| `key` | varchar(160) | `blogSlugSchema` shape |
| `created_at`, `updated_at` | timestamptz | |

Indexes: unique `(entity_kind, entity_id, language_code)`; plain `(language_code, key)`.

Rules:
- At most one key per entity and language.
- The **effective key** at (channel C, language L) is the L row, else the entity's `slug`.
- Uniqueness per (C, L) across posts and categories counts:
  - current keys;
  - the `slug` of an entity without an L row;
  - `blog_url_redirects` rows of L.

  This is enforced by the URL-key service under `pg_advisory_xact_lock` per (C, L, key). No index
  can express it.
- Changing an entity's channel membership re-runs the probe for every effective key of the entity
  (the existing `assertSlugAvailable` call sites widen to keys).
- A row whose language the entity no longer has stays and keeps its key reserved (as 163 FR-070).

### 1.2 `blog_url_redirects` (new) — US4

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `entity_kind` | varchar(16) | `post` \| `category` |
| `entity_id` | uuid | target entity, never a key — redirects never chain |
| `language_code` | varchar(16) | the language the former key was valid in |
| `key` | varchar(160) | |
| `created_at` | timestamptz | |

Indexes: unique `(language_code, key, entity_kind, entity_id)`; plain `(language_code, key)`, `(entity_kind, entity_id)`.

Lifecycle:
- **Created** when a key is replaced: the former key becomes a redirect in its language. It is also
  created when an entity gets its first key in L: its `slug` becomes a redirect in L only.
- **Removed** in any of these cases:
  - an editor deletes it;
  - another entity takes the key after `confirmTakeover`;
  - the entity claims it back;
  - the entity is soft-deleted.

### 1.3 `blog_url_prefixes` (new) — US1, US5

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sales_channel_id` | uuid | |
| `language_code` | varchar(16) null | null = the channel default (`blog.url_prefix`) |
| `prefix` | varchar(64) | |
| `state` | varchar(8) | `current` \| `former` |
| `created_at` | timestamptz | `replaced_at` is `updated_at` for a `former` row |
| `updated_at` | timestamptz | |

Indexes:
- unique `(sales_channel_id, coalesce(language_code, ''))` where `state = 'current'`;
- unique `(sales_channel_id, coalesce(language_code, ''), prefix)`.

Lifecycle:
- **Seeded** by the blog's install hook from the resolved settings.
- **Maintained** by the `settings.value_changed` subscriber for `blog.url_prefix` and
  `blog.url_prefix_by_language`:
  - the stored `current` row whose prefix differs becomes `former`, and a new `current` row is
    inserted;
  - a `former` row equal to the new prefix is deleted first.
- **Deleted**, for a `former` row, by the `blog.url_prefix.forget` Command.
- `blog` is never stored as `former`: it always redirects (research R1).

`sales_channel_id` is a plain uuid like the existing `blog_*_sales_channels` columns; it is not a
membership bridge.

### 1.4 `blog_posts` (changed) — US7

| Column | Change |
| --- | --- |
| `author_admin_user_id` | **new**, uuid null, no FK (cross-module; read through `adminUserReadPort`). Indexed for the `authorId` filter. |

Entity `BlogPost` gains `authorAdminUserId?: string | null` (optional prop).

### 1.5 `blog_post_languages`, `blog_category_languages` (unchanged schema, new meaning) — US3

They become the storefront's existence rule (research R8). Nothing is migrated. A one-off report
query (quickstart §4) lists published posts with an assigned language that has no name or content,
for operators to fix before or after deploy.

### 1.6 Settings (blog manifest)

| Code | valueType | Default | Scope | New? |
| --- | --- | --- | --- | --- |
| `blog.url_prefix` | string | `blog` | channel subset | existing; validator now wired |
| `blog.url_prefix_by_language` | json `{ [languageCode]: prefix }` | `{}` | channel subset | **new** |
| `blog.posts_per_page` | number | 12 | channel subset | existing; now also the index page size |
| `blog.latest_count` | number | 5 | channel subset | existing; only the `blog.LatestPosts` default |

The effective prefix at (C, L) is `url_prefix_by_language[L]`, else `url_prefix`.

## 2. `admin_users` module

### 2.1 `admin_users` (changed) — US6

| Column | Change |
| --- | --- |
| `avatar_asset_id` | **new**, uuid null — a library asset |
| `bio` | **new**, jsonb null — `{ [languageCode]: string }`, each ≤ 2000 characters |

`AdminUser` gains `avatarAssetId?: string | null`, `bio?: Record<string, string> | null`.

### 2.2 `AdminUserRecord` / `AdminUserReadPort` (`packages/contracts/src/admin-users.ts`)

- `AdminUserRecord` gains `avatarAssetId: string | null` and `bio: Record<string, string> | null`.
- `AdminUserReadPort` gains `findByAvatarAssetIds(assetIds: string[]): Promise<AdminUserRecord[]>`,
  which `assets_library` uses for references (research R9).

## 3. `assets_library` module

New reference descriptor kind `admin_user_avatar`, owner module `admin_users`, registered by
`assets_library` at boot from `adminUserReadPort.findByAvatarAssetIds` (research R9). No schema change.

## 4. `cms` module

New in-process registry `cmsReservedSegmentRegistry`, populated with
`{ contributorModuleId, segmentsFor(salesChannelId): Promise<string[]> }`. No schema change. Consulted
by `assertSlugNotReserved` and the page list's shadowed marker.

## 5. State and rules summary

```text
Post existence at (C, L):
  member of C (blog_post_sales_channels, not deleted)
  ∧ status = published ∧ active ∧ not deleted
  ∧ L ∈ blog_post_languages            ← new on the storefront

Effective key at (C, L) = blog_url_keys[L] ?? slug

Resolve key k at (C, L):
  1. entity with blog_url_keys[L] = k            → render
  2. entity without an L key and slug = k        → render
  3. blog_url_redirects[L] = k                   → 301 effective URL   (seo present)
  4. entity with an L key and slug = k           → 301 effective URL   (seo present)
  otherwise                                       → 404

Publish guard: ∀ L ∈ languages: name[L] ≠ '' ∧ effective key ∧ content.languages[L] non-empty
```
