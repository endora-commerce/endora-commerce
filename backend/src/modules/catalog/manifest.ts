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
  // D-44 — four edges that are real to the container and bind no operator.
  nonBindingDependencies: [
    {
      moduleId: 'inventory',
      // The name this module resolves. A composition root registers it on
      // `inventory`'s behalf — the closure forwards to
      // `inventoryAvailabilityPort.resolveAvailabilityBands` and probes
      // presence in front of it — so this is where the edge is visible from
      // here, and where the check can see something resolving it.
      name: 'catalogExternalAvailability',
      kind: 'degrades-without',
      whenAbsent:
        'product listings and the external catalog namespace stop carrying an availability band',
      reason:
        'D-61. Availability is an indication on a catalog read, never a reason to fail ' +
        'one: the decorator has always had an absent-contribution path answering the ' +
        'empty map, so `inventory` being off has a defined behaviour and 503-ing the ' +
        'product list would be the wrong one. What was missing is that the contribution ' +
        'said so — the behaviour was written in a `catch` at the call site, which also ' +
        'swallowed genuine inventory failures. Declared here, probed in front of the ' +
        'resolution, and the `catch` is gone.',
    },
    {
      moduleId: 'prompt_actions',
      name: 'promptActionToolRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s boot hook, of the six assistant tools built over its ' +
        'own admin services. It reads nothing back: the registry is a plain registration ' +
        'that drops every tool whose owner is not effectively present, so an absent ' +
        'contributor costs the host nothing and an absent host holds a table nobody walks. ' +
        'Declaring the edge would make an optional assistant undeactivatable for as long as ' +
        'the catalogue is present, which is a claim this contribution does not support.',
    },
    {
      moduleId: 'api_keys',
      name: 'requireApiKey',
      kind: 'degrades-without',
      whenAbsent: 'the external catalog namespace stops accepting machine-to-machine callers',
      reason:
        'The two gates guard `/api/v1/external/catalog/*` and the by-SKU upsert. Declaring ' +
        '`api_keys` closes a cycle through `customer_accounts` → `price_lists` → `catalog`, ' +
        'and acknowledging it would bind the operator instead. The namespace has a defined ' +
        'behaviour without the module: the gate answers 401 rather than resolving a port ' +
        'whose owner is gone, so the catalogue keeps serving its own surfaces and only the ' +
        'machine-to-machine door closes.',
    },
    {
      moduleId: 'api_keys',
      name: 'requireBoundApiKey',
      kind: 'degrades-without',
      whenAbsent: 'the external catalog namespace stops accepting machine-to-machine callers',
      reason:
        'The organization-bound half of the gate above — same namespace, same cycle, same ' +
        '401, and it drains with it.',
    },
  ],
  // Feature 074 (Constitution XVII), test C2 — functional base. This module had
  // no activation declaration at all, which resolved as "always activated" and
  // read as an omission; the lock says the same thing on purpose and with a
  // reason. Products, variants and categories are what a commerce platform is
  // for: their absence does not reduce it, it makes it something else.
  activation: {
    nonDeactivatable: true,
    reason:
      'Products, variants and categories. A commerce platform without a catalogue is a ' +
      'different product, not a reduced one.',
  },
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
