import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import {
  INVOICE_LEDGER_DELIVERY_STATUSES,
  type InvoiceLedgerDeliveryListItem,
  type InvoiceLedgerDeliveryStatus,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, EmptyState, Select } from '@endora-commerce/admin-kit/ui';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  useCursorPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { invoiceLedgerAdminClient } from '../api/ledger-client.js';

const RETRYABLE: readonly InvoiceLedgerDeliveryStatus[] = ['failed', 'dead'];

/** `GET …/invoice-ledger/deliveries` takes `limit` up to 200 (`listQuerySchema`). */
const MAX_PAGE_SIZE = 200;

/**
 * The deliveries of closed invoices to the ledger adapters, newest first.
 *
 * The kit's `ListPage` since issue #1749. The endpoint pages by cursor and
 * answers no total, so the list is `useCursorPagination`'s pager under the
 * table — the same footer as the invoices list — in place of the *Load more*
 * button that grew one list without end. With no total there is no result
 * count either — the footer says which rows are on screen. *Retry* stays a row's outline button:
 * it is the row's one action, offered only on a failed or dead delivery.
 */
export function LedgerDeliveriesPage(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('invoice_ledger');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('invoice_ledger:write');
  const pager = useCursorPagination({ scope: 'invoice-ledger-deliveries', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncPage } = pager;
  const { cursor, limit } = pager.query;
  const [items, setItems] = useState<InvoiceLedgerDeliveryListItem[]>([]);
  const [status, setStatus] = useState<InvoiceLedgerDeliveryStatus | ''>('');
  // Where Clear filters hands focus back to once the status filter is reset.
  const statusRef = useRef<HTMLSelectElement>(null);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped.
    let alive = true;
    setLoad({ kind: 'loading' });
    invoiceLedgerAdminClient
      .listDeliveries({ limit, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) })
      .then((res) => {
        if (!alive) return;
        setItems(res.data);
        syncPage(res.pagination, res.data.length);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', message: err instanceof ApiError ? err.message : t('error.loadDeliveries') });
      });
    return () => {
      alive = false;
    };
  }, [status, cursor, limit, reloadKey, syncPage, t]);

  const reload = useCallback((): void => setReloadKey((key) => key + 1), []);

  const changeStatus = (next: InvoiceLedgerDeliveryStatus | ''): void => {
    setStatus(next);
    resetPage();
  };

  const retry = async (id: string): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await invoiceLedgerAdminClient.retryDelivery(id);
      resetPage();
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('error.retry'));
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
      render: (row) => formatDateTime(row.updatedAt, language),
    },
  ];

  return (
    <ListPage
      title={t('deliveries.page.title')}
      description={t('deliveries.page.subtitle')}
      tabs={<RouteTabsZone name="ledger.section.tabs" props={{}} className="mb-4" />}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={t('deliveries.toolbar.label')}
          filters={
            <Select
              ref={statusRef}
              id="ledger-delivery-status"
              aria-label={t('deliveries.filter.status.label')}
              className="w-auto"
              value={status}
              onChange={(e) => changeStatus(e.target.value as InvoiceLedgerDeliveryStatus | '')}
            >
              <option value="">{t('deliveries.filter.status.all')}</option>
              {INVOICE_LEDGER_DELIVERY_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`deliveries.status.${value}`)}
                </option>
              ))}
            </Select>
          }
        />
      }
      notice={
        actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null
      }
      load={load}
      onRetry={reload}
      pagination={pager.footer(items.length)}
    >
      <ResponsiveTable
        columns={columns}
        data={items}
        keyExtractor={(row) => row.id}
        emptyState={
          // Issue #1448 (DS-15): a status that matches nothing is "no results",
          // with Clear filters; no status chosen and nothing listed is "none yet".
          status ? (
            <EmptyState
              variant="no-results"
              title={t('deliveries.emptyFiltered')}
              onClearFilters={(): void => changeStatus('')}
              focusAfterClear={statusRef}
            />
          ) : (
            <EmptyState icon={<Send size={20} />} title={t('deliveries.empty')} description={t('deliveries.emptyBody')} />
          )
        }
        renderActions={(row) =>
          canWrite && RETRYABLE.includes(row.status) ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retry(row.id)}>
              {t('deliveries.retry')}
            </Button>
          ) : null
        }
      />
    </ListPage>
  );
}

export default LedgerDeliveriesPage;
