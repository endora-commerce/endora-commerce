import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  INVOICE_LEDGER_DELIVERY_STATUSES,
  type InvoiceLedgerDeliveryListItem,
  type InvoiceLedgerDeliveryStatus,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { ResponsiveTable, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { invoiceLedgerAdminClient } from '../api/ledger-client.js';
import { mergeLedgerDeliveryPages } from './merge-delivery-pages.js';

const RETRYABLE: readonly InvoiceLedgerDeliveryStatus[] = ['failed', 'dead'];

export function LedgerDeliveriesPage(): ReactNode {
  const t = useTranslation('invoice_ledger');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('invoice_ledger:write');
  const [items, setItems] = useState<InvoiceLedgerDeliveryListItem[]>([]);
  const [status, setStatus] = useState<InvoiceLedgerDeliveryStatus | ''>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoiceLedgerAdminClient.listDeliveries({
        limit: 50,
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      });
      setItems((prev) => (cursor ? mergeLedgerDeliveryPages(prev, res.data) : res.data));
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.loadDeliveries'));
    } finally {
      setLoading(false);
    }
  }, [status, cursor, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const retry = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await invoiceLedgerAdminClient.retryDelivery(id);
      setCursor(undefined);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.retry'));
    } finally {
      setBusy(false);
    }
  };

  const columns: ResponsiveColumn<InvoiceLedgerDeliveryListItem>[] = [
    {
      id: 'invoice',
      header: t('deliveries.column.invoice'),
      primary: true,
      render: (row) => row.invoiceNumber ?? row.invoiceId,
    },
    {
      id: 'adapter',
      header: t('deliveries.column.adapter'),
      render: (row) => row.adapterId,
    },
    {
      id: 'status',
      header: t('deliveries.column.status'),
      render: (row) => t(`deliveries.status.${row.status}`),
    },
    {
      id: 'error',
      header: t('deliveries.column.lastError'),
      render: (row) => row.lastError ?? t('deliveries.noError'),
    },
    {
      id: 'environment',
      header: t('deliveries.column.environment'),
      hideOnMobile: true,
      render: (row) => row.environment,
    },
    {
      id: 'updated',
      header: t('deliveries.column.updated'),
      hideOnMobile: true,
      render: (row) => formatDateTime(row.updatedAt),
    },
  ];

  return (
    <div>
      <PageHeader title={t('deliveries.page.title')} description={t('deliveries.page.subtitle')} />
      <RouteTabsZone name="ledger.section.tabs" props={{}} className="mb-4" />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mb-4 max-w-xs">
        <Select
          id="ledger-delivery-status"
          value={status}
          onChange={(e) => {
            setCursor(undefined);
            setStatus(e.target.value as InvoiceLedgerDeliveryStatus | '');
          }}
        >
          <option value="">{t('deliveries.filter.status.all')}</option>
          {INVOICE_LEDGER_DELIVERY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`deliveries.status.${value}`)}
            </option>
          ))}
        </Select>
      </div>
      {loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('deliveries.loading')}</p>
      ) : (
        <ResponsiveTable
          columns={columns}
          data={items}
          keyExtractor={(row) => row.id}
          emptyState={<p className="text-sm text-muted-foreground">{t('deliveries.empty')}</p>}
          renderActions={(row) =>
            canWrite && RETRYABLE.includes(row.status) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void retry(row.id)}
              >
                {t('deliveries.retry')}
              </Button>
            ) : null
          }
        />
      )}
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => setCursor(items[items.length - 1]?.id)}
        >
          {t('deliveries.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

export default LedgerDeliveriesPage;
