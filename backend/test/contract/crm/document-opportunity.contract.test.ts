import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityOfDocumentResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  linkCrmQuoteRequest,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';

/**
 * The Opportunity of a document — what the panel on the Order screen and on
 * the Quote Request screen reads
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12b; User Story 17).
 *
 * `GET /documents/:documentKind/:documentId/opportunity`, gated `crm:read` and
 * the read permission of the document's owner.
 * The document is checked first, through its owner's read port and under the
 * caller's tenant scope, so a document the caller may not see answers exactly
 * like one that does not exist — and never says whether it is linked.
 */
describe('crm document → opportunity (contract)', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let rep: { cookies: { b2b_session: string }; undo: () => void };
  let stranger: { cookies: { b2b_session: string }; undo: () => void };

  const get = (kind: string, documentId: string, cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: `${CRM_API}/documents/${kind}/${documentId}/opportunity`, cookies });

  const errorCode = (response: { json(): unknown }) => (response.json() as { error: { code: string } }).error.code;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Document A');
    organizationB = await seedCrmOrganization(h.em(), 'Document B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write', 'orders:read']);
    stranger = await seedCrmAdmin(h.em(), 'no-crm', ['orders:read']);
  });

  afterAll(async () => {
    rep.undo();
    stranger.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('answers the linked Opportunity’s summary', async () => {
    const opportunity = await createCrmOpportunity(h, {
      title: 'Linked from an order',
      organizationId: organizationA,
      manualValue: '4200',
    });
    const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);

    const response = await get('order', order.id);
    expect(response.statusCode, response.body).toBe(200);
    const { data } = OpportunityOfDocumentResponseSchema.parse(response.json());
    expect(data).toMatchObject({
      id: opportunity.id,
      number: opportunity.number,
      title: 'Linked from an order',
      organization: { id: organizationA },
      status: { code: 'new', kind: 'open' },
      value: '4200.00',
      currency: 'PLN',
    });
    // A summary, not the detail: nothing of the Opportunity's body travels to the Order screen.
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('links');
    expect(data).not.toHaveProperty('customFieldValues');
  });

  it('answers null for a document that exists and is linked to nothing', async () => {
    const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
    const response = await get('order', order.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });

  it('answers 404 CRM_DOCUMENT_NOT_FOUND for a document that does not exist', async () => {
    const response = await get('order', '00000000-0000-4000-8000-00000000dead');
    expect(response.statusCode, response.body).toBe(404);
    expect(errorCode(response)).toBe('CRM_DOCUMENT_NOT_FOUND');
    const malformed = await get('order', 'not-an-id');
    expect(malformed.statusCode, malformed.body).toBe(404);
    expect(errorCode(malformed)).toBe('CRM_DOCUMENT_NOT_FOUND');
  });

  it('answers the same 404 for a document outside the caller’s scope, linked or not', async () => {
    const theirs = await createCrmOpportunity(h, { title: 'Theirs', organizationId: organizationB });
    const linked = await seedCrmOrder(h.em(), { organizationId: organizationB });
    const unlinked = await seedCrmOrder(h.em(), { organizationId: organizationB });
    expect((await linkCrmOrder(h, theirs.id, linked.id)).statusCode).toBe(201);
    const mine = await seedCrmOrder(h.em(), { organizationId: organizationA });

    // Positive controls: the confined caller reads their own Organization's
    // Order, and the platform administrator reads the other Organization's.
    expect((await get('order', mine.id, rep.cookies)).statusCode).toBe(200);
    expect((await get('order', linked.id)).statusCode).toBe(200);

    for (const order of [linked, unlinked]) {
      const response = await get('order', order.id, rep.cookies);
      expect(response.statusCode, response.body).toBe(404);
      expect(errorCode(response)).toBe('CRM_DOCUMENT_NOT_FOUND');
      expect(response.body).not.toContain('Theirs');
      expect(response.body).not.toContain(theirs.id);
    }
  });

  it('answers 422 for a kind that is not a document kind', async () => {
    const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
    const response = await get('invoice', order.id);
    expect(response.statusCode, response.body).toBe(422);
    expect(errorCode(response)).toBe('VALIDATION_FAILED');
  });

  describe('a Quote Request', () => {
    let quoteReader: { cookies: { b2b_session: string }; undo: () => void };
    let outsider: { cookies: { b2b_session: string }; undo: () => void };
    let crmReader: { cookies: { b2b_session: string }; undo: () => void };

    beforeAll(async () => {
      quoteReader = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'rfqs:handle']);
      // Confined to another Organization: the test Organization's requests do not exist for them.
      outsider = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'rfqs:handle']);
      crmReader = await seedCrmAdmin(h.em(), 'doc-crm-reader', ['crm:read', 'orders:read']);
    });

    afterAll(() => {
      for (const seeded of [quoteReader, outsider, crmReader]) seeded.undo();
    });

    it('answers the linked Opportunity’s summary, and null for one linked to nothing', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Linked from a quote request' });
      const linked = await submitCrmQuoteRequest(h);
      const unlinked = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, opportunity.id, linked.id)).statusCode).toBe(201);

      const response = await get('quote_request', linked.id, quoteReader.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityOfDocumentResponseSchema.parse(response.json());
      expect(data).toMatchObject({ id: opportunity.id, number: opportunity.number, title: 'Linked from a quote request' });
      expect(data).not.toHaveProperty('links');

      const none = await get('quote_request', unlinked.id, quoteReader.cookies);
      expect(none.statusCode, none.body).toBe(200);
      expect(none.json()).toEqual({ data: null });
    });

    it('answers 404 CRM_DOCUMENT_NOT_FOUND for one that does not exist, and the same for one outside the caller’s scope, linked or not', async () => {
      const missing = await get('quote_request', '00000000-0000-4000-8000-00000000dead');
      expect(missing.statusCode, missing.body).toBe(404);
      expect(errorCode(missing)).toBe('CRM_DOCUMENT_NOT_FOUND');
      const malformed = await get('quote_request', 'not-an-id');
      expect(malformed.statusCode, malformed.body).toBe(404);

      const theirs = await createCrmOpportunity(h, { title: 'Theirs by quote' });
      const linked = await submitCrmQuoteRequest(h);
      const unlinked = await submitCrmQuoteRequest(h);
      expect((await linkCrmQuoteRequest(h, theirs.id, linked.id)).statusCode).toBe(201);
      // Positive controls: the Organization's own reader, and the platform administrator.
      expect((await get('quote_request', linked.id, quoteReader.cookies)).statusCode).toBe(200);
      expect((await get('quote_request', unlinked.id)).statusCode).toBe(200);

      for (const quote of [linked, unlinked]) {
        const response = await get('quote_request', quote.id, outsider.cookies);
        expect(response.statusCode, response.body).toBe(404);
        expect(errorCode(response)).toBe('CRM_DOCUMENT_NOT_FOUND');
        expect(response.body).not.toContain('Theirs by quote');
        expect(response.body).not.toContain(theirs.id);
      }
    });

    it('asks for rfqs:handle — the code a Quote Request is read with', async () => {
      const quote = await submitCrmQuoteRequest(h);
      const refused = await get('quote_request', quote.id, crmReader.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(errorCode(refused)).toBe('FORBIDDEN');
      // Whether it exists is not said either.
      expect((await get('quote_request', '00000000-0000-4000-8000-00000000dead', crmReader.cookies)).statusCode).toBe(403);
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'answers 503 MODULE_DISABLED naming quote_requests while that module is %s, whoever asks — and Orders are unaffected',
      async (axis) => {
        const quote = await submitCrmQuoteRequest(h);
        const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
        await withModuleOff('quote_requests', axis, async () => {
          for (const cookies of [CRM_ADMIN, quoteReader.cookies, crmReader.cookies]) {
            const response = await get('quote_request', quote.id, cookies);
            expect(response.statusCode, `${axis}: ${response.body}`).toBe(503);
            expect(errorCode(response)).toBe('MODULE_DISABLED');
            expect((response.json() as { error: { details?: { module?: string } } }).error.details?.module).toBe(
              'quote_requests',
            );
          }
          expect((await get('order', order.id)).statusCode).toBe(200);
        });
      },
    );
  });

  it('is gated crm:read', async () => {
    const order = await seedCrmOrder(h.em(), { organizationId: organizationA });
    const refused = await get('order', order.id, stranger.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    const anonymous = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/documents/order/${order.id}/opportunity`,
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
