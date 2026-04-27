import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  ResolvedMeta,
  SeoEntityType,
  SitemapStatus,
  UpsertSeoMetaOverrideRequest,
} from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

interface SitemapStatusEnvelope {
  data: SitemapStatus;
}

interface RegenerateEnvelope {
  data: { generatedAt: string; urlCount: number; byteSize: number };
}

interface MetaEnvelope {
  data: {
    resolved: ResolvedMeta;
    override: {
      title: string | null;
      description: string | null;
      ogTitle: string | null;
      ogDescription: string | null;
      ogImageUrl: string | null;
    } | null;
  };
}

const ENTITY_TYPES: SeoEntityType[] = ['product', 'category'];

export function SeoPage(): ReactNode {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>SEO</h1>
          <p>Sitemap regeneration and per-page meta-tag overrides.</p>
        </div>
      </header>

      <SitemapCard />
      <MetaEditorCard />
    </>
  );
}

function SitemapCard(): ReactNode {
  const [status, setStatus] = useState<SitemapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await apiClient.get<SitemapStatusEnvelope>('/api/v1/admin/seo/sitemap/status');
      setStatus(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await apiClient.post<RegenerateEnvelope>(
        '/api/v1/admin/seo/sitemap/regenerate',
      );
      setMessage(
        `Regenerated — ${res.data.urlCount} URLs (${formatBytes(res.data.byteSize)}).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Regenerate failed.');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Sitemap</h2>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? <div className="alert alert--success">{message}</div> : null}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table" style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <th>Last generated</th>
              <td>{formatDateTime(status?.generatedAt ?? null)}</td>
            </tr>
            <tr>
              <th>URL count</th>
              <td>{status?.urlCount?.toLocaleString() ?? '—'}</td>
            </tr>
            <tr>
              <th>Size</th>
              <td>{status?.byteSize ? formatBytes(status.byteSize) : '—'}</td>
            </tr>
          </tbody>
        </table>
      )}
      <button
        className="btn btn--primary"
        disabled={busy}
        onClick={(): void => {
          void regenerate();
        }}
      >
        {busy ? 'Regenerating…' : 'Regenerate sitemap'}
      </button>
    </div>
  );
}

function MetaEditorCard(): ReactNode {
  const [entityType, setEntityType] = useState<SeoEntityType>('product');
  const [entityId, setEntityId] = useState('');
  const [locale, setLocale] = useState('en-US');
  const [meta, setMeta] = useState<MetaEnvelope['data'] | null>(null);
  const [draft, setDraft] = useState<UpsertSeoMetaOverrideRequest>({
    locale: 'en-US',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!entityId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiClient.get<MetaEnvelope>(
        `/api/v1/admin/seo/meta/${entityType}/${entityId}?locale=${encodeURIComponent(locale)}`,
      );
      setMeta(res.data);
      setDraft({
        locale,
        title: res.data.override?.title ?? null,
        description: res.data.override?.description ?? null,
        ogTitle: res.data.override?.ogTitle ?? null,
        ogDescription: res.data.override?.ogDescription ?? null,
        ogImageUrl: res.data.override?.ogImageUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load meta.');
      setMeta(null);
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, locale]);

  const save = useCallback(async (): Promise<void> => {
    if (!entityId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.put(`/api/v1/admin/seo/meta/${entityType}/${entityId}`, draft);
      setMessage('Override saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, draft, load]);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Meta-tag overrides</h2>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? <div className="alert alert--success">{message}</div> : null}

      <div className="toolbar">
        <select
          className="select"
          style={{ width: 'auto' }}
          value={entityType}
          onChange={(e): void => setEntityType(e.target.value as SeoEntityType)}
        >
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ width: 320 }}
          value={entityId}
          onChange={(e): void => setEntityId(e.target.value)}
          placeholder="Entity UUID"
        />
        <input
          className="input"
          style={{ width: 96 }}
          value={locale}
          onChange={(e): void => setLocale(e.target.value)}
          placeholder="locale"
        />
        <button
          className="btn"
          onClick={(): void => {
            void load();
          }}
          disabled={busy || !entityId.trim()}
        >
          Load
        </button>
      </div>

      {meta ? (
        <>
          <div className="card" style={{ background: 'var(--color-bg)' }}>
            <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>
              Resolved (source: {meta.resolved.source})
            </h3>
            <table className="table">
              <tbody>
                <tr>
                  <th style={{ width: 160 }}>Title</th>
                  <td>{meta.resolved.title}</td>
                </tr>
                <tr>
                  <th>Description</th>
                  <td>{meta.resolved.description}</td>
                </tr>
                <tr>
                  <th>OG title</th>
                  <td>{meta.resolved.openGraph.title}</td>
                </tr>
                <tr>
                  <th>OG description</th>
                  <td>{meta.resolved.openGraph.description}</td>
                </tr>
                <tr>
                  <th>OG image</th>
                  <td className="code">{meta.resolved.openGraph.image ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: '0.95rem' }}>Override (leave blank to fall back to rule)</h3>
          <div className="field">
            <label>Title</label>
            <input
              className="input"
              value={draft.title ?? ''}
              onChange={(e): void => setDraft((d) => ({ ...d, title: e.target.value || null }))}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <input
              className="input"
              value={draft.description ?? ''}
              onChange={(e): void =>
                setDraft((d) => ({ ...d, description: e.target.value || null }))
              }
            />
          </div>
          <div className="field">
            <label>OG title</label>
            <input
              className="input"
              value={draft.ogTitle ?? ''}
              onChange={(e): void => setDraft((d) => ({ ...d, ogTitle: e.target.value || null }))}
            />
          </div>
          <div className="field">
            <label>OG description</label>
            <input
              className="input"
              value={draft.ogDescription ?? ''}
              onChange={(e): void =>
                setDraft((d) => ({ ...d, ogDescription: e.target.value || null }))
              }
            />
          </div>
          <div className="field">
            <label>OG image URL</label>
            <input
              className="input"
              type="url"
              value={draft.ogImageUrl ?? ''}
              onChange={(e): void =>
                setDraft((d) => ({ ...d, ogImageUrl: e.target.value || null }))
              }
            />
          </div>

          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={(): void => {
              void save();
            }}
          >
            {busy ? 'Saving…' : 'Save override'}
          </button>
        </>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
