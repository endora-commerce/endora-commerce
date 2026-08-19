import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Calendar,
  ChevronLeft,
  Cog,
  Copy,
  Filter,
  Layers,
  Lock,
  Plus,
  Save,
  Search,
  Star,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ApplicationRule } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { BracketGrid, type BracketsByCurrency } from './BracketGrid';
import { ApplicationRuleBuilder } from './ApplicationRuleBuilder';
import { normalize } from '@/lib/text-normalization';

type PriceListType = 'base' | 'sale';
type PriceListStatus = 'draft' | 'active' | 'scheduled' | 'expired';

interface PriceListEngineRow {
  id: string;
  name: string;
  type: PriceListType;
  status: PriceListStatus;
  startsAt: string | null;
  endsAt: string | null;
  applicationRule: ApplicationRule;
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
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusProductId = searchParams.get('focus');
  const id = params.id ?? '';
  const [list, setList] = useState<PriceListEngineRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(focusProductId ? 'products' : 'details');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}`,
      );
      setList(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.load'));
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePatch = useCallback(
    async (patch: {
      name?: string;
      type?: PriceListType;
      startsAt?: string | null;
      endsAt?: string | null;
      applicationRule?: ApplicationRule;
    }): Promise<void> => {
      try {
        const res = await apiClient.patch<{ data: PriceListEngineRow }>(
          `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}`,
          patch,
        );
        setList(res.data);
        setInfo(t('priceLists.detail.info.saved'));
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.save'));
      }
    },
    [id, t],
  );

  const handleActivate = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/activate`,
        {},
      );
      setList(res.data);
      setInfo(t('priceLists.detail.info.statusChanged', { status: STATUS_LABEL[res.data.status] }));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.activate'));
    }
  }, [id, t, STATUS_LABEL]);

  const handleDraftify = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/draftify`,
        {},
      );
      setList(res.data);
      setInfo(t('priceLists.detail.info.statusDraft'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.draftify'));
    }
  }, [id, t]);

  const handleDuplicate = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: PriceListEngineRow }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}/duplicate`,
        {},
      );
      navigate(`/price-lists/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.duplicate'));
    }
  }, [id, navigate, t]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!confirm(t('priceLists.detail.confirmDelete'))) return;
    try {
      await apiClient.delete<void>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(id)}`,
      );
      navigate('/price-lists');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.error.delete'));
    }
  }, [id, navigate, t]);

  if (loading) {
    return (
      <div className="b2b-page b2b-page--wide">
        <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('priceLists.loading')}</div>
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
          <ChevronLeft size={14} /> {t('priceLists.page.title')}
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
          {error ?? t('priceLists.detail.notFound')}
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
            <ChevronLeft size={14} /> {t('priceLists.page.title')}
          </button>
          <div className="b2b-page-head__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {list.name}
            {list.isSystem ? (
              <span
                className="b2b-badge b2b-badge--success"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Lock size={11} /> {t('priceLists.systemBadge')}
              </span>
            ) : null}
            <span className={STATUS_BADGE_CLASS[list.status]}>{STATUS_LABEL[list.status]}</span>
            <span className="b2b-badge b2b-badge--outline">{TYPE_LABEL[list.type]}</span>
          </div>
          <div className="b2b-page-head__sub" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} />
              {formatRange(list.startsAt, list.endsAt, t)}
            </span>
            <span>{t('priceLists.detail.modifiedAt', { date: formatDate(list.modifiedAt) })}</span>
          </div>
        </div>
        <div className="b2b-page-head__actions" style={{ gap: 8 }}>
          {list.status === 'draft' || list.status === 'expired' ? (
            <button
              type="button"
              className="b2b-btn b2b-btn--primary b2b-btn--sm"
              disabled={lifecycleDisabled}
              title={lifecycleDisabled ? t('priceLists.detail.systemStateLocked') : undefined}
              onClick={(): void => {
                void handleActivate();
              }}
            >
              <Zap size={13} /> {t('priceLists.detail.activate')}
            </button>
          ) : (
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              disabled={lifecycleDisabled}
              title={lifecycleDisabled ? t('priceLists.detail.systemStateLocked') : undefined}
              onClick={(): void => {
                void handleDraftify();
              }}
            >
              <Star size={13} /> {t('priceLists.detail.moveToDraft')}
            </button>
          )}
          <button
            type="button"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            onClick={(): void => {
              void handleDuplicate();
            }}
          >
            <Copy size={13} /> {t('priceLists.detail.duplicate')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--danger b2b-btn--sm"
            disabled={lifecycleDisabled}
            title={lifecycleDisabled ? t('priceLists.detail.systemDeleteLocked') : undefined}
            onClick={(): void => {
              void handleDelete();
            }}
          >
            <Trash2 size={13} /> {t('priceLists.detail.delete')}
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
        <div style={{ padding: '4px 4px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
            <div className="b2b-tabs" role="tablist">
              <TabBtn id="details" label={t('priceLists.detail.tab.details')} icon={<Cog size={14} />} active={tab} onChange={setTab} />
              <TabBtn id="products" label={t('priceLists.detail.tab.products')} icon={<Layers size={14} />} active={tab} onChange={setTab} />
              <TabBtn id="rule" label={t('priceLists.detail.tab.rule')} icon={<Filter size={14} />} active={tab} onChange={setTab} />
            </div>
          </div>
        </div>

        <div className="b2b-card__body">
          {tab === 'details' ? (
            <DetailsPanel list={list} onSave={handlePatch} disabled={list.isSystem} />
          ) : null}
          {tab === 'products' ? (
            <ProductsAndBracketsPanel
              priceListId={list.id}
              systemList={list.isSystem}
              focusProductId={focusProductId}
            />
          ) : null}
          {tab === 'rule' ? (
            <ApplicationRulePanel
              rule={list.applicationRule}
              isSystem={list.isSystem}
              onSave={(next): Promise<void> => handlePatch({ applicationRule: next })}
            />
          ) : null}
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
      <button type="button" className="b2b-btn b2b-btn--ghost b2b-btn--sm" onClick={onDismiss}>
        {t('priceLists.dismiss')}
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
  const t = useTranslation('core');
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
            {t('priceLists.detail.systemNotice')}
          </div>
        </div>
      ) : null}
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-name">{t('priceLists.detail.field.name')}</label>
          <input
            id="ed-name"
            className="b2b-field"
            value={name}
            disabled={disabled}
            onChange={(e): void => setName(e.target.value)}
          />
        </div>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-type">{t('priceLists.detail.field.type')}</label>
          <select
            id="ed-type"
            className="b2b-field"
            value={type}
            disabled={disabled}
            onChange={(e): void => setType(e.target.value as PriceListType)}
          >
            <option value="base">{t('priceLists.type.base')}</option>
            <option value="sale">{t('priceLists.type.sale')}</option>
          </select>
          <div className="b2b-help">
            {t('priceLists.detail.field.typeHelp')}
          </div>
        </div>
      </div>
      <div className="b2b-row" style={{ gap: 12 }}>
        <div className="b2b-grow">
          <label className="b2b-label" htmlFor="ed-starts">{t('priceLists.detail.field.startsAt')}</label>
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
          <label className="b2b-label" htmlFor="ed-ends">{t('priceLists.detail.field.endsAt')}</label>
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
          <Save size={14} /> {submitting ? t('priceLists.detail.saving') : t('priceLists.detail.saveChanges')}
        </button>
      </div>
    </div>
  );
}

interface AdminProductSummary {
  id: string;
  sku: string;
  name: Record<string, string>;
}

function pickName(name: Record<string, string> | undefined | null, fallback = ''): string {
  if (!name) return fallback;
  return name['en-US'] ?? name['pl-PL'] ?? Object.values(name)[0] ?? fallback;
}

interface RosterEntry {
  productId: string;
  bracketsByCurrency: BracketsByCurrency;
}

function ProductsAndBracketsPanel({
  priceListId,
  systemList,
  focusProductId,
}: {
  priceListId: string;
  systemList: boolean;
  focusProductId?: string | null;
}): ReactNode {
  const t = useTranslation('core');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [products, setProducts] = useState<Record<string, AdminProductSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(focusProductId ?? null);
  const [picker, setPicker] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [rosterRes, productsRes] = await Promise.all([
        apiClient.get<{ data: { items: RosterEntry[] } }>(
          `/api/v1/admin/price-lists-engine/${encodeURIComponent(priceListId)}/products`,
        ),
        apiClient.get<{ data: AdminProductSummary[] }>('/api/v1/admin/catalog/products'),
      ]);
      setRoster(rosterRes.data.items);
      const map: Record<string, AdminProductSummary> = {};
      for (const p of productsRes.data) map[p.id] = p;
      setProducts(map);
      // Honour ?focus=<productId> first if it points at an actual roster row.
      const focused = focusProductId
        ? rosterRes.data.items.find((e) => e.productId === focusProductId)
        : null;
      if (focused) {
        setSelectedId(focused.productId);
      } else if (
        rosterRes.data.items.length > 0 &&
        !rosterRes.data.items.some((e) => e.productId === selectedId)
      ) {
        setSelectedId(rosterRes.data.items[0]!.productId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.products.error.load'));
    } finally {
      setLoading(false);
    }
  }, [priceListId, selectedId, focusProductId, t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceListId]);

  const handleAddProduct = async (productId: string): Promise<void> => {
    try {
      await apiClient.post(`/api/v1/admin/price-lists-engine/${encodeURIComponent(priceListId)}/products`, {
        productId,
      });
      setPicker(false);
      setSelectedId(productId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.products.error.add'));
    }
  };

  const handleRemoveProduct = async (productId: string): Promise<void> => {
    if (!confirm(t('priceLists.detail.products.confirmRemove'))) return;
    try {
      await apiClient.delete(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(priceListId)}/products/${encodeURIComponent(productId)}`,
      );
      if (selectedId === productId) setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.products.error.remove'));
    }
  };

  const handleBracketsSaved = (productId: string, next: BracketsByCurrency): void => {
    setRoster((prev) =>
      prev.map((e) => (e.productId === productId ? { ...e, bracketsByCurrency: next } : e)),
    );
  };

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>{t('priceLists.loading')}</div>;
  }

  const selected = roster.find((e) => e.productId === selectedId) ?? null;
  const selectedProduct = selected ? products[selected.productId] : null;

  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      {error ? (
        <div
          style={{
            padding: 8,
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            borderRadius: 6,
            border: '1px solid hsl(8 80% 85%)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
      {systemList ? (
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
            {t('priceLists.detail.products.systemNotice')}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'flex-start' }}>
        <div className="b2b-card" style={{ padding: 0 }}>
          <div
            className="b2b-row"
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-color)',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <div className="b2b-grow" style={{ fontSize: 12, fontWeight: 600 }}>
              {t('priceLists.detail.products.title', { count: roster.length })}
            </div>
            <button
              type="button"
              className="b2b-btn b2b-btn--primary b2b-btn--sm"
              disabled={systemList}
              onClick={(): void => setPicker(true)}
            >
              <Plus size={12} /> {t('priceLists.detail.products.add')}
            </button>
          </div>
          {roster.length === 0 ? (
            <div className="b2b-help" style={{ padding: 16 }}>
              {t('priceLists.detail.products.empty')}
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 480, overflow: 'auto' }}>
              {roster.map((e) => {
                const product = products[e.productId];
                const isSelected = e.productId === selectedId;
                const currencyCount = Object.keys(e.bracketsByCurrency).length;
                return (
                  <li
                    key={e.productId}
                    onClick={(): void => setSelectedId(e.productId)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-color)',
                      background: isSelected ? 'var(--primary-soft)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--primary-color)' : '3px solid transparent',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 500 }}>
                      {product ? pickName(product.name, e.productId.slice(0, 8)) : e.productId.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <span className="b2b-mono">{product?.sku ?? '—'}</span>
                      <span>{currencyCount === 0 ? t('priceLists.detail.products.noPrices') : t('priceLists.detail.products.currencyCount', { count: currencyCount })}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {selected && selectedProduct ? (
            <BracketGrid
              priceListId={priceListId}
              productId={selected.productId}
              productName={pickName(selectedProduct.name, selected.productId.slice(0, 8))}
              initial={selected.bracketsByCurrency}
              systemList={systemList}
              onSaved={(next): void => handleBracketsSaved(selected.productId, next)}
            />
          ) : selectedId ? (
            <div className="b2b-help" style={{ padding: 16 }}>
              {t('priceLists.detail.products.loadingProduct')}
            </div>
          ) : (
            <div className="b2b-help" style={{ padding: 16 }}>
              {t('priceLists.detail.products.selectHint')}
            </div>
          )}
          {selected && !systemList ? (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button
                type="button"
                className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                style={{ color: 'hsl(8 80% 50%)' }}
                onClick={(): void => {
                  void handleRemoveProduct(selected.productId);
                }}
              >
                <Trash2 size={12} /> {t('priceLists.detail.products.removeFromList')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {picker ? (
        <ProductPickerDialog
          existing={new Set(roster.map((e) => e.productId))}
          onClose={(): void => setPicker(false)}
          onPick={(id): void => {
            void handleAddProduct(id);
          }}
        />
      ) : null}
    </div>
  );
}

function ProductPickerDialog({
  existing,
  onClose,
  onPick,
}: {
  existing: Set<string>;
  onClose: () => void;
  onPick: (productId: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [products, setProducts] = useState<AdminProductSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ data: AdminProductSummary[] }>('/api/v1/admin/catalog/products')
      .then((res) => setProducts(res.data))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.detail.picker.error.load'));
      })
      .finally(() => setLoading(false));
  }, [t]);

  const candidates = products.filter((p) => {
    if (existing.has(p.id)) return false;
    const q = normalize(query);
    if (q === '') return true;
    return normalize(pickName(p.name)).includes(q) || normalize(p.sku).includes(q);
  });

  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <aside className="b2b-drawer" role="dialog" aria-modal="true">
        <div className="b2b-drawer__head">
          <div className="b2b-drawer__title">{t('priceLists.detail.picker.title')}</div>
          <div className="b2b-card__sub">
            {t('priceLists.detail.picker.subtitle')}
          </div>
        </div>
        <div className="b2b-drawer__body">
          <div className="b2b-input-wrap" style={{ marginBottom: 12 }}>
            <Search size={14} className="lead" />
            <input
              autoFocus
              className="b2b-field b2b-field--addon"
              placeholder={t('priceLists.detail.picker.searchPlaceholder')}
              value={query}
              onChange={(e): void => setQuery(e.target.value)}
            />
          </div>
          {error ? (
            <div className="b2b-help" style={{ color: 'hsl(8 80% 40%)' }}>
              {error}
            </div>
          ) : loading ? (
            <div className="b2b-help">{t('priceLists.loading')}</div>
          ) : candidates.length === 0 ? (
            <div className="b2b-help">{t('priceLists.detail.picker.empty')}</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 380, overflow: 'auto' }}>
              {candidates.slice(0, 100).map((p) => (
                <li
                  key={p.id}
                  onClick={(): void => onPick(p.id)}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{pickName(p.name, p.sku)}</div>
                  <div className="b2b-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {p.sku}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="b2b-drawer__foot">
          <button type="button" className="b2b-btn b2b-btn--ghost" onClick={onClose}>
            {t('priceLists.detail.picker.cancel')}
          </button>
        </div>
      </aside>
    </>
  );
}

function ApplicationRulePanel({
  rule,
  isSystem,
  onSave,
}: {
  rule: ApplicationRule;
  isSystem: boolean;
  onSave: (next: ApplicationRule) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [draft, setDraft] = useState<ApplicationRule>(rule);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rule);
  }, [rule]);

  const dirty = JSON.stringify(rule) !== JSON.stringify(draft);

  const handle = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await onSave(draft);
      setInfo(t('priceLists.detail.info.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('priceLists.detail.error.save'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isSystem) {
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
          <Lock size={18} style={{ color: 'var(--fg-muted)', marginTop: 2 }} />
          <div className="b2b-grow">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t('priceLists.detail.rule.title')}</div>
            <div className="b2b-help" style={{ marginTop: 4 }}>
              {t('priceLists.detail.rule.systemNotice')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      {info ? (
        <div
          style={{
            padding: 8,
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            borderRadius: 6,
            border: '1px solid hsl(142 50% 80%)',
            fontSize: 12,
          }}
        >
          {info}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            padding: 8,
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            borderRadius: 6,
            border: '1px solid hsl(8 80% 85%)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
      <ApplicationRuleBuilder value={draft} onChange={setDraft} />
      <div className="b2b-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--ghost b2b-btn--sm"
          disabled={!dirty || submitting}
          onClick={(): void => setDraft(rule)}
        >
          {t('priceLists.detail.rule.discard')}
        </button>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary b2b-btn--sm"
          disabled={!dirty || submitting}
          onClick={(): void => {
            void handle();
          }}
        >
          <Save size={13} /> {submitting ? t('priceLists.detail.saving') : t('priceLists.detail.rule.save')}
        </button>
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

function formatRange(startsAt: string | null, endsAt: string | null, t: (k: string) => string): string {
  if (!startsAt && !endsAt) return t('priceLists.window.always');
  const fmt = (s: string | null): string => (s ? new Date(s).toLocaleDateString() : '—');
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
