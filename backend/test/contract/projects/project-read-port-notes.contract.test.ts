import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PROJECT_READ_PORT_NOTES_MAX,
  type ProjectNotePage,
  type ProjectNoteQuery,
  type ProjectReadPort,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  callProjects,
  createProject,
  deleteProjects,
  setProjectsVisibility,
} from '../../integration/projects/helpers.js';

/**
 * `projectReadPort.listNotes` — the notes of many Projects, read from another
 * module (issue #1905; `specs/186-aggregate-ports/` FR-010: reads live on the
 * aggregate's read port).
 *
 * Plain records, oldest first, one keyset page at a time, narrowed by
 * Organization, author and creation time. **The notes of an Organization are
 * the notes of every Project linked to it**, a Project of two Organizations
 * counting for both. The reach is `ProjectAccess`'s under the caller's
 * context, as for every other method: a Project out of the caller's
 * Organization reach or visibility contributes no note. A message is not a
 * note, and a deleted note is no longer one. Gated with the rest of the port.
 */
describe('projects (contract) — projectReadPort.listNotes (issue #1905)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let member: Person;
  let other: Person;
  let colleague: Person;
  let outsider: Person;
  let organizationA = '';
  let organizationB = '';
  const projects: Record<string, string> = {};
  const notes: Record<string, string> = {};

  const port = () => h.container.resolve<ProjectReadPort>('projectReadPort');
  /** Call the port as `adminUserId`, reaching every Organization or only `organizationIds`. */
  const as = <T>(adminUserId: string, body: () => Promise<T>, organizationIds?: string[]): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId },
        organizationIds === undefined
          ? { allowAll: true, allowedOrganizationIds: [] }
          : { allowAll: false, allowedOrganizationIds: organizationIds },
      ),
      body,
    );

  async function comment(
    projectId: string,
    kind: 'note' | 'message',
    body: string,
    cookies?: Record<string, string>,
  ): Promise<string> {
    const response = await callProjects(h, 'POST', `/${projectId}/comments`, {
      payload: { kind, body },
      ...(cookies ? { cookies } : {}),
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  /** Pin a comment's creation time, so the date filters have fixed instants to cut between. */
  async function createdAt(commentId: string, instant: string): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`update "project_comments" set "created_at" = ? where "id" = ?`, [instant, commentId]);
  }

  /** The ids of this file's notes in a page, in its order — other files' notes left out. */
  const ours = (page: ProjectNotePage): string[] =>
    page.items.map((note) => note.id).filter((id) => Object.values(notes).includes(id));

  beforeAll(async () => {
    h = await setupBackendServer();
    member = await seedCrmAdmin(h.em(), 'notes-member', ['projects:read']);
    other = await seedCrmAdmin(h.em(), 'notes-other', ['projects:read']);
    colleague = await seedCrmAdmin(h.em(), 'notes-colleague', ['projects:read', 'projects:write']);
    outsider = await seedCrmAdmin(h.em(), 'notes-outsider', ['crm:read']);
    await setProjectsVisibility(h, 'members');
    organizationA = await seedCrmOrganization(h.em(), 'Notes port A');
    organizationB = await seedCrmOrganization(h.em(), 'Notes port B');
    const create = async (key: string, body: Parameters<typeof createProject>[1]) => {
      projects[key] = (await createProject(h, { visibility: 'everyone', ...body })).id;
    };
    await create('a', { title: 'Notes of A', organizationIds: [organizationA] });
    await create('ab', { title: 'Notes of A and B', organizationIds: [organizationA, organizationB] });
    await create('b', { title: 'Notes of B', organizationIds: [organizationB] });
    await create('internal', { title: 'Internal notes', organizationIds: [] });
    await create('hidden', {
      title: 'Hidden notes',
      visibility: 'members_and_listed',
      organizationIds: [organizationA],
      members: [{ adminUserId: member.adminUserId, roleIds: [] }],
    });

    notes.a = await comment(projects.a!, 'note', 'On A');
    notes.ab = await comment(projects.ab!, 'note', 'On A and B', colleague.cookies);
    notes.b = await comment(projects.b!, 'note', 'On B');
    notes.internal = await comment(projects.internal!, 'note', 'Internal');
    notes.hidden = await comment(projects.hidden!, 'note', 'Hidden');
    notes.message = await comment(projects.a!, 'message', 'A message, not a note');
    notes.deleted = await comment(projects.a!, 'note', 'Deleted before anyone read it');
    const removed = await callProjects(h, 'DELETE', `/${projects.a}/comments/${notes.deleted}`);
    expect(removed.statusCode, removed.body).toBe(204);

    await createdAt(notes.a!, '2026-04-01T09:00:00.000Z');
    await createdAt(notes.ab!, '2026-04-02T09:00:00.000Z');
    await createdAt(notes.b!, '2026-04-02T12:00:00.000Z');
    await createdAt(notes.internal!, '2026-04-03T09:00:00.000Z');
    await createdAt(notes.hidden!, '2026-04-04T09:00:00.000Z');
    await createdAt(notes.message!, '2026-04-02T10:00:00.000Z');
  });

  afterAll(async () => {
    for (const person of [member, other, colleague, outsider]) person?.undo();
    await deleteProjects(h, Object.values(projects));
    await teardownBackendServer(h);
  });

  it('lists the notes of one Organization’s Projects as plain records, oldest first', async () => {
    const page = await as(member.adminUserId, () => port().listNotes({ organizationId: organizationA, limit: 10 }));
    expect(page.items.map((note) => note.id)).toEqual([notes.a, notes.ab, notes.hidden]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: notes.a,
      projectId: projects.a,
      organizationIds: [organizationA],
      author: { id: TEST_ADMIN_ID, name: expect.any(String) },
      body: 'On A',
      createdAt: new Date('2026-04-01T09:00:00.000Z'),
      editedAt: null,
      // Issue #2005 — a note is a custom-field host; this one holds no value.
      customFieldValues: {},
    });
    expect(page.items[1]?.organizationIds.slice().sort()).toEqual([organizationA, organizationB].sort());
    expect(page.items[1]?.author).toEqual({ id: colleague.adminUserId, name: expect.stringContaining('notes-colleague') });
    expect(Object.getPrototypeOf(page.items[0])).toBe(Object.prototype);
  });

  it('counts a Project of two Organizations for both, and an internal Project for neither', async () => {
    const ofB = await as(member.adminUserId, () => port().listNotes({ organizationId: organizationB, limit: 10 }));
    expect(ofB.items.map((note) => note.id)).toEqual([notes.ab, notes.b]);
    const everything = await as(member.adminUserId, () =>
      port().listNotes({ createdFrom: new Date('2026-04-01T00:00:00.000Z'), limit: PROJECT_READ_PORT_NOTES_MAX }),
    );
    expect(ours(everything)).toEqual([notes.a, notes.ab, notes.b, notes.internal, notes.hidden]);
    expect(everything.items.find((note) => note.id === notes.internal)?.organizationIds).toEqual([]);
  });

  it('lists neither a message nor a deleted note', async () => {
    const page = await as(member.adminUserId, () => port().listNotes({ limit: PROJECT_READ_PORT_NOTES_MAX }));
    const ids = page.items.map((note) => note.id);
    expect(ids).not.toContain(notes.message);
    expect(ids).not.toContain(notes.deleted);
  });

  it('narrows by author and by a creation-time range, from inclusive and before exclusive', async () => {
    const byColleague = await as(member.adminUserId, () =>
      port().listNotes({ authorAdminUserId: colleague.adminUserId, limit: 10 }),
    );
    expect(ours(byColleague)).toEqual([notes.ab]);
    const inRange = await as(member.adminUserId, () =>
      port().listNotes({
        organizationId: organizationA,
        createdFrom: new Date('2026-04-02T09:00:00.000Z'),
        createdBefore: new Date('2026-04-04T09:00:00.000Z'),
        limit: 10,
      }),
    );
    expect(inRange.items.map((note) => note.id)).toEqual([notes.ab]);
  });

  it('pages through a keyset cursor: every note once, in order, and null after the last', async () => {
    const first = await as(member.adminUserId, () => port().listNotes({ organizationId: organizationA, limit: 2 }));
    expect(first.items.map((note) => note.id)).toEqual([notes.a, notes.ab]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await as(member.adminUserId, () =>
      port().listNotes({ organizationId: organizationA, limit: 2, cursor: first.nextCursor }),
    );
    expect(second.items.map((note) => note.id)).toEqual([notes.hidden]);
    expect(second.nextCursor).toBeNull();
  });

  it('answers an empty page for a limit of 0, selects nothing for a malformed id, and refuses a forged cursor', async () => {
    const query = (q: ProjectNoteQuery) => as(member.adminUserId, () => port().listNotes(q));
    expect(await query({ organizationId: organizationA, limit: 0 })).toEqual({ items: [], nextCursor: null });
    expect((await query({ organizationId: 'not-an-id', limit: 10 })).items).toEqual([]);
    expect((await query({ authorAdminUserId: 'not-an-id', limit: 10 })).items).toEqual([]);
    expect((await query({ organizationId: organizationA, limit: 10_000 })).items.length).toBeLessThanOrEqual(
      PROJECT_READ_PORT_NOTES_MAX,
    );
    await expect(query({ cursor: 'forged', limit: 10 })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
    await expect(query({ createdBefore: new Date('not a date'), limit: 10 })).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
  });

  it('applies the visibility rule: a Project the caller may not see contributes no note', async () => {
    const page = await as(other.adminUserId, () => port().listNotes({ organizationId: organizationA, limit: 10 }));
    expect(page.items.map((note) => note.id)).toEqual([notes.a, notes.ab]);
  });

  it('applies the Organization reach: every one of a Project’s Organizations must be in reach', async () => {
    const confined = await as(member.adminUserId, () => port().listNotes({ limit: PROJECT_READ_PORT_NOTES_MAX }), [
      organizationA,
    ]);
    // A's own Project and the hidden one (a Member's); not A-and-B (B is out of
    // reach), not B's, not the internal one (it has no Organization in reach).
    expect(ours(confined)).toEqual([notes.a, notes.hidden]);
  });

  it('reads nothing for a caller who may not read Projects', async () => {
    const page = await as(outsider.adminUserId, () => port().listNotes({ organizationId: organizationA, limit: 10 }));
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('fails closed while projects is off', async () => {
    await withModuleOff('projects', 'deactivated', async () => {
      await expect(
        as(member.adminUserId, async () => port().listNotes({ organizationId: organizationA, limit: 10 })),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect((await as(member.adminUserId, () => port().listNotes({ organizationId: organizationA, limit: 10 }))).items).toHaveLength(3);
  });
});
