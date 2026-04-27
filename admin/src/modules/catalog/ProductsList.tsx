import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Admin Products list (T089). Default view excludes archived rows; the
 * "Show archived" toggle widens the query. Each row deep-links to the
 * editor at /catalog/products/:id.
 */

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: string;
  status: 'draft' | 'active' | 'archived';
  name: Record<string, string>;
  visibility: string;
  attributeValues: Record<string, unknown>;
  updatedAt: string;
}

export function ProductsList(): ReactNode {
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const path =
        '/api/v1/admin/catalog/products' + (includeArchived ? '?includeArchived=1' : '');
      const res = await apiClient.get<{ data: AdminProduct[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(f) ||
        r.slug.toLowerCase().includes(f) ||
        pickName(r.name).toLowerCase().includes(f),
    );
  }, [rows, filter]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Products</h1>
          <p>Catalog rows. Pricing, stock, and assets are managed in dedicated modules.</p>
        </div>
        <Link className="btn btn--primary" to="/catalog/products/new">
          New product
        </Link>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="field">
          <label htmlFor="prod-filter">Filter by SKU / slug / name</label>
          <input
            id="prod-filter"
            className="input"
            value={filter}
            onChange={(e): void => setFilter(e.target.value)}
            placeholder="EXAMPLE-SIMPLE-001"
          />
        </div>
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e): void => setIncludeArchived(e.target.checked)}
          />{' '}
          Show archived rows
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No products match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Visibility</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/catalog/products/${r.id}`}>{r.sku}</Link>
                </td>
                <td>{pickName(r.name)}</td>
                <td>{r.type}</td>
                <td>{r.status}</td>
                <td>{r.visibility}</td>
                <td>{formatDateTime(r.updatedAt)}</td>
                <td>
                  <Link className="btn" to={`/catalog/products/${r.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}
