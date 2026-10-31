import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../lib/session';
import { getMe } from '../../../lib/api/account';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';
import { codeLabel } from '../../../lib/account/labels';

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
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const o = me.organization;
  if (!o) return await localeRedirect('/account');
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return (
    <>
      <h2>{o.name}</h2>
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">{t('account.organization.taxId')}</th>
            <td>{o.taxId}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.common.status')}</th>
            <td>{codeLabel(t, 'account.organizationStatus', o.status)}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.organization.vatStatus')}</th>
            <td>{codeLabel(t, 'account.vatStatus', o.vatStatus)}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.organization.registeredAddress')}</th>
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
