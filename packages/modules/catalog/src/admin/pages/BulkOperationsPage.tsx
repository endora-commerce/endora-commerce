import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import {
  BULK_OPERATION_TYPES,
  type BulkOperation,
  type BulkOperationStatus,
  type BulkOperationsListResponse,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Badge, Button, EmptyState, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  useListPagination,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * Bulk actions ("Akcje masowe") — feature: queued product bulk-edit.
 *
 * Lists completed, running, and pending background bulk operations with a
 * processing summary (processed / succeeded / skipped / failed). Polls
 * while anything is still in flight so progress updates live; stops
 * polling once everything has settled to avoid needless load.
 *
 * The kit's `ListPage` (issue #1439, DS-05; UX audit slice S14): the status
 * filter is a labelled select in the `ListToolbar`, the list is server-paged
 * by `limit` / `offset` (it showed the first 100 and nothing past them), the
 * operation's name is the link to it (the row opened on a mouse click only),
 * and "nothing yet" differs from "nothing with this status" (DS-15).
 */

type StatusFilter = 'all' | BulkOperationStatus;

const STATUS_FILTERS: BulkOperationStatus[] = ['pending', 'running', 'completed', 'failed'];

const ACTIVE_STATUSES: BulkOperationStatus[] = ['pending', 'running'];

const STATUS_BADGE: Record<
  BulkOperationStatus,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'
> = {
  pending: 'warning',
  running: 'secondary',
  completed: 'success',
  failed: 'destructive',
};

const POLL_INTERVAL_MS = 4000;

/** `GET /api/v1/admin/catalog/bulk-operations` serves at most 100 rows a page. */
const MAX_PAGE_SIZE = 100;

const KNOWN_OPERATION_TYPES = new Set<string>([
  BULK_OPERATION_TYPES.PRODUCT_BULK_UPDATE,
  BULK_OPERATION_TYPES.SEARCH_REINDEX,
]);

/**
 * The request for one page of the list: the status when one is chosen, and the
 * page as `limit` / `offset`, which is how the endpoint pages. `page` is
 * one-based, as `useListPagination().query` gives it.
 */
export function bulkOperationsListPath(filters: { status: StatusFilter; page: number; pageSize: number }): string {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  params.set('limit', String(filters.pageSize));
  params.set('offset', String((filters.page - 1) * filters.pageSize));
  return `/api/v1/admin/catalog/bulk-operations?${params.toString()}`;
}

/**
 * Friendly label for a bulk operation's `type`. Known kinds resolve through
 * i18n; an unknown kind (e.g. one shipped by a future module) falls back to
 * the raw type string rather than an i18n placeholder.
 */
function operationTypeLabel(
  op: BulkOperation,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return KNOWN_OPERATION_TYPES.has(op.type)
    ? t(`bulkOperations.type.${op.type}`)
    : op.type;
}

export function BulkOperationsPage(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('catalog');
  const pager = useListPagination({ scope: 'catalog-bulk-operations', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const [rows, setRows] = useState<BulkOperation[]>([]);
  const [total, setTotal] = useState(0);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [reloadKey, setReloadKey] = useState(0);
  const path = bulkOperationsListPath({ status: statusFilter, ...pager.query });

  const apply = useCallback(
    (res: BulkOperationsListResponse): void => {
      setRows(res.data);
      setTotal(res.pagination.total);
      syncTotal(res.pagination.total);
    },
    [syncTotal],
  );

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped, so a
    // slow page cannot overwrite the one the operator is looking at now.
    let alive = true;
    setLoad({ kind: 'loading' });
    apiClient
      .get<BulkOperationsListResponse>(path)
      .then((res) => {
        if (!alive) return;
        apply(res);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({
          kind: 'error',
          message: err instanceof ApiError ? err.envelope.error.message : t('bulkOperations.error.load'),
        });
      });
    return (): void => {
      alive = false;
    };
  }, [path, reloadKey, apply, t]);

  // Poll the page on screen while anything on it is still pending / running.
  // A poll refreshes the rows in place — no skeleton every four seconds — and
  // a failed poll leaves them as they were until the next one.
  const hasActive = load.kind === 'ready' && rows.some((r) => ACTIVE_STATUSES.includes(r.status));
  useEffect(() => {
    if (!hasActive) return undefined;
    let alive = true;
    const id = window.setInterval(() => {
      apiClient
        .get<BulkOperationsListResponse>(path)
        .then((res) => {
          if (alive) apply(res);
        })
        .catch((): void => undefined);
    }, POLL_INTERVAL_MS);
    return (): void => {
      alive = false;
      window.clearInterval(id);
    };
  }, [hasActive, path, apply]);

  const filtered = statusFilter !== 'all';
  const clearFilters = useCallback((): void => {
    setStatusFilter('all');
    resetPage();
  }, [resetPage]);

  return (
    <ListPage
      title={t('bulkOperations.title')}
      load={load}
      onRetry={(): void => setReloadKey((key) => key + 1)}
      count={t('bulkOperations.count', { count: total })}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={t('bulkOperations.toolbar.label')}
          filters={
            <Select
              aria-label={t('bulkOperations.column.status')}
              className="w-auto"
              value={statusFilter}
              onChange={(e): void => {
                setStatusFilter(e.target.value as StatusFilter);
                resetPage();
              }}
            >
              <option value="all">{t('bulkOperations.filter.allStatuses')}</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {t(`bulkOperations.filter.${s}`)}
                </option>
              ))}
            </Select>
          }
          filtersActive={filtered}
          onClearFilters={clearFilters}
        />
      }
      pagination={pager.footer(total)}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(op) => op.id}
        emptyState={
          filtered ? (
            <EmptyState variant="no-results" title={t('bulkOperations.emptyFiltered')} onClearFilters={clearFilters} />
          ) : (
            <EmptyState
              icon={<Layers size={20} />}
              title={t('bulkOperations.emptyTitle')}
              description={t('bulkOperations.emptyHint')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/catalog/products">{t('bulkOperations.emptyAction')}</Link>
                </Button>
              }
            />
          )
        }
        columns={[
          {
            // The operation is the way into its page — a link a keyboard reaches.
            id: 'type',
            header: t('bulkOperations.column.type'),
            primary: true,
            render: (op) => (
              <Link to={`/catalog/bulk-operations/${op.id}`} className="font-medium text-primary hover:underline">
                {operationTypeLabel(op, t)}
              </Link>
            ),
            meta: (op) => formatDateTime(op.createdAt, language),
          },
          {
            id: 'created',
            header: t('bulkOperations.column.created'),
            hideOnMobile: true,
            className: 'whitespace-nowrap',
            render: (op) => formatDateTime(op.createdAt, language),
          },
          {
            id: 'status',
            header: t('bulkOperations.column.status'),
            render: (op) => (
              <Badge variant={STATUS_BADGE[op.status]}>{t(`bulkOperations.status.${op.status}`)}</Badge>
            ),
          },
          {
            id: 'progress',
            header: t('bulkOperations.column.progress'),
            render: (op) => {
              const pct = op.total > 0 ? Math.round((op.processed / op.total) * 100) : 0;
              return (
                <>
                  <span className="font-mono">
                    {op.processed}/{op.total}
                  </span>{' '}
                  <span className="text-muted-foreground">({pct}%)</span>
                </>
              );
            },
          },
          {
            id: 'succeeded',
            header: t('bulkOperations.column.succeeded'),
            hideOnMobile: true,
            className: 'text-right tabular-nums',
            render: (op) => op.succeeded,
          },
          {
            id: 'skipped',
            header: t('bulkOperations.column.skipped'),
            hideOnMobile: true,
            className: 'text-right tabular-nums',
            render: (op) => op.skipped,
          },
          {
            id: 'failed',
            header: t('bulkOperations.column.failed'),
            hideOnMobile: true,
            className: 'text-right tabular-nums',
            render: (op) => op.failed,
          },
          {
            id: 'fields',
            header: t('bulkOperations.column.fields'),
            hideOnMobile: true,
            render: (op) => (
              <span className="text-muted-foreground">
                {op.touchedFields.length > 0 ? op.touchedFields.join(', ') : '—'}
              </span>
            ),
          },
        ]}
      />
    </ListPage>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default BulkOperationsPage;
