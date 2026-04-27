import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Promotions admin (T163). Three kinds: percentage_off, amount_off
 * (requires currency), free_delivery. Backend enforces value ranges and
 * the currency requirement; this UI only does the obvious presentation.
 */

interface AdminPromotion {
  id: string;
  code: string | null;
  name: string;
  kind: 'percentage_off' | 'amount_off' | 'free_delivery';
  value: number;
  currency: string | null;
  minCartSubtotal: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

const KINDS = ['percentage_off', 'amount_off', 'free_delivery'] as const;

export function PromotionsPage(): ReactNode {
  const [rows, setRows] = useState<AdminPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPromotion[] }>('/api/v1/admin/promotions');
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

  const handleCreate = useCallback(
    async (input: {
      code: string;
      name: string;
      kind: AdminPromotion['kind'];
      value: number;
      currency: string;
      isActive: boolean;
    }): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminPromotion }>('/api/v1/admin/promotions', {
          ...(input.code ? { code: input.code } : {}),
          name: input.name,
          kind: input.kind,
          value: input.value,
          ...(input.kind === 'amount_off' ? { currency: input.currency } : {}),
          isActive: input.isActive,
        });
        setInfo(`Promotion ${input.code || input.name} created.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this promotion?')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/promotions/${id}`);
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
          <h1>Promotions</h1>
          <p>Cart-level discounts. Percentage values are 0..100; amount-off requires a currency.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create promotion</h2>
        <CreatePromotionForm onSubmit={handleCreate} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No promotions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Value</th>
              <th>Min cart</th>
              <th>Valid</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.code ?? '—'}</code>
                </td>
                <td>{p.name}</td>
                <td>{p.kind}</td>
                <td>
                  {p.kind === 'percentage_off' ? `${p.value}%` : p.kind === 'amount_off' ? `${p.value} ${p.currency}` : 'free delivery'}
                </td>
                <td>{p.minCartSubtotal != null ? p.minCartSubtotal.toFixed(2) : '—'}</td>
                <td>
                  {p.validFrom ? formatDateTime(p.validFrom) : '—'}
                  {' → '}
                  {p.validUntil ? formatDateTime(p.validUntil) : '—'}
                </td>
                <td>{p.isActive ? 'yes' : 'no'}</td>
                <td>
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={(): void => void handleDelete(p.id)}
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

function CreatePromotionForm({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    name: string;
    kind: 'percentage_off' | 'amount_off' | 'free_delivery';
    value: number;
    currency: string;
    isActive: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage_off' | 'amount_off' | 'free_delivery'>('percentage_off');
  const [value, setValue] = useState('10');
  const [currency, setCurrency] = useState('PLN');
  const [isActive, setIsActive] = useState(true);

  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          name,
          kind,
          value: Number(value),
          currency,
          isActive,
        }).then(() => {
          setCode('');
          setName('');
          setValue('10');
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Code (optional)</label>
          <input className="input" value={code} onChange={(e): void => setCode(e.target.value)} />
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
          <label>Kind</label>
          <select
            className="input"
            value={kind}
            onChange={(e): void => setKind(e.target.value as typeof kind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Value {kind === 'percentage_off' ? '(%)' : kind === 'amount_off' ? '' : '(ignored)'}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e): void => setValue(e.target.value)}
          />
        </div>
        {kind === 'amount_off' ? (
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
        ) : null}
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e): void => setIsActive(e.target.checked)}
          />{' '}
          Active
        </label>
      </div>
      <button className="btn btn--primary" type="submit">
        Create
      </button>
    </form>
  );
}
