import { defineModuleManifest } from '@b2b/contracts';

/**
 * Catalog module — feature 002 (and predecessors).
 *
 * Owns products, product variants, categories, attributes, attribute
 * sets, gallery items, attachments, product links, grouped products,
 * and bundle slots. The module pre-dates the lifecycle system; this
 * manifest is a backfill landed alongside feature 020 so the module can
 * declare command-palette actions.
 *
 * NOTE: hard-uninstall via `module:uninstall --hard` is intentionally
 * unsupported for legacy modules — the migrations under
 * `migrations/` are foundational to the entire B2B schema and reverting
 * them in production would devastate the database. The lifecycle
 * orchestrator's revert path is gated by an explicit operator-supplied
 * `--hard` flag; reviewers are responsible for not invoking it on this
 * module until a future feature adds proper teardown semantics.
 */
export const manifest = defineModuleManifest({
  id: 'catalog',
  name: 'Catalog',
  description:
    'Products, variants, categories, attributes, attribute sets, gallery, attachments, links, and bundles.',
  version: '1.6.0',
  // Feature 061 (FR-020) — product attributes are catalog extensions of
  // product-host Custom Field definitions; the lifecycle must install
  // custom_fields first and must not hard-uninstall it under a live catalog.
  // Feature 072 (T142) — `admin_notifications` and `email` were reached through
  // options a root passed down, so neither appeared here: a finished bulk
  // operation notifies and mails.
  //
  // `price_lists` is deliberately absent and recorded in
  // `acknowledgedDependencies` below instead. The external catalog namespace
  // prices through the pricing engine, but `price_lists` declares *this* module
  // — a price list is a list of prices for products — so the edge is mutual and
  // declaring it back closes a cycle. Catalog installs first.
  dependencies: [
    'admin_notifications',
    'admin_users',
    'assets_library',
    'custom_fields',
    'email',
    'sales_channels',
  ],
  // Feature 073, Amendment A1. This one differs from the `organizations` pairs
  // in the way that matters to an operator: `price_lists` is deactivatable
  // (`price_lists.enabled`), so without this declaration the pricing engine
  // could be switched off underneath a live resolver in a core commerce module,
  // and nothing would refuse the flip.
  acknowledgedDependencies: [
    {
      moduleId: 'price_lists',
      port: 'pricingService',
      reason:
        'Mutual by nature, and the mirror of `organizations:addressService`. ' +
        '`price_lists` declares this module — a price list is a list of prices for ' +
        'products, and it must install after them — while the external catalog ' +
        'namespace prices its responses through the pricing engine. Declaring the ' +
        'second direction closes the cycle, and `migration-order` fails the build ' +
        'on it, which is how this was found.',
    },
  ],
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'new-product',
      labelKey: 'actions.newProduct.label',
      descriptionKey: 'actions.newProduct.description',
      icon: 'Plus',
      targetRoute: '/catalog/products/new',
      requiredPermission: 'catalog:write',
      keywords: ['product', 'new', 'add', 'create', 'produkt', 'nowy', 'dodaj'],
      weight: 100,
    },
  ],
});
