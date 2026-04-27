import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  acceptRfq,
  getCurrentRfq,
  getRfqById,
  rejectRfq,
  removeRfqItem,
  submitRfq,
  updateRfqItem,
  type RfqSummary,
} from '../../../../lib/api/rfq';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';

/**
 * RFQ detail (T087). Three modes share one page:
 *   - draft: items are editable (qty, note, remove); a Submit button moves
 *     the draft into review.
 *   - quoted: the supplier has filled in unit prices + terms; the buyer
 *     can Accept (which spawns an Order on the backend) or Reject.
 *   - everything else: read-only summary.
 *
 * `[id]` accepts the literal `current` so the PDP widget can deep-link
 * the buyer into their open draft.
 */

export default async function QuoteRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; status?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) redirect(`/login?next=/account/quote-requests/${id}`);
  const sp = await searchParams;

  let rfq: RfqSummary;
  try {
    rfq = id === 'current' ? await getCurrentRfq(session) : await getRfqById(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div>
          <h2>Quote request not found</h2>
          <p className="b2b-auth__error">We couldn&apos;t find that quote request.</p>
        </div>
      );
    }
    throw err;
  }

  const isDraft = rfq.status === 'draft';
  const isQuoted = rfq.status === 'quoted';

  return (
    <>
      <h2>
        Quote request <span className="muted">{rfq.id.slice(0, 8)}</span>
      </h2>
      <p>
        Status: <strong>{rfq.status}</strong>
        {rfq.expiresAt ? <> · expires {new Date(rfq.expiresAt).toLocaleDateString()}</> : null}
      </p>
      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {sp.status === 'submitted' ? (
        <p className="b2b-auth__success">Submitted — we&apos;ll email you when the supplier replies.</p>
      ) : null}
      {sp.status === 'accepted' ? (
        <p className="b2b-auth__success">Quote accepted. Check Orders for the new order.</p>
      ) : null}
      {sp.status === 'rejected' ? (
        <p className="b2b-auth__success">Quote rejected.</p>
      ) : null}

      <h3>Items</h3>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Note</th>
            <th>Quoted unit</th>
            {isDraft ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {rfq.items.map((it) => (
            <tr key={it.id}>
              <td>
                <Link href={`/p/${it.productId}`}>{it.productName}</Link>
                {it.variantLabel ? (
                  <>
                    <br />
                    <span className="muted">{it.variantLabel}</span>
                  </>
                ) : null}
              </td>
              <td>
                {isDraft ? (
                  <form
                    action={updateItemAction}
                    style={{ display: 'inline-flex', gap: '0.25rem' }}
                  >
                    <input type="hidden" name="rfqId" value={rfq.id} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <input
                      type="number"
                      name="quantity"
                      min={1}
                      max={9999}
                      defaultValue={it.quantity}
                      style={{ width: '4rem' }}
                    />
                    <button type="submit">Save</button>
                  </form>
                ) : (
                  it.quantity
                )}
              </td>
              <td>{it.requesterNote ?? ''}</td>
              <td>
                {it.quotedUnitPrice != null ? it.quotedUnitPrice.toFixed(2) : '—'}
                {it.quotedDiscountPercent != null ? (
                  <>
                    <br />
                    <span className="muted">−{it.quotedDiscountPercent.toFixed(1)}%</span>
                  </>
                ) : null}
              </td>
              {isDraft ? (
                <td>
                  <form action={removeItemAction}>
                    <input type="hidden" name="rfqId" value={rfq.id} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <button type="submit">Remove</button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
          {rfq.items.length === 0 ? (
            <tr>
              <td colSpan={isDraft ? 5 : 4}>
                <em>No items yet.</em>{' '}
                <Link href="/catalog">Browse the catalog</Link> and use{' '}
                <strong>Request a quote</strong> on any product.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {rfq.quoteTerms ? (
        <>
          <h3>Quote terms</h3>
          <ul>
            <li>Lead time: {rfq.quoteTerms.leadTimeDays} day(s)</li>
            <li>Validity: {rfq.quoteTerms.validityDays} day(s)</li>
            {rfq.quoteTerms.deliveryTerms ? (
              <li>Delivery terms: {rfq.quoteTerms.deliveryTerms}</li>
            ) : null}
            {rfq.quoteTerms.remarks ? <li>Remarks: {rfq.quoteTerms.remarks}</li> : null}
          </ul>
        </>
      ) : null}

      {isDraft && rfq.items.length > 0 ? (
        <form action={submitAction} className="b2b-auth__form">
          <input type="hidden" name="rfqId" value={rfq.id} />
          <div className="b2b-auth__field">
            <label htmlFor="rfq-note">Note for the seller (optional)</label>
            <textarea id="rfq-note" name="requesterNote" rows={3} maxLength={4000} />
          </div>
          <div className="b2b-auth__actions">
            <button type="submit">Submit for review</button>
          </div>
        </form>
      ) : null}

      {isQuoted ? (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <form action={acceptAction}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <button type="submit">Accept quote</button>
          </form>
          <form action={rejectAction} style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <select name="reason" defaultValue="price">
              <option value="price">Price</option>
              <option value="terms">Terms</option>
              <option value="other">Other</option>
            </select>
            <input name="message" placeholder="Optional message" maxLength={4000} />
            <button type="submit">Reject</button>
          </form>
        </div>
      ) : null}
    </>
  );
}

async function updateItemAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const itemId = (formData.get('itemId') as string) ?? '';
  const rfqId = (formData.get('rfqId') as string) ?? '';
  const quantity = Number(formData.get('quantity') ?? '0');
  if (!Number.isFinite(quantity) || quantity < 1) {
    redirect(`/quote-requests/${rfqId}?error=invalid-quantity`);
  }
  try {
    await updateRfqItem(session, itemId, { quantity });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not update item.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quote-requests/${rfqId}`);
}

async function removeItemAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const itemId = (formData.get('itemId') as string) ?? '';
  const rfqId = (formData.get('rfqId') as string) ?? '';
  try {
    await removeRfqItem(session, itemId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not remove item.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quote-requests/${rfqId}`);
}

async function submitAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const rfqId = (formData.get('rfqId') as string) ?? '';
  const note = (formData.get('requesterNote') as string | null) || undefined;
  let submitted: RfqSummary | null = null;
  try {
    submitted = await submitRfq(session, note ? { requesterNote: note } : undefined);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not submit.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quote-requests/${submitted!.id}?status=submitted`);
}

async function acceptAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const rfqId = (formData.get('rfqId') as string) ?? '';
  try {
    await acceptRfq(session, rfqId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not accept.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quote-requests/${rfqId}?status=accepted`);
}

async function rejectAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const rfqId = (formData.get('rfqId') as string) ?? '';
  const reason = ((formData.get('reason') as string) ?? 'other') as 'price' | 'terms' | 'other';
  const message = (formData.get('message') as string | null) || undefined;
  try {
    await rejectRfq(session, rfqId, { reason, ...(message ? { message } : {}) });
  } catch (err) {
    const m = err instanceof StorefrontApiError ? err.message : 'Could not reject.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(m)}`);
  }
  redirect(`/quote-requests/${rfqId}?status=rejected`);
}
