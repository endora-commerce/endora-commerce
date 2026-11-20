import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Search, Upload } from 'lucide-react';
import type {
  InventoryLandingKpis,
  StockLevelRow,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, usePageSizePreference, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { FilterChip, ListToolbar, ListToolbarSearch, PaginationFooter } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import { productInventoryHref, stockDisplayBandLabels, stockDisplayBandTone } from '../lib/labels.js';
interface RosterResponse {
  items: StockLevelRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface KpiResponse {
  data: InventoryLandingKpis;
}

/**
 * Inventory landing — feature 010 / US2.
 *
 * KPI strip backed by `GET /api/v1/admin/inventory`.
 * Per-product roster from `GET /api/v1/admin/inventory/levels`.
 * Per-row edit lands in the product editor's Inventory tab; the import
 * wizard ships in US7.
 */
export function InventoryPage(): ReactNode {
  const t = useTranslation('core');
  /**
   * The screen's own gate (2026-08-29), on the codes its routes now enforce.
   *
   * `inventory` used to borrow `orders:read` for every read and `catalog:write`
   * for every write, so this page had no permission of its own to check and the
   * sidebar entry beside it carried another module's code. Both moved together;
   * hiding the screen rather than letting it 403 is the treatment the sidebar,
   * the palette and the dashboard already apply to a denied destination, and
   * `AppShell.tsx`'s `PALETTE_ITEMS` comment argues it at length. The module
   * half is asked too, because the admin router carries no guard of its own: a
   * module the platform is not running must contribute no surface at all
   * (Constitution XVII item 5), and a permission gate alone leaves this screen
   * rendering and answering 503. For this module that second axis is a real
   * operator switch — `inventory.enabled` — and not only platform availability.
   *
   * `useSurfaceVisibility` is the predicate the sidebar, the palette and the
   * dashboard already share, so the two axes are one expression rather than two
   * that can drift.
   */
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  /**
   * The write half, which is new rather than moved: until this change there was
   * no read-only role to have, because the import link went to a screen gated on
   * `catalog:write` while this page was gated on `orders:read` — two codes
   * nobody grants together on purpose.
   */
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [searchParams] = useSearchParams();
  const [kpis, setKpis] = useState<InventoryLandingKpis | null>(null);
  const [rows, setRows] = useState<StockLevelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out'>(() => {
    const fromUrl = searchParams.get('stock');
    return fromUrl === 'low' || fromUrl === 'out' ? fromUrl : 'all';
  });
  const { pageSize, setPageSize } = usePageSizePreference('inventory-levels');
  const [page, setPage] = useState(0);

  // Debounce the text query so typing doesn't fire a fetch on every
  // keystroke. 250 ms feels live but coalesces typing bursts.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return (): void => window.clearTimeout(id);
  }, [query]);

  const refresh = useCallback(async (): Promise<void> => {
    // A page that renders nothing has no reason to ask the API a question it
    // will be refused.
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const trimmed = debouncedQuery.trim();
      if (trimmed) params.set('q', trimmed);
      if (statusFilter === 'low') params.set('low', '1');
      else if (statusFilter === 'out') params.set('out', '1');
      const [kpiRes, rosterRes] = await Promise.all([
        apiClient.get<KpiResponse>('/api/v1/admin/inventory'),
        apiClient.get<RosterResponse>(
          `/api/v1/admin/inventory/levels?${params.toString()}`,
        ),
      ]);
      setKpis(kpiRes.data);
      setRows(rosterRes.items);
      setTotal(rosterRes.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, page, pageSize, debouncedQuery, statusFilter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever the result-shaping inputs change so
  // the user never lands on an out-of-range page.
  useEffect(() => {
    setPage(0);
  }, [pageSize, debouncedQuery, statusFilter]);

  // Filters are server-side now; rows arrive pre-filtered and pre-paginated.
  const filtered = rows;

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader
        title={t('inventory.page.title')}
        actions={
          canWrite ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/inventory/import">
                <Upload aria-hidden="true" /> {t('inventory.action.import')}
              </Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Issue #1492 (CAT-17): kit cards and Tailwind spacing, one look with the toolbar's card. */}
      <dl className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('inventory.stat.tracked')} value={(kpis?.totalProductsTracked ?? 0).toLocaleString()} />
        <Stat label={t('inventory.stat.totalOnHand')} value={(kpis?.totalOnHand ?? 0).toLocaleString()} />
        <Stat label={t('inventory.stat.outOfStock')} value={String(kpis?.outOfStockCount ?? 0)} tone="danger" />
        <Stat label={t('inventory.stat.lowStock')} value={String(kpis?.lowStockCount ?? 0)} tone="warn" />
      </dl>

      {kpis && kpis.perWarehouseTotals.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('inventory.perWarehouseTotals')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-wrap gap-6">
              {kpis.perWarehouseTotals.map((row) => (
                <div key={row.warehouseId}>
                  <dt className="text-xs uppercase text-muted-foreground">{row.warehouseCode}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{row.onHand.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        {/* Issue #1440 (DS-06) — the kit toolbar. The two stock chips are exclusive:
            pressing one releases the other, because the API takes one stock filter. */}
        <ListToolbar
          label={t('inventory.toolbar.label')}
          className="border-b border-border px-3 py-2.5"
          search={
            <ListToolbarSearch
              label={t('inventory.search.label')}
              placeholder={t('inventory.search.placeholder')}
              value={query}
              onValueChange={setQuery}
            />
          }
          filters={
            <>
              <FilterChip
                icon={<AlertCircle size={12} />}
                pressed={statusFilter === 'low'}
                onPressedChange={(next): void => setStatusFilter(next ? 'low' : 'all')}
              >
                {t('inventory.stat.lowStock')}
              </FilterChip>
              <FilterChip
                icon={<AlertCircle size={12} />}
                pressed={statusFilter === 'out'}
                onPressedChange={(next): void => setStatusFilter(next ? 'out' : 'all')}
              >
                {t('inventory.stat.outOfStock')}
              </FilterChip>
            </>
          }
        />

        {loading ? (
          <p role="status" className="p-8 text-sm text-muted-foreground">
            {t('inventory.loading')}
          </p>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title={t('inventory.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('inventory.column.product')}</TableHead>
                <TableHead>{t('inventory.column.sku')}</TableHead>
                <TableHead className="text-right">{t('inventory.column.cumulativeOnHand')}</TableHead>
                <TableHead>{t('inventory.column.perWarehouse')}</TableHead>
                <TableHead>{t('inventory.column.displayBand')}</TableHead>
                <TableHead className="w-[1%]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell>{r.productName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.productSku}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {r.cumulativeOnHand.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {r.perWarehouse.map((w) => (
                        <span key={w.warehouseId} className="b2b-badge" title={w.warehouseId}>
                          {w.warehouseCode}: {w.onHand.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={stockDisplayBandTone(r.displayBand)}>
                      {stockDisplayBandLabels.label(t, r.displayBand)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={productInventoryHref(r.productId)}>{t('inventory.action.editStock')}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PaginationFooter
          page={page}
          pageSize={pageSize}
          total={total}
          onPageSizeChange={setPageSize}
          onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
          onNext={(): void => setPage((p) => p + 1)}
        />
      </Card>
    </div>
  );
}

/** One KPI: a term and its value inside the strip's `<dl>`. The tone repeats what the label says. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'danger';
}): ReactNode {
  return (
    <Card className="p-(--card-pad)">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'danger' && 'text-destructive',
          tone === 'warn' && 'text-(--warn-soft-fg)',
        )}
      >
        {value}
      </dd>
    </Card>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default InventoryPage;
