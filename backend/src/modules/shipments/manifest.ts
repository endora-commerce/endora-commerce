import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

export const shipmentsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'shipments',
  groups: [{ code: 'shipments', name: 'Shipments' }],
  settings: [
    {
      code: 'shipments.enabled',
      name: 'Shipments enabled',
      description:
        'Switches the shipment lifecycle on or off: creating a shipment for an order, the carrier receive_shipment ingress, the retry path and the per-order shipment history. Nothing is dropped — every shipment, its status transitions and its carrier references stay in the database, and an order mid-fulfilment resumes exactly where it was.',
      groupCode: 'shipments',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/**
 * Shipments module (feature 035) — the Shipment entity and its
 * generate/receive/retry lifecycle. The delivery-side twin of `payments`.
 *
 * The shipping-method *catalog* (adapter registry, reconciler, eligibility)
 * lives in the sibling `delivery_methods` module; this module owns the
 * first-class Shipment record and the `receive_shipment` ingress. Since feature
 * 072 (T124) it registers its own services and routes through `backend.ts`;
 * before that `orders/plugin.ts` constructed and mounted them, which is why
 * switching this module off used to do nothing. No install/uninstall hook —
 * schema is owned by migration 052.
 */
export const manifest = defineModuleManifest({
  id: 'shipments',
  name: 'Shipments',
  description: 'Shipment record and the order_created / shipment_created / receive_shipment lifecycle.',
  version: '1.0.0',
  // Feature 075 Phase C — `customer_accounts` joins the three that were already
  // here: the shipment-created e-mail resolves its recipient over
  // `customerAccountReadPort` instead of reading the `CustomerAccount` entity.
  dependencies: [
    'customer_accounts',
    'delivery_methods',
    'orders',
    'transactional_emails',
  ],
  // Feature 073 (Constitution XVII) — the operator's activation control. It
  // only became real in T124: until this module registered its own routes there
  // was no seam for a gate to sit on.
  activation: { settingCode: 'shipments.enabled', default: true },
  settings: shipmentsSettingsManifest,
  // Feature 047 — admin-editable transactional email owned by this module.
  transactionalEmails: [
    {
      code: 'shipment_created',
      name: 'Shipment created',
      group: 'shipments',
      variables: [{ key: 'order.businessId', label: 'Order number', sampleValue: 'ORD-1042' }],
    },
  ],
});
