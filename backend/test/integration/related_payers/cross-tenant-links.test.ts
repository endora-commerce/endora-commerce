import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { GS_COOKIES, ensureSalesRep } from '../../helpers/admin-search-fixtures.js';
import { OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import type { LinkReadService } from '../../../../packages/modules/related_payers/src/backend/services/link-service.js';
import { ADMIN, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` FR-020 and Principle XI (research R-5) — the payer-side read
 * is constrained to `payer_organization_id`, never a widened tenant filter; a scoped
 * administrator without reach to the buyer gets the same 404 as for a missing
 * Organization or link.
 */
describe('related payers — tenancy of links', () => {
  let h: BackendServerHandle;
  let cleanupRep: () => Promise<void>;
  const OTHER_REP_ID = randomUUID();
  let inReach: string;
  let outOfReach: string;
  let payer: string;
  let otherPayer: string;
  let outLinkId: string;

  const inject = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookies: Record<string, string>,
    payload?: Record<string, unknown>,
  ) => h.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload }) });

  beforeAll(async () => {
    h = await setupBackendServer();
    inReach = await makeOrganization(h.em(), 'In reach');
    outOfReach = await makeOrganization(h.em(), 'Out of reach');
    payer = await makeOrganization(h.em(), 'Payer');
    otherPayer = await makeOrganization(h.em(), 'Other payer');
    await withSystemScope('test seed: another representative governs the out-of-reach buyer', async () => {
      const em = h.em();
      await em.persist(em.create(OrganizationSalesRepAssignment, { organizationId: outOfReach, adminUserId: OTHER_REP_ID })).flush();
    });
    cleanupRep = await ensureSalesRep(h, [inReach, payer], ['related_payers:read', 'related_payers:manage']);
    expect((await inject('POST', `/api/v1/admin/organizations/${inReach}/related-payers`, ADMIN, { payerOrganizationId: payer })).statusCode).toBe(201);
    const out = await inject('POST', `/api/v1/admin/organizations/${outOfReach}/related-payers`, ADMIN, { payerOrganizationId: payer });
    outLinkId = out.json().data.id;
    expect((await inject('POST', `/api/v1/admin/organizations/${outOfReach}/related-payers`, ADMIN, { payerOrganizationId: otherPayer })).statusCode).toBe(201);
  });

  afterAll(async () => {
    await h?.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID]);
    await cleanupRep?.();
    await teardownBackendServer(h);
  });

  it('listAsPayer reads only links naming that payer, across buyers', async () => {
    const reads = h.container.resolve<LinkReadService>('relatedPayerLinkReads');
    const links = await withSystemScope('test: read as payer', () => reads.listAsPayer(payer));
    expect(links.map((l) => l.payerOrganizationId)).toEqual([payer, payer]);
    expect(new Set(links.map((l) => l.organizationId))).toEqual(new Set([inReach, outOfReach]));
    const other = await withSystemScope('test: read as payer', () => reads.listAsPayer(otherPayer));
    expect(other.map((l) => l.organizationId)).toEqual([outOfReach]);
    expect(await withSystemScope('test: find as payer', () => reads.findAsPayer(otherPayer, outLinkId))).toBeNull();
  });

  it('a scoped administrator without reach to the buyer gets 404, as for a missing Organization or link', async () => {
    const missingOrg = '00000000-0000-4000-8000-00000000ffff';
    const outList = await inject('GET', `/api/v1/admin/organizations/${outOfReach}/related-payers`, GS_COOKIES.salesRep);
    const missingList = await inject('GET', `/api/v1/admin/organizations/${missingOrg}/related-payers`, GS_COOKIES.salesRep);
    expect([outList.statusCode, missingList.statusCode]).toEqual([404, 404]);
    expect(outList.json().error.code).toBe(missingList.json().error.code);

    const outPatch = await inject('PATCH', `/api/v1/admin/related-payers/links/${outLinkId}`, GS_COOKIES.salesRep, { state: 'inactive' });
    const missingPatch = await inject('PATCH', `/api/v1/admin/related-payers/links/${missingOrg}`, GS_COOKIES.salesRep, {
      state: 'inactive',
    });
    expect([outPatch.statusCode, missingPatch.statusCode]).toEqual([404, 404]);
    expect((await inject('POST', `/api/v1/admin/related-payers/links/${outLinkId}/revoke`, GS_COOKIES.salesRep)).statusCode).toBe(404);
    // Naming an out-of-reach buyer as payer reveals nothing either.
    const asPayer = await inject('POST', `/api/v1/admin/organizations/${inReach}/related-payers`, GS_COOKIES.salesRep, {
      payerOrganizationId: outOfReach,
    });
    expect(asPayer.statusCode).toBe(404);
  });

  it('in reach, the representative lists the buyer and manages its link', async () => {
    const list = await inject('GET', `/api/v1/admin/organizations/${inReach}/related-payers`, GS_COOKIES.salesRep);
    expect(list.statusCode, list.body).toBe(200);
    const [link] = list.json().data.asBuyer;
    expect(link.payerOrganizationId).toBe(payer);
    const patched = await inject('PATCH', `/api/v1/admin/related-payers/links/${link.id}`, GS_COOKIES.salesRep, { state: 'inactive' });
    expect(patched.statusCode, patched.body).toBe(200);
  });
});
