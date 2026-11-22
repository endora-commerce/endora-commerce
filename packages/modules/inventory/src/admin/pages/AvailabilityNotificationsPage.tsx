import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell } from 'lucide-react';
import { scopeNoticeOf, type ScopeNoticeCode } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime, cn, useSurfaceVisibility, normalize } from '@endora-commerce/admin-kit/lib';
import {
  FilterChip,
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  ScopeNotice,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, EmptyState, InlineStatus } from '@endora-commerce/admin-kit/ui';
import { availabilityStatusLabels } from '../lib/labels.js';
/** The status filter's chips, in reading order. `all` is the one pressed when no other is. */
const STATUS_FILTERS = ['all', 'queued', 'notified', 'cancelled'] as const;

interface NotificationRow {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  customerAccountId: string | null;
  email: string;
  status: 'queued' | 'notified' | 'cancelled';
  queuedAt: string;
  notifiedAt: string | null;
}

interface ListResponse {
  items: NotificationRow[];
  page: number;
  pageSize: number;
  total: number;
  /**
   * Feature 087 — present only when the server refused every row because these
   * records name no organization. Read with `scopeNoticeOf`.
   */
  meta?: { scopeNotice?: ScopeNoticeCode };
}

/**
 * AvailabilityNotificationsPage — feature 010 / US6 (T070).
 *
 * Admin browser of the back-in-stock queue. Operators can filter by
 * status + product, search by SKU or email, and cancel a queued row.
 */
export function AvailabilityNotificationsPage(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full. The cancel button is the write half: it was `catalog:write` while
  // the list beside it was `orders:read`.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Set by the first answer: the skeleton is for the first load, a filter change refreshes over the rows.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('queued');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Why the queue looks empty, when it does (feature 087).
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const search = new URLSearchParams();
      if (statusFilter !== 'all') search.set('status', statusFilter);
      search.set('pageSize', '200');
      const res = await apiClient.get<ListResponse>(
        `/api/v1/admin/inventory/availability-notifications?${search.toString()}`,
      );
      setRows(res.items);
      setLoadedOnce(true);
      setScopeNotice(scopeNoticeOf(res));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.envelope.error.message : t('inventory.availability.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, statusFilter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        normalize(r.productSku).includes(q) ||
        normalize(r.productName).includes(q) ||
        normalize(r.email).includes(q),
    );
  }, [rows, query]);

  // Issue #1448 (DS-15): the default view is Queued. Nothing queued — or
  // nothing at all, on All — is "no one is waiting"; a search or a Notified /
  // Cancelled view that finds nothing is "these filters match nothing", and
  // Clear filters returns to the default view.
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersActive = query.trim() !== '' || statusFilter === 'notified' || statusFilter === 'cancelled';
  const clearFilters = (): void => {
    setQuery('');
    setStatusFilter('queued');
  };

  const handleCancel = async (id: string): Promise<void> => {
    const ok = await confirm({
      message: t('inventory.availability.confirmCancel'),
      confirmLabel: t('inventory.availability.cancelSubscription'),
      cancelLabel: t('inventory.availability.keepSubscription'),
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await apiClient.patch<unknown>(
        `/api/v1/admin/inventory/availability-notifications/${id}`,
        { status: 'cancelled' },
      );
      setInfo(t('inventory.availability.info.cancelled'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.availability.error.cancel'));
    } finally {
      setBusyId(null);
    }
  };

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  const firstLoad = loading && !loadedOnce;
  const listLoad: ListPageLoad = loadError ? { kind: 'error', message: loadError } : firstLoad ? { kind: 'loading' } : { kind: 'ready' };

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('inventory.availability.title')}
        description={t('inventory.availability.description')}
        toolbar={
          // The kit toolbar (#1440). The status chips are exclusive — the API takes one status —
          // and each announces whether it is the one applied (aria-pressed).
          <ListToolbar
            label={t('inventory.availability.toolbar.label')}
            className="min-w-0 flex-1"
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('inventory.availability.searchLabel')}
                placeholder={t('inventory.availability.searchPlaceholder')}
                value={query}
                onValueChange={setQuery}
              />
            }
            filters={STATUS_FILTERS.map((s) => (
              <FilterChip key={s} pressed={statusFilter === s} onPressedChange={(next): void => setStatusFilter(next ? s : 'all')}>
                {t(`inventory.availability.status.${s}`)}
              </FilterChip>
            ))}
          />
        }
        count={t('inventory.availability.count', { count: filtered.length })}
        notice={
          <>
            {/* A cancellation is the kit InlineStatus (#1499), mounted before it has text so it is
                announced (WCAG 4.1.3); it sits above the rows because the cancelled row leaves the
                default "Queued" view. */}
            <InlineStatus className="empty:hidden">{info}</InlineStatus>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </>
        }
        load={listLoad}
        busy={loading && !firstLoad}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          data={filtered}
          keyExtractor={(r) => r.id}
          emptyState={
            // The notice replaces the empty state rather than sitting beside
            // it: "no subscriptions match the current filters" is a claim about
            // the data, and it is the false one here.
            scopeNotice ? (
              <ScopeNotice notice={scopeNotice} />
            ) : filtersActive ? (
              <EmptyState variant="no-results" title={t('inventory.availability.empty')} onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState icon={<Bell size={20} />} title={t('inventory.availability.noData.title')} description={t('inventory.availability.noData.body')} />
            )
          }
          columns={[
            { id: 'product', header: t('inventory.column.product'), primary: true, render: (r) => r.productName, meta: (r) => r.email },
            { id: 'sku', header: t('inventory.column.sku'), hideOnMobile: true, className: 'font-mono text-xs text-muted-foreground', render: (r) => r.productSku },
            { id: 'email', header: t('inventory.availability.column.email'), hideOnMobile: true, render: (r) => r.email },
            {
              id: 'status',
              header: t('inventory.availability.column.status'),
              // Cancelled is the neutral pill, `b2b-badge` unmodified (a `--muted` modifier was never defined).
              render: (r) => (
                <span
                  className={cn('b2b-badge', r.status === 'queued' && 'b2b-badge--warn', r.status === 'notified' && 'b2b-badge--success')}
                >
                  {availabilityStatusLabels.label(t, r.status)}
                </span>
              ),
            },
            {
              id: 'queued',
              header: t('inventory.availability.column.queued'),
              hideOnMobile: true,
              render: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.queuedAt, language)}</span>,
            },
            {
              id: 'notified',
              header: t('inventory.availability.column.notified'),
              hideOnMobile: true,
              render: (r) => <span className="text-xs text-muted-foreground">{r.notifiedAt ? formatDateTime(r.notifiedAt, language) : '—'}</span>,
            },
          ]}
          renderActions={(r) =>
            canWrite && r.status === 'queued' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyId === r.id}
                aria-busy={busyId === r.id || undefined}
                onClick={(): void => {
                  void handleCancel(r.id);
                }}
              >
                {t('inventory.availability.cancel')}
              </Button>
            ) : null
          }
        />
      </ListPage>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default AvailabilityNotificationsPage;
