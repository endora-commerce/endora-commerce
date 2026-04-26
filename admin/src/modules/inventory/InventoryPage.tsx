import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Inventory admin (T165). Read + adjust on-hand counters per
 * (productId, variantId?). `available = onHand − reserved` is shown so
 * operators can spot rows where the storefront would refuse stock even
 * though the warehouse has units (because some are reserved by
 * unfulfilled orders).
 *
 * The set form takes an absolute on-hand value. Reserved counters are
 * driven by orders and are not editable here.
 */

interface AdminStockRow {
  id: string;
  productId: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  productSku: string | null;
  productName: Record<string, string> | null;
  updatedAt: string;
}

export function InventoryPage(): ReactNode {
  const [rows, setRows] = useState<AdminStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (productFilter) params.set('productId', productFilter);
      const path =
        '/api/v1/admin/inventory' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminStockRow[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [productFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSet = useCallback(
    async (input: {
      productId: string;
      variantId: string | null;
      onHand: number;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminStockRow }>('/api/v1/admin/inventory', input);
        setInfo(`Set on-hand to ${input.onHand}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Inventory</h1>
          <p>
            On-hand counters per product / variant. <code>available = onHand − reserved</code>.
          </p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <div className="field">
          <label>Filter by product id</label>
          <input
            className="input"
            value={productFilter}
            onChange={(e): void => setProductFilter(e.target.value.trim())}
            placeholder="UUID"
          />
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Set on-hand</h2>
        <SetStockForm onSubmit={handleSet} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No stock-level rows match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Variant</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.productSku ? <code>{r.productSku}</code> : <code>{r.productId.slice(0, 8)}</code>}
                  {r.productName ? (
                    <>
                      <br />
                      <span className="muted">
                        {r.productName['en-US'] ?? Object.values(r.productName)[0]}
                      </span>
                    </>
                  ) : null}
                </td>
                <td>{r.variantId ? r.variantId.slice(0, 8) : '—'}</td>
                <td>{r.onHand}</td>
                <td>{r.reserved}</td>
                <td>{r.available}</td>
                <td>{formatDateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function SetStockForm({
  onSubmit,
}: {
  onSubmit: (input: { productId: string; variantId: string | null; onHand: number }) => Promise<void>;
}): ReactNode {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [onHand, setOnHand] = useState('0');
  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          productId,
          variantId: variantId || null,
          onHand: Number(onHand),
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Product ID</label>
          <input
            className="input"
            value={productId}
            onChange={(e): void => setProductId(e.target.value.trim())}
            required
            placeholder="UUID"
          />
        </div>
        <div className="field">
          <label>Variant ID (optional)</label>
          <input
            className="input"
            value={variantId}
            onChange={(e): void => setVariantId(e.target.value.trim())}
            placeholder="UUID"
          />
        </div>
        <div className="field">
          <label>On hand</label>
          <input
            className="input"
            type="number"
            min="0"
            value={onHand}
            onChange={(e): void => setOnHand(e.target.value)}
          />
        </div>
      </div>
      <button className="btn btn--primary" type="submit">
        Save
      </button>
    </form>
  );
}
