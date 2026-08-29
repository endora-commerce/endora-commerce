import type { ReactNode } from 'react';
import { RouteTabs } from './ui/route-tabs.js';
import { useTranslation } from '../i18n/useTranslation.js';
import { useModulePresence } from '../lib/module-presence/index.js';

/**
 * The switch between invoices and the templates they are rendered with.
 *
 * A template is not a destination an operator sets out for; it is the thing
 * they go and adjust when an invoice came out wrong. Giving it a sidebar row of
 * its own put a rarely-used setting at the same level as the documents
 * themselves, and pushed everything below it one line further down.
 *
 * Both tabs belong to `invoices`, so the whole strip is the module's
 * contribution and goes with it (feature 073 / FR-031).
 */
export function InvoiceSectionTabs(): ReactNode {
  const t = useTranslation('core');
  const { isPresent } = useModulePresence();
  if (!isPresent('invoices')) return null;
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: '/invoices', label: t('invoiceTabs.invoices') },
        { to: '/invoices/templates', label: t('invoiceTabs.templates') },
      ]}
    />
  );
}
