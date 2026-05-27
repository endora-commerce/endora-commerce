import { defineModuleManifest } from '@b2b/contracts';

/**
 * Shipments module (feature 035) — the Shipment entity and its
 * generate/receive/retry lifecycle. The delivery-side twin of `payments`.
 *
 * The shipping-method *catalog* (adapter registry, reconciler, eligibility)
 * lives in the sibling `delivery_methods` module; this module owns the
 * first-class Shipment record and the `receive_shipment` ingress. Routes are
 * wired through the commerce composition root (`orders/plugin.ts`). No
 * install/uninstall hook — schema is owned by migration 052.
 */
export const manifest = defineModuleManifest({
  id: 'shipments',
  name: 'Shipments',
  description: 'Shipment record and the order_created / shipment_created / receive_shipment lifecycle.',
  version: '1.0.0',
  dependencies: [],
});
