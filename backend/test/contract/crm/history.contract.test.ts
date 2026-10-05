import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityHistoryResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';

/**
 * The change history of an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §11):
 * `GET /opportunities/:id/history?limit&cursor`, gated `crm:read`, newest
 * first, paged.
 */
describe('crm opportunity history (contract)', () => {
  let h: BackendServerHandle;
  let outsider: { cookies: { b2b_session: string }; undo: () => void };

  const history = (id: string, query = '', cookies: Record<string, string> = CRM_ADMIN) =>
    h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}/history${query}`, cookies });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    // Holds a permission of another module and none of this one.
    outsider = await seedCrmAdmin(h.em(), 'outsider', ['orders:read']);
  });

  afterAll(async () => {
    outsider.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('answers the envelope of the contract, newest first', async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'History contract' });
    expect((await transitionCrmOpportunity(h, opportunity.id, 'qualified')).statusCode).toBe(200);

    const response = await history(opportunity.id);
    expect(response.statusCode, response.body).toBe(200);
    const body = OpportunityHistoryResponseSchema.parse(response.json());
    expect(body.pagination).toEqual({ cursor: null, hasMore: false, limit: 50 });
    expect(body.data.map((entry) => entry.action)).toEqual([
      'crm.opportunity.transition',
      'crm.opportunity.create',
    ]);
    const [transition, creation] = body.data;
    expect(transition).toMatchObject({
      actor: { kind: 'admin' },
      before: { status: 'new' },
      after: { status: 'qualified', cause: 'manual' },
    });
    expect(transition?.actor.id).toEqual(expect.any(String));
    expect(creation).toMatchObject({ before: null, after: { title: 'History contract', statusCode: 'new' } });
    expect(Date.parse(transition?.actedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(creation?.actedAt ?? ''));
    // Exactly the fields of the contract: nothing of the audit row beyond them.
    expect(Object.keys(transition ?? {}).sort()).toEqual(['actedAt', 'action', 'actor', 'after', 'before', 'id']);
    expect(Object.keys(transition?.actor ?? {}).sort()).toEqual(['id', 'kind', 'name']);
  });

  it('pages with limit and cursor, each entry once', async () => {
    const opportunity = await createCrmOpportunity(h);
    for (const title of ['One', 'Two', 'Three', 'Four']) {
      const edited = await h.app.inject({
        method: 'PATCH',
        url: `${CRM_API}/opportunities/${opportunity.id}`,
        cookies: CRM_ADMIN,
        payload: { title },
      });
      expect(edited.statusCode, edited.body).toBe(200);
    }
    // Five entries: the creation and four edits.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await history(opportunity.id, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(response.statusCode, response.body).toBe(200);
      const body = OpportunityHistoryResponseSchema.parse(response.json());
      expect(body.pagination.limit).toBe(2);
      expect(body.data.length).toBeLessThanOrEqual(2);
      seen.push(...body.data.map((entry) => entry.id));
      expect(body.pagination.hasMore).toBe(body.pagination.cursor !== null);
      cursor = body.pagination.cursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);

    const all = OpportunityHistoryResponseSchema.parse((await history(opportunity.id)).json()).data;
    expect(seen).toEqual(all.map((entry) => entry.id));
    expect(all.map((entry) => (entry.after as { title?: string } | null)?.title)).toEqual([
      'Four',
      'Three',
      'Two',
      'One',
      'Fixture opportunity',
    ]);
  });

  it('refuses a query the schema does not accept, and a cursor it did not issue — 400', async () => {
    const opportunity = await createCrmOpportunity(h);
    for (const query of ['?limit=0', '?limit=201', '?limit=abc', '?cursor=not-a-cursor']) {
      const response = await history(opportunity.id, query);
      expect(response.statusCode, `${query}: ${response.body}`).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an unknown Opportunity and a malformed id', async () => {
    for (const id of [randomUUID(), 'not-a-uuid']) {
      const response = await history(id);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    }
  });

  it('is gated crm:read', async () => {
    const opportunity = await createCrmOpportunity(h);
    const refused = await history(opportunity.id, '', outsider.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    const anonymous = await h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${opportunity.id}/history` });
    expect(anonymous.statusCode).toBe(401);
  });
});
