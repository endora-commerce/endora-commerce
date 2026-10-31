import type { ReactNode } from 'react';
import {
  listOrganizationCarts,
  type OrgCartSummary,
} from '../../../../lib/api/cart';
import { getSessionCookie, getAnonCartCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import { formatMoney } from '../../../../lib/i18n/money';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { codeLabel } from '../../../../lib/account/labels';
import { format } from '../../../../lib/i18n/format';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  if (!me.organization) return await localeRedirect('/account');
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>{t('account.orgCarts.heading')}</h2>
        <p className="b2b-auth__error">{t('account.orgCarts.adminOnly')}</p>
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
    loadError = err instanceof Error ? err.message : t('account.orgCarts.loadFailed');
  }

  return (
    <>
      <h2>{t('account.orgCarts.heading')}</h2>
      <p className="b2b-auth__hint">
        {format(t('account.orgCarts.intro'), { organization: me.organization.name })}
      </p>

      {loadError ? <p className="b2b-auth__error">{loadError}</p> : null}

      {carts.length === 0 ? (
        <p>{t('account.orgCarts.empty')}</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('account.orgCarts.col.owner')}</th>
              <th>{t('account.common.status')}</th>
              <th>{t('account.orgCarts.col.approval')}</th>
              <th>{t('account.common.items')}</th>
              <th>{t('account.common.total')}</th>
              <th>{t('account.orgCarts.col.lastActivity')}</th>
              <th>{t('account.orgCarts.col.submitted')}</th>
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => (
              <tr key={cart.id}>
                <td>{cart.ownerDisplayName}</td>
                <td>
                  <span className={`b2b-cart-status b2b-cart-status--${cart.status}`}>
                    {codeLabel(t, 'account.cartStatus', cart.status)}
                  </span>
                </td>
                <td>
                  <span
                    className={`b2b-cart-approval b2b-cart-approval--${cart.approvalStatus}`}
                  >
                    {codeLabel(t, 'account.cartApprovalStatus', cart.approvalStatus)}
                  </span>
                </td>
                <td>{cart.itemCount}</td>
                <td>
                  {formatMoney(cart.total.amount, cart.total.currency)}
                </td>
                <td>{new Date(cart.lastActivityAt).toLocaleString(locale)}</td>
                <td>
                  {cart.submittedForApprovalAt
                    ? new Date(cart.submittedForApprovalAt).toLocaleString(locale)
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
