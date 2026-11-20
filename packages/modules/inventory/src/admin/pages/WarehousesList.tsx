import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Warehouse } from '@endora-commerce/contracts';
import { Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { ApiError, formatDateTime, cn, useSurfaceVisibility, normalize } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { FilterChip, ListToolbar, ListToolbarSearch } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { warehousesClient } from '../api/warehouses-client.js';
/**
 * WarehousesList — admin landing for warehouse identity (feature 010 / US1).
 */
export function WarehousesList(): ReactNode {
  const t = useTranslation('core');
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full. Until then this list answered to `orders:read`, so anybody who
  // could look at an order could enumerate every warehouse and its address.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
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

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader
        title={t('warehouses.page.title')}
        help={t('warehouses.page.help')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/warehouses/new">
                <Plus aria-hidden="true" /> {t('warehouses.action.new')}
              </Link>
            </Button>
          ) : null
        }
      />

      {/* Issue #1492 (CAT-17): a failure is a kit Alert (role="alert"), not a card painted red. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        {/* The kit toolbar (#1440), as on the inventory list: a named search box, then a chip
            whose on/off state is announced (aria-pressed), not only drawn. */}
        <ListToolbar
          label={t('warehouses.toolbar.label')}
          className="border-b border-border px-3 py-2.5"
          search={
            <ListToolbarSearch
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

        {loading ? (
          <p role="status" className="p-8 text-sm text-muted-foreground">
            {t('warehouses.loading')}
          </p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<WarehouseIcon size={20} />} title={t('warehouses.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('warehouses.column.code')}</TableHead>
                <TableHead>{t('warehouses.column.name')}</TableHead>
                <TableHead className="text-right">{t('warehouses.column.products')}</TableHead>
                <TableHead className="text-right">{t('warehouses.column.onHand')}</TableHead>
                <TableHead className="text-right">{t('warehouses.column.defaultFor')}</TableHead>
                <TableHead>{t('warehouses.column.status')}</TableHead>
                <TableHead>{t('warehouses.column.updated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/warehouses/${r.id}`} className="font-mono text-xs text-primary hover:underline">
                      {r.code}
                    </Link>
                  </TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totals?.products?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totals?.onHand?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totals?.isDefaultForChannelCount ?? '—'}</TableCell>
                  <TableCell>
                    {/* Inactive is the neutral pill, `b2b-badge` unmodified (a `--muted` modifier was never defined). */}
                    <span className={cn('b2b-badge', r.active && 'b2b-badge--success')}>
                      {r.active ? t('warehouses.status.active') : t('warehouses.status.inactive')}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default WarehousesList;
