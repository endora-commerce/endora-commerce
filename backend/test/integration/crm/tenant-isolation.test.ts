import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityLinkResponseSchema,
  OpportunityListResponseSchema,
  OpportunityTransitionResponseSchema,
  OpportunityWorkflowResponseSchema,
} from '@endora-commerce/contracts';
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
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  setCrmForwardMappings,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { CrmOpportunity, CrmOpportunityLink, Order } from '../../helpers/package-entities.js';

/**
 * Tenant isolation of Opportunities and everything hanging on them
 * (Constitution XI; `specs/143-crm-sales-opportunities/research.md` R-12).
 *
 * A Sales Representative assigned to Organization A works A's Opportunities
 * and cannot tell B's from ones that do not exist: every route answers 404
 * `CRM_OPPORTUNITY_NOT_FOUND`, the list never carries them, and a child of B's
 * Opportunity addressed under A's id is as absent as B's Opportunity itself.
 * Each refusal is paired with what the platform administrator still sees, so
 * "404" is shown to be a refusal and not a broken route.
 */
describe('crm tenant isolation (Constitution XI)', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let opportunityA: { id: string; version: number };
  let opportunityB: { id: string; version: number };
  let orderA: { id: string };
  let orderB: { id: string };
  let linkB: { id: string };
  let refusalB: { id: string };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookies: Record<string, string>,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const expectNotFound = (response: { statusCode: number; body: string; json(): unknown }, what: string) => {
    expect(response.statusCode, `${what}: ${response.body}`).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code, what).toBe('CRM_OPPORTUNITY_NOT_FOUND');
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Tenant A');
    organizationB = await seedCrmOrganization(h.em(), 'Tenant B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write', 'orders:read']);

    // `lost` asks an Order for `completed`, which an Order in `new` refuses —
    // that leaves B's Opportunity with an unresolved outcome to address.
    expect((await setCrmForwardMappings(h, { lost: 'completed' })).statusCode).toBe(200);

    opportunityA = await createCrmOpportunity(h, { title: 'A deal', organizationId: organizationA });
    opportunityB = await createCrmOpportunity(h, { title: 'B deal', organizationId: organizationB });
    orderA = await seedCrmOrder(h.em(), { organizationId: organizationA });
    orderB = await seedCrmOrder(h.em(), { organizationId: organizationB });
    linkB = OpportunityLinkResponseSchema.parse((await linkCrmOrder(h, opportunityB.id, orderB.id)).json()).data;
    const moved = await transitionCrmOpportunity(h, opportunityB.id, 'lost');
    expect(moved.statusCode, moved.body).toBe(200);
    const outcome = OpportunityTransitionResponseSchema.parse(moved.json()).data.propagation[0];
    expect(outcome?.outcome).toBe('not_permitted');
    refusalB = { id: outcome!.id };
    opportunityB.version += 1;
  });

  afterAll(async () => {
    rep.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('the positive control — the representative reads and works the Opportunity of their own Organization', async () => {
    const read = await call('GET', `/opportunities/${opportunityA.id}`, rep.cookies);
    expect(read.statusCode, read.body).toBe(200);
    expect(OpportunityDetailResponseSchema.parse(read.json()).data.organization.id).toBe(organizationA);

    const patched = await call('PATCH', `/opportunities/${opportunityA.id}`, rep.cookies, { title: 'A deal, edited' });
    expect(patched.statusCode, patched.body).toBe(200);
  });

  it('get, patch, transition and link on another Organization’s Opportunity all answer 404', async () => {
    expectNotFound(await call('GET', `/opportunities/${opportunityB.id}`, rep.cookies), 'get');
    expectNotFound(
      await call('PATCH', `/opportunities/${opportunityB.id}`, rep.cookies, { title: 'Taken over' }),
      'patch',
    );
    expectNotFound(await transitionCrmOpportunity(h, opportunityB.id, 'new', rep.cookies), 'transition');
    expectNotFound(await linkCrmOrder(h, opportunityB.id, orderA.id, { cookies: rep.cookies }), 'link');

    // Nothing moved: the platform administrator reads B's Opportunity as it was.
    const asAdmin = OpportunityDetailResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunityB.id}`, CRM_ADMIN)).json(),
    ).data;
    expect(asAdmin).toMatchObject({ title: 'B deal', status: { code: 'lost' }, version: opportunityB.version });
    expect(asAdmin.links.map((link) => link.documentId)).toEqual([orderB.id]);
  });

  it('answers the same 404 as for an Opportunity that does not exist', async () => {
    const missing = await call('GET', '/opportunities/00000000-0000-4000-8000-00000000dead', rep.cookies);
    const foreign = await call('GET', `/opportunities/${opportunityB.id}`, rep.cookies);
    const shape = (response: { statusCode: number; json(): unknown }) => {
      const { error } = response.json() as { error: { code: string; message: string } };
      return { status: response.statusCode, code: error.code, message: error.message };
    };
    expect(shape(foreign)).toEqual(shape(missing));
  });

  it('never lists another Organization’s Opportunity, by any filter', async () => {
    for (const query of ['', '?q=deal', `?organizationId=${organizationB}`, '?state=lost', '?statusCode=lost']) {
      const response = await call('GET', `/opportunities${query}`, rep.cookies);
      expect(response.statusCode, `${query} ${response.body}`).toBe(200);
      const ids = OpportunityListResponseSchema.parse(response.json()).data.map((row) => row.id);
      expect(ids, query).not.toContain(opportunityB.id);
    }
    const own = OpportunityListResponseSchema.parse((await call('GET', '/opportunities', rep.cookies)).json());
    expect(own.data.map((row) => row.id)).toEqual([opportunityA.id]);

    const all = OpportunityListResponseSchema.parse((await call('GET', '/opportunities', CRM_ADMIN)).json());
    expect(all.data.map((row) => row.id)).toEqual(expect.arrayContaining([opportunityA.id, opportunityB.id]));
  });

  it('counts only the Opportunities the reader reaches in the workflow’s in-use figures', async () => {
    const count = async (cookies: Record<string, string>) =>
      OpportunityWorkflowResponseSchema.parse((await call('GET', '/workflow', cookies)).json()).data.statuses.find(
        (status) => status.code === 'lost',
      )?.inUseCount;
    expect(await count(rep.cookies)).toBe(0);
    expect(await count(CRM_ADMIN)).toBe(1);
  });

  it('refuses to link another Organization’s Order to an Opportunity the representative works', async () => {
    const response = await linkCrmOrder(h, opportunityA.id, orderB.id, { cookies: rep.cookies });
    // The Order is outside the caller's scope, so it does not exist for them.
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe('CRM_DOCUMENT_NOT_FOUND');

    // A reader who does see the Order is told why it cannot be linked instead.
    const asAdmin = await linkCrmOrder(h, opportunityA.id, (await seedCrmOrder(h.em(), { organizationId: organizationB })).id);
    expect(asAdmin.statusCode, asAdmin.body).toBe(422);
    expect(asAdmin.json().error.code).toBe('CRM_LINK_ORGANIZATION_MISMATCH');

    const links = await h.em().find(CrmOpportunityLink, { opportunityId: opportunityA.id }, { filters: false });
    expect(links).toEqual([]);
  });

  it('a link of another Organization’s Opportunity addressed under the representative’s own id is 404', async () => {
    const patched = await call('PATCH', `/opportunities/${opportunityA.id}/links/${linkB.id}`, rep.cookies, {
      syncStatus: false,
    });
    expect(patched.statusCode, patched.body).toBe(404);
    const removed = await call('DELETE', `/opportunities/${opportunityA.id}/links/${linkB.id}`, rep.cookies);
    expect(removed.statusCode, removed.body).toBe(404);
    // …and under its real parent it is the Opportunity that is absent.
    expectNotFound(
      await call('DELETE', `/opportunities/${opportunityB.id}/links/${linkB.id}`, rep.cookies),
      'delete link under B',
    );

    const link = await h.em().findOne(CrmOpportunityLink, { id: linkB.id }, { filters: false });
    expect(link).toMatchObject({ opportunityId: opportunityB.id, syncStatus: true });
  });

  it('a propagation outcome of another Organization’s Opportunity addressed under the representative’s own id is 404', async () => {
    for (const action of ['retry', 'dismiss']) {
      const misplaced = await call(
        'POST',
        `/opportunities/${opportunityA.id}/propagations/${refusalB.id}/${action}`,
        rep.cookies,
      );
      expect(misplaced.statusCode, `${action} ${misplaced.body}`).toBe(404);
      expectNotFound(
        await call('POST', `/opportunities/${opportunityB.id}/propagations/${refusalB.id}/${action}`, rep.cookies),
        `${action} under B`,
      );
    }
    const asAdmin = OpportunityDetailResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunityB.id}`, CRM_ADMIN)).json(),
    ).data;
    expect(asAdmin.unresolvedPropagations.map((row) => row.id)).toEqual([refusalB.id]);
    expect((await h.em().findOneOrFail(Order, { id: orderB.id }, { filters: false })).status).toBe('new');
  });

  it('refuses to create an Opportunity for an Organization outside the representative’s scope', async () => {
    const response = await call('POST', '/opportunities', rep.cookies, {
      title: 'Planted',
      organizationId: organizationB,
      currency: 'PLN',
    });
    // Indistinguishable from an Organization that does not exist.
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    const planted = await h.em().count(CrmOpportunity, { title: 'Planted' }, { filters: false });
    expect(planted).toBe(0);
  });
});
