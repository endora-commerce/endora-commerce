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
  dependencies: [
    'addresses',
    'api_keys',
    'carts',
    'credit_limits',
    'organizations',
    'promotions',
    'settings',
  ],
  settings,
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
