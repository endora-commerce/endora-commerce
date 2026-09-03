import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import type { Metadata } from 'next';

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
  if (!session) redirect(`/login?next=/quote-requests/${id}`);

  let rfq: RfqDetail;
  try {
    rfq = await getRfqById(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 48 }}>
          <p className="muted">Nie znaleziono zapytania ofertowego.</p>
          <Link href="/quote-requests" className="btn btn--outline btn--sm">
            ← Lista zapytań
          </Link>
        </div>
      );
    }
    throw err;
  }
  const sp = await searchParams;
  const { locale } = await getServerContext();
  // The server's clock, taken once so the meta sentence and the gate below it
  // cannot disagree about which side of the deadline this render is on.
  const now = new Date();
  const validity = rfqValidity(rfq.expiresAt, now);
  const gate = rfqValidityGate({
    status: rfq.status,
    awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
    validity,
  });

  const total = rfq.items.every((it) => it.agreedUnitPrice !== null)
    ? rfq.items.reduce((s, it) => s + (it.agreedUnitPrice ?? 0) * it.quantity, 0)
    : rfq.items.every((it) => it.desiredUnitPrice !== null)
      ? rfq.items.reduce((s, it) => s + (it.desiredUnitPrice ?? 0) * it.quantity, 0)
      : null;
  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';
  // Quote prices are net; surface VAT + gross. `rfq.taxRate` is the flat rate
  // resolved server-side from the organization's VAT status + tax rules.
  const taxRate = rfq.taxRate ?? 0;
  const taxTotal = total !== null ? total * taxRate : null;
  const grossTotal = total !== null && taxTotal !== null ? total + taxTotal : null;
  const fmt = (n: number): string => formatMoney(n, currency);

  return (
    <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 48 }}>
      <Link href="/quote-requests" className="btn btn--ghost btn--sm" style={{ marginBottom: 8 }}>
        ← Lista zapytań
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h1>Zapytanie #{rfq.businessId}</h1>
        <RfqStatusBadge
          status={rfq.status}
          awaiting={rfq.awaitingCustomerRevisionAcceptance}
        />
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
        Utworzone {new Date(rfq.createdAt).toLocaleString('pl-PL')}
        {rfq.submittedAt
          ? ` · zgłoszone ${new Date(rfq.submittedAt).toLocaleString('pl-PL')}`
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
          <strong>Powód anulowania: </strong>
          {rfq.cancellationReason}
        </p>
      ) : null}

      {rfq.headerNote ? (
        <p style={{ fontSize: 13, color: 'var(--ink-700)', marginBottom: 18 }}>
          <strong>Uwagi: </strong>
          {rfq.headerNote}
        </p>
      ) : null}

      {rfq.awaitingCustomerRevisionAcceptance && rfq.comparisonAgainstLastSeen ? (
        <ComparisonBlock comparison={rfq.comparisonAgainstLastSeen} />
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
              <th>Produkt</th>
              <th>Ilość</th>
              <th>Cena żądana</th>
              <th>Cena uzgodniona</th>
              <th>Razem</th>
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((it) => {
              const lineTotal =
                it.agreedUnitPrice !== null
                  ? it.agreedUnitPrice * it.quantity
                  : it.desiredUnitPrice !== null
                    ? it.desiredUnitPrice * it.quantity
                    : null;
              return (
                <tr key={it.id}>
                  <td>
                    <strong>{it.productName}</strong>
                    {it.lineNote ? <div className="muted" style={{ fontSize: 11 }}>{it.lineNote}</div> : null}
                  </td>
                  <td>{it.quantity}</td>
                  <td>{it.desiredUnitPrice !== null ? it.desiredUnitPrice.toFixed(2) : '—'}</td>
                  <td>{it.agreedUnitPrice !== null ? it.agreedUnitPrice.toFixed(2) : '—'}</td>
                  <td style={{ fontWeight: 600 }}>
                    {lineTotal !== null ? formatMoney(lineTotal, it.lineCurrency) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {total !== null ? (
            <tfoot>
              {taxRate > 0 ? (
                <>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}>
                      Suma netto
                    </td>
                    <td>
                      {fmt(total)}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}>
                      VAT ({(taxRate * 100).toFixed(0)}%)
                    </td>
                    <td>
                      {fmt(taxTotal ?? 0)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <th colSpan={4} style={{ textAlign: 'right' }}>
                  {taxRate > 0 ? 'Suma brutto' : 'Suma'}
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
          <h2>Historia zmian</h2>
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
                  {new Date(e.createdAt).toLocaleString('pl-PL')}
                  {e.actorRoleLabel ? ` · ${e.actorRoleLabel}` : null}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{describeEvent(e.eventType)}</div>
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
}: {
  comparison: NonNullable<RfqDetail['comparisonAgainstLastSeen']>;
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
        Co zmieniło się od Twojej ostatniej wizyty:
      </strong>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        {comparison.diff.map((d, i) => (
          <li key={i}>{describeDiff(d)}</li>
        ))}
      </ul>
    </div>
  );
}

function describeDiff(d: NonNullable<RfqDetail['comparisonAgainstLastSeen']>['diff'][number]): string {
  switch (d.kind) {
    case 'header_note':
      return `Uwagi: „${d.before ?? '—'}” → „${d.after ?? '—'}”`;
    case 'line_added':
      return `Dodano: ${d.productName} × ${d.quantity}${d.agreedUnitPrice !== null ? ` po ${d.agreedUnitPrice.toFixed(2)}` : ''}`;
    case 'line_removed':
      return `Usunięto: ${d.productName}`;
    case 'line_quantity':
      return `${d.productName}: ilość ${d.before} → ${d.after}`;
    case 'line_agreed_unit_price':
      return `${d.productName}: cena ${d.before !== null ? d.before.toFixed(2) : '—'} → ${d.after !== null ? d.after.toFixed(2) : '—'}`;
  }
}

function describeEvent(t: string): string {
  const map: Record<string, string> = {
    created: 'Utworzono zapytanie',
    submitted: 'Zgłoszono do realizacji',
    modified: 'Zmodyfikowano',
    approved: 'Zaakceptowano',
    canceled: 'Anulowano',
    expired: 'Wygasło',
    completed: 'Zrealizowane',
    'customer-accepted-revision': 'Klient zaakceptował zmiany',
    'customer-rejected-revision': 'Klient odrzucił zmiany',
    're-submitted': 'Złożono ponownie',
    'note-added': 'Dodano notatkę',
  };
  return map[t] ?? t;
}

function RfqStatusBadge({
  status,
  awaiting,
}: {
  status: RfqStatus;
  awaiting: boolean;
}): ReactNode {
  if (awaiting) {
    return (
      <span className="industria-status industria-status--processing">
        Oczekuje akceptacji
      </span>
    );
  }
  const map: Record<RfqStatus, { cls: string; label: string }> = {
    Pending: { cls: 'industria-status--processing', label: 'Oczekuje' },
    'Created from admin': { cls: 'industria-status--processing', label: 'Od opiekuna' },
    Approved: { cls: 'industria-status--paid', label: 'Zatwierdzone' },
    Completed: { cls: 'industria-status--delivered', label: 'Zrealizowane' },
    Canceled: { cls: 'industria-status--draft', label: 'Anulowane' },
    Expired: { cls: 'industria-status--draft', label: 'Wygasłe' },
  };
  const entry = map[status] ?? { cls: 'industria-status--draft', label: status };
  return <span className={`industria-status ${entry.cls}`}>{entry.label}</span>;
}

async function acceptAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const expectedRevisionNumber = Number(formData.get('expectedRevisionNumber'));
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    await acceptRevision(session, rfqId, expectedRevisionNumber);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.message : 'Nie udało się zaakceptować zmian.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/quote-requests/${rfqId}`);
}

async function rejectAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const expectedRevisionNumber = Number(formData.get('expectedRevisionNumber'));
  const reason = (formData.get('reason') as string | null) ?? undefined;
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    await rejectRevision(session, rfqId, expectedRevisionNumber, reason || undefined);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.message : 'Nie udało się odrzucić zmian.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
  redirect(`/quote-requests/${rfqId}`);
}

async function convertAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    const { checkoutUrl } = await convertRfqToOrder(session, rfqId);
    redirect(checkoutUrl);
  } catch (err) {
    if (err instanceof StorefrontApiError) {
      redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
}

async function resubmitAction(formData: FormData): Promise<void> {
  'use server';
  const rfqId = formData.get('rfqId') as string;
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    const created = await resubmitRfq(session, rfqId);
    redirect(`/quote-requests/${created.id}`);
  } catch (err) {
    const msg = err instanceof StorefrontApiError ? err.message : 'Nie udało się złożyć ponownie.';
    redirect(`/quote-requests/${rfqId}?error=${encodeURIComponent(msg)}`);
  }
}
