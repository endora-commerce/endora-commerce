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
