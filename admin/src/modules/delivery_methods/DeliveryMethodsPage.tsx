import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Delivery methods admin (T164). Per-method `cost` is captured as a
 * snapshot on Order at placement time, so changes here don't rewrite
 * historical orders.
 */

interface AdminDeliveryMethod {
  id: string;
  code: string;
  name: Record<string, string>;
  cost: { amount: number; currency: string };
  status: 'active' | 'inactive';
}

export function DeliveryMethodsPage(): ReactNode {
  const [rows, setRows] = useState<AdminDeliveryMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminDeliveryMethod[] }>(
        '/api/v1/admin/delivery-methods',
      );
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
    async (input: {
      code: string;
      nameEn: string;
      namePl: string;
      cost: number;
      currency: string;
      status: 'active' | 'inactive';
    }): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      try {
        await apiClient.put<{ data: AdminDeliveryMethod }>(
          `/api/v1/admin/delivery-methods/${encodeURIComponent(input.code)}`,
          {
            code: input.code,
            name,
            cost: input.cost,
            currency: input.currency,
            status: input.status,
          },
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
      if (!confirm('Delete this delivery method?')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/delivery-methods/${id}`);
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
          <h1>Delivery methods</h1>
          <p>Cost is captured per-order at placement; later edits don&apos;t rewrite history.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>New / update method</h2>
        <UpsertForm onSubmit={handleUpsert} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No delivery methods yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Cost</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <code>{r.code}</code>
                </td>
                <td>{r.name['en-US'] ?? Object.values(r.name)[0]}</td>
                <td>
                  {r.cost.amount.toFixed(2)} {r.cost.currency}
                </td>
                <td>{r.status}</td>
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
    nameEn: string;
    namePl: string;
    cost: number;
    currency: string;
    status: 'active' | 'inactive';
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [cost, setCost] = useState('0');
  const [currency, setCurrency] = useState('PLN');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({ code, nameEn, namePl, cost: Number(cost), currency, status });
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
          <label>Name [en-US]</label>
          <input className="input" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="field">
          <label>Name [pl-PL]</label>
          <input className="input" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
        <div className="field">
          <label>Cost</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e): void => setCost(e.target.value)}
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
          <label>Status</label>
          <select
            className="input"
            value={status}
            onChange={(e): void => setStatus(e.target.value as 'active' | 'inactive')}
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
      </div>
      <button className="btn btn--primary" type="submit">
        Save
      </button>
    </form>
  );
}
