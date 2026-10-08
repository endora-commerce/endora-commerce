import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatOpportunityReferenceToken,
  OpportunityCommentResponseSchema,
  OpportunityDetailResponseSchema,
  OpportunityHistoryResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminNotification, AdminUser, CrmOpportunityReference } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * User Story 18 — a person mentioned in a description, a note or a message
 * (`specs/143-crm-sales-opportunities/spec.md`, FR-081, FR-083, FR-084;
 * research N-M1 … N-M6).
 */
describe('crm mentions of people (US18)', () => {
  let h: BackendServerHandle;
  let otherOrganizationId: string;
  let author: Seeded;
  let colleague: Seeded;
  let second: Seeded;
  let withoutCrm: Seeded;
  let confined: Seeded;
  let inactive: Seeded;

  const person = (seeded: Seeded): string => formatOpportunityReferenceToken('admin_user', seeded.adminUserId);
  const nameOf = async (seeded: Seeded): Promise<string> => {
    const row = await h.em().findOneOrFail(AdminUser, { id: seeded.adminUserId }, { filters: false });
    return `${row.firstName} ${row.lastName}`;
  };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = author.cookies,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detail = async (id: string, cookies: Record<string, string> = author.cookies) => {
    const response = await call('GET', `/opportunities/${id}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const write = async (
    opportunityId: string,
    kind: 'note' | 'message',
    body: string,
    cookies: Record<string, string> = author.cookies,
  ) => {
    const response = await call('POST', `/opportunities/${opportunityId}/comments`, { kind, body }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityCommentResponseSchema.parse(response.json()).data;
  };

  const editNote = async (opportunityId: string, commentId: string, body: string) => {
    const response = await call('PATCH', `/opportunities/${opportunityId}/comments/${commentId}`, { body });
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityCommentResponseSchema.parse(response.json()).data;
  };

  const describeIt = async (opportunityId: string, description: string | null) => {
    const response = await call('PATCH', `/opportunities/${opportunityId}`, { description });
    expect(response.statusCode, response.body).toBe(200);
  };

  /** The bell entries about one Opportunity, for one administrator. */
  const bell = async (seeded: Seeded, opportunityId: string) =>
    (
      await h
        .em()
        .find(
          AdminNotification,
          { targetAdminUserId: seeded.adminUserId, subjectId: opportunityId },
          { filters: false, orderBy: { createdAt: 'asc' } },
        )
    ).map((row) => ({
      kind: row.kind,
      title: row.title,
      body: row.body ?? null,
      linkPath: row.linkPath,
      // The translatable half of the entry (FR-085). Read here so that every
      // assertion over an entry — the SECRET ones first — covers its params.
      titleMessage: row.titleMessage ?? null,
      bodyMessage: row.bodyMessage ?? null,
    }));

  const mentionsOf = async (seeded: Seeded, opportunityId: string) =>
    (await bell(seeded, opportunityId)).filter((entry) => entry.kind === 'crm.opportunity.mention');

  /** An Opportunity nobody is assigned to, so the only bell entries are the ones under test. */
  const opportunity = (overrides: Record<string, unknown> = {}) =>
    createCrmOpportunity(h, { assignedAdminUserId: null, ...overrides });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Mentions other');
    author = await seedCrmAdmin(h.em(), 'mention-author', ['crm:read', 'crm:write']);
    colleague = await seedCrmAdmin(h.em(), 'mention-colleague', ['crm:read']);
    second = await seedCrmAdmin(h.em(), 'mention-second', ['crm:read', 'crm:write']);
    withoutCrm = await seedCrmAdmin(h.em(), 'mention-nocrm', ['orders:read']);
    confined = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write']);
    inactive = await seedCrmAdmin(h.em(), 'mention-inactive', ['crm:read']);
    const em = h.em();
    const row = await em.findOneOrFail(AdminUser, { id: inactive.adminUserId }, { filters: false });
    row.status = 'inactive';
    await em.flush();
  });

  afterAll(async () => {
    for (const seeded of [author, colleague, second, withoutCrm, confined, inactive]) seeded.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('as it is read', () => {
    it('resolves a person to their current name, with no link, beside a Product in the same text', async () => {
      const created = await opportunity();
      const body = `${person(colleague)} - take this over, it is about ${formatOpportunityReferenceToken('product', SEED_PRODUCT_101_ID)}`;
      const note = await write(created.id, 'note', body, CRM_ADMIN);

      expect(note.body).toBe(body);
      expect(note.references).toEqual([
        { type: 'admin_user', id: colleague.adminUserId, available: true, label: await nameOf(colleague), url: null },
        expect.objectContaining({ type: 'product', id: SEED_PRODUCT_101_ID, available: true }),
      ]);
      const stored = await h.em().find(CrmOpportunityReference, { opportunityId: created.id }, { filters: false });
      expect(stored.map((row) => `${row.sourceKind}:${row.targetType}:${row.targetId}`).sort()).toEqual(
        [`comment:admin_user:${colleague.adminUserId}`, `comment:product:${SEED_PRODUCT_101_ID}`].sort(),
      );
    });

    it('shows a deactivated person and an unknown one as unavailable — no name', async () => {
      const unknown = randomUUID();
      const created = await opportunity({
        description: `${person(inactive)} and ${formatOpportunityReferenceToken('admin_user', unknown)}`,
      });
      expect((await detail(created.id)).references).toEqual([
        { type: 'admin_user', id: inactive.adminUserId, available: false, label: null, url: null },
        { type: 'admin_user', id: unknown, available: false, label: null, url: null },
      ]);
    });

    it('names a person to a reader who holds neither orders:read nor catalog:read', async () => {
      const created = await opportunity({ description: `Ask ${person(second)}.` });
      const read = await detail(created.id, colleague.cookies);
      expect(read.references).toEqual([
        { type: 'admin_user', id: second.adminUserId, available: true, label: await nameOf(second), url: null },
      ]);
    });
  });

  describe('the notification', () => {
    it('tells a person mentioned in a note, once, by the Opportunity’s number and the author’s name — never the text', async () => {
      const created = await opportunity({ title: 'SECRET-TITLE fleet' });
      await write(created.id, 'note', `${person(colleague)} SECRET-BODY the margin is 42 percent`);

      const entries = await bell(colleague, created.id);
      expect(entries).toEqual([
        {
          kind: 'crm.opportunity.mention',
          title: `${await nameOf(author)} mentioned you in opportunity ${created.number}`,
          body: null,
          linkPath: `/crm/opportunities/${created.id}`,
          titleMessage: {
            scope: 'crm',
            key: 'notifications.mentionByAuthor.title',
            params: { author: await nameOf(author), number: created.number },
          },
          bodyMessage: null,
        },
      ]);
      expect(JSON.stringify(entries)).not.toContain('SECRET');
    });

    it('tells a person mentioned twice in one text once, and each of two people once', async () => {
      const created = await opportunity();
      await write(created.id, 'note', `${person(colleague)} ${person(second)} and again ${person(colleague)}`);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);
      expect(await mentionsOf(second, created.id)).toHaveLength(1);
    });

    it('does not tell the author who mentions themself', async () => {
      const created = await opportunity();
      await write(created.id, 'note', `Note to self ${person(author)}, and ${person(colleague)}`);
      expect(await bell(author, created.id)).toEqual([]);
      // Positive control: the same save did tell somebody.
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);
    });

    it('does not tell somebody who does not hold crm:read, nor a deactivated person', async () => {
      const created = await opportunity();
      await write(created.id, 'note', `${person(withoutCrm)} ${person(inactive)} ${person(colleague)}`);
      expect(await bell(withoutCrm, created.id)).toEqual([]);
      expect(await bell(inactive, created.id)).toEqual([]);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);
    });

    it('does not tell somebody who cannot reach the Opportunity’s Organization — and does where they can', async () => {
      const hidden = await opportunity({ organizationId: otherOrganizationId, title: 'SECRET-TITLE' });
      expect((await call('GET', `/opportunities/${hidden.id}`, undefined, confined.cookies)).statusCode).toBe(404);
      await write(hidden.id, 'note', `${person(confined)} ${person(colleague)}`);
      expect(await bell(confined, hidden.id)).toEqual([]);
      expect(await mentionsOf(colleague, hidden.id)).toHaveLength(1);

      const visible = await opportunity();
      await write(visible.id, 'note', `${person(confined)}`);
      expect(await mentionsOf(confined, visible.id)).toHaveLength(1);
    });

    it('does not tell again when a note is saved again, and tells only who an edit adds', async () => {
      const created = await opportunity();
      const note = await write(created.id, 'note', `${person(colleague)} first`);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);

      await editNote(created.id, note.id, `${person(colleague)} first, reworded`);
      await editNote(created.id, note.id, `${person(colleague)} first, reworded`);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);

      await editNote(created.id, note.id, `${person(colleague)} and now ${person(second)}`);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);
      expect(await mentionsOf(second, created.id)).toHaveLength(1);
    });

    it('tells a person mentioned in the description — on create, and on an edit that adds them, not on one that keeps them', async () => {
      const response = await call('POST', '/opportunities', {
        title: 'Mentioned at creation',
        organizationId: TEST_ORGANIZATION_ID,
        currency: 'PLN',
        assignedAdminUserId: null,
        description: `For ${person(colleague)}.`,
      });
      expect(response.statusCode, response.body).toBe(201);
      const created = OpportunityDetailResponseSchema.parse(response.json()).data;
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);

      await describeIt(created.id, `For ${person(colleague)}, and ${person(second)} as well.`);
      expect(await mentionsOf(colleague, created.id)).toHaveLength(1);
      expect(await mentionsOf(second, created.id)).toHaveLength(1);

      // An edit of another field leaves the description, and so the mentions, alone.
      const renamed = await call('PATCH', `/opportunities/${created.id}`, { title: 'Renamed' });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(await mentionsOf(second, created.id)).toHaveLength(1);

      // Taken out and put back is mentioned anew.
      await describeIt(created.id, 'Nobody.');
      await describeIt(created.id, `Back to ${person(second)}.`);
      expect(await mentionsOf(second, created.id)).toHaveLength(2);
    });

    it('a message tells a mentioned person about the mention, and not a second time as a participant', async () => {
      const created = await opportunity();
      // The colleague joins the thread, so a later message would tell them as a participant.
      await write(created.id, 'message', 'I am in.', second.cookies);
      await write(created.id, 'message', `${person(second)} over to you, ${person(colleague)}`);

      expect((await bell(second, created.id)).map((entry) => entry.kind)).toEqual(['crm.opportunity.mention']);
      expect((await bell(colleague, created.id)).map((entry) => entry.kind)).toEqual(['crm.opportunity.mention']);

      // A message that mentions nobody still tells the participants as before.
      await write(created.id, 'message', 'Any news?');
      expect((await bell(second, created.id)).map((entry) => entry.kind)).toEqual([
        'crm.opportunity.mention',
        'crm.opportunity.message',
      ]);
    });

    it('a message tells a participant it mentions, but may not address as one, about the message as before', async () => {
      // Whoever is assigned is in the conversation, whatever their role lets
      // them read. A mention of them tells nobody — no crm:read — and must not
      // take their message entry away with it: the mention stands instead of it
      // only for somebody the mention actually reached.
      const created = await opportunity({ assignedAdminUserId: withoutCrm.adminUserId });
      const before = (await bell(withoutCrm, created.id)).length;
      await write(created.id, 'message', `${person(withoutCrm)} are you there?`);
      expect((await bell(withoutCrm, created.id)).slice(before).map((entry) => entry.kind)).toEqual([
        'crm.opportunity.message',
      ]);
    });

    it('a bell that cannot be written costs no save its text — a note, its edit, a message, a description', async () => {
      type RecordPort = { record: (input: unknown) => Promise<unknown> };
      /** `admin_notifications`' port answering with a failure for as long as `work` runs. */
      const withTheBellFailing = async <T>(work: () => Promise<T>): Promise<{ result: T; asked: number }> => {
        const port = h.container.resolve<RecordPort>('adminNotificationRecordPort');
        const original = port.record;
        let asked = 0;
        port.record = async () => {
          asked += 1;
          throw new Error('bell store unavailable');
        };
        try {
          return { result: await work(), asked };
        } finally {
          port.record = original;
        }
      };
      const created = await opportunity();

      const added = await withTheBellFailing(() =>
        call('POST', `/opportunities/${created.id}/comments`, { kind: 'note', body: `${person(colleague)} one` }),
      );
      expect(added.asked, 'the control: the bell was asked, and failed').toBe(1);
      expect(added.result.statusCode, added.result.body).toBe(201);
      const noteId = OpportunityCommentResponseSchema.parse(added.result.json()).data.id;

      const edited = await withTheBellFailing(() =>
        call('PATCH', `/opportunities/${created.id}/comments/${noteId}`, {
          body: `${person(colleague)} one, and ${person(second)}`,
        }),
      );
      expect(edited.asked).toBe(1);
      expect(edited.result.statusCode, edited.result.body).toBe(200);
      expect(OpportunityCommentResponseSchema.parse(edited.result.json()).data.body).toContain(person(second));

      // A message whose mention could not be written still tries its participants.
      await write(created.id, 'message', 'I am in.', second.cookies);
      const sent = await withTheBellFailing(() =>
        call('POST', `/opportunities/${created.id}/comments`, { kind: 'message', body: `${person(second)} over to you` }),
      );
      expect(sent.asked, 'once as the mention, once as the participant').toBe(2);
      expect(sent.result.statusCode, sent.result.body).toBe(201);

      const described = await withTheBellFailing(() =>
        call('PATCH', `/opportunities/${created.id}`, { description: `For ${person(colleague)}.` }),
      );
      expect(described.asked).toBe(1);
      expect(described.result.statusCode, described.result.body).toBe(200);
      expect((await detail(created.id)).description).toBe(`For ${person(colleague)}.`);

      const createdWith = await withTheBellFailing(() =>
        call('POST', '/opportunities', {
          title: 'Mentioned with the bell down',
          organizationId: TEST_ORGANIZATION_ID,
          currency: 'PLN',
          assignedAdminUserId: null,
          description: `For ${person(colleague)}.`,
        }),
      );
      expect(createdWith.asked).toBe(1);
      expect(createdWith.result.statusCode, createdWith.result.body).toBe(201);

      // Nothing was written into the bell by any of it.
      expect(await bell(colleague, created.id)).toEqual([]);
    });

    it('is still stored, and tells nobody, while admin_notifications is deactivated', async () => {
      const created = await opportunity();
      await withModuleOff('admin_notifications', 'deactivated', async () => {
        const response = await call('POST', `/opportunities/${created.id}/comments`, {
          kind: 'note',
          body: `${person(colleague)} while the bell is off`,
        });
        expect(response.statusCode, response.body).toBe(201);
      });
      expect(await bell(colleague, created.id)).toEqual([]);
    });
  });

  describe('in the change history', () => {
    it('carries what the tokens of a changed description name, for the reader', async () => {
      const created = await opportunity({ description: `Ask ${person(colleague)}.` });
      await describeIt(created.id, `Ask ${person(second)} about ${formatOpportunityReferenceToken('product', SEED_PRODUCT_101_ID)}.`);

      const response = await call('GET', `/opportunities/${created.id}/history`, undefined, colleague.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const entries = OpportunityHistoryResponseSchema.parse(response.json()).data;
      const edit = entries.find((entry) => entry.action === 'crm.opportunity.update');
      expect(edit?.references).toEqual(
        expect.arrayContaining([
          { type: 'admin_user', id: colleague.adminUserId, available: true, label: await nameOf(colleague), url: null },
          { type: 'admin_user', id: second.adminUserId, available: true, label: await nameOf(second), url: null },
          // This reader holds no catalog:read: the Product is mentioned, and not named.
          { type: 'product', id: SEED_PRODUCT_101_ID, available: false, label: null, url: null },
        ]),
      );
      expect(edit?.references).toHaveLength(3);
      // The creation carries the references of the description it arrived with.
      const other = entries.find((entry) => entry.action === 'crm.opportunity.create');
      expect(other?.references).toEqual([
        { type: 'admin_user', id: colleague.adminUserId, available: true, label: await nameOf(colleague), url: null },
      ]);
    });
  });
});
