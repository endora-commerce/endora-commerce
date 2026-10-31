import type { ReactNode } from 'react';
import { listRfqs, type RfqStatus, type RfqSummary } from '../../../lib/api/rfq';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { formatMoney } from '../../../lib/i18n/money';
import { RfqValidityMeta } from '../../../components/rfq/RfqValidityMeta';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';
import { quoteRequestStatusLabel } from '../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Customer Quote Requests list (feature 008 / T033). Renders every
 * RFQ visible to the caller with status, line count, total at the
 * customer's price list, and a deep-link to the detail page.
 *
 * `RfqSummary.expiresAt` has been on the wire since feature 008 and was
 * rendered by nothing; !1137 turned it into a rule the buyer is refused by. It
 * now rides in the status cell rather than in a column of its own: most
 * requests carry no deadline at all, and a column would put a blank in every
 * one of their rows — which is exactly the "empty field where a date goes"
 * that an absent deadline must not be rendered as. As a line attached to the
 * status it is simply absent when there is nothing to say, and it sits with
 * the other fact about where this request stands (Law of Proximity).
 */
export default async function QuoteRequestsPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/quote-requests');
  const rfqs = await listRfqs(session);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  // One instant for the whole table, so two rows dated a millisecond apart
  // cannot be classified against two different "now"s.
  const now = new Date();

  return (
    <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 18,
        }}
      >
        <h1>{t('account.quoteRequests.heading')}</h1>
        <LocalizedLink href="/catalog" className="btn btn--outline btn--sm">
          {t('account.common.browseCatalog')}
        </LocalizedLink>
      </div>

      {rfqs.length === 0 ? (
        <p className="muted">{t('account.quoteRequests.empty')}</p>
      ) : (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          <table className="industria-orders" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>{t('account.quoteRequests.col.number')}</th>
                <th>{t('account.quoteRequests.col.date')}</th>
                <th>{t('account.quoteRequests.col.lines')}</th>
                <th>{t('account.quoteRequests.col.value')}</th>
                <th>{t('account.common.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>#{r.businessId}</strong>
                  </td>
                  <td>{new Date(r.createdAt).toLocaleDateString(locale)}</td>
                  <td>{r.lineCount}</td>
                  <td style={{ fontWeight: 600 }}>{formatTotal(r)}</td>
                  <td>
                    <RfqStatusBadge
                      status={r.status}
                      awaiting={r.awaitingCustomerRevisionAcceptance}
                      locale={locale}
                    />
                    <RfqValidityMeta
                      expiresAt={r.expiresAt}
                      now={now}
                      locale={locale}
                      display="block"
                    />
                  </td>
                  <td>
                    <LocalizedLink
                      href={`/quote-requests/${r.id}`}
                      className="btn btn--outline btn--sm"
                    >
                      {t('account.quoteRequests.details')}
                    </LocalizedLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTotal(r: RfqSummary): string {
  const total = r.totalAtAgreedPrice ?? r.totalAtCustomerPrice;
  if (total === null) return '—';
  return formatMoney(total, r.currency);
}

function RfqStatusBadge({
  status,
  awaiting,
  locale,
}: {
  status: RfqStatus;
  awaiting: boolean;
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  if (awaiting) {
    return (
      <span className="industria-status industria-status--processing">
        {t('account.quoteRequestStatus.awaitingAcceptance')}
      </span>
    );
  }
  const tone: Record<RfqStatus, string> = {
    Pending: 'industria-status--processing',
    'Created from admin': 'industria-status--processing',
    Approved: 'industria-status--paid',
    Completed: 'industria-status--delivered',
    Canceled: 'industria-status--draft',
    Expired: 'industria-status--draft',
  };
  const cls = tone[status] ?? 'industria-status--draft';
  return <span className={`industria-status ${cls}`}>{quoteRequestStatusLabel(t, status)}</span>;
}
