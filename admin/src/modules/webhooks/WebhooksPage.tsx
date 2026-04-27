import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Webhook, WebhookDelivery } from '@b2b/contracts';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

const KNOWN_EVENT_TYPES = [
  'product.created.v1',
  'product.updated.v1',
  'product.archived.v1',
  'rfq.created.v1',
  'rfq.quoted.v1',
  'rfq.accepted.v1',
  'rfq.expired.v1',
  'order.created.v1',
  'order.status_changed.v1',
  'order.cancelled.v1',
  'payment.settled.v1',
  'credit_limit.adjusted.v1',
  'credit_limit.reservation_released.v1',
];

interface WebhooksListResponse {
  data: Webhook[];
}

interface DeliveriesListResponse {
  data: WebhookDelivery[];
}

export function WebhooksPage(): ReactNode {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingHooks, setLoadingHooks] = useState(true);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'dead_lettered'>('all');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refreshWebhooks = useCallback(async (): Promise<void> => {
    setLoadingHooks(true);
    setError(null);
    try {
      const res = await apiClient.get<WebhooksListResponse>('/api/v1/admin/webhooks');
      setWebhooks(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load webhooks.');
    } finally {
      setLoadingHooks(false);
    }
  }, []);

  const refreshDeliveries = useCallback(async (): Promise<void> => {
    setLoadingDeliveries(true);
    try {
      const qs =
        filter === 'all' ? '?limit=50' : `?status=${filter}&limit=50`;
      const res = await apiClient.get<DeliveriesListResponse>(
        `/api/v1/admin/webhooks/deliveries${qs}`,
      );
      setDeliveries(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.envelope.error.message : 'Failed to load deliveries.',
      );
    } finally {
      setLoadingDeliveries(false);
    }
  }, [filter]);

  useEffect(() => {
    void refreshWebhooks();
  }, [refreshWebhooks]);

  useEffect(() => {
    void refreshDeliveries();
  }, [refreshDeliveries]);

  const handleCreate = useCallback(
    async (input: { name: string; url: string; eventTypes: string[] }): Promise<void> => {
      try {
        await apiClient.post<{ data: Webhook }>('/api/v1/admin/webhooks', input);
        setInfo('Webhook created. Its signing secret is stored on the server.');
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to create webhook.');
      }
    },
    [refreshWebhooks],
  );

  const handleToggleStatus = useCallback(
    async (w: Webhook): Promise<void> => {
      const next = w.status === 'active' ? 'paused' : 'active';
      try {
        await apiClient.patch<{ data: Webhook }>(`/api/v1/admin/webhooks/${w.id}`, {
          status: next,
        });
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to update webhook.');
      }
    },
    [refreshWebhooks],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this webhook? Pending deliveries will continue but no new ones will be enqueued.')) {
        return;
      }
      try {
        await apiClient.delete<void>(`/api/v1/admin/webhooks/${id}`);
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to delete webhook.');
      }
    },
    [refreshWebhooks],
  );

  const handleReplay = useCallback(
    async (deliveryId: string): Promise<void> => {
      try {
        await apiClient.post<{ data: WebhookDelivery }>(
          `/api/v1/admin/webhooks/deliveries/${deliveryId}/replay`,
        );
        setInfo('Replay queued — a new delivery row is now pending.');
        await refreshDeliveries();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Replay failed.');
      }
    },
    [refreshDeliveries],
  );

  const webhookNameById = new Map(webhooks.map((w) => [w.id, w.name]));

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Webhooks</h1>
          <p>HMAC-signed outbound notifications. Receivers must be idempotent on event id.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Subscribe to events</h2>
        <CreateWebhookForm onSubmit={handleCreate} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Subscriptions</h2>
        {loadingHooks ? (
          <p className="muted">Loading…</p>
        ) : webhooks.length === 0 ? (
          <p className="muted">No subscriptions yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td className="code">{w.url}</td>
                  <td>
                    {w.eventTypes.map((e) => (
                      <span key={e} className="badge" style={{ marginRight: 4 }}>
                        {e}
                      </span>
                    ))}
                  </td>
                  <td>
                    <span
                      className={
                        w.status === 'active' ? 'badge badge--success' : 'badge badge--warning'
                      }
                    >
                      {w.status}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button
                      className="btn"
                      onClick={(): void => {
                        void handleToggleStatus(w);
                      }}
                    >
                      {w.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      className="btn btn--danger"
                      onClick={(): void => {
                        void handleDelete(w.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Recent deliveries</h2>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={filter}
            onChange={(e): void =>
              setFilter(e.target.value as 'all' | 'failed' | 'dead_lettered')
            }
          >
            <option value="all">All statuses</option>
            <option value="failed">Failed</option>
            <option value="dead_lettered">Dead-lettered</option>
          </select>
          <button
            className="btn"
            onClick={(): void => {
              void refreshDeliveries();
            }}
          >
            Refresh
          </button>
        </div>
        {loadingDeliveries ? (
          <p className="muted">Loading…</p>
        ) : deliveries.length === 0 ? (
          <p className="muted">No deliveries match this filter.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Webhook</th>
                <th>Event</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last response</th>
                <th>Last error</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td>{webhookNameById.get(d.webhookId) ?? d.webhookId}</td>
                  <td>
                    <div>{d.eventType}</div>
                    <div className="muted code" style={{ fontSize: '0.75rem' }}>
                      {d.eventId}
                    </div>
                  </td>
                  <td>
                    <DeliveryStatusBadge status={d.status} />
                  </td>
                  <td>{d.attemptCount}</td>
                  <td>{d.lastResponseStatus ?? '—'}</td>
                  <td className="muted" style={{ maxWidth: 240 }}>
                    {d.lastError ?? '—'}
                  </td>
                  <td>{formatDateTime(d.createdAt)}</td>
                  <td>
                    {d.status === 'failed' || d.status === 'dead_lettered' ? (
                      <button
                        className="btn"
                        onClick={(): void => {
                          void handleReplay(d.id);
                        }}
                      >
                        Replay
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DeliveryStatusBadge(props: { status: WebhookDelivery['status'] }): ReactNode {
  const cls =
    props.status === 'succeeded'
      ? 'badge badge--success'
      : props.status === 'failed' || props.status === 'dead_lettered'
        ? 'badge badge--danger'
        : 'badge badge--warning';
  return <span className={cls}>{props.status}</span>;
}

function CreateWebhookForm(props: {
  onSubmit: (input: { name: string; url: string; eventTypes: string[] }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (event: string): void => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || !url.trim() || events.size === 0) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        url: url.trim(),
        eventTypes: Array.from(events),
      });
      setName('');
      setUrl('');
      setEvents(new Set());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <div className="field">
        <label htmlFor="webhook-name">Name</label>
        <input
          id="webhook-name"
          className="input"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder="e.g. ERP order sync"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="webhook-url">Receiver URL</label>
        <input
          id="webhook-url"
          className="input"
          type="url"
          value={url}
          onChange={(e): void => setUrl(e.target.value)}
          placeholder="https://example.com/hooks"
          required
        />
      </div>
      <div className="field">
        <label>Events</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {KNOWN_EVENT_TYPES.map((event) => (
            <label
              key={event}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 'normal' }}
            >
              <input
                type="checkbox"
                checked={events.has(event)}
                onChange={(): void => toggle(event)}
              />
              <span className="code">{event}</span>
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        className="btn btn--primary"
        disabled={submitting || !name.trim() || !url.trim() || events.size === 0}
      >
        {submitting ? 'Creating…' : 'Subscribe'}
      </button>
    </form>
  );
}
