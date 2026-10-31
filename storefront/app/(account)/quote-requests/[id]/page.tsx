import type { ReactNode } from 'react';
import {
  acceptRevision,
  convertRfqToOrder,
  getRfqById,
  rejectRevision,
  resubmitRfq,
  type RfqDetail,
  type RfqStatus,
} from '../../../../lib/api/rfq';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { formatMoney } from '../../../../lib/i18n/money';
import { rfqValidity, rfqValidityGate } from '../../../../lib/quote-requests/validity';
import { RfqValidityMeta } from '../../../../components/rfq/RfqValidityMeta';
import { RfqDetailActions } from '../../../../components/rfq/RfqDetailActions';
import { lineAmountHalfUp, unitPriceDisplayText } from '@endora-commerce/contracts';
import { GroupedLineRows, quoteSectionTotals } from '../../../../components/line-groups/GroupedLineRows';
import { describeRfqDiff } from '../../../../lib/quote-requests/describe-diff';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { quoteRequestEventLabel, quoteRequestStatusLabel } from '../../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Customer Quote Request detail (feature 008 / T034). Mode-driven UI:
 *   - Pending without revision flag → read-only summary + "Submit again".
 *   - Pending or Created from admin with awaiting flag → comparison
 *     view + Accept / Reject revision buttons.
 *   - Approved / Completed / Canceled / Expired → read-only summary.
 *
 * Approve-revision and reject-revision are server actions that hand
 * the request to `/api/v1/quote-requests/:id/{accept,reject}-revision`
 * with `expectedRevisionNumber`.
 *
 * Since !1137 the operator's per-request validity deadline is a rule: past
 * `expiresAt`, accept-revision answers 410 `RFQ_EXPIRED` and convert-to-order
 * 410 `QUOTE_VALIDITY_ENDED`. Nothing here rendered `expiresAt` at all, so the
 * buyer's first sight of the deadline was the refusal. The date now renders
 * first — in the header meta, unconditionally, whatever the status — and only
 * then do the two controls it binds refuse to be pressed, with the reason and
 * the remedy in text beside them.
 *
 * The classification runs on the **server's** clock, because this is a Server
 * Component and there is no client boundary here that could substitute the
 * buyer's. See `lib/quote-requests/validity.ts`.
 */
export default async function QuoteRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) return await localeRedirect(`/login?next=/quote-requests/${id}`);

  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  let rfq: RfqDetail;
  try {
    rfq = await getRfqById(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 48 }}>
          <p className="muted">{t('account.quoteRequest.notFound')}</p>
          <LocalizedLink href="/quote-requests" className="btn btn--outline btn--sm">
            {t('account.quoteRequest.backToList')}
          </LocalizedLink>
        </div>
      );
    }
    throw err;
  }
  const sp = await searchParams;
  // The server's clock, taken once so the meta sentence and the gate below it
  // cannot disagree about which side of the deadline this render is on.
  const now = new Date();
  const validity = rfqValidity(rfq.expiresAt, now);
  const gate = rfqValidityGate({
    status: rfq.status,
    awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
    validity,
  });

  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';
  // Quote prices are net; surface VAT + gross. `rfq.taxRate` is the flat rate
  // resolved server-side from the organization's VAT status + tax rules. The
  // section rule, for the whole quote: agreed prices on every line, else desired
  // prices on every line, VAT on the net total — exact (issue #417).
  const taxRate = rfq.taxRate ?? 0;
  const totals = quoteSectionTotals(rfq.items, taxRate);
  const total = totals.net;
  const taxTotal = totals.vat;
  const grossTotal = totals.gross;
  const fmt = (n: number): string => formatMoney(n, currency);

  return (
    <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <LocalizedLink href="/quote-requests" className="btn btn--ghost btn--sm" style={{ marginBottom: 8 }}>
        {t('account.quoteRequest.backToList')}
      </LocalizedLink>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h1>{format(t('account.quoteRequest.heading'), { number: rfq.businessId })}</h1>
        <RfqStatusBadge
          status={rfq.status}
          awaiting={rfq.awaitingCustomerRevisionAcceptance}
          locale={locale}
        />
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        {format(t('account.quoteRequest.created'), { date: new Date(rfq.createdAt).toLocaleString(locale) })}
        {rfq.submittedAt
          ? ` · ${format(t('account.quoteRequest.submitted'), { date: new Date(rfq.submittedAt).toLocaleString(locale) })}`
          : null}
        {/*
          The deadline reads as a third instant of the same kind, beside the two
          the buyer already looks here for (Law of Proximity), and it renders on
          every status — a Completed or Canceled request still carries the date
          it was dated to, and hiding it would make the field look like one this
          page cannot show. It renders *nothing* when there is none: an absent
          `expiresAt` means the operator set no deadline and nothing refuses
          this buyer, and a blank where a date goes cannot be told apart from a
          date that failed to load.
        */}
        <RfqValidityMeta expiresAt={rfq.expiresAt} now={now} locale={locale} />
      </p>

      {sp.error ? (
        <p
          style={{
            background: 'var(--bad-50)',
            color: 'var(--bad-700)',
            padding: 10,
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--bad-100)',
            marginBottom: 18,
          }}
        >
          {sp.error}
        </p>
      ) : null}

      {rfq.cancellationReason ? (
        <p
          style={{
            background: 'var(--bad-50)',
            color: 'var(--bad-700)',
            padding: 10,
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--bad-100)',
            marginBottom: 18,
            fontSize: 13,
          }}
        >
          <strong>{t('account.quoteRequest.cancellationReason')} </strong>
          {rfq.cancellationReason}
        </p>
      ) : null}

      {rfq.headerNote ? (
        <p style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 18 }}>
          <strong>{t('account.quoteRequest.notes')} </strong>
          {rfq.headerNote}
        </p>
      ) : null}

      {rfq.awaitingCustomerRevisionAcceptance && rfq.comparisonAgainstLastSeen ? (
        <ComparisonBlock comparison={rfq.comparisonAgainstLastSeen} locale={locale} />
      ) : null}

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          overflow: 'hidden',
          marginBottom: 18,
        }}
      >
        <table className="industria-orders" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>{t('account.common.product')}</th>
              <th>{t('account.quoteRequest.col.quantity')}</th>
              <th>{t('account.quoteRequest.col.requestedPrice')}</th>
              <th>{t('account.quoteRequest.col.agreedPrice')}</th>
              <th>{t('account.common.total')}</th>
            </tr>
          </thead>
          <tbody>
            {/*
              Feature 159 — the groups the representative arranged, each headed
              and summarised by this page's own totals rule; a quote with no
              group renders exactly these rows.
            */}
            <GroupedLineRows
              groups={rfq.itemGroups ?? []}
              lines={rfq.items}
              columnCount={5}
              locale={locale}
              currency={currency}
              taxRate={taxRate}
              renderRow={(it) => {
                const lineTotal =
                  it.agreedUnitPrice !== null
                    ? Number(lineAmountHalfUp(it.agreedUnitPrice, it.quantity))
                    : it.desiredUnitPrice !== null
                      ? Number(lineAmountHalfUp(it.desiredUnitPrice, it.quantity))
                      : null;
                return (
                  <tr key={it.id}>
                    <td>
                      <strong>{it.productName}</strong>
                      {it.lineNote ? <div className="muted" style={{ fontSize: 11 }}>{it.lineNote}</div> : null}
                    </td>
                    <td>{it.quantity}</td>
                    {/* Unit prices: their significant places, up to four (owner ruling of 2026-10-25). */}
                    <td>{it.desiredUnitPrice !== null ? unitPriceDisplayText(it.desiredUnitPrice) : '—'}</td>
                    <td>{it.agreedUnitPrice !== null ? unitPriceDisplayText(it.agreedUnitPrice) : '—'}</td>
                    <td style={{ fontWeight: 600 }}>
                      {lineTotal !== null ? formatMoney(lineTotal, it.lineCurrency) : '—'}
                    </td>
                  </tr>
                );
              }}
            />
          </tbody>
          {total !== null ? (
            <tfoot>
              {taxRate > 0 ? (
                <>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}>
                      {t('account.quoteRequest.totals.net')}
                    </td>
                    <td>
                      {fmt(total)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}>
                      {format(t('account.quoteRequest.totals.vat'), { rate: (taxRate * 100).toFixed(0) })}
                    </td>
                    <td>
                      {fmt(taxTotal ?? 0)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <th colSpan={4} style={{ textAlign: 'right' }}>
                  {taxRate > 0 ? t('account.quoteRequest.totals.gross') : t('account.common.total')}
                </th>
                <th>
                  {fmt(grossTotal ?? total)}
                </th>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/*
        The action row is a component so that the one thing this change decides
        — which controls refuse to be pressed, and whether the reason is on
        screen beside them — is assertable from rendered markup. This page is an
        async Server Component that reads a session and calls the API; the
        storefront harness is SSR-only.
      */}
      <RfqDetailActions
        rfqId={rfq.id}
        status={rfq.status}
        currentRevisionNumber={rfq.currentRevisionNumber}
        awaitingCustomerRevisionAcceptance={rfq.awaitingCustomerRevisionAcceptance}
        gate={gate}
        locale={locale}
        acceptAction={acceptAction}
        rejectAction={rejectAction}
        convertAction={convertAction}
        resubmitAction={resubmitAction}
      />

      {rfq.events.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <h2>{t('account.quoteRequest.history')}</h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '12px 0 0',
              borderLeft: '2px solid var(--line)',
            }}
          >
            {rfq.events.map((e) => (
              <li
                key={e.id}
                style={{ padding: '10px 0 10px 16px', borderBottom: '1px dashed var(--line)' }}
              >
                <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                  {new Date(e.createdAt).toLocaleString(locale)}
                  {e.actorRoleLabel ? ` · ${e.actorRoleLabel}` : null}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{quoteRequestEventLabel(t, e.eventType)}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ComparisonBlock({
  comparison,
  locale,
}: {
  comparison: NonNullable<RfqDetail['comparisonAgainstLastSeen']>;
  locale: string;
}): ReactNode {
  if (comparison.diff.length === 0) return null;
  return (
    <div
      style={{
        background: 'var(--brand-50)',
        border: '1px solid var(--brand-100)',
        borderRadius: 'var(--r-md)',
        padding: 16,
        marginBottom: 18,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 8 }}>
        {tForLocale(locale)('account.quoteRequest.changesSinceLastVisit')}
      </strong>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {comparison.diff.map((d, i) => (
          <li key={i}>{describeRfqDiff(d, locale)}</li>
        ))}
      </ul>
    </div>
  );
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

/** A server action's own refusal, in the page's language. */
async function failure(key: MessageKey): Promise<string> {
  const { locale } = await getServerContext();
  return tForLocale(locale)(key);
}

async function acceptAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const expectedRevisionNumber = Number(formData.get('expectedRevisionNumber'));
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await acceptRevision(session, rfqId, expectedRevisionNumber);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.detail : await failure('account.quoteRequest.acceptFailed');
    return await localeRedirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
  return await localeRedirect(`/quote-requests/${rfqId}`);
}

async function rejectAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const expectedRevisionNumber = Number(formData.get('expectedRevisionNumber'));
  const reason = (formData.get('reason') as string | null) ?? undefined;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await rejectRevision(session, rfqId, expectedRevisionNumber, reason || undefined);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.detail : await failure('account.quoteRequest.rejectFailed');
    return await localeRedirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
  return await localeRedirect(`/quote-requests/${rfqId}`);
}

async function convertAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    const { checkoutUrl } = await convertRfqToOrder(session, rfqId);
    return await localeRedirect(checkoutUrl);
  } catch (err) {
    if (err instanceof StorefrontApiError) {
      return await localeRedirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(err.detail)}`);
    }
    throw err;
  }
}

async function resubmitAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    const created = await resubmitRfq(session, rfqId);
    return await localeRedirect(`/quote-requests/${created.id}`);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.detail : await failure('account.quoteRequest.resubmitFailed');
    return await localeRedirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
}
