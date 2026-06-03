import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BulkOperation, BulkOperationStatus } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { formatDateTime } from '@/lib/format';

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

export function BulkOperationsPage(): ReactNode {
  const t = useTranslation('catalog');
  const [rows, setRows] = useState<BulkOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | BulkOperationStatus>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
                  const isOpen = expanded.has(op.id);
                  const expandable = op.error !== null || (op.results?.length ?? 0) > 0;
                  return (
                    <Fragment key={op.id}>
                      <TableRow
                        onClick={expandable ? (): void => toggle(op.id) : undefined}
                        style={expandable ? { cursor: 'pointer' } : undefined}
                      >
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDateTime(op.createdAt)}
                        </TableCell>
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
                      {isOpen ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            {op.error ? (
                              <Alert variant="destructive">
                                <AlertDescription>{op.error}</AlertDescription>
                              </Alert>
                            ) : null}
                            {op.results && op.results.length > 0 ? (
                              <div className="mt-2 max-h-64 overflow-auto rounded-md border">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('bulkOperations.detail.product')}</TableHead>
                                      <TableHead>{t('bulkOperations.detail.outcome')}</TableHead>
                                      <TableHead>{t('bulkOperations.detail.reason')}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {op.results
                                      .filter((r) => r.status !== 'succeeded')
                                      .slice(0, 200)
                                      .map((r) => (
                                        <TableRow key={r.productId}>
                                          <TableCell className="font-mono text-xs">
                                            {r.productId}
                                          </TableCell>
                                          <TableCell className="text-sm">{r.status}</TableCell>
                                          <TableCell className="text-sm text-muted-foreground">
                                            {r.reason ?? r.details?.message ?? '—'}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
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
