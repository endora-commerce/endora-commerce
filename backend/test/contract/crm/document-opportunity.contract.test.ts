import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityOfDocumentResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * The Opportunity of a document — what the panel on the Order screen reads
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12b; User Story 17).
 *
 * `GET /documents/:documentKind/:documentId/opportunity`, gated `crm:read`.
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
