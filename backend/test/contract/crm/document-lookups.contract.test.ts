import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityQuoteRequestLookupResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * The Quote Requests an Opportunity's link picker chooses from
 * (`specs/143-crm-sales-opportunities/`, User Story 8 — task T101; research
 * N-H2).
 *
 * CRM answers the picker itself, through `quote_requests`' published read
 * port: the Organization's open requests and the one whose number is typed,
 * as `id`, `number`, `status` and nothing else.
 *
 * It asks for `crm:write` **and** `rfqs:handle` (research N-R13, which
 * reverses N-H2 on this point): the answer is Quote Request data, and what
 * another module owns is shown only to somebody who may read it there. The
 * desk's own gate is not widened either way.
 */
describe('crm document lookups (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let reader: Seeded;
  let writer: Seeded;
  /** `crm:write` without the quote desk's code. */
  let crmWriter: Seeded;
  /** The quote desk's code without `crm:write`. */
  let desk: Seeded;
  let rep: Seeded;
  let outsider: Seeded;
  let quote: { id: string; businessId: string };

  const get = (path: string, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: path, cookies });
  const path = (organizationId: string, q = ''): string =>
    `${CRM_API}/lookups/quote-requests?organizationId=${organizationId}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const options = async (url: string, cookies?: Record<string, string>) => {
    const response = await get(url, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityQuoteRequestLookupResponseSchema.parse(response.json()).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Document lookup other');
    reader = await seedCrmAdmin(h.em(), 'doc-lookup-reader', ['crm:read', 'orders:read']);
    writer = await seedCrmAdmin(h.em(), 'doc-lookup-writer', ['crm:read', 'crm:write', 'rfqs:handle']);
    crmWriter = await seedCrmAdmin(h.em(), 'doc-lookup-crm-writer', ['crm:read', 'crm:write']);
    desk = await seedCrmAdmin(h.em(), 'doc-lookup-desk', ['crm:read', 'rfqs:handle']);
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write', 'rfqs:handle']);
    outsider = await seedCrmSalesRep(h.em(), [otherOrganizationId], ['crm:read', 'crm:write', 'rfqs:handle']);
    quote = await submitCrmQuoteRequest(h);
  });

  afterAll(async () => {
    for (const seeded of [reader, writer, crmWriter, desk, rep, outsider]) seeded.undo();
    await teardownBackendServer(h);
  });

  it('is gated crm:write — a link is a write — and rfqs:handle, the code a Quote Request is read with', async () => {
    expect((await get(path(TEST_ORGANIZATION_ID), reader.cookies)).statusCode).toBe(403);
    // Either code alone is not enough.
    expect((await get(path(TEST_ORGANIZATION_ID), crmWriter.cookies)).statusCode).toBe(403);
    expect((await get(path(TEST_ORGANIZATION_ID), desk.cookies)).statusCode).toBe(403);
    expect((await get(path(TEST_ORGANIZATION_ID), writer.cookies)).statusCode).toBe(200);
    // Nobody's gate is widened: the desk's own list still refuses a role without its code.
    expect((await get('/api/v1/admin/quote-requests', crmWriter.cookies)).statusCode).toBe(403);
    expect((await get('/api/v1/admin/quote-requests', CRM_ADMIN)).statusCode).toBe(200);
  });

  it('offers the Organization`s open Quote Requests: id, number and status, nothing else', async () => {
    const found = await options(path(TEST_ORGANIZATION_ID), writer.cookies);
    const mine = found.find((option) => option.id === quote.id);
    expect(mine).toEqual({ id: quote.id, number: quote.businessId, status: 'Pending' });
    const raw = (await get(path(TEST_ORGANIZATION_ID, quote.businessId), writer.cookies)).json() as {
      data: Record<string, unknown>[];
    };
    expect(Object.keys(raw.data[0]!).sort()).toEqual(['id', 'number', 'status']);
  });

  it('searches by number, whatever the case, and answers nothing for a number nobody has', async () => {
    expect(
      (await options(path(TEST_ORGANIZATION_ID, quote.businessId.toLowerCase()), writer.cookies)).map(
        (option) => option.id,
      ),
    ).toEqual([quote.id]);
    expect(await options(path(TEST_ORGANIZATION_ID, 'no-such-number-zz'), writer.cookies)).toEqual([]);
  });

  it('never offers another Organization`s Quote Request, by list or by exact number', async () => {
    expect(await options(path(otherOrganizationId))).toEqual([]);
    expect(await options(path(otherOrganizationId, quote.businessId))).toEqual([]);
  });

  it('answers a confined administrator for their Organizations only', async () => {
    // Positive control: the Organization's own Sales Rep finds it.
    expect((await options(path(TEST_ORGANIZATION_ID), rep.cookies)).some((o) => o.id === quote.id)).toBe(true);
    // Out of reach: an empty list, not a refusal — as the contact lookup answers.
    expect(await options(path(TEST_ORGANIZATION_ID), outsider.cookies)).toEqual([]);
    expect(await options(path(TEST_ORGANIZATION_ID, quote.businessId), outsider.cookies)).toEqual([]);
  });

  it('refuses a request that names no Organization', async () => {
    const response = await get(`${CRM_API}/lookups/quote-requests`, writer.cookies);
    expect(response.statusCode).toBe(400);
  });
});
