import { type ReactNode } from 'react';
import { PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export function LedgerDeliveriesPage(): ReactNode {
  const t = useTranslation('invoice_ledger');
  return (
    <div>
      <PageHeader title={t('deliveries.page.title')} description={t('deliveries.page.subtitle')} />
    </div>
  );
}

export default LedgerDeliveriesPage;
