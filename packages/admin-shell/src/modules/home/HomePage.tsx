import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, FileText, Package, Plus, Upload, type LucideIcon } from 'lucide-react';
import {
  ApiError,
  apiClient,
  useAuth,
  useSurfaceVisibility,
  cn,
  type GatedSurface,
} from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
} from '@endora-commerce/admin-kit/ui';
import { MINI_ROW, MINI_ROW_LINK } from './mini-row.js';
import { RecentActivityCard } from './RecentActivityCard.js';

/**
 * Dashboard / home page (feature 008).
 *
 * Surfaces a Shopify-style overview: KPI tiles, a recent-activity feed,
 * a quick-actions card, and a stock-alerts panel. Each tile and the
 * stock-alerts card owns its own request, so the page never blocks on a slow
 * or missing endpoint and one failure is one tile's.
 *
 * ## A surface fetches when it mounts, and it mounts when it is visible
 *
 * The requests used to be decided once, in a single mount effect on this page,
 * by asking `isVisible` about each surface. That is the right question asked at
 * the wrong moment: `App` mounts `ModulePresenceProvider` and this route in the
 * same commit, the provider is fail-closed until its first response, and so on
 * every cold load — a hard reload on `/`, or the render that follows login —
 * `isVisible` answered `false` for all five surfaces and all five requests were
 * skipped. The tiles then appeared when presence resolved and read "—" until
 * the operator left the dashboard and came back, which remounted the page under
 * a provider that had already resolved.
 *
 * Re-running that effect on `isVisible`'s identity would have been the smaller
 * diff and the worse repair: it refires every request whenever presence or the
 * permission set re-resolves. Instead the request belongs to the surface, and a
 * surface is only ever rendered behind `isVisible` — so "rendered" and
 * "fetched" are one condition rather than two that have to be kept in step,
 * and a surface that becomes visible later fetches then, once.
 */

/** What a tile's path may depend on besides the tile itself. */
interface KpiContext {
  /**
   * A platform admin owns no per-user assignments, so the pending-quotes count
   * is scoped to "all" for them (parity with the list's default Visibility
   * filter); otherwise the tile would read 0 even with pending requests waiting.
   */
  readonly platformAdmin: boolean;
}

interface Kpi extends GatedSurface {
  labelKey: string;
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
  /** The endpoint the number is read from. */
  path: (context: KpiContext) => string;
  /**
   * The number, out of that endpoint's response — or `null` when the response
   * does not carry it, which renders the "—" placeholder rather than a guess.
   */
  read: (data: unknown) => string | null;
}

const KPIS: readonly Kpi[] = [
  {
    labelKey: 'home.kpi.activeProducts',
    to: '/catalog/products?status=active',
    requiredPermission: 'catalog:read',
    module: 'catalog',
    // The list endpoint paginates server-side; ask for one row so the network
    // payload is tiny and read the live `counts.active` field (which the
    // endpoint computes across the full product set).
    path: () => '/api/v1/admin/catalog/products?pageSize=1',
    read: (data) => {
      const active = (data as { counts?: { active?: number } }).counts?.active;
      return active === undefined ? null : String(active);
    },
  },
  {
    labelKey: 'home.kpi.pendingQuotes',
    tone: 'warn',
    to: '/quote-requests?status=Pending&scope=all',
    requiredPermission: 'rfqs:handle',
    module: 'quote_requests',
    // Count only Pending requests (matching this KPI's drill-down link).
    // `submitted` is not a valid RFQ status, so the backend rejected the
    // filter and returned every request — Canceled/Approved/etc. included.
    // The list is paged (issue #317): one row is asked for and the total read,
    // which counts every match rather than the first page's.
    path: ({ platformAdmin }) =>
      `/api/v1/admin/quote-requests?status=Pending${platformAdmin ? '&assignmentScope=all' : ''}&pageSize=1`,
    read: (data) => {
      const total = (data as { pagination?: { total?: number } }).pagination?.total;
      return total === undefined ? null : String(total);
    },
  },
  {
    labelKey: 'home.kpi.openOrders',
    to: '/orders?status=new',
    requiredPermission: 'orders:read',
    module: 'orders',
    // The list is paged (25 rows by default), so counting the rows it returned
    // stopped at 25 (issue #1358). One row is asked for and the total read,
    // as the pending-quotes tile does.
    path: () => '/api/v1/admin/orders?status=new&pageSize=1',
    read: (data) => {
      const total = (data as { pagination?: { total?: number } }).pagination?.total;
      return total === undefined ? null : String(total);
    },
  },
  {
    labelKey: 'home.kpi.outOfStock',
    tone: 'danger',
    to: '/inventory?stock=out',
    // `orders:read` is not a copy of the tile above it: the inventory endpoints
    // really are gated by it (`inventory/routes.admin.ts:103`).
    requiredPermission: 'orders:read',
    module: 'inventory',
    path: () => '/api/v1/admin/inventory',
    read: (data) => {
      const count = (data as { data?: { outOfStockCount?: number } }).data?.outOfStockCount;
      return count === undefined ? null : String(count);
    },
  },
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

interface StockAlert {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  threshold: number;
}

const STOCK_ALERTS_PATH = '/api/v1/admin/inventory/low-stock';
const STOCK_ALERTS_SHOWN = 5;

function readStockAlerts(data: unknown): StockAlert[] {
  const items =
    (data as {
      items?: Array<{
        productId: string;
        productSku: string;
        productName: string;
        cumulativeOnHand: number;
        lowStockThreshold: number;
      }>;
    }).items ?? [];
  return items.slice(0, STOCK_ALERTS_SHOWN).map((item) => ({
    productId: item.productId,
    sku: item.productSku,
    name: item.productName,
    qty: item.cumulativeOnHand,
    threshold: item.lowStockThreshold,
  }));
}

export function HomePage(): ReactNode {
  const t = useTranslation('core');
  const { me } = useAuth();
  const isVisible = useSurfaceVisibility();
  const firstName = me?.adminUser.firstName?.trim() || t('home.defaultName');
  const kpiContext: KpiContext = { platformAdmin: me?.role?.code === 'platform_admin' };

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader
        title={
          <span>
            {t('home.welcomeBack')}, <span className="font-medium text-muted-foreground">{firstName}</span>
          </span>
        }
      />

      {/* KPI tiles — two per row below desktop, one row of equal tiles on it. */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:flex">
        {/* A tile is mounted only while it is visible, and fetches when it is
            mounted — see the header. Feature 073 and issue #230 are both held
            by that one condition: an absent module or a missing permission
            costs neither a tile nor a request. */}
        {KPIS.filter(isVisible).map((kpi) => (
          <KpiTile key={kpi.labelKey} kpi={kpi} path={kpi.path(kpiContext)} />
        ))}
      </div>

      {/* Two-column: recent activity + sidebar (quick actions, stock alerts) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentActivityCard />

        <div className="flex flex-col gap-4">
          {/* Quick actions — the card folds away when every action in it belongs
              to a switched-off module, the same rule the sidebar sections use. */}
          {QUICK_ACTIONS.some(isVisible) && <QuickActionsCard actions={QUICK_ACTIONS.filter(isVisible)} />}

          {/* Stock alerts — wholly owned by `inventory`; the card is the
              module's contribution to the dashboard, so it goes with it. */}
          {isVisible(STOCK_ALERTS_SURFACE) && <StockAlertsCard />}
        </div>
      </div>
    </div>
  );
}

/**
 * Issue #1556 (SHELL-21) — the quick actions are navigation, so they are a
 * compact list of links. They used to be four full-width default buttons, each
 * as loud as the page's one primary action (Von Restorff), stacked into a card
 * that said less than the sidebar beside it (Occam's Razor).
 */
function QuickActionsCard({ actions }: { actions: readonly QuickAction[] }): ReactNode {
  const t = useTranslation('core');
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{t('home.quickActions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-mx-2 flex flex-col">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <li key={action.to}>
                <Link
                  to={action.to}
                  className={cn(
                    'flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  {t(action.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * One request, owned by the component that renders its answer.
 *
 * `read` is in the dependency list, so it has to be a stable reference — every
 * caller passes a module-level function. No React Query / SWR layer exists in
 * this app (Constitution IV), which is why this is a dozen lines and not a
 * dependency; `useRecentActivity` beside it is the same shape with a poll.
 */
type Remote<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error' };

function useRemote<T>(
  path: string,
  read: (data: unknown) => T,
): { state: Remote<T>; retry: () => void } {
  const [state, setState] = useState<Remote<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<unknown>(path).then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data: read(data) });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (!(err instanceof ApiError)) {
          // eslint-disable-next-line no-console
          console.warn(`Dashboard fetch ${path} failed`, err);
        }
        setState({ status: 'error' });
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [path, read, attempt]);

  const retry = useCallback((): void => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}

const KPI_LABEL = 'text-xs uppercase tracking-wider text-muted-foreground';

const KPI_TONE: Record<NonNullable<Kpi['tone']>, string> = {
  default: 'text-foreground',
  warn: 'text-[var(--warn)]',
  danger: 'text-[var(--danger)]',
};

function KpiTile({ kpi, path }: { kpi: Kpi; path: string }): ReactNode {
  const t = useTranslation('core');
  const { state, retry } = useRemote(path, kpi.read);
  const label = t(kpi.labelKey);

  // A failed request is not a number. The tile used to keep its "—" here,
  // which reads as "no data" and is the same glyph a pending tile showed, so
  // an operator could not tell a dead endpoint from a slow one from an empty
  // shop. The card stops being one big link in this state because a retry
  // button cannot be nested inside one; the label keeps the drill-down.
  if (state.status === 'error') {
    return (
      <Card className="min-w-0 flex-1 p-4" data-testid={`kpi-${kpi.labelKey}-error`}>
        <Link to={kpi.to} className={cn(KPI_LABEL, 'block hover:underline')}>
          {label}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground" role="alert">
            {t('home.kpi.error')}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('home.kpi.retryLabel', { label })}
            onClick={retry}
          >
            {t('home.kpi.retry')}
          </Button>
        </div>
      </Card>
    );
  }

  const loading = state.status === 'loading';
  return (
    <Card className="min-w-0 flex-1 transition-colors hover:bg-muted/40">
      <Link
        to={kpi.to}
        className="block rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`kpi-${kpi.labelKey}`}
        {...(loading ? { 'aria-busy': true } : {})}
      >
        <div className={KPI_LABEL}>{label}</div>
        {/* The placeholder sits in the value's own line box, so the tile is the
            same height pending and loaded and nothing shifts when the number
            lands. */}
        <div className={cn('mt-1 text-2xl font-semibold', KPI_TONE[kpi.tone ?? 'default'])}>
          {loading ? (
            <>
              <Skeleton className="inline-block h-[0.7em] w-[2.5ch]" />
              <span className="sr-only">{t('home.kpi.loading')}</span>
            </>
          ) : (
            (state.data ?? '—')
          )}
        </div>
      </Link>
    </Card>
  );
}

const STOCK_ALERT_PLACEHOLDER_COUNT = 3;

/**
 * Stock alerts — wholly owned by `inventory`; the card is the module's
 * contribution to the dashboard, so it goes with it.
 *
 * It distinguishes four states because three of them used to be one: an empty
 * list was the initial state, so "still loading" and "the request failed" both
 * read "No products are currently low on stock" — a statement about the
 * warehouse that nothing had established.
 */
function StockAlertsCard(): ReactNode {
  const t = useTranslation('core');
  const { state, retry } = useRemote(STOCK_ALERTS_PATH, readStockAlerts);

  return (
    <Card flush>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('home.stockAlerts.title')}</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/inventory/low-stock">{t('home.stockAlerts.seeAll')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {state.status === 'loading' && (
          <div className="flex flex-col p-1" data-testid="stock-alerts-loading" aria-busy="true">
            <span className="sr-only">{t('home.stockAlerts.loading')}</span>
            {Array.from({ length: STOCK_ALERT_PLACEHOLDER_COUNT }).map((_, idx) => (
              <div key={idx} className={MINI_ROW} aria-hidden="true">
                <Skeleton className="size-7 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-2.5 w-[70%]" />
                  <Skeleton className="h-2 w-[40%]" />
                </div>
                <Skeleton className="h-2.5 w-9 shrink-0" />
              </div>
            ))}
          </div>
        )}
        {state.status === 'error' && (
          <div className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground" role="alert">
            <span>{t('home.stockAlerts.error')}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              {t('home.stockAlerts.retry')}
            </Button>
          </div>
        )}
        {state.status === 'ready' && state.data.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('home.stockAlerts.empty')}</p>
        )}
        {state.status === 'ready' && state.data.length > 0 && (
          <div className="flex flex-col p-1">
            {state.data.map((alert) => (
              <Link
                key={alert.productId}
                to={`/catalog/products/${alert.productId}`}
                className={cn(MINI_ROW, MINI_ROW_LINK)}
              >
                <span
                  data-slot="stock-alert-thumb"
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--surface-sunken)] text-muted-foreground"
                >
                  <Package className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{alert.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{alert.sku}</span>
                </span>
                <span
                  className={alert.qty === 0 ? 'b2b-badge b2b-badge--danger' : 'b2b-badge b2b-badge--warn'}
                >
                  {alert.qty === 0 ? t('home.stockAlerts.out') : t('home.stockAlerts.left', { qty: alert.qty })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
