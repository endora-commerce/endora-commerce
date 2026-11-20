import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  ADMIN,
  drainOutbox,
  eventually,
  invitationTokenIn,
  makeAdmin,
  makeOrganizationWithAdmin,
  setSetting,
  unusedTaxId,
} from './fixtures.js';

/**
 * `specs/182-related-payers/` T086 (US5; FR-023, FR-044) — the payer a buyer names has no account.
 * Under `admin` the request waits in the operator queue, where the operator creates the
 * Organization (the link is active at once), sends an invitation to register, or rejects with a
 * reason. Under `invite` the contact e-mail gets that invitation, with the tax ID pre-filled
 * through a token, and nothing is created; once an Organization with that tax ID registers and its
 * registration is approved, the request is attached to it and enters approval as in US4. An
 * expired invitation attaches nothing; a rejected registration leaves the request pending.
 */
describe('related_payers — a payer without an account (US5)', () => {
  let h: BackendServerHandle;
  let x: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const mailer = new InMemoryMailer();
  const QUEUE = '/api/v1/admin/related-payers/requests';
  const INVITATION_EMAIL = 'related_payer_invitation_to_register';

  const customer = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const admin = (method: 'GET' | 'POST', url: string, payload?: unknown, cookies: Record<string, string> = ADMIN) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function requestFor(taxId: string, contactEmail = 'new-payer@example.com'): Promise<string> {
    const res = await customer(x.cookie, 'POST', '/api/v1/account/related-payers/requests', {
      taxId,
      contactEmail,
      comment: 'Investor of tender 14',
    });
    expect(res.statusCode, res.body).toBe(202);
    expect(Object.keys(res.json().data).sort()).toEqual(['id', 'state']);
    return res.json().data.id as string;
  }
  const sentState = async (id: string) =>
    ((await customer(x.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{
      id: string;
      state: string;
      rejectionReason: string | null;
    }>).find((r) => r.id === id);
  const queued = async (id: string) =>
    ((await admin('GET', QUEUE)).json().data as Array<Record<string, unknown>>).find((r) => r['id'] === id);
  const invitationsTo = (email: string) => mailer.sent.filter((m) => m.to === email && m.meta?.['kind'] === INVITATION_EMAIL);
  const organizationsWithTaxId = async (taxId: string) =>
    Number(
      ((await h.em().getConnection().execute(`select count(*)::int as n from organizations where tax_id = ?`, [taxId])) as Array<{ n: number }>)[0]!
        .n,
    );
  const lookup = (token: string) => h.app.inject({ method: 'GET', url: `/api/v1/related-payers/invitations/${token}` });
  const newOrganization = async (taxId: string) => ({
    organization: {
      name: `Registered payer ${taxId}`,
      taxId,
      registeredAddress: { street: 'Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
      salesChannelIds: [await systemDefaultSalesChannelId(h.em())],
    },
  });
  /** The registration's approval by the existing moderation route (`organization.status_changed.v1`). */
  async function approveRegistration(organizationId: string, verb: 'approve' | 'reject' = 'approve'): Promise<void> {
    const [row] = (await h.em().getConnection().execute(`select version from organizations where id = ?`, [organizationId])) as Array<{
      version: number;
    }>;
    const res = await admin('POST', `/api/v1/admin/organizations/${organizationId}/${verb}`, {
      expectedVersion: row!.version,
      ...(verb === 'reject' ? { reason: 'Not a company we know' } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await setSetting(h, 'related_payers.enabled', true);
    x = await makeOrganizationWithAdmin(h.em(), 'Buyer without a payer');
  }, 120_000);

  afterEach(async () => {
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'admin');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('US5-1: under `admin` an unknown tax ID waits in the queue with the contact e-mail and comment', async () => {
    const taxId = unusedTaxId();
    const id = await requestFor(taxId);
    expect(await queued(id)).toMatchObject({
      taxId,
      contactEmail: 'new-payer@example.com',
      comment: 'Investor of tender 14',
      operatorReason: 'no_account',
      counterpartyOrganizationId: null,
      candidates: [],
    });
    expect((await sentState(id))?.state).toBe('pending');
    // `admin` mode contacts nobody.
    await drainOutbox(h);
    expect(invitationsTo('new-payer@example.com')).toHaveLength(0);
  });

  it('US5-2: the operator creates the Organization — approved, the link active on the buyer\'s terms', async () => {
    const taxId = unusedTaxId();
    const id = await requestFor(taxId);
    // The tax ID is the request's: another is refused, and nothing is created.
    const other = await admin('POST', `${QUEUE}/${id}/create-organization`, await newOrganization(unusedTaxId()));
    expect(other.statusCode, other.body).toBe(422);
    // Creating an Organization is the organization create, gated by `customers:manage` too.
    const manager = await makeAdmin(h.em(), 'queue-manager-no-customers', ['related_payers:read', 'related_payers:manage']);
    expect((await admin('POST', `${QUEUE}/${id}/create-organization`, await newOrganization(taxId), manager.cookies)).statusCode).toBe(403);
    manager.undo();

    const created = await admin('POST', `${QUEUE}/${id}/create-organization`, await newOrganization(taxId));
    expect(created.statusCode, created.body).toBe(201);
    const { organizationId, linkId } = created.json().data as { organizationId: string; linkId: string };
    const org = await admin('GET', `/api/v1/admin/organizations/${organizationId}`);
    expect(org.json().data).toMatchObject({ status: 'active', taxId });
    const links = (await admin('GET', `/api/v1/admin/organizations/${x.organizationId}/related-payers`)).json().data.asBuyer as Array<{
      id: string;
      payerOrganizationId: string;
      state: string;
      commercialTerms: string;
    }>;
    expect(links.find((l) => l.id === linkId)).toMatchObject({ payerOrganizationId: organizationId, state: 'active', commercialTerms: 'buyer' });
    expect((await sentState(id))?.state).toBe('active');
    // Decided: a second create loses.
    expect((await admin('POST', `${QUEUE}/${id}/create-organization`, await newOrganization(taxId))).statusCode).toBe(409);
  });

  it('US5-2: the operator sends an invitation — the contact e-mail gets a link that pre-fills the tax ID', async () => {
    const taxId = unusedTaxId();
    const id = await requestFor(taxId, 'invited-by-operator@example.com');
    const sent = await admin('POST', `${QUEUE}/${id}/send-invitation`);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(await queued(id)).toBeUndefined();
    const [mail] = invitationsTo('invited-by-operator@example.com');
    expect(mail, 'invitation e-mail').toBeDefined();
    const token = invitationTokenIn(mail!.text);
    expect(token).not.toBeNull();
    const found = await lookup(token!);
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json()).toEqual({ data: { taxId } });
    expect((await sentState(id))?.state).toBe('pending');
    expect(await organizationsWithTaxId(taxId)).toBe(0);
    // Only a request waiting for the operator with no Organization can be sent an invitation.
    expect((await admin('POST', `${QUEUE}/${id}/send-invitation`)).statusCode).toBe(404);
  });

  it('US5-2: the operator rejects with a reason the sender reads', async () => {
    const id = await requestFor(unusedTaxId());
    expect((await admin('POST', `${QUEUE}/${id}/reject`, { reason: 'Unknown investor' })).statusCode).toBe(200);
    expect(await sentState(id)).toMatchObject({ state: 'rejected', rejectionReason: 'Unknown investor' });
  });

  it('US5-3, US5-4: under `invite` the contact is invited, nothing is created; the approved registration gets the request', async () => {
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'invite');
    const taxId = unusedTaxId();
    const id = await requestFor(taxId, 'invited@example.com');
    // Sent after commit, never inside the request (FR-041).
    expect(invitationsTo('invited@example.com')).toHaveLength(0);
    await drainOutbox(h);
    const [mail] = invitationsTo('invited@example.com');
    expect(mail?.text).toContain(taxId);
    const token = invitationTokenIn(mail!.text)!;
    expect((await lookup(token)).json()).toEqual({ data: { taxId } });
    // A redelivered row (at-least-once) does not send a second invitation, nor void the first.
    await h
      .em()
      .getConnection()
      .execute(
        `update command_outbox set status = 'pending', available_at = now(), delivered_at = null, locked_until = null
          where object_id = ? and action = 'related_payers.request.create'`,
        [id],
      );
    await drainOutbox(h);
    expect(invitationsTo('invited@example.com')).toHaveLength(1);
    expect((await lookup(token)).statusCode).toBe(200);
    expect(await organizationsWithTaxId(taxId)).toBe(0);
    expect(await queued(id)).toBeUndefined();
    expect((await sentState(id))?.state).toBe('pending');

    // The invitee registers with that tax ID; the operator approves the registration.
    const y = await makeOrganizationWithAdmin(h.em(), 'Registered payer', { status: 'pending_verification', taxId });
    expect(((await customer(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data ?? []) as unknown[]).toHaveLength(0);
    await approveRegistration(y.organizationId);
    const incoming = await eventually(async () => {
      const res = await customer(y.cookie, 'GET', '/api/v1/account/related-payers/incoming');
      return (res.json().data as Array<{ id: string }> | undefined)?.find((r) => r.id === id);
    });
    expect(incoming, 'the request reaches the new Organization\'s approver').toMatchObject({ senderOrganizationId: x.organizationId });
    // Told like any request reaching an approver (FR-042).
    await drainOutbox(h);
    expect(mailer.sent.filter((m) => m.to === y.email && m.meta?.['kind'] === 'related_payer_request_received')).toHaveLength(1);
    // The invitation is used up once the request has its Organization.
    expect((await lookup(token)).statusCode).toBe(404);
    const accepted = await customer(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await sentState(id))?.state).toBe('active');
  });

  it('US5-5: an invitation that expired attaches nothing, and its link no longer pre-fills', async () => {
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'invite');
    const taxId = unusedTaxId();
    const id = await requestFor(taxId, 'expiring-invite@example.com');
    await drainOutbox(h);
    const token = invitationTokenIn(invitationsTo('expiring-invite@example.com')[0]!.text)!;
    await h.em().getConnection().execute(`update related_payer_requests set expires_at = now() - interval '1 minute' where id = ?`, [id]);
    expect((await lookup(token)).statusCode).toBe(404);
    const expiry = h.container.resolve<{ sweep: () => Promise<{ expiredCount: number }> }>('relatedPayerRequestExpiry');
    await expiry.sweep();
    expect((await sentState(id))?.state).toBe('expired');
    const y = await makeOrganizationWithAdmin(h.em(), 'Late payer', { status: 'pending_verification', taxId });
    await approveRegistration(y.organizationId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await customer(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data).toEqual([]);
    expect((await sentState(id))?.state).toBe('expired');
  });

  it('US5-6: a rejected registration leaves the request pending; X sees no difference', async () => {
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'invite');
    const taxId = unusedTaxId();
    const id = await requestFor(taxId, 'rejected-registration@example.com');
    await drainOutbox(h);
    const y = await makeOrganizationWithAdmin(h.em(), 'Rejected payer', { status: 'pending_verification', taxId });
    await approveRegistration(y.organizationId, 'reject');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await sentState(id))?.state).toBe('pending');
    const token = invitationTokenIn(invitationsTo('rejected-registration@example.com')[0]!.text)!;
    expect((await lookup(token)).statusCode).toBe(200);
  });

  it('the invitation lookup answers 404 for a token it does not know', async () => {
    expect((await lookup('not-a-real-token-at-all-0123456789abcdef')).statusCode).toBe(404);
  });
});
