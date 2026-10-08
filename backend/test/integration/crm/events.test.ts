import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENTS_MAX_RESULTS,
  OpportunityDetailResponseSchema,
  OpportunityEventListResponseSchema,
  OpportunityEventResponseSchema,
  OpportunityHistoryResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrganization,
  seedCrmSalesRep,
  transitionCrmOpportunity,
} from '../../helpers/seed-crm.js';
import { countStatements } from '../../helpers/seed-crm-analytics.js';
import {
  createCrmEvent,
  crmEventReminderRow,
  readCrmCalendar,
  seedCrmEventRow,
  timedEventBody,
} from '../../helpers/seed-crm-events.js';

/**
 * Events on an Opportunity and the Calendar, against a real database
 * (`specs/143-crm-sales-opportunities/spec.md` User Stories 21 and 22;
 * FR-130 – FR-136, FR-143 – FR-145, FR-151; research N-CAL2 – N-CAL4, N-CAL8,
 * N-CAL11).
 *
 * Two readers throughout, because the Calendar answers them differently by
 * design: the platform administrator reaches every Organization and is offered
 * *All* and *Mine*; a Sales Representative is confined to the Organizations
 * they are assigned to and is answered *Mine* whatever they ask.
 *
 * Every Calendar case reads a window of its own, far from the others, so the
 * cases neither see each other's Events nor depend on the day the suite runs.
 */
describe('crm events and the calendar', () => {
  let h: BackendServerHandle;
  let organizationA: string;
  let organizationB: string;
  /** A Sales Rep of Organization A. */
  let rep: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Another Sales Rep of Organization A — a colleague in a shared Organization. */
  let colleague: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  /** Holds `crm:read` and `crm:write`, and reaches every Organization. */
  let writer: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookies: Record<string, string>,
    payload?: unknown,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const expectOpportunityNotFound = (response: { statusCode: number; body: string; json(): unknown }, what: string) => {
    expect(response.statusCode, `${what}: ${response.body}`).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code, what).toBe('CRM_OPPORTUNITY_NOT_FOUND');
  };

  const assign = async (opportunityId: string, adminUserId: string | null) => {
    const response = await call('POST', `/opportunities/${opportunityId}/assign`, CRM_ADMIN, { adminUserId });
    expect(response.statusCode, response.body).toBe(200);
  };

  const historyOf = async (opportunityId: string) => {
    const response = await call('GET', `/opportunities/${opportunityId}/history`, CRM_ADMIN);
    expect(response.statusCode, response.body).toBe(200);
    return OpportunityHistoryResponseSchema.parse(response.json()).data;
  };

  const idsOn = async (
    window: { from: string; to: string },
    cookies: Record<string, string>,
    scope?: string,
  ): Promise<string[]> => (await readCrmCalendar(h, { ...window, ...(scope ? { scope } : {}) }, cookies)).data.map((event) => event.id);

  /** A month of its own for one case: `[YYYY-MM-01, the 1st of the next month)`. */
  const month = (year: number, monthNumber: number) => ({
    from: new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year, monthNumber, 1)).toISOString(),
    day: (day: number) => `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationA = await seedCrmOrganization(h.em(), 'Events A');
    organizationB = await seedCrmOrganization(h.em(), 'Events B');
    rep = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write', 'orders:read']);
    colleague = await seedCrmSalesRep(h.em(), [organizationA], ['crm:read', 'crm:write', 'orders:read']);
    writer = await seedCrmAdmin(h.em(), 'event-writer', ['crm:read', 'crm:write', 'orders:read']);
  });

  afterAll(async () => {
    rep.undo();
    colleague.undo();
    writer.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('on the Opportunity', () => {
    it('add, edit and delete each leave one history entry with the name and times, and never the description', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const before = (await historyOf(opportunity.id)).length;
      const SECRET = 'The buyer will accept 4 % under list.';

      const event = await createCrmEvent(
        h,
        opportunity.id,
        timedEventBody('2031-06-10', { name: 'Price talk', description: SECRET }),
      );
      const patched = await call('PATCH', `/opportunities/${opportunity.id}/events/${event.id}`, CRM_ADMIN, {
        name: 'Price talk, round two',
        startsAt: '2031-06-10T10:00:00.000Z',
        endsAt: '2031-06-10T11:00:00.000Z',
        description: `${SECRET} Confirmed.`,
      });
      expect(patched.statusCode, patched.body).toBe(200);
      const removed = await call('DELETE', `/opportunities/${opportunity.id}/events/${event.id}`, CRM_ADMIN);
      expect(removed.statusCode, removed.body).toBe(204);

      const history = await historyOf(opportunity.id);
      const written = history.slice(0, history.length - before).reverse();
      expect(written.map((entry) => entry.action)).toEqual([
        'crm.opportunity.event_add',
        'crm.opportunity.event_update',
        'crm.opportunity.event_remove',
      ]);
      for (const entry of written) expect(entry.actor).toMatchObject({ kind: 'admin', id: TEST_ADMIN_ID });

      expect(written[0]?.before).toBeNull();
      expect(written[0]?.after).toMatchObject({
        eventId: event.id,
        eventName: 'Price talk',
        allDay: false,
        startsAt: '2031-06-10T08:00:00.000Z',
        endsAt: '2031-06-10T09:00:00.000Z',
        remindAt: null,
      });
      expect(written[1]?.before).toMatchObject({ eventName: 'Price talk', startsAt: '2031-06-10T08:00:00.000Z' });
      expect(written[1]?.after).toMatchObject({
        eventName: 'Price talk, round two',
        startsAt: '2031-06-10T10:00:00.000Z',
        endsAt: '2031-06-10T11:00:00.000Z',
      });
      expect(written[2]?.before).toMatchObject({ eventId: event.id, eventName: 'Price talk, round two' });
      expect(written[2]?.after).toMatchObject({ eventId: event.id, deleted: true });

      // The description is the Opportunity's reader's, and the audit trail is
      // not tenant-scoped: the record says a description was written and how
      // long it was — never what it says.
      expect(JSON.stringify(written)).not.toContain('4 %');
      expect(JSON.stringify(written)).not.toContain('Confirmed');
      expect(written[0]?.after).toMatchObject({ length: SECRET.length });
    });

    it('an edit that changes nothing writes no history entry', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const event = await createCrmEvent(h, opportunity.id, timedEventBody('2031-06-10'));
      const before = (await historyOf(opportunity.id)).length;
      const same = await call('PATCH', `/opportunities/${opportunity.id}/events/${event.id}`, CRM_ADMIN, {
        name: event.name,
        startsAt: event.startsAt,
      });
      expect(same.statusCode, same.body).toBe(200);
      expect((await historyOf(opportunity.id)).length).toBe(before);
    });

    it('does not bump the Opportunity’s version — a colleague’s open edit form must not fail for an Event', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      await createCrmEvent(h, opportunity.id, timedEventBody('2031-06-10'));
      const read = await call('GET', `/opportunities/${opportunity.id}`, CRM_ADMIN);
      expect(OpportunityDetailResponseSchema.parse(read.json()).data.version).toBe(opportunity.version);
    });

    it('any holder of crm:write edits and deletes another’s Event (FR-132)', async () => {
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: null });
      const event = await createCrmEvent(h, opportunity.id, timedEventBody('2031-06-10'));
      expect(event.createdBy?.id).toBe(TEST_ADMIN_ID);

      const edited = await call('PATCH', `/opportunities/${opportunity.id}/events/${event.id}`, writer.cookies, {
        name: 'Moved by a colleague',
      });
      expect(edited.statusCode, edited.body).toBe(200);
      const changed = OpportunityEventResponseSchema.parse(edited.json()).data;
      // The author stays the author.
      expect(changed).toMatchObject({ name: 'Moved by a colleague', createdBy: { id: TEST_ADMIN_ID } });

      const deleted = await call('DELETE', `/opportunities/${opportunity.id}/events/${event.id}`, rep.cookies);
      expect(deleted.statusCode, deleted.body).toBe(204);
    });

    it('deleting the Opportunity deletes its Events; closing it does not (FR-136)', async () => {
      const closed = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const kept = await createCrmEvent(h, closed.id, timedEventBody('2031-06-10'));
      expect((await transitionCrmOpportunity(h, closed.id, 'lost')).statusCode).toBe(200);
      const listed = await call('GET', `/opportunities/${closed.id}/events`, CRM_ADMIN);
      expect(OpportunityEventListResponseSchema.parse(listed.json()).data.map((event) => event.id)).toEqual([kept.id]);
      // A closed Opportunity keeps the editing of its Events too (FR-133).
      const edited = await call('PATCH', `/opportunities/${closed.id}/events/${kept.id}`, CRM_ADMIN, { name: 'Follow-up' });
      expect(edited.statusCode, edited.body).toBe(200);

      const doomed = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const gone = await createCrmEvent(h, doomed.id, timedEventBody('2031-06-10'));
      const deleted = await call('DELETE', `/opportunities/${doomed.id}`, CRM_ADMIN);
      expect(deleted.statusCode, deleted.body).toBe(204);
      expect(await crmEventReminderRow(h.em(), gone.id)).toBeNull();
      expect(await crmEventReminderRow(h.em(), kept.id)).not.toBeNull();
    });

    it('upcomingEventCount counts the Events that have not ended yet', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const now = Date.now();
      const HOUR = 3_600_000;
      // Ended an hour ago; started an hour ago and still running; yet to start.
      await seedCrmEventRow(h.em(), opportunity.id, { startsAt: new Date(now - 2 * HOUR), endsAt: new Date(now - HOUR) });
      await seedCrmEventRow(h.em(), opportunity.id, { startsAt: new Date(now - HOUR), endsAt: new Date(now + HOUR) });
      await seedCrmEventRow(h.em(), opportunity.id, { startsAt: new Date(now + HOUR), endsAt: new Date(now + 2 * HOUR) });
      const other = await createCrmOpportunity(h, { assignedAdminUserId: null });
      await seedCrmEventRow(h.em(), other.id, { startsAt: new Date(now + HOUR), endsAt: new Date(now + 2 * HOUR) });

      const read = await call('GET', `/opportunities/${opportunity.id}`, CRM_ADMIN);
      expect(OpportunityDetailResponseSchema.parse(read.json()).data.upcomingEventCount).toBe(2);
    });

    it('a reminder on a closed Opportunity reads as paused, and as scheduled again once reopened', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const event = await createCrmEvent(h, opportunity.id, timedEventBody('2031-06-10', { remindAt: '2031-06-10T07:00:00.000Z' }));
      const stateOf = async () => {
        const listed = await call('GET', `/opportunities/${opportunity.id}/events`, CRM_ADMIN);
        return OpportunityEventListResponseSchema.parse(listed.json()).data.find((row) => row.id === event.id)?.reminder?.state;
      };
      expect(await stateOf()).toBe('scheduled');
      expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);
      expect(await stateOf()).toBe('paused');
      expect((await transitionCrmOpportunity(h, opportunity.id, 'new')).statusCode).toBe(200);
      expect(await stateOf()).toBe('scheduled');
    });

    it('a changed reminder time arms a handled reminder again; the same time does not (FR-140)', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const at = new Date('2026-01-10T08:00:00.000Z');
      const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
        startsAt: new Date('2026-01-10T09:00:00Z'),
        endsAt: new Date('2026-01-10T10:00:00Z'),
        remindAt: at,
        reminderHandledAt: new Date('2026-01-10T08:00:20Z'),
        reminderOutcome: 'bell',
      });
      const patch = (body: Record<string, unknown>) =>
        call('PATCH', `/opportunities/${opportunity.id}/events/${eventId}`, CRM_ADMIN, body);

      // The stored time again, with a corrected name: not judged against the
      // clock, and the reminder stays sent.
      const renamed = await patch({ name: 'Corrected name', remindAt: at.toISOString() });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(renamed.json()).data.reminder).toMatchObject({ state: 'sent', channels: ['bell'] });

      // Another time in the past is a new reminder, and is refused.
      const past = await patch({ remindAt: '2026-01-10T08:30:00.000Z' });
      expect(past.statusCode, past.body).toBe(422);
      expect((past.json() as { error: { details: unknown } }).error.details).toMatchObject({ rule: 'reminder_in_past' });
      expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ outcome: 'bell' });

      // A new future time arms it again.
      const armed = await patch({ remindAt: '2031-01-10T08:00:00.000Z' });
      expect(armed.statusCode, armed.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(armed.json()).data.reminder).toMatchObject({
        at: '2031-01-10T08:00:00.000Z',
        state: 'scheduled',
        handledAt: null,
        channels: [],
      });
      expect(await crmEventReminderRow(h.em(), eventId)).toMatchObject({ handledAt: null, outcome: null });
    });
  });

  describe('tenant isolation (FR-134, Constitution XI)', () => {
    it('an Opportunity outside the caller’s Organizations answers 404 on all four routes, and is on no Calendar they can ask for', async () => {
      const window = month(2032, 1);
      const theirs = await createCrmOpportunity(h, { organizationId: organizationB, assignedAdminUserId: null });
      const event = await createCrmEvent(h, theirs.id, timedEventBody(window.day(10), { name: 'B only' }));
      const mine = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: rep.adminUserId });
      const visible = await createCrmEvent(h, mine.id, timedEventBody(window.day(11), { name: 'A, mine' }));

      const base = `/opportunities/${theirs.id}/events`;
      expectOpportunityNotFound(await call('GET', base, rep.cookies), 'list');
      expectOpportunityNotFound(await call('POST', base, rep.cookies, timedEventBody(window.day(12))), 'add');
      expectOpportunityNotFound(await call('PATCH', `${base}/${event.id}`, rep.cookies, { name: 'Taken' }), 'edit');
      expectOpportunityNotFound(await call('DELETE', `${base}/${event.id}`, rep.cookies), 'delete');
      // And B's Event addressed under an Opportunity the caller does reach is
      // as absent as any other id.
      const smuggled = await call('PATCH', `/opportunities/${mine.id}/events/${event.id}`, rep.cookies, { name: 'Taken' });
      expect(smuggled.statusCode, smuggled.body).toBe(404);
      expect(await crmEventReminderRow(h.em(), event.id)).not.toBeNull();
      const untouched = await call('GET', base, CRM_ADMIN);
      expect(OpportunityEventListResponseSchema.parse(untouched.json()).data.map((row) => row.name)).toEqual(['B only']);

      // The positive control: the administrator's Calendar holds both.
      expect(await idsOn(window, CRM_ADMIN)).toEqual([event.id, visible.id]);
      // The representative's holds their own, under either scope.
      expect(await idsOn(window, rep.cookies)).toEqual([visible.id]);
      expect(await idsOn(window, rep.cookies, 'mine')).toEqual([visible.id]);
      expect(await idsOn(window, rep.cookies, 'all')).toEqual([visible.id]);
    });

    it('an Opportunity of another Organization assigned to the caller all the same is still on no Calendar of theirs', async () => {
      // No request produces this row — an assignee must reach the Organization
      // — but a reach can be taken away after the assignment, and the column
      // could be written by an import. The Calendar must not take the
      // assignee's word for the reach.
      const window = month(2032, 2);
      const theirs = await createCrmOpportunity(h, { organizationId: organizationB, assignedAdminUserId: null });
      const event = await createCrmEvent(h, theirs.id, timedEventBody(window.day(10)));
      await h
        .em()
        .getConnection()
        .execute(`update "crm_opportunities" set "assigned_admin_user_id" = ? where "id" = ?`, [rep.adminUserId, theirs.id]);

      expect(await idsOn(window, CRM_ADMIN)).toEqual([event.id]);
      for (const scope of [undefined, 'mine', 'all']) expect(await idsOn(window, rep.cookies, scope), String(scope)).toEqual([]);
    });

    it('a Sales Rep loses an Opportunity still assigned to them once its Organization is taken away (FR-144)', async () => {
      const window = month(2032, 3);
      const organization = await seedCrmOrganization(h.em(), 'Events C');
      const leaving = await seedCrmSalesRep(h.em(), [organization], ['crm:read', 'crm:write', 'orders:read']);
      try {
        const opportunity = await createCrmOpportunity(h, { organizationId: organization, assignedAdminUserId: leaving.adminUserId });
        const event = await createCrmEvent(h, opportunity.id, timedEventBody(window.day(10)));
        expect(await idsOn(window, leaving.cookies)).toEqual([event.id]);

        await h
          .em()
          .getConnection()
          .execute(`delete from "organization_sales_rep_assignments" where "admin_user_id" = ?`, [leaving.adminUserId]);

        expect(await idsOn(window, leaving.cookies)).toEqual([]);
        expect(await idsOn(window, leaving.cookies, 'all')).toEqual([]);
        expectOpportunityNotFound(await call('GET', `/opportunities/${opportunity.id}/events`, leaving.cookies), 'list');
        // Still theirs by the column, and still there for the administrator.
        expect((await readCrmCalendar(h, window)).data[0]?.opportunity.assignee?.id).toBe(leaving.adminUserId);
      } finally {
        leaving.undo();
      }
    });
  });

  describe('the Calendar', () => {
    it('shows Events of Opportunities in an open status only — closing takes them off, reopening brings them back (FR-143)', async () => {
      const window = month(2032, 4);
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const event = await createCrmEvent(h, opportunity.id, timedEventBody(window.day(10)));
      const stored = await crmEventReminderRow(h.em(), event.id);
      expect(await idsOn(window, CRM_ADMIN)).toEqual([event.id]);

      expect((await transitionCrmOpportunity(h, opportunity.id, 'lost')).statusCode).toBe(200);
      expect(await idsOn(window, CRM_ADMIN)).toEqual([]);
      expect(await idsOn(window, CRM_ADMIN, 'mine')).toEqual([]);

      expect((await transitionCrmOpportunity(h, opportunity.id, 'new')).statusCode).toBe(200);
      expect(await idsOn(window, CRM_ADMIN)).toEqual([event.id]);
      // Neither changed the Event.
      expect(await crmEventReminderRow(h.em(), event.id)).toEqual(stored);
    });

    it('a caller who reaches every Organization gets all by default, is offered both scopes, and mine narrows (FR-144)', async () => {
      const window = month(2032, 5);
      const mine = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: TEST_ADMIN_ID });
      const theirs = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: rep.adminUserId });
      const unassigned = await createCrmOpportunity(h, { organizationId: organizationB, assignedAdminUserId: null });
      const a = await createCrmEvent(h, mine.id, timedEventBody(window.day(10)));
      const b = await createCrmEvent(h, theirs.id, timedEventBody(window.day(11)));
      const c = await createCrmEvent(h, unassigned.id, timedEventBody(window.day(12)));

      const all = await readCrmCalendar(h, window);
      expect(all.meta).toEqual({ scope: 'all', scopes: ['all', 'mine'], truncated: false });
      expect(all.data.map((event) => event.id)).toEqual([a.id, b.id, c.id]);

      const asked = await readCrmCalendar(h, { ...window, scope: 'all' });
      expect(asked.meta.scope).toBe('all');
      expect(asked.data).toHaveLength(3);

      const narrowed = await readCrmCalendar(h, { ...window, scope: 'mine' });
      expect(narrowed.meta).toEqual({ scope: 'mine', scopes: ['all', 'mine'], truncated: false });
      expect(narrowed.data.map((event) => event.id)).toEqual([a.id]);

      // Full reach is the reach, not the role's name: another administrator
      // who is not a Sales Rep is offered the same, and their `mine` is empty.
      const other = await readCrmCalendar(h, window, writer.cookies);
      expect(other.meta.scopes).toEqual(['all', 'mine']);
      expect(other.data).toHaveLength(3);
      expect((await readCrmCalendar(h, { ...window, scope: 'mine' }, writer.cookies)).data).toEqual([]);
    });

    it('a Sales Rep gets mine whatever is asked, and a colleague’s Opportunity of a shared Organization on no scope (FR-144)', async () => {
      const window = month(2032, 6);
      const own = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: rep.adminUserId });
      const colleagues = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: colleague.adminUserId });
      const nobodys = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: null });
      const mine = await createCrmEvent(h, own.id, timedEventBody(window.day(10)));
      const theirs = await createCrmEvent(h, colleagues.id, timedEventBody(window.day(11)));
      await createCrmEvent(h, nobodys.id, timedEventBody(window.day(12)));

      for (const scope of [undefined, 'mine', 'all']) {
        const answer = await readCrmCalendar(h, { ...window, ...(scope ? { scope } : {}) }, rep.cookies);
        expect(answer.meta, String(scope)).toEqual({ scope: 'mine', scopes: ['mine'], truncated: false });
        expect(answer.data.map((event) => event.id), String(scope)).toEqual([mine.id]);
      }
      // The colleague's own Calendar is the mirror image.
      expect(await idsOn(window, colleague.cookies, 'all')).toEqual([theirs.id]);
      // Narrower than the screens, on purpose (research N-CAL2): the Rep can
      // still open the colleague's Opportunity and read its Events tab.
      const tab = await call('GET', `/opportunities/${colleagues.id}/events`, rep.cookies);
      expect(tab.statusCode, tab.body).toBe(200);
    });

    it('reassigning moves every Event between two callers’ answers, and writes no Event row (FR-145)', async () => {
      const window = month(2032, 7);
      const opportunity = await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: rep.adminUserId });
      const first = await createCrmEvent(h, opportunity.id, timedEventBody(window.day(10)));
      const second = await createCrmEvent(h, opportunity.id, timedEventBody(window.day(20), { allDay: false }));
      const stored = [await crmEventReminderRow(h.em(), first.id), await crmEventReminderRow(h.em(), second.id)];
      expect(await idsOn(window, rep.cookies)).toEqual([first.id, second.id]);
      expect(await idsOn(window, colleague.cookies)).toEqual([]);

      await assign(opportunity.id, colleague.adminUserId);

      expect(await idsOn(window, rep.cookies)).toEqual([]);
      expect(await idsOn(window, colleague.cookies)).toEqual([first.id, second.id]);
      expect((await readCrmCalendar(h, window, colleague.cookies)).data[0]?.opportunity.assignee?.id).toBe(colleague.adminUserId);
      // Nothing was copied and nothing was touched: `updated_at` included.
      expect([await crmEventReminderRow(h.em(), first.id), await crmEventReminderRow(h.em(), second.id)]).toEqual(stored);

      await assign(opportunity.id, null);
      expect(await idsOn(window, colleague.cookies)).toEqual([]);
      expect((await readCrmCalendar(h, window)).data.map((event) => event.opportunity.assignee)).toEqual([null, null]);
    });

    it('answers an Event that overlaps the range, at both edges, and not one that only touches it', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const from = '2032-08-10T00:00:00.000Z';
      const to = '2032-08-11T00:00:00.000Z';
      const add = (name: string, startsAt: string, endsAt: string) =>
        seedCrmEventRow(h.em(), opportunity.id, { name, startsAt: new Date(startsAt), endsAt: new Date(endsAt), timeZone: 'UTC' });
      await add('ends as the range starts', '2032-08-09T23:00:00Z', '2032-08-10T00:00:00Z');
      const overStart = await add('over the start', '2032-08-09T23:30:00Z', '2032-08-10T00:30:00Z');
      const inside = await add('inside', '2032-08-10T10:00:00Z', '2032-08-10T11:00:00Z');
      const overEnd = await add('over the end', '2032-08-10T23:30:00Z', '2032-08-11T00:30:00Z');
      await add('starts as the range ends', '2032-08-11T00:00:00Z', '2032-08-11T01:00:00Z');
      // The longest an Event can be, ending just inside the range.
      const longest = await add('25 hours, ending inside', '2032-08-08T23:00:01Z', '2032-08-10T00:00:01Z');

      expect(await idsOn({ from, to }, CRM_ADMIN)).toEqual([longest, overStart, inside, overEnd]);
    });

    it('finds an all-day Event of a far zone through the range widened by a day, by its own date', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      // 2032-09-11 in Kiritimati (UTC+14): it begins at 10:00 UTC on the 10th.
      const event = await createCrmEvent(h, opportunity.id, {
        name: 'Trade fair',
        allDay: true,
        startsAt: '2032-09-10T10:00:00.000Z',
        endsAt: '2032-09-11T10:00:00.000Z',
        timeZone: 'Pacific/Kiritimati',
      });
      // A reader twelve hours west of UTC: their 11th starts at noon UTC, by
      // which time the date is already over where it was planned.
      const theirDay = { from: '2032-09-11T12:00:00.000Z', to: '2032-09-12T12:00:00.000Z' };
      expect(await idsOn(theirDay, CRM_ADMIN)).toEqual([]);
      const widened = { from: '2032-09-10T12:00:00.000Z', to: '2032-09-13T12:00:00.000Z' };
      const found = await readCrmCalendar(h, widened);
      expect(found.data).toHaveLength(1);
      expect(found.data[0]).toMatchObject({ id: event.id, allDay: true, allDayDate: '2032-09-11' });
    });

    describe('at scale (FR-151)', () => {
      const bulk = async (opportunityId: string, count: number, firstStart: string) => {
        await h
          .em()
          .getConnection()
          .execute(
            `insert into "crm_opportunity_events"
               ("id", "opportunity_id", "name", "starts_at", "ends_at", "time_zone", "created_at", "updated_at")
             select gen_random_uuid(), ?, 'Bulk ' || n, ?::timestamptz + n * interval '30 minutes',
                    ?::timestamptz + n * interval '30 minutes' + interval '20 minutes', 'UTC', now(), now()
               from generate_series(0, ? - 1) as n`,
            [opportunityId, firstStart, firstStart, count],
          );
      };

      it('answers the first 500 by start, then id, and says that it cut', async () => {
        const window = month(2032, 10);
        const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: TEST_ADMIN_ID });
        await bulk(opportunity.id, CALENDAR_EVENTS_MAX_RESULTS + 1, `${window.day(2)}T00:00:00Z`);

        const answer = await readCrmCalendar(h, window);
        expect(answer.meta.truncated).toBe(true);
        expect(answer.data).toHaveLength(CALENDAR_EVENTS_MAX_RESULTS);
        const starts = answer.data.map((event) => event.startsAt);
        expect(starts).toEqual([...starts].sort());
        expect(starts[0]).toBe(`${window.day(2)}T00:00:00.000Z`);
        // The one left out is the last.
        expect(starts).not.toContain(new Date(Date.parse(`${window.day(2)}T00:00:00Z`) + 500 * 30 * 60_000).toISOString());

        // Exactly 500 is not a cut.
        await h
          .em()
          .getConnection()
          .execute(
            `delete from "crm_opportunity_events" where "id" in (
               select "id" from "crm_opportunity_events" where "opportunity_id" = ? order by "starts_at" desc limit 1)`,
            [opportunity.id],
          );
        const whole = await readCrmCalendar(h, window);
        expect(whole.meta.truncated).toBe(false);
        expect(whole.data).toHaveLength(CALENDAR_EVENTS_MAX_RESULTS);
      });

      it('issues the same number of statements at 5 Events and at 500, over as many Opportunities as you like', async () => {
        const few = month(2032, 11);
        const many = month(2032, 12);
        const opportunities = [];
        for (const assignee of [TEST_ADMIN_ID, rep.adminUserId, colleague.adminUserId, writer.adminUserId, null]) {
          opportunities.push(
            await createCrmOpportunity(h, { organizationId: organizationA, assignedAdminUserId: assignee }),
          );
        }
        for (const [index, opportunity] of opportunities.entries()) {
          await bulk(opportunity.id, 1, `${few.day(2 + index)}T00:00:00Z`);
          await bulk(opportunity.id, 100, `${many.day(2 + index * 3)}T00:00:00Z`);
        }

        const measure = async (window: { from: string; to: string }) => {
          const { result, statements } = await countStatements(h.em(), () => readCrmCalendar(h, window));
          return { rows: result.data.length, statements };
        };
        // Once unmeasured, so that nothing either read caches is counted in one and not the other.
        await measure(few);
        const atFive = await measure(few);
        const atFiveHundred = await measure(many);
        expect(atFive.rows).toBe(5);
        expect(atFiveHundred.rows).toBe(500);
        expect(atFiveHundred.statements).toBe(atFive.statements);
      });
    });
  });
});
