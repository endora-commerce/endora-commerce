import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectAdminUserLookupResponseSchema,
  ProjectOrganizationLookupResponseSchema,
  ProjectVisibilitySettingResponseSchema,
  RecordDocumentLookupResponseSchema,
  type RecordDocumentLookupResponse,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  assignToCrmBook,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
  submitCrmQuoteRequest,
} from '../../helpers/seed-crm.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { PROJECTS_ADMIN, callProjects, createProject, deleteProjects } from '../../integration/projects/helpers.js';

/**
 * What the Projects screens' pickers choose from — Organizations and
 * administrators — and the module visibility setting the visibility control
 * explains (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.1a).
 *
 * The kit's pickers read `/organizations` and `/admin-users`, each behind its
 * owner's code; a role holding only `projects:*` got empty pickers. These are
 * the module's own, gated by its own codes, modelled on `/crm/lookups/*`:
 * Organizations only within the caller's reach, administrators only active.
 * Both are `projects:read` — the list's Organization and member filters are a
 * reader's, as CRM gates its filter lookups on `crm:read`.
 */
describe('projects (contract) — lookups for the pickers', () => {
  let h: BackendServerHandle;
  let orgA: string;
  let orgB: string;
  let writer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** No code of this module at all. */
  let outsider: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let inactiveId: string;
  const token = `lk${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    orgA = await seedCrmOrganization(h.em(), `${token} Alpha`);
    orgB = await seedCrmOrganization(h.em(), `${token} Beta`);
    // Only Projects' codes — no `organizations:*`, no `admin_users:*`.
    writer = await seedCrmAdmin(h.em(), `${token}-writer`, ['projects:read', 'projects:write']);
    reader = await seedCrmAdmin(h.em(), `${token}-reader`, ['projects:read']);
    rep = await seedCrmSalesRep(h.em(), [orgA], ['projects:read', 'projects:write']);
    outsider = await seedCrmAdmin(h.em(), `${token}-outsider`, ['crm:read']);
    const inactive = await seedCrmAdmin(h.em(), `${token}-gone`, ['projects:read']);
    inactive.undo();
    inactiveId = inactive.adminUserId;
    await h.em().getConnection().execute(`update "admin_users" set "status" = 'inactive' where "id" = ?`, [inactiveId]);
  });

  afterAll(async () => {
    writer?.undo();
    reader?.undo();
    rep?.undo();
    outsider?.undo();
    await teardownBackendServer(h);
  });

  describe('GET /projects/lookups/organizations', () => {
    it('401 without a session, 403 without projects:read', async () => {
      expect((await callProjects(h, 'GET', '/lookups/organizations', { cookies: null })).statusCode).toBe(401);
      const forbidden = await callProjects(h, 'GET', '/lookups/organizations', { cookies: outsider.cookies });
      expect(forbidden.statusCode, forbidden.body).toBe(403);
    });

    it('answers a projects:read-only holder too — the list’s Organization and member filters are a reader’s', async () => {
      const response = await callProjects(h, 'GET', `/lookups/organizations?q=${token}`, { cookies: reader.cookies });
      expect(response.statusCode, response.body).toBe(200);
      expect(ProjectOrganizationLookupResponseSchema.parse(response.json()).data.map((o) => o.id).sort()).toEqual(
        [orgA, orgB].sort(),
      );
    });

    it('answers a projects:write holder by name, without any Organizations permission', async () => {
      const response = await callProjects(h, 'GET', `/lookups/organizations?q=${token}`, { cookies: writer.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = ProjectOrganizationLookupResponseSchema.parse(response.json());
      expect(data.map((o) => o.id).sort()).toEqual([orgA, orgB].sort());
      const one = await callProjects(h, 'GET', `/lookups/organizations?q=${token}%20alp`, { cookies: writer.cookies });
      expect(ProjectOrganizationLookupResponseSchema.parse(one.json()).data.map((o) => o.id)).toEqual([orgA]);
    });

    it('a confined administrator is offered, and labelled, only the Organizations they reach', async () => {
      const response = await callProjects(h, 'GET', `/lookups/organizations?q=${token}`, { cookies: rep.cookies });
      expect(response.statusCode, response.body).toBe(200);
      expect(ProjectOrganizationLookupResponseSchema.parse(response.json()).data.map((o) => o.id)).toEqual([orgA]);
      const outOfReach = await callProjects(h, 'GET', `/lookups/organizations?id=${orgB}`, { cookies: rep.cookies });
      expect(ProjectOrganizationLookupResponseSchema.parse(outOfReach.json()).data).toEqual([]);
      const inReach = await callProjects(h, 'GET', `/lookups/organizations?id=${orgA}`, { cookies: rep.cookies });
      expect(ProjectOrganizationLookupResponseSchema.parse(inReach.json()).data.map((o) => o.id)).toEqual([orgA]);
    });

    it('refuses a malformed query — 400', async () => {
      const response = await callProjects(h, 'GET', '/lookups/organizations?limit=500', { cookies: writer.cookies });
      expect(response.statusCode, response.body).toBe(400);
    });
  });

  describe('GET /projects/lookups/admin-users', () => {
    it('401 without a session, 403 without projects:read', async () => {
      expect((await callProjects(h, 'GET', '/lookups/admin-users', { cookies: null })).statusCode).toBe(401);
      const forbidden = await callProjects(h, 'GET', '/lookups/admin-users', { cookies: outsider.cookies });
      expect(forbidden.statusCode, forbidden.body).toBe(403);
    });

    it('answers a projects:read-only holder too — the list’s any-member filter is a reader’s', async () => {
      const response = await callProjects(h, 'GET', `/lookups/admin-users?id=${writer.adminUserId}`, {
        cookies: reader.cookies,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(ProjectAdminUserLookupResponseSchema.parse(response.json()).data.map((a) => a.id)).toEqual([
        writer.adminUserId,
      ]);
    });

    it('answers active administrators by name or e-mail, without any administrators permission', async () => {
      const response = await callProjects(h, 'GET', `/lookups/admin-users?q=${token}`, { cookies: writer.cookies });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = ProjectAdminUserLookupResponseSchema.parse(response.json());
      const ids = data.map((a) => a.id);
      expect(ids).toEqual(expect.arrayContaining([writer.adminUserId, reader.adminUserId]));
      expect(ids).not.toContain(inactiveId);
      const writerRow = data.find((a) => a.id === writer.adminUserId)!;
      expect(writerRow.email).toContain(`${token}-writer`);
      expect(writerRow.name).toContain(`${token}-writer`);
    });

    it('one administrator by id — the label of a value chosen earlier', async () => {
      const response = await callProjects(h, 'GET', `/lookups/admin-users?id=${reader.adminUserId}`, {
        cookies: writer.cookies,
      });
      expect(ProjectAdminUserLookupResponseSchema.parse(response.json()).data.map((a) => a.id)).toEqual([
        reader.adminUserId,
      ]);
      const none = await callProjects(h, 'GET', `/lookups/admin-users?id=${randomUUID()}`, { cookies: writer.cookies });
      expect(ProjectAdminUserLookupResponseSchema.parse(none.json()).data).toEqual([]);
    });

    it('caps the answer at `limit`', async () => {
      const response = await callProjects(h, 'GET', `/lookups/admin-users?q=${token}&limit=1`, { cookies: writer.cookies });
      expect(ProjectAdminUserLookupResponseSchema.parse(response.json()).data).toHaveLength(1);
    });
  });

  describe('GET /projects/visibility-setting', () => {
    it('401 without a session; any projects:read holder reads the setting as it stands', async () => {
      expect((await callProjects(h, 'GET', '/visibility-setting', { cookies: null })).statusCode).toBe(401);
      const fresh = await callProjects(h, 'GET', '/visibility-setting', { cookies: reader.cookies });
      expect(fresh.statusCode, fresh.body).toBe(200);
      expect(ProjectVisibilitySettingResponseSchema.parse(fresh.json()).data).toEqual({ setting: 'members' });

      const write = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/projects.visibility/value',
        cookies: PROJECTS_ADMIN,
        payload: { scope: 'all', value: 'everyone' },
      });
      expect(write.statusCode, write.body).toBeLessThan(400);
      const changed = await callProjects(h, 'GET', '/visibility-setting', { cookies: reader.cookies });
      expect(ProjectVisibilitySettingResponseSchema.parse(changed.json()).data).toEqual({ setting: 'everyone' });
    });

    it('403 without projects:read', async () => {
      const nobody = await seedCrmAdmin(h.em(), `${token}-nobody`, ['crm:read']);
      try {
        const response = await callProjects(h, 'GET', '/visibility-setting', { cookies: nobody.cookies });
        expect(response.statusCode, response.body).toBe(403);
      } finally {
        nobody.undo();
      }
    });
  });

  /**
   * The create form's `@@` list (carry-over C10): before a Project exists the
   * form names the Organizations chosen on it, and the list offers their
   * Orders and Quote Requests — only of those within the caller's reach; an
   * Organization out of reach is not one the list answers for, and does not
   * say so. With a `projectId` the Project's own Organizations are the answer
   * and `organizationIds` is ignored.
   */
  describe('GET /projects/lookups/documents — organizationIds before a Project exists', () => {
    type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
    let documentWriter: Person;
    let confined: Person;
    let orderOfA: { id: string; businessId: string | null };
    let orderOfTest: { id: string; businessId: string | null };
    let quoteRequest: { id: string; businessId: string };
    let internalProjectId: string;

    const documents = async (query: string, who: Person): Promise<RecordDocumentLookupResponse> => {
      const response = await callProjects(h, 'GET', `/lookups/documents${query}`, { cookies: who.cookies });
      expect(response.statusCode, response.body).toBe(200);
      return RecordDocumentLookupResponseSchema.parse(response.json());
    };
    const ids = (answer: RecordDocumentLookupResponse, kind: string): string[] =>
      answer.groups.find((group) => group.kind === kind)?.items.map((item) => item.id) ?? [];
    const q = (text: string | null): string => encodeURIComponent(text ?? '');

    beforeAll(async () => {
      documentWriter = await seedCrmAdmin(h.em(), `${token}-docs`, [
        'projects:read',
        'projects:write',
        'orders:read',
        'rfqs:handle',
      ]);
      confined = await seedCrmSalesRep(h.em(), [orgA], ['projects:read', 'projects:write', 'orders:read']);
      orderOfA = await seedCrmOrder(h.em(), { organizationId: orgA });
      orderOfTest = await seedCrmOrder(h.em());
      quoteRequest = await submitCrmQuoteRequest(h);
      const internal = await createProject(h, { title: `${token} internal`, visibility: 'everyone' });
      internalProjectId = internal.id;
    });

    afterAll(async () => {
      documentWriter?.undo();
      confined?.undo();
      await deleteProjects(h, internalProjectId ? [internalProjectId] : []);
    });

    it('offers the Orders and Quote Requests of the Organizations it names', async () => {
      const orders = await documents(
        `?organizationIds=${TEST_ORGANIZATION_ID}&q=${q(orderOfTest.businessId)}`,
        documentWriter,
      );
      // `specs/165-task-management/` R-5: the Projects group follows, this module's own.
      expect(orders.groups.map((group) => group.kind)).toEqual(['order', 'quote_request', 'project']);
      expect(ids(orders, 'order')).toContain(orderOfTest.id);
      const quotes = await documents(
        `?organizationIds=${TEST_ORGANIZATION_ID}&q=${q(quoteRequest.businessId)}`,
        documentWriter,
      );
      expect(ids(quotes, 'quote_request')).toContain(quoteRequest.id);
    });

    it('takes several Organizations, repeated', async () => {
      const both = `?organizationIds=${orgA}&organizationIds=${TEST_ORGANIZATION_ID}`;
      expect(ids(await documents(`${both}&q=${q(orderOfA.businessId)}`, documentWriter), 'order')).toContain(orderOfA.id);
      expect(ids(await documents(`${both}&q=${q(orderOfTest.businessId)}`, documentWriter), 'order')).toContain(
        orderOfTest.id,
      );
      const onlyA = await documents(`?organizationIds=${orgA}&q=${q(orderOfTest.businessId)}`, documentWriter);
      expect(ids(onlyA, 'order')).not.toContain(orderOfTest.id);
    });

    it('answers only for the Organizations within the caller’s reach', async () => {
      // #305 — the test Organization is another representative's: one nobody
      // is assigned to is in every representative's reach.
      const undoBook = await assignToCrmBook(h.em(), [TEST_ORGANIZATION_ID]);
      try {
        const both = `?organizationIds=${orgA}&organizationIds=${TEST_ORGANIZATION_ID}`;
        expect(ids(await documents(`${both}&q=${q(orderOfA.businessId)}`, confined), 'order')).toContain(orderOfA.id);
        expect(ids(await documents(`${both}&q=${q(orderOfTest.businessId)}`, confined), 'order')).not.toContain(
          orderOfTest.id,
        );
        // Out of reach alone is no Organization at all: no Orders are offered.
        const outOfReach = await documents(`?organizationIds=${TEST_ORGANIZATION_ID}`, confined);
        expect(outOfReach.groups.map((group) => group.kind)).not.toContain('order');
      } finally {
        await undoBook();
      }
    });

    it('ignores organizationIds beside a projectId — the Project’s Organizations are the answer', async () => {
      const answer = await documents(
        `?projectId=${internalProjectId}&organizationIds=${TEST_ORGANIZATION_ID}`,
        documentWriter,
      );
      expect(answer.groups.map((group) => group.kind)).not.toContain('order');
      expect(answer.groups.map((group) => group.kind)).not.toContain('quote_request');
    });

    it('refuses a malformed Organization id — 400', async () => {
      const response = await callProjects(h, 'GET', '/lookups/documents?organizationIds=nope', {
        cookies: documentWriter.cookies,
      });
      expect(response.statusCode, response.body).toBe(400);
    });
  });
});
