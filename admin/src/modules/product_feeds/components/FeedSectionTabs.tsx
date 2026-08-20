import type { ReactNode } from 'react';
import { RouteTabs } from '@/components/ui/route-tabs';
import { useTranslation } from '@/i18n/useTranslation';
import { useModulePresence } from '@/lib/module-presence';

/**
 * The feeds/templates switch, shared by both list pages so the strip cannot
 * drift between them.
 *
 * Templates used to be a second sidebar row. They are not a separate
 * destination — they are the other half of the same job (a feed publishes a
 * catalogue; a template decides which fields it carries), so they belong
 * behind a tab on the same surface.
 *
 * Both tabs belong to `product_feeds`, so the strip goes with the module
 * (feature 073 / FR-031).
 */
export function FeedSectionTabs(): ReactNode {
  const t = useTranslation('product_feeds');
  const { isPresent } = useModulePresence();
  if (!isPresent('product_feeds')) return null;
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: '/product-feeds', label: t('page.tabs.feeds') },
        { to: '/product-feeds/templates', label: t('page.tabs.templates') },
      ]}
    />
  );
}
