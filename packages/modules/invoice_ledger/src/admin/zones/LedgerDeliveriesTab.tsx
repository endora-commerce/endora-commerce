import type { ReactNode } from 'react';
import { RouteTabLink } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Deliveries tab of the invoice-ledger section strip (`ledger.section.tabs`).
 *
 * The route and the label are this module's. Selected state is the tab's,
 * which is what a contributed `RouteTabLink` has to do.
 */
export function LedgerDeliveriesTab(): ReactNode {
  const t = useTranslation('invoice_ledger');
  return <RouteTabLink to="/invoice-ledger/deliveries" label={t('tabs.deliveries')} />;
}

export default LedgerDeliveriesTab;
