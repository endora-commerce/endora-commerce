import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN, makeAddress, makeAdmin, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` US1 (FR-010 – FR-013, FR-020 – FR-022, FR-119) — an operator
 * links a payer on the buyer's card, through `contracts/admin-api.md`'s link routes.
 */
describe('related payers — operator links (US1)', () => {
  let h: BackendServerHandle;
  const undo: Array<() => void> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const u of undo) u();
    await teardownBackendServer(h);
  });

  const listUrl = (orgId: string) => `/api/v1/admin/organizations/${orgId}/related-payers`;
  const inject = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
    cookies: Record<string, string> = ADMIN,
    headers: Record<string, string> = {},
  ) => h.app.inject({ method, url, cookies, headers, ...(payload === undefined ? {} : { payload }) });

  async function auditOf(action: string, objectId: string) {
    return h.em().fork().find(AuditLogEntry, { action, objectId });
  }

  it('US1-1: adds an existing Organization as payer, active, on the buyer terms; both lists show it', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const created = await inject('POST', listUrl(x), { payerOrganizationId: y });
    expect(created.statusCode, created.body).toBe(201);
    const link = created.json().data;
    expect(link).toMatchObject({
      buyerOrganizationId: x,
      payerOrganizationId: y,
      state: 'active',
      addressScope: 'all',
      commercialTerms: 'buyer',
      origin: 'operator',
      version: 1,
    });
    expect(link.payerName).toContain('Payer Y');

    const asBuyer = (await inject('GET', listUrl(x))).json().data;
    expect(asBuyer.asBuyer.map((l: { id: string }) => l.id)).toEqual([link.id]);
    expect(asBuyer.asPayer).toEqual([]);
    const asPayer = (await inject('GET', listUrl(y))).json().data;
    expect(asPayer.asPayer.map((l: { id: string }) => l.id)).toEqual([link.id]);
    expect(asPayer.asBuyer).toEqual([]);

    const [entry] = await auditOf('related_payers.link.create', link.id);
    expect(entry?.actorAdminUserId).toBe(TEST_ADMIN_ID);
    expect(entry?.stateAfter).toMatchObject({ actorKind: 'operator', payerOrganizationId: y });
  });

  it('US1-2: one billing address of the payer, a window and the payer terms; another org\'s address is refused', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const z = await makeOrganization(h.em(), 'Other Z');
    const billing = await makeAddress(h.em(), y, 'billing');
    const delivery = await makeAddress(h.em(), y, 'delivery');
    const foreign = await makeAddress(h.em(), z, 'billing');

    for (const billingAddressId of [delivery, foreign]) {
      const refused = await inject('POST', listUrl(x), { payerOrganizationId: y, addressScope: { kind: 'one', billingAddressId } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json().error.code).toBe('VALIDATION_FAILED');
    }
    const created = await inject('POST', listUrl(x), {
      payerOrganizationId: y,
      addressScope: { kind: 'one', billingAddressId: billing },
      // RP-15 — the panel sends the start / end of the operator's days, in their zone.
      validFrom: '2026-01-01T00:00:00.000+01:00',
      validTo: '2026-12-31T23:59:59.999+01:00',
      commercialTerms: 'payer',
      notifyPayerOnOrders: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data).toMatchObject({
      addressScope: 'one',
      billingAddressId: billing,
      validFrom: '2025-12-31T23:00:00.000Z',
      validTo: '2026-12-31T22:59:59.999Z',
      commercialTerms: 'payer',
      notifyPayerOnOrders: true,
    });
  });

  it('US1-3: PATCH with If-Match changes scope, window, terms; a stale version is 409; the audit names the fields', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const link = (await inject('POST', listUrl(x), { payerOrganizationId: y })).json().data;
    const url = `/api/v1/admin/related-payers/links/${link.id}`;

    const patched = await inject('PATCH', url, { commercialTerms: 'payer', validTo: '2027-01-31T22:59:59.999Z' }, ADMIN, {
      'if-match': `"${link.version}"`,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.headers.etag).toBe('"2"');
    expect(patched.json().data).toMatchObject({ commercialTerms: 'payer', validTo: '2027-01-31T22:59:59.999Z', version: 2 });

    const stale = await inject('PATCH', url, { notifyPayerOnOrders: true }, ADMIN, { 'if-match': '"1"' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    const badHeader = await inject('PATCH', url, { notifyPayerOnOrders: true }, ADMIN, { 'if-match': 'yesterday' });
    expect(badHeader.statusCode).toBe(400);

    const [entry] = await auditOf('related_payers.link.update', link.id);
    expect(entry?.stateAfter).toMatchObject({ changedFields: ['commercialTerms', 'validTo'], commercialTerms: 'payer' });
    // The stored entry drops a `null` value; the unit sentinel test holds the full before-state.
    expect(entry?.stateBefore).toMatchObject({ commercialTerms: 'buyer' });
  });

  // FR-021 (owner, 2026-11-19) — the card's address restriction and payer e-mails controls.
  it('FR-021: PATCH limits a link to one billing address and back to all, and switches the payer e-mails; each is audited', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const billing = await makeAddress(h.em(), y, 'billing');
    const delivery = await makeAddress(h.em(), y, 'delivery');
    const link = (await inject('POST', listUrl(x), { payerOrganizationId: y })).json().data;
    const url = `/api/v1/admin/related-payers/links/${link.id}`;

    const refused = await inject('PATCH', url, { addressScope: { kind: 'one', billingAddressId: delivery } }, ADMIN, {
      'if-match': '"1"',
    });
    expect(refused.statusCode, refused.body).toBe(422);

    const one = await inject('PATCH', url, { addressScope: { kind: 'one', billingAddressId: billing } }, ADMIN, {
      'if-match': '"1"',
    });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().data).toMatchObject({ addressScope: 'one', billingAddressId: billing, version: 2 });

    const notify = await inject('PATCH', url, { notifyPayerOnOrders: true }, ADMIN, { 'if-match': '"2"' });
    expect(notify.statusCode, notify.body).toBe(200);
    expect(notify.json().data).toMatchObject({ notifyPayerOnOrders: true, addressScope: 'one', version: 3 });

    const all = await inject('PATCH', url, { addressScope: { kind: 'all' } }, ADMIN, { 'if-match': '"3"' });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json().data).toMatchObject({ addressScope: 'all', billingAddressId: null, notifyPayerOnOrders: true });

    const entries = await auditOf('related_payers.link.update', link.id);
    const changed = entries.map((entry) => (entry.stateAfter as { changedFields?: string[] } | null)?.changedFields);
    expect(changed).toEqual(
      expect.arrayContaining([['addressScope', 'billingAddressId'], ['notifyPayerOnOrders']]),
    );
    expect(entries.every((entry) => entry.actorAdminUserId === TEST_ADMIN_ID)).toBe(true);
  });

  it('US1-4: deactivate, activate, revoke; a revoked link is terminal; the pair can be linked again', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const link = (await inject('POST', listUrl(x), { payerOrganizationId: y })).json().data;
    const url = `/api/v1/admin/related-payers/links/${link.id}`;

    expect((await inject('PATCH', url, { state: 'inactive' })).json().data.state).toBe('inactive');
    expect((await inject('PATCH', url, { state: 'active' })).json().data.state).toBe('active');
    const revoked = await inject('POST', `${url}/revoke`);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect(revoked.json().data).toMatchObject({ state: 'revoked', revokedByKind: 'operator' });

    const reactivate = await inject('PATCH', url, { state: 'active' });
    expect(reactivate.statusCode).toBe(409);
    expect(reactivate.json().error.code).toBe('INVALID_TRANSITION');
    expect((await inject('POST', `${url}/revoke`)).statusCode).toBe(409);

    // FR-013 — re-linking a revoked pair creates a new link.
    const again = await inject('POST', listUrl(x), { payerOrganizationId: y });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json().data.id).not.toBe(link.id);

    const [entry] = await auditOf('related_payers.link.revoke', link.id);
    expect(entry?.actorAdminUserId).toBe(TEST_ADMIN_ID);
  });

  it('FR-010: refuses the same Organization, a personal one and a second live link of the pair', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const personal = await makeOrganization(h.em(), 'Personal', { isPersonal: true });

    const self = await inject('POST', listUrl(x), { payerOrganizationId: x });
    expect([self.statusCode, self.json().error.code]).toEqual([422, 'RELATED_PAYER_INVALID_PAIR']);
    const toPersonal = await inject('POST', listUrl(x), { payerOrganizationId: personal });
    expect([toPersonal.statusCode, toPersonal.json().error.code]).toEqual([422, 'RELATED_PAYER_INVALID_PAIR']);
    const fromPersonal = await inject('POST', listUrl(personal), { payerOrganizationId: y });
    expect([fromPersonal.statusCode, fromPersonal.json().error.code]).toEqual([422, 'RELATED_PAYER_INVALID_PAIR']);

    expect((await inject('POST', listUrl(x), { payerOrganizationId: y })).statusCode).toBe(201);
    const twice = await inject('POST', listUrl(x), { payerOrganizationId: y });
    expect([twice.statusCode, twice.json().error.code]).toEqual([422, 'RELATED_PAYER_LINK_EXISTS']);
    // The reverse direction is a different ordered pair.
    expect((await inject('POST', listUrl(y), { payerOrganizationId: x })).statusCode).toBe(201);
  });

  it('FR-021: creates a new Organization, active, linked at once; its first user is invited through the members route', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const channelId = await systemDefaultSalesChannelId(h.em());
    const stamp = Date.now().toString().slice(-8);
    const created = await inject('POST', `${listUrl(x)}/new-organization`, {
      organization: {
        name: `New Payer ${stamp}`,
        taxId: `PL182${stamp}`,
        registeredAddress: { street: 'Nowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
        salesChannelIds: [channelId],
      },
      link: { commercialTerms: 'payer' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { organizationId, link } = created.json().data;
    expect(link).toMatchObject({ buyerOrganizationId: x, payerOrganizationId: organizationId, state: 'active', commercialTerms: 'payer' });
    const org = await h.app.inject({ method: 'GET', url: `/api/v1/admin/organizations/${organizationId}`, cookies: ADMIN });
    expect(org.json().data).toMatchObject({ status: 'active', taxId: `PL182${stamp}` });

    const invite = await inject('POST', `/api/v1/admin/organizations/${organizationId}/members/invite`, {
      email: `payer-${stamp}@example.test`,
    });
    expect(invite.statusCode, invite.body).toBe(201);
  });

  it('FR-024: without related_payers:manage the writes are 403; without :read the panel API is 403', async () => {
    const x = await makeOrganization(h.em(), 'Buyer X');
    const y = await makeOrganization(h.em(), 'Payer Y');
    const link = (await inject('POST', listUrl(x), { payerOrganizationId: y })).json().data;
    const reader = await makeAdmin(h.em(), 'reader', ['related_payers:read']);
    const nobody = await makeAdmin(h.em(), 'nobody', ['orders:read']);
    const managerWithoutCustomers = await makeAdmin(h.em(), 'manager', ['related_payers:read', 'related_payers:manage']);
    undo.push(reader.undo, nobody.undo, managerWithoutCustomers.undo);

    expect((await inject('GET', listUrl(x), undefined, reader.cookies)).statusCode).toBe(200);
    expect((await inject('GET', listUrl(x), undefined, nobody.cookies)).statusCode).toBe(403);
    expect((await inject('POST', listUrl(x), { payerOrganizationId: y }, reader.cookies)).statusCode).toBe(403);
    expect(
      (await inject('PATCH', `/api/v1/admin/related-payers/links/${link.id}`, { state: 'inactive' }, reader.cookies))
        .statusCode,
    ).toBe(403);
    expect(
      (await inject('POST', `/api/v1/admin/related-payers/links/${link.id}/revoke`, undefined, reader.cookies)).statusCode,
    ).toBe(403);
    // Creating the payer Organization is also the organization create (`customers:manage`).
    expect(
      (
        await inject(
          'POST',
          `${listUrl(x)}/new-organization`,
          {
            organization: {
              name: 'Refused',
              taxId: 'PL1820000000',
              registeredAddress: { street: 'a', city: 'b', postalCode: 'c', country: 'PL' },
              salesChannelIds: [await systemDefaultSalesChannelId(h.em())],
            },
          },
          managerWithoutCustomers.cookies,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('unknown ids answer 404', async () => {
    const missing = '00000000-0000-4000-8000-00000000ffff';
    expect((await inject('GET', listUrl(missing))).statusCode).toBe(404);
    expect((await inject('GET', listUrl('not-a-uuid'))).statusCode).toBe(404);
    expect((await inject('PATCH', `/api/v1/admin/related-payers/links/${missing}`, { state: 'inactive' })).statusCode).toBe(404);
    const x = await makeOrganization(h.em(), 'Buyer X');
    expect((await inject('POST', listUrl(x), { payerOrganizationId: missing })).statusCode).toBe(404);
  });
});
