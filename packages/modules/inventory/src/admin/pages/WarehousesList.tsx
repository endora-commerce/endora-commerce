import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Warehouse } from '@endora-commerce/contracts';
import { Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { ApiError, formatDateTime, cn, useSurfaceVisibility, normalize } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  FilterChip,
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { warehousesClient } from '../api/warehouses-client.js';
/**
 * WarehousesList — admin landing for warehouse identity (feature 010 / US1).
 *
 * The kit's `ListPage` since issue #1749: the toolbar is the row above the
 * results, no longer a strip inside their card. The endpoint answers every
 * warehouse, unpaged, and the search narrows them on screen.
 */
export function WarehousesList(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('core');
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full. Until then this list answered to `orders:read`, so anybody who
  // could look at an order could enumerate every warehouse and its address.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  // Set by the first answer: the skeleton is for the first load, a filter change refreshes over the rows.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await warehousesClient.list({ activeOnly, withTotals: true });
      setRows(res.items);
      setLoadedOnce(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, activeOnly, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        normalize(r.code).includes(q) ||
        normalize(r.name).includes(q),
    );
  }, [rows, query]);

  // Issue #1448 (DS-15): "no warehouse yet" and "nothing matches" are different
  // situations; only the first one is answered by creating a warehouse.
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersActive = query.trim() !== '' || activeOnly;
  const clearFilters = (): void => {
    setQuery('');
    setActiveOnly(false);
  };
  // While there is none, the empty state's New warehouse is the view's one primary (Von Restorff).
  const noData = !loading && !error && filtered.length === 0 && !filtersActive;

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  const newWarehouse = (
    <Button asChild>
      <Link to="/warehouses/new">
        <Plus aria-hidden="true" /> {t('warehouses.action.new')}
      </Link>
    </Button>
  );

  const firstLoad = loading && !loadedOnce;
  const listLoad: ListPageLoad = error ? { kind: 'error', message: error } : firstLoad ? { kind: 'loading' } : { kind: 'ready' };

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('warehouses.page.title')}
        help={t('warehouses.page.help')}
        actions={canWrite && !noData ? newWarehouse : null}
        toolbar={
          // The kit toolbar (#1440): a named search box, then a chip whose
          // on/off state is announced (aria-pressed), not only drawn.
          <ListToolbar
            label={t('warehouses.toolbar.label')}
            className="min-w-0 flex-1"
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('warehouses.search.label')}
                placeholder={t('warehouses.search.placeholder')}
                value={query}
                onValueChange={setQuery}
              />
            }
            filters={
              <FilterChip pressed={activeOnly} onPressedChange={setActiveOnly}>
                {t('warehouses.filter.activeOnly')}
              </FilterChip>
            }
          />
        }
        count={t('warehouses.count', { count: filtered.length })}
        load={listLoad}
        busy={loading && !firstLoad}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          data={filtered}
          keyExtractor={(r) => r.id}
          emptyState={
            filtersActive ? (
              <EmptyState variant="no-results" title={t('warehouses.empty')} onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState
                icon={<WarehouseIcon size={20} />}
                title={t('warehouses.noData.title')}
                description={canWrite ? t('warehouses.noData.body') : t('warehouses.noData.bodyReadOnly')}
                action={canWrite ? newWarehouse : null}
              />
            )
          }
          columns={[
            {
              id: 'code',
              header: t('warehouses.column.code'),
              primary: true,
              render: (r) => (
                <Link to={`/warehouses/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                  {r.code}
                </Link>
              ),
              meta: (r) => r.name,
            },
            { id: 'name', header: t('warehouses.column.name'), hideOnMobile: true, render: (r) => r.name },
            {
              id: 'products',
              header: t('warehouses.column.products'),
              className: 'text-right tabular-nums',
              render: (r) => r.totals?.products?.toLocaleString() ?? '—',
            },
            {
              id: 'onHand',
              header: t('warehouses.column.onHand'),
              className: 'text-right tabular-nums',
              render: (r) => r.totals?.onHand?.toLocaleString() ?? '—',
            },
            {
              id: 'defaultFor',
              header: t('warehouses.column.defaultFor'),
              className: 'text-right tabular-nums',
              hideOnMobile: true,
              render: (r) => r.totals?.isDefaultForChannelCount ?? '—',
            },
            {
              id: 'status',
              header: t('warehouses.column.status'),
              // Inactive is the neutral pill, `b2b-badge` unmodified (a `--muted` modifier was never defined).
              render: (r) => (
                <span className={cn('b2b-badge', r.active && 'b2b-badge--success')}>
                  {r.active ? t('warehouses.status.active') : t('warehouses.status.inactive')}
                </span>
              ),
            },
            {
              id: 'updated',
              header: t('warehouses.column.updated'),
              hideOnMobile: true,
              render: (r) => <span className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt, language)}</span>,
            },
          ]}
        />
      </ListPage>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default WarehousesList;
