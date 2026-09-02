import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Calendar,
  CircleDollarSign,
  Eye,
  Lock,
  Plus,
  Search,
  Star,
  Tag,
  Zap,
} from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
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

const STATUS_BADGE_CLASS: Record<PriceListStatus, string> = {
  draft: 'b2b-badge b2b-badge--outline',
  active: 'b2b-badge b2b-badge--success',
  scheduled: 'b2b-badge b2b-badge--info',
  expired: 'b2b-badge b2b-badge--muted',
};

/**
 * Price lists — feature 011 (engine) admin landing page.
 *
 * Lists every price list with status/type filter chips and a free-text
 * search. Clicking a row opens the editor; the seeded `Default` row is
 * marked with a lock icon and a "System" chip because protections in
 * `price-list-service.ts` refuse delete/state-change/rule-attach on it.
 */
export function PriceListsPage(): ReactNode {
  const t = useTranslation('core');
  const STATUS_LABEL: Record<PriceListStatus, string> = {
    draft: t('priceLists.status.draft'),
    active: t('priceLists.status.active'),
    scheduled: t('priceLists.status.scheduled'),
    expired: t('priceLists.status.expired'),
  };
  const TYPE_LABEL: Record<PriceListType, string> = {
    base: t('priceLists.type.base'),
    sale: t('priceLists.type.sale'),
  };
  const navigate = useNavigate();
  const [rows, setRows] = useState<PriceListEngineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<PriceListStatus>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<PriceListType>>(new Set());
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const s of statusFilter) params.append('status', s);
      for (const ty of typeFilter) params.append('type', ty);
      if (query.trim()) params.set('search', query.trim());
      const qs = params.toString();
      const res = await apiClient.get<{ data: { items: PriceListEngineRow[] } }>(
        `/api/v1/admin/price-lists-engine${qs ? `?${qs}` : ''}`,
      );
      setRows(res.data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.error.load'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, query, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      scheduled: rows.filter((r) => r.status === 'scheduled').length,
      sale: rows.filter((r) => r.type === 'sale').length,
    };
  }, [rows]);

  const handleCreate = useCallback(
    async (input: { name: string; type: PriceListType; startsAt: string | null; endsAt: string | null }): Promise<void> => {
      try {
        const res = await apiClient.post<{ data: PriceListEngineRow }>(
          '/api/v1/admin/price-lists-engine',
          input,
        );
        setInfo(t('priceLists.info.created', { name: res.data.name }));
        setCreating(false);
        navigate(`/price-lists/${res.data.id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.error.create'));
      }
    },
    [navigate, t],
  );

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('priceLists.page.title')}</div>
          <div className="b2b-page-head__sub">
            {t('priceLists.page.description')}
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <Link to="/price-lists/display-modes" className="b2b-btn b2b-btn--default">
            <Eye size={14} /> {t('priceLists.action.displayModes')}
          </Link>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(): void => setCreating(true)}
          >
            <Plus size={14} /> {t('priceLists.action.newPriceList')}
          </button>
        </div>
      </div>

      {error ? (
        <Banner kind="error" message={error} onDismiss={(): void => setError(null)} />
      ) : null}
      {info ? (
        <Banner kind="info" message={info} onDismiss={(): void => setInfo(null)} />
      ) : null}

      <div className="b2b-row" style={{ gap: 16, marginBottom: 16 }}>
        <Stat label={t('priceLists.stat.total')} value={String(stats.total)} />
        <Stat label={t('priceLists.stat.active')} value={String(stats.active)} />
        <Stat label={t('priceLists.stat.scheduled')} value={String(stats.scheduled)} />
        <Stat label={t('priceLists.stat.sale')} value={String(stats.sale)} />
      </div>

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder={t('priceLists.search.placeholder')}
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <FilterChip
            icon={<Zap size={12} />}
            label={t('priceLists.filter.status')}
            options={(['draft', 'active', 'scheduled', 'expired'] as const).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
            selected={statusFilter as Set<string>}
            onToggle={(value): void => {
              setStatusFilter((prev) => {
                const next = new Set(prev);
                const v = value as PriceListStatus;
                if (next.has(v)) next.delete(v);
                else next.add(v);
                return next;
              });
            }}
          />
          <FilterChip
            icon={<Tag size={12} />}
            label={t('priceLists.filter.type')}
            options={(['base', 'sale'] as const).map((ty) => ({ value: ty, label: TYPE_LABEL[ty] }))}
            selected={typeFilter as Set<string>}
            onToggle={(value): void => {
              setTypeFilter((prev) => {
                const next = new Set(prev);
                const v = value as PriceListType;
                if (next.has(v)) next.delete(v);
                else next.add(v);
                return next;
              });
            }}
          />
        </div>
        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('priceLists.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <CircleDollarSign size={20} />
              </div>
              <div className="b2b-empty__title">
                {query.trim() || statusFilter.size > 0 || typeFilter.size > 0
                  ? t('priceLists.empty.filtered')
                  : t('priceLists.empty.none')}
              </div>
              <div className="b2b-empty__sub">
                {t('priceLists.empty.subtitle')}
              </div>
              <button
                type="button"
                className="b2b-btn b2b-btn--primary"
                onClick={(): void => setCreating(true)}
              >
                <Plus size={14} /> {t('priceLists.action.newPriceList')}
              </button>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{t('priceLists.column.name')}</th>
                  <th>{t('priceLists.column.type')}</th>
                  <th>{t('priceLists.column.status')}</th>
                  <th>{t('priceLists.column.activeWindow')}</th>
                  <th>{t('priceLists.column.lastModified')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                            background: r.isSystem ? 'var(--primary-soft)' : 'var(--surface-sunken)',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          {r.isSystem ? (
                            <Star size={14} style={{ color: 'var(--primary-color)' }} />
                          ) : (
                            <CircleDollarSign size={14} style={{ color: 'var(--fg-muted)' }} />
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.name}</div>
                          {r.isSystem ? (
                            <span
                              className="b2b-badge b2b-badge--success"
                              style={{ marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <Lock size={10} /> {t('priceLists.systemBadge')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="b2b-badge b2b-badge--outline">{TYPE_LABEL[r.type]}</span>
                    </td>
                    <td>
                      <span className={STATUS_BADGE_CLASS[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={12} />
                        {formatRange(r.startsAt, r.endsAt, t)}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {formatDate(r.modifiedAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating ? (
        <CreateDrawer onClose={(): void => setCreating(false)} onSubmit={handleCreate} />
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

function Banner({
  kind,
  message,
  onDismiss,
}: {
  kind: 'error' | 'info';
  message: string;
  onDismiss: () => void;
}): ReactNode {
  const t = useTranslation('core');
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
      <button
        type="button"
        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
        onClick={onDismiss}
      >
        {t('priceLists.dismiss')}
      </button>
    </div>
  );
}

function FilterChip({
  icon,
  label,
  options,
  selected,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="b2b-filterchip"
        aria-expanded={open}
        onClick={(): void => setOpen((v) => !v)}
        style={selected.size > 0 ? { borderColor: 'var(--primary-color)' } : undefined}
      >
        {icon}
        <span>
          {label}
          {selected.size > 0 ? ` · ${selected.size}` : ''}
        </span>
      </button>
      {open ? (
        <div
          className="b2b-card"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 10,
            padding: 8,
            minWidth: 140,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {options.map((opt) => {
            const isOn = selected.has(opt.value);
            return (
              <label
                key={opt.value}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 6px', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  className="b2b-cbx"
                  checked={isOn}
                  onChange={(): void => onToggle(opt.value)}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CreateDrawer({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    type: PriceListType;
    startsAt: string | null;
    endsAt: string | null;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [name, setName] = useState('');
  const [type, setType] = useState<PriceListType>('base');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handle = async (): Promise<void> => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        type,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
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
            <div className="b2b-drawer__title">{t('priceLists.create.title')}</div>
            <div className="b2b-card__sub">
              {t('priceLists.create.description')}
            </div>
          </div>
        </div>
        <div className="b2b-drawer__body">
          <div className="b2b-col" style={{ gap: 14 }}>
            <div>
              <label className="b2b-label" htmlFor="pl-name">{t('priceLists.create.name')}</label>
              <input
                id="pl-name"
                className="b2b-field"
                value={name}
                onChange={(e): void => setName(e.target.value)}
                placeholder={t('priceLists.create.namePlaceholder')}
                required
              />
              <div className="b2b-help">{t('priceLists.create.nameHelp')}</div>
            </div>
            <div>
              <label className="b2b-label" htmlFor="pl-type">{t('priceLists.create.type')}</label>
              <select
                id="pl-type"
                className="b2b-field"
                value={type}
                onChange={(e): void => setType(e.target.value as PriceListType)}
              >
                <option value="base">{t('priceLists.create.typeBaseOption')}</option>
                <option value="sale">{t('priceLists.create.typeSaleOption')}</option>
              </select>
            </div>
            <div className="b2b-row" style={{ gap: 12 }}>
              <div className="b2b-grow">
                <label className="b2b-label" htmlFor="pl-starts">{t('priceLists.create.startsAt')}</label>
                <input
                  id="pl-starts"
                  className="b2b-field"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e): void => setStartsAt(e.target.value)}
                />
              </div>
              <div className="b2b-grow">
                <label className="b2b-label" htmlFor="pl-ends">{t('priceLists.create.endsAt')}</label>
                <input
                  id="pl-ends"
                  className="b2b-field"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e): void => setEndsAt(e.target.value)}
                />
              </div>
            </div>
            <div className="b2b-help">
              {t('priceLists.create.windowHint')}
            </div>
          </div>
        </div>
        <div className="b2b-drawer__foot">
          <button type="button" className="b2b-btn b2b-btn--ghost" onClick={onClose}>
            {t('priceLists.create.cancel')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            disabled={submitting || !name.trim()}
            onClick={(): void => {
              void handle();
            }}
          >
            {submitting ? t('priceLists.create.creating') : t('priceLists.create.submit')}
          </button>
        </div>
      </aside>
    </>
  );
}

function formatRange(startsAt: string | null, endsAt: string | null, t: (k: string) => string): string {
  if (!startsAt && !endsAt) return t('priceLists.window.always');
  const fmt = (s: string | null): string => (s ? new Date(s).toLocaleDateString() : '—');
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default PriceListsPage;
