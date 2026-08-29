import {
  defineModuleManifest,
  defineModuleRecentActivity,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Settings manifest for the Inventory module — feature 010.
 *
 * Seven settings (FR-019 / FR-029 / FR-031). Setting codes follow
 * the foundation regex `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */

export const INVENTORY_SETTING_CODES = {
  DISPLAY_MODE: 'inventory.display_mode',
  FULFILMENT_STRATEGY: 'inventory.fulfilment_strategy',
  FULFILMENT_STRATEGY_WAREHOUSE_ORDER: 'inventory.fulfilment_strategy_warehouse_order',
  GLOBAL_THRESHOLD_HIGH: 'inventory.global_threshold_high',
  GLOBAL_THRESHOLD_MEDIUM: 'inventory.global_threshold_medium',
  GLOBAL_THRESHOLD_LOW: 'inventory.global_threshold_low',
  LOW_STOCK_ALERT_RECIPIENT_EMAIL: 'inventory.low_stock_alert_recipient_email',
  ALLOW_NEGATIVE_STOCK: 'inventory.allow_negative_stock',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'inventory',
  groups: [{ code: 'inventory', name: 'Inventory' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'inventory.enabled',
      name: 'Inventory enabled',
      description:
        'Switches stock management on or off: warehouses, stock levels and their adjustments, low-stock alerts, the back-in-stock notification flow and the storefront stock figure. Nothing is dropped — every warehouse, stock row and pending notification stays in the database and resumes where it was.',
      groupCode: 'inventory',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: INVENTORY_SETTING_CODES.DISPLAY_MODE,
      name: 'Storefront stock display mode',
      description:
        'How storefront product cards and PDP render stock: exact / band / available_or_not.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: 'band',
    },
    {
      code: INVENTORY_SETTING_CODES.FULFILMENT_STRATEGY,
      name: 'Order fulfilment strategy',
      description:
        'Picks warehouses to fulfil order lines. any | default_first | lowest_stock_first | highest_stock_first | defined_order.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: 'default_first',
    },
    {
      code: INVENTORY_SETTING_CODES.FULFILMENT_STRATEGY_WAREHOUSE_ORDER,
      name: 'Warehouse order (for "defined_order" strategy)',
      description: 'Ordered list of warehouse IDs walked by the defined-order strategy.',
      groupCode: 'inventory',
      valueType: 'json',
      defaultValue: [],
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_HIGH,
      name: 'Global high-stock threshold',
      description: 'Quantity at or above which a product is considered high-stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 100,
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_MEDIUM,
      name: 'Global medium-stock threshold',
      description: 'Quantity at or above which a product is considered medium-stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 20,
    },
    {
      code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_LOW,
      name: 'Global low-stock threshold',
      description:
        'Quantity at or above which a product is considered low-stock. Below this it is out of stock.',
      groupCode: 'inventory',
      valueType: 'number',
      defaultValue: 1,
    },
    {
      code: INVENTORY_SETTING_CODES.LOW_STOCK_ALERT_RECIPIENT_EMAIL,
      name: 'Low-stock alert recipient email',
      description: 'Email to receive low-stock alerts. Empty falls back to the platform admin.',
      groupCode: 'inventory',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: INVENTORY_SETTING_CODES.ALLOW_NEGATIVE_STOCK,
      name: 'Allow ordering below stock (negative stock)',
      description:
        'Global gate for per-product backorder. When false, no product accepts orders below available stock regardless of its per-product backorder flag. When true, products whose backorder flag is set may be ordered into negative stock.',
      groupCode: 'inventory',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'inventory',
  name: 'Inventory',
  description:
    'Multi-warehouse stock levels, fulfilment strategy, and storefront display modes.',
  version: '1.0.0',
  // Feature 075, Phase C adds `customer_accounts` and `email`. Both were
  // reached by importing a file rather than resolving a port, so neither
  // appeared here: the availability queue turns a subscription into an e-mail
  // address by reading `CustomerAccount`, and every message this module sends
  // leaves through `email`'s transport. `customer_accounts` belongs in
  // `dependencies` rather than `nonBindingDependencies` for the reason
  // `quick_order` gives — a back-in-stock notice addressed to an account the
  // platform will not identify is worse than a refused subscription.
  //
  // D-94.1 adds `orders`, for the foreign key
  // `stock_allocations_order_item_fk` (`stock_allocations.order_item_id` ->
  // `order_items.id`, `on delete restrict`). AGENTS.md § Migrations item 4: a
  // cross-module foreign key is declared here or the build fails. It is the
  // one edge of the four-site family that closes no cycle — `orders` resolves
  // no port this module owns in `dependencies`, only the two
  // `degrades-without` reads placement makes.
  // `audit_logs` owns `auditReferenceRegistry`, the registry this module pushes
  // its own "what is this audit row called, and where does the admin app show
  // it?" resolver into (feature 075, D-87). The registry is ungated and its
  // owner is non-deactivatable, so the declaration buys install and migration
  // order rather than a flip-time refusal.
  dependencies: [
    'audit_logs',
    'auth',
    'catalog',
    'customer_accounts',
    'dictionaries',
    'email',
    'orders',
    'organizations',
    'sales_channels',
    'settings',
    'transactional_emails',
  ],
  // D-44 — real to the container, binding on no operator.
  nonBindingDependencies: [
    {
      moduleId: 'prompt_actions',
      name: 'promptActionToolRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s boot hook, of the warehouse resolver and the ' +
        '`set_stock_level` mutation built over its own services. Nothing is read back: ' +
        'the registry is a plain registration that drops every tool whose owner is not ' +
        'effectively present, so an absent contributor costs the host nothing and an ' +
        'absent host holds a table nobody walks. Declaring the edge would make an ' +
        'optional assistant undeactivatable for as long as stock is tracked.',
    },
  ],
  /**
   * The module's own authority (2026-08-29).
   *
   * All 21 admin gates enforced a code somebody else owns — nine reads on
   * `orders:read`, twelve writes on `catalog:write`. So whoever could edit a
   * product description could create, rename and **delete a warehouse**,
   * rewrite a stock count, run a CSV import over every product's stock and bind
   * or unbind a warehouse from a sales channel, which decides what that channel
   * can sell. And whoever could read orders could enumerate every warehouse and
   * its address. Neither code names the data touched, which is the
   * discriminator `payments-permission-ownership.md` §7.2 sets; the sweep
   * applied it per module and `specs/first-deployment-window.md` §2 re-applies
   * it per route, which is where authority is actually exercised.
   *
   * Nothing could see it. Both codes are real, declared and enforced, so the
   * permission inventory's two directions were clean; D-173's `foreign-gate`
   * sweep passes both sites deliberately, because `catalog` and `orders` are
   * `nonDeactivatable` and the availability coupling that sweep asks about can
   * never bite. `check:action-route-permissions` is the one check that *did*
   * look here — this module declares the `open-inventory` action below — and it
   * agreed, because the action correctly named the code the route enforced.
   * That is the check working: it compares an action to its route and has no
   * opinion about whether the route's code is the right authority.
   *
   * A pair and no third code, spelled `<module id>:<read|write>` like
   * `payment_methods`, `delivery_methods`, `taxes`, `returns` and `invoices`.
   *
   * No data migration: see
   * `test/contract/inventory/permission-authority.test.ts`.
   */
  permissions: [
    { code: 'inventory:read', label: 'View stock and warehouses' },
    { code: 'inventory:write', label: 'Manage stock and warehouses' },
  ],
  /**
   * The thirteen error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where the sentence for each is looked up from: `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`, which already holds all thirteen in
   * both languages.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5): it is exactly
   * what the prefix chain in `@endora-commerce/mod-i18n` routes here today,
   * copied from the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` rather than
   * re-derived. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **Two codes that look like they belong here and do not**, because the chain
   * is ordered and `catalog`'s rule runs before this module's:
   * `PRODUCT_UNMANAGED_STOCK` and `PRODUCT_IN_STOCK` are named in the chain's own
   * `INVENTORY_MISC_ERROR_CODES` set and route to `catalog` regardless, so two of
   * that set's three members are unreachable. An author who wrote this list from
   * the chain's source rather than from its answer would have taken two of
   * `catalog`'s codes.
   *
   * No `tokens`: no code here carries a refusal discriminator, which is derivable
   * from this module's bundles holding no `errors.<CODE>.<token>` key.
   */
  errorCodes: [
    { code: 'AVAILABILITY_NOTIFICATION_NOT_FOUND' },
    { code: 'CHANNEL_NO_WAREHOUSES' },
    { code: 'CHANNEL_WAREHOUSE_NOT_FOUND' },
    { code: 'STOCK_IMPORT_INVALID_FILE' },
    { code: 'STOCK_LEVEL_NOT_FOUND' },
    { code: 'STOCK_UNAVAILABLE' },
    { code: 'THRESHOLDS_INVALID' },
    { code: 'WAREHOUSE_CANNOT_DELETE_DEFAULT' },
    { code: 'WAREHOUSE_CODE_TAKEN' },
    { code: 'WAREHOUSE_HAS_STOCK' },
    { code: 'WAREHOUSE_INVALID_CODE' },
    { code: 'WAREHOUSE_IS_DEFAULT_FOR_CHANNELS' },
    { code: 'WAREHOUSE_NOT_FOUND' },
  ],
  settings,
  // Feature 073 (Constitution XVII) — the operator's activation control.
  activation: { settingCode: 'inventory.enabled', default: true },
  i18n: { bundlesDir: 'i18n' },
  // Feature 047 — admin-editable transactional emails owned by this module.
  transactionalEmails: [
    {
      code: 'low_stock_alert',
      name: 'Low stock alert',
      group: 'inventory',
      variables: [
        { key: 'product.name', label: 'Product name', sampleValue: 'Widget' },
        { key: 'product.sku', label: 'Product SKU', sampleValue: 'WID-001' },
        { key: 'cumulativeOnHand', label: 'Cumulative on-hand', sampleValue: '3' },
        { key: 'threshold', label: 'Threshold', sampleValue: '5' },
      ],
    },
    {
      code: 'availability_back_in_stock',
      name: 'Back in stock notification',
      group: 'inventory',
      variables: [{ key: 'product.name', label: 'Product name', sampleValue: 'Widget' }],
    },
  ],
  actions: [
    {
      id: 'open-inventory',
      labelKey: 'actions.openInventory.label',
      descriptionKey: 'actions.openInventory.description',
      icon: 'Boxes',
      targetRoute: '/inventory',
      // `inventory:read`, the code `GET /api/v1/admin/inventory` now enforces
      // (`routes.admin.ts`). This has been corrected twice for two different
      // reasons and both are worth keeping. Issue #232 replaced a `catalog:write`
      // that was wrong in both directions at once — it hid the screen from
      // operators who can open it and offered it to some who cannot — with
      // `orders:read`, the code the route then enforced. That was right, and it
      // is why `check:action-route-permissions` had nothing to say when the
      // gates themselves were the defect: the check compares an action to its
      // route, which is a derivation, and never asks whether the route's code is
      // the right authority, which is a judgement.
      requiredPermission: 'inventory:read',
      keywords: ['stock', 'inventory', 'warehouse', 'magazyn', 'zapasy'],
      weight: 230,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const inventoryManifest = settings;

/**
 * What this module offers the admin home dashboard's Recent Activity card —
 * feature 080, T042j / D-163.1.
 *
 * The **declaration** axis: eligibility, never a decision. Whether these rows
 * appear is the operator's, held in `inventory.recent_activity_visible` and
 * defaulting to visible, flipped on `/platform/modules` beside this module's
 * activation control. The two are different questions about the same module —
 * "does this client want stock management" and "does this client want stock
 * movements on their home screen" — which is why there are two switches.
 */
export const recentActivity = defineModuleRecentActivity({
  entries: [
    { action: 'warehouse.create', icon: 'Truck', labelKey: 'activity.verb.warehouse.create' },
    { action: 'warehouse.update', icon: 'Edit', labelKey: 'activity.verb.warehouse.update' },
    {
      action: 'warehouse.deactivate',
      icon: 'Archive',
      labelKey: 'activity.verb.warehouse.deactivate',
    },
    {
      action: 'warehouse.reactivate',
      icon: 'Truck',
      labelKey: 'activity.verb.warehouse.reactivate',
    },
    { action: 'stock_level.adjust', icon: 'Box', labelKey: 'activity.verb.stock_level.adjust' },
    {
      action: 'stock_level.bulk_import',
      icon: 'Upload',
      labelKey: 'activity.verb.stock_level.bulk_import',
    },
    {
      action: 'low_stock_threshold.create',
      icon: 'Tag',
      labelKey: 'activity.verb.low_stock_threshold.create',
    },
    {
      action: 'low_stock_threshold.update',
      icon: 'Edit',
      labelKey: 'activity.verb.low_stock_threshold.update',
    },
    {
      action: 'low_stock_threshold.delete',
      icon: 'Archive',
      labelKey: 'activity.verb.low_stock_threshold.delete',
    },
  ],
});
