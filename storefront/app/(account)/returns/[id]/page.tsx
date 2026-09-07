import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { addReturnComment, getMyReturn } from '../../../../lib/api/returns';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Return / RMA case detail + conversation (feature 046, US1/US4).
 */
export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) redirect(`/login?next=/returns/${id}`);

  let detail;
  try {
    detail = await getMyReturn(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) redirect('/returns');
    throw err;
  }

  async function addComment(formData: FormData): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) redirect(`/login?next=/returns/${id}`);
    const body = String(formData.get('body') ?? '').trim();
    if (body) {
      await addReturnComment(s, id, body);
      revalidatePath(`/returns/${id}`);
    }
  }

  const isTerminal = ['rejected', 'closed', 'cancelled'].includes(detail.statusCode);

  return (
    <div className="b2b-auth max-w-[720px]">
      <p>
        <Link href="/returns">← Back to returns</Link>
      </p>
      <h1>{detail.rmaNumber ?? 'Return case'}</h1>
      <p>
        Status: <strong>{detail.statusLabel}</strong> · {detail.kind}
      </p>
      {detail.rejectionReason ? <p className="muted">Rejection reason: {detail.rejectionReason}</p> : null}

      <h2>Items</h2>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th className="text-right">Refund</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.id}>
              <td>{it.productName}</td>
              <td>{it.quantity}</td>
              <td className="text-right">{it.approvedRefundAmount.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Conversation</h2>
      {detail.comments.length === 0 ? (
        <p>No messages yet.</p>
      ) : (
        <ul className="b2b-account__comments">
          {detail.comments.map((c) => (
            <li key={c.id}>
              <span className="muted">
                {c.authorKind} · {new Date(c.createdAt).toLocaleString()}
              </span>
              <div>{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      {!isTerminal ? (
        <form action={addComment} className="b2b-auth__form">
          <label htmlFor="body">Add a message</label>
          <textarea id="body" name="body" required maxLength={2000} />
          <button type="submit">Send</button>
        </form>
      ) : (
        <p className="muted">This case is closed.</p>
      )}
    </div>
  );
}
