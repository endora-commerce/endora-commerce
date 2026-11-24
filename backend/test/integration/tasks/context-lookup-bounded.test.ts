import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskContextLookupResponseSchema, type TaskContextOption } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { callTasks, createProject, deleteProjects, setProjectsVisibility } from '../projects/helpers.js';
import { tapStatements } from '../../helpers/statement-tap.js';

/**
 * Issue #504 — `GET /tasks/lookups/contexts`, the Project/Stage picker, asks
 * the `project` Task context's `search` for one page: one statement over the
 * Projects bounded by the page, one read of that page's Stages. Before the fix
 * every search listed every Project the caller may see, described them all and
 * asked `canChangeTasks` of each candidate, so its cost grew with the number
 * of visible Projects.
 *
 * What it offers is unchanged: what the caller may see and change, by label,
 * the label matched case- and diacritic-insensitively, at most 20.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

describe('tasks — the Project/Stage picker reads one bounded page (issue #504) [integration]', () => {
  let h: BackendServerHandle;
  const tag = `cl${randomUUID().slice(0, 6)}`;
  const created: string[] = [];
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const people: Person[] = [];
  let member: Person;
  let withoutProjectWrite: Person;
  let memberProject: string;

  async function statements<T>(run: () => Promise<T>): Promise<{ result: T; queries: Array<{ sql: string }> }> {
    const queries: Array<{ sql: string }> = [];
    const onQuery = (query: { text: string }): void => {
      // With the values rendered in, as the assertions below read them.
      queries.push({ sql: query.text });
    };
    const untap = tapStatements(h.em(), onQuery);
    try {
      return { result: await run(), queries };
    } finally {
      untap();
    }
  }

  const contexts = async (q: string, cookies?: Person['cookies']): Promise<TaskContextOption[]> => {
    const response = await callTasks(h, 'GET', `/lookups/contexts?q=${encodeURIComponent(q)}`, cookies ? { cookies } : {});
    expect(response.statusCode, response.body).toBe(200);
    return TaskContextLookupResponseSchema.parse(response.json()).data;
  };

  const project = async (title: string, members: Person[] = []): Promise<string> => {
    const made = await createProject(h, {
      title,
      organizationIds: [TEST_ORGANIZATION_ID],
      members: members.map((p) => ({ adminUserId: p.adminUserId, roleIds: [] })),
    });
    created.push(made.id);
    return made.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    member = await seedCrmAdmin(h.em(), 'cl504-member', ['tasks:read', 'tasks:write', 'projects:read', 'projects:write']);
    withoutProjectWrite = await seedCrmAdmin(h.em(), 'cl504-reader', ['tasks:read', 'tasks:write', 'projects:read']);
    people.push(member, withoutProjectWrite);
    // Thirty Projects of one name, and three of another: more than a page, and fewer.
    for (let n = 0; n < 30; n += 1) await project(`${tag} Żółw ${String(n).padStart(2, '0')}`);
    for (let n = 0; n < 3; n += 1) await project(`${tag} Kot ${n}`);
    memberProject = await project(`${tag} Członek`, [member, withoutProjectWrite]);
  });

  afterAll(async () => {
    for (const p of people) p.undo();
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('matches the label case- and diacritic-insensitively, by label, at most 20, each with its Stages', async () => {
    const found = await contexts(`${tag} zolw`);
    expect(found).toHaveLength(20);
    expect(found.map((option) => option.label.slice(option.label.indexOf(tag)))).toEqual(
      Array.from({ length: 20 }, (_, n) => `${tag} Żółw ${String(n).padStart(2, '0')}`),
    );
    expect(found[0]!.groups.map((group) => group.label)).toEqual(['Design', 'Build', 'Handover']);
    expect(await contexts(`${tag} KOT`)).toHaveLength(3);
  });

  it('costs the same statements for three matches as for thirty, and reads no more than the page', async () => {
    // Warm whatever a first request caches, so both count only per-request work.
    await contexts(`${tag} kot`);
    await contexts(`${tag} zolw`);
    const three = await statements(() => contexts(`${tag} kot`));
    const thirty = await statements(() => contexts(`${tag} zolw`));
    expect(three.result).toHaveLength(3);
    expect(thirty.result).toHaveLength(20);
    expect(thirty.queries.length, `3 matches: ${three.queries.length}; 30 matches: ${thirty.queries.length}`).toBe(
      three.queries.length,
    );
    // The Projects are read once, with the page as its limit; nothing lists every visible Project.
    const projectReads = thirty.queries.filter((query) => /from "projects" p/.test(query.sql));
    expect(projectReads).toHaveLength(1);
    // The limit and the ids are read off the statement text, values rendered in.
    expect(projectReads[0]!.sql).toMatch(/limit 20\s*$/);
    const stageReads = thirty.queries.filter((query) => /from "project_stages"/.test(query.sql));
    expect(stageReads).toHaveLength(1);
    expect(stageReads[0]!.sql.match(UUID)).toHaveLength(20);
  });

  it('keeps the visibility rule: a Member is offered only the Project they see', async () => {
    expect((await contexts(tag, member.cookies)).map((option) => option.id)).toEqual([memberProject]);
  });

  it('offers nothing to a writer of Tasks who may not change Projects, reading no Project', async () => {
    const { result, queries } = await statements(() => contexts(tag, withoutProjectWrite.cookies));
    expect(result).toEqual([]);
    expect(queries.filter((query) => /from "projects" p/.test(query.sql))).toEqual([]);
  });
});
