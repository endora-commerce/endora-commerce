import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useModulePresence } from '@endora-commerce/admin-kit/lib';

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
 *
 * **It lives here since feature 091's P4c**, and until then it did not. The
 * `admin-surface` ledger recorded it as a host component that *"renders on two
 * modules' pages and belongs to neither"*, retiring with P4 as a two-contributor
 * zone — the sentence `OrderEntryTabs` earns and this one never did. Measured:
 * both tabs are `/invoices*`, the presence gate asks about `invoices`, and both
 * consumers are `invoices`' own screens. There was nothing here for a mechanism
 * to do; it was a file in the wrong directory.
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
