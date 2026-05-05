---
sidebar_position: 1
---

# Megamenu

The Megamenu module owns the storefront's primary navigation. It introduces a configurable tree of menu items authored in the admin panel, scoped to `(sales channel × language)` pairs, and rendered server-side on Next.js with a hover-revealed full-width drop-down panel on desktop and a stacked drill-down drawer on mobile.

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

The optional `iconAssetId` accepts only `image`-kind Library assets; the validator refuses non-image targets.

## Activation contract (FR-008)

At most one megamenu may be `active` per `(sales channel, language)` pair at any time. The DB enforces this with:

```sql
CREATE UNIQUE INDEX megamenu_bindings_active_uniq
  ON megamenu_bindings (sales_channel_id, language)
  WHERE active = true;
```

The activate transaction:

1. `UPDATE megamenu_bindings SET active = false WHERE sales_channel_id = ? AND language = ? AND active = true;` — deactivates the prior holder (if any).
2. `UPDATE megamenu_bindings SET active = true WHERE megamenu_id = ? AND sales_channel_id = ? AND language = ?;` — activates the requested binding.

Both run in a single transaction, so the partial unique index never sees a dual-active state. The activate endpoint surfaces the prior holder in `previouslyActive` so the admin's confirmation dialog can read "switched from <name>".

Activate refuses on an empty tree with `400 MEGAMENU_EMPTY_TREE` (per `R10`). Configuration delete refuses while at least one binding has `active = true` with `409 MEGAMENU_HAS_ACTIVE_BINDINGS` (admins must deactivate first per FR-004).

## Sales-channel + language scoping

A configuration may carry many `(salesChannelId, language)` bindings. The binding endpoint refuses a language outside the channel's configured language set with `400 MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`. Removing a binding falls back to "no megamenu" for that scope until another configuration activates.

Per-language label fallback: when an item's label is missing in the requested language, the storefront resolver falls back to the channel's default language. Items with no label in either is silently omitted from the resolved tree (admin sees the warning in the editor).

## Tree depth (FR-011)

Tree depth is a UX guideline, not a hard constraint. The data model imposes no cap. The admin form surfaces a non-blocking warning past 4 levels:

```
meta.warnings: [{ code: "MEGAMENU_DEPTH_EXCEEDED", message: "..." }]
```

Save still succeeds; every level renders on the storefront.

## Reference protection

Megamenu items hold soft references to upstream entities (Categories, CMS Pages, CMS Blocks, Library Assets). Deletion of any of those is refused while a megamenu still references them:

| Upstream entity | Registry / module                       | Match path on megamenu_items.target  |
| --------------- | --------------------------------------- | ------------------------------------ |
| Library Asset   | `AssetReferenceRegistry` (feature 013)  | `assetId` OR `iconAssetId`           |
| CMS Page        | `CmsReferenceRegistry` (feature 014)    | `kind='cms-page-link' AND pageId = ?` |
| CMS Block       | `CmsReferenceRegistry` (feature 014)    | `kind='cms-block-embed' AND blockId = ?` |
| Category        | (catalog category-reference registry)   | `kind='category-link' AND categoryId = ?` (planned) |

Each registration is a one-line surface change wired in `composition.ts`. The CMS module's existing `findBlockReferences` / `findTemplateReferences` were extended in feature 015 to consult external scanners; the megamenu module's `registerMegamenuCmsReferences` registers its scanner there.

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
3. Walks the tree, dispatching by `kind`: resolves Category / CMS-page URLs from their slugs, signs Asset URLs through the Assets Library, inlines CMS Blocks via the CMS module's storefront resolver, populates icons.
4. Returns the recursive `ResolvedMegamenu` payload.

Resolved payloads are cached in Redis under `megamenu:v1:<channel>:<language>` with a 5-minute TTL. Invalidation:

- `POST /menus`, `PATCH /menus/:id`, `PUT /menus/:id/items`, `DELETE /menus/:id` → coarse drop of `megamenu:v1:*` (one menu may serve N bindings).
- `POST /menus/:id/bindings` / `DELETE /menus/:id/bindings/:channel/:language` → drop the affected scope.
- `POST /menus/:id/activate` / `POST /menus/:id/deactivate` → drop the activated/deactivated scope.

The cache implementation mirrors feature 014's `CmsCache` exactly (same prefix scheme, same TTL, same SCAN-based invalidation).

## Storefront rendering

### Desktop

Reproduces the Industria design's `.mega` panel: a full-width drop-down beneath the nav bar, opened by hover (`onMouseEnter`) and closed by `onMouseLeave`. The panel uses a 3-column grid `220px 1fr 280px` with `gap: 32px` and `padding: 28px 0`. The third column is filled by the first `cms-block-embed` child whose `embedSide === 'right'` (a `left`-side embed appears in column 1 instead, shifting the link grid right).

### Mobile

Burger trigger renders below `768px`. Tapping opens a stacked drill-down drawer; tapping a parent slides to the next level via component state with a "Back" affordance. Embedded CMS Blocks, Buttons, and Assets render stacked inline (no off-canvas side-by-side layout). Browser-native scroll restoration covers the "preserves scroll on parent levels" requirement.

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

## Migration from no-megamenu

The migration `036_megamenu_init.ts` adds three new tables and the partial unique index. There are no seeded rows; first-time admins create a configuration through the admin UI.

Mounted in the storefront's root layout between `<Header>` and the existing `header.bottom` Hook. The CMS Hooks integration from feature 014 is unaffected.

## Error codes

`MEGAMENU_NOT_FOUND`, `MEGAMENU_HAS_ACTIVE_BINDINGS`, `MEGAMENU_EMPTY_TREE`, `MEGAMENU_BINDING_NOT_FOUND`, `MEGAMENU_BINDING_ALREADY_EXISTS`, `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `MEGAMENU_TARGET_OUT_OF_SCOPE`, `MEGAMENU_ASSET_KIND_MISMATCH`, `MEGAMENU_REFERENCED`, `MEGAMENU_DEPTH_EXCEEDED`.

All envelopes follow the platform-wide error contract in `packages/contracts/src/errors.ts`.

## Out of scope (v1)

- Per-customer-group / per-organization megamenu variants.
- A/B testing of menu variants.
- An admin "preview without publishing" surface.
- Item URL targets that point directly at product PDPs (use a Category link or an External link).
- Free-URL asset items: a server-side `importFromUrl` on the Assets Library is the natural home for fetching, validating, and storing externally-sourced bytes; the Megamenu module's validator refuses free-URL asset items until that surface lands. Admins upload the asset via the Library first and reference it by id.
- Drag-and-drop tree authoring in the admin: the v1 editor uses up/down/delete/add-child arrow controls. `@dnd-kit` is not bundled in the admin app and the brief's emphasis is on tree editing, not gesture sophistication.
