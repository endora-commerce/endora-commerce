import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Admin RFQ list (T092 / FR-019..FR-026). Supplier employees land here
 * to triage incoming quote requests. Filters by status (default: open
 * work — submitted + in_review) and by assignee. The Claim button
 * assigns the row to the current admin and navigates to the detail page.
 */

const STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;

type RfqStatus = (typeof STATUSES)[number];

interface AdminRfqRow {
  id: string;
  organizationId: string;
  customerAccountId: string;
  assignedAdminUserId?: string;
  status: RfqStatus;
  items: Array<{ id: string; productName: string; quantity: number }>;
  submittedAt: string | null;
  quotedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

interface AdminRfqListResponse {
  data: AdminRfqRow[];
}

const OPEN_STATUSES: RfqStatus[] = ['submitted', 'in_review'];

export function RfqList(): ReactNode {
  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | RfqStatus | 'all'>('open');
  const [organizationId, setOrganizationId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all' && statusFilter !== 'open') {
        params.set('filter[status]', statusFilter);
      }
      if (organizationId) params.set('filter[organizationId]', organizationId);
      const path =
        '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<AdminRfqListResponse>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load RFQs.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClaim = useCallback(
    async (id: string): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminRfqRow }>(
          `/api/v1/admin/quote-requests/${id}/claim`,
          {},
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Claim failed.');
      }
    },
    [refresh],
  );

  const visible = useMemo(() => {
    if (statusFilter === 'open') return rows.filter((r) => OPEN_STATUSES.includes(r.status));
    return rows;
  }, [rows, statusFilter]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Quote requests</h1>
          <p>Triage incoming RFQs, claim them, send a quote, or decline.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="field">
          <label htmlFor="rfq-status">Status</label>
          <select
            id="rfq-status"
            className="input"
            value={statusFilter}
            onChange={(e): void => setStatusFilter(e.target.value as 'open' | RfqStatus | 'all')}
          >
            <option value="open">Open (submitted + in_review)</option>
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rfq-org">Organization ID (optional)</label>
          <input
            id="rfq-org"
            className="input"
            placeholder="UUID"
            value={organizationId}
            onChange={(e): void => setOrganizationId(e.target.value.trim())}
          />
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No RFQs match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Status</th>
              <th>Items</th>
              <th>Submitted</th>
              <th>Expires</th>
              <th>Assigned</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/quote-requests/${r.id}`}>{r.id.slice(0, 8)}</Link>
                </td>
                <td>{r.status}</td>
                <td>{r.items.length}</td>
                <td>{formatDateTime(r.submittedAt)}</td>
                <td>{formatDateTime(r.expiresAt)}</td>
                <td>{r.assignedAdminUserId ? r.assignedAdminUserId.slice(0, 8) : '—'}</td>
                <td>
                  {OPEN_STATUSES.includes(r.status) && !r.assignedAdminUserId ? (
                    <button
                      className="btn btn--primary"
                      type="button"
                      onClick={(): void => {
                        void handleClaim(r.id);
                      }}
                    >
                      Claim
                    </button>
                  ) : null}
                  <Link className="btn" to={`/quote-requests/${r.id}`}>
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
