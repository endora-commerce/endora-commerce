---
sidebar_position: 1
---

# CMS

The CMS module is the platform's editorial surface. It owns four entities
authored through a drag-and-drop **Page Builder** and surfaced on the
storefront with full sales-channel and language scoping.

| Entity      | Identifier        | Lifecycle                            | Embedded by                                   |
| ----------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| **Page**    | `slug` (per channel) | `draft → published → archived`       | URL on the storefront                         |
| **Block**   | `code` (per channel) | `active` flag                        | Pages (`InsertBlock`) and Hooks (attachment)  |
| **Template**| `code` (per channel) | always-visible (no flag)             | Blueprints for pages/blocks (**Save as template** / **Apply template**). Legacy `InsertTemplate` embeds still resolve at runtime. |
| **Hook**    | `code` (global)      | `active` flag, system-protected seed | Storefront layouts (`<Hook code="..." />`)    |

## Entities and the reference graph

The entity graph at runtime:

```
       Hook ──── attachment ────┐
                                ▼
                            Block ─── InsertBlock ───┐
                                                     ▼
                            Template (blueprint) ──> Page / Block canvas (Save as / Apply template)
                            Template ── InsertTemplate (legacy) ──> Page (slug-routed)
```

Content templates (`cms_templates`) are reusable Page Builder layouts (Save as template / Apply template). Email and invoice templates stay in their own admin lists and storage. Embedding via `InsertTemplate` is withdrawn from the component drawer; existing trees still render.

Reference protection runs on every delete:

- A **Block** referenced by a Page, a Template, or a Hook attachment cannot be deleted (HTTP `409 CMS_REFERENCED`).
- A **Template** referenced by a Page or a Block cannot be deleted.
- A **Hook** flagged `is_system=true` cannot be deleted (`409 CMS_HOOK_SYSTEM_PROTECTED`); admin-created Hooks are deletable.

Every reference scan is a JSONB walk over the entity's `content` envelope (`page→block`, `page→template`, `block→template`, `template→block`) plus a foreign-key check on `cms_hook_block_attachments` for `hook→block`.

The same `content` JSONB is scanned by the **Assets Library reference registry** (feature 013) — deleting an Asset embedded in a CMS component's `props` is similarly refused.

## Page Builder authoring

The Page Builder is built on **Puck** (`@measured/puck`) and ships components
in `@endora-commerce/cms-components`. Core layout/content defaults:

| Component       | Purpose                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `Row`           | Flex-column layout container.                                          |
| `Heading`       | `h1`–`h6` with align + level select.                                   |
| `Text`          | Simple body text with typography controls.                             |
| `RichContent`   | TipTap rich text (links modal, colors, images).                        |
| `Button`        | Label + link target + variant select.                                  |
| `Image`         | URL or asset library; width modes + align.                             |
| `Icons`         | Visual Lucide icon picker (~100 curated icons).                        |
| `Social`        | Brand social icons (`react-icons`); link list shows network names.     |
| `Spacer`        | Vertical spacing + optional divider.                                   |
| `FeatureList`   | Icon + title + description columns.                                    |
| `Hero`          | CTA banner with background, heading, button.                           |
| `LogoStrip`     | Partner / trust logos.                                                 |
| `Testimonial`   | Quote + author (+ optional avatar).                                    |
| `Stats`         | KPI / counter strip.                                                   |
| `AnnouncementBar` | Thin promo strip.                                                    |
| `SimpleTable`   | Simple pipe-separated table.                                           |
| `NewsletterSignup` | Email signup form (configurable action URL).                        |
| `ContactFormEmbed` | Form iframe embed or mailto.                                        |
| `InsertBlock`   | Embeds a Block by `code`. Storefront inlines the resolved Block.       |
| `InsertTemplate`| Legacy: embeds a Template by `code`. Kept for existing trees; **not** in the drawer palette. Prefer Save as / Apply template. |

Additional categories (catalog, media, interactive, forms, advanced) ship
Product*, Video, Map, sliders, Tabs, Accordion, RawHtml/RawJs, etc.

### Preview viewports

Puck Mobile / Tablet / Desktop frames use logical widths **360 / tabletMin /
max(desktopMin, 1280)**. Zoom is Puck’s built-in `transform: scale` inside an
iframe (`waitForStyles: true`). Prefer the viewport switcher over browser
resize when checking responsive props — CSS `@media` rules resolve against the
iframe width, while editing-tier JS uses the selected viewport width.

The content tree is persisted in a JSONB envelope:

```jsonc
{
  "schema_version": 1,
  "languages": {
    "pl-PL": { /* Puck Data tree */ },
    "en-US": { /* Puck Data tree */ }
  }
}
```

`schema_version` is bumped only when the storage shape of a node changes. The boot-time `content-schema-upgrader` walks every saved tree and rewrites nodes in place; current components start at `schema_version=1`.

## Sales-channel + language scoping

Every Page, Block, Template, and Hook is bound to one or more sales
channels (M:N join with the `code`/`slug` denormalised onto the join row
to enforce per-channel uniqueness at the DB level). The same `slug` may
exist in two channels — they're independent rows. Languages live as a
JSONB array on each entity; the storefront resolver follows the standard
fallback rule from feature 005 (requested → channel default → 404).

The admin's `ScopePicker` restricts the per-channel language list to
each channel's configured language set; saving a Page whose `languages`
includes a code unsupported by any assigned channel returns
`400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

## Seeded Hooks

23 base Hook codes are seeded with `is_system=true` at boot via an
idempotent reconciler. They cover the standard storefront insertion
points:

```
header.top
homepage.top, homepage.bottom
footer.before, footer.top, footer.bottom, footer.after, footer.copyright
category.top, category.bottom
product.top, product.bottom, product.buttons.after
search.top, search.bottom
page.top, page.bottom
cms.page.top, cms.page.bottom
login.top, login.bottom
register.top, register.bottom
```

Each `<Hook code="…" />` server component fetches
`/api/v1/cms/hooks/by-code` with the resolved channel + language and
renders every active attached Block in `position` order. Empty
attachments + failed fetches both render nothing — Hooks must not break a
page render.

## HTTP surface

### Admin (`/api/v1/admin/cms`)

| Method  | Path                                                | Purpose                                         |
| ------- | --------------------------------------------------- | ----------------------------------------------- |
| GET     | `/pages`                                            | Paginated Page list with filters.               |
| POST    | `/pages`                                            | Create a Page (always starts as `draft`).       |
| GET     | `/pages/:id`                                        | Detail with full content envelope + version.    |
| PATCH   | `/pages/:id`                                        | Edit metadata; honours `If-Match` via `version`.|
| PUT     | `/pages/:id/content/:language`                      | Save the Page Builder tree per language.        |
| POST    | `/pages/:id/{publish,archive,unarchive}`            | Lifecycle transitions.                          |
| DELETE  | `/pages/:id`                                        | Hard delete (channels are cascade-unbound).     |
| Same    | `/blocks/*`                                         | Same shape; per-channel-unique `code`; reference-protected on delete. |
| Same    | `/templates/*`                                      | Same shape minus `active` flag.                 |
| GET     | `/hooks`, `/hooks/:id`                              | List + detail with attachment count.            |
| POST    | `/hooks`                                            | Create an admin (non-system) Hook.              |
| PATCH   | `/hooks/:id`                                        | Edit name / active / scope; `code` is immutable.|
| DELETE  | `/hooks/:id`                                        | Refused with 409 when `is_system=true`.         |
| GET / POST / PATCH / DELETE | `/hooks/:id/attachments[/:blockId]` | Attach / reorder / detach Blocks on a Hook.     |
| GET     | `/page-builder/config`                              | Merged Page Builder descriptor (metadata only). |

### Storefront (`/api/v1/cms`)

| Method | Path                              | Returns                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/pages/by-slug?slug=…&language=…`| Resolved Page with `embeds.blocks`, `embeds.templates`, assets.|
| GET    | `/blocks/by-code?code=…&language=…`| Resolved Block (single, channel-filtered, active-only).       |
| GET    | `/hooks/by-code?code=…&language=…`| Ordered active Block list for the named Hook.                  |

Channel resolution prefers the `X-Sales-Channel` header, then falls back
to the system-default channel. Language resolution prefers `?language=`,
then `Accept-Language`, then the channel's configured default.

## Storefront resolution + Redis cache

The single `StorefrontResolver` service answers all three storefront
read operations with one query for the root entity, one batched query
per embed type (`InsertBlock` / `InsertTemplate`) per recursion level,
and one batched call to `assetsLibrary.resolveUrl` for every embedded
asset. Recursion is capped at depth 3; cycles or deeper graphs degrade
to a `MissingComponentPlaceholder` rendered admin-side.

Resolved payloads are cached in Redis with a 5-minute TTL under three
key families:

```
cms:v1:page:<slug>:<channel>:<language>
cms:v1:block:<code>:<channel>:<language>
cms:v1:hook:<code>:<channel>:<language>
```

Invalidation runs on every Page / Block / Template / Hook write:

- Page write → drops `cms:v1:page:<slug>:*` for every slug the page is bound to.
- Block write → drops the block's own keys + every page-keyed entry (we don't yet track which pages embed which block; coarse drop is acceptable at platform scale).
- Template write → drops every CMS-namespace key.
- Hook / attachment write → drops the hook's keys.

Performance target: page resolution with 5 embedded Blocks + 3 embedded
Templates returns in &lt; 200 ms p95 cold; warm path returns in &lt; 5 ms.

## Migration from legacy `cms_pages`

Pre-014, `cms_pages` carried `path` + `body` (per-language HTML) and a
`status` enum. Migration `035_cms_init.ts` adds the new column set
(`slug`, `name`, `active`, `content`, `languages`, `version`, `meta_*`)
and backfills every row idempotently:

- `slug = path`
- `name = title['en-US']` (best effort)
- `active = (status = 'published')`
- `content` envelope built from `body` with each language's HTML wrapped in a single `Text` node carrying `tiptapHtml`
- `languages` array = non-empty body keys
- bound to the platform's default sales channel via `cms_page_sales_channels`

Re-running the backfill against a partially-migrated state is a no-op.
The legacy `path`, `title`, and `body` columns survive for one release as
mirrors; the asset-ref scan covers `body` for backward compatibility.

## Extending the Page Builder

Other backend modules contribute components via the SPI in
`backend/src/modules/cms/services/page-builder-registry.ts`. See the
[Extending the Page Builder](./extending-page-builder) guide for the
end-to-end workflow: descriptor declaration, renderer shipping, and
composition wiring.

## Error codes

`CMS_PAGE_NOT_FOUND`, `CMS_BLOCK_NOT_FOUND`, `CMS_TEMPLATE_NOT_FOUND`,
`CMS_HOOK_NOT_FOUND`, `CMS_SLUG_CONFLICT`, `CMS_CODE_CONFLICT`,
`CMS_REFERENCED`, `CMS_HOOK_SYSTEM_PROTECTED`,
`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `CMS_SCHEMA_UPGRADE_FAILED`.

All envelopes follow the platform-wide error contract in
`packages/contracts/src/errors.ts`.
