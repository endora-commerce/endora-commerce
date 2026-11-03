# Feature Specification: Blog — operator prefix, pagination, per-language URLs and authors

**Feature Branch**: `feat/171-blog-i18n-authors`
**Created**: 2026-11-03
**Status**: Planned
**Input**: Owner request (2026-11-03): *"Add a post author picked from the administrators, with an
avatar and an 'about me' field on the administrator profile; a different slug, and so a different
URL, per language; a 404 when a post has no version in the requested language; pagination on the
post-listing endpoint; a blog address per language (for example `/aktualnosci` in Polish, `/news`
in English)."* — plus the owner's rulings recorded below.

**Related**: `specs/167-storefront-locale-path/` (language prefix in the storefront path; its
*Out of Scope* excluded per-language blog slugs and translated route segments — this feature
widens that deliberately, OR-6), `specs/163-product-data-scopes/` (per-language product URL keys
and redirects — the model reused here), `specs/163-page-builder-marketing-pages/`
(`blog.LatestPosts` block and `GET /api/v1/blog/posts`), `specs/166-asset-reference-visibility/`
(asset references), feature 016 (the blog module itself; pre-migration, cited for provenance).

## Context

The blog module (`packages/modules/blog`) serves an index, category, post and tag views per sales
channel. Measured on `master` at `d31bab44b`:

- **The operator's URL prefix is not honoured.** `blog.url_prefix` is a per-channel setting, but
  the storefront route is the fixed directory `storefront/app/blog/` and six storefront components
  link through a constant `BLOG_PREFIX = '/blog'`. Only the sitemap and the backend-built
  breadcrumbs read the setting, so a channel set to `aktualnosci` advertises URLs that answer 404
  while its cards keep linking to `/blog`.
- **Slugs are one per post or category**, mirrored per channel; there is no per-language slug.
- **Language assignment is not enforced on the storefront.** A post's languages
  (`blog_post_languages`) filter only the admin list; the storefront resolver falls back to any
  authored language, so a post written only in Polish renders under `/en/…`.
- **`GET /api/v1/blog/posts` has no pagination** (`limit` ≤ 24 only, no page, no total), and the
  blog index shows a fixed `latestCount` with no further pages.
- **There is no author.** An administrator has a name and e-mail only — no avatar, no biography.

## Owner rulings *(binding; recorded 2026-11-03, not to be reopened by this feature)*

- **OR-1 — Delivery order.** (1) the storefront honours the prefix, (2) pagination, (3)
  per-language URLs, the language 404 and the per-language prefix, (4) authors. Each user story
  below is shippable on its own in that order.
- **OR-2 — One author, an administrator.** A post has at most one author, chosen from the
  platform's administrators. No co-authors, no guest authors in this feature.
- **OR-3 — Author profile fields live on the administrator.** Avatar (one library asset, the same
  in every language) and biography (per language). A biography missing in the request language
  falls back to the channel's default language, and is otherwise not shown — never a 404.
- **OR-4 — Author lifecycle.** An inactive administrator is still shown as the author of their
  posts. A deleted administrator is not shown: the post renders without an author, and no copy of
  the name is kept (no personal data outlives the account).
- **OR-5 — Paginated index.** The blog index is paginated with the channel's `postsPerPage`;
  category tiles appear on page 1 only; `latestCount` remains only as the default of the
  `blog.LatestPosts` block. A page past the last one is a 404, on the index, category and tag
  views alike.
- **OR-6 — Translated blog prefix, narrowly.** The operator may set the blog prefix per language of
  a channel (for example `aktualnosci` for Polish, `news` for English). Only this operator-set
  segment is translated; the fixed sub-segments `tag/` and `author/` stay as they are, and no other
  storefront route is translated. This deliberately widens 167's *Out of Scope*.
- **OR-7 — A post exists in a language when the language is assigned to it.** Saving a post
  requires a name, a slug and content for every assigned language; a post is reachable and listed
  only in its assigned languages. Categories likewise.
- **OR-8 — Former URLs redirect.** A changed prefix and a changed slug answer a permanent redirect
  to the current URL.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The blog lives at the address the operator set (Priority: P1)

An operator sets the blog prefix of a channel to `aktualnosci`. Every blog page of that channel is
served under `/aktualnosci` (after the language prefix where 167 adds one), every link the platform
emits to the blog uses it, and the old `/blog` address redirects.

**Why this priority**: the setting exists and is broken today; every later story builds its URLs on
the same path helper, so this one comes first.

**Independent Test**: set the prefix of one channel to `aktualnosci`, crawl the blog of that
channel, and assert every page answers 200 at the prefixed path and every blog link in the HTML,
the sitemap and `llms.txt` uses it.

**Acceptance Scenarios**:

1. **Given** a channel with prefix `aktualnosci`, **When** a visitor opens `/aktualnosci`,
   `/aktualnosci/<category>`, `/aktualnosci/<post>` and `/aktualnosci/tag/<code>`, **Then** each
   renders the corresponding view.
2. **Given** the same channel, **When** a visitor opens `/blog/<post>`, **Then** the answer is a
   301 to `/aktualnosci/<post>`.
3. **Given** the same channel, **When** the index, a category, a post, a tag page, a
   `blog.LatestPosts` block, the sitemap and `llms.txt` are rendered, **Then** every blog link and
   every breadcrumb and canonical URL begins with `/aktualnosci` (prefixed by the language where
   167 requires it).
4. **Given** a channel left on the default `blog`, **When** any of the above is rendered, **Then**
   it is byte-for-byte what it is today.
5. **Given** an operator changing the prefix from `aktualnosci` to `wiadomosci`, **When** a visitor
   opens a former `/aktualnosci/<post>` URL, **Then** it is a 301 to `/wiadomosci/<post>`.

---

### User Story 2 — Posts can be listed page by page (Priority: P2)

A frontend (a custom storefront, a page-builder block, a headless client) lists the posts of a
channel page by page, optionally filtered, and knows how many pages there are. The storefront's
blog index is paginated the same way.

**Why this priority**: a small, self-contained contract change that unblocks headless consumers.

**Independent Test**: with 30 published posts in a channel, request `GET /api/v1/blog/posts` page
by page and assert the pages partition the posts in publication order and the totals are correct.

**Acceptance Scenarios**:

1. **Given** 30 published posts and `perPage=12`, **When** pages 1, 2 and 3 are requested,
   **Then** they hold 12, 12 and 6 posts, newest first, none repeated, and each answer states
   `page`, `perPage`, `totalItems = 30` and `totalPages = 3`.
2. **Given** the same posts, **When** page 4 is requested, **Then** the answer is an empty list
   with the same totals (the API), while the storefront index at `?page=4` answers 404.
3. **Given** a request filtered by category, tag or author, **When** it is paginated, **Then** the
   totals count only the matching posts.
4. **Given** an existing caller that sends only `limit`, **When** it calls the endpoint, **Then**
   it receives the same first posts as before; the response gains `pagination` beside `data`.
5. **Given** the storefront blog index, **When** a visitor opens `?page=2`, **Then** posts 13–24
   are shown, without the category tiles, with a self-referencing canonical URL.

---

### User Story 3 — A post is shown only in the languages it was written for (Priority: P3)

An editor publishes a post in Polish only. Polish visitors see it; under the English prefix the
post's URL answers 404 and no English listing shows it.

**Why this priority**: today an English visitor gets Polish content under an English URL, which
search engines index as a duplicate.

**Independent Test**: publish a post assigned to Polish only in a channel with Polish and English,
then request it and every listing in both languages.

**Acceptance Scenarios**:

1. **Given** a post assigned to Polish only, **When** it is requested in English, **Then** the
   answer is 404.
2. **Given** the same post, **When** the English index, its categories, its tags, the
   `blog.LatestPosts` block, related-post strips and the sitemap are rendered in English, **Then**
   it appears in none of them.
3. **Given** a category assigned to Polish only, **When** it is requested in English, **Then** the
   answer is 404 and it is not offered as a tile, a chip or a breadcrumb in English.
4. **Given** an editor assigning English to a post, **When** the English name, slug or content is
   missing, **Then** the save is refused naming the missing field and language.
5. **Given** a request whose language is written as a regional variant (`en-US`) of an assigned
   `en`, **When** it is resolved, **Then** it matches, by the platform's language-matching rule.

---

### User Story 4 — Each language has its own post and category address (Priority: P3)

An editor gives the Polish version of a post the slug `jak-wybrac-wiertarke` and the English
version `how-to-choose-a-drill`. Each language is reachable at its own URL, the language switcher
and `hreflang` link the versions to each other, and changing a slug keeps the old URL working.

**Why this priority**: the core SEO ask; it depends on story 3's rule of which languages exist.

**Independent Test**: give a post different slugs in two languages, open both, follow the language
switcher, read `hreflang`, then rename one slug and open the former URL.

**Acceptance Scenarios**:

1. **Given** a post with Polish slug `jak-wybrac-wiertarke` and English slug
   `how-to-choose-a-drill`, **When** `/pl/blog/jak-wybrac-wiertarke` and
   `/en/blog/how-to-choose-a-drill` are opened, **Then** each renders the post in its language.
2. **Given** the same post, **When** its Polish slug is requested under the English prefix,
   **Then** the answer is 404 (a slug is valid only in its own language).
3. **Given** the same post, **When** the Polish page is rendered, **Then** its `hreflang`
   alternates and the language switcher point to the English slug, and to no language the post is
   not assigned to.
4. **Given** an editor renaming the Polish slug, **When** a visitor opens the former Polish URL,
   **Then** it is a 301 to the new one; redirects never chain.
5. **Given** a post that existed before this feature with slug `wiertarki`, **When** no
   per-language slug was set, **Then** `wiertarki` keeps serving in every assigned language.
6. **Given** two posts, or a post and a category, **When** an editor gives them the same slug in
   the same channel and language, **Then** the save is refused; the same slug in different
   languages is allowed.

---

### User Story 5 — Each language has its own blog address (Priority: P3)

An operator sets the blog prefix of a channel to `aktualnosci` for Polish and `news` for English.

**Why this priority**: completes per-language URLs; reuses story 1's routing.

**Independent Test**: set two per-language prefixes and crawl the blog in both languages.

**Acceptance Scenarios**:

1. **Given** prefixes `aktualnosci` (Polish) and `news` (English), **When** `/pl/aktualnosci` and
   `/en/news` are opened, **Then** each is the blog index in its language.
2. **Given** the same channel, **When** `/en/aktualnosci/<post>` is opened, **Then** it is a 301 to
   the post's English URL if the post has English, otherwise 404.
3. **Given** a language without its own prefix, **When** its blog is rendered, **Then** it uses
   the channel's default prefix.
4. **Given** an operator entering a prefix equal to a reserved storefront segment, a language
   prefix of any channel, or a CMS page's first slug segment in that channel, **When** saving,
   **Then** the save is refused naming the conflict.

---

### User Story 6 — An administrator has a public author profile (Priority: P4)

An administrator uploads an avatar and writes an "about me" text, in each content language, on
their own profile page.

**Why this priority**: prerequisite of story 7, no storefront effect on its own.

**Independent Test**: as an administrator without `admin_users:manage`, edit the own profile's
avatar and biography and read them back.

**Acceptance Scenarios**:

1. **Given** an administrator on their profile page, **When** they pick an avatar from the asset
   library (or upload one) and write a biography in Polish and English, **Then** both are saved and
   shown on the next visit.
2. **Given** an administrator managing other administrators, **When** they edit another
   administrator, **Then** they can set the same fields.
3. **Given** an avatar asset in use by a profile, **When** someone tries to delete the asset,
   **Then** the deletion is refused or warned exactly as for any other referenced asset.

---

### User Story 7 — A post shows its author (Priority: P4)

An editor picks the author of a post from a list of administrators; the storefront shows the
author's name, avatar and biography on the post page and on post cards.

**Why this priority**: the visible half of the author ask; needs story 6.

**Independent Test**: as an editor holding only `blog.write`, assign an author, open the post on the
storefront, then deactivate and later delete that administrator.

**Acceptance Scenarios**:

1. **Given** an editor holding `blog.write` but not `admin_users:manage`, **When** they open the
   author picker, **Then** it lists active administrators by name and avatar — and nothing else
   about them (no e-mail, no role, no status).
2. **Given** a post with an author, **When** it is rendered, **Then** the page shows the author's
   name, avatar and biography in the request language (OR-3), and the post's structured data names
   the author as a person.
3. **Given** the author is deactivated, **When** the post is rendered, **Then** the author is still
   shown; in the editor the author stays selected and is marked inactive.
4. **Given** the author is deleted, **When** the post is rendered, **Then** no author is shown; the
   editor shows "author deleted" and lets the editor pick another.
5. **Given** an author changing their name, avatar or biography, **When** a post of theirs is next
   requested, **Then** it shows the new values (no stale cached author).

---

### Edge Cases

- **Prefix collisions**: a prefix equal to a reserved segment (`api`, `_next`, `p`, `c`, `cart`, …),
  a language prefix of any channel (167 FR-040's rule, mirrored), or the first segment of a CMS page
  slug in the channel is refused at save. A CMS page created later whose first segment equals a
  blog prefix is refused by the same rule from the CMS side.
- **Two languages, same prefix**: allowed (the language prefix in the path disambiguates); two
  languages with different prefixes on a channel that does not prefix its default language
  (167 OR-3) are still unambiguous, because only the default language is unprefixed.
- **A request language not assigned to the channel**: handled by 167 before the blog sees it.
- **A language removed from a channel**: posts keep the assignment; they are simply not reachable
  in that channel, and their slugs in that language stay reserved.
- **Explicit `?page=1`**: canonical URL without the parameter.
- **`?page=0`, negative or non-numeric**: treated as absent (page 1), as today.
- **A post whose only category is not assigned to the request language**: the post renders, its
  breadcrumb omits the category.
- **Avatar asset deleted anyway** (forced): the author renders without an avatar.
- **Author biography is the only per-language field missing**: never a 404 (OR-3).
- **Cache**: a prefix change, a slug change, an author profile change and a language assignment
  change each invalidate the blog's cached answers for the affected channel(s).
- **Blog switched off (Principle XVII)**: every blog URL, including former-prefix and former-slug
  redirects, answers as if the blog were never installed; the author picker and the profile's
  biography/avatar fields remain (they belong to `admin_users`), but no storefront surface shows
  them.

## Requirements *(mandatory)*

### Functional Requirements

**Prefix routing (US1)**

- **FR-001**: The storefront MUST serve every blog view under the channel's effective blog prefix
  for the request language, after the language prefix where 167 adds one.
- **FR-002**: Every blog URL the platform emits — storefront links, breadcrumbs, canonical and
  `hreflang` URLs, the sitemap, `llms.txt`, the `blog.LatestPosts` block, search-engine feeds —
  MUST be built by one path helper from (channel, language, view, key), not from a constant.
- **FR-003**: A request at `/blog/…` on a channel whose prefix is not `blog`, and a request at a
  former prefix of the channel, MUST answer 301 to the same view under the current prefix.
- **FR-004**: A channel on the default prefix MUST render exactly as before this feature.

**Pagination (US2)**

- **FR-010**: `GET /api/v1/blog/posts` MUST accept `page` (default 1) and `perPage` (at most 24);
  `limit` MUST stay accepted as a synonym of `perPage` for existing callers, and a request naming
  neither MUST keep today's page size of 6 *(amended by plan, research R12)*.
- **FR-011**: The response MUST add `pagination` (`page`, `perPage`, `totalItems`, `totalPages`)
  beside `data`; `data`'s shape MUST NOT change.
- **FR-012**: The endpoint MUST accept the filters `categorySlug`, `tagCode` and `authorId`, alone
  or combined, and the totals MUST count only matching posts.
- **FR-013**: Posts MUST be ordered by publication date descending, then by a stable tie-breaker,
  so that pages never repeat or skip a post.
- **FR-014**: The storefront index MUST be paginated by `postsPerPage` (OR-5); a storefront page
  number past the last page MUST answer 404 on index, category and tag views.

**Language existence (US3)**

- **FR-020**: Every storefront read — detail, index, category, tag, `GET /api/v1/blog/posts`,
  related posts, sitemap — MUST include a post or category only when the request language is
  assigned to it, matched by the platform's language-matching rule.
- **FR-021**: A post or category requested in a language not assigned to it MUST answer 404.
- **FR-022**: Publishing a post, or saving a published one, MUST be refused when any assigned
  language lacks its name — or its content, once the post has content in any language (a post
  created through the API without content stays publishable); a draft MAY be incomplete. Saving a category
  MUST be refused when any assigned language lacks its name *(amended by plan, research R8)*.

**Per-language keys (US4)**

- **FR-030**: A post and a category MUST each be able to carry one URL key per language; the
  effective key at (channel, language) is the language key, else the existing slug. There is no
  channel × language override *(amended by plan, research R6)*.
- **FR-031**: A key MUST be unique per (channel, language) across posts and categories together.
- **FR-032**: A key MUST resolve only in its own language; the existing slug resolves in every
  assigned language without its own key.
- **FR-033**: Replacing a key MUST keep the former key as a redirect to the entity's current
  effective URL at (channel, language); redirects MUST target the entity, never another key, so
  they never chain. A redirect MUST be removable by an editor and MUST yield to a key another
  entity takes on confirmation.
- **FR-034**: Post and category answers MUST carry their alternate URLs per assigned language, and
  the storefront's `hreflang` and language switcher MUST use them.

**Per-language prefix (US5)**

- **FR-040**: The blog prefix setting MUST hold a channel default plus optional per-language
  overrides.
- **FR-041**: A prefix MUST be refused when it is a reserved storefront segment, a language prefix
  of any channel, or the first slug segment of a CMS page in the channel; CMS MUST refuse a page
  slug whose first segment is a blog prefix of the channel.
- **FR-042**: A prefix change MUST be recorded so FR-003 can redirect from it.

**Author profile (US6)**

- **FR-050**: An administrator MUST be able to set their own avatar (a library asset) and their
  biography per language; an administrator holding `admin_users:manage` MUST be able to set them
  for others.
- **FR-051**: The avatar MUST be registered as an asset reference so the library treats it as in
  use.
- **FR-052**: Profile writes MUST be audited on `admin_users`' existing write path
  (`admin_user.update`), with the new fields in the audit's before/after state *(amended by plan,
  research R11)*.

**Post author (US7)**

- **FR-060**: A post MUST be able to name at most one author, an administrator.
- **FR-061**: An editor holding `blog.write` MUST be able to list active administrators as author
  candidates — id, display name, avatar URL only — without holding `admin_users:manage`.
- **FR-062**: The storefront post payload and post cards MUST carry the author's display name,
  avatar URL and biography in the request language (OR-3) and nothing else about the administrator.
- **FR-063**: An inactive author MUST still be shown; a deleted author MUST NOT be shown, and no
  copy of their name may be stored on the post (OR-4).
- **FR-064**: A change to an administrator's name, avatar or biography MUST invalidate cached blog
  answers that show them.
- **FR-065**: The post page's structured data MUST name the author as a person when one is shown.
- **FR-066**: The blog MUST reach administrator data only through a port published by
  `admin_users` (Principle I), never by reading its tables.

**Cross-cutting**

- **FR-070**: Every new user-facing string MUST ship in English and Polish (admin, storefront,
  error messages), following `specs/conventions/module-i18n.md`.
- **FR-071**: Every **new** write this feature introduces (URL keys, redirect deletion, former-prefix
  deletion) MUST run as a Command; new fields on existing writes ride those writes' current audited
  paths *(amended by plan, research R11)*.
- **FR-072**: With the blog switched off, every surface this feature adds to the blog MUST be
  absent (Principle XVII).
- **FR-073**: The end-user documentation of the blog and of the administrator profile MUST be
  updated in English and Polish.

### Key Entities

- **Blog post URL key**: a post's URL key in one language, optionally for one channel; unique per
  (channel, language) together with category keys.
- **Blog category URL key**: the same for a category.
- **Blog URL redirect**: a former key of a post or category in one language, pointing at the
  entity.
- **Blog prefix setting**: per channel, a default prefix plus optional per-language prefixes, with
  the history of former prefixes needed for redirects.
- **Administrator author profile**: avatar asset and per-language biography on the administrator.
- **Post author**: an optional reference from a post to an administrator.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a channel with a non-default prefix, a crawl of the blog finds 0 links, canonical
  URLs or sitemap entries that answer 404 or point at `/blog`.
- **SC-002**: A client can enumerate every published post of a channel through
  `GET /api/v1/blog/posts` with no post repeated or missed across pages.
- **SC-003**: For a channel with two languages, 0 pages render content of a language other than the
  one in their URL, and 0 `hreflang` alternates answer 404.
- **SC-004**: Every former post, category or prefix URL answers one redirect hop to a 200 page.
- **SC-005**: An editor assigns an author to a post in under 30 seconds without help from an
  administrator with user-management rights.
- **SC-006**: No storefront answer contains an administrator's e-mail, role or status.

## Assumptions

- The language-matching rule and the language prefix handling are those of 167; this feature adds
  no language negotiation of its own.
- The catalog's per-language URL key model (163) is the pattern to mirror; the blog keeps its own
  tables (Principle I) and does not depend on `catalog`.
- `admin_users` is non-deactivatable, so the author port is always present; the blog still treats
  an absent author as "no author".
- Category URLs stay single-segment (`/<prefix>/<category>`); nested category paths are out of
  scope.
- Tag URLs keep the tag code as their key in every language.
- The settings module's `json` value type can hold the per-language prefix map; no language scope
  is added to settings.

## Out of Scope

- Co-authors and guest (non-administrator) authors.
- Translating `tag/` and `author/` or any other storefront route segment.
- An author archive page (`/<prefix>/author/<slug>`) — a follow-up; the `author/` segment is
  reserved for it.
- Scheduled publication, RSS/Atom feeds, reading time, pinned posts — recorded as follow-ups.
- Per-language tag codes.
