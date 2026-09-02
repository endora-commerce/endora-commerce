import type { ReactNode } from 'react';
import { RouteTabLink } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The *Quick order* tab of the order-entry switch (feature 091, P4d).
 *
 * The twin of `orders`' `OrderEntryStandardTab`, and the other half of what
 * `admin/src/components/OrderEntryTabs.tsx` used to do out of a file belonging
 * to neither module: this module's route, this module's label, resolved out of
 * this module's own bundle rather than the shared `core` one.
 *
 * **No `match`, on `OrderEntryStandardTab`'s terms and for its reason**:
 * `order.entry.tabs` carries no props, so there is nothing to narrow.
 * `admin/test/modules/orders/order-entry-tabs-zone.test.tsx` asserts it absent
 * on both contributions.
 */
export function OrderEntryQuickTab(): ReactNode {
  const t = useTranslation('quick_order');
  return <RouteTabLink to="/orders/quick-order" label={t('orderEntry.tab.quick')} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrderEntryQuickTab;
