import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  Edit,
  FileText,
  Plus,
  Upload,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Dashboard / home page (feature 008).
 *
 * Surfaces a Shopify-style overview: KPI tiles, a recent-activity feed,
 * a quick-actions card, and a stock-alerts panel. KPIs hit existing
 * admin endpoints when they are available and fall back to "—" silently
 * so the page never blocks on a slow / missing endpoint.
 */

interface Kpi {
  labelKey: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
}

const INITIAL_KPIS: Kpi[] = [
  { labelKey: 'home.kpi.activeProducts', value: '—' },
  { labelKey: 'home.kpi.pendingQuotes', value: '—', tone: 'warn' },
  { labelKey: 'home.kpi.openOrders', value: '—' },
  { labelKey: 'home.kpi.outOfStock', value: '—', tone: 'danger' },
];

export function HomePage(): ReactNode {
  const t = useTranslation('core');
  const { me } = useAuth();
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
      await Promise.all([
        // The list endpoint paginates server-side; ask for one row so the
        // network payload is tiny and read the live `counts.active` field
        // (which the endpoint computes across the full product set).
        fetchKpi('/api/v1/admin/catalog/products?pageSize=1', (data: unknown) => {
          const counts = (data as { counts?: { active?: number } }).counts;
          if (counts?.active !== undefined) {
            next[0] = { labelKey: 'home.kpi.activeProducts', value: String(counts.active) };
          }
        }),
        fetchKpi('/api/v1/admin/quote-requests?status=submitted', (data: unknown) => {
          const arr = (data as { data?: unknown[] }).data ?? [];
          next[1] = { labelKey: 'home.kpi.pendingQuotes', value: String(arr.length), tone: 'warn' };
        }),
        fetchKpi('/api/v1/admin/orders?status=new', (data: unknown) => {
          const arr = (data as { data?: unknown[] }).data ?? [];
          next[2] = { labelKey: 'home.kpi.openOrders', value: String(arr.length) };
        }),
        fetchKpi('/api/v1/admin/inventory', (data: unknown) => {
          const k = (data as { data?: { outOfStockCount?: number } }).data;
          if (k?.outOfStockCount !== undefined) {
            next[3] = { labelKey: 'home.kpi.outOfStock', value: String(k.outOfStockCount), tone: 'danger' };
          }
        }),
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
      ]);
      if (!cancelled) setKpis(next);
    })();
    return (): void => {
      cancelled = true;
    };
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
      <div className="b2b-row" style={{ gap: 16, marginBottom: 20 }}>
        {kpis.map((k) => (
          <Stat
            key={k.labelKey}
            label={t(k.labelKey)}
            value={k.value}
            {...(k.tone !== undefined ? { tone: k.tone } : {})}
          />
        ))}
      </div>

      {/* Two-column: recent activity + sidebar (quick actions, stock alerts) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        {/* Recent activity */}
        <div className="b2b-card">
          <div className="b2b-card__head">
            <div>
              <div className="b2b-card__title">{t('home.recentActivity.title')}</div>
              <div className="b2b-card__sub">{t('home.recentActivity.subtitle')}</div>
            </div>
          </div>
          <div className="b2b-card__body b2b-card__body--flush">
            <div className="b2b-minilist" style={{ padding: 4 }}>
              {buildActivity(t).map((event, idx) => {
                const Icon = event.icon;
                return (
                  <div key={idx} className="b2b-minirow">
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--surface-sunken)',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--fg-muted)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={13} />
                    </div>
                    <div style={{ flex: 1, fontSize: 13 }}>{event.text}</div>
                    <span className="b2b-muted" style={{ fontSize: 11, flexShrink: 0 }}>{event.when}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="b2b-col" style={{ gap: 16 }}>
          {/* Quick actions */}
          <div className="b2b-card">
            <div className="b2b-card__head">
              <div className="b2b-card__title">{t('home.quickActions.title')}</div>
            </div>
            <div className="b2b-card__body">
              <div className="b2b-col" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/catalog/products/new'); }}
                >
                  <Plus size={14} /> {t('home.quickActions.newProduct')}
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/price-lists'); }}
                >
                  <CircleDollarSign size={14} /> {t('home.quickActions.editPricing')}
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/import-export'); }}
                >
                  <Upload size={14} /> {t('home.quickActions.importInventory')}
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/quote-requests'); }}
                >
                  <FileText size={14} /> {t('home.quickActions.convertQuote')}
                </button>
              </div>
            </div>
          </div>

          {/* Stock alerts */}
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
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
}): ReactNode {
  const color =
    tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg)';
  return (
    <div className="b2b-card" style={{ flex: 1, padding: 16 }}>
      <div
        className="b2b-muted"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color }}>{value}</div>
    </div>
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

/* Static activity feed copy. Once the audit-log module exposes a
 * "recent admin events" endpoint we'll point this at it; until then
 * the home page renders representative activity that matches the
 * design's intent. */
function buildActivity(t: (key: string, params?: Record<string, string | number>) => string): Array<{ icon: typeof Edit; text: ReactNode; when: string }> {
  const annaK = 'Anna K.';
  const tomaszW = 'Tomasz W.';
  const tier1 = 'Tier 1 distributors';
  const acmeIndustrial = 'Acme Industrial';
  const acme2026 = 'Acme — 2026';
  const bauhaus = 'Bauhaus Polska';
  const wurth = 'Würth Polska';
  const creditAmount = '+ 50 000 PLN';
  return [
  {
    icon: Edit,
    text: (
      <>
        <b>{annaK}</b> {t('home.activity.updatedPriceList')}{' '}
        <Link to="/price-lists" style={{ color: 'var(--primary-color)' }}>
          {tier1}
        </Link>
      </>
    ),
    when: t('home.activity.minutesAgo', { count: 2 }),
  },
  {
    icon: Plus,
    text: (
      <>
        <b>{tomaszW}</b> {t('home.activity.createdProduct')} <span className="b2b-mono">CABLE-LIY-1.5-50</span>
      </>
    ),
    when: t('home.activity.minutesAgo', { count: 38 }),
  },
  {
    icon: Archive,
    text: (
      <>
        <b>{t('home.activity.systemActor')}</b> {t('home.activity.autoArchived')}
      </>
    ),
    when: t('home.activity.hoursAgo', { count: 2 }),
  },
  {
    icon: ClipboardCheck,
    text: (
      <>
        <b>{acmeIndustrial}</b> {t('home.activity.placedOrder')} <span className="b2b-mono">SO-184221</span>
      </>
    ),
    when: t('home.activity.hoursAgo', { count: 4 }),
  },
  {
    icon: CircleDollarSign,
    text: (
      <>
        <b>{annaK}</b> {t('home.activity.importedRules')}{' '}
        <Link to="/price-lists" style={{ color: 'var(--primary-color)' }}>
          {acme2026}
        </Link>
      </>
    ),
    when: t('home.activity.hoursAgo', { count: 6 }),
  },
  {
    icon: FileText,
    text: (
      <>
        <b>{bauhaus}</b> {t('home.activity.requestedQuote')}
      </>
    ),
    when: t('home.activity.yesterday'),
  },
  {
    icon: CreditCard,
    text: (
      <>
        <b>{t('home.activity.financeActor')}</b> {t('home.activity.raisedCredit')} <b>{wurth}</b> {t('home.activity.byAmount')} <span className="b2b-mono">{creditAmount}</span>
      </>
    ),
    when: t('home.activity.daysAgo', { count: 2 }),
  },
  ];
}

