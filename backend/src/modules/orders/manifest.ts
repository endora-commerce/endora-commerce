import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Orders module — manifest.
 *
 * Feature 036 adds the customer-facing business Order ID. Its optional
 * prefix/suffix are declared here as settings (`orders.business_id.*`) and
 * seeded by the module-lifecycle ManifestReconciler on boot — the same path
 * `carts.abandonment.*` uses. They are Sales-Channel-scopable through the
 * standard settings scoping; defaults are empty (bare numeric ID).
 */

export const ORDERS_SETTING_CODES = {
  BUSINESS_ID_PREFIX: 'orders.business_id.prefix',
  BUSINESS_ID_SUFFIX: 'orders.business_id.suffix',
  /** Feature 038 — minimum order value to pass Checkout / admin create (0 = no minimum). */
  MIN_ORDER_VALUE: 'orders.min_order_value',
  /** Feature 038 — whether reordering a past order is allowed. */
  REORDER_ENABLED: 'orders.reorder_enabled',
  /** Feature 038 — extra emails CC'd on every order confirmation in scope. */
  CONFIRMATION_RECIPIENTS: 'orders.confirmation_recipients',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'orders',
  groups: [{ code: 'orders', name: 'Orders' }],
  settings: [
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_PREFIX,
      name: 'Business Order ID prefix',
      description:
        'Text prepended to the generated business Order ID shown to the Customer (e.g. "ORD-"). Empty = no prefix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: ORDERS_SETTING_CODES.BUSINESS_ID_SUFFIX,
      name: 'Business Order ID suffix',
      description:
        'Text appended to the generated business Order ID shown to the Customer (e.g. "-2026"). Empty = no suffix.',
      groupCode: 'orders',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: ORDERS_SETTING_CODES.MIN_ORDER_VALUE,
      name: 'Minimum order value',
      description:
        'Minimum order total required to pass Checkout or to create an order. 0 = no minimum. Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'number',
      defaultValue: 0,
    },
    {
      code: ORDERS_SETTING_CODES.REORDER_ENABLED,
      name: 'Reordering enabled',
      description:
        'When enabled, a past order can be placed again (reorder). Sales-channel value overrides the global value.',
      groupCode: 'orders',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: ORDERS_SETTING_CODES.CONFIRMATION_RECIPIENTS,
      name: 'Order confirmation recipients',
      description:
        'Additional email addresses that receive a confirmation for every order placed in scope (global or per Sales Channel).',
      groupCode: 'orders',
      valueType: 'string_list',
      defaultValue: [],
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'orders',
  name: 'Orders',
  description: 'Order placement, lifecycle, and history.',
  version: '1.3.0',
  // Feature 072 (T141) — `addresses` and `credit_limits` were reached through
  // options a root passed down, so neither appeared here. Order placement
  // resolves a delivery address and reserves against the credit limit; both are
  // as real as the edges already listed.
  // Feature 075 — `assets_library`, `catalog` and `customer_accounts` join the
  // list because the route surface and the external intake read their rows
  // through published ports instead of their entity classes. All three are
  // non-deactivatable and none of them declares this module, so the edge binds
  // nothing an operator could otherwise have flipped and closes no cycle.
  dependencies: [
    'addresses',
    'api_keys',
    'assets_library',
    'carts',
    'catalog',
    'credit_limits',
    'customer_accounts',
    'organizations',
    'promotions',
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
        'A push, from this module’s boot hook, of the order resolver and the status-change ' +
        'mutations built over its own transition service. Nothing is read back: the ' +
        'registry is a plain registration that drops every tool whose owner is not ' +
        'effectively present, so an absent contributor costs the host nothing and an ' +
        'absent host holds a table nobody walks. Declaring the edge would make an optional ' +
        'assistant undeactivatable for as long as the platform takes orders.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentAdapterRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no payment method to choose from',
      reason:
        'Placement dispatches through the adapter table `payment_methods` owns, and the ' +
        'catalogue a buyer picks from is served by that module’s own routes — so switching it ' +
        'off closes the choice at its own seam and leaves order taking, order history and ' +
        'every admin order screen serving. Declaring it in `dependencies` would instead make ' +
        '`payment_methods.enabled` a control no operator could ever use, which is the ' +
        'authority ruling 2 of feature 074 withholds from a dependent.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentOrderStatusRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no payment method to choose from',
      reason:
        'The `statusOn*` references the same module registers beside its adapter table, read ' +
        'for the status an order moves to when a payment settles. It shares the sentence ' +
        'above because it shares the cause: with no method to choose there is no payment to ' +
        'settle. Same ground for keeping it out of `dependencies`.',
    },
    {
      moduleId: 'payments',
      name: 'paymentEmailRendererPort',
      kind: 'degrades-without',
      whenAbsent:
        'the order confirmation still goes out, with the payment line written from the ' +
        'method snapshot instead of a gateway’s own wording',
      reason:
        'The payment line of the order-confirmation e-mail (feature 034 FR-016/FR-017) is ' +
        'rendered through the registry `payments` hosts, which an adapter may push a custom ' +
        'renderer into. `payments` declares this module, so `dependencies` would close a ' +
        'cycle; and an acknowledged edge keeps the bind, which would make a deactivatable ' +
        'module undeactivatable for as long as the platform takes orders — a buyer who paid ' +
        'on invoice must still receive their confirmation. `backend.ts` asks ' +
        '`effectiveState.isPresent` per send and falls back to this module’s own baseline.',
    },
    {
      moduleId: 'shipments',
      name: 'shippingEmailRendererPort',
      kind: 'degrades-without',
      whenAbsent:
        'the order confirmation still goes out, with the delivery line written from the ' +
        'method snapshot instead of a carrier’s own wording',
      reason:
        'The delivery twin of `payments:paymentEmailRendererPort` (feature 035), and the ' +
        'same shape: `shipments` declares this module, so the edge cannot go in ' +
        '`dependencies`, and binding it would stop an operator switching shipments off on a ' +
        'platform that keeps taking orders. Presence is asked per send in `backend.ts`.',
    },
    {
      moduleId: 'payment_methods',
      name: 'paymentMethodReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'the admin create-order preview quotes no payment surcharge, because there is no ' +
        'method catalogue to quote one from',
      reason:
        'The method row behind an id the create-order form submitted. It shares the ground ' +
        'of the two entries above: `payment_methods` serves the catalogue a method is ' +
        'chosen from, so with the module off no id reaches this read in the first place, and ' +
        'declaring it in `dependencies` would make `payment_methods.enabled` a control no ' +
        'operator could use. `routes.ts` receives an accessor and asks presence per request.',
    },
    {
      moduleId: 'delivery_methods',
      name: 'deliveryMethodReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'the admin create-order preview quotes no delivery cost, because there is no method ' +
        'catalogue to quote one from',
      reason:
        'The delivery twin of `payment_methods:paymentMethodReadPort`, and the same shape. ' +
        '`shipments` declares `delivery_methods` in `dependencies` and may: it is itself ' +
        'deactivatable, so the bind costs an operator a choice they still have. This module ' +
        'is not, so the same declaration here would be permanent.',
    },
    {
      moduleId: 'invoices',
      name: 'invoiceReadPort',
      kind: 'degrades-without',
      whenAbsent: 'an order’s invoice PDF is no longer offered; nothing else about an order changes',
      reason:
        'The customer invoice download and the admin bulk print read the document `invoices` ' +
        'owns. `invoices` declares this module — an invoice is raised against an order — so ' +
        '`dependencies` would close a cycle `migration-order.ts` fails on, and an ' +
        'acknowledged edge would keep the bind and make `invoices.enabled` unusable, because ' +
        'this module is non-deactivatable. Both routes ask presence and answer 404 ' +
        '`INVOICE_NOT_READY`, which is the answer an order that has not been invoiced yet ' +
        'already gets.',
    },
    {
      moduleId: 'invoices',
      name: 'invoicePdfPort',
      kind: 'degrades-without',
      whenAbsent: 'an order’s invoice PDF is no longer offered; nothing else about an order changes',
      reason:
        'The renderer behind the same two routes, and the same sentence: a VAT document is ' +
        'an `invoices` surface, so a business that has switched invoicing off should not be ' +
        'served one from an order screen.',
    },
    {
      moduleId: 'delivery_methods',
      name: 'shippingAdapterRegistry',
      kind: 'degrades-without',
      whenAbsent: 'checkout offers no delivery method to choose from',
      reason:
        'The delivery twin of `payment_methods:paymentAdapterRegistry`, read for placement ' +
        'dispatch. `delivery_methods` serves the catalogue a buyer picks from, so its own ' +
        'seam closes the choice while the rest of order taking keeps working. Declaring it ' +
        'would kill `delivery_methods.enabled` for every deployment that takes orders.',
    },
  ],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base. This module had
  // no activation declaration at all, which resolved as "always activated" and
  // read as an omission rather than a decision. The order is the transaction
  // the platform exists to record: without it there is nothing to price, ship,
  // invoice or audit, so its absence is not a capability a client declines.
  activation: {
    nonDeactivatable: true,
    reason: 'The order is the transaction this platform exists to record.',
  },
  i18n: { bundlesDir: 'i18n' },
  // Feature 047 — transactional emails owned by this module. Default subject +
  // content are registered at runtime via the EmailDefaultsRegistry.
  transactionalEmails: [
    {
      code: 'order_confirmation',
      name: 'Order confirmation',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'customer.firstName', label: 'Customer first name', sampleValue: 'Anna' },
        { key: 'order.shippingLine', label: 'Delivery method line', sampleValue: 'Courier — 15.00 PLN' },
        { key: 'order.paymentLine', label: 'Payment method line', sampleValue: 'Card (+5.00 PLN)' },
        { key: 'order.discountsText', label: 'Applied discounts', sampleValue: '  none' },
        {
          key: 'order.summaryText',
          label: 'Order summary',
          sampleValue:
            '  Subtotal: 99.99 PLN\n  Tax: 23.00 PLN\n  Delivery: 15.00 PLN\n  Total: 137.99 PLN',
        },
        { key: 'order.shippingAddressText', label: 'Shipping address', sampleValue: '  Anna Nowak\n  ul. Główna 1' },
        { key: 'order.billingAddressText', label: 'Billing address', sampleValue: '  Acme Sp. z o.o.' },
        { key: 'order.items', label: 'Order line items (list)', sampleValue: '[{"name":"Widget A","sku":"W-A","quantity":2,"price":"120,00 PLN"},{"name":"Widget B","sku":"W-B","quantity":1,"price":"990,00 PLN"}]' },
      ],
    },
    {
      code: 'order_comment',
      name: 'Order comment notification',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'comment.body', label: 'Comment body', sampleValue: 'Your order ships tomorrow.' },
      ],
    },
    {
      code: 'reorder_created',
      name: 'Reorder created',
      group: 'orders',
      variables: [
        { key: 'order.sourceBusinessId', label: 'Source order number', sampleValue: 'ORD-1000' },
      ],
    },
    {
      code: 'admin_created_order',
      name: 'Admin-created order',
      group: 'orders',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
      ],
    },
  ],
  // Feature 038 — admin search/command-palette actions.
  actions: [
    {
      id: 'open-orders',
      labelKey: 'actions.openOrders.label',
      descriptionKey: 'actions.openOrders.description',
      icon: 'ShoppingCart',
      targetRoute: '/orders',
      requiredPermission: 'orders:read',
      keywords: ['orders', 'sales', 'zamówienia', 'sprzedaż'],
      weight: 220,
    },
    {
      id: 'order-statuses',
      labelKey: 'actions.orderStatusConfig.label',
      descriptionKey: 'actions.orderStatusConfig.description',
      icon: 'Settings',
      targetRoute: '/orders/statuses',
      requiredPermission: 'orders:write',
      keywords: ['order status', 'lifecycle', 'statusy', 'cykl życia'],
      weight: 225,
    },
  ],
});
