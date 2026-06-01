import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import {
  listOrganizationCarts,
  type OrgCartSummary,
} from '../../../../lib/api/cart';
import { getSessionCookie, getAnonCartCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';

/**
 * Organization-Administrator visibility view (feature 027 US4).
 *
 * Lists every cart owned by a member of the caller's Organization.
 * The role gate is enforced by the backend (`CustomerAccount.role ===
 * 'organization_admin'`); ordinary members hitting this URL get a 403
 * which we surface as an inline message.
 *
 * Browser-verification note: layout + status-badge styling needs eyes.
 * The data flow is a plain server-side fetch.
 */
export default async function OrganizationCartsPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const me = await getMe(session);
  if (!me.organization) redirect('/account');
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>Organization carts</h2>
        <p className="b2b-auth__error">
          Only Organization Administrators can see this page.
        </p>
      </>
    );
  }

  const anon = await getAnonCartCookie();
  let carts: OrgCartSummary[] = [];
  let loadError: string | null = null;
  try {
    const res = await listOrganizationCarts({
      ...(session ? { session } : {}),
      ...(anon ? { anon } : {}),
    });
    carts = res.data;
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not load organization carts.';
  }

  return (
    <>
      <h2>Organization carts</h2>
      <p className="b2b-auth__hint">
        Every cart in the {me.organization.name} organization — including
        members' active carts, pending-approval submissions, and historical
        ones.
      </p>

      {loadError ? <p className="b2b-auth__error">{loadError}</p> : null}

      {carts.length === 0 ? (
        <p>No carts yet.</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>Owner</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Items</th>
              <th>Total</th>
              <th>Last activity</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => (
              <tr key={cart.id}>
                <td>{cart.ownerDisplayName}</td>
                <td>
                  <span className={`b2b-cart-status b2b-cart-status--${cart.status}`}>
                    {cart.status}
                  </span>
                </td>
                <td>
                  <span
                    className={`b2b-cart-approval b2b-cart-approval--${cart.approvalStatus}`}
                  >
                    {cart.approvalStatus}
                  </span>
                </td>
                <td>{cart.itemCount}</td>
                <td>
                  {cart.total.amount.toFixed(2)} {cart.total.currency}
                </td>
                <td>{new Date(cart.lastActivityAt).toLocaleString()}</td>
                <td>
                  {cart.submittedForApprovalAt
                    ? new Date(cart.submittedForApprovalAt).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
