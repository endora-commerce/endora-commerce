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
  // Feature 075 — `organizations` is resolved, not imported, since the cut
  // replaced `em.findOne(Organization, …)` in the external namespace's price
  // decorator with `organizationDetailsPort`. It is acknowledged rather than
  // declared for the reason `price_lists` is, one line down: `organizations`
  // declares this module (the org-scoped catalogue restriction is a list of
  // products), so declaring it back closes a cycle and `migration-order` fails
  // the build on one. The module is non-deactivatable, so the acknowledgement
  // binds nothing an operator can flip.
  // Feature 073, Amendment A1 — with its operator clause deleted rather than
  // updated (issue #216). That clause distinguished this pair from the
  // `organizations` one by naming a `price_lists` activation control and
  // reasoning that the pricing engine could therefore be switched off
  // underneath a live resolver. Feature 074 withdrew that control: it was one
  // of the nineteen that never accepted a deactivation, and the pricing module
  // is locked on both axes today. So the clause contradicted the manifests, in
  // the file a reviewer opens to understand the edge, and the distinction it
  // drew no longer exists. Per D-100 a reason states the ground a human had to
  // decide, not a fact `lib/switchable-modules.ts` re-derives on every run —
  // the ground here is the cycle, and the entry below says so.
  acknowledgedDependencies: [
    {
      moduleId: 'organizations',
      port: 'organizationDetailsPort',
      reason:
        'Feature 075. The external catalog namespace decorates a bound caller’s prices with ' +
        'their organisation’s effective tiers, and read the `Organization` entity directly to ' +
        'do it. Over the port now — but `organizations` declares this module, so declaring it ' +
        'back closes a cycle. Acknowledged rather than declared, and the module is ' +
        'non-deactivatable, so nothing an operator can flip depends on the difference.',
    },
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
      moduleId: 'inventory',
      name: 'inventoryProductThresholdWritePort',
      kind: 'degrades-without',
      whenAbsent:
        'a duplicated product does not inherit the source’s per-warehouse low-stock thresholds',
      reason:
        'Issue #185. Product duplication copied the source’s alerting profile with an ' +
        '`insert … select` into `product_warehouse_low_stock_thresholds` — `inventory`’s table, ' +
        'reached with no import specifier, no gate, no declared edge and no audit row on the ' +
        'owner’s side. A second entry rather than a widening of `catalogExternalAvailability` ' +
        'above: that sentence describes a *read* degrade and must not be stretched over a write. ' +
        'Not `dependencies` (`inventory` declares this module) and not acknowledged either — an ' +
        'acknowledged edge sits in the refusal graph and would make `inventory` undeactivatable ' +
        'while a catalogue is present. The degrade is real: the duplicate falls back to the ' +
        'product- and warehouse-level chain, as on a deployment without the module.',
    },
    {
      moduleId: 'search',
      name: 'searchQueryPort',
      kind: 'degrades-without',
      whenAbsent:
        'the storefront product listing is served from PostgreSQL instead of the search index',
      reason:
        'Issue #153. This module used to build its own `SearchQueryService` out of `search`\'s ' +
        'class, so a composition held two Meilisearch clients and the public product list ' +
        'reached the index through no gate at all: a switched-off `search` went on serving that ' +
        'listing out of an index whose maintenance subscribers had stopped with it. It resolves ' +
        'the port now, and the degrade stays what it was — PostgreSQL is this route\'s default ' +
        'backend, and 503-ing a public catalogue because an optional search module is off would ' +
        'take the storefront down for a capability it never required. Declared rather than ' +
        'caught: presence is decided in front of the query, and an unreachable index is an arm ' +
        'of the port\'s return type.',
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
      moduleId: 'prompt_actions',
      name: 'promptActionBulkProgressRegistry',
      kind: 'contributes-to',
      reason:
        'The twin of the tool push above, and the last member of the D-44 family to leave a ' +
        'composition root (D-72 point 4). It folds live `catalog_bulk_operations` progress ' +
        'into a delegated request and finalizes it when the run ends, so it is built from ' +
        'this module’s own bulk services and belongs here — it stayed in the roots only ' +
        'because the host defaulted a single name for it and a module may not write a name ' +
        'another module owns. Reads nothing back: the registry is a plain registration that ' +
        'skips every resolver whose owner is not effectively present, and the absent ' +
        'behaviour was already the documented one — the request reports no progress, keeps ' +
        'its row and its audit trail, and expires on the assistant’s own TTL.',
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
