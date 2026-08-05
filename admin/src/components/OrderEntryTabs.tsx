import type { ReactNode } from 'react';
import { RouteTabs } from '@/components/ui/route-tabs';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The switch between the two ways of entering an order.
 *
 * They were two sidebar rows, which reads as two destinations. They are not:
 * both create one order for one customer, and the only difference is how the
 * lines get in — picked one at a time, or pasted as a list of SKUs. An operator
 * who has already decided to create an order should be choosing between them on
 * the page, not in the navigation.
 *
 * Lives outside both modules, and is scoped to the `core` bundle, because it
 * renders on a page owned by `orders` and on one owned by `quick_order`.
 * Putting it in either would make the other import that module's internals.
 */
export function OrderEntryTabs(): ReactNode {
  const t = useTranslation('core');
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: '/orders/new', label: t('orderEntry.tab.standard') },
        { to: '/orders/quick-order', label: t('orderEntry.tab.quick') },
      ]}
    />
  );
}
