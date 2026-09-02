import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Delivery Methods module — manifest backfill (Module Lifecycle, feature 018);
 * the shipping-method adapter framework host (feature 035).
 *
 * Predates the lifecycle system; the core module's schema is owned by
 * platform-wide migrations (delivery_methods table + feature-035 columns in
 * migration 052). The core module itself has no install/uninstall hook.
 *
 * Recognition condition (feature 035, FR-001): a *separate* platform module is
 * recognised as a shipping-method adapter iff it registers a `ShippingAdapter`
 * in the process-wide `shippingAdapterRegistry` (see
 * services/registry-singleton.ts) from its **boot hook**, naming itself as the
 * contributing module. Not from `installHook`: the registry is an in-memory
 * table per process, install runs once in the CLI process, and the serving
 * process reads what its own composition pushed. The `delivery_methods` row is
 * static reference data and ships as the contributing module's migration;
 * `DeliveryMethodReconciler.ensureMethodForAdapter(...)` stays available from
 * an `installHook` for a row that must be created from code.
 *
 * No `uninstallHook` withdraws the adapter, and none should: the registry
 * records the contributing module on every entry and filters its enumeration on
 * that module's effective state, so an absent contributor is answered at the
 * read. The row and its Shipments are preserved either way (FR-003). See
 * docs/docs/modules/delivery_methods.md § *When the registry is read*.
 */
export const manifest = defineModuleManifest({
  id: 'delivery_methods',
  name: 'Delivery Methods',
  description:
    'Shipping/delivery method definitions and per-channel availability.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T095).
  // `organizations` since feature 072 (T138) — see the payment twin.
  dependencies: ['auth', 'organizations'],
  /**
   * D-44 — real to the container, binding on no operator (feature 075, the
   * `delivery_methods` boundary shard).
   *
   * `shipments` declares this module, so the ordinary declaration closes a
   * manifest cycle, and acknowledging the edge would put `delivery_methods` —
   * present in every deployment that ships anything — among the dependents that
   * refuse the flip, making shipments permanently unswitchable. The delete
   * guard has a defined behaviour instead: it probes
   * `effectiveState.isPresent('shipments')` before it resolves the port and
   * refuses the delete when the answer is no, so nothing catches
   * `ModuleDisabledError` and the degrade is declared rather than laundered out
   * of a closed gate.
   *
   * Refusing rather than proceeding is the whole point of the entry.
   * `shipments.delivery_method_id` carries no foreign key, so this count is the
   * only thing between a delete and permanently orphaned shipment history — and
   * a switched-off module is exactly when no screen would show the operator
   * that the history exists. Switching a module off is meant to be reversible;
   * a delete taken while it was off is not. Every row, binding and setting stays
   * where it was, so the delete becomes available again the moment shipments
   * comes back.
   */
  nonBindingDependencies: [
    {
      moduleId: 'shipments',
      name: 'shipmentUsagePort',
      kind: 'degrades-without',
      whenAbsent:
        'Deleting a delivery method is refused, naming the shipments module. Every other ' +
        'surface — the catalog, the channel bindings, the storefront list, the writes — is ' +
        'unaffected.',
      reason:
        'The FR-003 delete guard counts the shipments created against a method before it ' +
        'removes the row, and those rows belong to `shipments`. It was a raw ' +
        '`select count(*) from "shipments"` on this module\'s own transaction until feature ' +
        '075 — a boundary crossing that named no import specifier and so compiled. The ' +
        'ordinary declaration closes a cycle (`shipments` depends on this module for the ' +
        'method row, the adapter registry and the order-status registry) and an acknowledged ' +
        'edge would refuse every attempt to switch shipments off, which is a capability ' +
        'operators are meant to have.',
    },
  ],
  /**
   * The module's own authority (2026-08-28).
   *
   * All three admin routes used to enforce `catalog:read` / `catalog:write`, so
   * whoever could edit a product could read the delivery-method configuration,
   * rewrite it — which methods a checkout offers, their surcharge, and which
   * order status a shipment outcome moves an order to — and delete a method
   * outright. Both codes were real, declared and enforced, so the permission
   * inventory's two directions were clean over the site, and
   * `check:action-route-permissions` never looked at all: this module declares
   * no manifest action, so the check has nothing of its own to compare.
   *
   * A pair and no third code, spelled `<module id>:<read|write>` like the five
   * gateway modules, `payment_methods`, `returns` and `invoices`. A prefix that
   * is not its owner's id is the mistake `PERMISSION_CATALOGUE` comments on
   * twice (`integrations:manage`, `audit_log:read`), both frozen because they
   * are persisted in role rows; getting it right on a code that does not exist
   * yet is free. The codes stay here rather than in `PERMISSION_CATALOGUE`,
   * which is for codes spanning modules — this module owns these outright.
   *
   * No data migration: see
   * `test/contract/delivery_methods/permission-authority.test.ts`.
   */
  permissions: [
    { code: 'delivery_methods:read', label: 'View delivery methods' },
    { code: 'delivery_methods:write', label: 'Configure delivery methods' },
  ],
  settings: {
    moduleCode: 'delivery_methods',
    groups: [{ code: 'delivery_methods', name: 'Delivery methods' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'delivery_methods.enabled',
        name: 'Delivery methods enabled',
        // The consequence sentence was missing the same way the payments one
        // was: "the public list a checkout picks from" is accurate and stops
        // short of what it means for the shop. With no method to pick, order
        // placement answers "Delivery method is not active" and no order can be
        // completed at all.
        description:
          'Switches the delivery-method catalog on or off: the admin screens that define methods and their per-channel availability, and the public list a checkout picks from. With no method to pick, checkout cannot be completed and the shop stops taking orders. Nothing is dropped — every method, its channel bindings and the shipments already created against it stay in the database, and the catalog returns exactly as configured when you switch it back on.',
        groupCode: 'delivery_methods',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 073, Amendment A1 (Constitution XVII) — deactivatable, because the
  // reason it used to give does not hold. "The platform cannot take an order"
  // rests on an edge that is not in the graph: `orders` declares `addresses`,
  // `api_keys`, `carts`, `credit_limits`, `organizations`, `promotions`,
  // `settings` and `transactional_emails`, and neither this module nor
  // `payment_methods`. The dependents that do declare it — `payments`,
  // `quick_order`, `shipments` — fail closed when it is off, which is the
  // intended meaning of switching a delivery catalog off, not an accident.
  // Feature 091 (Phase 4, batch 8) — this module ships a bundle now: its
  // sidebar entry's `labelKey` is module-relative (R8) and resolves in this
  // module's own namespace. Its screen's copy stays in `_i18n`'s `core`
  // scope, which is batch 4's shape and not a new one.
  i18n: { bundlesDir: 'i18n' },
  // Feature 091 (Phase 4, batch 8) — the palette row `AppShell.tsx` carried by
  // hand, arriving as the declaration Principle XVI names, for the reason
  // recorded on `credit_limits`' entry: a `PALETTE_ITEMS` literal is a copy of
  // an advertisement nothing filtered by the effective enabled-set.
  // `delivery_methods:read` is what gates `GET /api/v1/admin/delivery-methods`,
  // so the palette never advertises a 403.
  actions: [
    {
      id: 'open-delivery-methods',
      labelKey: 'actions.openDeliveryMethods.label',
      descriptionKey: 'actions.openDeliveryMethods.description',
      icon: 'Truck',
      targetRoute: '/delivery-methods',
      requiredPermission: 'delivery_methods:read',
      keywords: ['delivery', 'shipping', 'methods', 'courier', 'metody dostawy', 'wysyłka', 'kurier'],
      weight: 300,
    },
  ],
  activation: { settingCode: 'delivery_methods.enabled', default: true },
});
