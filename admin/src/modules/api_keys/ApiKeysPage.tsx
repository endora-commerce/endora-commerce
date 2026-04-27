import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ApiKey, CreateApiKeyResponse } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

const KNOWN_SCOPES = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'integrations:manage',
];

interface ApiKeyListResponse {
  data: ApiKey[];
}

interface CreateApiKeyEnvelope {
  data: CreateApiKeyResponse;
}

export function ApiKeysPage(): ReactNode {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ApiKeyListResponse>('/api/v1/admin/api-keys');
      setKeys(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { name: string; scopes: string[] }): Promise<void> => {
      try {
        const res = await apiClient.post<CreateApiKeyEnvelope>(
          '/api/v1/admin/api-keys',
          input,
        );
        setRevealedToken({ name: input.name, token: res.data.bearerToken });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to create key.');
      }
    },
    [refresh],
  );

  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Revoke this key? Calls using it will start failing immediately.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/api-keys/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to revoke key.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>API Keys</h1>
          <p>Bearer tokens for machine-to-machine integrations. The full token is shown once.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {revealedToken ? (
        <div className="alert alert--warning">
          <strong>Save this bearer token now — it will not be shown again.</strong>
          <div className="muted">{revealedToken.name}</div>
          <code className="code">{revealedToken.token}</code>
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={(): void => setRevealedToken(null)}>
              I have stored it
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create new key</h2>
        <CreateKeyForm onSubmit={handleCreate} />
      </div>

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="muted">No API keys yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Scopes</th>
                <th>Last 4</th>
                <th>Last used</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <span
                      className={
                        k.status === 'active' ? 'badge badge--success' : 'badge badge--danger'
                      }
                    >
                      {k.status}
                    </span>
                  </td>
                  <td>
                    {k.scopes.map((s) => (
                      <span key={s} className="badge" style={{ marginRight: 4 }}>
                        {s}
                      </span>
                    ))}
                  </td>
                  <td className="code">…{k.lastFour}</td>
                  <td>{formatDateTime(k.lastUsedAt)}</td>
                  <td>{formatDateTime(k.createdAt)}</td>
                  <td>
                    {k.status === 'active' ? (
                      <button
                        className="btn btn--danger"
                        onClick={(): void => {
                          void handleRevoke(k.id);
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CreateKeyForm(props: {
  onSubmit: (input: { name: string; scopes: string[] }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (scope: string): void => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || scopes.size === 0) return;
    setSubmitting(true);
    try {
      await props.onSubmit({ name: name.trim(), scopes: Array.from(scopes) });
      setName('');
      setScopes(new Set());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <div className="field">
        <label htmlFor="api-key-name">Name</label>
        <input
          id="api-key-name"
          className="input"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder="e.g. PIM sync"
          required
        />
      </div>
      <div className="field">
        <label>Scopes</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {KNOWN_SCOPES.map((scope) => (
            <label
              key={scope}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}
            >
              <input
                type="checkbox"
                checked={scopes.has(scope)}
                onChange={(): void => toggle(scope)}
              />
              <span className="code">{scope}</span>
            </label>
          ))}
        </div>
        <span className="field__hint">Pick the smallest set that lets the integration work.</span>
      </div>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={submitting || !name.trim() || scopes.size === 0}
      >
        {submitting ? 'Creating…' : 'Create key'}
      </button>
    </form>
  );
}
