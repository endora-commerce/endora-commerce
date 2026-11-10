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
  defineCrmCustomField,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

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
    // Two entries are the whole of it: nothing earlier is out of reach.
    expect(body.truncated).toBe(false);
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
    expect(Object.keys(transition ?? {}).sort()).toEqual([
      'actedAt',
      'action',
      'actor',
      'after',
      'before',
      'id',
      'references',
    ]);
    // Neither entry carries a text with a token in it.
    expect(transition?.references).toEqual([]);
    expect(creation?.references).toEqual([]);
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

/**
 * Owner ruling P2 = a (`specs/162-custom-fields-value-carry/`, review fixes
 * 2026-10-21): the history serves an Opportunity's custom-field values only to
 * a caller who may read custom fields. `crm:read`'s `requires` is advisory
 * (D-175), so a role holding `crm:read` alone exists, and for it every entry's
 * `before` and `after` come without `customFieldValues` — the rest of the
 * entry as it was audited.
 */
describe('crm opportunity history — custom-field values need custom_fields:read (contract)', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  let definitionId: string;
  const key = `cfc_${randomUUID().slice(0, 8)}_history`;

  const history = (id: string, cookies: Record<string, string>) =>
    h.app.inject({ method: 'GET', url: `${CRM_API}/opportunities/${id}/history`, cookies });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    reader = await seedCrmAdmin(h.em(), 'history-reader', ['crm:read', 'orders:read']);
    definitionId = (await defineCrmCustomField(h, { key, valueType: 'text' })).id;
  });

  afterAll(async () => {
    reader.undo();
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/custom-fields/definitions/${definitionId}`, cookies: CRM_ADMIN });
    await teardownBackendServer(h);
  });

  const seedHistory = async () => {
    const opportunity = await createCrmOpportunity(h, { title: 'Valued', customFieldValues: { [key]: 'first secret' } });
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `${CRM_API}/opportunities/${opportunity.id}`,
      cookies: CRM_ADMIN,
      payload: { title: 'Valued again', customFieldValues: { [key]: 'second secret' } },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    return opportunity.id;
  };

  it('serves the values to an administrator who may read custom fields', async () => {
    const id = await seedHistory();
    const response = await history(id, CRM_ADMIN);
    expect(response.statusCode, response.body).toBe(200);
    const [edit, creation] = OpportunityHistoryResponseSchema.parse(response.json()).data;
    expect(edit).toMatchObject({
      before: { customFieldValues: { [key]: 'first secret' } },
      after: { title: 'Valued again', customFieldValues: { [key]: 'second secret' } },
    });
    expect(creation).toMatchObject({ after: { customFieldValues: { [key]: 'first secret' } } });
  });

  it('strips them from every entry for a crm:read caller without custom_fields:read, and keeps the rest', async () => {
    const id = await seedHistory();
    const response = await history(id, reader.cookies);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain('secret');
    const entries = OpportunityHistoryResponseSchema.parse(response.json()).data;
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      for (const state of [entry.before, entry.after]) {
        if (state !== null) expect(Object.hasOwn(state as object, 'customFieldValues')).toBe(false);
      }
    }
    expect(entries[0]).toMatchObject({ before: { title: 'Valued' }, after: { title: 'Valued again' } });
  });
  /**
   * Issue #470 (D-288) — the platform-wide audit screen,
   * `GET /api/v1/admin/audit-log`, is read under `audit_log:read` without
   * Organization reach. A row the Opportunity's update writes names what
   * changed and carries none of the values.
   */
  it('leaves the global audit log names only — no value of the Opportunity in its rows', async () => {
    const opportunity = await createCrmOpportunity(h, {
      title: 'S470-TITLE',
      description: 'S470-DESC',
      manualValue: '470470.47',
      customFieldValues: { [key]: 'S470-CF' },
    });
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `${CRM_API}/opportunities/${opportunity.id}`,
      cookies: CRM_ADMIN,
      payload: {
        title: 'S470-TITLE-NEW',
        description: 'S470-DESC-NEW',
        manualValue: '470471.47',
        customFieldValues: { [key]: 'S470-CF-NEW' },
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${opportunity.id}`,
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = (response.json() as {
      data: Array<{ action: string; stateBefore: Record<string, unknown> | null; stateAfter: Record<string, unknown> | null }>;
    }).data;
    expect(rows.map((row) => row.action).sort()).toEqual(['crm.opportunity.create', 'crm.opportunity.update']);
    const states = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    for (const sentinel of ['S470', '470470.47', '470471.47', TEST_ORGANIZATION_ID]) {
      expect(states, sentinel).not.toContain(sentinel);
    }
    const update = rows.find((row) => row.action === 'crm.opportunity.update');
    expect(update?.stateAfter).toMatchObject({
      changedFields: ['description', 'manualValue', 'title'],
      changedCustomFields: [key],
      valueChangeId: expect.any(String),
    });
  });
});
