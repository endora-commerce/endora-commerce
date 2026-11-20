import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  ADMIN,
  adminNotificationsAbout,
  drainOutbox,
  makeAdmin,
  makeOrganization,
  makeOrganizationWithAdmin,
  setSetting,
} from './fixtures.js';

/**
 * `specs/182-related-payers/` T073 (FR-023, FR-025, FR-043, US4-5, US4-6) — the operator queue:
 * what lands there and why, the operator's approve / reject (the reason is the sender's to read),
 * the second step of `payer_then_admin`, and the bell entry each new queue entry raises.
 * The assign / create-organization / invitation actions are Phase 6's.
 */
describe('related_payers — operator queue (T073)', () => {
  let h: BackendServerHandle;
  let y: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;

  const QUEUE = '/api/v1/admin/related-payers/requests';
  const customer = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const admin = (method: 'GET' | 'POST', url: string, payload?: unknown, cookies: Record<string, string> = ADMIN) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function requestFrom(
    sender: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>,
    taxId: string,
  ): Promise<string> {
    const res = await customer(sender.cookie, 'POST', '/api/v1/account/related-payers/requests', {
      taxId,
      contactEmail: 'queue-contact@example.com',
      comment: 'Queue comment',
    });
    expect(res.statusCode, res.body).toBe(202);
    return res.json().data.id as string;
  }

  async function queued(id: string): Promise<Record<string, unknown> | undefined> {
    const res = await admin('GET', QUEUE);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().data as Array<Record<string, unknown>>).find((r) => r['id'] === id);
  }

  async function sentState(sender: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>, id: string) {
    const list = (await customer(sender.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{
      id: string;
      state: string;
      rejectionReason: string | null;
    }>;
    return list.find((r) => r.id === id);
  }

  async function buyerLinks(buyerId: string) {
    const res = await admin('GET', `/api/v1/admin/organizations/${buyerId}/related-payers`);
    return res.json().data.asBuyer as Array<{ payerOrganizationId: string; state: string; commercialTerms: string }>;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting(h, 'related_payers.enabled', true);
    y = await makeOrganizationWithAdmin(h.em(), 'Queue payer');
  }, 120_000);

  afterEach(async () => {
    await setSetting(h, 'related_payers.approval_mode', 'payer');
    await setSetting(h, 'related_payers.unregistered_payer_mode', 'admin');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('approval mode `admin`: the request waits for the operator, who sees everything and approves', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'admin');
    const x = await makeOrganizationWithAdmin(h.em(), 'Queue buyer');
    const id = await requestFrom(x, y.taxId);

    expect(await queued(id)).toMatchObject({
      routing: 'operator',
      operatorReason: 'approval_mode_admin',
      senderOrganizationId: x.organizationId,
      counterpartyOrganizationId: y.organizationId,
      counterpartyName: expect.stringContaining('Queue payer'),
      contactEmail: 'queue-contact@example.com',
      comment: 'Queue comment',
      state: 'pending',
    });
    const incoming = (await customer(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data as Array<{ id: string }>;
    expect(incoming.map((r) => r.id)).not.toContain(id);

    // FR-025 — the operators hear of it in the bell, after the commit.
    await drainOutbox(h);
    expect(await adminNotificationsAbout(h.em(), id)).toEqual([
      expect.objectContaining({ kind: 'related_payers.request_queued', audience: 'all_admins', link_path: '/related-payers/requests' }),
    ]);

    const approved = await admin('POST', `${QUEUE}/${id}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(await buyerLinks(x.organizationId)).toEqual([
      expect.objectContaining({ payerOrganizationId: y.organizationId, state: 'active', commercialTerms: 'buyer' }),
    ]);
    expect((await sentState(x, id))?.state).toBe('active');
    expect(await queued(id)).toBeUndefined();
    const again = await admin('POST', `${QUEUE}/${id}/approve`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('RELATED_PAYER_REQUEST_DECIDED');
  });

  it('the operator rejects with a reason the sender reads; a reason is required', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'admin');
    const x = await makeOrganizationWithAdmin(h.em(), 'Rejected queue buyer');
    const id = await requestFrom(x, y.taxId);
    expect((await admin('POST', `${QUEUE}/${id}/reject`, {})).statusCode).toBe(400);
    const rejected = await admin('POST', `${QUEUE}/${id}/reject`, { reason: 'Not a known partner' });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(await sentState(x, id)).toMatchObject({ state: 'rejected', rejectionReason: 'Not a known partner' });
    expect(await buyerLinks(x.organizationId)).toEqual([]);
  });

  it('`payer_then_admin`: Y\'s acceptance moves the request to the operator; the link waits for the second step', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'payer_then_admin');
    const x = await makeOrganizationWithAdmin(h.em(), 'Two-step buyer');
    const id = await requestFrom(x, y.taxId);
    expect(await queued(id)).toBeUndefined();
    expect((await customer(y.cookie, 'POST', `/api/v1/account/related-payers/incoming/${id}/accept`)).statusCode).toBe(200);

    expect(await queued(id)).toMatchObject({ operatorReason: 'second_step', counterpartyAcceptedAt: expect.any(String) });
    expect(await buyerLinks(x.organizationId)).toEqual([]);
    expect((await sentState(x, id))?.state).toBe('pending');
    await drainOutbox(h);
    expect((await adminNotificationsAbout(h.em(), id)).map((n) => n.kind)).toEqual(['related_payers.request_queued']);

    expect((await admin('POST', `${QUEUE}/${id}/approve`)).statusCode).toBe(200);
    expect(await buyerLinks(x.organizationId)).toEqual([
      expect.objectContaining({ payerOrganizationId: y.organizationId, state: 'active' }),
    ]);
  });

  it('US4-6: under `payer`, a counterparty with nobody to approve falls back to the queue', async () => {
    const lonely = await makeOrganization(h.em(), 'Payer without users');
    const [row] = (await h.em().getConnection().execute('select tax_id from organizations where id = ?', [lonely])) as Array<{ tax_id: string }>;
    const x = await makeOrganizationWithAdmin(h.em(), 'Fallback buyer');
    const id = await requestFrom(x, row!.tax_id);
    expect(await queued(id)).toMatchObject({ operatorReason: 'no_eligible_approver', counterpartyOrganizationId: lonely });
  });

  it('FR-044: under unregistered mode `admin`, a tax ID nobody has waits for the operator', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Unknown payer buyer');
    const id = await requestFrom(x, `PL77${randomUUID().replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`);
    const row = await queued(id);
    expect(row, JSON.stringify(row)).toMatchObject({ operatorReason: 'no_account', counterpartyOrganizationId: null });
  });

  it('the queue reads with `related_payers:read`; deciding needs `related_payers:manage`', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'admin');
    const x = await makeOrganizationWithAdmin(h.em(), 'Permission buyer');
    const id = await requestFrom(x, y.taxId);
    const reader = await makeAdmin(h.em(), 'queue-reader', ['related_payers:read']);
    const nobody = await makeAdmin(h.em(), 'queue-nobody', ['orders:read']);
    try {
      expect((await admin('GET', QUEUE, undefined, reader.cookies)).statusCode).toBe(200);
      expect((await admin('POST', `${QUEUE}/${id}/approve`, undefined, reader.cookies)).statusCode).toBe(403);
      expect((await admin('POST', `${QUEUE}/${id}/reject`, { reason: 'x' }, reader.cookies)).statusCode).toBe(403);
      expect((await admin('GET', QUEUE, undefined, nobody.cookies)).statusCode).toBe(403);
    } finally {
      reader.undo();
      nobody.undo();
    }
    expect((await sentState(x, id))?.state).toBe('pending');
  });

  it('a request waiting for the counterparty is not the operator\'s to decide', async () => {
    const x = await makeOrganizationWithAdmin(h.em(), 'Counterparty buyer');
    const id = await requestFrom(x, y.taxId);
    expect(await queued(id)).toBeUndefined();
    expect((await admin('POST', `${QUEUE}/${id}/approve`)).statusCode).toBe(404);
    expect((await admin('POST', `${QUEUE}/${randomUUID()}/approve`)).statusCode).toBe(404);
  });
});
