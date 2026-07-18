import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BULK_OPERATION_TYPES,
  type BulkOperation,
  type BulkOperationLogEntry,
  type BulkOperationStatus,
  type BulkOperationUndoResponse,
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

/** Resolved product info for the per-element Product column. */
interface ProductInfo {
  name: string;
  sku: string;
}

/** Pick a display name from the multilingual product `name` record. */
function resolveProductName(name: Record<string, string>): string {
  return name['en-US'] ?? name['en'] ?? Object.values(name)[0] ?? '';
}

export function BulkOperationDetailPage(): ReactNode {
  const t = useTranslation('catalog');
  const { id = '' } = useParams<{ id: string }>();
  const [op, setOp] = useState<BulkOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elementFilter, setElementFilter] = useState<ElementFilter>('all');
  const [productInfo, setProductInfo] = useState<Record<string, ProductInfo>>({});
  const [undoing, setUndoing] = useState(false);
  const [undoResult, setUndoResult] = useState<BulkOperationUndoResponse['data'] | null>(null);

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

  // Stable key over the distinct product ids in the result set so the lookup
  // below doesn't refetch on every poll when the id set is unchanged.
  const productIdsKey = useMemo(
    () => Array.from(new Set((op?.results ?? []).map((r) => r.productId))).join('|'),
    [op?.results],
  );

  // Resolve product name + SKU for the Product column (results only carry the
  // product id). Batched in chunks via the admin batch-by-id endpoint.
  useEffect(() => {
    const ids = productIdsKey ? productIdsKey.split('|') : [];
    if (ids.length === 0) {
      setProductInfo({});
      return undefined;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      const map: Record<string, ProductInfo> = {};
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        try {
          const res = await apiClient.post<{
            data: Array<{ id: string; sku: string; name: Record<string, string> }>;
          }>('/api/v1/admin/catalog/products/batch-by-id', { ids: chunk, pageSize: CHUNK });
          for (const p of res.data) {
            map[p.id] = { name: resolveProductName(p.name), sku: p.sku };
          }
        } catch {
          /* fall back to the raw id for this chunk */
        }
      }
      if (!cancelled) setProductInfo(map);
    })();
    return (): void => {
      cancelled = true;
    };
  }, [productIdsKey]);

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

  // Feature 054 — undo a reversible bulk edit. Restores every affected product
  // whose current state still matches the operation; conflicts are reported.
  const canUndo =
    !!op && op.status === 'completed' && op.reversible && op.undoStatus !== 'reverted';
  const handleUndo = useCallback(async (): Promise<void> => {
    if (!op) return;
    if (!confirm(t('bulkOperations.undo.confirm', { count: op.succeeded }))) return;
    setUndoing(true);
    setError(null);
    setUndoResult(null);
    try {
      const res = await apiClient.post<BulkOperationUndoResponse>(
        `/api/v1/admin/catalog/bulk-operations/${op.id}/undo`,
        {},
      );
      setUndoResult(res.data);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('bulkOperations.undo.error'));
    } finally {
      setUndoing(false);
    }
  }, [op, refresh, t]);

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

      {undoResult ? (
        <Alert variant={undoResult.conflicts.length > 0 ? 'warning' : 'success'} className="mb-4">
          <AlertDescription>
            {t('bulkOperations.undo.result', {
              reverted: undoResult.reverted,
              conflicts: undoResult.conflicts.length,
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {op.undoStatus === 'reverted' && !undoResult ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{t('bulkOperations.undo.alreadyReverted')}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('bulkOperations.detail.summary')}</CardTitle>
          {canUndo ? (
            <button
              type="button"
              className="b2b-btn b2b-btn--sm b2b-btn--primary"
              disabled={undoing}
              onClick={(): void => void handleUndo()}
            >
              {undoing ? t('bulkOperations.undo.running') : t('bulkOperations.undo.action')}
            </button>
          ) : null}
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
                      <TableCell>
                        {(() => {
                          const info = productInfo[r.productId];
                          if (!info) {
                            return <span className="font-mono text-xs">{r.productId}</span>;
                          }
                          return (
                            <Link to={`/catalog/products/${r.productId}`} className="flex flex-col">
                              <span className="font-medium">{info.name || r.productId}</span>
                              <span className="text-xs text-muted-foreground">
                                {t('productsList.column.sku')}: {info.sku}
                              </span>
                            </Link>
                          );
                        })()}
                      </TableCell>
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
