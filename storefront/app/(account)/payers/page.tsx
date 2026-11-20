import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMe } from '../../../lib/api/account';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { tForLocale, type MessageKey } from '../../../lib/i18n/messages';
import {
  getRelatedPayersAvailability,
  listIncomingPayerRequests,
  listPayeeInvitations,
  listPayees,
  listPayerLinks,
  listSentPayerRequests,
} from '../../../lib/api/related-payers';
import {
  IncomingRequestsTable,
  InviteBuyerForm,
  PAYERS_ERRORS,
  PayeesTable,
  PayerLinksTable,
  RequestPayerForm,
  SentRequestsTable,
  payerSections,
  showsPayers,
} from '../../../components/account/Payers';
import {
  acceptPayerRequestAction,
  invitePayeeAction,
  rejectPayerRequestAction,
  requestPayerAction,
  revokePayeeAction,
  revokePayerAction,
  withdrawPayeeInvitationAction,
  withdrawPayerRequestAction,
} from './actions';

/** Not indexed: an authenticated surface (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const DONE = new Set(['requested', 'invited', 'withdrawn', 'accepted', 'rejected', 'revoked']);

/**
 * `specs/182-related-payers/` FR-040, FR-047, FR-050 — **Payers**: this Organization's payers and
 * requests (X's side) and the requests awaiting it and the buyers it pays for (Y's side), each
 * section shown by the permission that governs it. Not found while the module is absent, the
 * capability is off on the request's channel (FR-002) or the member holds none of its permissions.
 */
export default async function PayersPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/payers');
  const { locale, ctx, modules } = await getServerContext();
  const me = await getMe(session);
  if (!showsPayers(me, modules)) notFound();
  // FR-002 — off on this channel, the module present: absent, not an empty form the API refuses.
  if (!(await getRelatedPayersAvailability(session, ctx))) notFound();
  const sections = payerSections(me);
  const query = await searchParams;
  const t = tForLocale(locale);
  const [links, sent, awaiting, payees, invitations] = await Promise.all([
    sections.payers ? listPayerLinks(session, ctx) : [],
    sections.requests ? listSentPayerRequests(session, ctx) : [],
    sections.incoming || sections.incomingInvitations ? listIncomingPayerRequests(session, ctx) : [],
    sections.payees ? listPayees(session, ctx) : [],
    // US6 — `null` when the channel does not let payers invite buyers: no section (US6-3).
    sections.invitations ? listPayeeInvitations(session, ctx) : null,
  ]);
  const incoming = awaiting.filter((r) => r.direction === 'buyer_request');
  const incomingInvitations = awaiting.filter((r) => r.direction === 'payer_invitation');
  const done = query.done && DONE.has(query.done) ? (`account.payers.done.${query.done}` as MessageKey) : null;
  const error = PAYERS_ERRORS.errorKey(query.error);

  return (
    <div className="b2b-auth max-w-[960px] space-y-8">
      <h1>{t('account.payers.heading')}</h1>
      {done ? <p className="b2b-auth__success">{t(done)}</p> : null}
      {error ? (
        <p className="b2b-auth__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      {sections.payers ? (
        <section>
          <h2>{t('account.payers.links.heading')}</h2>
          <PayerLinksTable links={links} locale={locale} canRevoke={sections.requests} revokeAction={revokePayerAction} />
        </section>
      ) : null}
      {sections.requests ? (
        <>
          <section>
            <h2>{t('account.payers.requests.heading')}</h2>
            <SentRequestsTable requests={sent} locale={locale} withdrawAction={withdrawPayerRequestAction} />
          </section>
          <section>
            <h2>{t('account.payers.request.heading')}</h2>
            <RequestPayerForm locale={locale} action={requestPayerAction} />
          </section>
        </>
      ) : null}
      {sections.incoming ? (
        <section>
          <h2>{t('account.payers.incoming.heading')}</h2>
          <IncomingRequestsTable
            requests={incoming}
            locale={locale}
            acceptAction={acceptPayerRequestAction}
            rejectAction={rejectPayerRequestAction}
          />
        </section>
      ) : null}
      {sections.incomingInvitations ? (
        <section>
          <h2>{t('account.payers.incomingInvitations.heading')}</h2>
          <IncomingRequestsTable
            requests={incomingInvitations}
            locale={locale}
            acceptAction={acceptPayerRequestAction}
            rejectAction={rejectPayerRequestAction}
            kind="invitations"
          />
        </section>
      ) : null}
      {sections.payees ? (
        <section>
          <h2>{t('account.payers.payees.heading')}</h2>
          <PayeesTable links={payees} locale={locale} revokeAction={revokePayeeAction} />
        </section>
      ) : null}
      {invitations ? (
        <section>
          <h2>{t('account.payers.invitations.heading')}</h2>
          {invitations.length === 0 ? (
            <p>{t('account.payers.invitations.empty')}</p>
          ) : (
            <SentRequestsTable requests={invitations} locale={locale} withdrawAction={withdrawPayeeInvitationAction} />
          )}
          <InviteBuyerForm locale={locale} action={invitePayeeAction} />
        </section>
      ) : null}
    </div>
  );
}
