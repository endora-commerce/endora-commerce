import type { ReactNode } from 'react';
import { RouteTabs } from './ui/route-tabs.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { useModulePresence } from '../lib/module-presence/index.js';

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
 *
 * That split is exactly why this strip is presence-filtered per tab rather than
 * as a whole (feature 073 / FR-031): switching `quick_order` off must remove one
 * tab, not the strip, because the other way in still exists.
 */
export function OrderEntryTabs(): ReactNode {
  const t = useTranslation('core');
  const { isPresent } = useModulePresence();
  const tabs = [
    { to: '/orders/new', label: t('orderEntry.tab.standard'), module: 'orders' },
    { to: '/orders/quick-order', label: t('orderEntry.tab.quick'), module: 'quick_order' },
  ].filter((tab) => isPresent(tab.module));
  // One remaining tab is not a choice, so there is nothing to switch between.
  if (tabs.length < 2) return null;
  return (
    <RouteTabs
      className="mb-4"
      tabs={tabs.map(({ to, label }) => ({ to, label }))}
    />
  );
}
