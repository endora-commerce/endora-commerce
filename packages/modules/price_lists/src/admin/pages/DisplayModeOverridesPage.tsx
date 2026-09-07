import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  Eye,
  EyeOff,
  Filter,
  Save,
  Search,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import type { DisplayMode } from '@endora-commerce/contracts';
import { ApiError, apiClient, normalize } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
type Scope = 'organization' | 'category' | 'product';

interface DisplayModeOverrideRow {
  scope: Scope;
  targetId: string;
  mode: DisplayMode;
  updatedAt: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  taxId: string;
}
interface CategoryRow {
  id: string;
  slug: string;
  name: string;
}
interface ProductRow {
  id: string;
  sku: string;
  name: string;
}


/**
 * Display-mode overrides + pricing settings (US7 / T087 + T088).
 *
 * Single admin landing page with:
 *   - The two `pricing.*` settings keys at the top, edited inline.
 *   - A scope tab strip and a table per scope of every override on
 *     the platform; rows can be edited (mode dropdown) or removed
 *     (revert to "inherit" via PUT { mode: 'inherit' }).
 *   - An "Add override" button that picks an organization / category
 *     / product (depending on the active scope) and lets the operator
 *     set the initial mode.
 *
 * The settings keys come from the existing settings module
 * (`/api/v1/admin/settings/<code>`); the override endpoints live under
 * `/api/v1/admin/pricing/display-mode-overrides`.
 */
export function DisplayModeOverridesPage(): ReactNode {
  const t = useTranslation('core');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const SCOPE_LABEL: Record<Scope, string> = {
    organization: t('priceLists.displayModes.scope.organization'),
    category: t('priceLists.displayModes.scope.category'),
    product: t('priceLists.displayModes.scope.product'),
  };
  const [scope, setScope] = useState<Scope>('organization');
  const [overrides, setOverrides] = useState<DisplayModeOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [orgs, setOrgs] = useState<Record<string, OrganizationRow>>({});
  const [cats, setCats] = useState<Record<string, CategoryRow>>({});
  const [products, setProducts] = useState<Record<string, ProductRow>>({});

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: { items: DisplayModeOverrideRow[] } }>(
        `/api/v1/admin/pricing/display-mode-overrides?scope=${scope}`,
      );
      setOverrides(res.data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.load'));
    } finally {
      setLoading(false);
    }
  }, [scope, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Eagerly load name dictionaries the first time the page is opened so the
  // table can render labels instead of bare UUIDs. Each lookup endpoint is
  // already paginated/bounded — these are admin-side dictionaries.
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [orgsRes, catsRes, prodRes] = await Promise.all([
          apiClient.get<{ data: { items: OrganizationRow[] } }>(
            '/api/v1/admin/pricing/rule-targets/organizations?limit=200',
          ),
          apiClient.get<{ data: { items: CategoryRow[] } }>(
            '/api/v1/admin/pricing/rule-targets/categories',
          ),
          apiClient.get<{ data: ProductRow[] }>('/api/v1/admin/catalog/products'),
        ]);
        setOrgs(Object.fromEntries(orgsRes.data.items.map((o) => [o.id, o])));
        setCats(Object.fromEntries(catsRes.data.items.map((c) => [c.id, c])));
        setProducts(Object.fromEntries(prodRes.data.map((p) => [p.id, p])));
      } catch {
        // dictionaries are decorative — table still renders raw IDs on failure
      }
    })();
  }, []);

  const labelFor = (row: DisplayModeOverrideRow): string => {
    if (row.scope === 'organization') return orgs[row.targetId]?.name ?? row.targetId;
    if (row.scope === 'category') return cats[row.targetId]?.name ?? row.targetId;
    return products[row.targetId]?.name ?? row.targetId;
  };

  const subtitleFor = (row: DisplayModeOverrideRow): string => {
    if (row.scope === 'organization') return orgs[row.targetId]?.taxId ?? '';
    if (row.scope === 'category') return cats[row.targetId]?.slug ?? '';
    return products[row.targetId]?.sku ?? '';
  };

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (q === '') return overrides;
    return overrides.filter((row) => {
      const label = normalize(labelFor(row));
      const subtitle = normalize(subtitleFor(row));
      return label.includes(q) || subtitle.includes(q) || normalize(row.targetId).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, search, orgs, cats, products]);

  const handleUpsert = async (
    targetId: string,
    mode: DisplayMode | 'inherit',
  ): Promise<void> => {
    setError(null);
    try {
      await apiClient.put(
        `/api/v1/admin/pricing/display-mode-overrides/${scope}/${encodeURIComponent(targetId)}`,
        { mode },
      );
      setInfo(mode === 'inherit' ? t('priceLists.displayModes.info.removed') : t('priceLists.displayModes.info.saved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.save'));
    }
  };

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <Link to="/price-lists" className="b2b-page-head__back">
            <ChevronLeft size={14} /> {t('priceLists.page.title')}
          </Link>
          <div className="b2b-page-head__title">{t('priceLists.displayModes.title')}</div>
          <div className="b2b-page-head__sub">
            {t('priceLists.displayModes.description')}
          </div>
        </div>
      </div>

      {info ? (
        <Banner kind="info" message={info} onDismiss={(): void => setInfo(null)} />
      ) : null}
      {error ? (
        <Banner kind="error" message={error} onDismiss={(): void => setError(null)} />
      ) : null}

      <PricingSettingsCard onError={setError} onInfo={setInfo} />

      <div className="b2b-card" style={{ marginTop: 16 }}>
        <div
          className="b2b-row"
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {(['organization', 'category', 'product'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="b2b-btn b2b-btn--sm"
              onClick={(): void => setScope(s)}
              style={{
                background: scope === s ? 'var(--primary-color)' : 'transparent',
                color: scope === s ? '#fff' : 'var(--fg-default)',
                border: `1px solid ${scope === s ? 'var(--primary-color)' : 'var(--border-color)'}`,
              }}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
          <div className="b2b-grow" />
          <div className="b2b-input-wrap" style={{ width: 240 }}>
            <Search size={14} className="lead" />
            <input
              className="b2b-field b2b-field--addon"
              placeholder={t('priceLists.displayModes.searchPlaceholder', { scope: SCOPE_LABEL[scope].toLowerCase() })}
              value={search}
              onChange={(e): void => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary b2b-btn--sm"
            onClick={(): void => setPicker(true)}
          >
            <Filter size={12} /> {t('priceLists.displayModes.addOverride')}
          </button>
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('priceLists.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon">
                <Eye size={20} />
              </div>
              <div className="b2b-empty__title">
                {search.trim()
                  ? t('priceLists.displayModes.empty.filtered', { scope: SCOPE_LABEL[scope].toLowerCase() })
                  : t('priceLists.displayModes.empty.none', { scope: SCOPE_LABEL[scope].toLowerCase() })}
              </div>
              <div className="b2b-empty__sub">
                {t('priceLists.displayModes.empty.subtitle')}
              </div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{SCOPE_LABEL[scope]}</th>
                  <th>{t('priceLists.displayModes.column.mode')}</th>
                  <th>{t('priceLists.displayModes.column.updated')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.targetId}>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{labelFor(row)}</div>
                      <div className="b2b-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                        {subtitleFor(row) || row.targetId.slice(0, 8)}
                      </div>
                    </td>
                    <td>
                      <select
                        className="b2b-field"
                        value={row.mode}
                        onChange={(e): void => {
                          void handleUpsert(row.targetId, e.target.value as DisplayMode);
                        }}
                      >
                        {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {new Date(row.updatedAt).toLocaleString()}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                        style={{ color: 'hsl(8 80% 50%)' }}
                        onClick={(): void => {
                          void handleUpsert(row.targetId, 'inherit');
                        }}
                      >
                        <Trash2 size={12} /> {t('priceLists.displayModes.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {picker ? (
        <AddOverrideDialog
          scope={scope}
          existing={new Set(overrides.map((o) => o.targetId))}
          orgs={orgs}
          cats={cats}
          products={products}
          onClose={(): void => setPicker(false)}
          onPick={(targetId, mode): void => {
            setPicker(false);
            void handleUpsert(targetId, mode);
          }}
        />
      ) : null}
    </div>
  );
}

function PricingSettingsCard({
  onError,
  onInfo,
}: {
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const [defaultMode, setDefaultMode] = useState<DisplayMode>('gross_only');
  const [unauthMode, setUnauthMode] = useState<DisplayMode>('gross_only');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [a, b] = await Promise.all([
          apiClient.get<{ defaultValue: DisplayMode }>(
            '/api/v1/admin/settings/pricing.default_display_mode',
          ),
          apiClient.get<{ defaultValue: DisplayMode }>(
            '/api/v1/admin/settings/pricing.unauthenticated_display_mode',
          ),
        ]);
        if (a.defaultValue) setDefaultMode(a.defaultValue);
        if (b.defaultValue) setUnauthMode(b.defaultValue);
      } catch {
        // ignore — leave defaults; the operator can still write
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (key: string, value: DisplayMode): Promise<void> => {
    setSavingKey(key);
    try {
      await apiClient.put(`/api/v1/admin/settings/${encodeURIComponent(key)}/value`, {
        scope: 'all',
        value,
      });
      onInfo(t('priceLists.displayModes.settings.info.saved'));
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.save'));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="b2b-card" style={{ padding: 16 }}>
      <div
        className="b2b-row"
        style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <SettingsIcon size={14} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t('priceLists.displayModes.settings.title')}</div>
        <span className="b2b-help">{t('priceLists.displayModes.settings.subtitle')}</span>
      </div>
      {loading ? (
        <div className="b2b-help">{t('priceLists.loading')}</div>
      ) : (
        <div className="b2b-row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="b2b-grow">
            <label className="b2b-label" htmlFor="pl-default-display">
              {t('priceLists.displayModes.settings.defaultLabel')}
            </label>
            <select
              id="pl-default-display"
              className="b2b-field"
              value={defaultMode}
              onChange={(e): void => {
                const v = e.target.value as DisplayMode;
                setDefaultMode(v);
                void save('pricing.default_display_mode', v);
              }}
              disabled={savingKey === 'pricing.default_display_mode'}
            >
              {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="b2b-grow">
            <label className="b2b-label" htmlFor="pl-unauth-display">
              {t('priceLists.displayModes.settings.unauthLabel')}
            </label>
            <select
              id="pl-unauth-display"
              className="b2b-field"
              value={unauthMode}
              onChange={(e): void => {
                const v = e.target.value as DisplayMode;
                setUnauthMode(v);
                void save('pricing.unauthenticated_display_mode', v);
              }}
              disabled={savingKey === 'pricing.unauthenticated_display_mode'}
            >
              {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
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
      <button type="button" className="b2b-btn b2b-btn--ghost b2b-btn--sm" onClick={onDismiss}>
        {t('priceLists.dismiss')}
      </button>
    </div>
  );
}

function AddOverrideDialog(props: {
  scope: Scope;
  existing: Set<string>;
  orgs: Record<string, OrganizationRow>;
  cats: Record<string, CategoryRow>;
  products: Record<string, ProductRow>;
  onClose: () => void;
  onPick: (targetId: string, mode: DisplayMode) => void;
}): ReactNode {
  const t = useTranslation('core');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const SCOPE_LABEL: Record<Scope, string> = {
    organization: t('priceLists.displayModes.scope.organization'),
    category: t('priceLists.displayModes.scope.category'),
    product: t('priceLists.displayModes.scope.product'),
  };
  const { scope, existing, orgs, cats, products, onClose, onPick } = props;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<DisplayMode>('gross_only');

  const candidates: { id: string; label: string; subtitle: string }[] = useMemo(() => {
    const rows: { id: string; label: string; subtitle: string }[] = [];
    if (scope === 'organization') {
      for (const o of Object.values(orgs)) rows.push({ id: o.id, label: o.name, subtitle: o.taxId });
    } else if (scope === 'category') {
      for (const c of Object.values(cats)) rows.push({ id: c.id, label: c.name, subtitle: c.slug });
    } else {
      for (const p of Object.values(products)) rows.push({ id: p.id, label: p.name, subtitle: p.sku });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    const q = normalize(search);
    if (q === '') return rows.filter((r) => !existing.has(r.id));
    return rows.filter(
      (r) =>
        !existing.has(r.id) &&
        (normalize(r.label).includes(q) || normalize(r.subtitle).includes(q)),
    );
  }, [scope, orgs, cats, products, existing, search]);

  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <aside className="b2b-drawer" role="dialog" aria-modal="true">
        <div className="b2b-drawer__head">
          <div className="b2b-drawer__title">{t('priceLists.displayModes.addDialog.title')}</div>
          <div className="b2b-card__sub">
            {t('priceLists.displayModes.addDialog.subtitle', { scope: SCOPE_LABEL[scope].toLowerCase() })}
          </div>
        </div>
        <div className="b2b-drawer__body">
          <div className="b2b-input-wrap" style={{ marginBottom: 8 }}>
            <Search size={14} className="lead" />
            <input
              autoFocus
              className="b2b-field b2b-field--addon"
              placeholder={t('priceLists.displayModes.searchPlaceholder', { scope: SCOPE_LABEL[scope].toLowerCase() })}
              value={search}
              onChange={(e): void => setSearch(e.target.value)}
            />
          </div>
          {candidates.length === 0 ? (
            <div className="b2b-help">{t('priceLists.displayModes.addDialog.noMore', { scope: SCOPE_LABEL[scope].toLowerCase() })}</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 320, overflow: 'auto' }}>
              {candidates.slice(0, 200).map((c) => (
                <li
                  key={c.id}
                  onClick={(): void => setPicked(c.id)}
                  style={{
                    padding: '6px 8px',
                    cursor: 'pointer',
                    background: picked === c.id ? 'var(--primary-soft)' : 'transparent',
                    borderLeft: picked === c.id ? '3px solid var(--primary-color)' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                  <div className="b2b-mono" style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                    {c.subtitle}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 14 }}>
            <label className="b2b-label" htmlFor="ov-mode">{t('priceLists.displayModes.addDialog.modeLabel')}</label>
            <select
              id="ov-mode"
              className="b2b-field"
              value={mode}
              onChange={(e): void => setMode(e.target.value as DisplayMode)}
            >
              {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
            {mode === 'none' ? (
              <div
                className="b2b-help"
                style={{ marginTop: 4, color: 'hsl(217 70% 30%)', display: 'flex', gap: 4, alignItems: 'center' }}
              >
                <EyeOff size={12} /> {t('priceLists.displayModes.addDialog.noneHint')}
              </div>
            ) : null}
          </div>
        </div>
        <div className="b2b-drawer__foot">
          <button type="button" className="b2b-btn b2b-btn--ghost" onClick={onClose}>
            {t('priceLists.displayModes.addDialog.cancel')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            disabled={!picked}
            onClick={(): void => {
              if (picked) onPick(picked, mode);
            }}
          >
            <Save size={13} /> {t('priceLists.displayModes.addDialog.save')}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default DisplayModeOverridesPage;
