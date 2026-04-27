import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Organization detail (T160). Shows the org, its members (CustomerAccount
 * rows), and lets the operator change `status` (active / suspended /
 * pending_verification) or `vatStatus` via PATCH.
 *
 * Member CRUD lives elsewhere — admins manage member roles via the
 * storefront's organization settings while impersonating an Org Admin.
 */

interface OrgMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
}

interface OrgDetail {
  id: string;
  name: string;
  taxId: string;
  status: 'pending_verification' | 'active' | 'suspended';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  members: OrgMember[];
}

const STATUSES = ['pending_verification', 'active', 'suspended'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;

export function OrganizationDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`);
      setOrg(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setOrg(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePatch = useCallback(
    async (patch: { status?: string; vatStatus?: string }): Promise<void> => {
      try {
        await apiClient.patch<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`, patch);
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [id, refresh],
  );

  if (loading) return <p className="muted">Loading…</p>;
  if (!org) return <p className="alert alert--warning">Organization not found.</p>;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>{org.name}</h1>
          <p>
            <Link to="/organizations">← Back to list</Link> · Tax ID <code>{org.taxId}</code>
          </p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Status</h2>
        <div className="field">
          <label>Account status</label>
          <select
            className="input"
            value={org.status}
            onChange={(e): void => void handlePatch({ status: e.target.value })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>VAT status</label>
          <select
            className="input"
            value={org.vatStatus}
            onChange={(e): void => void handlePatch({ vatStatus: e.target.value })}
          >
            {VAT_STATUSES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Registered address</h2>
        <p>
          {org.registeredAddress.street}
          <br />
          {org.registeredAddress.postalCode} {org.registeredAddress.city}
          <br />
          {org.registeredAddress.country}
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Members</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Verified</th>
              <th>2FA</th>
            </tr>
          </thead>
          <tbody>
            {org.members.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>
                  {m.firstName} {m.lastName}
                </td>
                <td>{m.role}</td>
                <td>{m.emailVerifiedAt ? formatDateTime(m.emailVerifiedAt) : '—'}</td>
                <td>{m.twoFactorEnabled ? 'on' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
