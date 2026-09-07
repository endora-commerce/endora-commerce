import type { ReactNode } from 'react';
import { RouteTabLink } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The *Standard order* tab of the order-entry switch (feature 091, P4d).
 *
 * `admin/src/components/OrderEntryTabs.tsx` used to write this tab as one
 * element of an array it also filtered by module presence — this module's route
 * and this module's label, in a file belonging to neither this module nor
 * `quick_order`, with the label resolved out of the shared `core` bundle. The
 * route and the copy are both this module's, and they are here now.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); `order.entry.tabs` carries no props at all, so
 * there is nothing a `match` could name and a key naming a prop the zone does
 * not carry hides the contribution rather than widening it.
 * `admin/test/modules/orders/order-entry-tabs-zone.test.tsx` asserts it absent.
 *
 * The tab decides its own selected state, which is what a contributed tab has
 * to do — see `RouteTabLink`'s own note on the one thing it cannot do that
 * `RouteTabs` can.
 */
export function OrderEntryStandardTab(): ReactNode {
  const t = useTranslation('orders');
  return <RouteTabLink to="/orders/new" label={t('orderEntry.tab.standard')} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrderEntryStandardTab;
