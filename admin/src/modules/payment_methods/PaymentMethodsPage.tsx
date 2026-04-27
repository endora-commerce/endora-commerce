import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Payment methods admin (T164). The `kind` discriminates which driver
 * processes the payment downstream — bank_transfer (proforma flow),
 * pickup (none), credit_limit (US6 reservation), gateway (vendor
 * adapter). Driver wiring is backend-side; here we only configure the
 * row a buyer can pick at checkout.
 */

interface AdminPaymentMethod {
  id: string;
  code: string;
  name: Record<string, string>;
  kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
  status: 'active' | 'inactive';
}

const KINDS = ['bank_transfer', 'pickup', 'credit_limit', 'gateway'] as const;

export function PaymentMethodsPage(): ReactNode {
  const [rows, setRows] = useState<AdminPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPaymentMethod[] }>(
        '/api/v1/admin/payment-methods',
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
      kind: AdminPaymentMethod['kind'];
      status: 'active' | 'inactive';
    }): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      try {
        await apiClient.put<{ data: AdminPaymentMethod }>(
          `/api/v1/admin/payment-methods/${encodeURIComponent(input.code)}`,
          {
            code: input.code,
            name,
            kind: input.kind,
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
      if (!confirm('Delete this payment method?')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/payment-methods/${id}`);
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
          <h1>Payment methods</h1>
          <p>The kind picks the backend driver; gateway adapters ship in follow-up specs.</p>
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
        <p className="muted">No payment methods yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Kind</th>
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
                <td>{r.kind}</td>
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
    kind: AdminPaymentMethod['kind'];
    status: 'active' | 'inactive';
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [kind, setKind] = useState<AdminPaymentMethod['kind']>('bank_transfer');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({ code, nameEn, namePl, kind, status });
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
          <label>Kind</label>
          <select
            className="input"
            value={kind}
            onChange={(e): void => setKind(e.target.value as AdminPaymentMethod['kind'])}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
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
