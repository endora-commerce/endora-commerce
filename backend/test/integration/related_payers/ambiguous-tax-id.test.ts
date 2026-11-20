import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, drainOutbox, makeOrganization, makeOrganizationWithAdmin, setSetting, unusedTaxId } from './fixtures.js';

/**
 * `specs/182-related-payers/` T087 (FR-023, FR-041, FR-043) — a request whose tax ID the operator
 * has to resolve: the queue lists the Organizations it matches as candidates, and
 * `assign-organization` routes the request to the one picked, by the approval mode captured when it
 * was created. The sender's view never changes.
 *
 * Two Organizations sharing a tax ID need the `per-tree-root` tax-ID scope, which is
 * installation-wide (`specs/177-tax-id-scope/`) and must not be switched under parallel files; the
 * routing of "several matches" is `request-routing.test.ts`'s. Here the queue entry is one the
 * operator resolves the same way: a request routed while no Organization held the tax ID, which
 * then registered, and one marked ambiguous.
 */
describe('related_payers — the operator assigns the Organization a request names (T087)', () => {
  let h: BackendServerHandle;
  let x: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const mailer = new InMemoryMailer();
  const QUEUE = '/api/v1/admin/related-payers/requests';

  const admin = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: ADMIN, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const customer = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string) => h.app.inject({ method, url, cookies: cookie });

  async function requestFor(taxId: string): Promise<{ id: string; reply: unknown }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/related-payers/requests',
      cookies: x.cookie,
      payload: { taxId, contactEmail: 'ambiguous@example.com' },
    });
    expect(res.statusCode, res.body).toBe(202);
    return { id: res.json().data.id as string, reply: Object.keys(res.json().data).sort() };
  }
  const queued = async (id: string) =>
    ((await admin('GET', QUEUE)).json().data as Array<Record<string, unknown>>).find((r) => r['id'] === id);

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await setSetting(h, 'related_payers.enabled', true);
    x = await makeOrganizationWithAdmin(h.em(), 'Ambiguous buyer');
  }, 120_000);

  afterEach(async () => {
    await setSetting(h, 'related_payers.approval_mode', 'payer');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists the matching Organizations as candidates and routes to the one assigned (approval mode `payer`)', async () => {
    const taxId = unusedTaxId();
    const { id, reply } = await requestFor(taxId);
    expect(reply).toEqual(['id', 'state']);
    const y = await makeOrganizationWithAdmin(h.em(), 'Assigned payer', { taxId });
    await withSystemScope('test: mark a request ambiguous', () =>
      h.em().getConnection().execute(`update related_payer_requests set operator_reason = 'ambiguous_tax_id' where id = ?`, [id]),
    );
    const row = await queued(id);
    expect(row).toMatchObject({ operatorReason: 'ambiguous_tax_id', counterpartyOrganizationId: null });
    expect(row?.['candidates']).toEqual([{ organizationId: y.organizationId, name: expect.any(String) as string }]);

    // Only a candidate can be assigned; an Organization the tax ID does not name is refused.
    const stranger = await makeOrganization(h.em(), 'Not a candidate');
    expect((await admin('POST', `${QUEUE}/${id}/assign-organization`, { organizationId: stranger })).statusCode).toBe(422);

    const assigned = await admin('POST', `${QUEUE}/${id}/assign-organization`, { organizationId: y.organizationId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(await queued(id)).toBeUndefined();
    const incoming = (await customer(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data as Array<{ id: string }>;
    expect(incoming.map((r) => r.id)).toContain(id);
    await drainOutbox(h);
    expect(mailer.sent.filter((m) => m.to === y.email && m.meta?.['kind'] === 'related_payer_request_received')).toHaveLength(1);
    // The sender sees one `pending`, as before.
    const sent = (await customer(x.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<Record<string, unknown>>;
    const mine = sent.find((r) => r['id'] === id)!;
    expect(mine['state']).toBe('pending');
    for (const hidden of ['counterpartyOrganizationId', 'routing', 'operatorReason']) expect(mine).not.toHaveProperty(hidden);
    // Assigned once: the request is no longer the operator's to assign.
    expect((await admin('POST', `${QUEUE}/${id}/assign-organization`, { organizationId: y.organizationId })).statusCode).toBe(404);
  });

  it('routes by the approval mode captured on the request: `admin` keeps it in the queue, now with its Organization', async () => {
    await setSetting(h, 'related_payers.approval_mode', 'admin');
    const taxId = unusedTaxId();
    const { id } = await requestFor(taxId);
    // The setting changes after the request was created; the captured mode applies.
    await setSetting(h, 'related_payers.approval_mode', 'payer');
    const y = await makeOrganizationWithAdmin(h.em(), 'Admin-mode payer', { taxId });
    const assigned = await admin('POST', `${QUEUE}/${id}/assign-organization`, { organizationId: y.organizationId });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(await queued(id)).toMatchObject({ counterpartyOrganizationId: y.organizationId, operatorReason: 'approval_mode_admin' });
    // Now the operator can approve it: the link X → Y.
    expect((await admin('POST', `${QUEUE}/${id}/approve`)).statusCode).toBe(200);
    const links = (await admin('GET', `/api/v1/admin/organizations/${x.organizationId}/related-payers`)).json().data.asBuyer as Array<{
      payerOrganizationId: string;
      state: string;
    }>;
    expect(links.find((l) => l.payerOrganizationId === y.organizationId)?.state).toBe('active');
  });

  it('an Organization that cannot pay is assigned to the operator as ineligible', async () => {
    const taxId = unusedTaxId();
    const { id } = await requestFor(taxId);
    const blocked = await makeOrganization(h.em(), 'Blocked payer', { status: 'blocked', taxId });
    expect((await admin('POST', `${QUEUE}/${id}/assign-organization`, { organizationId: blocked })).statusCode).toBe(200);
    expect(await queued(id)).toMatchObject({ counterpartyOrganizationId: blocked, operatorReason: 'ineligible' });
  });
});
