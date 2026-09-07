import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../lib/session';
import { getMe } from '../../../lib/api/account';
import { getMyCreditLimit } from '../../../lib/api/credit-limit';
import { CreditLimitWidget } from '../../../components/CreditLimitWidget';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Account profile (T154). Read-only summary of the current customer +
 * their organization role. Profile-edit is intentionally out of scope for
 * MVP — buyers update their name via support to keep audit trails simple.
 */
export default async function AccountProfilePage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const [me, creditLimit] = await Promise.all([getMe(session), getMyCreditLimit(session)]);

  return (
    <>
      <h2>Your profile</h2>
      {creditLimit ? (
        <div className="mb-[16px]">
          <CreditLimitWidget limit={creditLimit} showReservations />
        </div>
      ) : null}
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">Name</th>
            <td>
              {me.customerAccount.firstName} {me.customerAccount.lastName}
            </td>
          </tr>
          <tr>
            <th scope="row">Email</th>
            <td>
              {me.customerAccount.email}{' '}
              {me.customerAccount.emailVerifiedAt ? (
                <span className="muted">(verified)</span>
              ) : (
                <span className="muted">(unverified)</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">Role</th>
            <td>{me.customerAccount.role}</td>
          </tr>
          <tr>
            <th scope="row">Two-factor</th>
            <td>{me.customerAccount.twoFactorEnabled ? 'Enabled' : 'Disabled'}</td>
          </tr>
          <tr>
            <th scope="row">Organization</th>
            <td>{me.organization?.name ?? '—'}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
