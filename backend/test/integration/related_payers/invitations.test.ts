import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  ADMIN,
  customerNotificationsOf,
  drainOutbox,
  invitationTokenIn,
  makeOrganizationWithAdmin,
  setSetting,
  unusedTaxId,
} from './fixtures.js';

/**
 * `specs/182-related-payers/` T088 (US6; FR-040, FR-042, FR-044, A-15) — a payer invites a buyer
 * ("we will pay for you"): Y's approver names X's exact tax ID; the reply is the request route's,
 * whatever the tax ID found; X's payer managers are told and accept or reject; the link X → Y is
 * then active on the buyer's terms. Under `payer_then_admin` the operator decides second. The
 * channel setting `payer_may_invite_buyers` switches the route off (`404`). A buyer with no account
 * follows the no-account modes.
 */
describe('related_payers — a payer invites a buyer (US6)', () => {
  let h: BackendServerHandle;
  let y: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const mailer = new InMemoryMailer();
  const INVITE = '/api/v1/account/payees/invitations';

  const call = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const invite = (taxId: string, from = y, contactEmail = 'buyer-contact@example.com') =>
    call(from.cookie, 'POST', INVITE, { taxId, contactEmail, comment: 'We pay for tender 14' });
  const incomingOf = async (who: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>) =>
    (await call(who.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data as Array<{
      id: string;
      direction: string;
      senderOrganizationId: string;
    }>;
  const buyerLinks = async (buyerId: string) =>
    (await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${buyerId}/related-payers`, cookies: ADMIN })).json().data
      .asBuyer as Array<{ payerOrganizationId: string; state: string; origin: string; commercialTerms: string }>;
  /** Narrows `who`'s Administrator to a role holding exactly `permissions`. */
  const restrictTo = async (who: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>, permissions: string[]) => {
    await withSystemScope('test seed: related payers role', () =>
      seedMemberWithPermissions(h.em(), {
        organizationId: who.organizationId,
        customerAccountId: who.customerAccountId,
        permissions,
      }),
    );
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } }).organizationRoleCache.invalidateLocal(
      who.organizationId,
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await setSetting(h, 'related_payers.enabled', true);
    y = await makeOrganizationWithAdmin(h.em(), 'Inviting payer');
  }, 120_000);

  afterEach(async () => {
    await setSetting(h, 'related_payers.payer_may_invite_buyers', true);
    await setSetting(h, 'related_payers.approval_mode', 'payer');
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'admin');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('US6-1: one reply whatever the tax ID; X\'s payer managers are told by e-mail and in the account', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Invited buyer');
    const known = await invite(x.taxId);
    const unknown = await invite(unusedTaxId());
    for (const res of [known, unknown]) {
      expect(res.statusCode, res.body).toBe(202);
      expect(Object.keys(res.json().data).sort()).toEqual(['id', 'state']);
      expect(res.json().data.state).toBe('pending');
    }
    const id = known.json().data.id as string;
    // The invitation is the payer's sent row; the payer reads it as a sender (FR-041).
    const sent = (await call(y.cookie, 'GET', INVITE)).json().data as Array<Record<string, unknown>>;
    expect(sent.find((r) => r['id'] === id)).toMatchObject({ direction: 'payer_invitation', state: 'pending', taxId: x.taxId });
    for (const hidden of ['counterpartyOrganizationId', 'routing', 'operatorReason']) expect(sent[0]).not.toHaveProperty(hidden);
    // …and not among the payer requests it sent as a buyer.
    const asBuyer = (await call(y.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{ id: string }>;
    expect(asBuyer.map((r) => r.id)).not.toContain(id);

    expect((await incomingOf(x)).find((r) => r.id === id)).toMatchObject({
      direction: 'payer_invitation',
      senderOrganizationId: y.organizationId,
    });
    await drainOutbox(h);
    const told = mailer.sent.filter((m) => m.meta?.['requestId'] === id && m.meta?.['kind'] === 'related_payer_invitation_received');
    expect(told.map((m) => m.to)).toEqual([x.email]);
    expect(mailer.sent.filter((m) => m.to === 'buyer-contact@example.com' && m.meta?.['requestId'] === id)).toHaveLength(0);
    const entries = await customerNotificationsOf(h.em(), x.customerAccountId);
    expect(entries.find((e) => e.subject_id === id)).toMatchObject({ kind: 'related_payers.invitation_received' });
  });

  it('US6-2: X\'s payer manager accepts — the link X → Y, on the buyer\'s terms, from an invitation', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Accepting buyer');
    const id = (await invite(x.taxId)).json().data.id as string;
    const accepted = await call(x.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await buyerLinks(x.organizationId)).find((l) => l.payerOrganizationId === y.organizationId)).toMatchObject({
      state: 'active',
      origin: 'invitation',
      commercialTerms: 'buyer',
    });
    const payees = (await call(y.cookie, 'GET', '/api/v1/account/payees')).json().data as Array<{ organizationId: string; taxId: string }>;
    expect(payees.find((p) => p.organizationId === x.organizationId)?.taxId).toBe(x.taxId);
    // The inviting payer is told of the decision.
    await drainOutbox(h);
    expect(mailer.sent.filter((m) => m.meta?.['requestId'] === id && m.meta?.['kind'] === 'related_payer_request_decided').map((m) => m.to)).toEqual([
      y.email,
    ]);
  });

  it('US6-2: X may decline; the payer reads the reason', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Declining buyer');
    const id = (await invite(x.taxId)).json().data.id as string;
    expect((await call(x.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/reject`, { reason: 'We pay ourselves' })).statusCode).toBe(200);
    const sent = (await call(y.cookie, 'GET', INVITE)).json().data as Array<{ id: string; state: string; rejectionReason: string | null }>;
    expect(sent.find((r) => r.id === id)).toMatchObject({ state: 'rejected', rejectionReason: 'We pay ourselves' });
  });

  it('FR-045: the payer withdraws its pending invitation through the invitations route; the buyer requests route does not reach it', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Withdrawn-from buyer');
    const id = (await invite(x.taxId)).json().data.id as string;
    const yApprover = await makeOrganizationWithAdmin(h.em(), 'Approver-only payer');
    await restrictTo(yApprover, ['related_payers.approve']);
    const own = (await invite(x.taxId, yApprover)).json().data.id as string;
    // A payer-invitation is not a buyer's request: that route finds nothing.
    expect((await call(y.cookie, 'POST', `/api/v1/account/related-payers/requests/${id}/withdraw`)).statusCode).toBe(404);
    expect((await call(y.cookie, 'POST', `${INVITE}/${id}/withdraw`)).statusCode).toBe(200);
    // An approver without `manage` withdraws its own invitation.
    expect((await call(yApprover.cookie, 'POST', `${INVITE}/${own}/withdraw`)).statusCode).toBe(200);
    const sent = (await call(y.cookie, 'GET', INVITE)).json().data as Array<{ id: string; state: string }>;
    expect(sent.find((r) => r.id === id)?.state).toBe('withdrawn');
    expect((await incomingOf(x)).map((r) => r.id)).not.toContain(id);
  });

  it('US6-2: under `payer_then_admin` X\'s acceptance goes to the operator first', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'payer_then_admin');
    const x = await makeOrganizationWithAdmin(h.em(), 'Second-step buyer');
    const id = (await invite(x.taxId)).json().data.id as string;
    expect((await call(x.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(200);
    expect((await buyerLinks(x.organizationId)).find((l) => l.payerOrganizationId === y.organizationId)).toBeUndefined();
    const queue = (await h.app.inject({ method: 'GET', url: '/api/v1/admin/related-payers/requests', cookies: ADMIN })).json().data as Array<{
      id: string;
      operatorReason: string;
      direction: string;
    }>;
    expect(queue.find((r) => r.id === id)).toMatchObject({ operatorReason: 'second_step', direction: 'payer_invitation' });
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/related-payers/requests/${id}/approve`, cookies: ADMIN })).statusCode).toBe(200);
    expect((await buyerLinks(x.organizationId)).find((l) => l.payerOrganizationId === y.organizationId)?.state).toBe('active');
  });

  it('the invitation is X\'s payer managers\' to decide: approving payer requests is not enough, and Y must approve to invite', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Approver-only buyer');
    const id = (await invite(x.taxId)).json().data.id as string;
    await restrictTo(x, ['related_payers.approve']);
    expect((await incomingOf(x)).map((r) => r.id)).not.toContain(id);
    expect((await call(x.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(404);

    const yManager = await makeOrganizationWithAdmin(h.em(), 'Manager-only payer');
    await restrictTo(yManager, ['related_payers.manage']);
    expect((await invite(x.taxId, yManager)).statusCode).toBe(403);
  });

  it('Principle XI: an unrelated Organization neither sees nor decides another\'s invitation (404)', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Invited elsewhere');
    const z = await makeOrganizationWithAdmin(h.em(), 'Unrelated manager');
    const id = (await invite(x.taxId)).json().data.id as string;
    expect((await incomingOf(z)).map((r) => r.id)).not.toContain(id);
    expect((await call(z.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(404);
    expect((await call(z.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/reject`, {})).statusCode).toBe(404);
    // Nor does the inviting payer decide its own invitation.
    expect((await call(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(404);
  });

  it('US6-3: with `payer_may_invite_buyers` off on the channel the routes are absent (404)', async () => {
    await setSetting(h, 'related_payers.payer_may_invite_buyers', false);
    const x = await makeOrganizationWithAdmin(h.em(), 'Uninvitable buyer');
    expect((await invite(x.taxId)).statusCode).toBe(404);
    expect((await call(y.cookie, 'GET', INVITE)).statusCode).toBe(404);
  });

  it('A-15: a buyer with no account follows the no-account mode — `invite` sends the invitation to register', async () => {
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'invite');
    const taxId = unusedTaxId();
    const res = await invite(taxId, y, 'unregistered-buyer@example.com');
    expect(res.statusCode, res.body).toBe(202);
    await drainOutbox(h);
    const [mail] = mailer.sent.filter((m) => m.to === 'unregistered-buyer@example.com' && m.meta?.['kind'] === 'related_payer_invitation_to_register');
    const token = invitationTokenIn(mail!.text)!;
    const found = await h.app.inject({ method: 'GET', url: `/api/v1/related-payers/invitations/${token}` });
    expect(found.json()).toEqual({ data: { taxId } });
  });
});
