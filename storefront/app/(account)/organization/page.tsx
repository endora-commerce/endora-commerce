import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../lib/session';
import { getMe } from '../../../lib/api/account';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Organization summary (T155). Read-only view of the registered org —
 * admin tools (members + addresses) live in nested routes.
 */
export default async function OrganizationPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const me = await getMe(session);
  const o = me.organization;
  if (!o) redirect('/account');
  return (
    <>
      <h2>{o.name}</h2>
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">Tax ID</th>
            <td>{o.taxId}</td>
          </tr>
          <tr>
            <th scope="row">Status</th>
            <td>{o.status}</td>
          </tr>
          <tr>
            <th scope="row">VAT status</th>
            <td>{o.vatStatus}</td>
          </tr>
          <tr>
            <th scope="row">Registered address</th>
            <td>
              {o.registeredAddress.street}
              <br />
              {o.registeredAddress.postalCode} {o.registeredAddress.city}
              <br />
              {o.registeredAddress.country}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
