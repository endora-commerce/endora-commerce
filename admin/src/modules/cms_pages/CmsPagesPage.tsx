import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { CmsPage } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

interface ListEnvelope {
  data: CmsPage[];
}

interface SingleEnvelope {
  data: CmsPage;
}

const LOCALE_OPTIONS = ['en-US', 'pl-PL'];

export function CmsPagesPage(): ReactNode {
  const [rows, setRows] = useState<CmsPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<CmsPage | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListEnvelope>('/api/v1/admin/cms/pages');
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

  const create = useCallback(
    async (input: { path: string; title: Record<string, string>; body: Record<string, string> }): Promise<void> => {
      try {
        await apiClient.post<SingleEnvelope>('/api/v1/admin/cms/pages', input);
        setInfo('Page created as draft. Publish to expose it on the storefront.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const save = useCallback(
    async (
      id: string,
      patch: { title: Record<string, string>; body: Record<string, string> },
    ): Promise<void> => {
      try {
        await apiClient.patch<SingleEnvelope>(`/api/v1/admin/cms/pages/${id}`, patch);
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const action = useCallback(
    async (id: string, verb: 'publish' | 'unpublish' | 'archive'): Promise<void> => {
      try {
        await apiClient.post<SingleEnvelope>(`/api/v1/admin/cms/pages/${id}/${verb}`);
        setInfo(`Page ${verb}ed.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : `${verb} failed.`);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this page? This is permanent.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/cms/pages/${id}`);
        setInfo('Page deleted.');
        if (editing?.id === id) setEditing(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh, editing],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>CMS pages</h1>
          <p>Editorial copy served at the configured path. Title and body are multilingual.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create page</h2>
        <CreatePageForm onSubmit={create} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Pages</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No CMS pages yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Status</th>
                <th>Published</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="code">/{row.path}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>{formatDateTime(row.publishedAt)}</td>
                  <td>{formatDateTime(row.updatedAt)}</td>
                  <td className="row-actions">
                    <button
                      className="btn"
                      onClick={(): void => setEditing(editing?.id === row.id ? null : row)}
                    >
                      {editing?.id === row.id ? 'Close' : 'Edit'}
                    </button>
                    {row.status === 'published' ? (
                      <button className="btn" onClick={(): void => { void action(row.id, 'unpublish'); }}>
                        Unpublish
                      </button>
                    ) : (
                      <button className="btn btn--primary" onClick={(): void => { void action(row.id, 'publish'); }}>
                        Publish
                      </button>
                    )}
                    {row.status !== 'archived' ? (
                      <button className="btn" onClick={(): void => { void action(row.id, 'archive'); }}>
                        Archive
                      </button>
                    ) : null}
                    <button className="btn btn--danger" onClick={(): void => { void remove(row.id); }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? <EditorCard page={editing} onSave={save} /> : null}
    </>
  );
}

function StatusBadge(props: { status: CmsPage['status'] }): ReactNode {
  const cls =
    props.status === 'published'
      ? 'badge badge--success'
      : props.status === 'archived'
        ? 'badge badge--danger'
        : 'badge badge--warning';
  return <span className={cls}>{props.status}</span>;
}

function CreatePageForm(props: {
  onSubmit: (input: { path: string; title: Record<string, string>; body: Record<string, string> }) => Promise<void>;
}): ReactNode {
  const [path, setPath] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!path.trim() || !titleEn.trim()) return;
    setBusy(true);
    try {
      await props.onSubmit({
        path: path.trim(),
        title: { 'en-US': titleEn.trim() },
        body: { 'en-US': bodyEn },
      });
      setPath('');
      setTitleEn('');
      setBodyEn('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e): void => { void onSubmit(e); }}>
      <div className="field">
        <label>Path</label>
        <input
          className="input"
          value={path}
          onChange={(e): void => setPath(e.target.value)}
          placeholder="about-us or policies/privacy"
        />
        <span className="field__hint">kebab-case; / for nested paths.</span>
      </div>
      <div className="field">
        <label>Title (en-US)</label>
        <input
          className="input"
          value={titleEn}
          onChange={(e): void => setTitleEn(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Body (en-US)</label>
        <textarea
          className="textarea"
          rows={6}
          value={bodyEn}
          onChange={(e): void => setBodyEn(e.target.value)}
        />
      </div>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={busy || !path.trim() || !titleEn.trim()}
      >
        {busy ? 'Creating…' : 'Create page'}
      </button>
    </form>
  );
}

function EditorCard(props: {
  page: CmsPage;
  onSave: (id: string, patch: { title: Record<string, string>; body: Record<string, string> }) => Promise<void>;
}): ReactNode {
  const initialLocales = useMemo(
    () => Array.from(new Set([...Object.keys(props.page.title), ...Object.keys(props.page.body), ...LOCALE_OPTIONS])),
    [props.page],
  );
  const [title, setTitle] = useState<Record<string, string>>(props.page.title);
  const [body, setBody] = useState<Record<string, string>>(props.page.body);
  const [busy, setBusy] = useState(false);

  const onSave = async (): Promise<void> => {
    setBusy(true);
    try {
      await props.onSave(props.page.id, { title, body });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>
        Edit <span className="code">/{props.page.path}</span>
      </h2>
      {initialLocales.map((locale) => (
        <div key={locale} style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: '0.9rem', margin: '4px 0' }}>{locale}</h3>
          <div className="field">
            <label>Title</label>
            <input
              className="input"
              value={title[locale] ?? ''}
              onChange={(e): void => setTitle((t) => ({ ...t, [locale]: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea
              className="textarea"
              rows={6}
              value={body[locale] ?? ''}
              onChange={(e): void => setBody((b) => ({ ...b, [locale]: e.target.value }))}
            />
          </div>
        </div>
      ))}
      <button className="btn btn--primary" disabled={busy} onClick={(): void => { void onSave(); }}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
