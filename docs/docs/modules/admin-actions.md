---
title: Admin Command Palette Actions
---

# Admin Command Palette Actions

A registry-backed contribution point that lets every backend module add action buttons to
the Admin UI's command palette (the `⌘K` / `Ctrl+K` modal — what the operator sees as the
**Actions** group). Two actions ship hardcoded today (*New product*, *Import products*); from
feature 020 onward those, and every future action, are declared once in their owning module's
manifest and surfaced through this registry. Feature 020.

The platform side lives at `backend/src/modules/admin_actions/` and the admin runtime at
`admin/src/lib/admin-actions/`.

## What a module declares

A module's `manifest.ts` may declare zero or more actions inline alongside its existing
`settings` and `i18n` fields:

```ts
import { defineModuleManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'catalog',
  name: 'Catalog',
  version: '1.4.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'new-product',
      labelKey: 'catalog.actions.newProduct.label',
      descriptionKey: 'catalog.actions.newProduct.description',
      icon: 'Plus',
      targetRoute: '/catalog/products/new',
      requiredPermission: 'catalog:write',
      keywords: ['product', 'new', 'add', 'create', 'produkt', 'nowy', 'dodaj'],
      weight: 100,
    },
  ],
});
```

Each entry MUST carry a stable `id`, a translatable `labelKey`, an `icon` from the closed
allowlist, and a `targetRoute`. Optional fields are `descriptionKey`, `requiredPermission`,
`keywords` (up to 10), and `weight` (default 100).

`requiredPermission` is optional in the schema and all but mandatory in practice: it must be
**the code the backend enforces on the route behind `targetRoute`**, so the palette never
advertises a 403 and never hides a screen from an operator entitled to open it. Both failures
happened — `settings/open-settings` shipped with no code at all against a `settings:read`
route, and `inventory/open-inventory` declared `catalog:write` against an `orders:read` one —
and the permission inventory could not see either, because it sweeps whether a code is
*enforced somewhere*, not whether it is enforced *here*.
`pnpm --filter backend run check:action-route-permissions` compares the two, resolving the SPA
`targetRoute` to the admin API route that gates it. Leave the field unset only when the
destination genuinely has no gate; where the screen is read-gated but the action's label
promises a write, the field cannot say both, and the disagreement is recorded in that check's
ledger rather than guessed at.

Within-module `id` uniqueness is enforced by the manifest's Zod schema — installing a
manifest with two actions sharing an id fails the install with a clear, indexed error.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/admin-actions?language=<en\|pl>` | Returns the operator-visible action list, already filtered by the operator's permissions and the module's installed state, sorted by `(weight, locale-aware label)`, with labels and descriptions resolved into the requested language (falling back to English then to the raw key, identical to the Admin UI i18n fallback chain). Permission: any authenticated admin. |

The response carries a `meta.registryVersion` field — `MAX(version)` over the visible rows
— useful for diagnostics. The admin SPA does not poll on it; refreshes are driven by the
operator's language flip and on-mount fetch.

## How an operator sees actions

1. The operator opens the Admin UI and presses `⌘K` (or `Ctrl+K` on Windows / Linux).
2. The palette renders two groups: **Navigate** (static jump targets) and **Actions**.
3. The Actions group shows every action whose owning module is installed AND whose
   `requiredPermission` (if any) the operator's role grants. The wildcard `*` permission
   held by `platform_admin` satisfies every action.
4. Typing in the search box filters across **both** groups by case-insensitive,
   diacritic-insensitive substring match against the row's label, description, and
   keywords. Polish operators can type `latwy` to match `łatwy`, English operators can
   type `import` to match `Importuj produkty`, etc.
5. Clicking a row or pressing `Enter` navigates to the action's `targetRoute` and closes
   the palette.

When no action is visible to the operator (rare; only with a no-permission role and no
modules contributing permissionless actions), the **Actions** group is hidden entirely.

## Lifecycle integration

The orchestrator install path runs `module_actions` reconciliation between the i18n
bundle install and the module's own install hook. The reconciler UPSERTs every declared
action and prunes any rows the new manifest no longer declares — install order, version
upgrades, and action removals are all idempotent. On hard-uninstall (`module:uninstall
--hard`) the reconciler deletes every action row owned by the module before the i18n
bundle removal step.

State is persisted in `module_actions` (composite PK `(module_id, action_id)`); soft-
uninstall (state → `disabled`) does NOT delete rows — it relies on the visibility
query's join with `module_registrations.state = 'installed'` to hide the actions while
preserving them for re-enable.

## Storage shape

| Column | Type | Notes |
| --- | --- | --- |
| `module_id` | `varchar(64)` | Part of PK. |
| `action_id` | `varchar(64)` | Part of PK. |
| `label_key` | `varchar(255)` | i18n key resolved at read time. |
| `description_key` | `varchar(255) NULL` | Optional. |
| `icon` | `varchar(64)` | One of the closed-allowlist names. |
| `target_route` | `varchar(255)` | Admin route. |
| `required_permission` | `varchar(64) NULL` | Permission code, any notation. |
| `keywords` | `jsonb` | Array of strings. |
| `weight` | `integer` | Sort key (default 100). |
| `version` | `bigint` | Per-row sequence; bumped on every UPSERT. |
| `installed_at`, `updated_at` | `timestamptz` | Row metadata. |

There is no foreign key on `module_id` — modules are filesystem-driven (feature 018) and
`module_registrations` is the registry of record. Cleanup is enforced by the
hard-uninstall path of the reconciler, mirroring feature 019's `translation_bundles`
choice.

## Recommended weight bands

Weights are advisory but reviewers expect new actions to land in the appropriate band:

| Band | Use case |
| --- | --- |
| 0–99 | Reserved for the platform shell. |
| 100–199 | Primary creation (e.g., New product, New page, New post). |
| 200–299 | Secondary creation / configuration entry points. |
| 300–399 | Workflow / inbox actions. |
| 400–499 | Less-frequent navigation / utilities. |
| ≥ 500 | Rarely-used actions; sink to the bottom. |

## Icon allowlist

Allowed icon names are an enum in `packages/contracts/src/admin-actions.ts`. Adding a new
icon is a one-line PR that edits both the enum and the admin's `icon-map.ts`.

## v1 seed set

The initial release ships ten actions across nine modules: `catalog/new-product`,
`import_export/import-products`, `import_export/open-import-export-center`,
`inventory/open-inventory`, `quote_requests/open-rfq-inbox`, `cms/new-page`,
`blog/new-post`, `megamenu/edit-megamenu`, `sales_channels/new-sales-channel`,
`settings/open-settings`. Eight further candidates from the spec were deferred until
their target admin pages exist (Adjust stock, New draft order, Find order by number,
New customer, New price list, New promotion, Upload asset, New category).
