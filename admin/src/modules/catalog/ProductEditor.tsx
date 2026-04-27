import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Admin Product editor (T089). Handles both create (`/catalog/products/new`)
 * and edit (`/catalog/products/:id`).
 *
 * Locale strategy: per-locale text fields are rendered for every locale
 * the seed catalogue surfaces (`en-US`, `pl-PL`); a future i18n config
 * call can drive this. For MVP we keep it static so the editor compiles
 * and ships even when a tenant hasn't yet configured locales.
 */

const LOCALES = ['en-US', 'pl-PL'] as const;
type Locale = (typeof LOCALES)[number];

const PRODUCT_TYPES = ['simple', 'configurable'] as const;
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;
const STATUSES = ['draft', 'active', 'archived'] as const;

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: 'simple' | 'configurable';
  status: 'draft' | 'active' | 'archived';
  name: Record<string, string>;
  description: Record<string, string>;
  visibility: 'public' | 'logged_in_only' | 'organization_restricted';
  attributeValues: Record<string, unknown>;
}

interface AdminCategory {
  id: string;
  name: Record<string, string>;
  slug: string;
}

export function ProductEditor(): ReactNode {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = params.id === 'new';
  const id = isNew ? null : params.id ?? null;

  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [sku, setSku] = useState('');
  const [type, setType] = useState<'simple' | 'configurable'>('simple');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [visibility, setVisibility] = useState<AdminProduct['visibility']>('public');
  const [name, setName] = useState<Record<Locale, string>>({ 'en-US': '', 'pl-PL': '' });
  const [description, setDescription] = useState<Record<Locale, string>>({
    'en-US': '',
    'pl-PL': '',
  });
  const [defaultPrice, setDefaultPrice] = useState<string>('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const cats = await apiClient.get<{ data: AdminCategory[] }>(
        '/api/v1/admin/catalog/categories',
      );
      setCategories(cats.data);
      if (id) {
        const res = await apiClient.get<{ data: AdminProduct }>(
          `/api/v1/admin/catalog/products/${id}`,
        );
        const p = res.data;
        setSku(p.sku);
        setType(p.type);
        setStatus(p.status);
        setVisibility(p.visibility);
        setName({
          'en-US': p.name['en-US'] ?? '',
          'pl-PL': p.name['pl-PL'] ?? '',
        });
        setDescription({
          'en-US': p.description['en-US'] ?? '',
          'pl-PL': p.description['pl-PL'] ?? '',
        });
        const price = (p.attributeValues['defaultPrice'] as number | undefined) ?? null;
        setDefaultPrice(price != null ? String(price) : '');
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
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      setError(null);
      setInfo(null);
      const trimmedName: Record<string, string> = {};
      const trimmedDescription: Record<string, string> = {};
      for (const l of LOCALES) {
        if (name[l]) trimmedName[l] = name[l];
        if (description[l]) trimmedDescription[l] = description[l];
      }
      if (Object.keys(trimmedName).length === 0) {
        setError('At least one locale name is required.');
        return;
      }
      const attributeValues: Record<string, unknown> = {};
      if (defaultPrice.trim()) {
        const v = Number(defaultPrice);
        if (!Number.isFinite(v) || v < 0) {
          setError('Default price must be a number ≥ 0.');
          return;
        }
        attributeValues['defaultPrice'] = v;
      }
      try {
        if (isNew) {
          const res = await apiClient.post<{ data: AdminProduct }>(
            '/api/v1/admin/catalog/products',
            {
              sku,
              type,
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
            },
          );
          navigate(`/catalog/products/${res.data.id}`);
        } else if (id) {
          await apiClient.patch<{ data: AdminProduct }>(
            `/api/v1/admin/catalog/products/${id}`,
            {
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
            },
          );
          setInfo('Saved.');
          await refresh();
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [isNew, id, sku, type, name, description, categoryIds, defaultPrice, visibility, navigate, refresh],
  );

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!id) return;
    if (!confirm('Archive this product? It will disappear from the storefront.')) return;
    try {
      await apiClient.delete<void>(`/api/v1/admin/catalog/products/${id}`);
      navigate('/catalog/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Archive failed.');
    }
  }, [id, navigate]);

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        label: `${c.name['en-US'] ?? c.slug} (${c.slug})`,
      })),
    [categories],
  );

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <form onSubmit={handleSave}>
      <header className="page-header">
        <div>
          <h1>{isNew ? 'New product' : `Edit ${sku}`}</h1>
          <p>
            <Link to="/catalog/products">← Back to list</Link>
          </p>
        </div>
        <div>
          <button className="btn btn--primary" type="submit">
            Save
          </button>{' '}
          {!isNew ? (
            <button className="btn btn--danger" type="button" onClick={(): void => void handleArchive()}>
              Archive
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Identity</h2>
        <div className="field">
          <label htmlFor="sku">SKU (immutable after creation)</label>
          <input
            id="sku"
            className="input"
            value={sku}
            onChange={(e): void => setSku(e.target.value)}
            disabled={!isNew}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="ptype">Type</label>
          <select
            id="ptype"
            className="input"
            value={type}
            onChange={(e): void => setType(e.target.value as 'simple' | 'configurable')}
            disabled={!isNew}
          >
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pstatus">Status</label>
          <select
            id="pstatus"
            className="input"
            value={status}
            onChange={(e): void => setStatus(e.target.value as AdminProduct['status'])}
            disabled
            title="Status changes are made via dedicated transitions; archive is the only action exposed here."
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pvis">Visibility</label>
          <select
            id="pvis"
            className="input"
            value={visibility}
            onChange={(e): void => setVisibility(e.target.value as AdminProduct['visibility'])}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Names + descriptions</h2>
        {LOCALES.map((l) => (
          <div key={l}>
            <div className="field">
              <label htmlFor={`name-${l}`}>Name [{l}]</label>
              <input
                id={`name-${l}`}
                className="input"
                value={name[l]}
                onChange={(e): void => setName((prev) => ({ ...prev, [l]: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor={`desc-${l}`}>Description [{l}]</label>
              <textarea
                id={`desc-${l}`}
                className="input"
                rows={3}
                value={description[l]}
                onChange={(e): void => setDescription((prev) => ({ ...prev, [l]: e.target.value }))}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Categories</h2>
        <select
          className="input"
          multiple
          value={categoryIds}
          onChange={(e): void => {
            const next: string[] = [];
            for (const opt of e.target.selectedOptions) next.push(opt.value);
            setCategoryIds(next);
          }}
          style={{ minHeight: 120 }}
        >
          {categoryOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="muted">Hold Ctrl / ⌘ to multi-select.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Pricing (default)</h2>
        <div className="field">
          <label htmlFor="dp">Default unit price</label>
          <input
            id="dp"
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={defaultPrice}
            onChange={(e): void => setDefaultPrice(e.target.value)}
          />
          <p className="muted">
            Stored as <code>attributeValues.defaultPrice</code>; price-list overrides take
            precedence at checkout.
          </p>
        </div>
      </div>
    </form>
  );
}
