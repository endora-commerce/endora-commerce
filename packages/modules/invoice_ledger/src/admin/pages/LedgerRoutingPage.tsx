import { type ReactNode } from 'react';
import { PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

export function LedgerRoutingPage(): ReactNode {
  const t = useTranslation('invoice_ledger');
  return (
    <div>
      <PageHeader title={t('routing.page.title')} description={t('routing.page.subtitle')} />
    </div>
  );
}

export default LedgerRoutingPage;
