import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Credit Limits admin (T218 / FR-090..FR-097). Two halves:
 *   - top: roster of every granted limit with available / reserved breakdown
 *   - bottom: per-organization editor — paste an org id to load its
 *     limit (or "none granted yet"), then grant or adjust
 *
 * Adjust to a value below the active reservations sum returns 409
 * ADJUSTMENT_BELOW_ACTIVE; the operator can override with the
 * `allowOverAllocation` checkbox (FR-094).
 */

interface ActiveReservation {
  orderId: string;
  amount: number;
  createdAt: string;
}

interface CreditLimitView {
  organizationId: string;
  grantedAmount: number;
  availableAmount: number;
  currency: string;
  activeReservations: ActiveReservation[];
  grantedAt: string;
}

export function CreditLimitsPage(): ReactNode {
  const [rows, setRows] = useState<CreditLimitView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [orgIdInput, setOrgIdInput] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreditLimitView | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const refreshList = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: CreditLimitView[] }>('/api/v1/admin/credit-limits');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadSelected = useCallback(
    async (orgId: string): Promise<void> => {
      setSelectedLoading(true);
      setSelected(null);
      setSelectedOrgId(orgId);
      try {
        const res = await apiClient.get<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${orgId}/credit-limit`,
        );
        setSelected(res.data);
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'CREDIT_LIMIT_NOT_GRANTED') {
          setSelected(null);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Lookup failed.');
        }
      } finally {
        setSelectedLoading(false);
      }
    },
    [],
  );

  const handleGrant = useCallback(
    async (input: { grantedAmount: number; currency: string; reason?: string }): Promise<void> => {
      if (!selectedOrgId) return;
      try {
        await apiClient.post<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${selectedOrgId}/credit-limit`,
          input,
        );
        setInfo(`Granted ${input.grantedAmount} ${input.currency} to ${selectedOrgId.slice(0, 8)}.`);
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Grant failed.');
      }
    },
    [selectedOrgId, loadSelected, refreshList],
  );

  const handleAdjust = useCallback(
    async (input: {
      grantedAmount: number;
      reason?: string;
      allowOverAllocation: boolean;
    }): Promise<void> => {
      if (!selectedOrgId) return;
      try {
        await apiClient.patch<{ data: CreditLimitView }>(
          `/api/v1/admin/organizations/${selectedOrgId}/credit-limit`,
          input,
        );
        setInfo(`Adjusted credit limit for ${selectedOrgId.slice(0, 8)}.`);
        await loadSelected(selectedOrgId);
        await refreshList();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Adjust failed.');
      }
    },
    [selectedOrgId, loadSelected, refreshList],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Credit limits</h1>
          <p>
            Grant and adjust deferred-payment limits per organization. Adjustments below the
            active-reservations sum are rejected unless explicitly overridden.
          </p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No credit limits granted yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Granted</th>
              <th>Available</th>
              <th>Reservations</th>
              <th>Granted at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.organizationId}>
                <td>
                  <code>{r.organizationId.slice(0, 8)}</code>
                </td>
                <td>
                  {r.grantedAmount.toFixed(2)} {r.currency}
                </td>
                <td>
                  {r.availableAmount.toFixed(2)} {r.currency}
                </td>
                <td>{r.activeReservations.length}</td>
                <td>{formatDateTime(r.grantedAt)}</td>
                <td>
                  <button
                    className="btn"
                    type="button"
                    onClick={(): void => {
                      setOrgIdInput(r.organizationId);
                      void loadSelected(r.organizationId);
                    }}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Per-organization editor</h2>
        <form
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            void loadSelected(orgIdInput.trim());
          }}
        >
          <div className="field">
            <label>Organization id</label>
            <input
              className="input"
              value={orgIdInput}
              onChange={(e): void => setOrgIdInput(e.target.value)}
              placeholder="UUID"
              required
            />
          </div>
          <button className="btn" type="submit">
            Look up
          </button>
        </form>
      </div>

      {selectedOrgId && !selectedLoading ? (
        selected ? (
          <ExistingLimitPanel limit={selected} onAdjust={handleAdjust} />
        ) : (
          <GrantPanel orgId={selectedOrgId} onGrant={handleGrant} />
        )
      ) : null}
    </>
  );
}

function ExistingLimitPanel({
  limit,
  onAdjust,
}: {
  limit: CreditLimitView;
  onAdjust: (input: {
    grantedAmount: number;
    reason?: string;
    allowOverAllocation: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [grantedAmount, setGrantedAmount] = useState(String(limit.grantedAmount));
  const [reason, setReason] = useState('');
  const [allowOverAllocation, setAllowOverAllocation] = useState(false);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
        Adjust {limit.organizationId.slice(0, 8)} ({limit.currency})
      </h3>
      <p className="muted">
        Granted {limit.grantedAmount.toFixed(2)} · Available {limit.availableAmount.toFixed(2)} ·
        Reserved {(limit.grantedAmount - limit.availableAmount).toFixed(2)} across{' '}
        {limit.activeReservations.length} order(s).
      </p>
      {limit.activeReservations.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Reserved</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {limit.activeReservations.map((r) => (
              <tr key={r.orderId}>
                <td>
                  <code>{r.orderId.slice(0, 8)}</code>
                </td>
                <td>
                  {r.amount.toFixed(2)} {limit.currency}
                </td>
                <td>{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <form
        onSubmit={(e: FormEvent): void => {
          e.preventDefault();
          void onAdjust({
            grantedAmount: Number(grantedAmount),
            ...(reason ? { reason } : {}),
            allowOverAllocation,
          });
        }}
      >
        <div className="field">
          <label>New granted amount ({limit.currency})</label>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            value={grantedAmount}
            onChange={(e): void => setGrantedAmount(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Reason (optional, kept on the audit log)</label>
          <input
            className="input"
            value={reason}
            onChange={(e): void => setReason(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={allowOverAllocation}
              onChange={(e): void => setAllowOverAllocation(e.target.checked)}
            />{' '}
            Allow reduction below active reservations (override)
          </label>
        </div>
        <button className="btn btn--primary" type="submit">
          Save adjustment
        </button>
      </form>
    </div>
  );
}

function GrantPanel({
  orgId,
  onGrant,
}: {
  orgId: string;
  onGrant: (input: { grantedAmount: number; currency: string; reason?: string }) => Promise<void>;
}): ReactNode {
  const [grantedAmount, setGrantedAmount] = useState('5000');
  const [currency, setCurrency] = useState('PLN');
  const [reason, setReason] = useState('');
  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
        Grant credit limit to {orgId.slice(0, 8)}
      </h3>
      <p className="muted">No credit limit is granted for this organization yet.</p>
      <form
        onSubmit={(e: FormEvent): void => {
          e.preventDefault();
          void onGrant({
            grantedAmount: Number(grantedAmount),
            currency,
            ...(reason ? { reason } : {}),
          });
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Granted amount</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              value={grantedAmount}
              onChange={(e): void => setGrantedAmount(e.target.value)}
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
        </div>
        <div className="field">
          <label>Reason (optional)</label>
          <input
            className="input"
            value={reason}
            onChange={(e): void => setReason(e.target.value)}
            maxLength={2000}
          />
        </div>
        <button className="btn btn--primary" type="submit">
          Grant
        </button>
      </form>
    </div>
  );
}
