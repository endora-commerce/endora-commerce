import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, Checkbox, Input, Label, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface OnlineCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  lastSeenAt: string;
}

const MIN_INTERVAL_SEC = 2;

export function OnlineCustomers(): ReactNode {
  const t = useTranslation('customers');
  const [rows, setRows] = useState<OnlineCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Auto-refresh: opt-in, with a configurable interval (seconds). The presence
  // list is derived from `Session.lastSeenAt`, so a buyer who logs in after the
  // page loaded only appears on the next fetch — hence an explicit Refresh plus
  // optional polling.
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState(15);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OnlineCustomer[] }>('/api/v1/admin/customers/online');
      setRows(res.data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('online.error'));
    } finally {
      setLoading(false);
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
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.checked)}
        />
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
      <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw className={loading ? 'animate-spin' : undefined} />
        {t('online.refresh')}
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('online.title')}
        description={t('online.description')}
        actions={controls}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {lastRefreshed ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t('online.refreshedAt', { time: lastRefreshed.toLocaleTimeString() })}
        </p>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('online.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('online.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(c) => c.id}
              columns={[
                {
                  id: 'name',
                  header: t('list.column.customer'),
                  primary: true,
                  render: (c) => (
                    <span className="font-medium">
                      {c.firstName} {c.lastName}
                    </span>
                  ),
                  meta: (c) => <span className="font-mono text-xs text-muted-foreground">{c.email}</span>,
                },
                {
                  id: 'lastSeen',
                  header: t('online.column.lastSeen'),
                  render: (c) => formatDateTime(c.lastSeenAt),
                },
              ]}
              renderActions={(c) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/customers/${c.id}`}>
                    {t('list.action.open')}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default OnlineCustomers;
