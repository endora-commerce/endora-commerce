import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  BULK_OPERATION_TYPES,
  type BulkOperation,
  type BulkOperationLogEntry,
  type BulkOperationStatus,
} from '@b2b/contracts';
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
 * Bulk operation detail view — feature: bulk-operations detail.
 *
 * Reached by clicking a row on the "Bulk actions" list. Shows the full
 * processing summary, the operation's lifecycle log trail, and the per-element
 * outcome of the operation. Polls while the operation is still pending /
 * running so progress, logs, and results update live.
 */

const ACTIVE_STATUSES: BulkOperationStatus[] = ['pending', 'running'];
const POLL_INTERVAL_MS = 4000;

const STATUS_BADGE: Record<
  BulkOperationStatus,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'
> = {
  pending: 'warning',
  running: 'secondary',
  completed: 'success',
  failed: 'destructive',
};

const OUTCOME_BADGE: Record<
  'succeeded' | 'skipped' | 'failed',
  'success' | 'warning' | 'destructive'
> = {
  succeeded: 'success',
  skipped: 'warning',
  failed: 'destructive',
};

const LOG_LEVEL_CLASS: Record<BulkOperationLogEntry['level'], string> = {
  info: 'text-foreground',
  warn: 'text-amber-600 dark:text-amber-500',
  error: 'text-destructive',
};

type ElementFilter = 'all' | 'succeeded' | 'skipped' | 'failed';
const ELEMENT_FILTERS: ElementFilter[] = ['all', 'succeeded', 'skipped', 'failed'];

const KNOWN_OPERATION_TYPES = new Set<string>([
  BULK_OPERATION_TYPES.PRODUCT_BULK_UPDATE,
  BULK_OPERATION_TYPES.SEARCH_REINDEX,
]);

export function BulkOperationDetailPage(): ReactNode {
  const t = useTranslation('catalog');
  const { id = '' } = useParams<{ id: string }>();
  const [op, setOp] = useState<BulkOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ data: BulkOperation }>(
        `/api/v1/admin/catalog/bulk-operations/${id}`,
      );
      setOp(res.data);
      setNotFound(false);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('bulkOperations.error.load'));
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Poll while the operation is still in flight.
  const isActive = op ? ACTIVE_STATUSES.includes(op.status) : false;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!isActive) return undefined;
    const handle = window.setInterval(() => {
      void refreshRef.current();
    }, POLL_INTERVAL_MS);
    return (): void => window.clearInterval(handle);
  }, [isActive]);

  const typeLabel = op
    ? KNOWN_OPERATION_TYPES.has(op.type)
      ? t(`bulkOperations.type.${op.type}`)
      : op.type
    : '';

  const filteredResults = useMemo(() => {
    const results = op?.results ?? [];
    if (elementFilter === 'all') return results;
    return results.filter((r) => r.status === elementFilter);
  }, [op?.results, elementFilter]);

  const back = { label: t('bulkOperations.detail.back'), to: '/catalog/bulk-operations' };

  if (loading && !op) {
    return (
      <>
        <PageHeader title={t('bulkOperations.detail.title')} back={back} />
        <p className="text-sm text-muted-foreground">{t('bulkOperations.loading')}</p>
      </>
    );
  }

  if (notFound || !op) {
    return (
      <>
        <PageHeader title={t('bulkOperations.detail.title')} back={back} />
        <Alert variant="destructive">
          <AlertDescription>{t('bulkOperations.detail.notFound')}</AlertDescription>
        </Alert>
      </>
    );
  }

  const pct = op.total > 0 ? Math.round((op.processed / op.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            {typeLabel}
            <Badge variant={STATUS_BADGE[op.status]}>{t(`bulkOperations.status.${op.status}`)}</Badge>
          </span>
        }
        description={t('bulkOperations.detail.title')}
        back={back}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {op.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{op.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('bulkOperations.detail.summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('bulkOperations.detail.field.id')}>
              <span className="font-mono text-xs">{op.id}</span>
            </Field>
            <Field label={t('bulkOperations.column.type')}>{typeLabel}</Field>
            <Field label={t('bulkOperations.column.progress')}>
              <span className="font-mono">
                {op.processed}/{op.total}
              </span>{' '}
              <span className="text-muted-foreground">({pct}%)</span>
            </Field>
            <Field label={t('bulkOperations.column.succeeded')}>{op.succeeded}</Field>
            <Field label={t('bulkOperations.column.skipped')}>{op.skipped}</Field>
            <Field label={t('bulkOperations.column.failed')}>{op.failed}</Field>
            <Field label={t('bulkOperations.detail.field.requestedBy')}>
              <span className="font-mono text-xs">{op.requestedByAdminUserId}</span>
            </Field>
            <Field label={t('bulkOperations.column.created')}>{formatDateTime(op.createdAt)}</Field>
            <Field label={t('bulkOperations.detail.field.started')}>
              {op.startedAt ? formatDateTime(op.startedAt) : '—'}
            </Field>
            <Field label={t('bulkOperations.detail.field.finished')}>
              {op.finishedAt ? formatDateTime(op.finishedAt) : '—'}
            </Field>
            <Field label={t('bulkOperations.detail.changedFields')}>
              {op.touchedFields.length > 0 ? op.touchedFields.join(', ') : '—'}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('bulkOperations.detail.logs')}</CardTitle>
        </CardHeader>
        <CardContent>
          {op.logs && op.logs.length > 0 ? (
            <ul className="space-y-1 font-mono text-xs">
              {op.logs.map((entry, idx) => (
                <li key={idx} className="flex flex-wrap gap-2">
                  <span className="text-muted-foreground">{formatDateTime(entry.ts)}</span>
                  <span className={`uppercase ${LOG_LEVEL_CLASS[entry.level]}`}>{entry.level}</span>
                  <span className={LOG_LEVEL_CLASS[entry.level]}>{entry.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('bulkOperations.detail.noLogs')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('bulkOperations.detail.elements')}</CardTitle>
          <div className="flex flex-wrap gap-1">
            {ELEMENT_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`b2b-btn b2b-btn--sm ${elementFilter === f ? 'b2b-btn--primary' : 'b2b-btn--ghost'}`}
                onClick={(): void => setElementFilter(f)}
              >
                {f === 'all' ? t('bulkOperations.filter.all') : t(`bulkOperations.outcome.${f}`)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {!op.results || op.results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('bulkOperations.detail.noResults')}</p>
          ) : filteredResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('bulkOperations.detail.noElementsForFilter')}</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('bulkOperations.detail.product')}</TableHead>
                    <TableHead>{t('bulkOperations.detail.outcome')}</TableHead>
                    <TableHead>{t('bulkOperations.detail.reason')}</TableHead>
                    <TableHead>{t('bulkOperations.detail.changedFields')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.slice(0, 1000).map((r) => (
                    <TableRow key={r.productId}>
                      <TableCell className="font-mono text-xs">{r.productId}</TableCell>
                      <TableCell>
                        <Badge variant={OUTCOME_BADGE[r.status]}>
                          {t(`bulkOperations.outcome.${r.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.reason ?? r.details?.message ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.changedFields && r.changedFields.length > 0
                          ? r.changedFields.join(', ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
