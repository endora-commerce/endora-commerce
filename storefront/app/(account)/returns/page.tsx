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

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Returns / RMA history (feature 046, US1). The backend enforces ownership:
 * the customer sees only their own cases.
 */
export default async function ReturnsListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/returns');
  const cases = await listMyReturns(session);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('account.returns.heading')}</h1>
      <p>
        <LocalizedLink href="/returns/new">{t('account.returns.startNew')}</LocalizedLink>
      </p>
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
                <td>{c.rmaNumber ?? '—'}</td>
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
