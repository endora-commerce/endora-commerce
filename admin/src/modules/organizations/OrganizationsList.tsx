import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Organizations list (T160). Filters by status / VAT status / free-text
 * (name + tax id ILIKE). Each row deep-links to the detail page.
 */

interface AdminOrganization {
  id: string;
  name: string;
  taxId: string;
  status: 'pending_verification' | 'active' | 'suspended';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  createdAt: string;
}

const STATUSES = ['pending_verification', 'active', 'suspended'] as const;

export function OrganizationsList(): ReactNode {
  const [rows, setRows] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');
  const [q, setQ] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('filter[status]', status);
      if (q) params.set('q', q);
      const path =
        '/api/v1/admin/organizations' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminOrganization[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Organizations</h1>
          <p>Customer organizations registered on the platform.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="field">
          <label>Status</label>
          <select
            className="input"
            value={status}
            onChange={(e): void => setStatus(e.target.value as typeof status)}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Search (name / tax id)</label>
          <input className="input" value={q} onChange={(e): void => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No organizations match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Tax ID</th>
              <th>Status</th>
              <th>VAT</th>
              <th>Registered</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.taxId}</td>
                <td>{o.status}</td>
                <td>{o.vatStatus}</td>
                <td>{formatDateTime(o.createdAt)}</td>
                <td>
                  <Link className="btn" to={`/organizations/${o.id}`}>
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
