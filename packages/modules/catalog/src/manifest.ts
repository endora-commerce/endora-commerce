import {
  defineModuleManifest,
  defineModuleRecentActivity,
} from '@endora-commerce/contracts';

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
  // Feature 072 (T142) — `email` was reached through an option a root passed
  // down, so it did not appear here: a finished bulk operation mails. The bell
  // arrived in the same task and has moved to `nonBindingDependencies` below
  // (D-179.3), which is what this module's own recorder has said since D-60.
  //
  // `price_lists` is deliberately absent and recorded in
  // `acknowledgedDependencies` below instead. The external catalog namespace
  // prices through the pricing engine, but `price_lists` declares *this* module
  // — a price list is a list of prices for products — so the edge is mutual and
  // declaring it back closes a cycle. Catalog installs first.
  // `audit_logs` owns `auditReferenceRegistry`, the registry this module pushes
  // its own "what is this audit row called, and where does the admin app show
  // it?" resolver into (feature 075, D-87). The registry is ungated and its
  // owner is non-deactivatable, so the declaration buys install and migration
  // order rather than a flip-time refusal.
  dependencies: [
    'audit_logs',
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
  // products), so declaring it back closes a cycle and `module-graph.test.ts`
  // fails the build on one. The module is non-deactivatable, so the acknowledgement
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
        'second direction closes the cycle, and `module-graph.test.ts` fails the ' +
        'build on it, which is how this was found.',
    },
  ],
  // D-44 — five edges that are real to the container and bind no operator.
  nonBindingDependencies: [
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent:
        'bulk edits and search reindexes still run and still report on the Bulk actions page; ' +
        'only the bell entry is missing — the completion e-mail to the admin still goes out',
      reason:
        'D-179.3. This module reaches the bell once, from the bulk-operation completion ' +
        'notice, and it has decided the owner’s absence in front of the gate since D-60: ' +
        '`presenceAwareBulkRecorder` probes the effective state and hands the bulk-operation ' +
        'service `not-present` in the return type, so nothing here fails closed. The ' +
        '`dependencies` entry therefore contradicted this module’s own implementation. It ' +
        'bought no schema order either — neither `admin_notification` table is referenced ' +
        'from anything this module owns — only the flip-time refusal, which is what made ' +
        '`admin_notifications.enabled` a control an operator could move with nothing ' +
        'happening. Feature 072 (T142) declared it when the recorder arrived through a root ' +
        'option; the recorder is the whole answer.',
    },
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
  /**
   * The error codes this module owns — forty-seven from feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1) and six more from D-129's remaining sweep, MR 4, described at the end
   * of this block. This is where the sentence for each is looked up from:
   * `errors.<CODE>` in this module's own `i18n/{en,pl}.json`. Every code with
   * no sentence there is an entry in `check-error-translations.ts`'s
   * `UNTRANSLATED_ERROR_CODES` ledger and stays one — declaring a code writes no
   * sentence (runbook §7 case 1).
   *
   * The Phase 3 forty-seven are answer-preserving, not a judgement (§6.2 and
   * §6.5), and that list was not written by hand: it is the output of the
   * runbook's step-1 derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner was
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work, deliberately
   * not done in Phase 3; it is what the six additions below are.
   *
   * **Four codes are here because an earlier rule in that ordered chain shadows
   * a later one that names them.** Read from the chain's source they look like
   * somebody else's; read from its answer — which is the only reading that
   * matches what a client receives today — they are this module's:
   *
   * - `PRODUCT_UNMANAGED_STOCK` and `PRODUCT_IN_STOCK` are members of the
   *   chain's own `INVENTORY_MISC_ERROR_CODES` set, and the `PRODUCT_` prefix
   *   above it claims both first. `inventory` raises the second one.
   * - `ASSET_KIND_NOT_SUPPORTED` would match `assets_library`'s `ASSET_` prefix,
   *   and `CATALOG_MISC_ERROR_CODES` names it thirty lines earlier.
   * - `UNKNOWN_OPTION` would match `sales_channels`' `UNKNOWN_` prefix, and the
   *   same misc set claims it first. `catalog`'s own `bundle.service.ts` raises
   *   it.
   *
   * **Ten more are counter-intuitive without any shadow** — the prefix rule is
   * simply wider than the module that raises the code, which §6.5 leaves
   * standing: the five `PRODUCT_FEED_*` codes (raised by `product_feeds`),
   * `PRODUCT_NOT_IN_COMPARISON` (raised by `comparisons`),
   * `SKU_NOT_IN_ASSORTMENT` (raised by `orders`), and
   * `PRICE_ORDERING_UNAVAILABLE` / `PRICE_RANGE_INVALID`, which the chain names
   * one by one rather than by a `PRICE_` prefix precisely so that the
   * `PRICE_LIST_*` family stays with `price_lists`. `SKU_NOT_IN_ASSORTMENT` is
   * the one of those ten the sweep does **not** revisit: D-121 T1 puts it here
   * on the same reading the chain reached by accident, so there is nothing to
   * re-home.
   *
   * No `tokens`: no code here carries a refusal discriminator. Derived from the
   * raise sites rather than from this module's bundles, per the runbook's §5 —
   * the nine codes in the tree that reach the envelope's `refusalToken` are
   * `core`'s seven, `invoices`' two and `carts`' one, and none of them is here.
   *
   * **Six more arrived from `_i18n` in D-129's remaining sweep, MR 4**
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A) —
   * and unlike the forty-seven above these are a judgement rather than a
   * transcription. The three `PACKAGING_UNIT_*` codes and
   * `SYSTEM_ATTRIBUTE_SET_IMMUTABLE` are D-121 T1: a packaging unit is a row on
   * a Product and an Attribute Set is this module's entity, so the noun decides
   * and the raise site does not — `PACKAGING_UNIT_NOT_FOUND` is raised by
   * `carts` as well as by this module, resolving a unit before adding a line,
   * which makes `carts` the caller. `BULK_TOO_LARGE` and `SELECTION_TOO_LARGE`
   * are T2: "bulk" and "selection" name no entity anybody owns, so T1 does not
   * answer, and each names a mechanism this module implements and alone raises
   * — the 200-product ceiling on `POST /products/bulk-update` and the
   * 10 000-match ceiling on `POST /products/resolve-ids`.
   *
   * `SYSTEM_ATTRIBUTE_SET_IMMUTABLE` is the only one of the six that arrives
   * with a sentence, and it is a new one. It carried a placeholder in `_i18n`'s
   * bundle — `"System Attribute Set Immutable."` — which D-186 §2 deletes
   * rather than moves; §5.4 keeps writing the prose available, and here the
   * meaning is plain at both raise sites (the system set's `code` is immutable,
   * and the set itself cannot be deleted) and the reader is an operator on the
   * Attribute Sets screen. So it is written, and the code does not join
   * `UNTRANSLATED_ERROR_CODES`. The other five had no sentence in either
   * language before the move and have none after; they were ledgered under
   * `_i18n` and are ledgered under `catalog`.
   *
   * None of the six carries a token either, measured the same way: every raise
   * site's own arguments were extracted by balancing parentheses, and the two
   * that pass a `details` object pass `{ maxBatchSize, recommendedSplitInto }`
   * and `{ total, maxSelectionSize }` — neither holds a `code`, which is the
   * only key `refusalToken` reads.
   */
  errorCodes: [
    { code: 'ASSET_KIND_NOT_SUPPORTED' },
    { code: 'ATTACHMENT_NOT_FOUND' },
    { code: 'ATTACHMENT_TYPE_CODE_TAKEN' },
    { code: 'ATTACHMENT_TYPE_IN_USE' },
    { code: 'ATTACHMENT_TYPE_NOT_FOUND' },
    { code: 'ATTRIBUTE_NOT_FOUND' },
    { code: 'ATTRIBUTE_NOT_MASS_EDITABLE' },
    { code: 'ATTRIBUTE_SET_CODE_TAKEN' },
    { code: 'ATTRIBUTE_SET_IN_USE' },
    { code: 'ATTRIBUTE_SET_NOT_FOUND' },
    { code: 'ATTRIBUTE_VALUE_REJECTED' },
    { code: 'BULK_TOO_LARGE' },
    { code: 'BUNDLE_SLOT_NOT_FOUND' },
    { code: 'BUNDLE_SLOT_OPTION_NOT_FOUND' },
    { code: 'FIELD_IMMUTABLE' },
    { code: 'FILTER_NOT_ALLOWED' },
    { code: 'GALLERY_ITEM_NOT_FOUND' },
    { code: 'GALLERY_LABEL_ALREADY_TAKEN' },
    { code: 'GALLERY_LABEL_LIMIT_EXCEEDED' },
    { code: 'GROUPED_ITEM_NOT_FOUND' },
    { code: 'INVALID_QUANTITY_RANGE' },
    { code: 'LINK_ALREADY_EXISTS' },
    { code: 'MAX_EXCEEDED' },
    { code: 'MIN_NOT_MET' },
    { code: 'NESTED_COMPOSITE_NOT_ALLOWED' },
    { code: 'OPTION_ALREADY_EXISTS' },
    { code: 'PACKAGING_UNIT_NAME_CONFLICT' },
    { code: 'PACKAGING_UNIT_NOT_FOUND' },
    { code: 'PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE' },
    { code: 'PRICE_ORDERING_UNAVAILABLE' },
    { code: 'PRICE_RANGE_INVALID' },
    { code: 'PRODUCT_ARCHIVED' },
    { code: 'PRODUCT_DELETE_BLOCKED' },
    { code: 'PRODUCT_FEED_CONFIRMATION_REQUIRED' },
    { code: 'PRODUCT_FEED_DISABLED' },
    { code: 'PRODUCT_FEED_TAXONOMY_CONFLICT' },
    { code: 'PRODUCT_FEED_TEMPLATE_CONFLICT' },
    { code: 'PRODUCT_FEED_TEMPLATE_UNBOUND' },
    { code: 'PRODUCT_IN_STOCK' },
    { code: 'PRODUCT_LINK_NOT_FOUND' },
    { code: 'PRODUCT_NOT_FOUND' },
    { code: 'PRODUCT_NOT_IN_COMPARISON' },
    { code: 'PRODUCT_TYPE_MISMATCH' },
    { code: 'PRODUCT_UNMANAGED_STOCK' },
    { code: 'SELECTION_TOO_LARGE' },
    { code: 'SELF_LINK_NOT_ALLOWED' },
    { code: 'SKU_ALREADY_EXISTS' },
    { code: 'SKU_NOT_IN_ASSORTMENT' },
    { code: 'SYSTEM_ATTRIBUTE_SET_IMMUTABLE' },
    { code: 'TARGET_PRODUCT_NOT_FOUND' },
    { code: 'UNKNOWN_OPTION' },
    { code: 'VARIANT_AXIS_MISSING' },
    { code: 'VARIANT_COMBINATION_EXISTS' },
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
    // The three below arrive with feature 091's Phase 4 batch 15, by the route
    // batch 10 established: `AppShell.tsx` carried a hand-written
    // `PALETTE_ITEMS` row for each of these destinations, and a hand-written
    // palette row is a copy the server was never asked about — it went on
    // advertising the screen after an operator withdrew the module. Each is a
    // manifest action now, which is the surface the effective enabled-set
    // filters. The destinations, codes and keywords are the rows'; the labels
    // and descriptions are the six strings they rendered, moved out of
    // `_i18n`'s bundle into this module's own.
    {
      id: 'open-products',
      labelKey: 'actions.openProducts.label',
      descriptionKey: 'actions.openProducts.description',
      icon: 'Package',
      targetRoute: '/catalog/products',
      requiredPermission: 'catalog:read',
      keywords: ['products', 'catalog', 'items', 'produkty', 'katalog'],
      weight: 200,
    },
    {
      id: 'open-categories',
      labelKey: 'actions.openCategories.label',
      descriptionKey: 'actions.openCategories.description',
      icon: 'Boxes',
      targetRoute: '/catalog/categories',
      requiredPermission: 'catalog:read',
      keywords: ['category', 'categories', 'tree', 'kategorie'],
      weight: 300,
    },
    {
      id: 'open-attributes',
      labelKey: 'actions.openAttributes.label',
      descriptionKey: 'actions.openAttributes.description',
      icon: 'Tag',
      targetRoute: '/catalog/attributes',
      requiredPermission: 'catalog:read',
      keywords: ['attribute', 'attributes', 'atrybuty'],
      weight: 400,
    },
  ],
});

/**
 * What this module offers the admin home dashboard's Recent Activity card —
 * feature 080, T042j / D-163.1.
 *
 * The **declaration** axis: eligibility, never a decision. Whether these rows
 * actually appear is the operator's, held in `catalog.recent_activity_visible`
 * and defaulting to visible, flipped on `/platform/modules` beside this
 * module's activation control.
 *
 * These six tokens were four entries in four hand-maintained host tables —
 * `RECENT_ACTIVITY_ACTIONS`, the `product.` prefix row of `PREFIX_TO_MODULE`,
 * the route's `module` enum and the admin's `ACTIVITY_RENDERING`. All four are
 * derived from this now, which is what lets a packaged module reach the card at
 * all (D-163: `RecentActivityModule` was a closed union of four core ids).
 *
 * `product.delete` is deliberately not here and was not in `ACTIVITY_RENDERING`
 * either: the allow-list carried it, the renderer did not, so it drew the
 * unknown-verb fallback. One declaration cannot hold that disagreement.
 */
export const recentActivity = defineModuleRecentActivity({
  entries: [
    { action: 'product.create', icon: 'Plus', labelKey: 'activity.verb.product.create' },
    { action: 'product.update', icon: 'Edit', labelKey: 'activity.verb.product.update' },
    { action: 'product.archive', icon: 'Archive', labelKey: 'activity.verb.product.archive' },
    { action: 'product.unarchive', icon: 'Box', labelKey: 'activity.verb.product.unarchive' },
    {
      action: 'product.bulk_update',
      icon: 'Edit',
      labelKey: 'activity.verb.product.bulk_update',
    },
  ],
});
