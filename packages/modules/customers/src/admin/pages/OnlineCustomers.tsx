import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Users } from 'lucide-react';
import { ApiError, apiClient, cn, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Button, Checkbox, EmptyState, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ListPage, ResponsiveTable, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

interface OnlineCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  lastSeenAt: string;
}

const MIN_INTERVAL_SEC = 2;

/**
 * The buyers signed in right now, from `Session.lastSeenAt`.
 *
 * The kit's `ListPage` since issue #1749. The refresh controls are the toolbar
 * row, and a refresh — by hand or on the timer — keeps the rows on screen
 * rather than flashing the skeleton, which would make a polled list flicker
 * every few seconds. A customer's name is the link to them; the endpoint
 * answers the whole presence set, so there is no pager.
 */
export function OnlineCustomers(): ReactNode {
  const t = useTranslation('customers');
  const { language } = useTranslationContext();
  const [rows, setRows] = useState<OnlineCustomer[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Auto-refresh: opt-in, with a configurable interval (seconds). The presence
  // list is derived from `Session.lastSeenAt`, so a buyer who logs in after the
  // page loaded only appears on the next fetch — hence an explicit Refresh plus
  // optional polling.
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState(15);

  const refresh = useCallback(async (): Promise<void> => {
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    setRefreshing(true);
    try {
      const res = await apiClient.get<{ data: OnlineCustomer[] }>('/api/v1/admin/customers/online');
      setRows(res.data);
      setLastRefreshed(new Date());
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('online.error') });
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the latest `refresh` in a ref so the polling effect does not resubscribe
  // (and reset the timer) on every render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const ms = Math.max(MIN_INTERVAL_SEC, intervalSec) * 1000;
    const handle = setInterval(() => {
      void refreshRef.current();
    }, ms);
    return () => clearInterval(handle);
  }, [autoRefresh, intervalSec]);

  const controls = (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
        {t('online.autoRefresh')}
      </label>
      <div className="space-y-1">
        <Label htmlFor="online-interval" className="text-xs text-muted-foreground">
          {t('online.intervalLabel')}
        </Label>
        <Input
          id="online-interval"
          type="number"
          min={MIN_INTERVAL_SEC}
          step={1}
          value={intervalSec}
          disabled={!autoRefresh}
          onChange={(e) => setIntervalSec(Math.max(MIN_INTERVAL_SEC, Number(e.target.value) || MIN_INTERVAL_SEC))}
          className="w-24"
        />
      </div>
      <Button variant="outline" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing || undefined}>
        <RefreshCw aria-hidden="true" className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
        {t('online.refresh')}
      </Button>
      {lastRefreshed ? (
        <p className="self-center text-xs text-muted-foreground">
          {t('online.refreshedAt', { time: formatDateTime(lastRefreshed.toISOString(), language) })}
        </p>
      ) : null}
    </div>
  );

  return (
    <ListPage
      title={t('online.title')}
      description={t('online.description')}
      toolbar={controls}
      count={t('online.count', { count: rows.length })}
      load={load}
      onRetry={() => void refresh()}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(c) => c.id}
        // Issue #1448 (DS-15): the page's one region, so the kit block; Refresh
        // is in the toolbar, so the block names it rather than repeating it.
        emptyState={<EmptyState icon={<Users size={20} />} title={t('online.empty')} description={t('online.emptyBody')} />}
        columns={[
          {
            id: 'name',
            header: t('list.column.customer'),
            primary: true,
            // The name is the way in; an *Open* button in every row only repeated it.
            render: (c) => (
              <Link to={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                {c.firstName} {c.lastName}
              </Link>
            ),
            meta: (c) => <span className="font-mono text-xs text-muted-foreground">{c.email}</span>,
          },
          {
            id: 'lastSeen',
            header: t('online.column.lastSeen'),
            render: (c) => formatDateTime(c.lastSeenAt, language),
          },
        ]}
      />
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default OnlineCustomers;
