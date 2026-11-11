import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordHistoryPageSchema, type AuditReferenceRegistryPort, type ProjectDetail } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, errorShape, setProjectsVisibility } from './helpers.js';

/**
 * User Story 7 — a Project's change history (`specs/163-projects-and-tasks/`
 * FR-028, `contracts/admin-api.md` §2.4 `GET /projects/:id/history`).
 *
 * The audit log is the history: every Command about a Project is recorded
 * against `project` and its id. The page is newest first, cursor-paged and
 * capped; it is served to `projects:read`, and a Project the caller may not
 * see answers as one that does not exist.
 */
describe('projects — history (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let reader: Person;
  let outsider: Person;
  let project: ProjectDetail;
  const created: string[] = [];

  const page = async (query: string, who: Person = reader) => {
    const response = await callProjects(h, 'GET', `/${project.id}/history${query}`, {
      cookies: who.cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    return RecordHistoryPageSchema.parse(response.json());
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    reader = await seedCrmAdmin(h.em(), 'hist-reader', ['projects:read']);
    outsider = await seedCrmAdmin(h.em(), 'hist-outsider', ['projects:read']);
    project = await createProject(h, {
      title: 'History',
      members: [{ adminUserId: reader.adminUserId, roleIds: [] }],
    });
    created.push(project.id);
    let version = project.version;
    for (const title of ['History 2', 'History 3']) {
      const response = await callProjects(h, 'PATCH', `/${project.id}`, {
        payload: { title, version },
      });
      expect(response.statusCode, response.body).toBe(200);
      version = (response.json().data as ProjectDetail).version;
    }
    expect(
      (
        await callProjects(h, 'POST', `/${project.id}/comments`, {
          payload: { kind: 'note', body: 'A note.' },
        })
      ).statusCode,
    ).toBe(201);
  });

  afterAll(async () => {
    for (const p of [reader, outsider]) p?.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('lists every Command about the Project, newest first, naming who', async () => {
    const all = await page('?limit=50');
    expect(all.data.map((entry) => entry.action)).toEqual([
      'projects.project.note_add',
      'projects.project.update',
      'projects.project.update',
      'projects.project.create',
    ]);
    expect(all.data[1]?.after).toMatchObject({ title: 'History 3' });
    expect(all.data[0]?.actor).toMatchObject({ kind: 'admin' });
    expect(all.pagination).toMatchObject({ hasMore: false, cursor: null });
    expect(all.truncated).toBe(false);
  });

  it('pages by cursor', async () => {
    const first = await page('?limit=3');
    expect(first.data).toHaveLength(3);
    expect(first.pagination.hasMore).toBe(true);
    const second = await page(`?limit=3&cursor=${encodeURIComponent(first.pagination.cursor!)}`);
    expect(second.data.map((entry) => entry.action)).toEqual(['projects.project.create']);
    expect(second.pagination.hasMore).toBe(false);
    const refused = await callProjects(h, 'GET', `/${project.id}/history?cursor=not-ours`, {
      cookies: reader.cookies,
    });
    expect(refused.statusCode, refused.body).toBe(400);
  });

  it('an audit row about the Project is labelled for a reader who may see it, and for nobody else', async () => {
    const registry = h.container.resolve<AuditReferenceRegistryPort>('auditReferenceRegistry');
    expect(registry.owners()).toContain('projects');
    const as = <T>(adminUserId: string, body: () => Promise<T>) =>
      runWithTenantContext(
        resolveTenantContext({ kind: 'admin', adminUserId }, { allowAll: true, allowedOrganizationIds: [] }),
        body,
      );
    const seen = await as(reader.adminUserId, () => registry.resolve('project', [project.id]));
    expect(seen.get(project.id)).toEqual({
      id: project.id,
      label: `${project.number} History 3`,
      url: `/projects/${project.id}`,
    });
    const hidden = await as(outsider.adminUserId, () => registry.resolve('project', [project.id]));
    expect(hidden.has(project.id)).toBe(false);
  });

  it('a Project the caller may not see answers as one that does not exist', async () => {
    const hidden = await callProjects(h, 'GET', `/${project.id}/history`, {
      cookies: outsider.cookies,
    });
    const none = await callProjects(h, 'GET', `/${randomUUID()}/history`, {
      cookies: outsider.cookies,
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
    expect(errorShape(hidden.body)).toEqual(errorShape(none.body));
  });

  describe('what the audit trail keeps, and what a reader is served (T144 F4)', () => {
    let orgA: string;
    let orgB: string;
    let rep: Person;
    let audited: ProjectDetail;

    beforeAll(async () => {
      orgA = await seedCrmOrganization(h.em(), `History A ${randomUUID().slice(0, 8)}`);
      orgB = await seedCrmOrganization(h.em(), `History B ${randomUUID().slice(0, 8)}`);
      rep = await seedCrmSalesRep(h.em(), [orgA], ['projects:read']);
      audited = await createProject(h, {
        title: 'Audited value',
        organizationIds: [orgA, orgB],
        visibility: 'everyone',
        value: { amount: '1234.56', currency: 'PLN' },
      });
      created.push(audited.id);
      const edited = await callProjects(h, 'PATCH', `/${audited.id}`, {
        payload: { value: { amount: '987.65', currency: 'PLN' }, version: audited.version },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      // Organization B goes: the Project is now in the representative's reach.
      const narrowed = await callProjects(h, 'PUT', `/${audited.id}/organizations`, { payload: { organizationIds: [orgA] } });
      expect(narrowed.statusCode, narrowed.body).toBe(200);
    });

    afterAll(() => rep?.undo());

    it('the platform audit log holds no amount — only that the value changed', async () => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "action", "state_before", "state_after" from "audit_log_entries" where "object_id" = ?`, [
          audited.id,
        ])) as Array<{ action: string; state_before: unknown; state_after: unknown }>;
      const text = JSON.stringify(rows);
      expect(text).not.toContain('1234');
      expect(text).not.toContain('987');
      expect(text).not.toContain('valueAmount');
      const create = rows.find((row) => row.action === 'projects.project.create');
      const update = rows.find((row) => row.action === 'projects.project.update');
      // The title is a value too (owner ruling O-1, 2026-11-10).
      expect(create?.state_after).toMatchObject({ changedFields: ['title', 'value'] });
      expect(update?.state_after).toMatchObject({ changedFields: ['value'] });
    });

    it('the Project’s history shows the value a create set and a change replaced, from its own store (T145, #470)', async () => {
      const response = await callProjects(h, 'GET', `/${audited.id}/history?limit=50`, { cookies: rep.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const entries = RecordHistoryPageSchema.parse(response.json()).data;
      const create = entries.find((entry) => entry.action === 'projects.project.create');
      const update = entries.find((entry) => entry.action === 'projects.project.update');
      expect(create?.after).toMatchObject({ valueAmount: '1234.56', valueCurrency: 'PLN' });
      expect(update?.before).toMatchObject({ valueAmount: '1234.56', valueCurrency: 'PLN' });
      expect(update?.after).toMatchObject({ valueAmount: '987.65', valueCurrency: 'PLN' });
      // The store's values replace the names: no bookkeeping key reaches the reader.
      expect(response.body).not.toContain('changedFields');
      expect(response.body).not.toContain('valueChangeId');
    });

    it('the platform audit log holds no title — the history serves it from the Project’s own store (O-1)', async () => {
      const titled = await createProject(h, { title: 'S470-PRJ-TITLE', organizationIds: [orgA], visibility: 'everyone' });
      created.push(titled.id);
      const renamed = await callProjects(h, 'PATCH', `/${titled.id}`, {
        payload: { title: 'S470-PRJ-TITLE-NEW', version: titled.version },
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "action", "state_before", "state_after" from "audit_log_entries" where "object_id" = ?`, [
          titled.id,
        ])) as Array<{ action: string; state_before: unknown; state_after: unknown }>;
      expect(JSON.stringify(rows)).not.toContain('S470');
      expect(rows.find((row) => row.action === 'projects.project.update')?.state_after).toMatchObject({
        changedFields: ['title'],
      });
      const response = await callProjects(h, 'GET', `/${titled.id}/history?limit=50`, { cookies: rep.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const update = RecordHistoryPageSchema.parse(response.json()).data.find(
        (entry) => entry.action === 'projects.project.update',
      );
      expect(update).toMatchObject({ before: { title: 'S470-PRJ-TITLE' }, after: { title: 'S470-PRJ-TITLE-NEW' } });
    });

    it('keeps an amount as the Project stores it — two places — not as it was typed (T145)', async () => {
      const typed = await createProject(h, { title: 'Typed short', value: { amount: '1234.5', currency: 'PLN' } });
      created.push(typed.id);
      const edited = await callProjects(h, 'PATCH', `/${typed.id}`, {
        payload: { value: { amount: '987', currency: 'PLN' }, version: typed.version },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const entries = RecordHistoryPageSchema.parse(
        (await callProjects(h, 'GET', `/${typed.id}/history?limit=50`)).json(),
      ).data;
      const create = entries.find((entry) => entry.action === 'projects.project.create');
      const update = entries.find((entry) => entry.action === 'projects.project.update');
      expect(create?.after).toMatchObject({ valueAmount: '1234.50' });
      expect(update?.before).toMatchObject({ valueAmount: '1234.50' });
      expect(update?.after).toMatchObject({ valueAmount: '987.00' });
    });

    it('the values go with the Project', async () => {
      const doomed = await createProject(h, { title: 'Valued, then deleted', value: { amount: '5.00', currency: 'PLN' } });
      const count = async () =>
        (
          (await h
            .em()
            .getConnection()
            .execute(`select count(*)::int as "n" from "project_value_changes" where "project_id" = ?`, [
              doomed.id,
            ])) as Array<{ n: number }>
        )[0]!.n;
      expect(await count()).toBe(1);
      await deleteProjects(h, [doomed.id]);
      expect(await count()).toBe(0);
    });

    it('a reader is served no Organization out of their reach, in any entry', async () => {
      const response = await callProjects(h, 'GET', `/${audited.id}/history?limit=50`, { cookies: rep.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const entries = RecordHistoryPageSchema.parse(response.json()).data;
      expect(response.body).not.toContain(orgB);
      const create = entries.find((entry) => entry.action === 'projects.project.create');
      expect(create?.after).toMatchObject({ organizationIds: [orgA] });
      const removal = entries.find((entry) => entry.action === 'projects.project.organization_remove');
      expect(removal?.before).toEqual({ organizationId: null });
      // An administrator reaching both is served both.
      const full = await callProjects(h, 'GET', `/${audited.id}/history?limit=50`);
      expect(full.body).toContain(orgB);
    });
  });
});
