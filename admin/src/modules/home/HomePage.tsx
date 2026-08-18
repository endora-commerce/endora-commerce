import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CircleDollarSign, FileText, Plus, Upload, type LucideIcon } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useSurfaceVisibility, type GatedSurface } from '@/lib/surface-visibility';
import { useTranslation } from '@/i18n/useTranslation';
import { RecentActivityCard } from './RecentActivityCard';

/**
 * Dashboard / home page (feature 008).
 *
 * Surfaces a Shopify-style overview: KPI tiles, a recent-activity feed,
 * a quick-actions card, and a stock-alerts panel. KPIs hit existing
 * admin endpoints when they are available and fall back to "—" silently
 * so the page never blocks on a slow / missing endpoint.
 */

interface Kpi extends GatedSurface {
  labelKey: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
  /** Destination the tile links to — a filtered list mirroring the KPI's query. */
  to: string;
  /**
   * The module whose data this tile reports. Feature 073 / FR-031: a dashboard
   * widget belonging to a switched-off module is a widget that will read "—"
   * forever, and a link into a surface that answers 503.
   */
  module: string;
  /**
   * The permission the tile's own endpoint enforces (issue #230). Without it a
   * restricted role spent a request per page load collecting a 403, then read a
   * permanent "—" on a tile linking to a list it cannot open.
   */
  requiredPermission?: string;
}

const INITIAL_KPIS: Kpi[] = [
  { labelKey: 'home.kpi.activeProducts', value: '—', to: '/catalog/products?status=active', requiredPermission: 'catalog:read', module: 'catalog' },
  { labelKey: 'home.kpi.pendingQuotes', value: '—', tone: 'warn', to: '/quote-requests?status=Pending&scope=all', requiredPermission: 'rfqs:handle', module: 'quote_requests' },
  { labelKey: 'home.kpi.openOrders', value: '—', to: '/orders?status=new', requiredPermission: 'orders:read', module: 'orders' },
  // `orders:read` is not a copy of the tile above it: the inventory endpoints
  // really are gated by it (`inventory/routes.admin.ts:103`).
  { labelKey: 'home.kpi.outOfStock', value: '—', tone: 'danger', to: '/inventory?stock=out', requiredPermission: 'orders:read', module: 'inventory' },
];

/**
 * The quick-action buttons, attributed the same way. They were four hardcoded
 * `navigate(...)` calls; a button that jumps into an absent module's editor is
 * the same defect as an unfiltered sidebar row, just one click further in.
 *
 * Issue #230 — and so is a button that jumps into a screen the role cannot
 * open. Each code is read from the route the *action* performs, which is not
 * always the one the destination list reads: "New product" posts a product, so
 * it is `catalog:write` (`catalog/routes.admin.ts:222`) rather than the
 * `catalog:read` that gates the products list. These render or do not render;
 * the reasoning for hiding rather than disabling is on `PALETTE_ITEMS` in
 * `AppShell.tsx`, and this card follows it so the two agree.
 */
interface QuickAction extends GatedSurface {
  labelKey: string;
  icon: LucideIcon;
  to: string;
  module: string;
  requiredPermission?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { labelKey: 'home.quickActions.newProduct', icon: Plus, to: '/catalog/products/new', requiredPermission: 'catalog:write', module: 'catalog' },
  { labelKey: 'home.quickActions.editPricing', icon: CircleDollarSign, to: '/price-lists', requiredPermission: 'price_lists:read', module: 'price_lists' },
  { labelKey: 'home.quickActions.importInventory', icon: Upload, to: '/import-export', requiredPermission: 'catalog:write', module: 'import_export' },
  { labelKey: 'home.quickActions.convertQuote', icon: FileText, to: '/quote-requests', requiredPermission: 'rfqs:handle', module: 'quote_requests' },
];

/**
 * The stock-alerts card is `inventory`'s whole contribution to the dashboard,
 * and its feed (`/api/v1/admin/inventory/low-stock`) is gated by `orders:read`
 * like the rest of that module's reads.
 */
const STOCK_ALERTS_SURFACE: GatedSurface = {
  module: 'inventory',
  requiredPermission: 'orders:read',
};

export function HomePage(): ReactNode {
  const t = useTranslation('core');
  const { me } = useAuth();
  const isVisible = useSurfaceVisibility();
  const navigate = useNavigate();
  const firstName = me?.adminUser.firstName?.trim() || t('home.defaultName');
  const [kpis, setKpis] = useState<Kpi[]>(INITIAL_KPIS);
  const [stockAlerts, setStockAlerts] = useState<
    Array<{ productId: string; sku: string; name: string; qty: number; threshold: number }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Kpi[] = INITIAL_KPIS.map((k) => ({ ...k }));
      // Best-effort KPI fetches. Each one is independent — if any
      // endpoint isn't wired or returns 4xx/5xx, we leave a "—".
      //
      // Feature 073: a tile whose module is absent is not rendered, so its
      // fetch is skipped too. Firing it anyway would spend a request per page
      // load to collect a 503 for a number nobody will see.
      //
      // Issue #230 widens that from module presence to the whole visibility
      // predicate: the same argument holds verbatim for a 403, and the fetch
      // and the tile now answer to one rule rather than two.
      const forSurface = (
        surface: GatedSurface,
        fetcher: () => Promise<void>,
      ): Promise<void> => (isVisible(surface) ? fetcher() : Promise.resolve());
      await Promise.all([
        // The list endpoint paginates server-side; ask for one row so the
        // network payload is tiny and read the live `counts.active` field
        // (which the endpoint computes across the full product set).
        forSurface(INITIAL_KPIS[0]!, () =>
          fetchKpi('/api/v1/admin/catalog/products?pageSize=1', (data: unknown) => {
            const counts = (data as { counts?: { active?: number } }).counts;
            if (counts?.active !== undefined) {
              next[0]!.value = String(counts.active);
            }
          }),
        ),
        // Count only Pending requests (matching this KPI's drill-down link).
        // `submitted` is not a valid RFQ status, so the backend rejected the
        // filter and returned every request — Canceled/Approved/etc. included.
        // A platform admin owns no per-user assignments, so scope the count to
        // "all" for them (parity with the list's default Visibility filter);
        // otherwise the tile would read 0 even with pending requests waiting.
        forSurface(INITIAL_KPIS[1]!, () =>
          fetchKpi(
            `/api/v1/admin/quote-requests?status=Pending${
              me?.role?.code === 'platform_admin' ? '&assignmentScope=all' : ''
            }`,
            (data: unknown) => {
              const arr = (data as { data?: unknown[] }).data ?? [];
              next[1]!.value = String(arr.length);
            },
          ),
        ),
        forSurface(INITIAL_KPIS[2]!, () =>
          fetchKpi('/api/v1/admin/orders?status=new', (data: unknown) => {
            const arr = (data as { data?: unknown[] }).data ?? [];
            next[2]!.value = String(arr.length);
          }),
        ),
        forSurface(INITIAL_KPIS[3]!, () =>
          fetchKpi('/api/v1/admin/inventory', (data: unknown) => {
            const k = (data as { data?: { outOfStockCount?: number } }).data;
            if (k?.outOfStockCount !== undefined) {
              next[3]!.value = String(k.outOfStockCount);
            }
          }),
        ),
        forSurface(STOCK_ALERTS_SURFACE, () =>
          fetchKpi('/api/v1/admin/inventory/low-stock', (data: unknown) => {
            const items = (data as {
              items?: Array<{
                productId: string;
                productSku: string;
                productName: string;
                cumulativeOnHand: number;
                lowStockThreshold: number;
              }>;
            }).items ?? [];
            if (!cancelled) {
              setStockAlerts(
                items.slice(0, 5).map((i) => ({
                  productId: i.productId,
                  sku: i.productSku,
                  name: i.productName,
                  qty: i.cumulativeOnHand,
                  threshold: i.lowStockThreshold,
                })),
              );
            }
          }),
        ),
      ]);
      if (!cancelled) setKpis(next);
    })();
    return (): void => {
      cancelled = true;
    };
    // One fetch pass per mount, as before. `isVisible` is deliberately not a
    // dependency: re-running on its identity would refire every KPI request the
    // moment module presence or the permission set re-resolves, and the tiles
    // are a page-load snapshot, not a live feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">
            {t('home.welcomeBack')}, <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{firstName}</span>
          </div>
          <div className="b2b-page-head__sub">{t('home.subtitle')}</div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="b2b-row b2b-kpi-grid" style={{ gap: 16, marginBottom: 20 }}>
        {kpis.filter(isVisible).map((k) => (
          <Stat
            key={k.labelKey}
            label={t(k.labelKey)}
            value={k.value}
            to={k.to}
            {...(k.tone !== undefined ? { tone: k.tone } : {})}
          />
        ))}
      </div>

      {/* Two-column: recent activity + sidebar (quick actions, stock alerts) */}
      <div className="b2b-home-dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        <RecentActivityCard />

        <div className="b2b-col" style={{ gap: 16 }}>
          {/* Quick actions — the card folds away when every action in it belongs
              to a switched-off module, the same rule the sidebar sections use. */}
          {QUICK_ACTIONS.some(isVisible) && (
          <div className="b2b-card">
            <div className="b2b-card__head">
              <div className="b2b-card__title">{t('home.quickActions.title')}</div>
            </div>
            <div className="b2b-card__body">
              <div className="b2b-col" style={{ gap: 8 }}>
                {QUICK_ACTIONS.filter(isVisible).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.to}
                      type="button"
                      className="b2b-btn b2b-btn--default"
                      style={{ justifyContent: 'flex-start' }}
                      onClick={(): void => { navigate(action.to); }}
                    >
                      <Icon size={14} /> {t(action.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          )}

          {/* Stock alerts — wholly owned by `inventory`; the card is the
              module's contribution to the dashboard, so it goes with it. */}
          {isVisible(STOCK_ALERTS_SURFACE) && (
          <div className="b2b-card">
            <div className="b2b-card__head">
              <div>
                <div className="b2b-card__title">{t('home.stockAlerts.title')}</div>
                <div className="b2b-card__sub">{t('home.stockAlerts.subtitle')}</div>
              </div>
              <Link to="/inventory/low-stock" className="b2b-btn b2b-btn--ghost b2b-btn--sm">
                {t('home.stockAlerts.seeAll')}
              </Link>
            </div>
            <div className="b2b-card__body b2b-card__body--flush">
              {stockAlerts.length === 0 ? (
                <div className="b2b-help" style={{ padding: 16 }}>
                  {t('home.stockAlerts.empty')}
                </div>
              ) : (
                <div className="b2b-minilist" style={{ padding: 4 }}>
                  {stockAlerts.map((alert) => (
                    <Link
                      key={alert.productId}
                      to={`/catalog/products/${alert.productId}`}
                      className="b2b-minirow"
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div
                        className="b2b-thumb"
                        style={{
                          width: 28,
                          height: 28,
                          background: 'linear-gradient(135deg, #94a3b8cc, #94a3b888)',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{alert.name}</div>
                        <div className="b2b-mono b2b-muted" style={{ fontSize: 10 }}>{alert.sku}</div>
                      </div>
                      <span
                        className={alert.qty === 0 ? 'b2b-badge b2b-badge--danger' : 'b2b-badge b2b-badge--warn'}
                      >
                        {alert.qty === 0 ? t('home.stockAlerts.out') : t('home.stockAlerts.left', { qty: alert.qty })}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
  to: string;
}): ReactNode {
  const color =
    tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg)';
  return (
    <Link
      to={to}
      className="b2b-card b2b-card--clickable"
      style={{ flex: 1, padding: 16, textDecoration: 'none', color: 'inherit' }}
    >
      <div
        className="b2b-muted"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color }}>{value}</div>
    </Link>
  );
}

async function fetchKpi(path: string, set: (data: unknown) => void): Promise<void> {
  try {
    const data = await apiClient.get<unknown>(path);
    set(data);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      // eslint-disable-next-line no-console
      console.warn(`KPI fetch ${path} failed`, err);
    }
    /* swallow — leave the placeholder */
  }
}

