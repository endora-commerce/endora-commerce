import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityAttachmentResponseSchema,
  OpportunityCommentResponseSchema,
  OpportunityDetailResponseSchema,
  OpportunityUnreadMessagesResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import { createCrmEvent, seedCrmEventRow, timedEventBody } from '../../helpers/seed-crm-events.js';

type Admin = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

/**
 * The numbers the tabs of an Opportunity carry on their labels, as members of
 * the detail read — so the tab strip is drawn from one request and no tab has
 * to be opened for its number to be known.
 *
 * Two kinds, held separately because they are different facts:
 *
 * - **how many there are** — notes and attachments: what the tab lists, counted
 *   in the database (a deleted note and a message are not notes). The same for
 *   everybody who may read the Opportunity;
 * - **how many one person has not read** — messages: the reader's own number,
 *   moved by the reader's own marker and by nobody else's.
 *
 * Both are the detail's, so whoever is refused the Opportunity is told nothing
 * about either and can write no marker for it (Constitution XI).
 */
describe('crm opportunity tab counts', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  let rep: Admin;
  /** Two colleagues who may write, and one who may only read. */
  let anna: Admin;
  let bartek: Admin;
  let reader: Admin;
  let outsider: Admin;
  const assets: string[] = [];
  const MISSING = '00000000-0000-4000-8000-00000000dead';

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const detailOf = async (opportunityId: string, cookies: Record<string, string> = CRM_ADMIN) => {
    const response = await call('GET', `/opportunities/${opportunityId}`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityDetailResponseSchema.parse(response.json()).data;
  };

  const unread = async (opportunityId: string, who: Admin) =>
    (await detailOf(opportunityId, who.cookies)).unreadMessageCount;

  const comment = async (
    opportunityId: string,
    kind: 'note' | 'message',
    body: string,
    cookies: Record<string, string> = CRM_ADMIN,
  ) => {
    const response = await call('POST', `/opportunities/${opportunityId}/comments`, { kind, body }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityCommentResponseSchema.parse(response.json()).data;
  };

  const markRead = (opportunityId: string, throughMessageId: unknown, who: Admin) =>
    call('POST', `/opportunities/${opportunityId}/messages/read`, { throughMessageId }, who.cookies);

  const markers = async (opportunityId: string): Promise<string[]> => {
    const rows = (await h.orm.em
      .getConnection()
      .execute(`select "admin_user_id" from "crm_opportunity_message_reads" where "opportunity_id" = ?`, [
        opportunityId,
      ])) as Array<{ admin_user_id: string }>;
    return rows.map((row) => row.admin_user_id).sort();
  };

  const attach = async (opportunityId: string) => {
    const asset = await seedCrmAsset(h.em());
    assets.push(asset.id);
    const response = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId: asset.id });
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityAttachmentResponseSchema.parse(response.json()).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Counts A');
    organizationB = await seedCrmOrganization(h.em(), 'Counts B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write']);
    anna = await seedCrmAdmin(h.em(), 'counts-anna', ['crm:read', 'crm:write']);
    bartek = await seedCrmAdmin(h.em(), 'counts-bartek', ['crm:read', 'crm:write']);
    reader = await seedCrmAdmin(h.em(), 'counts-reader', ['crm:read']);
    outsider = await seedCrmAdmin(h.em(), 'counts-outsider', ['orders:read']);
  });

  afterAll(async () => {
    for (const admin of [rep, anna, bartek, reader, outsider]) admin.undo();
    await removeCrmAssets(h.em(), assets);
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('how many there are — notes and attachments', () => {
    it('a new Opportunity counts nothing', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Counts: empty' });
      expect(await detailOf(opportunity.id)).toMatchObject({
        noteCount: 0,
        attachmentCount: 0,
        unreadMessageCount: 0,
        upcomingEventCount: 0,
      });
    });

    it('counts notes as the Notes tab lists them — not a message, and not a deleted note', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Counts: notes' });
      const first = await comment(opportunity.id, 'note', 'Asked for a second offer.');
      await comment(opportunity.id, 'note', 'Budget confirmed.');
      await comment(opportunity.id, 'message', 'Who takes the call on Monday?');
      expect((await detailOf(opportunity.id)).noteCount).toBe(2);

      const removed = await call('DELETE', `/opportunities/${opportunity.id}/comments/${first.id}`);
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await detailOf(opportunity.id)).noteCount).toBe(1);
    });

    it('counts attachments, and one fewer once a file is removed', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Counts: attachments' });
      const first = await attach(opportunity.id);
      await attach(opportunity.id);
      expect((await detailOf(opportunity.id)).attachmentCount).toBe(2);

      const removed = await call('DELETE', `/opportunities/${opportunity.id}/attachments/${first.id}`);
      expect(removed.statusCode, removed.body).toBe(204);
      expect((await detailOf(opportunity.id)).attachmentCount).toBe(1);
    });

    it('leaves the Events tab its own number — the Events not ended yet — and puts no total on the wire', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Counts: events' });
      await createCrmEvent(h, opportunity.id, timedEventBody('2031-06-10'));
      await seedCrmEventRow(h.em(), opportunity.id, {
        startsAt: new Date('2020-01-10T08:00:00.000Z'),
        endsAt: new Date('2020-01-10T09:00:00.000Z'),
      });
      const response = await call('GET', `/opportunities/${opportunity.id}`);
      const data = (response.json() as { data: Record<string, unknown> }).data;
      expect(data['upcomingEventCount']).toBe(1);
      expect(data).not.toHaveProperty('eventCount');
    });

    it('keeps one Opportunity’s counts out of another’s', async () => {
      const counted = await createCrmOpportunity(h, { title: 'Counts: mine' });
      const other = await createCrmOpportunity(h, { title: 'Counts: not mine' });
      await comment(counted.id, 'note', 'Only here.');
      await comment(counted.id, 'message', 'Only here either.', anna.cookies);
      await attach(counted.id);
      expect(await detailOf(other.id)).toMatchObject({ noteCount: 0, attachmentCount: 0, unreadMessageCount: 0 });
      expect(await detailOf(counted.id)).toMatchObject({ noteCount: 1, attachmentCount: 1, unreadMessageCount: 1 });
    });
  });

  describe('how many one administrator has not read — messages', () => {
    it('counts the messages somebody else wrote, never one’s own, and never a note', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: whose' });
      await comment(opportunity.id, 'message', 'Anna, first.', anna.cookies);
      await comment(opportunity.id, 'message', 'Anna, second.', anna.cookies);
      await comment(opportunity.id, 'message', 'Bartek answers.', bartek.cookies);
      await comment(opportunity.id, 'note', 'A note is not a message.', anna.cookies);

      expect(await unread(opportunity.id, anna)).toBe(1);
      expect(await unread(opportunity.id, bartek)).toBe(2);
      // Somebody who wrote nothing has all three to read — the reader without crm:write too.
      expect(await unread(opportunity.id, reader)).toBe(3);
    });

    it('is cleared by reading, for the reader alone: Bartek’s reading leaves Anna’s number where it was', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: two readers' });
      await comment(opportunity.id, 'message', 'From the platform administrator.');
      const last = await comment(opportunity.id, 'message', 'And another.');
      expect(await unread(opportunity.id, anna)).toBe(2);
      expect(await unread(opportunity.id, bartek)).toBe(2);

      const marked = await markRead(opportunity.id, last.id, bartek);
      expect(marked.statusCode, marked.body).toBe(200);
      expect(OpportunityUnreadMessagesResponseSchema.parse(marked.json()).data).toEqual({ unreadMessageCount: 0 });

      expect(await unread(opportunity.id, bartek)).toBe(0);
      expect(await unread(opportunity.id, anna)).toBe(2);
      expect(await markers(opportunity.id)).toEqual([bartek.adminUserId]);
    });

    it('lets somebody who may only read mark what they read — `crm:read` is the whole gate', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: reader' });
      const message = await comment(opportunity.id, 'message', 'For everybody.');
      expect(await unread(opportunity.id, reader)).toBe(1);
      // The control: the same person may not write.
      const refused = await call('POST', `/opportunities/${opportunity.id}/comments`, { kind: 'message', body: 'No.' }, reader.cookies);
      expect(refused.statusCode, refused.body).toBe(403);

      const marked = await markRead(opportunity.id, message.id, reader);
      expect(marked.statusCode, marked.body).toBe(200);
      expect(await unread(opportunity.id, reader)).toBe(0);
    });

    it('reads up to the message named and no further: what arrives afterwards is unread again', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: afterwards' });
      const first = await comment(opportunity.id, 'message', 'One.');
      const second = await comment(opportunity.id, 'message', 'Two.');

      // Reading up to the first leaves the second.
      const partly = await markRead(opportunity.id, first.id, anna);
      expect(OpportunityUnreadMessagesResponseSchema.parse(partly.json()).data).toEqual({ unreadMessageCount: 1 });
      await markRead(opportunity.id, second.id, anna);
      expect(await unread(opportunity.id, anna)).toBe(0);

      await comment(opportunity.id, 'message', 'Three.');
      expect(await unread(opportunity.id, anna)).toBe(1);
    });

    it('never moves a marker backwards — an older tab answering late un-reads nothing', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: backwards' });
      const first = await comment(opportunity.id, 'message', 'One.');
      const second = await comment(opportunity.id, 'message', 'Two.');
      await markRead(opportunity.id, second.id, anna);
      const late = await markRead(opportunity.id, first.id, anna);
      expect(late.statusCode, late.body).toBe(200);
      expect(OpportunityUnreadMessagesResponseSchema.parse(late.json()).data).toEqual({ unreadMessageCount: 0 });
      expect(await markers(opportunity.id)).toEqual([anna.adminUserId]);
    });

    it('takes a marker from the stored instant of the message, so a message is never left unread by its own microseconds', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: precision' });
      const message = await comment(opportunity.id, 'message', 'Stored to the microsecond.');
      // What no request writes and a database may hold: an instant finer than a millisecond.
      await h.orm.em
        .getConnection()
        .execute(
          `update "crm_opportunity_comments" set "created_at" = date_trunc('milliseconds', "created_at") + interval '777 microseconds' where "id" = ?`,
          [message.id],
        );
      await markRead(opportunity.id, message.id, anna);
      expect(await unread(opportunity.id, anna)).toBe(0);
    });

    it('counts, for somebody with no marker, only what was written since unread messages are counted at all', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: before the count existed' });
      const old = await comment(opportunity.id, 'message', 'Written before the migration.');
      await comment(opportunity.id, 'message', 'Written after it.');
      // Move the first one to before the instant the migration recorded.
      await h.orm.em
        .getConnection()
        .execute(
          `update "crm_opportunity_comments"
              set "created_at" = (select "unread_since" - interval '1 day' from "crm_message_read_baselines" where "id" = 1)
            where "id" = ?`,
          [old.id],
        );
      expect(await unread(opportunity.id, anna)).toBe(1);
    });

    it('refuses a marker that names no message of this Opportunity — a note, another Opportunity’s message, nothing', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: wrong message' });
      const other = await createCrmOpportunity(h, { title: 'Unread: the other one' });
      await comment(opportunity.id, 'message', 'Here.');
      const note = await comment(opportunity.id, 'note', 'A note.');
      const elsewhere = await comment(other.id, 'message', 'There.');

      for (const [what, id] of [['a note', note.id], ['another Opportunity’s message', elsewhere.id], ['nothing', MISSING]] as const) {
        const response = await markRead(opportunity.id, id, anna);
        expect(response.statusCode, `${what}: ${response.body}`).toBe(404);
      }
      const malformed = await markRead(opportunity.id, 'yesterday', anna);
      expect(malformed.statusCode, malformed.body).toBe(400);
      expect(await markers(opportunity.id)).toEqual([]);
      expect(await unread(opportunity.id, anna)).toBe(1);
    });

    it('is not a change to the Opportunity: reading leaves its change history and its version as they were', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: no trace' });
      const message = await comment(opportunity.id, 'message', 'Read me.');
      const historyOf = async () => (await call('GET', `/opportunities/${opportunity.id}/history`)).body;
      const audited = async () =>
        (
          (await h.orm.em
            .getConnection()
            .execute(`select count(*)::int as n from "audit_log_entries" where "object_id" = ?`, [opportunity.id])) as Array<{
            n: number;
          }>
        )[0]?.n;
      const before = { history: await historyOf(), audited: await audited(), version: (await detailOf(opportunity.id)).version };
      expect(before.audited).toBeGreaterThan(0);

      const marked = await markRead(opportunity.id, message.id, anna);
      expect(marked.statusCode, marked.body).toBe(200);

      expect(await historyOf()).toBe(before.history);
      expect(await audited()).toBe(before.audited);
      expect((await detailOf(opportunity.id)).version).toBe(before.version);
    });

    it('goes with the Opportunity: deleting it leaves no marker behind', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Unread: deleted' });
      const message = await comment(opportunity.id, 'message', 'Soon gone.');
      await markRead(opportunity.id, message.id, anna);
      expect(await markers(opportunity.id)).toEqual([anna.adminUserId]);
      const removed = await call('DELETE', `/opportunities/${opportunity.id}`);
      expect(removed.statusCode, removed.body).toBe(204);
      expect(await markers(opportunity.id)).toEqual([]);
    });
  });

  describe('who is told, and who may write a marker (Constitution XI)', () => {
    it('tells a Sales Representative nothing about an Opportunity of an Organization that is not theirs, and writes no marker for it', async () => {
      const mine = await createCrmOpportunity(h, { title: 'Counts: A', organizationId: organizationA });
      const theirs = await createCrmOpportunity(h, { title: 'Counts: B', organizationId: organizationB });
      const messages: Record<string, string> = {};
      for (const opportunity of [mine, theirs]) {
        await comment(opportunity.id, 'note', 'A note.');
        messages[opportunity.id] = (await comment(opportunity.id, 'message', 'A message.')).id;
        await attach(opportunity.id);
      }

      // The positive control: the same person reads the numbers of their own
      // Organization's Opportunity, and marks its messages read.
      expect(await detailOf(mine.id, rep.cookies)).toMatchObject({
        noteCount: 1,
        attachmentCount: 1,
        unreadMessageCount: 1,
      });
      const own = await markRead(mine.id, messages[mine.id], rep);
      expect(own.statusCode, own.body).toBe(200);
      expect(await unread(mine.id, rep)).toBe(0);

      const refused = await call('GET', `/opportunities/${theirs.id}`, undefined, rep.cookies);
      expect(refused.statusCode, refused.body).toBe(404);
      const body = refused.json() as { error: { code: string }; data?: unknown };
      expect(body.error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect(body.data).toBeUndefined();
      expect(refused.body).not.toMatch(/Count/);

      // Neither with the real id of its message, nor by naming their own message under its id.
      for (const messageId of [messages[theirs.id], messages[mine.id]]) {
        const marking = await markRead(theirs.id, messageId, rep);
        expect(marking.statusCode, marking.body).toBe(404);
        expect((marking.json() as { error: { code: string } }).error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      }
      // Nor the other way round: B's message named under their own Opportunity.
      const smuggled = await markRead(mine.id, messages[theirs.id], rep);
      expect(smuggled.statusCode, smuggled.body).toBe(404);
      expect(await markers(theirs.id)).toEqual([]);

      // And the platform administrator still reads them, so the 404 was a refusal.
      expect(await detailOf(theirs.id)).toMatchObject({ noteCount: 1, attachmentCount: 1 });
    });

    it('is behind the gates of the module: no session is 401, and no `crm:read` is 403 — for the count and for the marker', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Counts: gated' });
      const message = await comment(opportunity.id, 'message', 'Gated.');
      const anonymous = { read: `${CRM_API}/opportunities/${opportunity.id}`, mark: `${CRM_API}/opportunities/${opportunity.id}/messages/read` };
      expect((await h.app.inject({ method: 'GET', url: anonymous.read })).statusCode).toBe(401);
      expect(
        (await h.app.inject({ method: 'POST', url: anonymous.mark, payload: { throughMessageId: message.id } })).statusCode,
      ).toBe(401);

      expect((await call('GET', `/opportunities/${opportunity.id}`, undefined, outsider.cookies)).statusCode).toBe(403);
      expect((await markRead(opportunity.id, message.id, outsider)).statusCode).toBe(403);
      expect(await markers(opportunity.id)).toEqual([]);
    });
  });
});
