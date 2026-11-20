import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, makeAddress, makeOrganizationWithAdmin, setSetting } from './fixtures.js';

/**
 * `specs/182-related-payers/` T072 (FR-047, Principle XI) — a request is read and decided only by
 * the Organization it waits for, by a user holding the approving permission; a link is revoked
 * only from its own two sides. Everyone else is answered exactly as for a request or link that
 * does not exist — an unrelated Organization (Z), the sender itself on the counterparty's route,
 * the counterparty on the sender's route.
 */
describe('related_payers — requests across tenants (T072)', () => {
  let h: BackendServerHandle;
  let x: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  let y: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  let z: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  let yMember: { b2b_session: string };
  let requestId: string;
  let linkId: string;

  const call = (cookie: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies: cookie, ...(payload !== undefined ? { payload: payload as object } : {}) });

  /** What a caller could compare: status and the error envelope, less its per-request id. */
  const answer = (res: Awaited<ReturnType<typeof call>>) => {
    const body = res.json() as { error?: { requestId?: string } };
    if (body.error) delete body.error.requestId;
    return { status: res.statusCode, body };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting(h, 'related_payers.enabled', true);
    x = await makeOrganizationWithAdmin(h.em(), 'Tenant buyer');
    y = await makeOrganizationWithAdmin(h.em(), 'Tenant payer');
    z = await makeOrganizationWithAdmin(h.em(), 'Unrelated organization');
    await makeAddress(h.em(), y.organizationId, 'billing');
    // A plain member of Y: no `related_payers.approve`.
    const memberId = randomUUID();
    await withSystemScope('test seed: payer member', async () => {
      h.em().create(CustomerAccount, {
        id: memberId,
        organizationId: y.organizationId,
        email: `rp182-member-${memberId.slice(0, 8)}@example.com`,
        passwordHash: 'not-a-real-hash',
        firstName: 'Plain',
        lastName: 'Member',
        organizationRoleId: await predefinedRoleIdOf(h.em(), y.organizationId, 'member'),
        emailVerifiedAt: new Date(),
        blockedAt: null,
      } as never);
      await h.em().flush();
    });
    const session = `stub-rp182-member-${memberId.slice(0, 8)}`;
    CUSTOMER_COOKIES[session] = { customerAccountId: memberId, organizationId: y.organizationId };
    yMember = { b2b_session: session };

    const sent = await call(x.cookie, 'POST', '/api/v1/account/related-payers/requests', { taxId: y.taxId, contactEmail: 'c@example.com' });
    expect(sent.statusCode, sent.body).toBe(202);
    requestId = sent.json().data.id as string;
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${x.organizationId}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: z.organizationId },
    });
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id as string;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the request is listed for Y\'s approver and for nobody else', async () => {
    const forY = (await call(y.cookie, 'GET', '/api/v1/account/related-payers/incoming')).json().data as Array<{ id: string }>;
    expect(forY.map((r) => r.id)).toContain(requestId);
    for (const other of [z, x]) {
      const res = await call(other.cookie, 'GET', '/api/v1/account/related-payers/incoming');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().data as Array<{ id: string }>).map((r) => r.id)).not.toContain(requestId);
    }
    // Z does not see X's own requests either.
    const zSent = (await call(z.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{ id: string }>;
    expect(zSent.map((r) => r.id)).not.toContain(requestId);
  });

  it('deciding another Organization\'s request answers as for a missing one', async () => {
    const missing = randomUUID();
    for (const action of ['accept', 'reject'] as const) {
      const absent = answer(await call(z.cookie, 'POST', `/api/v1/account/related-payers/incoming/${missing}/${action}`, {}));
      expect(absent.status).toBe(404);
      expect(answer(await call(z.cookie, 'POST', `/api/v1/account/related-payers/incoming/${requestId}/${action}`, {}))).toEqual(absent);
      // The sender cannot decide its own request through the counterparty's route.
      expect(answer(await call(x.cookie, 'POST', `/api/v1/account/related-payers/incoming/${requestId}/${action}`, {}))).toEqual(absent);
    }
    // Withdrawing is the sender's: Y and Z get the missing request's answer.
    const absent = answer(await call(z.cookie, 'POST', `/api/v1/account/related-payers/requests/${missing}/withdraw`));
    expect(absent.status).toBe(404);
    for (const other of [y, z]) {
      expect(answer(await call(other.cookie, 'POST', `/api/v1/account/related-payers/requests/${requestId}/withdraw`))).toEqual(absent);
    }
    const still = (await call(x.cookie, 'GET', '/api/v1/account/related-payers/requests')).json().data as Array<{ id: string; state: string }>;
    expect(still.find((r) => r.id === requestId)?.state).toBe('pending');
  });

  it('a Y member without the approving permission is refused alike for a real and a missing request', async () => {
    const real = answer(await call(yMember, 'POST', `/api/v1/account/related-payers/incoming/${requestId}/accept`));
    const missing = answer(await call(yMember, 'POST', `/api/v1/account/related-payers/incoming/${randomUUID()}/accept`));
    expect(real.status).toBe(403);
    expect(real).toEqual(missing);
    expect((await call(yMember, 'GET', '/api/v1/account/related-payers/incoming')).statusCode).toBe(403);
  });

  it('a link is revoked only from its own sides', async () => {
    const missing = randomUUID();
    const absentBuyerSide = answer(await call(y.cookie, 'POST', `/api/v1/account/related-payers/${missing}/revoke`));
    expect(absentBuyerSide.status).toBe(404);
    // Y is not the buyer of X → Z; Z is its payer, not its buyer.
    expect(answer(await call(y.cookie, 'POST', `/api/v1/account/related-payers/${linkId}/revoke`))).toEqual(absentBuyerSide);
    expect(answer(await call(z.cookie, 'POST', `/api/v1/account/related-payers/${linkId}/revoke`))).toEqual(absentBuyerSide);
    const absentPayerSide = answer(await call(y.cookie, 'POST', `/api/v1/account/payees/${missing}/revoke`));
    expect(absentPayerSide.status).toBe(404);
    // X is the buyer, not the payer; Y is neither.
    expect(answer(await call(x.cookie, 'POST', `/api/v1/account/payees/${linkId}/revoke`))).toEqual(absentPayerSide);
    expect(answer(await call(y.cookie, 'POST', `/api/v1/account/payees/${linkId}/revoke`))).toEqual(absentPayerSide);
    // Each side's own list: X sees its payer Z; Z sees its payee X; Y sees neither.
    const xPayers = (await call(x.cookie, 'GET', '/api/v1/account/related-payers')).json().data as Array<{ id: string }>;
    expect(xPayers.map((l) => l.id)).toContain(linkId);
    const zPayees = (await call(z.cookie, 'GET', '/api/v1/account/payees')).json().data as Array<{ id: string; organizationId: string }>;
    expect(zPayees.find((l) => l.id === linkId)?.organizationId).toBe(x.organizationId);
    for (const url of ['/api/v1/account/related-payers', '/api/v1/account/payees']) {
      const list = (await call(y.cookie, 'GET', url)).json().data as Array<{ id: string }>;
      expect(list.map((l) => l.id)).not.toContain(linkId);
    }
  });
});
