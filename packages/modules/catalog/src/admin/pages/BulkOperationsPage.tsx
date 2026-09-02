import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BULK_OPERATION_TYPES, type BulkOperation, type BulkOperationStatus } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Bulk actions ("Akcje masowe") — feature: queued product bulk-edit.
 *
 * Lists completed, running, and pending background bulk operations with a
 * processing summary (processed / succeeded / skipped / failed). Polls
 * while anything is still in flight so progress updates live; stops
 * polling once everything has settled to avoid needless load.
 */

const STATUS_FILTERS: Array<'all' | BulkOperationStatus> = [
  'all',
  'pending',
  'running',
  'completed',
  'failed',
];

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

const KNOWN_OPERATION_TYPES = new Set<string>([
  BULK_OPERATION_TYPES.PRODUCT_BULK_UPDATE,
  BULK_OPERATION_TYPES.SEARCH_REINDEX,
]);

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
  const t = useTranslation('catalog');
  const navigate = useNavigate();
  const [rows, setRows] = useState<BulkOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | BulkOperationStatus>('all');
  const filterRef = useRef(statusFilter);
  filterRef.current = statusFilter;

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const filter = filterRef.current;
      const qs = filter === 'all' ? '?limit=100' : `?limit=100&status=${filter}`;
      const res = await apiClient.get<{ data: BulkOperation[] }>(
        `/api/v1/admin/catalog/bulk-operations${qs}`,
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('bulkOperations.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh, statusFilter]);

  // Poll while anything is still pending / running.
  const hasActive = rows.some((r) => ACTIVE_STATUSES.includes(r.status));
  useEffect(() => {
    if (!hasActive) return undefined;
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return (): void => window.clearInterval(id);
  }, [hasActive, refresh]);

  return (
    <>
      <PageHeader title={t('bulkOperations.title')} description={t('bulkOperations.subtitle')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('bulkOperations.listTitle')}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`b2b-btn b2b-btn--sm ${statusFilter === s ? 'b2b-btn--primary' : 'b2b-btn--ghost'}`}
                onClick={(): void => setStatusFilter(s)}
              >
                {t(`bulkOperations.filter.${s}`)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('bulkOperations.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('bulkOperations.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bulkOperations.column.created')}</TableHead>
                  <TableHead>{t('bulkOperations.column.type')}</TableHead>
                  <TableHead>{t('bulkOperations.column.status')}</TableHead>
                  <TableHead>{t('bulkOperations.column.progress')}</TableHead>
                  <TableHead className="text-right">{t('bulkOperations.column.succeeded')}</TableHead>
                  <TableHead className="text-right">{t('bulkOperations.column.skipped')}</TableHead>
                  <TableHead className="text-right">{t('bulkOperations.column.failed')}</TableHead>
                  <TableHead>{t('bulkOperations.column.fields')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((op) => {
                  const pct =
                    op.total > 0 ? Math.round((op.processed / op.total) * 100) : 0;
                  return (
                    <TableRow
                      key={op.id}
                      onClick={(): void => {
                        void navigate(`/catalog/bulk-operations/${op.id}`);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(op.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{operationTypeLabel(op, t)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[op.status]}>
                          {t(`bulkOperations.status.${op.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="font-mono">
                          {op.processed}/{op.total}
                        </span>{' '}
                        <span className="text-muted-foreground">({pct}%)</span>
                      </TableCell>
                      <TableCell className="text-right text-sm">{op.succeeded}</TableCell>
                      <TableCell className="text-right text-sm">{op.skipped}</TableCell>
                      <TableCell className="text-right text-sm">{op.failed}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {op.touchedFields.length > 0
                          ? op.touchedFields.join(', ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default BulkOperationsPage;
