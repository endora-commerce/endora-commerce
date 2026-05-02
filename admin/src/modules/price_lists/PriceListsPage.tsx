import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CircleDollarSign,
  Globe,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Store as StoreIcon,
  Upload,
  Users,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface AdminPriceList {
  id: string;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  priority: number;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Price lists — feature 008 redesign.
 *
 * Stats hero (count, currencies, default), filter bar, table with
 * default-fallback marker. Click a row to open the detail page where
 * settings can be edited; “New” opens the upsert form in a modal-ish
 * drawer at the page foot.
 */
export function PriceListsPage(): ReactNode {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminPriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPriceList[] }>('/api/v1/admin/price-lists');
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

  const handleUpsert = useCallback(
    async (input: {
      code: string;
      name: string;
      currency: string;
      isDefault: boolean;
      priority: number;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminPriceList }>(
          `/api/v1/admin/price-lists/${encodeURIComponent(input.code)}`,
          input,
        );
        setInfo(`Saved ${input.code}.`);
        setCreating(false);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t),
    );
  }, [rows, query]);

  const stats = useMemo(() => {
    const currencies = Array.from(new Set(rows.map((r) => r.currency))).sort();
    return {
      total: rows.length,
      defaultCount: rows.filter((r) => r.isDefault).length,
      currencies,
    };
  }, [rows]);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">Price lists</div>
          <div className="b2b-page-head__sub">
            Default catalog price + customer-group, organization, and channel-specific overrides
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Upload size={13} /> Import CSV
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(): void => setCreating(true)}
          >
            <Plus size={14} /> New price list
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
        <Stat label="Total price lists" value={String(stats.total)} />
        <Stat label="Default fallback" value={String(stats.defaultCount)} />
        <Stat
          label="Currencies"
          value={stats.currencies.length === 0 ? '—' : stats.currencies.join(', ')}
        />
      </div>

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder="Search by name or code…"
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Chip icon={<Globe size={12} />} label="Currency" />
          <Chip icon={<Users size={12} />} label="Audience" />
          <Chip icon={<StoreIcon size={12} />} label="Channel" />
        </div>
        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <CircleDollarSign size={20} />
              </div>
              <div className="b2b-empty__title">No price lists yet</div>
              <div className="b2b-empty__sub">
                Create one to override the default catalog price for a customer group, an
                organization, or a sales channel.
              </div>
              <button
                type="button"
                className="b2b-btn b2b-btn--primary"
                onClick={(): void => setCreating(true)}
              >
                <Plus size={14} /> New price list
              </button>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Currency</th>
                  <th className="num">Priority</th>
                  <th>Default</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="is-clickable"
                    onClick={(): void => { navigate(`/price-lists/${r.id}`); }}
                  >
                    <td>
                      <div className="b2b-row" style={{ gap: 12 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 6,
                            background: r.isDefault ? 'var(--primary-soft)' : 'var(--surface-sunken)',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          {r.isDefault ? (
                            <Star size={14} style={{ color: 'var(--primary-color)' }} />
                          ) : (
                            <CircleDollarSign size={14} style={{ color: 'var(--fg-muted)' }} />
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.name}</div>
                          {r.isDefault ? (
                            <span className="b2b-badge b2b-badge--success" style={{ marginTop: 2 }}>
                              Default fallback
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.code}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-badge b2b-badge--outline">{r.currency}</span>
                    </td>
                    <td className="num b2b-tabular">{r.priority}</td>
                    <td>
                      {r.isDefault ? (
                        <span className="b2b-badge b2b-badge--info">Default</span>
                      ) : (
                        <span className="b2b-muted">—</span>
                      )}
                    </td>
                    <td className="actions" onClick={(e): void => e.stopPropagation()}>
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating ? (
        <UpsertDrawer onClose={(): void => setCreating(false)} onSubmit={handleUpsert} />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="b2b-card" style={{ flex: 1, padding: 16 }}>
      <div
        className="b2b-muted"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Chip({ icon, label }: { icon: ReactNode; label: string }): ReactNode {
  return (
    <button type="button" className="b2b-filterchip">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function UpsertDrawer({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: {
    code: string;
    name: string;
    currency: string;
    isDefault: boolean;
    priority: number;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('PLN');
  const [priority, setPriority] = useState('0');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handle = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await onSubmit({ code, name, currency, isDefault, priority: Number(priority) });
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
            <div className="b2b-drawer__title">New price list</div>
            <div className="b2b-card__sub">
              Define an override list. Items + assignments are managed on the detail page.
            </div>
          </div>
        </div>
        <div className="b2b-drawer__body">
          <div className="b2b-col" style={{ gap: 14 }}>
            <div>
              <label className="b2b-label" htmlFor="plcode">Code</label>
              <input
                id="plcode"
                className="b2b-field b2b-field--mono"
                value={code}
                onChange={(e): void => setCode(e.target.value.toLowerCase())}
                placeholder="tier-1-distributors"
                required
              />
              <div className="b2b-help">Lowercase, kebab-case. Used as the URL path segment.</div>
            </div>
            <div>
              <label className="b2b-label" htmlFor="plname">Display name</label>
              <input
                id="plname"
                className="b2b-field"
                value={name}
                onChange={(e): void => setName(e.target.value)}
                required
              />
            </div>
            <div className="b2b-row" style={{ gap: 12 }}>
              <div className="b2b-grow">
                <label className="b2b-label" htmlFor="plcur">Currency</label>
                <input
                  id="plcur"
                  className="b2b-field b2b-field--mono"
                  value={currency}
                  onChange={(e): void => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </div>
              <div className="b2b-grow">
                <label className="b2b-label" htmlFor="plprio">Priority</label>
                <input
                  id="plprio"
                  className="b2b-field"
                  type="number"
                  value={priority}
                  onChange={(e): void => setPriority(e.target.value)}
                />
              </div>
            </div>
            <label
              className="b2b-row"
              style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                className="b2b-cbx"
                checked={isDefault}
                onChange={(e): void => setIsDefault(e.target.checked)}
              />
              Default fallback price list
            </label>
          </div>
        </div>
        <div className="b2b-drawer__foot">
          <button type="button" className="b2b-btn b2b-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            disabled={submitting}
            onClick={(): void => {
              void handle();
            }}
          >
            {submitting ? 'Saving…' : 'Save price list'}
          </button>
        </div>
      </aside>
    </>
  );
}

void cn; // utility kept for symmetry with sibling files
