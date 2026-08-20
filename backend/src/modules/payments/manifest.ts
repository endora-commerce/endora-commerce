import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

export const paymentsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'payments',
  groups: [{ code: 'payments', name: 'Payments' }],
  settings: [
    {
      code: 'payments.enabled',
      name: 'Payments enabled',
      description:
        'Switches the payment lifecycle on or off: the receive_payment ingress, both retry paths (the operator\'s and the buyer\'s), the per-order payment history and the payment-status e-mail. Nothing is dropped — every payment, its status transitions and its provider references stay in the database, and an order mid-settlement keeps its record.',
      groupCode: 'payments',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/**
 * Payments module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'payments',
  name: 'Payments',
  description:
    'Payment driver abstraction and PSP integrations.',
  version: '1.0.0',
  // Feature 075 Phase C — `customer_accounts` joins the five that were already
  // here: the payment-status e-mail resolves its recipient over
  // `customerAccountReadPort` instead of reading the `CustomerAccount` entity.
  // `orders` was already declared, which D-78 point 2 requires of the one
  // co-transactional seam kept in `receive-payment-handler.ts` — the FK
  // `payments_order_fk` had required it anyway.
  // `organizations` joins for the buyer's retry route (issue #264): a suspended
  // or blocked Organization may not pay an order any more than it may place
  // one, and the guard is `organizationReadPort.assertCanTransact`. It is
  // already transitively before this module through `orders`, so the entry
  // changes no install or migration order — it states the edge.
  dependencies: [
    'auth',
    'customer_accounts',
    'delivery_methods',
    'orders',
    'organizations',
    'payment_methods',
    'transactional_emails',
  ],
  // Feature 073 (Constitution XVII) — the operator's activation control. It only
  // became real in T126: until this module registered its own routes there was
  // no seam for a gate to sit on.
  activation: { settingCode: 'payments.enabled', default: true },
  settings: paymentsSettingsManifest,
  // Feature 047 — admin-editable transactional email owned by this module.
  transactionalEmails: [
    {
      code: 'payment_status_changed',
      name: 'Payment status changed',
      group: 'payments',
      variables: [
        { key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' },
        { key: 'payment.statusLabel', label: 'Payment status', sampleValue: 'Paid' },
        { key: 'payment.failureReason', label: 'Failure reason', sampleValue: 'Card declined' },
      ],
    },
  ],
});
