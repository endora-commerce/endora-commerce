import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * A back-in-stock subscription's status (issue #1434). The keys are `core`'s,
 * the bundle the availability notifications screen reads, and are the ones its
 * status filter already used.
 */
export const availabilityStatusLabels = defineEnumLabels({
  queued: 'inventory.availability.status.queued',
  notified: 'inventory.availability.status.notified',
  cancelled: 'inventory.availability.status.cancelled',
});

/**
 * A product's stock display band on the inventory list (issue #1460). The cell
 * reads `row.displayBand`, which the raw-enum lint rule does not recognise by
 * name, so `admin/test/modules/inventory/InventoryPage.list.test.tsx` is what
 * holds it translated.
 */
export const stockDisplayBandLabels = defineEnumLabels({
  high: 'inventory.band.high',
  medium: 'inventory.band.medium',
  low: 'inventory.band.low',
  out_of_stock: 'inventory.band.out_of_stock',
  available: 'inventory.band.available',
});

/**
 * The badge classes for a band. `low` takes the danger tone rather than sharing
 * `medium`'s warn, so the two no longer read as one; `out_of_stock` adds the
 * dot so it stays distinct from `low` without relying on colour. The label is
 * still the carrier of meaning (WCAG 1.4.1) — the tone only reinforces it.
 */
export function stockDisplayBandTone(band: string): string {
  switch (band) {
    case 'high':
      return 'b2b-badge b2b-badge--success';
    case 'medium':
      return 'b2b-badge b2b-badge--warn';
    case 'low':
      return 'b2b-badge b2b-badge--danger';
    case 'out_of_stock':
      return 'b2b-badge b2b-badge--danger b2b-badge--dot';
    default:
      // The neutral pill: `b2b-badge` unmodified (a `--muted` modifier was never defined).
      return 'b2b-badge';
  }
}

/** Where a row's "Edit stock" lands: the product editor's Inventory tab, not Details. */
export function productInventoryHref(productId: string): string {
  return `/catalog/products/${encodeURIComponent(productId)}?tab=inventory`;
}

/**
 * Why the stock import skipped a row (issue #1492). The wizard's error table
 * printed the raw reason (`product_not_found`); the keys are `core`'s.
 */
export const importErrorReasonLabels = defineEnumLabels({
  product_not_found: 'inventory.import.reason.product_not_found',
  invalid_quantity: 'inventory.import.reason.invalid_quantity',
  malformed_row: 'inventory.import.reason.malformed_row',
});
