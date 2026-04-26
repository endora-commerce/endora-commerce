import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Admin RFQ detail (T092 / FR-019..FR-026). Three actions:
 *   - Claim: assigns the row to the current admin (no-op when already
 *     claimed).
 *   - Send quote: per-item unit price + optional discount, plus required
 *     lead-time + validity terms; submits the whole quote in one POST.
 *   - Decline: a free-text message; the buyer sees it on the storefront.
 */

interface AdminRfqItem {
  id: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  requesterNote: string | null;
  quotedUnitPrice: number | null;
  quotedDiscountPercent: number | null;
}

interface AdminRfqDetail {
  id: string;
  organizationId: string;
  customerAccountId: string;
  assignedAdminUserId?: string;
  status: string;
  requesterNote: string | null;
  items: AdminRfqItem[];
  quoteTerms: {
    leadTimeDays: number;
    validityDays: number;
    deliveryTerms: string | null;
    remarks: string | null;
  } | null;
  submittedAt: string | null;
  quotedAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

interface QuoteLineDraft {
  unitPrice: string;
  discountPercent: string;
}

const QUOTABLE_STATUSES = ['submitted', 'in_review'];

export function RfqDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rfq, setRfq] = useState<AdminRfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, QuoteLineDraft>>({});
  const [terms, setTerms] = useState({
    leadTimeDays: '7',
    validityDays: '14',
    deliveryTerms: '',
    remarks: '',
  });
  const [declineMessage, setDeclineMessage] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${id}`,
      );
      const found = res.data;
      setRfq(found);
      const draft: Record<string, QuoteLineDraft> = {};
      for (const it of found.items) {
        draft[it.id] = {
          unitPrice: it.quotedUnitPrice != null ? String(it.quotedUnitPrice) : '',
          discountPercent:
            it.quotedDiscountPercent != null ? String(it.quotedDiscountPercent) : '',
        };
      }
      setLines(draft);
      if (found.quoteTerms) {
        setTerms({
          leadTimeDays: String(found.quoteTerms.leadTimeDays),
          validityDays: String(found.quoteTerms.validityDays),
          deliveryTerms: found.quoteTerms.deliveryTerms ?? '',
          remarks: found.quoteTerms.remarks ?? '',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setRfq(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load RFQ.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canQuote = useMemo(() => rfq && QUOTABLE_STATUSES.includes(rfq.status), [rfq]);

  const handleClaim = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    setError(null);
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/claim`,
        {},
      );
      setInfo('Claimed.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Claim failed.');
    }
  }, [rfq, refresh]);

  const handleSendQuote = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    setError(null);
    setInfo(null);
    const itemsPayload: Array<{
      itemId: string;
      quotedUnitPrice: number;
      quotedDiscountPercent?: number;
    }> = [];
    for (const it of rfq.items) {
      const draft = lines[it.id];
      const unit = Number(draft?.unitPrice);
      if (!Number.isFinite(unit) || unit < 0) {
        setError(`Item "${it.productName}": unit price is required and must be ≥ 0.`);
        return;
      }
      const disc = draft?.discountPercent ? Number(draft.discountPercent) : null;
      if (disc != null && (!Number.isFinite(disc) || disc < 0 || disc > 100)) {
        setError(`Item "${it.productName}": discount must be 0..100.`);
        return;
      }
      itemsPayload.push({
        itemId: it.id,
        quotedUnitPrice: unit,
        ...(disc != null ? { quotedDiscountPercent: disc } : {}),
      });
    }
    const lead = Number(terms.leadTimeDays);
    const valid = Number(terms.validityDays);
    if (!Number.isFinite(lead) || lead < 0) {
      setError('Lead time must be 0 days or more.');
      return;
    }
    if (!Number.isFinite(valid) || valid < 1) {
      setError('Validity must be at least 1 day.');
      return;
    }
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/quote`,
        {
          items: itemsPayload,
          terms: {
            leadTimeDays: lead,
            validityDays: valid,
            ...(terms.deliveryTerms ? { deliveryTerms: terms.deliveryTerms } : {}),
            ...(terms.remarks ? { remarks: terms.remarks } : {}),
          },
        },
      );
      setInfo('Quote sent — buyer will see it on their RFQ.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Send-quote failed.');
    }
  }, [rfq, lines, terms, refresh]);

  const handleDecline = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    if (!declineMessage.trim()) {
      setError('Decline message is required.');
      return;
    }
    if (!confirm('Decline this RFQ? The buyer will see your message.')) return;
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/decline`,
        { message: declineMessage },
      );
      setInfo('Declined.');
      setDeclineMessage('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Decline failed.');
    }
  }, [rfq, declineMessage, refresh]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!rfq) {
    return (
      <>
        <p className="alert alert--warning">RFQ not found.</p>
        <button
          className="btn"
          onClick={(): void => {
            navigate('/quote-requests');
          }}
        >
          Back to list
        </button>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>RFQ {rfq.id.slice(0, 8)}</h1>
          <p>
            Status <strong>{rfq.status}</strong>
            {rfq.expiresAt ? <> · expires {formatDateTime(rfq.expiresAt)}</> : null}
          </p>
        </div>
        <div>
          <Link className="btn" to="/quote-requests">
            Back
          </Link>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <div>
          <strong>Buyer</strong>
          <div className="muted">org {rfq.organizationId.slice(0, 8)} · user {rfq.customerAccountId.slice(0, 8)}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Assigned</strong>
          <div className="muted">
            {rfq.assignedAdminUserId ? rfq.assignedAdminUserId : 'unassigned'}
            {' · '}
            {!rfq.assignedAdminUserId && QUOTABLE_STATUSES.includes(rfq.status) ? (
              <button className="btn btn--primary" type="button" onClick={(): void => void handleClaim()}>
                Claim
              </button>
            ) : null}
          </div>
        </div>
        {rfq.requesterNote ? (
          <div style={{ marginTop: 8 }}>
            <strong>Requester note</strong>
            <p className="muted">{rfq.requesterNote}</p>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Items + quote</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Discount %</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((it) => (
              <tr key={it.id}>
                <td>
                  {it.productName}
                  {it.variantLabel ? (
                    <>
                      <br />
                      <span className="muted">{it.variantLabel}</span>
                    </>
                  ) : null}
                </td>
                <td>{it.quantity}</td>
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 110 }}
                    value={lines[it.id]?.unitPrice ?? ''}
                    onChange={(e): void =>
                      setLines((prev) => ({
                        ...prev,
                        [it.id]: {
                          unitPrice: e.target.value,
                          discountPercent: prev[it.id]?.discountPercent ?? '',
                        },
                      }))
                    }
                    disabled={!canQuote}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    style={{ width: 80 }}
                    value={lines[it.id]?.discountPercent ?? ''}
                    onChange={(e): void =>
                      setLines((prev) => ({
                        ...prev,
                        [it.id]: {
                          unitPrice: prev[it.id]?.unitPrice ?? '',
                          discountPercent: e.target.value,
                        },
                      }))
                    }
                    disabled={!canQuote}
                  />
                </td>
                <td className="muted">{it.requesterNote ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canQuote ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Quote terms</h2>
            <div className="field">
              <label htmlFor="lead">Lead time (days)</label>
              <input
                id="lead"
                className="input"
                type="number"
                min="0"
                value={terms.leadTimeDays}
                onChange={(e): void => setTerms((t) => ({ ...t, leadTimeDays: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="valid">Validity (days)</label>
              <input
                id="valid"
                className="input"
                type="number"
                min="1"
                value={terms.validityDays}
                onChange={(e): void => setTerms((t) => ({ ...t, validityDays: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="dterms">Delivery terms (optional)</label>
              <input
                id="dterms"
                className="input"
                value={terms.deliveryTerms}
                onChange={(e): void => setTerms((t) => ({ ...t, deliveryTerms: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="remarks">Remarks (optional)</label>
              <textarea
                id="remarks"
                className="input"
                rows={3}
                value={terms.remarks}
                onChange={(e): void => setTerms((t) => ({ ...t, remarks: e.target.value }))}
              />
            </div>
            <button className="btn btn--primary" type="button" onClick={(): void => void handleSendQuote()}>
              Send quote
            </button>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Decline</h2>
            <div className="field">
              <label htmlFor="dmsg">Message to the buyer</label>
              <textarea
                id="dmsg"
                className="input"
                rows={3}
                value={declineMessage}
                onChange={(e): void => setDeclineMessage(e.target.value)}
              />
            </div>
            <button className="btn btn--danger" type="button" onClick={(): void => void handleDecline()}>
              Decline RFQ
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
