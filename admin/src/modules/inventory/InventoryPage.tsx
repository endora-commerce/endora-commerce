import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  History,
  Pencil,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AdminStockRow {
  id: string;
  productId: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  productSku: string | null;
  productName: Record<string, string> | null;
  updatedAt: string;
}

/**
 * Inventory list (feature 008).
 *
 * Stat tiles → filterbar → stock table. The first column shows the
 * resolved product name + SKU; the available-quantity cell renders the
 * design's stock pill so the user can scan low/out rows at a glance.
 *
 * Side drawer slides out for a per-row "Adjust" action; future iteration
 * will populate it with a movement timeline once the audit module
 * exposes the events.
 */
export function InventoryPage(): ReactNode {
  const [rows, setRows] = useState<AdminStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out'>('all');
  const [editingRow, setEditingRow] = useState<AdminStockRow | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminStockRow[] }>('/api/v1/admin/inventory');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSet = useCallback(
    async (input: {
      productId: string;
      variantId: string | null;
      onHand: number;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminStockRow }>('/api/v1/admin/inventory', input);
        setInfo(`Set on-hand to ${input.onHand}.`);
        setEditingRow(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'out' && r.available !== 0) return false;
      if (statusFilter === 'low' && (r.available === 0 || r.available > 50)) return false;
      if (t) {
        const name =
          r.productName?.['en-US'] ?? (r.productName ? Object.values(r.productName)[0] : null);
        if (
          !(r.productSku ?? '').toLowerCase().includes(t) &&
          !(name ?? '').toLowerCase().includes(t) &&
          !r.productId.toLowerCase().includes(t)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, query, statusFilter]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      out: rows.filter((r) => r.available === 0).length,
      low: rows.filter((r) => r.available > 0 && r.available < 50).length,
    }),
    [rows],
  );

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">Inventory</div>
          <div className="b2b-page-head__sub">
            Stock levels per SKU · adjustments are journaled · <code className="b2b-mono">available = onHand − reserved</code>
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <History size={13} /> Movement log
          </button>
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Upload size={13} /> Import counts
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(): void => setEditingRow({} as AdminStockRow)}
          >
            <Plus size={14} /> New adjustment
          </button>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}
      {info ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(142 50% 80%)',
          }}
        >
          {info}
        </div>
      ) : null}

      <div className="b2b-row" style={{ gap: 16, marginBottom: 16 }}>
        <Stat label="Total SKUs" value={stats.total.toLocaleString()} />
        <Stat label="Out of stock" value={String(stats.out)} tone="danger" />
        <Stat label="Low stock" value={String(stats.low)} tone="warn" />
      </div>

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder="Search SKU, product name, or ID…"
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'low'}
            label="Low stock"
            onClick={(): void => setStatusFilter((s) => (s === 'low' ? 'all' : 'low'))}
          />
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'out'}
            label="Out of stock"
            onClick={(): void => setStatusFilter((s) => (s === 'out' ? 'all' : 'out'))}
          />
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <Search size={20} />
              </div>
              <div className="b2b-empty__title">No stock rows match the current filters</div>
              <div className="b2b-empty__sub">Try clearing the search box or status chips.</div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Variant</th>
                  <th className="num">On hand</th>
                  <th className="num">Reserved</th>
                  <th className="num">Available</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="is-clickable"
                    onClick={(): void => setEditingRow(r)}
                  >
                    <td>
                      <div className="b2b-row" style={{ gap: 12 }}>
                        <div
                          className="b2b-thumb"
                          style={{
                            width: 32,
                            height: 32,
                            background: hashColor(r.productId),
                          }}
                        />
                        <div style={{ minWidth: 0, fontSize: 13 }}>
                          {r.productName
                            ? r.productName['en-US'] ?? Object.values(r.productName)[0]
                            : <span className="b2b-muted">— unknown —</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.productSku ?? r.productId.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.variantId ? r.variantId.slice(0, 8) : '—'}
                      </span>
                    </td>
                    <td className="num b2b-tabular">{r.onHand.toLocaleString()}</td>
                    <td className="num b2b-tabular">{r.reserved.toLocaleString()}</td>
                    <td className="num b2b-tabular" style={{ fontWeight: 600 }}>
                      <StockPill available={r.available} max={Math.max(r.onHand, 100)} />
                    </td>
                    <td>
                      {r.available === 0 ? (
                        <span className="b2b-badge b2b-badge--danger">Out</span>
                      ) : r.available < 50 ? (
                        <span className="b2b-badge b2b-badge--warn">Low</span>
                      ) : (
                        <span className="b2b-badge b2b-badge--success">In stock</span>
                      )}
                    </td>
                    <td>
                      <span className="b2b-muted" style={{ fontSize: 12 }}>
                        {formatDateTime(r.updatedAt)}
                      </span>
                    </td>
                    <td className="actions" onClick={(e): void => e.stopPropagation()}>
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
                        onClick={(): void => setEditingRow(r)}
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AdjustDrawer
        row={editingRow}
        onClose={(): void => setEditingRow(null)}
        onSubmit={handleSet}
      />
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
  tone?: 'warn' | 'danger';
}): ReactNode {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg)';
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

function Chip(props: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={cn('b2b-filterchip', props.active && 'is-on')}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function StockPill({ available, max }: { available: number; max: number }): ReactNode {
  const pct = Math.min(100, Math.max(0, (available / Math.max(max, 1)) * 100));
  const cls = available === 0 ? 'zero' : available < max * 0.1 ? 'lo' : '';
  return (
    <span className={cn('b2b-stock-pill', cls)}>
      <span className="bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span>{available.toLocaleString()}</span>
    </span>
  );
}

function AdjustDrawer({
  row,
  onClose,
  onSubmit,
}: {
  row: AdminStockRow | null;
  onClose: () => void;
  onSubmit: (input: { productId: string; variantId: string | null; onHand: number }) => Promise<void>;
}): ReactNode {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [onHand, setOnHand] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (row && row.productId) {
      setProductId(row.productId);
      setVariantId(row.variantId ?? '');
      setOnHand(String(row.onHand));
    } else {
      setProductId('');
      setVariantId('');
      setOnHand('0');
    }
  }, [row]);

  if (row === null) return null;

  const isNew = !row.productId;
  const productName = row.productName
    ? row.productName['en-US'] ?? Object.values(row.productName)[0]
    : null;

  const handle = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        productId,
        variantId: variantId || null,
        onHand: Number(onHand),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <aside className="b2b-drawer" role="dialog" aria-modal="true">
        <div className="b2b-drawer__head">
          <div className="b2b-grow">
            <div className="b2b-drawer__title">{isNew ? 'New adjustment' : 'Adjust stock'}</div>
            {!isNew ? (
              <div className="b2b-card__sub">
                {productName ?? row.productId.slice(0, 8)} ·{' '}
                <span className="b2b-mono">{row.productSku ?? row.productId.slice(0, 8)}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <form onSubmit={(e): void => { void handle(e); }} className="b2b-drawer__body">
          <div className="b2b-col" style={{ gap: 16 }}>
            <div>
              <label className="b2b-label" htmlFor="adj-pid">Product ID</label>
              <input
                id="adj-pid"
                className="b2b-field b2b-field--mono"
                value={productId}
                onChange={(e): void => setProductId(e.target.value.trim())}
                required
                disabled={!isNew}
                placeholder="UUID"
              />
            </div>
            <div>
              <label className="b2b-label" htmlFor="adj-vid">Variant ID (optional)</label>
              <input
                id="adj-vid"
                className="b2b-field b2b-field--mono"
                value={variantId}
                onChange={(e): void => setVariantId(e.target.value.trim())}
                disabled={!isNew}
                placeholder="UUID"
              />
            </div>
            <div>
              <label className="b2b-label" htmlFor="adj-onhand">On hand</label>
              <input
                id="adj-onhand"
                className="b2b-field"
                type="number"
                min="0"
                value={onHand}
                onChange={(e): void => setOnHand(e.target.value)}
              />
              <div className="b2b-help">
                Sets the absolute on-hand counter. Reserved quantities are not affected.
              </div>
            </div>
          </div>
          <div className="b2b-drawer__foot" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="b2b-btn b2b-btn--ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="b2b-btn b2b-btn--primary"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

/* Stable color hash for the row thumbnail placeholder. */
function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const palette = [
    'linear-gradient(135deg, #94a3b8cc, #475569cc)',
    'linear-gradient(135deg, #a3a8b1cc, #5b6a78cc)',
    'linear-gradient(135deg, #b39ddbcc, #6750a4cc)',
    'linear-gradient(135deg, #fcd34dcc, #b54708cc)',
    'linear-gradient(135deg, #6ee7b7cc, #008060cc)',
  ];
  return palette[Math.abs(hash) % palette.length]!;
}
