import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  CircleDollarSign,
  Cog,
  Copy,
  Layers,
  Save,
  Star,
  Users,
  Zap,
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
 * Price list detail (feature 008).
 *
 * Tabbed shell — Price rules / Assignments / Settings — that mirrors
 * the design. Rules and Assignments require backend endpoints that the
 * platform doesn't expose yet for admins; we render informative stubs
 * so the UX story reads correctly. Settings is the existing upsert flow
 * from the list page, just on its own canvas.
 */
export function PriceListDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = params.id ?? '';
  const [list, setList] = useState<AdminPriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<'rules' | 'assignments' | 'settings'>('rules');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // The admin price-lists API exposes listing only — pluck the
      // matching row out of the list response.
      const res = await apiClient.get<{ data: AdminPriceList[] }>('/api/v1/admin/price-lists');
      const found = res.data.find((l) => l.id === id);
      if (!found) {
        setError('Price list not found.');
        setList(null);
      } else {
        setList(found);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(
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
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  if (loading)
    return (
      <div className="b2b-page b2b-page--wide">
        <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );

  if (!list)
    return (
      <div className="b2b-page b2b-page--wide">
        <button
          type="button"
          className="b2b-page-head__back"
          onClick={(): void => { navigate('/price-lists'); }}
        >
          <ChevronLeft size={14} /> Price lists
        </button>
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 16,
            marginTop: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error ?? 'Not found.'}
        </div>
      </div>
    );

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <button
            type="button"
            className="b2b-page-head__back"
            onClick={(): void => { navigate('/price-lists'); }}
          >
            <ChevronLeft size={14} /> Price lists
          </button>
          <div className="b2b-page-head__title">
            {list.name}
            {list.isDefault ? (
              <span className="b2b-badge b2b-badge--success">
                <Star size={11} /> Default
              </span>
            ) : null}
          </div>
          <div className="b2b-page-head__sub">
            <span className="b2b-mono">{list.code}</span> · Currency {list.currency}
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Zap size={13} /> Price preview
          </button>
          <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
            <Copy size={13} /> Duplicate
          </button>
        </div>
      </div>

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

      <div className="b2b-card">
        <div style={{ padding: '4px 4px 0' }}>
          <div className="b2b-tabs" role="tablist">
            <Tab id="rules" label="Price rules" icon={<CircleDollarSign size={14} />} active={tab} onChange={setTab} />
            <Tab id="assignments" label="Assignments" icon={<Users size={14} />} active={tab} onChange={setTab} />
            <Tab id="settings" label="Settings" icon={<Cog size={14} />} active={tab} onChange={setTab} />
          </div>
        </div>

        <div className="b2b-card__body">
          {tab === 'rules' ? <RulesPanel /> : null}
          {tab === 'assignments' ? <AssignmentsPanel /> : null}
          {tab === 'settings' ? <SettingsPanel list={list} onSave={handleSave} /> : null}
        </div>
      </div>
    </div>
  );
}

function Tab(props: {
  id: 'rules' | 'assignments' | 'settings';
  label: string;
  icon: ReactNode;
  active: 'rules' | 'assignments' | 'settings';
  onChange: (id: 'rules' | 'assignments' | 'settings') => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active === props.id}
      className={cn('b2b-tab', props.active === props.id && 'is-active')}
      onClick={(): void => props.onChange(props.id)}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function RulesPanel(): ReactNode {
  return (
    <div
      className="b2b-card"
      style={{
        padding: 16,
        background: 'var(--info-soft)',
        border: '1px solid hsl(217 70% 88%)',
      }}
    >
      <div className="b2b-row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Layers size={18} style={{ color: 'var(--info-soft-fg)', marginTop: 2 }} />
        <div className="b2b-grow">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--info-soft-fg)' }}>
            Price rules — admin UI is on the way
          </div>
          <div style={{ fontSize: 12, color: 'var(--info-soft-fg)', marginTop: 4 }}>
            Per-item, per-tier, percentage, and amount-off rules already exist in the data
            model and on the storefront. The admin grid for managing them lands in a follow-up
            iteration; until then, manage rules through the API or CSV import on the parent
            list page.
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignmentsPanel(): ReactNode {
  return (
    <div
      className="b2b-card"
      style={{
        padding: 16,
        background: 'var(--surface-muted)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div className="b2b-row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Users size={18} style={{ color: 'var(--fg-muted)', marginTop: 2 }} />
        <div className="b2b-grow">
          <div style={{ fontSize: 13, fontWeight: 600 }}>Assignments</div>
          <div className="b2b-help" style={{ marginTop: 4 }}>
            Customer groups, organizations, and sales channels assigned to this price list will
            appear here. The assignment editor ships in the same iteration as the rules grid.
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  list,
  onSave,
}: {
  list: AdminPriceList;
  onSave: (input: {
    code: string;
    name: string;
    currency: string;
    isDefault: boolean;
    priority: number;
  }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(list.name);
  const [currency, setCurrency] = useState(list.currency);
  const [priority, setPriority] = useState(String(list.priority));
  const [isDefault, setIsDefault] = useState(list.isDefault);
  const [submitting, setSubmitting] = useState(false);

  const handle = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await onSave({
        code: list.code,
        name,
        currency,
        isDefault,
        priority: Number(priority),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-col" style={{ gap: 14 }}>
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="set-name">Display name</label>
          <input
            id="set-name"
            className="b2b-field"
            value={name}
            onChange={(e): void => setName(e.target.value)}
          />
        </div>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="set-code">Code</label>
          <input
            id="set-code"
            className="b2b-field b2b-field--mono"
            value={list.code}
            disabled
          />
          <div className="b2b-help">Code is the URL slug — immutable.</div>
        </div>
      </div>
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="set-cur">Currency</label>
          <input
            id="set-cur"
            className="b2b-field b2b-field--mono"
            maxLength={3}
            value={currency}
            onChange={(e): void => setCurrency(e.target.value.toUpperCase())}
          />
        </div>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="set-prio">Priority</label>
          <input
            id="set-prio"
            className="b2b-field"
            type="number"
            value={priority}
            onChange={(e): void => setPriority(e.target.value)}
          />
          <div className="b2b-help">
            Higher priority lists win when multiple match the customer.
          </div>
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
      <div className="b2b-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary"
          disabled={submitting}
          onClick={(): void => {
            void handle();
          }}
        >
          <Save size={14} /> {submitting ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
