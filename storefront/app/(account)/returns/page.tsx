import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyReturns } from '../../../lib/api/returns';
import { getSessionCookie } from '../../../lib/session';

/**
 * Returns / RMA history (feature 046, US1). The backend enforces ownership:
 * the customer sees only their own cases.
 */
export default async function ReturnsListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/returns');
  const cases = await listMyReturns(session);

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>Returns &amp; complaints</h1>
      <p>
        <Link href="/returns/new">Start a new return</Link>
      </p>
      {cases.length === 0 ? (
        <p>You don&apos;t have any returns yet.</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>RMA</th>
              <th>Kind</th>
              <th>Status</th>
              <th className="text-right">Refund</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.submittedAt).toLocaleDateString()}</td>
                <td>{c.rmaNumber ?? '—'}</td>
                <td>{c.kind}</td>
                <td>{c.statusLabel}</td>
                <td className="text-right">
                  {c.totalRefundAmount.toFixed(2)} {c.currency}
                </td>
                <td>
                  <Link href={`/returns/${c.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
