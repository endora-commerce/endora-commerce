import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyOrders } from '../../../../lib/api/orders';
import {
  createReturnCase,
  getReturnable,
  listReturnReasons,
  type CreateReturnCaseInput,
} from '../../../../lib/api/returns';
import { getSessionCookie } from '../../../../lib/session';

/**
 * New return/complaint submission (feature 046, US1). Without an `orderId` the
 * customer picks an order; with one, eligible lines are shown for selection.
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/returns/new');
  const { orderId } = await searchParams;

  // Step 1 — choose an order.
  if (!orderId) {
    const orders = await listMyOrders(session);
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>Start a return</h1>
        <p>Choose the order you want to return items from:</p>
        {orders.length === 0 ? (
          <p>You don&apos;t have any orders yet.</p>
        ) : (
          <ul>
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/returns/new?orderId=${o.id}`}>
                  {o.businessId} — {new Date(o.placedAt).toLocaleDateString()}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link href="/returns">← Back to returns</Link>
        </p>
      </div>
    );
  }

  // Step 2 — pick lines + reasons.
  const [returnable, reasons] = await Promise.all([
    getReturnable(session, orderId),
    listReturnReasons(session),
  ]);

  if (!returnable.eligible) {
    const message =
      returnable.reason === 'order_not_completing'
        ? 'This order is not yet eligible for returns.'
        : returnable.reason === 'fully_returned'
          ? 'All items from this order have already been returned.'
          : 'This order is not eligible for returns.';
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>Start a return</h1>
        <p>{message}</p>
        <p>
          <Link href="/returns/new">← Choose another order</Link>
        </p>
      </div>
    );
  }

  const linesById = new Map(returnable.lines.map((l) => [l.orderItemId, l]));

  async function submit(formData: FormData): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) redirect('/login?next=/returns/new');
    const kind = (String(formData.get('kind') ?? 'return') === 'complaint' ? 'complaint' : 'return') as
      | 'return'
      | 'complaint';
    const lines: CreateReturnCaseInput['lines'] = [];
    for (const [orderItemId, line] of linesById) {
      if (formData.get(`include_${orderItemId}`) == null) continue;
      const quantity = Math.min(
        Math.max(1, Number(formData.get(`qty_${orderItemId}`) ?? 1)),
        line.remainingReturnableQty,
      );
      const reasonId = String(formData.get(`reason_${orderItemId}`) ?? '');
      if (!reasonId) continue;
      lines.push({ orderItemId, quantity, reasonId });
    }
    if (lines.length === 0) redirect(`/returns/new?orderId=${orderId}`);
    const comment = String(formData.get('comment') ?? '').trim();
    const created = await createReturnCase(s, {
      orderId: orderId!,
      kind,
      lines,
      ...(comment ? { comment } : {}),
    });
    redirect(`/returns/${created.id}`);
  }

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>Start a return</h1>
      {returnable.freeReturnEligible ? (
        <p className="muted">This order is within the free-return window.</p>
      ) : null}
      <form action={submit} className="b2b-auth__form">
        <label htmlFor="kind">Type</label>
        <select id="kind" name="kind" defaultValue="return">
          <option value="return">Return</option>
          <option value="complaint">Complaint</option>
        </select>

        <table className="b2b-account__table">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Qty</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {returnable.lines
              .filter((l) => l.remainingReturnableQty > 0)
              .map((l) => (
                <tr key={l.orderItemId}>
                  <td>
                    <input type="checkbox" name={`include_${l.orderItemId}`} />
                  </td>
                  <td>{l.name}</td>
                  <td>
                    <input
                      type="number"
                      name={`qty_${l.orderItemId}`}
                      min={1}
                      max={l.remainingReturnableQty}
                      defaultValue={1}
                      style={{ width: '4rem' }}
                    />
                    <span className="muted"> / {l.remainingReturnableQty}</span>
                  </td>
                  <td>
                    <select name={`reason_${l.orderItemId}`} defaultValue="">
                      <option value="">Select…</option>
                      {reasons.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label['en'] ?? Object.values(r.label)[0]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        <label htmlFor="comment">Additional details (optional)</label>
        <textarea id="comment" name="comment" maxLength={2000} />

        <button type="submit">Submit return request</button>
      </form>
      <p>
        <Link href="/returns/new">← Choose another order</Link>
      </p>
    </div>
  );
}
