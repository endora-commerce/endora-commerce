import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Taxes admin (T163). Upsert by code; the most-specific matching rule
 * wins at resolution time (FR-051). One default rule is allowed via the
 * partial unique index — the backend swap is atomic.
 */

interface AdminTax {
  id: string;
  code: string;
  name: string;
  rate: number;
  country: string | null;
  productType: string | null;
  appliesToVatStatuses: string[];
  isDefault: boolean;
  priority: number;
}

const PRODUCT_TYPES = ['simple', 'variant', 'grouped', 'virtual'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;

export function TaxesPage(): ReactNode {
  const [rows, setRows] = useState<AdminTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminTax[] }>('/api/v1/admin/taxes');
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
    async (input: AdminTax): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminTax }>(
          `/api/v1/admin/taxes/${encodeURIComponent(input.code)}`,
          {
            code: input.code,
            name: input.name,
            rate: input.rate,
            country: input.country,
            productType: input.productType,
            appliesToVatStatuses: input.appliesToVatStatuses,
            isDefault: input.isDefault,
            priority: input.priority,
          },
        );
        setInfo(`Saved tax ${input.code}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this tax rule?')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/taxes/${id}`);
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
          <h1>Taxes</h1>
          <p>Per-rule rates narrowed by country, product type, and buyer VAT status.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>New / update tax rule</h2>
        <UpsertForm onSubmit={handleUpsert} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No tax rules yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Rate</th>
              <th>Country</th>
              <th>Product type</th>
              <th>VAT statuses</th>
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
                <td>{(r.rate * 100).toFixed(1)}%</td>
                <td>{r.country ?? '—'}</td>
                <td>{r.productType ?? '—'}</td>
                <td>{r.appliesToVatStatuses.join(', ') || '—'}</td>
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

function UpsertForm({ onSubmit }: { onSubmit: (input: AdminTax) => Promise<void> }): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rate, setRate] = useState('0.23');
  const [country, setCountry] = useState('');
  const [productType, setProductType] = useState<string>('');
  const [vatStatuses, setVatStatuses] = useState<Set<string>>(new Set());
  const [isDefault, setIsDefault] = useState(false);
  const [priority, setPriority] = useState('0');

  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          id: '',
          code,
          name,
          rate: Number(rate),
          country: country || null,
          productType: productType || null,
          appliesToVatStatuses: Array.from(vatStatuses),
          isDefault,
          priority: Number(priority),
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Code</label>
          <input className="input" value={code} onChange={(e): void => setCode(e.target.value)} required />
        </div>
        <div className="field">
          <label>Display name</label>
          <input className="input" value={name} onChange={(e): void => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>Rate (decimal — 0.23 = 23%)</label>
          <input
            className="input"
            type="number"
            step="0.001"
            min="0"
            value={rate}
            onChange={(e): void => setRate(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Country (ISO-2, blank = any)</label>
          <input
            className="input"
            value={country}
            onChange={(e): void => setCountry(e.target.value.toUpperCase())}
            maxLength={2}
          />
        </div>
        <div className="field">
          <label>Product type (blank = any)</label>
          <select
            className="input"
            value={productType}
            onChange={(e): void => setProductType(e.target.value)}
          >
            <option value="">— any —</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Priority (higher wins on ties)</label>
          <input
            className="input"
            type="number"
            value={priority}
            onChange={(e): void => setPriority(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label>Applies to VAT statuses (none = any)</label>
        {VAT_STATUSES.map((v) => (
          <label key={v} style={{ display: 'inline-block', marginRight: 12 }}>
            <input
              type="checkbox"
              checked={vatStatuses.has(v)}
              onChange={(e): void =>
                setVatStatuses((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(v);
                  else next.delete(v);
                  return next;
                })
              }
            />{' '}
            {v}
          </label>
        ))}
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e): void => setIsDefault(e.target.checked)}
          />{' '}
          Default fallback rule
        </label>
      </div>
      <button className="btn btn--primary" type="submit">
        Save
      </button>
    </form>
  );
}
