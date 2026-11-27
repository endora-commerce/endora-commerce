import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_READ_PORT_NOTES_MAX,
  type OpportunityNotePage,
  type OpportunityNoteQuery,
  type OpportunityReadPort,
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
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
} from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `opportunityReadPort.listNotes` — the notes of many Opportunities, read from
 * another module (issue #1905; `specs/186-aggregate-ports/` FR-010: reads live
 * on the aggregate's read port).
 *
 * Plain records, oldest first, one keyset page at a time, narrowed by
 * Organization, author and creation time, under the **caller's** tenant scope —
 * the reach every other method of the port has. A message is not a note and a
 * deleted note is no longer one. Gated with the rest of the port.
 */
describe('crm — opportunityReadPort.listNotes (issue #1905)', () => {
  let h: BackendServerHandle;
  let organizationA = '';
  let organizationB = '';
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const notes: Record<string, string> = {};
  let opportunityA1 = '';
  let opportunityA2 = '';
  let opportunityB1 = '';

  const port = () => h.container.resolve<OpportunityReadPort>('opportunityReadPort');
  const asPlatform = <T>(body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext({ kind: 'admin', adminUserId: TEST_ADMIN_ID }, { allowAll: true, allowedOrganizationIds: [] }),
      body,
    );
  const confinedTo = <T>(organizationIds: string[], body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId: TEST_ADMIN_ID },
        { allowAll: false, allowedOrganizationIds: organizationIds },
      ),
      body,
    );

  async function comment(
    opportunityId: string,
    kind: 'note' | 'message',
    body: string,
    cookies: Record<string, string> = CRM_ADMIN,
  ): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: `${CRM_API}/opportunities/${opportunityId}/comments`,
      cookies,
      payload: { kind, body },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  /** Pin a comment's creation time, so the date filters have fixed instants to cut between. */
  async function createdAt(commentId: string, instant: string): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(`update "crm_opportunity_comments" set "created_at" = ? where "id" = ?`, [instant, commentId]);
  }

  /** Every page of a query, walked through its cursors. */
  async function walk(query: Omit<OpportunityNoteQuery, 'cursor'>, as = asPlatform): Promise<OpportunityNotePage[]> {
    const pages: OpportunityNotePage[] = [];
    let cursor: string | null = null;
    do {
      const page: OpportunityNotePage = await as(() => port().listNotes({ ...query, cursor }));
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor !== null && pages.length < 10);
    return pages;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Notes A');
    organizationB = await seedCrmOrganization(h.em(), 'Notes B');
    colleague = await seedCrmAdmin(h.em(), 'notes-colleague', ['crm:read', 'crm:write']);
    opportunityA1 = (await createCrmOpportunity(h, { organizationId: organizationA, title: 'Notes A1' })).id;
    opportunityA2 = (await createCrmOpportunity(h, { organizationId: organizationA, title: 'Notes A2' })).id;
    opportunityB1 = (await createCrmOpportunity(h, { organizationId: organizationB, title: 'Notes B1' })).id;

    notes.a1First = await comment(opportunityA1, 'note', 'First on A1');
    notes.a2Colleague = await comment(opportunityA2, 'note', 'The colleague on A2', colleague.cookies);
    notes.a1Second = await comment(opportunityA1, 'note', 'Second on A1');
    notes.b1 = await comment(opportunityB1, 'note', 'On B1');
    notes.message = await comment(opportunityA1, 'message', 'A message, not a note');
    notes.deleted = await comment(opportunityA2, 'note', 'Deleted before anyone read it');
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${CRM_API}/opportunities/${opportunityA2}/comments/${notes.deleted}`,
      cookies: CRM_ADMIN,
    });
    expect(removed.statusCode, removed.body).toBe(204);

    await createdAt(notes.a1First, '2026-03-01T09:00:00.000Z');
    await createdAt(notes.a2Colleague, '2026-03-02T09:00:00.000Z');
    await createdAt(notes.a1Second, '2026-03-03T09:00:00.000Z');
    await createdAt(notes.b1, '2026-03-02T12:00:00.000Z');
    await createdAt(notes.message, '2026-03-02T10:00:00.000Z');
  });

  afterAll(async () => {
    colleague?.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('lists the notes of one Organization’s Opportunities as plain records, oldest first', async () => {
    const page = await asPlatform(() => port().listNotes({ organizationId: organizationA, limit: 10 }));
    expect(page.items.map((note) => note.id)).toEqual([notes.a1First, notes.a2Colleague, notes.a1Second]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: notes.a1First,
      opportunityId: opportunityA1,
      organizationId: organizationA,
      author: { id: TEST_ADMIN_ID, name: expect.any(String) },
      body: 'First on A1',
      createdAt: new Date('2026-03-01T09:00:00.000Z'),
      editedAt: null,
      // Issue #2005 — a note is a custom-field host; this one holds no value.
      customFieldValues: {},
    });
    expect(page.items[1]?.author).toEqual({ id: colleague.adminUserId, name: expect.stringContaining('notes-colleague') });
    expect(Object.getPrototypeOf(page.items[0])).toBe(Object.prototype);
  });

  it('lists neither a message nor a deleted note', async () => {
    const page = await asPlatform(() => port().listNotes({ organizationId: organizationA, limit: 10 }));
    expect(page.items.map((note) => note.id)).not.toContain(notes.message);
    expect(page.items.map((note) => note.id)).not.toContain(notes.deleted);
  });

  it('narrows by author and by a creation-time range, from inclusive and before exclusive', async () => {
    const byColleague = await asPlatform(() =>
      port().listNotes({ organizationId: organizationA, authorAdminUserId: colleague.adminUserId, limit: 10 }),
    );
    expect(byColleague.items.map((note) => note.id)).toEqual([notes.a2Colleague]);

    const inRange = await asPlatform(() =>
      port().listNotes({
        organizationId: organizationA,
        createdFrom: new Date('2026-03-02T09:00:00.000Z'),
        createdBefore: new Date('2026-03-03T09:00:00.000Z'),
        limit: 10,
      }),
    );
    expect(inRange.items.map((note) => note.id)).toEqual([notes.a2Colleague]);

    const acrossOrganizations = await asPlatform(() =>
      port().listNotes({
        createdFrom: new Date('2026-03-01T00:00:00.000Z'),
        createdBefore: new Date('2026-03-04T00:00:00.000Z'),
        limit: 10,
      }),
    );
    const ours = acrossOrganizations.items.map((note) => note.id).filter((id) => Object.values(notes).includes(id));
    expect(ours).toEqual([notes.a1First, notes.a2Colleague, notes.b1, notes.a1Second]);
  });

  it('pages through a keyset cursor: every note once, in order, and null after the last', async () => {
    const pages = await walk({ organizationId: organizationA, limit: 2 });
    expect(pages.map((page) => page.items.length)).toEqual([2, 1]);
    expect(pages.flatMap((page) => page.items.map((note) => note.id))).toEqual([
      notes.a1First,
      notes.a2Colleague,
      notes.a1Second,
    ]);
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it('answers an empty page for a limit of 0 and bounds a larger one', async () => {
    expect(await asPlatform(() => port().listNotes({ organizationId: organizationA, limit: 0 }))).toEqual({
      items: [],
      nextCursor: null,
    });
    const page = await asPlatform(() => port().listNotes({ organizationId: organizationA, limit: 10_000 }));
    expect(page.items.length).toBeLessThanOrEqual(OPPORTUNITY_READ_PORT_NOTES_MAX);
  });

  it('selects nothing for a malformed id, and refuses a cursor it did not issue', async () => {
    expect((await asPlatform(() => port().listNotes({ organizationId: 'not-an-id', limit: 10 }))).items).toEqual([]);
    expect((await asPlatform(() => port().listNotes({ authorAdminUserId: 'not-an-id', limit: 10 }))).items).toEqual(
      [],
    );
    await expect(asPlatform(() => port().listNotes({ cursor: 'forged', limit: 10 }))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
    await expect(
      asPlatform(() => port().listNotes({ createdFrom: new Date('not a date'), limit: 10 })),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' });
  });

  it('reads under the caller’s scope: an Organization out of reach contributes no note', async () => {
    // Positive control: the platform administrator reads B's note.
    expect((await asPlatform(() => port().listNotes({ organizationId: organizationB, limit: 10 }))).items).toHaveLength(1);

    expect((await confinedTo([organizationA], () => port().listNotes({ organizationId: organizationB, limit: 10 }))).items).toEqual([]);
    const unfiltered = await walk({ limit: OPPORTUNITY_READ_PORT_NOTES_MAX }, (body) => confinedTo([organizationA], body));
    const seen = unfiltered.flatMap((page) => page.items);
    expect(seen.map((note) => note.id)).toEqual(expect.arrayContaining([notes.a1First, notes.a2Colleague, notes.a1Second]));
    expect(seen.every((note) => note.organizationId === organizationA)).toBe(true);
  });

  it('fails closed while crm is off, and answers again afterwards', async () => {
    await withModuleOff('crm', 'deactivated', async () => {
      await expect(
        asPlatform(async () => port().listNotes({ organizationId: organizationA, limit: 10 })),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    });
    expect((await asPlatform(() => port().listNotes({ organizationId: organizationA, limit: 10 }))).items).toHaveLength(3);
  });
});
