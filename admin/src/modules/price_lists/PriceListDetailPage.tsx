import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  CircleDollarSign,
  Cog,
  Copy,
  Filter,
  Layers,
  Lock,
  Save,
  Star,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type PriceListType = 'base' | 'sale';
type PriceListStatus = 'draft' | 'active' | 'scheduled' | 'expired';

interface PriceListEngineRow {
  id: string;
  name: string;
  type: PriceListType;
  status: PriceListStatus;
  startsAt: string | null;
  endsAt: string | null;
  applicationRule: unknown;
  isSystem: boolean;
  modifiedAt: string;
  createdAt: string;
}

const STATUS_LABEL: Record<PriceListStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
};

const STATUS_BADGE_CLASS: Record<PriceListStatus, string> = {
  draft: 'b2b-badge b2b-badge--outline',
  active: 'b2b-badge b2b-badge--success',
  scheduled: 'b2b-badge b2b-badge--info',
  expired: 'b2b-badge b2b-badge--muted',
};

const TYPE_LABEL: Record<PriceListType, string> = {
  base: 'Base',
  sale: 'Sale',
};

type Tab = 'details' | 'products' | 'rule';

/**
 * Price list editor (feature 011 engine shape).
 *
 * Three tabs land in this iteration:
 *   - Details — name + type + dates + status + lifecycle actions.
 *   - Products / Brackets — currently a placeholder pointing at the
 *     follow-up `BracketGrid` task (T047/T048).
 *   - Application Rule — placeholder pointing at the follow-up
 *     `ApplicationRuleBuilder` task (T055/T056).
 *
 * The seeded `Default` list reads as `isSystem` and the lifecycle /
 * delete / rule edits are blocked by backend (FR-005, FR-006); the UI
 * disables those affordances so the operator never sees a 403 popup.
 */
export function PriceListDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = params.id ?? '';
  const [list, setList] = useState<PriceListEngineRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('details');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}`,
      );
      setList(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePatch = useCallback(
    async (patch: {
      name?: string;
      type?: PriceListType;
      startsAt?: string | null;
      endsAt?: string | null;
    }): Promise<void> => {
      try {
        const res = await apiClient.patch<{ data: PriceListEngineRow }>(
          `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}`,
          patch,
        );
        setList(res.data);
        setInfo('Saved.');
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [id],
  );

  const handleActivate = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/activate`,
        {},
      );
      setList(res.data);
      setInfo(`Status → ${STATUS_LABEL[res.data.status]}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Activate failed.');
    }
  }, [id]);

  const handleDraftify = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/draftify`,
        {},
      );
      setList(res.data);
      setInfo('Status → Draft.');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Draftify failed.');
    }
  }, [id]);

  const handleDuplicate = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/duplicate`,
        {},
      );
      navigate(`/price-lists/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Duplicate failed.');
    }
  }, [id, navigate]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!confirm('Delete this price list? This cannot be undone.')) return;
    try {
      await apiClient.delete<void>(
        `/api/v1/admin/price-lists/${encodeURIComponent(id)}`,
      );
      navigate('/price-lists');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
    }
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="b2b-page b2b-page--wide">
        <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!list) {
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
  }

  const lifecycleDisabled = list.isSystem;

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
          <div className="b2b-page-head__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {list.name}
            {list.isSystem ? (
              <span
                className="b2b-badge b2b-badge--success"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Lock size={11} /> System
              </span>
            ) : null}
            <span className={STATUS_BADGE_CLASS[list.status]}>{STATUS_LABEL[list.status]}</span>
            <span className="b2b-badge b2b-badge--outline">{TYPE_LABEL[list.type]}</span>
          </div>
          <div className="b2b-page-head__sub" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} />
              {formatRange(list.startsAt, list.endsAt)}
            </span>
            <span>Modified {formatDate(list.modifiedAt)}</span>
          </div>
        </div>
        <div className="b2b-page-head__actions" style={{ gap: 8 }}>
          {list.status === 'draft' || list.status === 'expired' ? (
            <button
              type="button"
              className="b2b-btn b2b-btn--primary b2b-btn--sm"
              disabled={lifecycleDisabled}
              title={lifecycleDisabled ? 'System list cannot change state.' : undefined}
              onClick={(): void => {
                void handleActivate();
              }}
            >
              <Zap size={13} /> Activate
            </button>
          ) : (
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              disabled={lifecycleDisabled}
              title={lifecycleDisabled ? 'System list cannot change state.' : undefined}
              onClick={(): void => {
                void handleDraftify();
              }}
            >
              <Star size={13} /> Move to draft
            </button>
          )}
          <button
            type="button"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            onClick={(): void => {
              void handleDuplicate();
            }}
          >
            <Copy size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--danger b2b-btn--sm"
            disabled={lifecycleDisabled}
            title={lifecycleDisabled ? 'System list cannot be deleted.' : undefined}
            onClick={(): void => {
              void handleDelete();
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      {info ? (
        <Banner kind="info" message={info} onDismiss={(): void => setInfo(null)} />
      ) : null}
      {error ? (
        <Banner kind="error" message={error} onDismiss={(): void => setError(null)} />
      ) : null}

      <div className="b2b-card">
        <div style={{ padding: '4px 4px 0' }}>
          <div className="b2b-tabs" role="tablist">
            <TabBtn id="details" label="Details" icon={<Cog size={14} />} active={tab} onChange={setTab} />
            <TabBtn id="products" label="Products & brackets" icon={<Layers size={14} />} active={tab} onChange={setTab} />
            <TabBtn id="rule" label="Application rule" icon={<Filter size={14} />} active={tab} onChange={setTab} />
          </div>
        </div>

        <div className="b2b-card__body">
          {tab === 'details' ? (
            <DetailsPanel list={list} onSave={handlePatch} disabled={list.isSystem} />
          ) : null}
          {tab === 'products' ? <ProductsPlaceholder /> : null}
          {tab === 'rule' ? <RulePlaceholder isSystem={list.isSystem} /> : null}
        </div>
      </div>
    </div>
  );
}

function TabBtn(props: {
  id: Tab;
  label: string;
  icon: ReactNode;
  active: Tab;
  onChange: (id: Tab) => void;
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

function Banner({
  kind,
  message,
  onDismiss,
}: {
  kind: 'error' | 'info';
  message: string;
  onDismiss: () => void;
}): ReactNode {
  const palette =
    kind === 'error'
      ? { bg: 'var(--danger-soft)', fg: 'var(--danger-soft-fg)', border: 'hsl(8 80% 85%)' }
      : { bg: 'var(--success-soft)', fg: 'var(--success-soft-fg)', border: 'hsl(142 50% 80%)' };
  return (
    <div
      className="b2b-card b2b-row"
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: 12,
        marginBottom: 16,
        border: `1px solid ${palette.border}`,
        gap: 8,
        alignItems: 'center',
      }}
    >
      <div className="b2b-grow">{message}</div>
      <button type="button" className="b2b-btn b2b-btn--ghost b2b-btn--sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function DetailsPanel({
  list,
  onSave,
  disabled,
}: {
  list: PriceListEngineRow;
  onSave: (patch: {
    name?: string;
    type?: PriceListType;
    startsAt?: string | null;
    endsAt?: string | null;
  }) => Promise<void>;
  disabled: boolean;
}): ReactNode {
  const [name, setName] = useState(list.name);
  const [type, setType] = useState<PriceListType>(list.type);
  const [startsAt, setStartsAt] = useState(toLocalInput(list.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(list.endsAt));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(list.name);
    setType(list.type);
    setStartsAt(toLocalInput(list.startsAt));
    setEndsAt(toLocalInput(list.endsAt));
  }, [list]);

  const dirty =
    name !== list.name ||
    type !== list.type ||
    toLocalInput(list.startsAt) !== startsAt ||
    toLocalInput(list.endsAt) !== endsAt;

  const handle = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await onSave({
        name,
        type,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-col" style={{ gap: 14 }}>
      {disabled ? (
        <div
          className="b2b-card b2b-row"
          style={{
            background: 'var(--info-soft)',
            color: 'var(--info-soft-fg)',
            padding: 12,
            border: '1px solid hsl(217 70% 88%)',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <Lock size={14} style={{ marginTop: 2 }} />
          <div>
            This is the seeded <strong>Default</strong> price list. Its name and type
            cannot be changed; lifecycle, delete, and rule edits are refused by the
            backend (FR-005, FR-006).
          </div>
        </div>
      ) : null}
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-name">Name</label>
          <input
            id="ed-name"
            className="b2b-field"
            value={name}
            disabled={disabled}
            onChange={(e): void => setName(e.target.value)}
          />
        </div>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-type">Type</label>
          <select
            id="ed-type"
            className="b2b-field"
            value={type}
            disabled={disabled}
            onChange={(e): void => setType(e.target.value as PriceListType)}
          >
            <option value="base">Base</option>
            <option value="sale">Sale</option>
          </select>
          <div className="b2b-help">
            Base lists replace the catalogue price; Sale lists render alongside the Base
            as a Special Price.
          </div>
        </div>
      </div>
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-starts">Starts at</label>
          <input
            id="ed-starts"
            className="b2b-field"
            type="datetime-local"
            value={startsAt}
            disabled={disabled}
            onChange={(e): void => setStartsAt(e.target.value)}
          />
        </div>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-ends">Ends at</label>
          <input
            id="ed-ends"
            className="b2b-field"
            type="datetime-local"
            value={endsAt}
            disabled={disabled}
            onChange={(e): void => setEndsAt(e.target.value)}
          />
        </div>
      </div>
      <div className="b2b-row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary"
          disabled={disabled || submitting || !dirty}
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

function ProductsPlaceholder(): ReactNode {
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
        <CircleDollarSign size={18} style={{ color: 'var(--info-soft-fg)', marginTop: 2 }} />
        <div className="b2b-grow">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--info-soft-fg)' }}>
            Products & brackets editor — coming next
          </div>
          <div style={{ fontSize: 12, color: 'var(--info-soft-fg)', marginTop: 4 }}>
            The per-product per-currency multi-bracket editor (BracketGrid) lands in
            the next admin iteration. The backend already serves
            <code> PUT /api/v1/admin/price-lists-engine/:id/products </code> and the
            per-product brackets endpoint, so existing rows are managed via the API or
            by the migration's seed.
          </div>
        </div>
      </div>
    </div>
  );
}

function RulePlaceholder({ isSystem }: { isSystem: boolean }): ReactNode {
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
          <div style={{ fontSize: 13, fontWeight: 600 }}>Application rule</div>
          <div className="b2b-help" style={{ marginTop: 4 }}>
            {isSystem
              ? 'The Default list always matches and cannot carry a rule (FR-005).'
              : 'The recursive Query/Rule Builder (Sales Channel / Customer Group / Organization / Category / Currency, AND/OR, depth-5) lands next. Until then, edit the rule directly via the PATCH endpoint.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRange(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return 'Always';
  const fmt = (s: string | null): string => (s ? new Date(s).toLocaleDateString() : '—');
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
