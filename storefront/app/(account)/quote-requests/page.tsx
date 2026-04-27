import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listRfqs, type RfqSummary } from '../../../lib/api/rfq';
import { getSessionCookie } from '../../../lib/session';

/**
 * Customer RFQ list (T088). The list groups by status — drafts first
 * (still actionable), then awaiting/quoted (waiting on either side),
 * then closed (accepted / rejected / expired). Buyers click through to
 * the detail page; the active draft is also linked from the PDP widget.
 */

const ACTIVE_STATUSES: RfqSummary['status'][] = ['draft', 'submitted', 'in_review', 'quoted'];

export default async function QuoteRequestsPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/quote-requests');
  const rfqs = await listRfqs(session);

  const active = rfqs.filter((r) => ACTIVE_STATUSES.includes(r.status));
  const closed = rfqs.filter((r) => !ACTIVE_STATUSES.includes(r.status));

  return (
    <>
      <h2>Quote requests</h2>
      <p className="b2b-auth__hint">
        <Link href="/quote-requests/current">Open my draft</Link> · {' '}
        <Link href="/catalog">Browse products to add</Link>
      </p>

      {active.length === 0 && closed.length === 0 ? (
        <p>You don&apos;t have any quote requests yet.</p>
      ) : null}

      {active.length > 0 ? <RfqTable title="In progress" rfqs={active} /> : null}
      {closed.length > 0 ? <RfqTable title="Closed" rfqs={closed} /> : null}
    </>
  );
}

function RfqTable({ title, rfqs }: { title: string; rfqs: RfqSummary[] }): ReactNode {
  return (
    <>
      <h3>{title}</h3>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>RFQ</th>
            <th>Items</th>
            <th>Status</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rfqs.map((r) => (
            <tr key={r.id}>
              <td>{r.id.slice(0, 8)}</td>
              <td>{r.items.length}</td>
              <td>{r.status}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                <Link href={`/quote-requests/${r.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
