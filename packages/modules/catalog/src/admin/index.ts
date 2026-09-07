/**
 * `catalog`'s admin surface — eight routes and six sidebar entries (feature
 * 091, Phase 4 batch 15).
 *
 * **The largest surface in the drain, and a zone *host* six members over.**
 * `ProductEditor.tsx` mounts `product.editor.details.before`,
 * `product.editor.field.after` (five times, once per editable core field),
 * `product.editor.pricing.before`, `product.editor.pricing.after` and
 * `product.editor.channels`; `ProductAttributesTab.tsx` mounts a sixth
 * `product.editor.field.after`; and `CategoriesTree.tsx` mounts
 * `category.editor.after`. P4b and P7a published those members and the
 * contributors were scheduled against them in batch 13 — this is the host
 * arriving, which `check:admin-registrations` allows in either order because a
 * zone is neither a route nor a nav entry.
 *
 * **What it drains: nothing, and the zero is measured rather than assumed.**
 * Before anything moved on this branch, this module's
 * `backend/scripts/ledgers/cross-module-imports/catalog.ts` shard held three
 * keys and every one of them is a **backend** SQL join —
 * `carts/cart_items`, `orders/order_items` and the kernel's
 * `sales_channel_products` — features 077 and 080's debt, in files this batch
 * does not open. Nothing names this module as an admin target, `admin-surface.ts`
 * is empty and `foreign-module-ids.ts` names it nowhere.
 * `check:module-boundary` reads
 * `cross-module reaches=7 (imports=3 sql=4) ledger-size=7 shards=4` on both
 * sides of the move, and that agreement is the measurement rather than a
 * silence.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The one code that opens every screen below.
 *
 * `packages/modules/catalog/src/backend/routes.admin.ts` gates the product
 * roster, one product, the category tree, the attribute and attribute-set
 * registries, the attachment types and the bulk-operation history with
 * `catalog:read`; every save, bulk edit and delete enforces `catalog:write` on
 * the API and gates its own control on the screen. The read code is what opens
 * the screen, which is issue #232's rule and the code all six hand-written
 * sidebar rows carried.
 */
const READ_PERMISSION = 'catalog:read';

/** The module's landing route: the product roster. */
const ROUTE_PATH = '/catalog/products';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ProductsList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // **The create form is this route with the id `new`** — `ProductEditor`'s
      // own `params.id === 'new'` reads it — and there is deliberately no
      // static `/catalog/products/new` declared beside it. `new-product`'s
      // `targetRoute` names that URL and always has; declaring a route for it
      // would be inventing one in a batch whose job is to move one, and it
      // would tighten a form an operator reaches from a list they can already
      // open. `<Routes>` ranks a static segment above a parametric one, so the
      // day somebody does want the split it is available without reordering.
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/ProductEditor.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/categories',
      component: () => import('./pages/CategoriesTree.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/attributes',
      component: () => import('./pages/AttributesManager.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/attribute-sets',
      component: () => import('./pages/AttributeSetsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/attachment-types',
      component: () => import('./pages/AttachmentTypesPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/bulk-operations',
      component: () => import('./pages/BulkOperationsPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: '/catalog/bulk-operations/:id',
      component: () => import('./pages/BulkOperationDetailPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/catalog/i18n/`. It was `appShell.nav.products` in the
      // shared `_i18n` bundle, one of the four shared files a module author had
      // to edit.
      labelKey: 'nav.products.label',
      // The glyph `AppShell.tsx` rendered by hand, already on
      // `KnownIconNameSchema`.
      icon: 'Package',
      section: 'catalog',
      // **Ten times the position, not a hundred**, and this is the one batch
      // where the convention had to bend. *Catalog* already holds three
      // contributed rows — `assets_library` at 200, `pim_ergonode` at 250,
      // `pim_pimcore` at 300 — and every one of them sits **below** these five
      // in the sidebar an operator has today. Position times a hundred would
      // tie `/catalog/categories` with `assets_library`' 200, where the tie
      // breaks on module id and puts a picture library above the second
      // catalogue row. A decade that is entirely this module's keeps the order
      // the hand-written table had and the order the operator sees.
      weight: 10,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/catalog/categories',
      labelKey: 'nav.categories.label',
      icon: 'Boxes',
      section: 'catalog',
      weight: 20,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/catalog/attributes',
      labelKey: 'nav.attributes.label',
      icon: 'Tag',
      section: 'catalog',
      weight: 30,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/catalog/attribute-sets',
      labelKey: 'nav.attributeSets.label',
      icon: 'Tag',
      section: 'catalog',
      weight: 40,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/catalog/attachment-types',
      labelKey: 'nav.attachmentTypes.label',
      icon: 'FileText',
      section: 'catalog',
      weight: 50,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: '/catalog/bulk-operations',
      labelKey: 'nav.bulkOperations.label',
      // The glyph `AppShell.tsx` rendered by hand. It joins
      // `KnownIconNameSchema` and the kit's `icon-map.ts` in this merge request
      // rather than the entry silently degrading to a name that happens to be
      // on the allowlist already.
      icon: 'ListChecks',
      // **A second section, and this module is the first to declare one.** The
      // hand-written table's reason travels with the row: bulk operations may
      // span many domains rather than only products, so the entry lives under
      // *System* while the URL stays `/catalog/bulk-operations` to keep
      // existing deep links — the bulk-edit "queued" acknowledgement among them
      // — valid.
      section: 'system',
      // Batch four's convention, unbent here because *System* has room for it:
      // this row was **fourth** of that section's hand-written thirteen, behind
      // `/platform/modules`, `/admin-users` (200) and `/admin-roles` (300) and
      // ahead of `/custom-fields` (500). Today an operator sees it second,
      // because `composeNav` puts every host row above every contributed one
      // and this was the section's only host row besides `/platform/modules`.
      // So the row moves from second to fourth, which is where the table it was
      // written in put it.
      weight: 400,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
