import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityListResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { CrmOpportunityStatusHistory } from '../../helpers/package-entities.js';

/**
 * Opportunities — list, create, read, edit, delete
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1).
 */
describe('crm opportunities (contract)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let salesChannelId: string;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let writer: { cookies: { b2b_session: string }; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { payload?: unknown; cookies?: Record<string, string>; headers?: Record<string, string> } = {},
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies: options.cookies ?? CRM_ADMIN,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });

  const create = async (body: Record<string, unknown> = {}) => {
    const response = await call('POST', '/opportunities', {
      payload: { title: 'Contract opportunity', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', ...body },
    });
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const list = async (query: string, cookies?: Record<string, string>) => {
    const response = await call('GET', `/opportunities${query}`, cookies ? { cookies } : {});
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json());
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Other');
    const [channel] = (await h.em().getConnection().execute(
      `select "id" from "sales_channels" where "system_default" = true limit 1`,
    )) as Array<{ id: string }>;
    salesChannelId = channel!.id;
    viewer = await seedCrmAdmin(h.em(), 'viewer', ['crm:read']);
    writer = await seedCrmAdmin(h.em(), 'writer', ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    viewer.undo();
    writer.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('POST /opportunities', () => {
    it('creates an Opportunity in the start status, numbered, with the creation in its status history', async () => {
      const response = await call('POST', '/opportunities', {
        payload: {
          title: '  Fleet renewal  ',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          description: 'Twelve vans',
          customerAccountId: TEST_CUSTOMER_ID,
          salesChannelId,
          manualValue: '12500.50',
          expectedCloseDate: '2026-12-31',
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      const { data } = OpportunityDetailResponseSchema.parse(response.json());
      expect(response.headers['etag']).toBe(`"${data.version}"`);
      expect(data).toMatchObject({
        title: 'Fleet renewal',
        organization: { id: TEST_ORGANIZATION_ID, name: 'Test Organization' },
        status: { code: 'new', kind: 'open' },
        value: '12500.50',
        valueMode: 'manual',
        manualValue: '12500.50',
        currency: 'PLN',
        salesChannelId,
        expectedCloseDate: '2026-12-31',
        description: 'Twelve vans',
        customerAccount: { id: TEST_CUSTOMER_ID, email: 'stub-customer@example.com' },
        source: 'manual',
        closedAt: null,
        closedKind: null,
        links: [],
        unresolvedPropagations: [],
      });
      expect(data.number).toMatch(/^OPP-\d{6,}$/);
      expect(data.allowedTransitions.map((status) => status.code).sort()).toEqual(['lost', 'qualified']);

      const history = await h.em().find(CrmOpportunityStatusHistory, { opportunityId: data.id }, { filters: false });
      expect(history).toHaveLength(1);
      // A creation entry has no source status.
      expect(history[0]?.fromStatusCode ?? null).toBeNull();
      expect(history[0]).toMatchObject({
        toStatusCode: 'new',
        cause: 'created',
        actorAdminUserId: TEST_ADMIN_ID,
      });
    });

    it('numbers consecutive Opportunities differently', async () => {
      const first = await create();
      const second = await create();
      expect(second.number).not.toBe(first.number);
    });

    it('is audited as crm.opportunity.create and emits crm.opportunity.created.v1 once', async () => {
      const seen: unknown[] = [];
      const off = h.eventBus.on('crm.opportunity.created.v1', (payload: unknown) => {
        seen.push(payload);
      });
      try {
        const created = await create({ title: 'Audited' });
        const entries = await h.auditLogService.query({
          action: 'crm.opportunity.create',
          objectId: created.id,
        });
        expect(entries).toHaveLength(1);
        expect(entries[0]?.objectType).toBe('crm_opportunity');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
          opportunityId: created.id,
          organizationId: TEST_ORGANIZATION_ID,
          number: created.number,
          source: 'manual',
        });
      } finally {
        if (typeof off === 'function') off();
      }
    });

    it.each([
      ['no title', { title: '' }],
      ['no currency', { currency: undefined }],
      ['a malformed currency', { currency: 'zloty' }],
      ['no organization', { organizationId: undefined }],
      ['a negative value', { manualValue: '-1' }],
    ])('refuses %s — the schema', async (_label, override) => {
      const response = await call('POST', '/opportunities', {
        payload: { title: 'x', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', ...override },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses an Organization that does not exist', async () => {
      const response = await call('POST', '/opportunities', {
        payload: { title: 'x', organizationId: '00000000-0000-4000-8000-00000000dead', currency: 'PLN' },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a contact person of another Organization', async () => {
      const response = await call('POST', '/opportunities', {
        payload: {
          title: 'x',
          organizationId: otherOrganizationId,
          currency: 'PLN',
          customerAccountId: TEST_CUSTOMER_ID,
        },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a Sales Channel that does not exist', async () => {
      const response = await call('POST', '/opportunities', {
        payload: {
          title: 'x',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          salesChannelId: '00000000-0000-4000-8000-00000000dead',
        },
      });
      expect(response.statusCode, response.body).toBe(422);
    });

    it('refuses a tag that does not exist — 422', async () => {
      const response = await call('POST', '/opportunities', {
        payload: {
          title: 'x',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          tagIds: ['00000000-0000-4000-8000-00000000dead'],
        },
      });
      expect(response.statusCode, response.body).toBe(422);
    });

    it('accepts an assignee who is an administrator, and refuses one who is not', async () => {
      const assigned = await create({ assignedAdminUserId: TEST_ADMIN_ID });
      expect(assigned.assignee).toMatchObject({ id: TEST_ADMIN_ID, active: true });
      const response = await call('POST', '/opportunities', {
        payload: {
          title: 'x',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          assignedAdminUserId: '00000000-0000-4000-8000-00000000dead',
        },
      });
      expect(response.statusCode, response.body).toBe(422);
    });

    it('is gated crm:write', async () => {
      const response = await call('POST', '/opportunities', {
        cookies: viewer.cookies,
        payload: { title: 'x', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN' },
      });
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  describe('GET /opportunities/:id', () => {
    it('answers the detail with an ETag carrying the version', async () => {
      const created = await create({ title: 'Readable' });
      const response = await call('GET', `/opportunities/${created.id}`, { cookies: viewer.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityDetailResponseSchema.parse(response.json());
      expect(data.id).toBe(created.id);
      expect(response.headers['etag']).toBe(`"${data.version}"`);
    });

    it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an unknown id', async () => {
      const response = await call('GET', '/opportunities/00000000-0000-4000-8000-00000000dead');
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });

    it('answers the same 404 for an id that is not a uuid', async () => {
      const response = await call('GET', '/opportunities/not-a-uuid');
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('PATCH /opportunities/:id', () => {
    it('edits the fields, bumps the version and is audited', async () => {
      const created = await create({ title: 'Before' });
      const response = await call('PATCH', `/opportunities/${created.id}`, {
        headers: { 'if-match': `"${created.version}"` },
        payload: { title: 'After', manualValue: '99.00', description: null, expectedCloseDate: '2027-01-15' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityDetailResponseSchema.parse(response.json());
      expect(data).toMatchObject({
        title: 'After',
        value: '99.00',
        description: null,
        expectedCloseDate: '2027-01-15',
        version: created.version + 1,
      });
      expect(response.headers['etag']).toBe(`"${data.version}"`);
      const entries = await h.auditLogService.query({ action: 'crm.opportunity.update', objectId: created.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.stateBefore).toMatchObject({ title: 'Before' });
      expect(entries[0]?.stateAfter).toMatchObject({ title: 'After' });
    });

    it('refuses a stale version — 409 VERSION_CONFLICT, nothing written', async () => {
      const created = await create({ title: 'Raced' });
      const first = await call('PATCH', `/opportunities/${created.id}`, {
        headers: { 'if-match': `"${created.version}"` },
        payload: { title: 'First writer' },
      });
      expect(first.statusCode, first.body).toBe(200);
      const second = await call('PATCH', `/opportunities/${created.id}`, {
        headers: { 'if-match': `"${created.version}"` },
        payload: { title: 'Second writer' },
      });
      expect(second.statusCode, second.body).toBe(409);
      expect(second.json().error.code).toBe('VERSION_CONFLICT');
      const read = await call('GET', `/opportunities/${created.id}`);
      expect(read.json().data.title).toBe('First writer');
    });

    it('refuses to change the Organization or the currency — both are immutable', async () => {
      const created = await create();
      for (const payload of [{ organizationId: otherOrganizationId }, { currency: 'EUR' }]) {
        const response = await call('PATCH', `/opportunities/${created.id}`, { payload });
        expect(response.statusCode, response.body).toBe(400);
      }
    });

    it('is gated crm:write', async () => {
      const created = await create();
      const response = await call('PATCH', `/opportunities/${created.id}`, {
        cookies: viewer.cookies,
        payload: { title: 'x' },
      });
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  describe('DELETE /opportunities/:id', () => {
    it('is gated crm:configure — a holder of crm:write is refused', async () => {
      const created = await create();
      const response = await call('DELETE', `/opportunities/${created.id}`, { cookies: writer.cookies });
      expect(response.statusCode, response.body).toBe(403);
      expect((await call('GET', `/opportunities/${created.id}`)).statusCode).toBe(200);
    });

    it('deletes the Opportunity — 204, then 404, and is audited', async () => {
      const created = await create({ title: 'Doomed' });
      const response = await call('DELETE', `/opportunities/${created.id}`);
      expect(response.statusCode, response.body).toBe(204);
      expect((await call('GET', `/opportunities/${created.id}`)).statusCode).toBe(404);
      const entries = await h.auditLogService.query({ action: 'crm.opportunity.delete', objectId: created.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.stateBefore).toMatchObject({ title: 'Doomed' });
    });
  });

  describe('GET /opportunities', () => {
    // One population for every filter case, created once, each title carrying
    // the marker so the cases ignore whatever the tests above left behind.
    const MARK = 'zq7list';
    let alpha: { id: string; number: string };
    let beta: { id: string };
    let gamma: { id: string };
    let lost: { id: string };

    beforeAll(async () => {
      alpha = await create({ title: `${MARK} alpha`, manualValue: '100.00', expectedCloseDate: '2026-11-01' });
      beta = await create({ title: `${MARK} beta`, manualValue: '300.00', salesChannelId, expectedCloseDate: '2026-11-03' });
      gamma = await create({
        title: `${MARK} gamma`,
        organizationId: otherOrganizationId,
        manualValue: '200.00',
        expectedCloseDate: '2026-11-02',
      });
      lost = await create({ title: `${MARK} delta` });
      expect((await transitionCrmOpportunity(h, beta.id, 'qualified')).statusCode).toBe(200);
      expect((await transitionCrmOpportunity(h, lost.id, 'lost')).statusCode).toBe(200);
    });

    const ids = (page: { data: Array<{ id: string }> }) => page.data.map((row) => row.id);

    it('lists summaries with the pagination envelope, newest first by default', async () => {
      const page = await list(`?q=${MARK}`);
      expect(ids(page)).toEqual([lost.id, gamma.id, beta.id, alpha.id]);
      expect(page.pagination).toEqual({ cursor: null, hasMore: false, limit: 50 });
      expect(page.data[3]).toMatchObject({
        id: alpha.id,
        number: alpha.number,
        organization: { id: TEST_ORGANIZATION_ID, name: 'Test Organization' },
        status: { code: 'new', kind: 'open' },
        value: '100.00',
        currency: 'PLN',
      });
    });

    it('q matches the title, the number and the Organization name', async () => {
      expect(ids(await list(`?q=${MARK}%20alpha`))).toEqual([alpha.id]);
      expect(ids(await list(`?q=${alpha.number}`))).toEqual([alpha.id]);
      const byOrganization = await list('?q=CRM%20Other');
      expect(ids(byOrganization)).toContain(gamma.id);
      expect(ids(byOrganization)).not.toContain(alpha.id);
    });

    it('statusCode filters by one or several statuses', async () => {
      expect(ids(await list(`?q=${MARK}&statusCode=qualified`))).toEqual([beta.id]);
      expect(ids(await list(`?q=${MARK}&statusCode=qualified&statusCode=lost`))).toEqual([lost.id, beta.id]);
    });

    it('state filters by what the status means', async () => {
      expect(ids(await list(`?q=${MARK}&state=open`))).toEqual([gamma.id, beta.id, alpha.id]);
      expect(ids(await list(`?q=${MARK}&state=lost`))).toEqual([lost.id]);
      expect(ids(await list(`?q=${MARK}&state=won`))).toEqual([]);
    });

    it('organizationId and salesChannelId filter', async () => {
      expect(ids(await list(`?q=${MARK}&organizationId=${otherOrganizationId}`))).toEqual([gamma.id]);
      expect(ids(await list(`?q=${MARK}&salesChannelId=${salesChannelId}`))).toEqual([beta.id]);
    });

    it('createdFrom and createdTo bound the creation date, inclusively', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      expect(ids(await list(`?q=${MARK}&createdFrom=${today}&createdTo=${today}`))).toHaveLength(4);
      expect(ids(await list(`?q=${MARK}&createdFrom=${tomorrow}`))).toEqual([]);
      expect(ids(await list(`?q=${MARK}&createdTo=${yesterday}`))).toEqual([]);
    });

    it('sorts by value, expected close date and number, in both directions', async () => {
      expect(ids(await list(`?q=${MARK}&state=open&sort=value&order=desc`))).toEqual([beta.id, gamma.id, alpha.id]);
      expect(ids(await list(`?q=${MARK}&state=open&sort=value&order=asc`))).toEqual([alpha.id, gamma.id, beta.id]);
      expect(ids(await list(`?q=${MARK}&state=open&sort=expectedCloseDate&order=asc`))).toEqual([
        alpha.id,
        gamma.id,
        beta.id,
      ]);
      expect(ids(await list(`?q=${MARK}&sort=number&order=asc`))).toEqual([alpha.id, beta.id, gamma.id, lost.id]);
    });

    it('pages with an opaque cursor until the population is exhausted', async () => {
      const first = await list(`?q=${MARK}&limit=3`);
      expect(ids(first)).toEqual([lost.id, gamma.id, beta.id]);
      expect(first.pagination).toMatchObject({ hasMore: true, limit: 3 });
      expect(first.pagination.cursor).toEqual(expect.any(String));
      const second = await list(`?q=${MARK}&limit=3&cursor=${encodeURIComponent(first.pagination.cursor!)}`);
      expect(ids(second)).toEqual([alpha.id]);
      expect(second.pagination).toMatchObject({ hasMore: false, cursor: null });
    });

    it('refuses a query the schema does not accept', async () => {
      for (const query of ['?state=closed', '?limit=500', '?sort=title', '?organizationId=nope']) {
        const response = await call('GET', `/opportunities${query}`);
        expect(response.statusCode, `${query} ${response.body}`).toBe(400);
      }
    });

    it('accepts the assignee filter in each of its three forms', async () => {
      for (const query of ['?assignedAdminUserId=me', '?assignedAdminUserId=unassigned', `?assignedAdminUserId=${TEST_ADMIN_ID}`]) {
        const response = await call('GET', `/opportunities${query}`);
        expect(response.statusCode, `${query} ${response.body}`).toBe(200);
      }
      const malformed = await call('GET', '/opportunities?assignedAdminUserId=somebody');
      expect(malformed.statusCode, malformed.body).toBe(400);
    });

    it('accepts the tag filter, repeated', async () => {
      const response = await call(
        'GET',
        '/opportunities?tagId=00000000-0000-4000-8000-00000000dead&tagId=00000000-0000-4000-8000-00000000beef',
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data).toEqual([]);
      const malformed = await call('GET', '/opportunities?tagId=nope');
      expect(malformed.statusCode, malformed.body).toBe(400);
    });

    it('is readable with crm:read alone', async () => {
      expect(ids(await list(`?q=${MARK}`, viewer.cookies))).toHaveLength(4);
    });
  });

  describe('a date the calendar does not have is a 400, not a 500 (review finding 7)', () => {
    it.each([
      ['the list filter', 'GET', '/opportunities?createdFrom=2026-13-45'],
      ['the board filter', 'GET', '/board?createdTo=2026-13-45'],
      ['the analytics range', 'GET', '/analytics/handling-time?from=2026-02-30&to=2026-03-01'],
    ] as const)('%s', async (_label, method, path) => {
      const response = await call(method, path);
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('expectedCloseDate on create and on PATCH', async () => {
      const created = await call('POST', '/opportunities', {
        payload: { title: 'Bad date', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', expectedCloseDate: '2026-02-31' },
      });
      expect(created.statusCode, created.body).toBe(400);
      expect(created.json().error.code).toBe('VALIDATION_FAILED');

      const opportunity = await create({ expectedCloseDate: '2024-02-29' });
      expect(opportunity.expectedCloseDate).toBe('2024-02-29');
      const patched = await call('PATCH', `/opportunities/${opportunity.id}`, {
        payload: { expectedCloseDate: '2025-02-29' },
      });
      expect(patched.statusCode, patched.body).toBe(400);
    });
  });
});
