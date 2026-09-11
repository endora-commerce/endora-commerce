import type { ReactNode } from 'react';
import { RouteTabLink } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Routing tab of the invoice-ledger section strip (`ledger.section.tabs`).
 *
 * Sibling of {@link LedgerDeliveriesTab}: same module, own route, own label.
 * Two contributions from one owner so a later vendor adapter joins the strip
 * without the host listing it.
 */
export function LedgerRoutingTab(): ReactNode {
  const t = useTranslation('invoice_ledger');
  return <RouteTabLink to="/invoice-ledger/routing" label={t('tabs.routing')} />;
}

export default LedgerRoutingTab;
