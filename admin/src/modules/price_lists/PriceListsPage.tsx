import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Price lists admin (T163). The MVP UI surfaces the list metadata
 * (code, name, currency, isDefault, priority); managing items and
 * assignments stays in a follow-up since each is a substantial
 * sub-form (per-product fixed prices, category percent / amount
 * adjustments, organization / customer-group assignments).
 */

interface AdminPriceList {
  id: string;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  priority: number;
  createdAt: string;
}

export function PriceListsPage(): ReactNode {
  const [rows, setRows] = useState<AdminPriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPriceList[] }>('/api/v1/admin/price-lists');
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

  const handleUpsert = useCallback(
    async (input: { code: string; name: string; currency: string; isDefault: boolean; priority: number }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminPriceList }>(
          `/api/v1/admin/price-lists/${encodeURIComponent(input.code)}`,
          input,
        );
        setInfo(`Saved ${input.code}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this price list? Existing assignments will be cleared.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/price-lists/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Price lists</h1>
          <p>Default + per-customer-group / per-organization price overrides. Items + assignments live in the API; the panel for those is a follow-up.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>New / update price list</h2>
        <UpsertForm onSubmit={handleUpsert} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No price lists yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Currency</th>
              <th>Default</th>
              <th>Priority</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.code}</code>
                </td>
                <td>{r.name}</td>
                <td>{r.currency}</td>
                <td>{r.isDefault ? 'yes' : ''}</td>
                <td>{r.priority}</td>
                <td>
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={(): void => void handleDelete(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function UpsertForm({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    name: string;
    currency: string;
    isDefault: boolean;
    priority: number;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('PLN');
  const [isDefault, setIsDefault] = useState(false);
  const [priority, setPriority] = useState('0');
  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          name,
          currency,
          isDefault,
          priority: Number(priority),
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Code</label>
          <input
            className="input"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Display name</label>
          <input
            className="input"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Currency</label>
          <input
            className="input"
            value={currency}
            onChange={(e): void => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div className="field">
          <label>Priority</label>
          <input
            className="input"
            type="number"
            value={priority}
            onChange={(e): void => setPriority(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e): void => setIsDefault(e.target.checked)}
          />{' '}
          Default fallback price list
        </label>
      </div>
      <button className="btn btn--primary" type="submit">
        Save
      </button>
    </form>
  );
}
