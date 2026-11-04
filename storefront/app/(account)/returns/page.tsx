import type { ReactNode } from 'react';
import { listMyReturns } from '../../../lib/api/returns';
import { getSessionCookie } from '../../../lib/session';
import { formatMoney } from '../../../lib/i18n/money';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';
import { codeLabel } from '../../../lib/account/labels';
import { getMe } from '../../../lib/api/account';
import { memberSession } from '../../../lib/commerce-permissions';
import { filedByColleague, mayStartReturn } from '../../../lib/returns/returnForm';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Returns / RMA history (feature 046, US1). The backend decides the reach: the
 * cases the member filed, or — for a role holding `returns.view_organization`
 * — every case of the Organization (feature 170, FR-053), a colleague's marked
 * as such. *Start a new return* is offered only with `returns.create` (FR-052,
 * FR-057); a session that cannot be read keeps today's page.
 */
export default async function ReturnsListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/returns');
  const [cases, me] = await Promise.all([listMyReturns(session), getMe(session).catch(() => null)]);
  const viewerId = me?.customerAccount.id;
  const mayStart = mayStartReturn(memberSession(me));
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('account.returns.heading')}</h1>
      {mayStart ? (
        <p>
          <LocalizedLink href="/returns/new">{t('account.returns.startNew')}</LocalizedLink>
        </p>
      ) : null}
      {cases.length === 0 ? (
        <p>{t('account.returns.empty')}</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('account.returns.col.submitted')}</th>
              <th>{t('account.returns.col.rma')}</th>
              <th>{t('account.returns.col.kind')}</th>
              <th>{t('account.common.status')}</th>
              <th className="text-right">{t('account.returns.col.refund')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.submittedAt).toLocaleDateString(locale)}</td>
                <td>
                  {c.rmaNumber ?? '—'}
                  {filedByColleague(c.customerAccountId, viewerId) ? (
                    <span className="block text-[12px] text-muted">{t('account.returns.filedByColleague')}</span>
                  ) : null}
                </td>
                <td>{codeLabel(t, 'returns.new.kind', c.kind)}</td>
                <td>{c.statusLabel}</td>
                <td className="text-right">
                  {formatMoney(c.totalRefundAmount, c.currency)}
                </td>
                <td>
                  <LocalizedLink href={`/returns/${c.id}`}>{t('account.common.open')}</LocalizedLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
