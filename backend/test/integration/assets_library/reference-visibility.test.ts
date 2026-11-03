import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  createCrmOpportunity,
  removeCrmAssets,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import { multipartBody, TINY_PNG, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import { deleteProjects } from '../projects/helpers.js';

/**
 * Asset visibility follows the records that reference it
 * (`specs/166-asset-reference-visibility/`, quickstart §1, research R-5, R-7,
 * R-9, R-11; `contracts/admin-api.md` §1).
 *
 * **The reader matrix** (quickstart.md), built here and nowhere else:
 * - **A** — every Tasks, Projects, CRM and library permission; creates the
 *   private Task and the draft, is a Member of Project P1, reaches every
 *   Organization (O1 included);
 * - **B** — reads and writes Tasks, Projects, CRM and the library, without
 *   `tasks:see_private` or `projects:see_all`, not a Member of P1, confined
 *   to Organization O2;
 * - **S** — B's permissions plus `tasks:see_private` (reaching every
 *   Organization: S is the subject of the private-Task row only);
 * - **W** — the Platform administrator (`*`): the **control**, never the subject;
 * - **N** — `assets.read` / `assets.write` only.
 *
 * Every file lives in the library's root folder, which is where attachments
 * land; the hidden ones are attached straight in SQL so the fixture does not
 * depend on the owners' attach rules this feature also changes.
 */
describe('assets library — reference visibility (feature 166)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let A: Person;
  let B: Person;
  let S: Person;
  let N: Person;
  const W = { b2b_session: 'stub-admin-session' };
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;

  const run = randomUUID().slice(0, 8);
  const projectP1 = randomUUID();
  const tasks = {
    private: randomUUID(),
    draft: randomUUID(),
    inProject: randomUUID(),
    open: randomUUID(),
  };
  let opportunityO1: string;

  /** The restricted kinds of quickstart §1, US1 row: one file each, plus the extras the list cases need. */
  const files = {} as Record<
    | 'privateTask'
    | 'draftTask'
    | 'projectTask'
    | 'project'
    | 'opportunity'
    | 'deletedHidden'
    | 'imageHidden'
    | 'unused'
    | 'imageUnused'
    | 'openTask',
    string
  >;
  const assetIds: string[] = [];

  type Kind = 'privateTask' | 'draftTask' | 'projectTask' | 'project' | 'opportunity';
  const KINDS: readonly Kind[] = ['privateTask', 'draftTask', 'projectTask', 'project', 'opportunity'];

  /** Which restricted readers may not see each kind — the subjects of the not-found rows. */
  const hiddenFrom = (): Record<Kind, Array<[string, Person]>> => ({
    privateTask: [['B', B], ['N', N]],
    draftTask: [['B', B], ['S', S], ['N', N]],
    projectTask: [['B', B], ['S', S], ['N', N]],
    project: [['B', B], ['S', S], ['N', N]],
    opportunity: [['B', B], ['N', N]],
  });

  const inject = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cookies: Record<string, string>,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({
      method,
      url,
      cookies,
      ...(headers ? { headers } : {}),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  /** Every page of `GET /assets` for a query; asserts every page but the last is full. */
  async function listAll(
    cookies: Record<string, string>,
    query: Record<string, string>,
    limit: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 200; page += 1) {
      const params = new URLSearchParams({ ...query, limit: String(limit), ...(cursor ? { cursor } : {}) });
      const response = await inject('GET', `/api/v1/admin/assets?${params.toString()}`, cookies);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as { data: Array<{ id: string }>; nextCursor: string | null };
      if (body.nextCursor !== null) {
        expect(body.data, 'a page followed by another is full').toHaveLength(limit);
      }
      ids.push(...body.data.map((row) => row.id));
      cursor = body.nextCursor;
      if (cursor === null) return ids;
    }
    throw new Error('listAll: more than 200 pages');
  }

  /** What W sees, minus what the reader may not: the expected list, order kept. */
  const without = (ids: readonly string[], hidden: readonly string[]) => ids.filter((id) => !hidden.includes(id));

  async function insertTask(
    id: string,
    row: { draft?: boolean; private?: boolean; projectId?: string; createdBy: string },
  ): Promise<void> {
    await h.em().getConnection().execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private", "context_type", "context_id")
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        `T-RV-${id.slice(0, 8)}`,
        `RV ${id.slice(0, 8)}`,
        row.createdBy,
        row.draft ?? false,
        row.private ?? false,
        row.projectId ? 'project' : null,
        row.projectId ?? null,
      ],
    );
  }

  async function insertMembersOnlyProject(id: string): Promise<void> {
    const stageId = randomUUID();
    const connection = h.orm.em.getConnection();
    await connection.transactional(async (trx) => {
      await connection.execute(
        `insert into "projects" ("id", "number", "title", "visibility", "created_by_admin_user_id")
         values (?, ?, ?, 'members_and_listed', ?)`,
        [id, `PRJ-RV${id.slice(0, 8)}`, `RV ${id.slice(0, 8)}`, TEST_ADMIN_ID],
        'run',
        trx,
      );
      await connection.execute(
        `insert into "project_stages" ("id", "project_id", "name", "color", "position") values (?, ?, 'Design', '#3b82f6', 1)`,
        [stageId, id],
        'run',
        trx,
      );
      await connection.execute(`update "projects" set "current_stage_id" = ? where "id" = ?`, [stageId, id], 'run', trx);
    });
  }

  async function file(
    key: keyof typeof files,
    overrides: Parameters<typeof seedCrmAsset>[1] = {},
  ): Promise<string> {
    const seeded = await seedCrmAsset(h.em(), { filename: `rv-${run}-${key}.pdf`, ...overrides });
    files[key] = seeded.id;
    assetIds.push(seeded.id);
    return seeded.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    const B_PERMISSIONS = [
      'tasks:read',
      'tasks:write',
      'projects:read',
      'projects:write',
      'crm:read',
      'crm:write',
      'assets.read',
      'assets.write',
    ];
    A = await seedCrmAdmin(h.em(), 'rv-a', [...B_PERMISSIONS, 'tasks:see_private']);
    B = await seedCrmSalesRep(h.em(), [OTHER_TEST_ORGANIZATION_ID], B_PERMISSIONS);
    S = await seedCrmAdmin(h.em(), 'rv-s', [...B_PERMISSIONS, 'tasks:see_private']);
    N = await seedCrmAdmin(h.em(), 'rv-n', ['assets.read', 'assets.write']);

    await insertMembersOnlyProject(projectP1);
    const conn = h.em().getConnection();
    await conn.execute(`insert into "project_members" ("project_id", "admin_user_id") values (?, ?)`, [
      projectP1,
      A.adminUserId,
    ]);
    await insertTask(tasks.private, { private: true, createdBy: A.adminUserId });
    await insertTask(tasks.draft, { draft: true, createdBy: A.adminUserId });
    await insertTask(tasks.inProject, { projectId: projectP1, createdBy: A.adminUserId });
    await insertTask(tasks.open, { createdBy: A.adminUserId });
    opportunityO1 = (await createCrmOpportunity(h, { organizationId: TEST_ORGANIZATION_ID })).id;

    // Oldest first, so the newest-first list interleaves hidden and visible rows.
    await file('unused');
    await file('privateTask');
    await file('openTask');
    await file('draftTask');
    await file('imageUnused', { filename: `rv-${run}-imageUnused.png`, mimeType: 'image/png' });
    await file('projectTask');
    await file('imageHidden', { filename: `rv-${run}-imageHidden.png`, mimeType: 'image/png' });
    await file('project');
    await file('opportunity');
    await file('deletedHidden');
    await conn.execute(`update "assets" set "deleted_at" = now() where "id" = ?`, [files.deletedHidden]);

    const attachToTask = (taskId: string, assetId: string) =>
      conn.execute(`insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
        taskId,
        assetId,
        A.adminUserId,
      ]);
    await attachToTask(tasks.private, files.privateTask);
    await attachToTask(tasks.private, files.imageHidden);
    await attachToTask(tasks.private, files.deletedHidden);
    await attachToTask(tasks.draft, files.draftTask);
    await attachToTask(tasks.inProject, files.projectTask);
    await attachToTask(tasks.open, files.openTask);
    await conn.execute(
      `insert into "project_attachments" ("project_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
      [projectP1, files.project, A.adminUserId],
    );
    await conn.execute(
      `insert into "crm_opportunity_attachments" ("id", "opportunity_id", "asset_id", "file_name", "uploaded_by_admin_user_id", "created_at")
       values (?, ?, ?, ?, ?, now())`,
      [randomUUID(), opportunityO1, files.opportunity, `rv-${run}-opportunity.pdf`, A.adminUserId],
    );
  });

  afterAll(async () => {
    const conn = h.em().getConnection();
    const any = (ids: readonly string[]) => `{${ids.join(',')}}`;
    await conn.execute(`delete from gallery_items where id = any(?::uuid[])`, [any(contentRows.galleryItems)]);
    await conn.execute(`delete from categories where id = any(?::uuid[])`, [any(contentRows.categories)]);
    await conn.execute(`delete from cms_pages where id = any(?::uuid[])`, [any(contentRows.cmsPages)]);
    await conn.execute(`delete from blog_posts where id = any(?::uuid[])`, [any(contentRows.blogPosts)]);
    await conn.execute(`delete from megamenus where id = any(?::uuid[])`, [any(contentRows.megamenus)]);
    await conn.execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${Object.values(tasks).join(',')}}`]);
    await deleteProjects(h, [projectP1]);
    await removeCrmAssets(h.em(), assetIds);
    for (const person of [A, B, S, N]) person?.undo();
    await store.undo();
    await teardownBackendServer(h);
  });

  /** Restricted files each reader may not see, the soft-deleted one included. */
  const hiddenListFor = (who: 'A' | 'B' | 'S' | 'N'): string[] => {
    switch (who) {
      case 'A':
        return [];
      case 'S':
        return [files.draftTask, files.projectTask, files.project];
      case 'B':
        return [
          files.privateTask,
          files.imageHidden,
          files.deletedHidden,
          files.draftTask,
          files.projectTask,
          files.project,
          files.opportunity,
        ];
      case 'N':
        return [
          files.privateTask,
          files.imageHidden,
          files.deletedHidden,
          files.draftTask,
          files.projectTask,
          files.project,
          files.opportunity,
          files.openTask,
        ];
    }
  };
  const reader = (who: 'A' | 'B' | 'S' | 'N'): Person => ({ A, B, S, N })[who];

  /** `contracts/admin-api.md` §1 rows 2–5, 7–11, 13: every by-id route. */
  const BY_ID_ROUTES: ReadonlyArray<{
    row: number;
    name: string;
    send: (id: string, cookies: Record<string, string>) => Promise<LightMyRequestResponse>;
  }> = [
    {
      row: 2,
      name: 'POST /assets/:id/replace',
      send: (id, cookies) => {
        const { body, contentType } = multipartBody([
          { name: 'file', filename: 'replacement.png', mime: 'image/png', value: TINY_PNG },
        ]);
        return inject('POST', `/api/v1/admin/assets/${id}/replace`, cookies, body, { 'content-type': contentType });
      },
    },
    {
      row: 3,
      name: 'POST /assets/:id/previous-version/restore',
      send: (id, cookies) =>
        inject('POST', `/api/v1/admin/assets/${id}/previous-version/restore`, cookies, {
          expectedContentVersion: 'v1',
          expectedPreviousContentVersion: 'v0',
        }),
    },
    {
      row: 4,
      name: 'PUT /assets/:id/permalink',
      send: (id, cookies) =>
        inject('PUT', `/api/v1/admin/assets/${id}/permalink`, cookies, { permalink: `rv-${run}/by-id.pdf` }),
    },
    { row: 5, name: 'DELETE /assets/:id/permalink', send: (id, cookies) => inject('DELETE', `/api/v1/admin/assets/${id}/permalink`, cookies) },
    { row: 7, name: 'GET /assets/:id', send: (id, cookies) => inject('GET', `/api/v1/admin/assets/${id}`, cookies) },
    { row: 8, name: 'GET /assets/:id/url', send: (id, cookies) => inject('GET', `/api/v1/admin/assets/${id}/url`, cookies) },
    { row: 9, name: 'DELETE /assets/:id', send: (id, cookies) => inject('DELETE', `/api/v1/admin/assets/${id}`, cookies) },
    { row: 10, name: 'POST /assets/:id/restore', send: (id, cookies) => inject('POST', `/api/v1/admin/assets/${id}/restore`, cookies) },
    {
      row: 11,
      name: 'POST /assets/:id/move',
      send: (id, cookies) => inject('POST', `/api/v1/admin/assets/${id}/move`, cookies, { folderId: null }),
    },
    {
      row: 13,
      name: 'PATCH /assets/:id',
      send: (id, cookies) => inject('PATCH', `/api/v1/admin/assets/${id}`, cookies, { label: 'renamed' }),
    },
  ];

  describe('US1 — files of records I cannot see stay hidden in the library', () => {
    it('the control: W lists every seeded file in the root folder', async () => {
      const all = await listAll(W, {}, 100);
      for (const id of Object.values(files).filter((id) => id !== files.deletedHidden)) {
        expect(all).toContain(id);
      }
      expect(all).not.toContain(files.deletedHidden);
      expect(await listAll(W, { includeDeleted: 'true' }, 100)).toContain(files.deletedHidden);
    });

    it.each(['A', 'B', 'S', 'N'] as const)(
      'GET /assets, root folder: %s gets W’s list minus their hidden files, in full pages',
      async (who) => {
        const expected = without(await listAll(W, {}, 100), hiddenListFor(who));
        expect(await listAll(reader(who).cookies, {}, 2)).toEqual(expected);
        expect(await listAll(reader(who).cookies, {}, 3)).toEqual(expected);
      },
    );

    it.each(['B', 'S', 'N'] as const)('GET /assets?q=<name>: %s does not find a hidden file by its name', async (who) => {
      const expected = without(await listAll(W, { q: `rv-${run}` }, 100), hiddenListFor(who));
      expect(await listAll(reader(who).cookies, { q: `rv-${run}` }, 2)).toEqual(expected);
      for (const hidden of hiddenListFor(who)) {
        const key = (Object.keys(files) as Array<keyof typeof files>).find((k) => files[k] === hidden)!;
        expect(await listAll(reader(who).cookies, { q: `rv-${run}-${key}` }, 10)).toEqual([]);
      }
    });

    it.each(['B', 'N'] as const)('GET /assets?includeDeleted=true: %s does not see a hidden file, deleted or not', async (who) => {
      const expected = without(await listAll(W, { includeDeleted: 'true' }, 100), hiddenListFor(who));
      expect(expected).not.toContain(files.deletedHidden);
      expect(await listAll(reader(who).cookies, { includeDeleted: 'true' }, 2)).toEqual(expected);
    });

    it('the picker’s query (root, mime=image/, limit 24): B is offered the visible image only', async () => {
      const picker = { mime: 'image/' };
      const forW = await listAll(W, picker, 24);
      expect(forW).toEqual(expect.arrayContaining([files.imageHidden, files.imageUnused]));
      const forB = await listAll(B.cookies, picker, 24);
      expect(forB).toEqual(without(forW, [files.imageHidden]));
      expect(forB).toContain(files.imageUnused);
    });

    /** The answer with the asked id and the request id taken out: what must be equal byte for byte. */
    function normalised(response: LightMyRequestResponse, id: string): unknown {
      const body = JSON.parse(response.body.split(id).join('<id>')) as { error?: Record<string, unknown> };
      if (body.error) delete body.error.requestId;
      return { status: response.statusCode, body };
    }

    it.each(KINDS)('every by-id route answers a hidden %s file exactly as a random uuid', async (kind) => {
      for (const [who, person] of hiddenFrom()[kind]) {
        for (const route of BY_ID_ROUTES) {
          const missing = randomUUID();
          const hidden = await route.send(files[kind], person.cookies);
          const none = await route.send(missing, person.cookies);
          const label = `${who} · row ${route.row} ${route.name}`;
          expect(none.statusCode, `${label} (random uuid): ${none.body}`).toBe(404);
          expect(none.json().error.code, label).toBe(ERROR_CODES.ASSET_NOT_FOUND);
          expect(normalised(hidden, files[kind]), label).toEqual(normalised(none, missing));
        }
      }
    });

    /**
     * Review T055, F-1: Postgres also reads a uuid without hyphens, in braces
     * or grouped otherwise, so a guard that left every non-canonical id to the
     * service let a hidden file through by its other spellings. The canonical
     * form in upper case is the same id in another case.
     */
    const spellings = (id: string): Array<[string, string]> => {
      const bare = id.replaceAll('-', '');
      return [
        ['without hyphens', bare],
        ['in braces', `{${id}}`],
        ['in upper case', id.toUpperCase()],
        ['grouped otherwise', `${bare.slice(0, 4)}-${bare.slice(4, 16)}-${bare.slice(16)}`],
      ];
    };

    it('every by-id route answers every other spelling of a hidden file exactly as the same spelling of a random uuid', async () => {
      for (const [who, person] of [['B', B], ['N', N]] as const) {
        for (const route of BY_ID_ROUTES) {
          const missing = randomUUID();
          const canonical = normalised(await route.send(missing, person.cookies), missing);
          const hiddenSpellings = spellings(files.privateTask);
          const missingSpellings = spellings(missing);
          for (const [index, [spelling, hiddenId]] of hiddenSpellings.entries()) {
            const missingId = missingSpellings[index]![1];
            const label = `${who} · row ${route.row} ${route.name} · ${spelling}`;
            const hidden = await route.send(encodeURIComponent(hiddenId), person.cookies);
            const none = await route.send(encodeURIComponent(missingId), person.cookies);
            expect(none.statusCode, `${label} (random uuid): ${none.body}`).toBe(404);
            expect(none.json().error.code, label).toBe(ERROR_CODES.ASSET_NOT_FOUND);
            // The answer names the spelling sent, or its lower case for the canonical form.
            const echoed = (sent: string) => (spelling === 'in upper case' ? sent.toLowerCase() : sent);
            expect(normalised(hidden, echoed(hiddenId)), label).toEqual(normalised(none, echoed(missingId)));
            expect(normalised(hidden, echoed(hiddenId)), label).toEqual(canonical);
          }
        }
      }
    });

    it('a visible file answers only to its canonical spelling, in either case — for every reader, the control included', async () => {
      for (const [who, cookies] of [['A', A.cookies], ['B', B.cookies], ['W', W]] as const) {
        for (const [spelling, id] of spellings(files.unused)) {
          for (const suffix of ['', '/url']) {
            const response = await inject('GET', `/api/v1/admin/assets/${encodeURIComponent(id)}${suffix}`, cookies);
            const label = `${who} · GET /assets/:id${suffix} · ${spelling}: ${response.body}`;
            if (spelling === 'in upper case') {
              expect(response.statusCode, label).toBe(200);
              if (suffix === '') expect(response.json().data.id, label).toBe(files.unused);
            } else {
              expect(response.statusCode, label).toBe(404);
              expect(response.json().error.code, label).toBe(ERROR_CODES.ASSET_NOT_FOUND);
            }
          }
        }
      }
    });

    it('replacing a hidden file stages no bytes', async () => {
      const before = await storedFiles(store.baseDir);
      const cleanupsBefore = await cleanupCount();
      const { body, contentType } = multipartBody([
        { name: 'file', filename: 'replacement.png', mime: 'image/png', value: TINY_PNG },
      ]);
      const response = await inject('POST', `/api/v1/admin/assets/${files.privateTask}/replace`, B.cookies, body, {
        'content-type': contentType,
      });
      expect(response.statusCode, response.body).toBe(404);
      expect(await storedFiles(store.baseDir)).toEqual(before);
      expect(await cleanupCount()).toBe(cleanupsBefore);
    });

    it('move-many skips a hidden id exactly like a missing one — not moved, not counted, not audited', async () => {
      const created = await inject('POST', '/api/v1/admin/assets/folders', W, { name: `rv-${run}-target`, parentId: null });
      expect(created.statusCode, created.body).toBe(201);
      const folderId = (created.json() as { data: { id: string } }).data.id;

      const moved = await inject('POST', '/api/v1/admin/assets/move-many', B.cookies, {
        assetIds: [files.privateTask, files.unused, randomUUID()],
        folderId,
      });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(moved.json()).toEqual({ data: { movedCount: 1 } });
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string; folder_id: string | null }>>(
          `select id::text as id, folder_id::text as folder_id from assets where id in (?, ?)`,
          [files.privateTask, files.unused],
        );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.folder_id]))).toEqual({
        [files.privateTask]: null,
        [files.unused]: folderId,
      });
      const audit = await h.auditLogService.query({ action: 'asset.move_many', objectId: folderId });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.stateAfter).toMatchObject({ folderId, assetIds: [files.unused] });

      // The control: W moves the same three and only the hidden one more.
      const back = await inject('POST', '/api/v1/admin/assets/move-many', W, { assetIds: [files.unused], folderId: null });
      expect(back.json()).toEqual({ data: { movedCount: 1 } });
    });

    it('a permalink conflict does not name a hidden holder — details.assetId is null for B, the holder for W', async () => {
      const permalink = `rv-${run}/held.pdf`;
      await h.em().getConnection().execute(`update "assets" set "permalink" = ? where "id" = ?`, [permalink, files.privateTask]);
      try {
        const forB = await inject('PUT', `/api/v1/admin/assets/${files.unused}/permalink`, B.cookies, { permalink });
        expect(forB.statusCode, forB.body).toBe(409);
        expect(forB.json().error.code).toBe(ERROR_CODES.ASSET_PERMALINK_TAKEN);
        expect(forB.json().error.details).toEqual({ permalink, assetId: null });

        const forW = await inject('PUT', `/api/v1/admin/assets/${files.unused}/permalink`, W, { permalink });
        expect(forW.statusCode, forW.body).toBe(409);
        expect(forW.json().error.details).toEqual({ permalink, assetId: files.privateTask });
        expect(forW.json().error.message).toBe(forB.json().error.message);

        // A holder the caller may see is still named.
        const forA = await inject('PUT', `/api/v1/admin/assets/${files.unused}/permalink`, A.cookies, { permalink });
        expect(forA.json().error.details).toEqual({ permalink, assetId: files.privateTask });
      } finally {
        await h.em().getConnection().execute(`update "assets" set "permalink" = null where "id" = ?`, [files.privateTask]);
      }
    });

    it('A, S (private Task) and W see and use the files', async () => {
      const seeAndUse = async (cookies: Record<string, string>, id: string, label: string) => {
        const detail = await inject('GET', `/api/v1/admin/assets/${id}`, cookies);
        expect(detail.statusCode, `${label}: ${detail.body}`).toBe(200);
        const url = await inject('GET', `/api/v1/admin/assets/${id}/url`, cookies);
        expect(url.statusCode, `${label}: ${url.body}`).toBe(200);
        const patched = await inject('PATCH', `/api/v1/admin/assets/${id}`, cookies, { label: `seen by ${label}` });
        expect(patched.statusCode, `${label}: ${patched.body}`).toBe(200);
      };
      for (const kind of KINDS) {
        await seeAndUse(A.cookies, files[kind], `A ${kind}`);
        await seeAndUse(W, files[kind], `W ${kind}`);
      }
      await seeAndUse(S.cookies, files.privateTask, 'S privateTask');
      await seeAndUse(S.cookies, files.opportunity, 'S opportunity');
      expect(await listAll(S.cookies, { q: `rv-${run}-privateTask` }, 10)).toEqual([files.privateTask]);
    });
  });

  /**
   * US2 and US3 seed their files through the upload route (real bytes, so a
   * replace and a previous-version restore work) and reference them through
   * the unrestricted contributors' own tables. Their names do not start with
   * `rv-<run>`, so US1's `q=` cases never see them; they are created after
   * US1's cases have run, so US1's root lists never see them either.
   */
  const contentRows = {
    galleryItems: [] as string[],
    categories: [] as string[],
    cmsPages: [] as string[],
    blogPosts: [] as string[],
    megamenus: [] as string[],
  };

  async function uploadPng(filename: string, folderId: string | null = null): Promise<string> {
    const { body, contentType } = multipartBody([
      ...(folderId ? [{ name: 'folderId', value: folderId }] : []),
      { name: 'file', filename, mime: 'image/png', value: TINY_PNG },
    ]);
    const response = await inject('POST', '/api/v1/admin/assets', W, body, { 'content-type': contentType });
    expect(response.statusCode, response.body).toBe(201);
    const id = (response.json() as { data: { id: string } }).data.id;
    assetIds.push(id);
    return id;
  }

  async function createProduct(label: string): Promise<string> {
    const response = await inject('POST', '/api/v1/admin/catalog/products', W, {
      sku: `RV-${run}-${label}-${randomUUID().slice(0, 6)}`,
      type: 'simple',
      name: { 'en-US': `RV ${run} ${label}` },
      description: { 'en-US': 'desc' },
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  /** One reference of an unrestricted kind, written in the contributor's own table. */
  async function useUnrestricted(
    kind: 'product_gallery' | 'category_content' | 'cms_body_embed' | 'blog_post_main_image' | 'megamenu_item_target',
    assetId: string,
    productId: string,
  ): Promise<void> {
    const conn = h.em().getConnection();
    const id = randomUUID();
    const embed = (assetIdValue: string) =>
      JSON.stringify({
        schema_version: 1,
        languages: { 'en-US': { root: { props: {} }, content: [{ type: 'LibraryImage', props: { assetId: assetIdValue } }] } },
      });
    switch (kind) {
      case 'product_gallery':
        await conn.execute(
          `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at) values (?, ?, ?, ?, now(), now())`,
          [id, productId, assetId, contentRows.galleryItems.length],
        );
        contentRows.galleryItems.push(id);
        return;
      case 'category_content':
        await conn.execute(
          `insert into categories (id, name, slug, content, created_at, updated_at)
           values (?, '{"en-US":"RV content"}'::jsonb, ?, ?::jsonb, now(), now())`,
          [id, `rv-${run}-${id.slice(0, 8)}`, embed(assetId)],
        );
        contentRows.categories.push(id);
        return;
      case 'cms_body_embed':
        await conn.execute(
          `insert into cms_pages (id, path, name, content, created_at, updated_at) values (?, ?, ?, ?::jsonb, now(), now())`,
          [id, `rv-${run}-${id.slice(0, 8)}`, `RV ${id.slice(0, 8)}`, embed(assetId)],
        );
        contentRows.cmsPages.push(id);
        return;
      case 'blog_post_main_image':
        await conn.execute(
          `insert into blog_posts (id, slug, name, main_image_asset_id, version, created_at, updated_at)
           values (?, ?, '{"en-US":"RV post"}'::jsonb, ?, 1, now(), now())`,
          [id, `rv-${run}-${id.slice(0, 8)}`, assetId],
        );
        contentRows.blogPosts.push(id);
        return;
      case 'megamenu_item_target': {
        // Through the megamenu module's own admin routes, not raw rows: the
        // item tree carries invariants of its own (since feature 168 an asset
        // opens under a tab, and a tab row needs its presentation and
        // alignment), and a hand-written row is stranded by the next one.
        const created = await inject('POST', '/api/v1/admin/megamenu/menus', W, { name: `RV ${id.slice(0, 8)}` });
        expect(created.statusCode, created.body).toBe(201);
        const menu = (created.json() as { data: { id: string; version: number } }).data;
        contentRows.megamenus.push(menu.id);
        const tab = randomUUID();
        const items = await inject('PUT', `/api/v1/admin/megamenu/menus/${menu.id}/items`, W, {
          version: menu.version,
          items: [
            { id: tab, parentId: null, presentation: 'mega', position: 0, kind: 'group', labels: { 'en-US': 'RV tab' }, target: {} },
            {
              id: randomUUID(),
              parentId: tab,
              position: 0,
              kind: 'asset',
              labels: { 'en-US': 'RV tile' },
              target: { assetId, kind: 'image' },
            },
          ],
        });
        expect(items.statusCode, items.body).toBe(200);
        return;
      }
    }
  }

  async function attachToTask(taskId: string, assetId: string): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
        taskId,
        assetId,
        A.adminUserId,
      ]);
  }

  type Detail = { id: string; references: Array<Record<string, unknown>> };
  async function detail(cookies: Record<string, string>, id: string): Promise<{ status: number; data: Detail; body: string }> {
    const response = await inject('GET', `/api/v1/admin/assets/${id}`, cookies);
    return { status: response.statusCode, data: (response.json() as { data: Detail }).data, body: response.body };
  }

  /** A reference list as `kind:entityId`, sorted — the order of the registry is not what is compared. */
  const named = (references: ReadonlyArray<Record<string, unknown>>): string[] =>
    references.map((r) => `${String(r.kind)}:${String(r.entityId)}`).sort();

  describe('US2 — shared files and files uploaded straight to the library keep working', () => {
    /** Every unrestricted kind of quickstart §1, US2 row, plus an unused upload and a rescued file. */
    type SharedKey =
      | 'product_gallery'
      | 'category_content'
      | 'cms_body_embed'
      | 'blog_post_main_image'
      | 'megamenu_item_target'
      | 'unused'
      | 'rescued';
    const UNRESTRICTED = [
      'product_gallery',
      'category_content',
      'cms_body_embed',
      'blog_post_main_image',
      'megamenu_item_target',
    ] as const;
    const SHARED: readonly SharedKey[] = [...UNRESTRICTED, 'unused', 'rescued'];
    const atRoot = {} as Record<SharedKey | 'twoTasks', string>;
    const inFolder = {} as Record<SharedKey, string>;
    let folderG: string;
    let product: string;

    beforeAll(async () => {
      const created = await inject('POST', '/api/v1/admin/assets/folders', W, { name: `rvs-${run}-images`, parentId: null });
      expect(created.statusCode, created.body).toBe(201);
      folderG = (created.json() as { data: { id: string } }).data.id;
      product = await createProduct('US2');

      for (const key of SHARED) {
        atRoot[key] = await uploadPng(`rvs-${run}-${key}.png`);
        inFolder[key] = await uploadPng(`rvs-${run}-g-${key}.png`, folderG);
      }
      atRoot.twoTasks = await uploadPng(`rvs-${run}-twoTasks.png`);

      for (const kind of UNRESTRICTED) {
        await useUnrestricted(kind, atRoot[kind], product);
        await useUnrestricted(kind, inFolder[kind], product);
      }
      // Rescue (FR-001 b): A's private Task, which B may not see, and a product.
      for (const rescued of [atRoot.rescued, inFolder.rescued]) {
        await attachToTask(tasks.private, rescued);
        await useUnrestricted('product_gallery', rescued, product);
      }
      // Two Tasks: the open one B sees, A's private one B does not.
      await attachToTask(tasks.open, atRoot.twoTasks);
      await attachToTask(tasks.private, atRoot.twoTasks);
    });

    it('the control: W sees each file referenced by its kind, the unused one by nothing', async () => {
      for (const where of [atRoot, inFolder]) {
        for (const kind of UNRESTRICTED) {
          const { status, data } = await detail(W, where[kind]);
          expect(status).toBe(200);
          expect(data.references.map((r) => r.kind), kind).toEqual([kind]);
        }
        expect((await detail(W, where.unused)).data.references).toEqual([]);
        expect(named((await detail(W, where.rescued)).data.references)).toEqual(
          [`product_gallery:${product}`, `task_attachment:${tasks.private}`].sort(),
        );
      }
      expect(named((await detail(W, atRoot.twoTasks)).data.references)).toEqual(
        [`task_attachment:${tasks.open}`, `task_attachment:${tasks.private}`].sort(),
      );
    });

    it.each(['root', 'folder'] as const)(
      'unrestricted kinds and an unused upload: B’s detail equals W’s, byte for byte (%s)',
      async (where) => {
        const ids = where === 'root' ? atRoot : inFolder;
        for (const key of [...UNRESTRICTED, 'unused'] as const) {
          const forW = await inject('GET', `/api/v1/admin/assets/${ids[key]}`, W);
          const forB = await inject('GET', `/api/v1/admin/assets/${ids[key]}`, B.cookies);
          expect(forB.statusCode, `${key}: ${forB.body}`).toBe(200);
          expect(forB.json(), key).toEqual(forW.json());
        }
      },
    );

    it('root folder: B gets W’s list minus US1’s hidden files — every US2 file listed, pages full', async () => {
      const forW = await listAll(W, {}, 100);
      const expected = without(forW, hiddenListFor('B'));
      expect(expected).toEqual(expect.arrayContaining(Object.values(atRoot)));
      expect(await listAll(B.cookies, {}, 2)).toEqual(expected);
      expect(await listAll(B.cookies, {}, 3)).toEqual(expected);
    });

    /** Every page of a list, as the client receives it: items, order and `nextCursor`. */
    async function pages(cookies: Record<string, string>, query: Record<string, string>, limit: number): Promise<unknown[]> {
      const out: unknown[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 50; page += 1) {
        const params = new URLSearchParams({ ...query, limit: String(limit), ...(cursor ? { cursor } : {}) });
        const response = await inject('GET', `/api/v1/admin/assets?${params.toString()}`, cookies);
        expect(response.statusCode, response.body).toBe(200);
        const body = response.json() as { data: unknown[]; nextCursor: string | null };
        out.push(body);
        cursor = body.nextCursor;
        if (cursor === null) return out;
      }
      throw new Error('pages: more than 50 pages');
    }

    it.each([2, 3, 50])('a product-image folder: B’s pages equal W’s — items, order and nextCursor (limit %i)', async (limit) => {
      const query = { folderId: folderG };
      const forW = await pages(W, query, limit);
      expect(forW.flatMap((p) => (p as { data: Array<{ id: string }> }).data.map((row) => row.id)).sort()).toEqual(
        Object.values(inFolder).sort(),
      );
      expect(await pages(B.cookies, query, limit)).toEqual(forW);
    });

    it('the shared picker’s query (mime=image/): the same set for B and W, root and folder', async () => {
      const picker = { mime: 'image/' };
      const rootForW = await listAll(W, picker, 24);
      const rootForB = await listAll(B.cookies, picker, 24);
      // Root: US1's hidden image is the one difference.
      expect(rootForB).toEqual(without(rootForW, [files.imageHidden]));
      expect(rootForB).toEqual(expect.arrayContaining(Object.values(atRoot)));
      expect(await pages(B.cookies, { ...picker, folderId: folderG }, 24)).toEqual(
        await pages(W, { ...picker, folderId: folderG }, 24),
      );
    });

    it('rescue: a file of A’s private Task and a product is visible to B — list, detail, URL', async () => {
      for (const id of [atRoot.rescued, inFolder.rescued]) {
        const shown = await detail(B.cookies, id);
        expect(shown.status, shown.body).toBe(200);
        const url = await inject('GET', `/api/v1/admin/assets/${id}/url`, B.cookies);
        expect(url.statusCode, url.body).toBe(200);
      }
      expect(await listAll(B.cookies, { q: `rvs-${run}-rescued` }, 10)).toEqual([atRoot.rescued]);
      expect(await listAll(B.cookies, { q: `rvs-${run}-g-rescued`, folderId: folderG }, 10)).toEqual([inFolder.rescued]);
    });

    it('rescue: no by-id route answers B the missing-file answer for the rescued file', async () => {
      for (const route of BY_ID_ROUTES) {
        const response = await route.send(atRoot.rescued, B.cookies);
        const label = `row ${route.row} ${route.name}: ${response.body}`;
        expect(response.statusCode, label).not.toBe(404);
        const code = response.statusCode >= 400 ? (response.json() as { error: { code: string } }).error.code : null;
        expect(code, label).not.toBe(ERROR_CODES.ASSET_NOT_FOUND);
      }
    });

    it('a file of two Tasks, one B sees and one B does not, is visible to B (and hidden from N, who reads no Task)', async () => {
      expect((await detail(B.cookies, atRoot.twoTasks)).status).toBe(200);
      expect(await listAll(B.cookies, { q: `rvs-${run}-twoTasks` }, 10)).toEqual([atRoot.twoTasks]);
      // The control: the file has no unrestricted reference, so the visible Task is what shows it.
      expect((await detail(N.cookies, atRoot.twoTasks)).status).toBe(404);
      expect(await listAll(N.cookies, { q: `rvs-${run}-twoTasks` }, 10)).toEqual([]);
    });
  });

  describe('US3 — the "used by" list shows only what I may see', () => {
    /** F: a product and A's private Task. FP: Project P1 and a CMS embed. FO: an O1 Opportunity and a CMS embed. */
    let F: string;
    let FP: string;
    let FO: string;
    let product: string;
    let cmsForProject: string;
    let cmsForOpportunity: string;

    beforeAll(async () => {
      product = await createProduct('US3');
      F = await uploadPng(`rvu-${run}-product-task.png`);
      FP = await uploadPng(`rvu-${run}-project-cms.png`);
      FO = await uploadPng(`rvu-${run}-opportunity-cms.png`);
      await useUnrestricted('product_gallery', F, product);
      await attachToTask(tasks.private, F);

      const conn = h.em().getConnection();
      await conn.execute(
        `insert into "project_attachments" ("project_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
        [projectP1, FP, A.adminUserId],
      );
      await useUnrestricted('cms_body_embed', FP, product);
      cmsForProject = contentRows.cmsPages.at(-1)!;
      await conn.execute(
        `insert into "crm_opportunity_attachments" ("id", "opportunity_id", "asset_id", "file_name", "uploaded_by_admin_user_id", "created_at")
         values (?, ?, ?, ?, ?, now())`,
        [randomUUID(), opportunityO1, FO, `rvu-${run}-opportunity-cms.png`, A.adminUserId],
      );
      await useUnrestricted('cms_body_embed', FO, product);
      cmsForOpportunity = contentRows.cmsPages.at(-1)!;
    });

    /** No reference on the wire carries anything but its kind, record and label (`contracts/admin-api.md` §1 row 7). */
    function expectWireShape(references: ReadonlyArray<Record<string, unknown>>, label: string): void {
      for (const reference of references) {
        expect(Object.keys(reference).sort(), label).toEqual(['entityId', 'kind', 'label']);
      }
    }

    it('GET /assets/:id: B and N see the product only; A and W see the product and the Task', async () => {
      const both = [`product_gallery:${product}`, `task_attachment:${tasks.private}`].sort();
      const productOnly = [`product_gallery:${product}`];
      const cases: Array<[string, Record<string, string>, string[]]> = [
        ['B', B.cookies, productOnly],
        ['N', N.cookies, productOnly],
        ['A', A.cookies, both],
        ['S', S.cookies, both],
        ['W', W, both],
      ];
      for (const [who, cookies, expected] of cases) {
        const shown = await detail(cookies, F);
        expect(shown.status, `${who}: ${shown.body}`).toBe(200);
        expect(named(shown.data.references), who).toEqual(expected);
        expectWireShape(shown.data.references, who);
      }
    });

    it('every mutating by-id route answers B a detail filtered the same way', async () => {
      const productOnly = [`product_gallery:${product}`];
      const check = (response: LightMyRequestResponse, label: string): Detail & {
        contentVersion: string;
        previousVersion: { contentVersion: string } | null;
      } => {
        expect(response.statusCode, `${label}: ${response.body}`).toBe(200);
        const data = (response.json() as { data: Detail & { contentVersion: string; previousVersion: { contentVersion: string } | null } }).data;
        expect(named(data.references), label).toEqual(productOnly);
        expectWireShape(data.references, label);
        return data;
      };
      check(await inject('PATCH', `/api/v1/admin/assets/${F}`, B.cookies, { filename: `rvu-${run}-renamed.png` }), 'PATCH (rename)');
      check(await inject('POST', `/api/v1/admin/assets/${F}/move`, B.cookies, { folderId: null }), 'move');
      const { body, contentType } = multipartBody([
        { name: 'file', filename: 'replacement.png', mime: 'image/png', value: TINY_PNG },
      ]);
      const replaced = check(
        await inject('POST', `/api/v1/admin/assets/${F}/replace`, B.cookies, body, { 'content-type': contentType }),
        'replace',
      );
      expect(replaced.previousVersion, 'the replace kept a previous version').not.toBeNull();
      check(
        await inject('POST', `/api/v1/admin/assets/${F}/previous-version/restore`, B.cookies, {
          expectedContentVersion: replaced.contentVersion,
          expectedPreviousContentVersion: replaced.previousVersion!.contentVersion,
        }),
        'previous-version restore',
      );
      check(await inject('PUT', `/api/v1/admin/assets/${F}/permalink`, B.cookies, { permalink: `rvu-${run}/used-by.png` }), 'permalink set');
      check(await inject('DELETE', `/api/v1/admin/assets/${F}/permalink`, B.cookies), 'permalink remove');
      check(await inject('POST', `/api/v1/admin/assets/${F}/restore`, B.cookies), 'restore');

      // The control: the same file still names both records to W.
      expect(named((await detail(W, F)).data.references)).toEqual(
        [`product_gallery:${product}`, `task_attachment:${tasks.private}`].sort(),
      );
    });

    it('a Project and an Opportunity reference beside a CMS embed: B sees the CMS page only', async () => {
      const cases: Array<[string, string, string, Array<[string, Record<string, string>, boolean]>]> = [
        [
          'Project P1',
          FP,
          `project_attachment:${projectP1}`,
          [['B', B.cookies, false], ['N', N.cookies, false], ['S', S.cookies, false], ['A', A.cookies, true], ['W', W, true]],
        ],
        [
          'Opportunity of O1',
          FO,
          `crm_opportunity_attachment:${opportunityO1}`,
          [['B', B.cookies, false], ['N', N.cookies, false], ['S', S.cookies, true], ['A', A.cookies, true], ['W', W, true]],
        ],
      ];
      for (const [what, id, restricted, readers] of cases) {
        const cms = `cms_body_embed:${id === FP ? cmsForProject : cmsForOpportunity}`;
        for (const [who, cookies, seesRecord] of readers) {
          const shown = await detail(cookies, id);
          const label = `${what} · ${who}`;
          expect(shown.status, `${label}: ${shown.body}`).toBe(200);
          expect(named(shown.data.references), label).toEqual(seesRecord ? [cms, restricted].sort() : [cms]);
          expectWireShape(shown.data.references, label);
        }
      }
    });
  });

  async function cleanupCount(): Promise<number> {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ n: string }>>(`select count(*)::text as n from asset_object_cleanups`);
    const [row] = rows;
    if (!row) throw new Error('count(*) answered no row');
    return Number(row.n);
  }
});

/** Every file under the temporary store, relative — what a staged replace would add to. */
async function storedFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (at: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(at, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  await walk(dir, '');
  return out.sort();
}
