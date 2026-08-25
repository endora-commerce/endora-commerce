import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const paymentsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'payments',
  groups: [{ code: 'payments', name: 'Payments' }],
  settings: [
    {
      code: 'payments.enabled',
      name: 'Payments enabled',
      // The description used to describe the settlement half only, and stopped
      // exactly where an operator most needs it: it never said that this module
      // contributes every built-in payment adapter, so switching it off empties
      // checkout's payment list and the shop stops taking orders. An operator
      // cannot learn a switch's consequence from anywhere but the switch.
      description:
        'Switches the whole payment capability on or off. While it is off the platform offers no payment method at all: this module contributes the four built-in payment adapters (bank transfer, in-person pickup, credit limit and the gateway placeholder), so every payment method configured against one of them disappears from checkout and an order naming it is refused. Unless another installed integration supplies a payment method of its own, that means the shop stops taking orders. The settlement lifecycle stops with it: the receive_payment ingress, both retry paths (the operator\'s and the buyer\'s), the per-order payment history and the payment-status e-mail. Nothing is dropped — every payment, its status transitions and its provider references stay in the database, an order mid-settlement keeps its record, and every payment method, permission and setting comes back exactly as configured when you switch it on again. It is not an uninstall, and it is not the way to switch off a single payment provider: a gateway integration depends on this module, so the platform refuses to switch this off while such an integration is still on — switch that integration off instead.',
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
  // What renders beside the activation control on `/platform/modules` is this
  // string, not the activation Setting's — the Setting's description is served
  // in the settings DTO and rendered on no screen today. So the consequence has
  // to be legible here too, in one sentence: 'Payment driver abstraction and PSP
  // integrations' told an operator nothing about what flipping the switch does.
  description:
    'The platform payment capability: the built-in payment adapters (bank transfer, in-person pickup, credit limit, gateway), the payment record every order carries, and the settlement lifecycle that PSP integrations plug into. Switched off, checkout offers no payment method and the shop takes no orders.',
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
