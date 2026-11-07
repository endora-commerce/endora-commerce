import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, slugify } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { callProjects, createProject, deleteProjects } from './helpers.js';

/**
 * Issue #453 — the two races of the Projects dictionaries, closed with advisory
 * locks (architect ruling 4 of 2026-11-07).
 *
 * 1. **Concurrent creates.** A create takes the dictionary's lock
 *    (`projects.dictionary:<table>`) first inside its Command, and only then
 *    checks the name, picks the code and reads the next position; a rename
 *    takes the same lock before its name check. So two creates of one name
 *    answer `201` and `409 PROJECT_DICTIONARY_NAME_TAKEN` — never a 500 on the
 *    code's unique index, and never a second row suffixed `_2`.
 * 2. **Role delete vs Stage write.** The delete takes `projects.role:<id>`
 *    exclusively before asking whether the Role is in use; every Stage, Stage
 *    Task and Template write that names Roles takes each one's lock shared, in
 *    sorted order, and asks again inside it whether each still exists (`422`
 *    if not). Stage saves share the lock, so they do not wait for each other.
 *
 * The "played by hand" cases follow `integration/orders/quote-request-source-review.test.ts`:
 * a forked transaction holds a lock (and, where it matters, an uncommitted
 * write), the request under test is started, and is first shown to be waiting
 * — or not — before the transaction commits.
 */

const WAIT_MS = 750;

describe('projects dictionaries — concurrent writes (#453)', () => {
  let h: BackendServerHandle;
  const createdRoles: string[] = [];
  const createdReasons: string[] = [];
  const createdProjects: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await deleteProjects(h, createdProjects);
    const connection = h.em().getConnection();
    if (createdRoles.length > 0) {
      await connection.execute(`delete from "project_roles" where "id" = any(?::uuid[])`, [`{${createdRoles.join(',')}}`]);
    }
    if (createdReasons.length > 0) {
      await connection.execute(`delete from "project_loss_reasons" where "id" = any(?::uuid[])`, [
        `{${createdReasons.join(',')}}`,
      ]);
    }
    await teardownBackendServer(h);
  });

  const DICTIONARIES = [
    { path: '/roles', table: 'project_roles', created: createdRoles },
    { path: '/loss-reasons', table: 'project_loss_reasons', created: createdReasons },
  ] as const;

  type Dictionary = (typeof DICTIONARIES)[number];

  function add(dictionary: Dictionary, defaultName: string): Promise<LightMyRequestResponse> {
    return callProjects(h, 'POST', dictionary.path, { payload: { defaultName, name: { en: defaultName } } });
  }

  function remember(dictionary: Dictionary, response: LightMyRequestResponse): string | null {
    if (response.statusCode !== 201) return null;
    const id = (response.json() as { data: { id: string } }).data.id;
    dictionary.created.push(id);
    return id;
  }

  async function rowsNamed(dictionary: Dictionary, defaultName: string): Promise<Array<{ code: string }>> {
    return (await h
      .em()
      .getConnection()
      .execute(`select "code" from "${dictionary.table}" where lower("default_name") = lower(?)`, [
        defaultName,
      ])) as Array<{ code: string }>;
  }

  function errorCode(response: LightMyRequestResponse): string | undefined {
    return (response.json() as { error?: { code?: string } }).error?.code;
  }

  /** `promise`, and whether it has settled yet. */
  function tracked<T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
    let done = false;
    const wrapped = promise.finally(() => {
      done = true;
    });
    return { promise: wrapped, settled: () => done };
  }

  const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  describe('two creates of one name', () => {
    it.each(DICTIONARIES)('at the same moment, on $path: one is added, the other is told the name is taken', async (dictionary) => {
      // Repeated: a race lost one way round says nothing about the other.
      for (let round = 0; round < 5; round += 1) {
        const name = `Concurrent ${randomUUID().slice(0, 8)}`;
        const responses = await Promise.all([add(dictionary, name), add(dictionary, name)]);
        responses.forEach((response) => remember(dictionary, response));
        expect(responses.map((response) => response.statusCode).sort(), `round ${round}: ${responses.map((r) => r.body).join(' | ')}`).toEqual([201, 409]);
        const refused = responses.find((response) => response.statusCode === 409)!;
        expect(errorCode(refused)).toBe(ERROR_CODES.PROJECT_DICTIONARY_NAME_TAKEN);
        expect(await rowsNamed(dictionary, name), `round ${round}`).toHaveLength(1);
      }
    });

    it.each(DICTIONARIES)('on $path, a create waits behind another create of the dictionary, then sees its name', async (dictionary) => {
      const name = `Waits ${randomUUID().slice(0, 8)}`;
      // The code the service derives (`dictionary-service.ts` `#freeCode`).
      const code = slugify(name, { separator: '_', maxLength: 60, fallback: 'code' });
      // The other create, played by hand: it holds the dictionary's turn and has
      // written its row, uncommitted. A create that did not wait would find the
      // name free and collide with the row's code at commit.
      const other = h.em().fork();
      await other.begin();
      let committed = false;
      try {
        await other.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`projects.dictionary:${dictionary.table}`]);
        const otherId = randomUUID();
        dictionary.created.push(otherId);
        await other.execute(
          `insert into "${dictionary.table}" ("id", "code", "name", "default_name", "position") values (?, ?, ?::jsonb, ?, 100000)`,
          [otherId, code, JSON.stringify({ en: name }), name],
        );

        const creating = tracked(add(dictionary, name));
        await pause();
        expect(creating.settled(), 'the create did not wait for the dictionary’s turn').toBe(false);
        await other.commit();
        committed = true;

        const response = await creating.promise;
        remember(dictionary, response);
        expect(response.statusCode, response.body).toBe(409);
        expect(errorCode(response)).toBe(ERROR_CODES.PROJECT_DICTIONARY_NAME_TAKEN);
        expect(await rowsNamed(dictionary, name)).toEqual([{ code }]);
      } finally {
        if (!committed) await other.rollback();
      }
    });

    it('a rename waits behind a create of the dictionary, then sees the name taken', async () => {
      const dictionary = DICTIONARIES[0];
      const renamed = remember(dictionary, await add(dictionary, `Renamed ${randomUUID().slice(0, 8)}`))!;
      expect(renamed).not.toBeNull();
      const name = `Taken ${randomUUID().slice(0, 8)}`;
      const other = h.em().fork();
      await other.begin();
      let committed = false;
      try {
        await other.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`projects.dictionary:${dictionary.table}`]);
        const otherId = randomUUID();
        dictionary.created.push(otherId);
        await other.execute(
          `insert into "${dictionary.table}" ("id", "code", "name", "default_name", "position") values (?, ?, ?::jsonb, ?, 100001)`,
          [otherId, `taken_${otherId.slice(0, 8)}`, JSON.stringify({ en: name }), name],
        );

        const renaming = tracked(callProjects(h, 'PATCH', `${dictionary.path}/${renamed}`, { payload: { defaultName: name } }));
        await pause();
        expect(renaming.settled(), 'the rename did not wait for the dictionary’s turn').toBe(false);
        await other.commit();
        committed = true;

        const response = await renaming.promise;
        expect(response.statusCode, response.body).toBe(409);
        expect(errorCode(response)).toBe(ERROR_CODES.PROJECT_DICTIONARY_NAME_TAKEN);
        expect(await rowsNamed(dictionary, name)).toHaveLength(1);
      } finally {
        if (!committed) await other.rollback();
      }
    });
  });

  describe('a Role delete and a Stage save', () => {
    const roles = DICTIONARIES[0];

    async function freshRole(): Promise<string> {
      const id = remember(roles, await add(roles, `Racing ${randomUUID().slice(0, 8)}`));
      expect(id).not.toBeNull();
      return id!;
    }

    async function freshStage(): Promise<{ projectId: string; stageId: string }> {
      const project = await createProject(h, { title: `Race ${randomUUID().slice(0, 8)}`, visibility: 'everyone' });
      createdProjects.push(project.id);
      return { projectId: project.id, stageId: project.stages[0]!.id };
    }

    function saveStage(projectId: string, stageId: string, roleIds: string[]): Promise<LightMyRequestResponse> {
      return callProjects(h, 'PATCH', `/${projectId}/stages/${stageId}`, { payload: { responsibleRoleIds: roleIds } });
    }

    function deleteRole(id: string): Promise<LightMyRequestResponse> {
      return callProjects(h, 'DELETE', `/roles/${id}`);
    }

    async function roleExists(id: string): Promise<boolean> {
      const rows = (await h.em().getConnection().execute(`select 1 from "project_roles" where "id" = ?`, [id])) as unknown[];
      return rows.length > 0;
    }

    async function stagesNaming(id: string): Promise<number> {
      const [row] = (await h
        .em()
        .getConnection()
        .execute(
          `select (
             (select count(*) from "project_stages" where ?::uuid = any("responsible_role_ids"))
             + (select count(*) from "project_template_stages" where ?::uuid = any("responsible_role_ids"))
           )::int as "n"`,
          [id, id],
        )) as [{ n: number }];
      return row.n;
    }

    it('a delete while a Stage save is between its check and its write: no Stage names a deleted Role', async () => {
      const roleId = await freshRole();
      const { projectId, stageId } = await freshStage();
      // Hold the Project's row, so the save has checked the Role and waits to
      // write it — the window the race needs, made wide on purpose.
      const other = h.em().fork();
      await other.begin();
      let committed = false;
      try {
        await other.execute(`select 1 from "projects" where "id" = ? for update`, [projectId]);
        const saving = tracked(saveStage(projectId, stageId, [roleId]));
        await pause();
        expect(saving.settled(), 'the Stage save did not wait for the Project').toBe(false);

        const deleting = tracked(deleteRole(roleId));
        await pause();
        await other.commit();
        committed = true;
        const [saved, deleted] = await Promise.all([saving.promise, deleting.promise]);

        // Either the save took the Role first and the delete is refused, or the
        // delete went first and the save is refused — never both through.
        const outcome = [saved.statusCode, deleted.statusCode];
        expect([[200, 409], [422, 204]], `save: ${saved.body} | delete: ${deleted.body}`).toContainEqual(outcome);
        if (deleted.statusCode === 204) {
          expect(await roleExists(roleId)).toBe(false);
          expect(errorCode(saved)).toBe(ERROR_CODES.VALIDATION_FAILED);
        }
        expect(await roleExists(roleId) || (await stagesNaming(roleId)) === 0, 'a Stage names a deleted Role').toBe(true);
      } finally {
        if (!committed) await other.rollback();
      }
    });

    it('a delete waits behind a Stage write that holds the Role, then finds it in use', async () => {
      const roleId = await freshRole();
      const { stageId } = await freshStage();
      // The Stage write, played by hand: it holds the Role's lock shared and has
      // written the Role onto a Stage, uncommitted.
      const other = h.em().fork();
      await other.begin();
      let committed = false;
      try {
        await other.execute('select pg_advisory_xact_lock_shared(hashtextextended(?, 0))', [`projects.role:${roleId}`]);
        await other.execute(`update "project_stages" set "responsible_role_ids" = array[?::uuid] where "id" = ?`, [
          roleId,
          stageId,
        ]);

        const deleting = tracked(deleteRole(roleId));
        await pause();
        expect(deleting.settled(), 'the delete did not wait for the Stage write').toBe(false);
        await other.commit();
        committed = true;

        const response = await deleting.promise;
        expect(response.statusCode, response.body).toBe(409);
        expect(errorCode(response)).toBe(ERROR_CODES.PROJECT_DICTIONARY_ENTRY_IN_USE);
        expect(await roleExists(roleId)).toBe(true);
      } finally {
        if (!committed) await other.rollback();
      }
    });

    it('a delete while a Member save is between its check and its write: a clean refusal, never the foreign key', async () => {
      const roleId = await freshRole();
      const { projectId } = await freshStage();
      const other = h.em().fork();
      await other.begin();
      let committed = false;
      try {
        await other.execute(`select 1 from "projects" where "id" = ? for update`, [projectId]);
        const saving = tracked(
          callProjects(h, 'PUT', `/${projectId}/members`, {
            payload: { members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [roleId] }] },
          }),
        );
        await pause();
        expect(saving.settled(), 'the Member save did not wait for the Project').toBe(false);

        const deleting = tracked(deleteRole(roleId));
        await pause();
        await other.commit();
        committed = true;
        const [saved, deleted] = await Promise.all([saving.promise, deleting.promise]);

        const outcome = [saved.statusCode, deleted.statusCode];
        expect([[200, 409], [422, 204]], `save: ${saved.body} | delete: ${deleted.body}`).toContainEqual(outcome);
        if (deleted.statusCode === 204) {
          expect(await roleExists(roleId)).toBe(false);
          expect(errorCode(saved)).toBe(ERROR_CODES.PROJECT_MEMBER_INVALID);
        } else {
          expect(errorCode(deleted)).toBe(ERROR_CODES.PROJECT_DICTIONARY_ENTRY_IN_USE);
        }
      } finally {
        if (!committed) await other.rollback();
      }
    });

    it('Stage saves naming one Role do not wait for each other', async () => {
      const roleId = await freshRole();
      const { projectId, stageId } = await freshStage();
      // Another Stage write naming the same Role, still open.
      const other = h.em().fork();
      await other.begin();
      try {
        await other.execute('select pg_advisory_xact_lock_shared(hashtextextended(?, 0))', [`projects.role:${roleId}`]);
        const response = await saveStage(projectId, stageId, [roleId]);
        expect(response.statusCode, response.body).toBe(200);
      } finally {
        await other.rollback();
      }
    });
  });
});
