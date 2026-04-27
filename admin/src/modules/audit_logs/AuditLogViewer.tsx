import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Audit Log viewer (T195 / FR-084). Append-only — no edit / delete UI.
 * Filters mirror the backend query: actor, action, objectType, objectId,
 * impersonated customer. The detail row expands stateBefore / stateAfter
 * as JSON so support can compare changes inline.
 */

interface AuditLogRow {
  id: string;
  actorAdminUserId: string | null;
  impersonatedCustomerAccountId: string | null;
  actedAt: string;
  action: string;
  objectType: string;
  objectId: string;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function AuditLogViewer(): ReactNode {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [objectId, setObjectId] = useState('');
  const [impersonated, setImpersonated] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actor) params.set('filter[actor]', actor);
      if (action) params.set('filter[action]', action);
      if (objectType) params.set('filter[objectType]', objectType);
      if (objectId) params.set('filter[objectId]', objectId);
      if (impersonated) params.set('filter[customer]', impersonated);
      const path =
        '/api/v1/admin/audit-log' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AuditLogRow[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load audit log.');
    } finally {
      setLoading(false);
    }
  }, [actor, action, objectType, objectId, impersonated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Audit log</h1>
          <p>Append-only log of sensitive operations. Read-only.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <form
        className="card"
        onSubmit={(e: FormEvent): void => {
          e.preventDefault();
          void refresh();
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="f-action">Action</label>
            <input
              id="f-action"
              className="input"
              placeholder="product.update"
              value={action}
              onChange={(e): void => setAction(e.target.value.trim())}
            />
          </div>
          <div className="field">
            <label htmlFor="f-otype">Object type</label>
            <input
              id="f-otype"
              className="input"
              placeholder="product"
              value={objectType}
              onChange={(e): void => setObjectType(e.target.value.trim())}
            />
          </div>
          <div className="field">
            <label htmlFor="f-oid">Object id</label>
            <input
              id="f-oid"
              className="input"
              placeholder="UUID"
              value={objectId}
              onChange={(e): void => setObjectId(e.target.value.trim())}
            />
          </div>
          <div className="field">
            <label htmlFor="f-actor">Actor (admin user id)</label>
            <input
              id="f-actor"
              className="input"
              placeholder="UUID"
              value={actor}
              onChange={(e): void => setActor(e.target.value.trim())}
            />
          </div>
          <div className="field">
            <label htmlFor="f-customer">Impersonated customer id</label>
            <input
              id="f-customer"
              className="input"
              placeholder="UUID"
              value={impersonated}
              onChange={(e): void => setImpersonated(e.target.value.trim())}
            />
          </div>
        </div>
        <button className="btn btn--primary" type="submit">
          Apply filters
        </button>{' '}
        <button
          className="btn"
          type="button"
          onClick={(): void => {
            setActor('');
            setAction('');
            setObjectType('');
            setObjectId('');
            setImpersonated('');
          }}
        >
          Clear
        </button>
      </form>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No entries match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Object</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>{formatDateTime(r.actedAt)}</td>
                  <td>{r.actorAdminUserId ? r.actorAdminUserId.slice(0, 8) : 'system'}</td>
                  <td>{r.action}</td>
                  <td>
                    {r.objectType}
                    <br />
                    <span className="muted">{r.objectId.slice(0, 8)}</span>
                  </td>
                  <td>
                    <button
                      className="btn"
                      type="button"
                      onClick={(): void => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      {expandedId === r.id ? 'Hide' : 'Detail'}
                    </button>
                  </td>
                </tr>
                {expandedId === r.id ? (
                  <tr>
                    <td colSpan={5}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <strong>Before</strong>
                          <pre style={{ background: 'var(--color-bg)', padding: 8, overflow: 'auto' }}>
                            {JSON.stringify(r.stateBefore ?? null, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <strong>After</strong>
                          <pre style={{ background: 'var(--color-bg)', padding: 8, overflow: 'auto' }}>
                            {JSON.stringify(r.stateAfter ?? null, null, 2)}
                          </pre>
                        </div>
                      </div>
                      <div className="muted" style={{ marginTop: 8 }}>
                        IP {r.ipAddress ?? '—'} · UA {r.userAgent ? r.userAgent.slice(0, 60) : '—'} · req {r.requestId ?? '—'}
                        {r.impersonatedCustomerAccountId ? (
                          <> · impersonated customer {r.impersonatedCustomerAccountId.slice(0, 8)}</>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
