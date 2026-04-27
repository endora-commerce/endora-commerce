import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ExternalIntegration, IntegrationTestResult } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

const KIND_OPTIONS = ['payment_gateway', 'shipping_carrier', 'analytics', 'crm', 'erp'] as const;

interface IntegrationsListResponse {
  data: ExternalIntegration[];
}

interface CreateIntegrationResponse {
  data: ExternalIntegration & { testResult?: IntegrationTestResult };
}

interface TestResponse {
  data: IntegrationTestResult;
}

export function IntegrationsPage(): ReactNode {
  const [items, setItems] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<IntegrationsListResponse>('/api/v1/admin/integrations');
      setItems(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to load integrations.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      name: string;
      vendor: string;
      kind: string;
      config: Record<string, unknown>;
    }): Promise<void> => {
      try {
        const res = await apiClient.post<CreateIntegrationResponse>(
          '/api/v1/admin/integrations',
          input,
        );
        const test = res.data.testResult;
        if (test) {
          setInfo(
            test.ok
              ? `Connection test succeeded — status is now "${test.status}".`
              : `Connection test failed: ${test.message ?? 'unknown error'}.`,
          );
        } else {
          setInfo('Integration created.');
        }
        await refresh();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to create integration.',
        );
      }
    },
    [refresh],
  );

  const handleTest = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await apiClient.post<TestResponse>(`/api/v1/admin/integrations/${id}/test`);
        setInfo(
          res.data.ok
            ? `Test passed — status "${res.data.status}".`
            : `Test failed: ${res.data.message ?? 'unknown error'}`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Test call failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this integration? Stored credentials will be removed.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/integrations/${id}`);
        await refresh();
      } catch (err) {
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to delete integration.',
        );
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>External Integrations</h1>
          <p>Per-vendor credentials. Encrypted at rest; only redacted fields are returned by GET.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Configure new integration</h2>
        <CreateIntegrationForm onSubmit={handleCreate} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Configured</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No integrations configured yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Last tested</th>
                <th>Last error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>
                    <span className="badge">{i.kind}</span>
                  </td>
                  <td>{i.vendor}</td>
                  <td>
                    <IntegrationStatusBadge status={i.status} />
                  </td>
                  <td>{formatDateTime(i.lastTestedAt)}</td>
                  <td className="muted" style={{ maxWidth: 240 }}>
                    {i.lastError ?? '—'}
                  </td>
                  <td className="row-actions">
                    <button
                      className="btn"
                      onClick={(): void => {
                        void handleTest(i.id);
                      }}
                    >
                      Test
                    </button>
                    <button
                      className="btn btn--danger"
                      onClick={(): void => {
                        void handleDelete(i.id);
                      }}
                    >
                      Delete
                    </button>
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

function IntegrationStatusBadge(props: { status: ExternalIntegration['status'] }): ReactNode {
  const cls =
    props.status === 'active'
      ? 'badge badge--success'
      : props.status === 'error'
        ? 'badge badge--danger'
        : 'badge badge--warning';
  return <span className={cls}>{props.status}</span>;
}

function CreateIntegrationForm(props: {
  onSubmit: (input: {
    name: string;
    vendor: string;
    kind: string;
    config: Record<string, unknown>;
  }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [kind, setKind] = useState<string>(KIND_OPTIONS[0]);
  const [configText, setConfigText] = useState('{}');
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || !vendor.trim()) return;

    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config must be a JSON object.');
      }
      config = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON.');
      return;
    }
    setParseError(null);
    setSubmitting(true);
    try {
      await props.onSubmit({ name: name.trim(), vendor: vendor.trim(), kind, config });
      setName('');
      setVendor('');
      setConfigText('{}');
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
        <label htmlFor="int-name">Name</label>
        <input
          id="int-name"
          className="input"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="int-vendor">Vendor</label>
        <input
          id="int-vendor"
          className="input"
          value={vendor}
          onChange={(e): void => setVendor(e.target.value)}
          placeholder="e.g. stripe, inpost"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="int-kind">Kind</label>
        <select
          id="int-kind"
          className="select"
          value={kind}
          onChange={(e): void => setKind(e.target.value)}
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="int-config">Config (JSON)</label>
        <textarea
          id="int-config"
          className="textarea"
          value={configText}
          onChange={(e): void => setConfigText(e.target.value)}
          rows={6}
          spellCheck={false}
        />
        {parseError ? <span className="field__hint" style={{ color: 'var(--color-danger)' }}>{parseError}</span> : null}
        <span className="field__hint">
          Stored encrypted at rest. Only the per-vendor adapter ever decrypts it.
        </span>
      </div>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={submitting || !name.trim() || !vendor.trim()}
      >
        {submitting ? 'Creating…' : 'Create + test connection'}
      </button>
    </form>
  );
}
