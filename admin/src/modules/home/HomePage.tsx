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

/**
 * Dashboard / home page (feature 008).
 *
 * Surfaces a Shopify-style overview: KPI tiles, a recent-activity feed,
 * a quick-actions card, and a stock-alerts panel. KPIs hit existing
 * admin endpoints when they are available and fall back to "—" silently
 * so the page never blocks on a slow / missing endpoint.
 */

interface Kpi {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
}

export function HomePage(): ReactNode {
  const { me } = useAuth();
  const navigate = useNavigate();
  const firstName = me?.adminUser.firstName?.trim() || 'there';
  const [kpis, setKpis] = useState<Kpi[]>([
    { label: 'Active products', value: '—' },
    { label: 'Pending quotes', value: '—', tone: 'warn' },
    { label: 'Open orders', value: '—' },
    { label: 'Out of stock', value: '—', tone: 'danger' },
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Kpi[] = [
        { label: 'Active products', value: '—' },
        { label: 'Pending quotes', value: '—', tone: 'warn' },
        { label: 'Open orders', value: '—' },
        { label: 'Out of stock', value: '—', tone: 'danger' },
      ];
      // Best-effort KPI fetches. Each one is independent — if any
      // endpoint isn't wired or returns 4xx/5xx, we leave a "—".
      await Promise.all([
        fetchKpi('/api/v1/admin/catalog/products', (data: unknown) => {
          const arr = (data as { data?: unknown[] }).data ?? [];
          next[0] = { label: 'Active products', value: String(arr.length) };
        }),
        fetchKpi('/api/v1/admin/quote-requests?status=submitted', (data: unknown) => {
          const arr = (data as { data?: unknown[] }).data ?? [];
          next[1] = { label: 'Pending quotes', value: String(arr.length), tone: 'warn' };
        }),
        fetchKpi('/api/v1/admin/orders?status=new', (data: unknown) => {
          const arr = (data as { data?: unknown[] }).data ?? [];
          next[2] = { label: 'Open orders', value: String(arr.length) };
        }),
      ]);
      if (!cancelled) setKpis(next);
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">
            Welcome back, <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{firstName}</span>
          </div>
          <div className="b2b-page-head__sub">Here&apos;s what&apos;s happening across your B2B catalog today</div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="b2b-row" style={{ gap: 16, marginBottom: 20 }}>
        {kpis.map((k) => (
          <Stat key={k.label} {...k} />
        ))}
      </div>

      {/* Two-column: recent activity + sidebar (quick actions, stock alerts) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
        {/* Recent activity */}
        <div className="b2b-card">
          <div className="b2b-card__head">
            <div>
              <div className="b2b-card__title">Recent activity</div>
              <div className="b2b-card__sub">Across catalog, pricing, and inventory</div>
            </div>
          </div>
          <div className="b2b-card__body b2b-card__body--flush">
            <div className="b2b-minilist" style={{ padding: 4 }}>
              {ACTIVITY.map((event, idx) => {
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
              <div className="b2b-card__title">Quick actions</div>
            </div>
            <div className="b2b-card__body">
              <div className="b2b-col" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/catalog/products/new'); }}
                >
                  <Plus size={14} /> New product
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/price-lists'); }}
                >
                  <CircleDollarSign size={14} /> Edit pricing
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/import-export'); }}
                >
                  <Upload size={14} /> Import inventory
                </button>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={(): void => { navigate('/quote-requests'); }}
                >
                  <FileText size={14} /> Convert quote to order
                </button>
              </div>
            </div>
          </div>

          {/* Stock alerts */}
          <div className="b2b-card">
            <div className="b2b-card__head">
              <div>
                <div className="b2b-card__title">Stock alerts</div>
                <div className="b2b-card__sub">Below safety threshold</div>
              </div>
            </div>
            <div className="b2b-card__body b2b-card__body--flush">
              <div className="b2b-minilist" style={{ padding: 4 }}>
                {STOCK_ALERTS.map((alert) => (
                  <div key={alert.sku} className="b2b-minirow">
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
                      {alert.qty === 0 ? 'Out' : `${alert.qty} left`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: Kpi): ReactNode {
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
const ACTIVITY: Array<{ icon: typeof Edit; text: ReactNode; when: string }> = [
  {
    icon: Edit,
    text: (
      <>
        <b>Anna K.</b> updated price list{' '}
        <Link to="/price-lists" style={{ color: 'var(--primary-color)' }}>
          Tier 1 distributors
        </Link>
      </>
    ),
    when: '2m ago',
  },
  {
    icon: Plus,
    text: (
      <>
        <b>Tomasz W.</b> created product <span className="b2b-mono">CABLE-LIY-1.5-50</span>
      </>
    ),
    when: '38m ago',
  },
  {
    icon: Archive,
    text: (
      <>
        <b>System</b> auto-archived 12 SKUs with zero movement (180d)
      </>
    ),
    when: '2h ago',
  },
  {
    icon: ClipboardCheck,
    text: (
      <>
        <b>Acme Industrial</b> placed order <span className="b2b-mono">SO-184221</span>
      </>
    ),
    when: '4h ago',
  },
  {
    icon: CircleDollarSign,
    text: (
      <>
        <b>Anna K.</b> imported 2&nbsp;480 price rules into{' '}
        <Link to="/price-lists" style={{ color: 'var(--primary-color)' }}>
          Acme — 2026
        </Link>
      </>
    ),
    when: '6h ago',
  },
  {
    icon: FileText,
    text: (
      <>
        <b>Bauhaus Polska</b> requested a quote · 8 line items
      </>
    ),
    when: 'yesterday',
  },
  {
    icon: CreditCard,
    text: (
      <>
        <b>Finance</b> raised credit limit for <b>Würth Polska</b> by <span className="b2b-mono">+ 50 000 PLN</span>
      </>
    ),
    when: '2 days ago',
  },
];

const STOCK_ALERTS = [
  { sku: 'BOLT-M8-25-A2', name: 'Hex bolt M8×25 A2', qty: 12 },
  { sku: 'CABLE-LIY-1.0-100', name: 'LiYY 18×1.0', qty: 4 },
  { sku: 'GASKET-EPDM-DN50', name: 'Gasket EPDM DN50', qty: 0 },
];
