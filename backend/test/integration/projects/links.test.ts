import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectLinkListResponseSchema,
  ProjectLinkResponseSchema,
  type ProjectDetail,
  type ProjectLink,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';
import { PROJECTS_ADMIN, callProjects, createProject, deleteProjects, getProject } from './helpers.js';

/**
 * User Story 6 — Orders, Quote Requests and Opportunities linked to a Project
 * (`specs/163-projects-and-tasks/spec.md` FR-021 – FR-024, research R-10, R-21).
 *
 * A link holds the record by value and the record's owner is the integrity
 * check: the record is read through its owner's port, under the caller's
 * reach, and must belong to one of the Project's Organizations. One record
 * belongs to at most one Project — the unique key is the authority, the read
 * before the write only names the holder, and only to a caller who may see it.
 *
 * What a link shows of its record is the owner's to show: number, status and
 * amount only to a reader holding that owner's read code, and nothing while
 * the owner is switched off or the record is gone. Every link and unlink is a
 * Command with its audit row.
 */
describe('projects — linked records (US6)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let bare: Person;
  let outsider: Person;
  let orgB: string;
  let orgOther: string;
  /** Organizations TEST + B; the stub administrator links everything here. */
  let project: ProjectDetail;
  /** Organization TEST only, a second place to try to link to. */
  let second: ProjectDetail;
  /** Visible to Members only — nobody of this file but the stub administrator sees it. */
  let hidden: ProjectDetail;
  let order: { id: string; businessId: string | null };
  let quoteRequest: { id: string; businessId: string };
  let opportunity: { id: string; number: string };
  const created: string[] = [];

  const READ_ALL = ['projects:read', 'projects:write', 'orders:read', 'rfqs:handle', 'crm:read'];

  async function links(id: string, cookies?: Person['cookies']): Promise<ProjectLink[]> {
    const response = await callProjects(h, 'GET', `/${id}/links`, cookies ? { cookies } : {});
    expect(response.statusCode, response.body).toBe(200);
    return ProjectLinkListResponseSchema.parse(response.json()).data;
  }

  function link(id: string, kind: string, recordId: string, cookies?: Person['cookies']) {
    return callProjects(h, 'POST', `/${id}/links`, { payload: { kind, recordId }, ...(cookies ? { cookies } : {}) });
  }

  async function linkOk(id: string, kind: string, recordId: string): Promise<ProjectLink> {
    const response = await link(id, kind, recordId);
    expect(response.statusCode, response.body).toBe(201);
    return ProjectLinkResponseSchema.parse(response.json()).data;
  }

  const audit = async (objectId: string) =>
    (await h.auditLogService.query({ objectType: 'project', objectId })).map((row) => row.action);

  beforeAll(async () => {
    h = await setupBackendServer();
    orgB = await seedCrmOrganization(h.em(), 'projects links B');
    orgOther = await seedCrmOrganization(h.em(), 'projects links other');
    bare = await seedCrmAdmin(h.em(), 'links-bare', ['projects:read', 'projects:write']);
    outsider = await seedCrmAdmin(h.em(), 'links-outsider', READ_ALL);
    project = await createProject(h, { title: 'Linked records', organizationIds: [TEST_ORGANIZATION_ID, orgB], visibility: 'everyone' });
    second = await createProject(h, { title: 'Linked records, second', organizationIds: [TEST_ORGANIZATION_ID], visibility: 'everyone' });
    hidden = await createProject(h, { title: 'Linked records, hidden', organizationIds: [TEST_ORGANIZATION_ID], visibility: 'members_and_listed' });
    created.push(project.id, second.id, hidden.id);
    order = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID, total: '321.00', currency: 'PLN' });
    quoteRequest = await submitCrmQuoteRequest(h, { quantity: 3, desiredUnitPrice: 12.5 });
    opportunity = await createCrmOpportunity(h, { title: 'Linked opportunity', valueMode: 'manual', manualValue: '900.00' });
  });

  afterAll(async () => {
    for (const p of [bare, outsider]) p?.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('links an Order, a Quote Request and an Opportunity of the Project’s Organizations, each shown with number, status and amount', async () => {
    const orderLink = await linkOk(project.id, 'order', order.id);
    expect(orderLink).toMatchObject({
      kind: 'order',
      recordId: order.id,
      available: true,
      number: order.businessId,
      amount: '321.00',
      currency: 'PLN',
      href: `/orders/${order.id}`,
    });
    expect(orderLink.status).toEqual(expect.any(String));
    const quoteLink = await linkOk(project.id, 'quote_request', quoteRequest.id);
    expect(quoteLink).toMatchObject({
      kind: 'quote_request',
      available: true,
      number: quoteRequest.businessId,
      amount: '37.50',
      currency: expect.any(String),
      href: `/quote-requests/${quoteRequest.id}`,
    });
    const opportunityLink = await linkOk(project.id, 'opportunity', opportunity.id);
    expect(opportunityLink).toMatchObject({
      kind: 'opportunity',
      available: true,
      number: opportunity.number,
      amount: '900.00',
      currency: 'PLN',
      href: `/crm/opportunities/${opportunity.id}`,
    });

    const listed = await links(project.id);
    expect(listed.map((l) => l.kind)).toEqual(['order', 'quote_request', 'opportunity']);
    expect(listed.every((l) => l.linkedBy !== null)).toBe(true);
    expect((await getProject(h, project.id)).linkCount).toBe(3);
    expect((await audit(project.id)).filter((a) => a === 'projects.project.link_add')).toHaveLength(3);
  });

  it('names each record’s status as its owner does, in the reader’s language (issue #455)', async () => {
    // An administrator's language is the stored preference, not a header.
    const setLanguage = async (preferredLanguage: 'en' | 'pl' | null) => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: PROJECTS_ADMIN,
        payload: { preferredLanguage },
      });
      expect(res.statusCode, res.body).toBe(200);
    };
    const named = async (language: 'en' | 'pl') => {
      await setLanguage(language);
      const response = await callProjects(h, 'GET', `/${project.id}/links`);
      expect(response.statusCode, response.body).toBe(200);
      const byKind = new Map(ProjectLinkListResponseSchema.parse(response.json()).data.map((l) => [l.kind, l]));
      return Object.fromEntries(
        (['order', 'quote_request', 'opportunity'] as const).map((kind) => [
          kind,
          [byKind.get(kind)?.status, byKind.get(kind)?.statusName],
        ]),
      );
    };
    try {
      expect(await named('pl')).toEqual({
        order: ['new', 'Nowy'],
        quote_request: ['Pending', 'Oczekujące'],
        opportunity: ['new', 'Nowa'],
      });
      expect(await named('en')).toEqual({
        order: ['new', 'New'],
        quote_request: ['Pending', 'Pending'],
        opportunity: ['new', 'New'],
      });
    } finally {
      await setLanguage(null);
    }
  });

  it('refuses a record of another Organization — 422, and nothing is linked', async () => {
    const foreign = await seedCrmOrder(h.em(), { organizationId: orgOther });
    const response = await link(project.id, 'order', foreign.id);
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.code).toBe('PROJECT_LINK_ORGANIZATION_MISMATCH');
    expect((await links(project.id)).map((l) => l.recordId)).not.toContain(foreign.id);
  });

  it('refuses a record that does not exist — 404 PROJECT_RECORD_NOT_FOUND', async () => {
    for (const kind of ['order', 'quote_request', 'opportunity']) {
      const response = await link(project.id, kind, randomUUID());
      expect(response.statusCode, `${kind}: ${response.body}`).toBe(404);
      expect(response.json().error.code).toBe('PROJECT_RECORD_NOT_FOUND');
    }
  });

  it('a record already in another Project: 409 naming that Project to somebody who sees it, and nothing changes', async () => {
    const response = await link(second.id, 'order', order.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'PROJECT_RECORD_ALREADY_LINKED',
      details: { project: { id: project.id, number: project.number, title: project.title } },
    });
    expect(await links(second.id)).toEqual([]);
  });

  it('…and without naming it to somebody who may not see the Project holding it', async () => {
    const held = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    await linkOk(hidden.id, 'order', held.id);
    const response = await link(second.id, 'order', held.id, outsider.cookies);
    expect(response.statusCode, response.body).toBe(409);
    const error = response.json().error as Record<string, unknown>;
    expect(error.code).toBe('PROJECT_RECORD_ALREADY_LINKED');
    expect(JSON.stringify(error)).not.toContain(hidden.id);
    expect(JSON.stringify(error)).not.toContain(hidden.number);
  });

  it('two Projects linking one record at once: one wins, the other is told 409', async () => {
    const contested = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    const answers = await Promise.all([link(project.id, 'order', contested.id), link(second.id, 'order', contested.id)]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = answers.find((r) => r.statusCode === 409)!;
    expect(loser.json().error.code).toBe('PROJECT_RECORD_ALREADY_LINKED');
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select count(*)::int as "n" from "project_links" where "record_id" = ?`, [contested.id])) as Array<{ n: number }>;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('linking a kind needs its owner’s read code — 403 to a projects:write holder without it', async () => {
    const fresh = await seedCrmOrder(h.em(), { organizationId: TEST_ORGANIZATION_ID });
    const before = await links(second.id);
    for (const [kind, id] of [
      ['order', fresh.id],
      ['quote_request', quoteRequest.id],
      ['opportunity', opportunity.id],
    ] as const) {
      const response = await link(second.id, kind, id, bare.cookies);
      expect(response.statusCode, `${kind}: ${response.body}`).toBe(403);
    }
    // `second` may hold the record the race above was won with; nothing more.
    expect(await links(second.id)).toEqual(before);
  });

  it('a reader without an owner’s read code sees its records as unavailable — no number, status or amount', async () => {
    const seen = await links(project.id, bare.cookies);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const row of seen) {
      expect(row.available, row.kind).toBe(false);
      for (const field of ['number', 'status', 'statusName', 'amount', 'currency', 'href'] as const) {
        expect(row[field], `${row.kind}.${field}`).toBeUndefined();
      }
    }
  });

  it('with CRM off its links are kept and shown unavailable, cannot be added (503), and return when it is back', async () => {
    const otherOpportunity = await createCrmOpportunity(h, { title: 'Linked while off' });
    await withModulesDeactivated(['crm'], async () => {
      const shown = (await links(project.id)).find((l) => l.kind === 'opportunity')!;
      expect(shown).toMatchObject({ recordId: opportunity.id, available: false });
      expect(shown.number).toBeUndefined();
      const refused = await link(project.id, 'opportunity', otherOpportunity.id);
      expect(refused.statusCode, refused.body).toBe(503);
      expect(refused.json().error.code).toBe('MODULE_DISABLED');
      // The rest of the Project keeps working.
      expect((await links(project.id)).find((l) => l.kind === 'order')?.available).toBe(true);
    });
    const back = (await links(project.id)).find((l) => l.kind === 'opportunity')!;
    expect(back).toMatchObject({ recordId: opportunity.id, available: true, number: opportunity.number });
  });

  it('with Quote Requests off their links are kept and shown unavailable, cannot be added (503), and return after', async () => {
    const another = await submitCrmQuoteRequest(h);
    await withModulesDeactivated(['quote_requests'], async () => {
      const shown = (await links(project.id)).find((l) => l.kind === 'quote_request')!;
      expect(shown).toMatchObject({ recordId: quoteRequest.id, available: false });
      expect(shown.amount).toBeUndefined();
      const refused = await link(project.id, 'quote_request', another.id);
      expect(refused.statusCode, refused.body).toBe(503);
      expect(refused.json().error.code).toBe('MODULE_DISABLED');
    });
    expect((await links(project.id)).find((l) => l.kind === 'quote_request')?.available).toBe(true);
  });

  it('removing an Organization a linked record belongs to is refused — 409, and nothing changes', async () => {
    const response = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
      payload: { organizationIds: [orgB] },
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('PROJECT_ORGANIZATION_IN_USE');
    expect((await getProject(h, project.id)).organizations.map((o) => o.id).sort()).toEqual(
      [TEST_ORGANIZATION_ID, orgB].sort(),
    );
    // An Organization nothing linked belongs to still goes.
    const free = await callProjects(h, 'PUT', `/${project.id}/organizations`, {
      payload: { organizationIds: [TEST_ORGANIZATION_ID] },
    });
    expect(free.statusCode, free.body).toBe(200);
  });

  it('an Opportunity deleted in CRM is shown unavailable and can be removed by hand, which the history records', async () => {
    const doomed = await createCrmOpportunity(h, { title: 'Deleted later' });
    const doomedLink = await linkOk(second.id, 'opportunity', doomed.id);
    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `${CRM_API}/opportunities/${doomed.id}`,
      cookies: CRM_ADMIN,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    const shown = (await links(second.id)).find((l) => l.id === doomedLink.id)!;
    expect(shown).toMatchObject({ available: false });
    expect(shown.number).toBeUndefined();

    const removed = await callProjects(h, 'DELETE', `/${second.id}/links/${doomedLink.id}`);
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await links(second.id)).map((l) => l.id)).not.toContain(doomedLink.id);
    expect(await audit(second.id)).toContain('projects.project.link_remove');
  });

  it('unlinking a link of another Project, or one that does not exist, answers 404 and removes nothing', async () => {
    const [someLink] = await links(project.id);
    const wrongProject = await callProjects(h, 'DELETE', `/${second.id}/links/${someLink!.id}`);
    expect(wrongProject.statusCode, wrongProject.body).toBe(404);
    const missing = await callProjects(h, 'DELETE', `/${project.id}/links/${randomUUID()}`);
    expect(missing.statusCode, missing.body).toBe(404);
    expect((await links(project.id)).map((l) => l.id)).toContain(someLink!.id);
  });

  it('the links of a Project the caller may not see answer as for a missing Project', async () => {
    const hiddenRead = await callProjects(h, 'GET', `/${hidden.id}/links`, { cookies: outsider.cookies });
    const none = await callProjects(h, 'GET', `/${randomUUID()}/links`, { cookies: outsider.cookies });
    expect(hiddenRead.statusCode, hiddenRead.body).toBe(404);
    expect(hiddenRead.json().error.code).toBe(none.json().error.code);
    const hiddenWrite = await link(hidden.id, 'order', order.id, outsider.cookies);
    expect(hiddenWrite.statusCode, hiddenWrite.body).toBe(404);
  });
});
