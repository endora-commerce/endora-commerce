import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityDetailResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  defineCrmCustomField,
  removeCrmCustomFields,
  seedCrmOrganization,
  seedCrmSalesRep,
  restoreDefaultCrmWorkflow,
} from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Operator-defined fields on an Opportunity (User Story 15;
 * `specs/143-crm-sales-opportunities/contracts/admin-api.md` §12a), against the
 * real `custom_fields` module.
 *
 * The values are a column on the Opportunity's own row, validated by the
 * generic layer and written by the Opportunity's own Command — so one write is
 * one audit entry, and whoever cannot see the Opportunity cannot see them.
 */
describe('crm custom fields on an opportunity (User Story 15)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let rep: { cookies: { b2b_session: string }; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
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

  const post = (body: Record<string, unknown>) =>
    call('POST', '/opportunities', {
      payload: { title: 'Custom fields', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', ...body },
    });

  const issues = (response: { json(): unknown }) =>
    (response.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } }).error;

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await removeCrmCustomFields(h);
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Custom fields other');
    rep = await seedCrmSalesRep(h.em(), [otherOrganizationId], ['crm:read', 'crm:write', 'orders:read']);
    await defineCrmCustomField(h, {
      key: 'lead_source',
      valueType: 'select',
      required: true,
      options: ['referral', 'trade_fair'],
    });
    await defineCrmCustomField(h, { key: 'seats', valueType: 'number' });
  });

  afterAll(async () => {
    rep.undo();
    await removeCrmCustomFields(h);
    await teardownBackendServer(h);
  });

  it('refuses a create without the required field, naming it', async () => {
    const response = await post({});
    expect(response.statusCode, response.body).toBe(422);
    const error = issues(response);
    expect(error.code).toBe('CUSTOM_FIELD_VALUE_INVALID');
    expect(error.details.map((issue) => issue.path)).toEqual(['lead_source']);
  });

  it('refuses an unknown option and a wrong type, each at its own field', async () => {
    const response = await post({ customFieldValues: { lead_source: 'cold_call', seats: 'many' } });
    expect(response.statusCode, response.body).toBe(422);
    const error = issues(response);
    expect(error.code).toBe('CUSTOM_FIELD_VALUE_INVALID');
    expect(error.details.map((issue) => issue.path).sort()).toEqual(['lead_source', 'seats']);
  });

  it('writes nothing when it refuses', async () => {
    const response = await post({ title: 'Never written', customFieldValues: { lead_source: 'cold_call' } });
    expect(response.statusCode).toBe(422);
    const rows = (await h.em().getConnection().execute(
      `select count(*)::int as n from "crm_opportunities" where "title" = 'Never written'`,
    )) as Array<{ n: number }>;
    expect(rows[0]!.n).toBe(0);
  });

  it('persists valid values on create and on PATCH, and the detail returns them', async () => {
    const created = await post({ customFieldValues: { lead_source: 'referral', seats: 12 } });
    expect(created.statusCode, created.body).toBe(201);
    const { data } = OpportunityDetailResponseSchema.parse(created.json());
    expect(data.customFieldValues).toEqual({ lead_source: 'referral', seats: 12 });

    const patched = await call('PATCH', `/opportunities/${data.id}`, {
      headers: { 'if-match': `"${data.version}"` },
      payload: { customFieldValues: { lead_source: 'trade_fair' } },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    // A patch names the fields it changes; the others keep their values.
    expect(OpportunityDetailResponseSchema.parse(patched.json()).data.customFieldValues).toEqual({
      lead_source: 'trade_fair',
      seats: 12,
    });

    const read = await call('GET', `/opportunities/${data.id}`);
    expect(OpportunityDetailResponseSchema.parse(read.json()).data.customFieldValues).toEqual({
      lead_source: 'trade_fair',
      seats: 12,
    });
  });

  it('refuses a PATCH that breaks a definition, and keeps what was stored', async () => {
    const created = OpportunityDetailResponseSchema.parse(
      (await post({ customFieldValues: { lead_source: 'referral' } })).json(),
    ).data;
    const refused = await call('PATCH', `/opportunities/${created.id}`, {
      headers: { 'if-match': `"${created.version}"` },
      payload: { title: 'Renamed', customFieldValues: { lead_source: '' } },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(issues(refused).details.map((issue) => issue.path)).toEqual(['lead_source']);
    const read = OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${created.id}`)).json()).data;
    expect(read.title).toBe('Custom fields');
    expect(read.customFieldValues).toEqual({ lead_source: 'referral' });
    expect(read.version).toBe(created.version);
  });

  it('leaves the values untouched on a PATCH that does not name them', async () => {
    const created = OpportunityDetailResponseSchema.parse(
      (await post({ customFieldValues: { lead_source: 'referral', seats: 3 } })).json(),
    ).data;
    const patched = await call('PATCH', `/opportunities/${created.id}`, {
      headers: { 'if-match': `"${created.version}"` },
      payload: { title: 'Renamed only' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(OpportunityDetailResponseSchema.parse(patched.json()).data.customFieldValues).toEqual({
      lead_source: 'referral',
      seats: 3,
    });
  });

  it('audits the values in the Opportunity’s own Command — one entry per write, no second one', async () => {
    const created = OpportunityDetailResponseSchema.parse(
      (await post({ customFieldValues: { lead_source: 'referral' } })).json(),
    ).data;
    await call('PATCH', `/opportunities/${created.id}`, {
      headers: { 'if-match': `"${created.version}"` },
      payload: { customFieldValues: { seats: 7 } },
    });
    const creates = await h.auditLogService.query({ action: 'crm.opportunity.create', objectId: created.id });
    const updates = await h.auditLogService.query({ action: 'crm.opportunity.update', objectId: created.id });
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect((creates[0]!.stateAfter as { customFieldValues: unknown }).customFieldValues).toEqual({
      lead_source: 'referral',
    });
    expect((updates[0]!.stateBefore as { customFieldValues: unknown }).customFieldValues).toEqual({
      lead_source: 'referral',
    });
    expect((updates[0]!.stateAfter as { customFieldValues: unknown }).customFieldValues).toEqual({
      lead_source: 'referral',
      seats: 7,
    });
    // Nothing else was recorded against this Opportunity: the generic layer
    // validates and never writes or audits.
    const everything = await h.auditLogService.query({ objectId: created.id });
    expect(everything).toHaveLength(2);
  });

  it('hides the values with the Opportunity from somebody confined to another Organization', async () => {
    const created = OpportunityDetailResponseSchema.parse(
      (await post({ customFieldValues: { lead_source: 'referral', seats: 99 } })).json(),
    ).data;
    // Positive control: the same person reads an Opportunity of their own Organization, values included.
    const own = await call('POST', '/opportunities', {
      cookies: rep.cookies,
      payload: {
        title: 'Own',
        organizationId: otherOrganizationId,
        currency: 'PLN',
        customFieldValues: { lead_source: 'trade_fair' },
      },
    });
    expect(own.statusCode, own.body).toBe(201);
    const ownId = OpportunityDetailResponseSchema.parse(own.json()).data.id;
    const ownRead = await call('GET', `/opportunities/${ownId}`, { cookies: rep.cookies });
    expect(OpportunityDetailResponseSchema.parse(ownRead.json()).data.customFieldValues).toEqual({
      lead_source: 'trade_fair',
    });

    const foreign = await call('GET', `/opportunities/${created.id}`, { cookies: rep.cookies });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.body).not.toContain('seats');
    const write = await call('PATCH', `/opportunities/${created.id}`, {
      cookies: rep.cookies,
      payload: { customFieldValues: { seats: 1 } },
    });
    expect(write.statusCode, write.body).toBe(404);
    const after = OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${created.id}`)).json()).data;
    expect(after.customFieldValues).toEqual({ lead_source: 'referral', seats: 99 });
  });

  it('drops a value whose definition has been removed from what the detail shows', async () => {
    const extra = await defineCrmCustomField(h, { key: 'competitor', valueType: 'text' });
    const created = OpportunityDetailResponseSchema.parse(
      (await post({ customFieldValues: { lead_source: 'referral', competitor: 'Acme' } })).json(),
    ).data;
    expect(created.customFieldValues).toMatchObject({ competitor: 'Acme' });
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${extra.id}`,
      cookies: CRM_ADMIN,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    const read = OpportunityDetailResponseSchema.parse((await call('GET', `/opportunities/${created.id}`)).json()).data;
    expect(read.customFieldValues).toEqual({ lead_source: 'referral' });
  });
});
