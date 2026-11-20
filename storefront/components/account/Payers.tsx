import type { ReactNode } from 'react';
import type { CustomerRelatedPayerLink, RelatedPayerIncomingRequest, RelatedPayerSentRequest } from '@endora-commerce/contracts';
import { tForLocale, type MessageKey } from '../../lib/i18n/messages';
import { codeLabel } from '../../lib/account/labels';
import { defineUrlErrors } from '../../lib/url-errors';
import { can, isAdministrator, type OrganizationPermissionSession } from '../../lib/organization-permissions';
import { RejectPayerRequestButton } from './RejectPayerRequestButton';

/**
 * `specs/182-related-payers/` US4 + US7 — the account's **Payers** page (FR-040, FR-047, FR-050):
 * this Organization's payers and the requests it sent (X's side), the request form, and the
 * requests awaiting it and the buyers it pays for (Y's side). Each section follows the permission
 * that governs it; the API is the gate, this only keeps a control from leading to a refusal.
 * Server Components: every write is a form posting to a server action, except *Reject*, whose
 * optional reason is asked for in a dialog — the one client leaf, `RejectPayerRequestButton`.
 */

const MANAGE = 'related_payers.manage';
const APPROVE = 'related_payers.approve';
const ORDER_WITH_PAYER = 'related_payers.order_with_payer';

type Me = { customerAccount: OrganizationPermissionSession; organization: unknown } | null;
type FormAction = (formData: FormData) => Promise<void>;

const ROW_ACTION_CLASS = 'btn btn--outline btn--sm min-h-11';
const ROW_DESTRUCTIVE_CLASS = `${ROW_ACTION_CLASS} border-bad text-bad`;

export interface PayerSections {
  readonly payers: boolean;
  readonly requests: boolean;
  readonly incoming: boolean;
  readonly payees: boolean;
  /** US6 — a payer invites buyers (shown while the channel allows it). */
  readonly invitations: boolean;
  /** US6 — the invitations payers sent this Organization, decided by its payer managers. */
  readonly incomingInvitations: boolean;
}

/** Which sections the member may see (FR-047): an Administrator holds every code. */
export function payerSections(me: Me): PayerSections {
  const session = me?.customerAccount ?? null;
  const has = (code: string) => isAdministrator(session) || can(session, code);
  return {
    payers: has(MANAGE) || has(ORDER_WITH_PAYER),
    requests: has(MANAGE),
    incoming: has(APPROVE),
    payees: has(APPROVE),
    invitations: has(APPROVE),
    incomingInvitations: has(MANAGE),
  };
}

/** Whether the account offers **Payers**: the module present (FR-101) and any section to show. */
export function showsPayers(me: Me, modules: { isPresent(id: string): boolean }): boolean {
  if (!me?.organization || !modules.isPresent('related_payers')) return false;
  return Object.values(payerSections(me)).some(Boolean);
}

/**
 * What the page's `?error=` may say (issue #745): a code, never the API's sentence or what the
 * member typed. The API's codes the page names, and its own generic failure.
 */
export const PAYERS_ERRORS = defineUrlErrors({
  api: {
    RELATED_PAYER_REQUEST_LIMIT: 'account.payers.error.limit',
    RELATED_PAYER_REQUEST_DECIDED: 'account.payers.error.decided',
    VALIDATION_FAILED: 'account.payers.error.invalid',
  },
  own: { FAILED: 'account.payers.error.failed' },
  generic: 'FAILED',
});

function date(value: string | null, locale: string): string {
  return value ? new Date(value).toLocaleDateString(locale) : '—';
}

function windowOf(link: CustomerRelatedPayerLink, locale: string): string {
  if (!link.validFrom && !link.validTo) return '—';
  return `${date(link.validFrom, locale)} – ${date(link.validTo, locale)}`;
}

/** X's payers (FR-047): name, tax ID, state, address scope, window, terms; revoke (FR-050). */
export function PayerLinksTable({
  links,
  locale,
  canRevoke,
  revokeAction,
}: {
  links: readonly CustomerRelatedPayerLink[];
  locale: string;
  canRevoke: boolean;
  revokeAction: FormAction;
}): ReactNode {
  const t = tForLocale(locale);
  if (links.length === 0) return <p>{t('account.payers.links.empty')}</p>;
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>{t('account.payers.col.payer')}</th>
          <th>{t('account.payers.col.taxId')}</th>
          <th>{t('account.common.status')}</th>
          <th>{t('account.payers.col.addresses')}</th>
          <th>{t('account.payers.col.window')}</th>
          <th>{t('account.payers.col.terms')}</th>
          {canRevoke ? <th>{t('account.payers.col.actions')}</th> : null}
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id}>
            <td>{link.name}</td>
            <td>{link.taxId ?? '—'}</td>
            <td>{codeLabel(t, 'account.payers.linkState', link.state)}</td>
            <td>{codeLabel(t, 'account.payers.scope', link.addressScope)}</td>
            <td>{windowOf(link, locale)}</td>
            <td>{codeLabel(t, 'account.payers.terms', link.commercialTerms)}</td>
            {canRevoke ? (
              <td>
                {link.state !== 'revoked' ? (
                  <form action={revokeAction}>
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" className={ROW_DESTRUCTIVE_CLASS}>
                      {t('account.payers.revoke')}
                    </button>
                  </form>
                ) : null}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The requests X sent, as the sender sees them (FR-041): one `pending` until decided. */
export function SentRequestsTable({
  requests,
  locale,
  withdrawAction,
}: {
  requests: readonly RelatedPayerSentRequest[];
  locale: string;
  withdrawAction: FormAction;
}): ReactNode {
  const t = tForLocale(locale);
  if (requests.length === 0) return <p>{t('account.payers.requests.empty')}</p>;
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>{t('account.payers.col.taxId')}</th>
          <th>{t('account.payers.col.sent')}</th>
          <th>{t('account.common.status')}</th>
          <th>{t('account.payers.col.reason')}</th>
          <th>{t('account.payers.col.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.id}>
            <td>{request.taxId}</td>
            <td>{date(request.createdAt, locale)}</td>
            <td>{codeLabel(t, 'account.payers.requestState', request.state)}</td>
            <td>{request.rejectionReason ?? '—'}</td>
            <td>
              {request.state === 'pending' ? (
                <form action={withdrawAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button type="submit" className={ROW_ACTION_CLASS}>
                    {t('account.payers.withdraw')}
                  </button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The fields of a request or an invitation: the exact tax ID, a contact e-mail, a comment. */
function CounterpartyForm({
  locale,
  action,
  idPrefix,
  hint,
  contactLabel,
  submit,
}: {
  locale: string;
  action: FormAction;
  idPrefix: string;
  hint: MessageKey;
  contactLabel: MessageKey;
  submit: MessageKey;
}): ReactNode {
  const t = tForLocale(locale);
  return (
    <form action={action} className="b2b-auth__form">
      <p>{t(hint)}</p>
      <div className="b2b-auth__row">
        <div className="b2b-auth__field">
          <label htmlFor={`${idPrefix}-tax-id`}>{t('account.payers.request.taxId')}</label>
          <input id={`${idPrefix}-tax-id`} name="taxId" required maxLength={32} autoComplete="off" placeholder=" " />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor={`${idPrefix}-contact-email`}>{t(contactLabel)}</label>
          <input id={`${idPrefix}-contact-email`} name="contactEmail" type="email" required maxLength={320} placeholder=" " />
        </div>
      </div>
      <div className="b2b-auth__field">
        <label htmlFor={`${idPrefix}-comment`}>{t('account.payers.request.comment')}</label>
        <textarea id={`${idPrefix}-comment`} name="comment" maxLength={2000} rows={3} />
      </div>
      <div className="b2b-auth__actions">
        <button type="submit">{t(submit)}</button>
      </div>
    </form>
  );
}

/** FR-040 — ask a company to become a payer by its exact tax ID. */
export function RequestPayerForm({ locale, action }: { locale: string; action: FormAction }): ReactNode {
  return (
    <CounterpartyForm
      locale={locale}
      action={action}
      idPrefix="payer"
      hint="account.payers.request.hint"
      contactLabel="account.payers.request.contactEmail"
      submit="account.payers.request.submit"
    />
  );
}

/** US6 (FR-040) — a payer invites a buyer it will pay for, by the buyer's exact tax ID. */
export function InviteBuyerForm({ locale, action }: { locale: string; action: FormAction }): ReactNode {
  const t = tForLocale(locale);
  return (
    <>
      <h3>{t('account.payers.invite.heading')}</h3>
      <CounterpartyForm
        locale={locale}
        action={action}
        idPrefix="payee"
        hint="account.payers.invite.hint"
        contactLabel="account.payers.request.contactEmail"
        submit="account.payers.invite.submit"
      />
    </>
  );
}

/** FR-042, FR-047 — the requests awaiting this Organization's decision; *Reject* asks for its reason in a dialog. */
export function IncomingRequestsTable({
  requests,
  locale,
  acceptAction,
  rejectAction,
  kind = 'requests',
}: {
  requests: readonly RelatedPayerIncomingRequest[];
  locale: string;
  acceptAction: FormAction;
  rejectAction: FormAction;
  /** US6 — invitations come from payers: the sender column says so. */
  kind?: 'requests' | 'invitations';
}): ReactNode {
  const t = tForLocale(locale);
  if (requests.length === 0) {
    return <p>{t(kind === 'invitations' ? 'account.payers.incomingInvitations.empty' : 'account.payers.incoming.empty')}</p>;
  }
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>{t(kind === 'invitations' ? 'account.payers.col.payer' : 'account.payers.col.buyer')}</th>
          <th>{t('account.payers.col.taxId')}</th>
          <th>{t('account.payers.col.comment')}</th>
          <th>{t('account.payers.col.sent')}</th>
          <th>{t('account.payers.col.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.id}>
            <td>{request.senderName}</td>
            <td>{request.senderTaxId ?? '—'}</td>
            <td>{request.comment ?? '—'}</td>
            <td>{date(request.createdAt, locale)}</td>
            <td>
              <div className="flex flex-wrap items-center gap-2">
                <form action={acceptAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <button type="submit" className={ROW_ACTION_CLASS}>
                    {t('account.payers.accept')}
                  </button>
                </form>
                <RejectPayerRequestButton
                  requestId={request.id}
                  senderName={request.senderName}
                  kind={kind}
                  locale={locale}
                  triggerClassName={ROW_DESTRUCTIVE_CLASS}
                  rejectAction={rejectAction}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** FR-047, FR-050 — the buyers this Organization pays for, each with its tax ID (RP-20 d), each revocable from here. */
export function PayeesTable({
  links,
  locale,
  revokeAction,
}: {
  links: readonly CustomerRelatedPayerLink[];
  locale: string;
  revokeAction: FormAction;
}): ReactNode {
  const t = tForLocale(locale);
  if (links.length === 0) return <p>{t('account.payers.payees.empty')}</p>;
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>{t('account.payers.col.buyer')}</th>
          <th>{t('account.payers.col.taxId')}</th>
          <th>{t('account.common.status')}</th>
          <th>{t('account.payers.col.window')}</th>
          <th>{t('account.payers.col.terms')}</th>
          <th>{t('account.payers.col.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {links.map((link) => (
          <tr key={link.id}>
            <td>{link.name}</td>
            <td>{link.taxId ?? '—'}</td>
            <td>{codeLabel(t, 'account.payers.linkState', link.state)}</td>
            <td>{windowOf(link, locale)}</td>
            <td>{codeLabel(t, 'account.payers.terms', link.commercialTerms)}</td>
            <td>
              {link.state !== 'revoked' ? (
                <form action={revokeAction}>
                  <input type="hidden" name="linkId" value={link.id} />
                  <button type="submit" className={ROW_DESTRUCTIVE_CLASS}>
                    {t('account.payers.revoke')}
                  </button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
