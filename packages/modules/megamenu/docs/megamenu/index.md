---
title: Megamenu
sidebar_position: 1
description: Configurable navigation tree with per-channel + per-language bindings
---

# Megamenu

The Megamenu module owns the storefront's primary navigation. It introduces a configurable tree of menu items authored in the admin panel, scoped to `(sales channel × language)` pairs, and rendered server-side on Next.js as a bar of tabs on desktop — each opening as a link, a list, a panel of columns or the catalogue panel — and a stacked drill-down drawer on mobile. Items can expand the catalogue's category tree live, inherit their labels from what they link to, and be shown to chosen audiences only.

## Entities and item kinds

| Entity              | Identifier                          | Notes                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| **Megamenu**        | `id` (uuid)                         | Configuration row — name, description, version.        |
| **MegamenuItem**    | `id` (uuid) + `parentId` (self-FK)  | Adjacency-list tree node with kind-specific `target`.  |
| **MegamenuBinding** | `(megamenuId, salesChannelId, language)` | Per-scope `active` flag enforced by a partial unique index. |

The closed set of item kinds:

| `kind`            | Target shape                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `category-link`   | `{ categoryId, iconAssetId?, iconPosition? }`                         |
| `cms-page-link`   | `{ pageId, iconAssetId?, iconPosition? }`                             |
| `external-link`   | `{ url, iconAssetId?, iconPosition? }` (URL: `http\|https\|tel\|mailto`) |
| `button`          | `{ url, variant: 'primary'\|'secondary'\|'ghost' }`                   |
| `asset`           | `{ assetId, kind: 'image'\|'video' }`                                 |
| `cms-block-embed` | `{ blockId, embedSide: 'left'\|'right' }`                             |
| `group`           | `{}` — a heading without a link; a column of a `mega` panel           |
| `category-tree`   | `{ rootCategoryId: uuid \| null, depth: 1\|2\|3 }` — a live expansion of the catalogue |

The optional `iconAssetId` accepts only `image`-kind Library assets; the validator refuses non-image targets.

## The navigation bar

The top-level items of a menu are the **tabs** of the storefront's navigation bar, in their order. Each tab carries a `presentation`, which says how it opens, and an `alignment`, which says which end of the bar it sits at (`start`, the default, or `end`). No item below the top level carries either; the database refuses it (`megamenu_items_tab_fields_check`).

| `presentation` | The tab… | Its children render as |
| -------------- | -------- | ---------------------- |
| `link`         | navigates, and opens nothing | — a `link` tab has no children |
| `dropdown`     | opens a narrow list under itself | one level; a `group` child is a section heading |
| `mega`         | opens a full-width panel | the loose links in a first column, a column per `group`, embeds and media in the promo slot |
| `catalog`      | opens a panel with a side list (*Panel with side list* in the editor) | the tab's children as a list on the left; the one under the pointer shows its children on the right as column headings with their own children under them — and, when it is a category, an *All in …* link to it — and the promo slot |

A tab may be a `category-link`, `cms-page-link`, `external-link`, `button` or `group`. An `asset`, a `cms-block-embed` or a `category-tree` opens under a tab and is refused as one (`400 MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`). A `link` tab must point somewhere and cannot have children (`400 MEGAMENU_LINK_TAB_INVALID`).

A `catalog` panel is a layout, not a catalogue: it suits any tab with many items, each with a list of its own, and a category tree is its most common content.

By default, clicking a tab with a panel opens the panel. A `category-link`, `cms-page-link` or `external-link` tab can instead **follow its own link on click** (`clickNavigates: true`, *Clicking the tab opens its link* in the editor): the tab is then its link plus a separate arrow button that opens the panel, and the panel also opens on hover. Any other tab, or an item below the top level, is refused with `400 VALIDATION_FAILED`. On mobile, a drilled-into tab's own link is the first row of its level either way.

A tab whose children are all hidden from a visitor (see *Audiences*), or whose category tree expands to nothing, is dropped from that visitor's bar — unless it has a link of its own, in which case it renders as a plain link.

### Category trees

A `category-tree` item is replaced, on every resolution, by the catalogue's live categories below its root (or below the catalogue's top level when the root is `null`), to its depth, in the catalogue's sort order. An inactive or deleted category is absent with its whole branch. A category created, renamed or reordered in the catalogue reaches the menu within the menu's cache lifetime, with no menu edit. Each expanded category is a `category-link` in the resolved tree, labelled with its own name and linked to `/c/<slug>`; its id is `<tree item id>:<category id>`, because it has no row of its own.

## Labels

A `category-link`, `cms-page-link` or `category-tree` may leave its label empty in any language. An empty label resolves to the target's own name in the served language, else the channel's default language (for a category, else any name it has). A typed label always wins. A `cms-page-link` follows the page's name and slug per language and its parent's path (`@endora-commerce/mod-cms`'s `findStorefrontLinks`), so it links to the page's address in the served language. The storefront puts the language prefix on it, as on every menu link.

An `external-link`, a `button` or a `group` has no name to inherit and needs a label in at least one language (`400 MEGAMENU_LABEL_REQUIRED`).

## Audiences

Every item has an `audience`:

| `audience.kind`   | Who sees the item |
| ----------------- | ----------------- |
| `everyone`        | every visitor (the default) |
| `guests`          | a visitor who is not signed in |
| `signed_in`       | a signed-in customer |
| `customer_groups` | a signed-in customer whose **effective customer group** — their account's group, else their organisation's, the rule pricing applies (`effectiveCustomerGroupId`) — is one of `customerGroupIds` |

Hiding an item hides its whole subtree. An audience naming a customer group that does not exist is refused on save (`400 MEGAMENU_TARGET_OUT_OF_SCOPE`); a group deleted afterwards matches nobody, so the item narrows to the groups that remain and is hidden when none does. An API key or an admin reading the storefront API sees what a guest sees.

The storefront API answers each visitor only the items of their audience, and nothing of the rest — no label, URL or audience rule.

## Writes and audit

Every write — a menu's create, update and delete, the item tree's save, and a binding's add, remove, activation and deactivation — runs as a Command (`megamenu.create`, `megamenu.update`, `megamenu.delete`, `megamenu.items.set`, `megamenu.binding.add`, `megamenu.binding.remove`, `megamenu.binding.activate`, `megamenu.binding.deactivate`) and records one audit entry under object type `megamenu`. A tree save's entry holds the tree: each item's kind, presentation, alignment, audience, labels and target.

## Activation contract

At most one megamenu may be `active` per `(sales channel, language)` pair at any time. The DB enforces this with:

```sql
CREATE UNIQUE INDEX megamenu_bindings_active_uniq
  ON megamenu_bindings (sales_channel_id, language)
  WHERE active = true;
```

The activate transaction:

1. `UPDATE megamenu_bindings SET active = false WHERE sales_channel_id = ? AND language = ? AND active = true;` — deactivates the prior holder (if any).
2. `UPDATE megamenu_bindings SET active = true WHERE megamenu_id = ? AND sales_channel_id = ? AND language = ?;` — activates the requested binding.

Both run in a single transaction, so the partial unique index never sees a dual-active state. The activate endpoint surfaces the prior holder in `previouslyActive` so the admin's confirmation dialog can read "switched from `<name>`".

Activate refuses on an empty tree with `400 MEGAMENU_EMPTY_TREE`. Configuration delete refuses while at least one binding has `active = true` with `409 MEGAMENU_HAS_ACTIVE_BINDINGS` (admins must deactivate first).

## Sales-channel + language scoping

A configuration may carry many `(salesChannelId, language)` bindings. The binding endpoint refuses a language outside the channel's configured language set with `400 MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`. Removing a binding falls back to "no megamenu" for that scope until another configuration activates.

Per-language label fallback: when an item's label is missing in the requested language, the storefront resolver falls back to the channel's default language. Items with no label in either is silently omitted from the resolved tree (admin sees the warning in the editor).

## Tree depth

Tree depth is a UX guideline, not a hard constraint. The data model imposes no cap. The admin form surfaces a non-blocking warning past 4 levels:

```
meta.warnings: [{ code: "MEGAMENU_DEPTH_EXCEEDED", message: "..." }]
```

Save still succeeds; every level renders on the storefront.

## Reference protection

Megamenu items hold soft references to upstream entities (Categories, CMS Pages, CMS Blocks, Library Assets). Deletion of any of those is refused while a megamenu still references them:

| Upstream entity | Registry / module                       | Match path on megamenu_items.target  |
| --------------- | --------------------------------------- | ------------------------------------ |
| Library Asset   | `AssetReferenceRegistry`                | `assetId` OR `iconAssetId`           |
| CMS Page        | `CmsReferenceRegistry`                  | `kind='cms-page-link' AND pageId = ?` |
| CMS Block       | `CmsReferenceRegistry`                  | `kind='cms-block-embed' AND blockId = ?` |
| Category        | (catalog category-reference registry)   | `kind='category-link' AND categoryId = ?` (planned) |

Each registration is one call in the megamenu module's own boot hook (`ctx.onBoot` in the module's `src/backend/index.ts`). The CMS module's existing `findBlockReferences` / `findTemplateReferences` were extended to consult external scanners; the megamenu module's `registerMegamenuCmsReferences` registers its scanner there.

The category-reference registry surface is planned for the catalog module; until it lands, category-delete protection from megamenu references is enforced at the validator boundary (a megamenu cannot save an item pointing at a deleted category — the category check returns `false` and the admin sees a clear error).

## Storefront resolution + Redis cache

Single read endpoint:

```
GET /api/v1/megamenu/by-channel?language=<bcp-47>
X-Sales-Channel: <channel-code>
```

The resolver:

1. Looks up the active binding via the partial unique index (1 query).
2. Reads every item under that megamenu in `(parent_id, position)` order (1 query).
3. Reads the catalogue's categories once, when the menu holds a category link or tree, and the storefront links of every page the menu links to once, in the served language.
4. Walks the tree, dispatching by `kind`: expands category trees, resolves labels and URLs, signs Asset URLs through the Assets Library, inlines CMS Blocks via the CMS module's storefront resolver, populates icons.
5. Keeps every audience's items, each with its audience, and caches that tree.
6. Filters the tree for the requesting visitor and returns the recursive `ResolvedMegamenu` payload.

Resolved trees are cached in Redis under `megamenu:v2:<channel>:<language>` with a 5-minute TTL — one entry per scope serves every visitor, because the audience filter runs after the cache. Invalidation:

- `POST /menus`, `PATCH /menus/:id`, `PUT /menus/:id/items`, `DELETE /menus/:id` → coarse drop of `megamenu:v2:*` (one menu may serve N bindings).
- `POST /menus/:id/bindings` / `DELETE /menus/:id/bindings/:channel/:language` → drop the affected scope.
- `POST /menus/:id/activate` / `POST /menus/:id/deactivate` → drop the activated/deactivated scope.
- A CMS block or page save (`cms.content_changed.v1`) → coarse drop of `megamenu:v2:*`, because a menu payload inlines the tree of every block it embeds and the name and address of every page it links to.
- An asset write that changes how the asset renders (`assets_library.asset_changed.v1` — a replace, a restore, a permalink or visibility change, a soft delete or restore, a filename, label, alt-text or MIME edit) → coarse drop of `megamenu:v2:*`, because a menu payload inlines the URL and label of every asset item and the URL of every icon. Nothing is announced while `assets_library` is absent, and a switched-off `megamenu` does not react.

A response to a signed-in caller carries `Cache-Control: private, no-store`; the anonymous response carries no such header. The storefront fetches a signed-in buyer's menu with their session and stores it nowhere; a guest's menu stays in Next's Data Cache for 60 seconds, tagged `megamenu` (`MEGAMENU_STOREFRONT_CACHE_TAG` in `@endora-commerce/contracts`). Every invalidation above also posts that tag to the storefront's `/api/revalidate`, after the Redis keys are gone, so an edited menu is the next request's menu. It needs `STOREFRONT_BASE_URL` and `REVALIDATE_SECRET`, is skipped without them, and never fails a write when the storefront cannot be reached.

The cache implementation mirrors the CMS module's `CmsCache` exactly (same prefix scheme, same TTL, same SCAN-based invalidation).

## Storefront rendering

### Desktop

The header renders the active menu's tabs as one bar (`NavigationBar`), start-aligned tabs first and end-aligned tabs last, and no navigation entry the menu does not contain. A `link` tab, and a tab with nothing to open, is a link; a `button` tab renders in its variant. Every other tab is a disclosure button over its panel: hover (with hover intent), click, Enter or Space opens it; Escape returns focus to the tab; leaving it or clicking elsewhere closes it. Tabs that do not fit the bar's width move into a trailing *More* tab. The server renders every tab and every panel's links, so crawlers and visitors without JavaScript reach them all.

Each item renders as its kind: links with their icon (and, in `dropdown` and `mega` panels, their description), buttons as buttons, groups as unlinked headings, assets as the image or video, embeds as the rendered block. The bar's own text (*More*, *All in …*) comes from the storefront's translations.

### Mobile

Burger trigger renders below `768px`. Tapping opens a stacked drill-down drawer whose root lists the visitor's tabs: a `link` tab navigates, any other drills into its children. A group renders as a section heading with its items under it. A drilled-in level shows a breadcrumb and a link to the item itself. Embedded CMS Blocks, Buttons, and Assets render stacked inline. The drawer's text is translated.

## HTTP surface

### Admin (`/api/v1/admin/megamenu`)

| Method  | Path                                                        | Purpose                                              |
| ------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| GET     | `/menus`                                                    | List configurations with binding counts.             |
| POST    | `/menus`                                                    | Create a Megamenu (no items, no bindings).           |
| GET     | `/menus/:id`                                                | Detail with tree + bindings.                         |
| PATCH   | `/menus/:id`                                                | Edit metadata. Honours `If-Match` via `version`.     |
| DELETE  | `/menus/:id`                                                | Refused while any binding has `active = true`.       |
| PUT     | `/menus/:id/items`                                          | Save the entire item tree (full overwrite).          |
| GET     | `/menus/:id/bindings`                                       | List every binding for a configuration.              |
| POST    | `/menus/:id/bindings`                                       | Add a `(channel, language)` binding (always staged). |
| DELETE  | `/menus/:id/bindings/:salesChannelId/:language`             | Remove a binding (idempotent).                       |
| POST    | `/menus/:id/activate`                                       | Atomic swap activation.                              |
| POST    | `/menus/:id/deactivate`                                     | Deactivate a binding.                                |

### Storefront (`/api/v1/megamenu`)

| Method | Path                              | Returns                                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/by-channel?language=…`          | Resolved megamenu for the requested scope; `404 MEGAMENU_NOT_FOUND` when no active binding. |

## Migrations

The migration `20260505T193836_megamenu_init.ts` adds three new tables and the partial unique index. There are no seeded rows; first-time admins create a configuration through the admin UI.

The migration `20261029T190956_megamenu_tab_click_navigates.ts` adds `click_navigates` (off by default, top-level items only).

The migration `20261029T162855_megamenu_navigation_bar.ts` adds `presentation`, `alignment` and `audience` to `megamenu_items`, makes every stored top-level item a start-aligned `mega` tab so the new check constraint holds, and converts nothing else: a stored menu keeps its items and is reshaped in the editor.

Mounted in the storefront's root layout between `<Header>` and the existing `header.bottom` Hook. The CMS Hooks integration is unaffected.

## Error codes

`MEGAMENU_NOT_FOUND`, `MEGAMENU_HAS_ACTIVE_BINDINGS`, `MEGAMENU_EMPTY_TREE`, `MEGAMENU_BINDING_NOT_FOUND`, `MEGAMENU_BINDING_ALREADY_EXISTS`, `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `MEGAMENU_TARGET_OUT_OF_SCOPE`, `MEGAMENU_ASSET_KIND_MISMATCH`, `MEGAMENU_ASSET_URL_UNSUPPORTED`, `MEGAMENU_REFERENCED`, `MEGAMENU_DEPTH_EXCEEDED`, `MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`, `MEGAMENU_LINK_TAB_INVALID`, `MEGAMENU_LABEL_REQUIRED`.

A tree save also answers non-blocking warnings in `meta.warnings`: `MEGAMENU_DEPTH_EXCEEDED`, `MEGAMENU_DROPDOWN_DEPTH_IGNORED` (a `dropdown` tab shows one level) and `MEGAMENU_PROMO_SLOT_TAKEN` (two embeds of one panel on the same side; the first is shown).

All envelopes follow the platform-wide error contract in `packages/contracts/src/errors.ts`.

## Out of scope (v1)

- An audience naming organisations: customer groups address a set of buyers.
- Badges, scheduled visibility and menu locations other than the header (footer, top bar).
- A/B testing of menu variants.
- An admin "preview without publishing" surface.
- Item URL targets that point directly at product PDPs (use a Category link or an External link).
- Free-URL asset items: a server-side `importFromUrl` on the Assets Library is the natural home for fetching, validating, and storing externally-sourced bytes; the Megamenu module's validator refuses free-URL asset items until that surface lands, with `400 MEGAMENU_ASSET_URL_UNSUPPORTED` and the item's `itemId` in `details` (`400 VALIDATION_FAILED` until issue #640). Admins upload the asset via the Library first and reference it by id.
- Drag-and-drop tree authoring in the admin: the v1 editor uses up/down/delete/add-child arrow controls. `@dnd-kit` is not bundled in the admin app and the brief's emphasis is on tree editing, not gesture sophistication.
