import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Payment Methods module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'payment_methods',
  name: 'Payment Methods',
  description:
    'Payment method definitions and per-channel availability.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T097).
  // `organizations` since feature 072 (T138): the public method list is
  // filtered by the caller's per-Organization allow-list, which this module
  // reads through `organizationRestrictionPort`. The edge existed before as a
  // root-supplied closure and was therefore invisible to the manifest.
  dependencies: ['auth', 'organizations'],
  /**
   * D-44 — a real port edge deliberately kept out of `dependencies`, because
   * the owner disappearing is a state this module handles.
   */
  nonBindingDependencies: [
    {
      moduleId: 'payments',
      name: 'paymentReadPort',
      kind: 'degrades-without',
      whenAbsent: 'a payment method cannot be deleted, only set inactive',
      reason:
        'The delete-guard (feature 034, FR-003) asks how many payment attempts still point at ' +
        'the method an operator is deleting. Until feature 075 it asked in raw SQL against ' +
        '`payments`\' own table, which named no import specifier and so crossed the boundary ' +
        'invisibly (D-87). `degrades-without` rather than `dependencies`: `payments` declares ' +
        'this module, so declaring it back would close a cycle, and acknowledging the edge ' +
        'would keep the bind and make `payments.enabled` unusable in every shop that takes ' +
        'money. `backend.ts` asks `effectiveState.isPresent` before resolving the port, and ' +
        'the Command refuses the delete with a 409 naming the reason rather than deleting a ' +
        'method whose references nobody could count.',
    },
  ],
  /**
   * The module's own authority (2026-08-28).
   *
   * All six admin routes used to enforce `catalog:read` / `catalog:write`, so
   * whoever could edit a product could read the payment-method configuration
   * and rewrite it — which methods a checkout offers, their surcharge, and
   * which order status each payment outcome moves an order to. Both codes were
   * real, declared and enforced, so the permission inventory's two directions
   * were clean over the site and `check:action-route-permissions` found the
   * palette action in perfect agreement with its target: they both said
   * `catalog:read`.
   *
   * A pair and no third code, spelled `<module id>:<read|write>` like the five
   * gateway modules, `returns` and `invoices`. A prefix that is not its owner's
   * id is the mistake `PERMISSION_CATALOGUE` comments on twice
   * (`integrations:manage`, `audit_log:read`), both frozen because they are
   * persisted in role rows; getting it right on a code that does not exist yet
   * is free. The codes stay here rather than in `PERMISSION_CATALOGUE`, which
   * is for codes spanning modules — this module owns these outright.
   *
   * No data migration: see
   * `test/contract/payment_methods/permission-authority.test.ts`.
   */
  permissions: [
    { code: 'payment_methods:read', label: 'View payment methods' },
    { code: 'payment_methods:write', label: 'Configure payment methods' },
  ],
  settings: {
    moduleCode: 'payment_methods',
    groups: [{ code: 'payment_methods', name: 'Payment methods' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'payment_methods.enabled',
        name: 'Payment methods enabled',
        // Same missing consequence as its delivery twin: with no method to
        // pick, order placement answers "Payment method is not active" and no
        // order can be completed at all. Switching this off is a different act
        // from switching `payments` off — that one withdraws the adapters the
        // methods are configured against — and both end the same way for a
        // buyer, so both descriptions have to say so.
        description:
          'Switches the payment-method catalog on or off: the admin screens that define methods and their per-channel availability, and the public list a checkout picks from. With no method to pick, checkout cannot be completed and the shop stops taking orders. Nothing is dropped — every method, its channel bindings, its per-organization allow-list and the payments already taken against it stay in the database, and the catalog returns exactly as configured when you switch it back on.',
        groupCode: 'payment_methods',
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
  // `delivery_methods`. The dependents that do declare it — `payments`,
  // `quick_order`, and the four provider modules — fail closed when it is off,
  // which is the intended meaning of switching a payment catalog off.
  activation: { settingCode: 'payment_methods.enabled', default: true },
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Feature 076 (D-83 item 8) — a standing Principle XVI gap, closed here
  // because this change is what starts sending operators to `/payment-methods`
  // from four gateway screens. The module owned a real admin route and declared
  // no palette action at all.
  //
  // `targetRoute` is the landing route **plain**: the action route regex rejects
  // a query string, so the gateway screens' `?highlight=<code>` deep link is an
  // in-page anchor rather than a second action. `payment_methods:read` is what
  // gates `GET /api/v1/admin/payment-methods`, so the palette never advertises
  // a 403.
  actions: [
    {
      id: 'open-payment-methods',
      labelKey: 'actions.openPaymentMethods.label',
      descriptionKey: 'actions.openPaymentMethods.description',
      icon: 'CreditCard',
      targetRoute: '/payment-methods',
      requiredPermission: 'payment_methods:read',
      keywords: ['payment', 'method', 'availability', 'checkout', 'płatność', 'metoda'],
      weight: 150,
    },
  ],
});
