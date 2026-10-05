import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityListResponseSchema,
  OpportunityTagListResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CrmOpportunityTag } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  clearCrmTags,
  createCrmOpportunity,
  createCrmTag,
  restoreDefaultCrmWorkflow,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * Tags on Opportunities (User Story 6).
 *
 * The tag list is platform configuration, shared by everybody; **what a tag is
 * on is not**. A tagging hangs on an Opportunity and is addressed under it, so
 * an Opportunity out of the caller's reach cannot be tagged, and a tag's usage
 * count is the count of Opportunities the caller may see.
 */
describe('crm tags', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const tags = async (cookies?: Record<string, string>) =>
    OpportunityTagListResponseSchema.parse((await call('GET', '/tags', undefined, cookies)).json()).data;

  const tagNamesOf = async (opportunityId: string) =>
    OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${opportunityId}`)).json()).data.tags.map(
      (tag) => tag.name,
    );

  const listIds = async (query: string, cookies?: Record<string, string>) => {
    const response = await call('GET', `/opportunities${query}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityListResponseSchema.parse(response.json()).data.map((row) => row.id);
  };

  const setTags = (opportunityId: string, tagIds: string[], cookies?: Record<string, string>) =>
    call('PUT', `/opportunities/${opportunityId}/tags`, { tagIds }, cookies);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await clearCrmTags(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Tags A');
    organizationB = await seedCrmOrganization(h.em(), 'Tags B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write', 'orders:read']);
  });

  afterAll(async () => {
    rep.undo();
    await clearCrmTags(h.em());
    await teardownBackendServer(h);
  });

  it('creates, renames and recolours a tag, each audited against the tag', async () => {
    const tag = await createCrmTag(h, 'Hot lead', '#f59e0b');
    const patched = await call('PATCH', `/tags/${tag.id}`, { name: 'Hot', color: '#ef4444' });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((await tags()).find((row) => row.id === tag.id)).toMatchObject({ name: 'Hot', color: '#ef4444' });

    const created = await h.auditLogService.query({ action: 'crm.tag.create', objectId: tag.id });
    const updated = await h.auditLogService.query({ action: 'crm.tag.update', objectId: tag.id });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ objectType: 'crm_tag', stateAfter: { name: 'Hot lead', color: '#f59e0b' } });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      stateBefore: { name: 'Hot lead', color: '#f59e0b' },
      stateAfter: { name: 'Hot', color: '#ef4444' },
    });
  });

  it('refuses a case-insensitively duplicate name on create and on rename — 409 CRM_TAG_NAME_TAKEN', async () => {
    await createCrmTag(h, 'Distributor');
    const other = await createCrmTag(h, 'Reseller');
    for (const response of [
      await call('POST', '/tags', { name: 'distributor' }),
      await call('POST', '/tags', { name: ' DISTRIBUTOR ' }),
      await call('PATCH', `/tags/${other.id}`, { name: 'DiStRiBuToR' }),
    ]) {
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_TAG_NAME_TAKEN');
    }
    expect((await tags()).filter((row) => row.name.toLowerCase() === 'distributor')).toHaveLength(1);
  });

  it('replaces an Opportunity\'s tag set, and audits it on the Opportunity with the names', async () => {
    const first = await createCrmTag(h, 'Set first');
    const second = await createCrmTag(h, 'Set second');
    const third = await createCrmTag(h, 'Set third');
    const opportunity = await createCrmOpportunity(h, { organizationId: organizationA });

    expect((await setTags(opportunity.id, [first.id, second.id])).statusCode).toBe(200);
    expect(await tagNamesOf(opportunity.id)).toEqual(['Set first', 'Set second']);
    // Replaces — it does not add. A repeated id is one tagging.
    expect((await setTags(opportunity.id, [third.id, second.id, third.id])).statusCode).toBe(200);
    expect(await tagNamesOf(opportunity.id)).toEqual(['Set second', 'Set third']);

    const audit = await h.auditLogService.query({ action: 'crm.opportunity.tag_set', objectId: opportunity.id });
    expect(audit).toHaveLength(2);
    const latest = audit.find((entry) => (entry.stateAfter as { tags: string[] }).tags.includes('Set third'));
    expect(latest).toMatchObject({
      objectType: 'crm_opportunity',
      stateBefore: { tags: ['Set first', 'Set second'] },
      stateAfter: { tags: ['Set second', 'Set third'] },
    });

    // Setting the set it already has writes nothing.
    const before = OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${opportunity.id}`)).json()).data.version;
    expect((await setTags(opportunity.id, [second.id, third.id])).statusCode).toBe(200);
    expect(
      OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${opportunity.id}`)).json()).data.version,
    ).toBe(before);
    expect(await h.auditLogService.query({ action: 'crm.opportunity.tag_set', objectId: opportunity.id })).toHaveLength(2);
  });

  it('takes tags on create and on edit, and lists them on the summary', async () => {
    const first = await createCrmTag(h, 'Edit first');
    const second = await createCrmTag(h, 'Edit second');
    const opportunity = await createCrmOpportunity(h, { organizationId: organizationA, tagIds: [first.id] });
    expect(await tagNamesOf(opportunity.id)).toEqual(['Edit first']);

    const patched = await call('PATCH', `/opportunities/${opportunity.id}`, { tagIds: [second.id] });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(await tagNamesOf(opportunity.id)).toEqual(['Edit second']);
    // An edit that does not mention tags leaves them alone.
    expect((await call('PATCH', `/opportunities/${opportunity.id}`, { title: 'Renamed' })).statusCode).toBe(200);
    expect(await tagNamesOf(opportunity.id)).toEqual(['Edit second']);

    const list = OpportunityListResponseSchema.parse(
      (await call('GET', `/opportunities?organizationId=${organizationA}`)).json(),
    ).data;
    expect(list.find((row) => row.id === opportunity.id)?.tags).toEqual([
      { id: second.id, name: 'Edit second', color: second.color },
    ]);

    const unknown = await call('POST', '/opportunities', {
      title: 'x',
      organizationId: organizationA,
      currency: 'PLN',
      tagIds: ['00000000-0000-4000-8000-00000000dead'],
    });
    expect(unknown.statusCode, unknown.body).toBe(422);
  });

  it('filters the list by tags with AND: two tagId values answer only Opportunities carrying both', async () => {
    const red = await createCrmTag(h, 'Filter red');
    const blue = await createCrmTag(h, 'Filter blue');
    const organizationId = await seedCrmOrganization(h.em(), 'Tag filter');
    const both = await createCrmOpportunity(h, { organizationId, tagIds: [red.id, blue.id] });
    const onlyRed = await createCrmOpportunity(h, { organizationId, tagIds: [red.id] });
    const onlyBlue = await createCrmOpportunity(h, { organizationId, tagIds: [blue.id] });
    await createCrmOpportunity(h, { organizationId });
    const scope = `organizationId=${organizationId}`;

    expect(await listIds(`?${scope}&tagId=${red.id}&tagId=${blue.id}`)).toEqual([both.id]);
    expect((await listIds(`?${scope}&tagId=${red.id}`)).sort()).toEqual([both.id, onlyRed.id].sort());
    expect((await listIds(`?${scope}&tagId=${blue.id}`)).sort()).toEqual([both.id, onlyBlue.id].sort());
    expect(await listIds(`?${scope}&tagId=00000000-0000-4000-8000-00000000dead`)).toEqual([]);
  });

  it('removes a deleted tag from the Opportunities that carried it, and nothing else', async () => {
    const doomed = await createCrmTag(h, 'Doomed');
    const survivor = await createCrmTag(h, 'Survivor');
    const opportunity = await createCrmOpportunity(h, {
      organizationId: organizationA,
      tagIds: [doomed.id, survivor.id],
    });

    const response = await call('DELETE', `/tags/${doomed.id}`);
    expect(response.statusCode, response.body).toBe(204);

    expect(await tagNamesOf(opportunity.id)).toEqual(['Survivor']);
    expect(await h.em().count(CrmOpportunityTag, { tagId: doomed.id }, { filters: false })).toBe(0);
    expect((await tags()).map((row) => row.id)).not.toContain(doomed.id);
    const audit = await h.auditLogService.query({ action: 'crm.tag.delete', objectId: doomed.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ objectType: 'crm_tag', stateBefore: { name: 'Doomed', usageCount: 1 } });
  });

  describe('tenant isolation', () => {
    it('counts a tag\'s usage only over Opportunities the caller may see', async () => {
      const shared = await createCrmTag(h, 'Shared across tenants');
      await createCrmOpportunity(h, { organizationId: organizationA, tagIds: [shared.id] });
      await createCrmOpportunity(h, { organizationId: organizationB, tagIds: [shared.id] });
      await createCrmOpportunity(h, { organizationId: organizationB, tagIds: [shared.id] });

      const usage = async (cookies?: Record<string, string>) =>
        (await tags(cookies)).find((row) => row.id === shared.id)?.usageCount;
      expect(await usage()).toBe(3);
      // The Sales Rep reaches Organization A only — and still sees the tag itself.
      expect(await usage(rep.cookies)).toBe(1);
    });

    it('answers 404 for tagging an Opportunity of an Organization out of reach, and tags nothing', async () => {
      const tag = await createCrmTag(h, 'Out of reach');
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });

      const response = await setTags(foreign.id, [tag.id], rep.cookies);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect(await h.em().count(CrmOpportunityTag, { opportunityId: foreign.id }, { filters: false })).toBe(0);
    });

    it('does not let the tag filter reach across tenants', async () => {
      const tag = await createCrmTag(h, 'Filter across tenants');
      const own = await createCrmOpportunity(h, { organizationId: organizationA, tagIds: [tag.id] });
      await createCrmOpportunity(h, { organizationId: organizationB, tagIds: [tag.id] });
      expect(await listIds(`?tagId=${tag.id}`, rep.cookies)).toEqual([own.id]);
    });
  });
});
