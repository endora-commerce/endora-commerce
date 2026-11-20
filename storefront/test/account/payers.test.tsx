import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CustomerRelatedPayerLink, RelatedPayerIncomingRequest, RelatedPayerSentRequest } from '@endora-commerce/contracts';
import {
  IncomingRequestsTable,
  InviteBuyerForm,
  PayeesTable,
  PayerLinksTable,
  RequestPayerForm,
  SentRequestsTable,
  PAYERS_ERRORS,
  payerSections,
  showsPayers,
} from '../../components/account/Payers';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * `specs/182-related-payers/` T076 (FR-040, FR-047, FR-050, FR-101) — the account's **Payers**
 * page: X's payer links and requests, the request form, the requests awaiting this Organization
 * and the buyers it pays for, each section shown by the permission that governs it; revoke from
 * either side; a refusal reported by a code, never the API's sentence; English and Polish.
 */
const noop = async () => undefined;

const LINK: CustomerRelatedPayerLink = {
  id: '00000000-0000-4000-8000-0000000000c1',
  organizationId: '00000000-0000-4000-8000-0000000000b2',
  name: 'Payer SA',
  taxId: 'PL1234567890',
  state: 'active',
  addressScope: 'all',
  billingAddressId: null,
  validFrom: null,
  validTo: '2027-01-31T22:59:59.999Z',
  commercialTerms: 'buyer',
};

const SENT: RelatedPayerSentRequest[] = [
  {
    id: '00000000-0000-4000-8000-0000000000d1',
    direction: 'buyer_request',
    taxId: 'PL5260001246',
    contactEmail: 'contact@example.com',
    comment: null,
    state: 'pending',
    rejectionReason: null,
    createdAt: '2026-11-19T09:00:00.000Z',
    decidedAt: null,
    expiresAt: '2026-12-19T09:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000d2',
    direction: 'buyer_request',
    taxId: 'PL7770001111',
    contactEmail: 'contact@example.com',
    comment: null,
    state: 'rejected',
    rejectionReason: 'We do not know you',
    createdAt: '2026-11-18T09:00:00.000Z',
    decidedAt: '2026-11-18T10:00:00.000Z',
    expiresAt: '2026-12-18T09:00:00.000Z',
  },
];

const INCOMING: RelatedPayerIncomingRequest = {
  id: '00000000-0000-4000-8000-0000000000d3',
  direction: 'buyer_request',
  senderOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  senderName: 'Buyer X',
  senderTaxId: 'PL9990001111',
  comment: 'Tender 2026/14',
  createdAt: '2026-11-19T09:00:00.000Z',
  expiresAt: '2026-12-19T09:00:00.000Z',
};

const me = (permissions: string[], kind: 'administrator' | 'member' = 'member') => ({
  customerAccount: { permissions, organizationRole: { kind } },
  organization: { id: 'org' },
});
const present = { isPresent: (id: string) => id === 'related_payers' };
const absent = { isPresent: () => false };

describe('Payers page (T076)', () => {
  it('is offered while the module is present to an Administrator or a holder of a payer permission', () => {
    expect(showsPayers(me([], 'administrator') as never, present)).toBe(true);
    for (const code of ['related_payers.manage', 'related_payers.approve', 'related_payers.order_with_payer']) {
      expect(showsPayers(me([code]) as never, present), code).toBe(true);
    }
    expect(showsPayers(me(['orders.place']) as never, present)).toBe(false);
    expect(showsPayers(me([], 'administrator') as never, absent)).toBe(false);
  });

  it('shows each section to the permission that governs it (FR-047)', () => {
    expect(payerSections(me(['related_payers.order_with_payer']) as never)).toEqual({
      payers: true,
      requests: false,
      incoming: false,
      payees: false,
      invitations: false,
      incomingInvitations: false,
    });
    // US6 — a payer manager decides the invitations payers send; an approver invites buyers.
    expect(payerSections(me(['related_payers.manage']) as never)).toEqual({
      payers: true,
      requests: true,
      incoming: false,
      payees: false,
      invitations: false,
      incomingInvitations: true,
    });
    expect(payerSections(me(['related_payers.approve']) as never)).toEqual({
      payers: false,
      requests: false,
      incoming: true,
      payees: true,
      invitations: true,
      incomingInvitations: false,
    });
    expect(payerSections(me([], 'administrator') as never)).toEqual({
      payers: true,
      requests: true,
      incoming: true,
      payees: true,
      invitations: true,
      incomingInvitations: true,
    });
  });

  it('lists X\'s payers with state, scope and window; revoke only for a manager and a live link', () => {
    const html = renderToString(<PayerLinksTable links={[LINK]} locale="en-US" canRevoke revokeAction={noop} />);
    expect(html).toContain('Payer SA');
    expect(html).toContain('PL1234567890');
    expect(html).toContain('Active');
    expect(html).toContain('All billing addresses');
    expect(html).toContain('name="linkId"');
    expect(html).toContain('Revoke');
    expect(renderToString(<PayerLinksTable links={[LINK]} locale="en-US" canRevoke={false} revokeAction={noop} />)).not.toContain('Revoke');
    expect(
      renderToString(<PayerLinksTable links={[{ ...LINK, state: 'revoked' }]} locale="en-US" canRevoke revokeAction={noop} />),
    ).not.toContain('name="linkId"');
  });

  it('lists the sent requests as the sender sees them, with a rejection reason and withdraw for a pending one', () => {
    const html = renderToString(<SentRequestsTable requests={SENT} locale="en-US" withdrawAction={noop} />);
    expect(html).toContain('PL5260001246');
    expect(html).toContain('Pending');
    expect(html).toContain('Rejected');
    expect(html).toContain('We do not know you');
    expect(html.match(/name="requestId"/g)).toHaveLength(1);
  });

  it('offers the request form with the tax ID, the contact e-mail and an optional comment (FR-040)', () => {
    const html = renderToString(<RequestPayerForm locale="en-US" action={noop} />);
    expect(html).toContain('name="taxId"');
    expect(html).toContain('name="contactEmail"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="comment"');
  });

  it('shows the requests awaiting this Organization with accept and a reject that asks for the reason in a dialog', () => {
    const html = renderToString(<IncomingRequestsTable requests={[INCOMING]} locale="en-US" acceptAction={noop} rejectAction={noop} />);
    expect(html).toContain('Buyer X');
    expect(html).toContain('PL9990001111');
    expect(html).toContain('Tender 2026/14');
    expect(html).toContain('Accept');
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>Reject<\/button>/);
    // The reason is asked for in the dialog, not in the row (owner, 2026-11-20).
    expect(html.match(/name="reason"/g)).toHaveLength(1);
    expect(html.slice(html.indexOf('<dialog'))).toContain('name="reason"');
  });

  it('lists the buyers this Organization pays for with each one\'s tax ID (RP-20 d), each revocable (FR-050)', () => {
    const payee = { ...LINK, name: 'Buyer X', taxId: 'PL9990001111' };
    const html = renderToString(<PayeesTable links={[payee]} locale="en-US" revokeAction={noop} />);
    expect(html).toContain('Buyer X');
    expect(html).toContain('PL9990001111');
    expect(html).toContain('<th>Tax ID</th>');
    expect(html).toContain('name="linkId"');
  });

  it('US6 — offers a payer the invitation of a buyer by tax ID, contact e-mail and comment (FR-040)', () => {
    const html = renderToString(<InviteBuyerForm locale="en-US" action={noop} />);
    expect(html).toContain('name="taxId"');
    expect(html).toContain('name="contactEmail"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="comment"');
    expect(html).toContain('Invite a company we will pay for');
    expect(renderToString(<InviteBuyerForm locale="pl-PL" action={noop} />)).toContain('Zaproś firmę, za którą zapłacimy');
  });

  it('US6 — the invitations a payer sent show who sent them as the payer: the column is headed Payer', () => {
    const invitation = { ...INCOMING, direction: 'payer_invitation' as const, senderName: 'Investor Y' };
    const html = renderToString(
      <IncomingRequestsTable requests={[invitation]} locale="en-US" acceptAction={noop} rejectAction={noop} kind="invitations" />,
    );
    expect(html).toContain('<th>Payer</th>');
    expect(html).toContain('Investor Y');
    expect(html).toContain('Accept');
  });

  it('reports a refusal by its code, never the API\'s sentence', async () => {
    const { StorefrontApiError } = await import('../../lib/api/client');
    const refusal = (code: string, status = 422) => new StorefrontApiError(status, code, 'A sentence the URL never carries.');
    expect(PAYERS_ERRORS.failureCode(refusal('RELATED_PAYER_REQUEST_LIMIT', 429), 'FAILED')).toBe('RELATED_PAYER_REQUEST_LIMIT');
    expect(PAYERS_ERRORS.failureCode(refusal('SOMETHING_ELSE'), 'FAILED')).toBe('FAILED');
    expect(PAYERS_ERRORS.failureCode(new Error('network'), 'FAILED')).toBe('FAILED');
    expect(PAYERS_ERRORS.errorKey('RELATED_PAYER_REQUEST_LIMIT')).toBe('account.payers.error.limit');
    expect(PAYERS_ERRORS.errorKey('RELATED_PAYER_REQUEST_DECIDED')).toBe('account.payers.error.decided');
    expect(PAYERS_ERRORS.errorKey('<script>')).toBe('account.payers.error.failed');
    expect(PAYERS_ERRORS.errorKey(undefined)).toBeNull();
  });

  // Owner, 2026-11-19 — "revoke" has one Polish verb everywhere (admin, storefront, e-mails).
  it('names revoking a payer link with the Polish verb the admin uses', () => {
    const revoked = { ...LINK, id: '00000000-0000-4000-8000-0000000000c2', state: 'revoked' as const };
    const html = renderToString(<PayerLinksTable links={[LINK, revoked]} locale="pl-PL" canRevoke revokeAction={noop} />);
    expect(html).toContain('>Odwołaj</button>');
    expect(html).toContain('Odwołane');
    expect(html).not.toMatch(/Cofni|Cofnij/);
    expect(tForLocale('pl-PL')('account.payers.done.revoked')).toBe('Powiązanie z płatnikiem zostało odwołane.');
  });

  it('speaks Polish in Polish', () => {
    const html = renderToString(<SentRequestsTable requests={SENT} locale="pl-PL" withdrawAction={noop} />);
    expect(html).toContain('Oczekuje');
    expect(html).toContain('Odrzucona');
  });
});
