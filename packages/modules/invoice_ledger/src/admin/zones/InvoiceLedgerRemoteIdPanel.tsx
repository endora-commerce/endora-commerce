import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AdminZoneProps, InvoiceLedgerDeliveryListItem } from '@endora-commerce/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { invoiceLedgerAdminClient } from '../api/ledger-client.js';

export type InvoiceLedgerRemoteIdPanelProps = AdminZoneProps<'invoice.detail.after'>;

/**
 * Read-only historical vendor document id on invoice admin (US9 / FR-040).
 * Reads the ledger, never the vendor HTTP client, so the id stays after the
 * adapter is switched off.
 */
export function InvoiceLedgerRemoteIdPanel({
  invoiceId,
  kind,
}: InvoiceLedgerRemoteIdPanelProps): ReactNode {
  const t = useTranslation('invoice_ledger');
  const [row, setRow] = useState<InvoiceLedgerDeliveryListItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden'>('loading');

  const isProforma = kind === 'proforma';

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await invoiceLedgerAdminClient.listDeliveries({ invoiceId, limit: 1 });
      setRow(res.data[0] ?? null);
      setState('ready');
    } catch {
      setState('hidden');
    }
  }, [invoiceId]);

  useEffect(() => {
    if (isProforma) return;
    void reload();
  }, [isProforma, reload]);

  if (isProforma || state !== 'ready' || !row?.remoteDocumentId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('invoicePanel.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('invoicePanel.remoteDocumentId')}</span>
          <code className="text-xs">{row.remoteDocumentId}</code>
        </div>
      </CardContent>
    </Card>
  );
}

export default InvoiceLedgerRemoteIdPanel;
