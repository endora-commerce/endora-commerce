import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CalendarEventsResponseSchema,
  OpportunityDetailResponseSchema,
  OpportunityEventListResponseSchema,
  OpportunityEventResponseSchema,
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
} from '../../helpers/seed-crm.js';
import { createCrmEvent, seedCrmEventRow, timedEventBody } from '../../helpers/seed-crm-events.js';

/**
 * Events on an Opportunity and the Calendar
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12d): the five
 * routes against their schemas, with their gates and their refusals.
 *
 * Two kinds of refusal are told apart on purpose. A body or a query that is
 * not of the schema is **400**; a well-formed Event the rules refuse is
 * **422**, with `details.field` and `details.rule` — the dialog words each rule
 * from its own bundle, so the rule is part of the contract.
 */
describe('crm events and the calendar (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let opportunityId: string;
  let otherOpportunityId: string;
  const MISSING = '00000000-0000-4000-8000-00000000dead';
  const DAY = '2031-06-10';

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  const errorOf = (response: { json(): unknown }) =>
    (response.json() as { error: { code: string; details?: Record<string, unknown> } }).error;

  const calendar = (query: Record<string, string>, cookies: Record<string, string> = CRM_ADMIN) =>
    call('GET', `/calendar/events?${new URLSearchParams(query).toString()}`, undefined, cookies);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    viewer = await seedCrmAdmin(h.em(), 'event-viewer', ['crm:read']);
    opportunityId = (await createCrmOpportunity(h, { title: 'Forklift fleet' })).id;
    otherOpportunityId = (await createCrmOpportunity(h, { title: 'Pallet racks' })).id;
  });

  afterAll(async () => {
    viewer.undo();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  describe('POST /opportunities/:id/events', () => {
    it('adds a timed Event — 201 with the Event, its author and no reminder', async () => {
      const response = await call(
        'POST',
        `/opportunities/${opportunityId}/events`,
        timedEventBody(DAY, { name: '  Demo at the warehouse  ', description: 'Bring the price list.' }),
      );
      expect(response.statusCode, response.body).toBe(201);
      const event = OpportunityEventResponseSchema.parse(response.json()).data;
      expect(event).toMatchObject({
        opportunityId,
        name: 'Demo at the warehouse',
        description: 'Bring the price list.',
        allDay: false,
        startsAt: `${DAY}T08:00:00.000Z`,
        endsAt: `${DAY}T09:00:00.000Z`,
        timeZone: 'Europe/Warsaw',
        allDayDate: null,
        reminder: null,
        createdBy: { id: TEST_ADMIN_ID },
      });
    });

    it('adds an all-day Event with a reminder — the date computed in the Event’s own zone', async () => {
      const response = await call('POST', `/opportunities/${opportunityId}/events`, {
        name: 'Offer deadline',
        allDay: true,
        // 2031-06-11 in Auckland (UTC+12) — the 10th at noon in UTC.
        startsAt: '2031-06-10T12:00:00.000Z',
        endsAt: '2031-06-11T12:00:00.000Z',
        timeZone: 'Pacific/Auckland',
        remindAt: '2031-06-09T07:00:00+02:00',
      });
      expect(response.statusCode, response.body).toBe(201);
      const event = OpportunityEventResponseSchema.parse(response.json()).data;
      expect(event).toMatchObject({
        allDay: true,
        allDayDate: '2031-06-11',
        description: null,
        reminder: { at: '2031-06-09T05:00:00.000Z', state: 'scheduled', handledAt: null, channels: [] },
      });
    });

    it('accepts a timed Event that ends exactly at the next local midnight — the end is exclusive', async () => {
      // What the form sends when "To" is 00:00: 22:00 – 24:00 in Warsaw (UTC+2 in June).
      const response = await call(
        'POST',
        `/opportunities/${opportunityId}/events`,
        timedEventBody(DAY, { startsAt: `${DAY}T20:00:00.000Z`, endsAt: `${DAY}T22:00:00.000Z` }),
      );
      expect(response.statusCode, response.body).toBe(201);
      expect(OpportunityEventResponseSchema.parse(response.json()).data).toMatchObject({
        allDay: false,
        allDayDate: null,
        endsAt: `${DAY}T22:00:00.000Z`,
      });
      // One millisecond more is the next day.
      const over = await call(
        'POST',
        `/opportunities/${opportunityId}/events`,
        timedEventBody(DAY, { startsAt: `${DAY}T20:00:00.000Z`, endsAt: `${DAY}T22:00:00.001Z` }),
      );
      expect(over.statusCode, over.body).toBe(422);
      expect(errorOf(over).details).toMatchObject({ rule: 'spans_days', field: 'endsAt' });
    });

    it('refuses a reader — 403', async () => {
      const response = await call('POST', `/opportunities/${opportunityId}/events`, timedEventBody(DAY), viewer.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an Opportunity that is not there', async () => {
      const response = await call('POST', `/opportunities/${MISSING}/events`, timedEventBody(DAY));
      expect(response.statusCode, response.body).toBe(404);
      expect(errorOf(response).code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });

    it.each([
      ['no name', timedEventBody(DAY, { name: '   ' })],
      ['no zone', { name: 'Call', allDay: false, startsAt: `${DAY}T08:00:00Z`, endsAt: `${DAY}T09:00:00Z` }],
      ['an end not after the start', timedEventBody(DAY, { endsAt: `${DAY}T08:00:00.000Z` })],
      ['a span over 25 hours', timedEventBody(DAY, { endsAt: '2031-06-11T09:00:01.000Z' })],
      ['a start that is not an instant', timedEventBody(DAY, { startsAt: '2031-06-10 08:00' })],
      ['a description over 5 000 characters', timedEventBody(DAY, { description: 'x'.repeat(5001) })],
    ])('refuses a malformed body (%s) — 400 VALIDATION_FAILED', async (_what, body) => {
      const response = await call('POST', `/opportunities/${opportunityId}/events`, body);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    });

    it.each([
      [
        'spans_days',
        'endsAt',
        // 23:00 – 01:00 in Warsaw.
        timedEventBody(DAY, { startsAt: `${DAY}T21:00:00.000Z`, endsAt: `${DAY}T23:00:00.000Z` }),
      ],
      [
        'not_whole_day',
        'startsAt',
        // A whole UTC day is not a whole day in Warsaw.
        timedEventBody(DAY, { allDay: true, startsAt: `${DAY}T00:00:00.000Z`, endsAt: '2031-06-11T00:00:00.000Z' }),
      ],
      ['unknown_time_zone', 'timeZone', timedEventBody(DAY, { timeZone: 'Mars/Olympus_Mons' })],
      ['reminder_in_past', 'remindAt', timedEventBody(DAY, { remindAt: '2020-01-01T00:00:00.000Z' })],
    ])('refuses a well-formed Event the rules refuse (%s) — 422 with the rule and its field', async (rule, field, body) => {
      const response = await call('POST', `/opportunities/${opportunityId}/events`, body);
      expect(response.statusCode, response.body).toBe(422);
      const error = errorOf(response);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toMatchObject({ rule, field });
    });
  });

  describe('GET /opportunities/:id/events', () => {
    it('lists every Event of the Opportunity by start, then id — also for a reader', async () => {
      const mine = await createCrmOpportunity(h, { title: 'Ordered list' });
      const later = await createCrmEvent(h, mine.id, timedEventBody('2031-07-02', { name: 'Later' }));
      const earlier = await createCrmEvent(h, mine.id, timedEventBody('2031-07-01', { name: 'Earlier' }));
      const response = await call('GET', `/opportunities/${mine.id}/events`, undefined, viewer.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const events = OpportunityEventListResponseSchema.parse(response.json()).data;
      expect(events.map((event) => event.id)).toEqual([earlier.id, later.id]);
    });

    it('answers 404 CRM_OPPORTUNITY_NOT_FOUND for an Opportunity that is not there', async () => {
      const response = await call('GET', `/opportunities/${MISSING}/events`);
      expect(response.statusCode, response.body).toBe(404);
      expect(errorOf(response).code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });

    it('answers each stored reminder outcome as the state the contract names', async () => {
      const host = await createCrmOpportunity(h, { title: 'Reminder states' });
      const at = new Date('2026-01-10T08:00:00Z');
      const handled = new Date('2026-01-10T08:00:30Z');
      const base = { startsAt: new Date('2026-01-10T09:00:00Z'), endsAt: new Date('2026-01-10T10:00:00Z') };
      const stored: Array<[string | null, string, string[]]> = [
        [null, 'scheduled', []],
        ['sending', 'scheduled', []],
        ['bell', 'sent', ['bell']],
        ['bell_email', 'sent', ['bell', 'email']],
        ['email', 'sent', ['email']],
        ['no_recipient', 'no_recipient', []],
        ['undeliverable', 'undeliverable', []],
        ['missed', 'missed', []],
        ['interrupted', 'interrupted', []],
      ];
      for (const [outcome] of stored) {
        await seedCrmEventRow(h.em(), host.id, {
          ...base,
          name: `outcome ${outcome ?? 'none'}`,
          remindAt: at,
          reminderHandledAt: outcome === null ? null : handled,
          reminderOutcome: outcome,
        });
      }
      const response = await call('GET', `/opportunities/${host.id}/events`);
      expect(response.statusCode, response.body).toBe(200);
      const events = OpportunityEventListResponseSchema.parse(response.json()).data;
      const byName = new Map(events.map((event) => [event.name, event.reminder]));
      for (const [outcome, state, channels] of stored) {
        const reminder = byName.get(`outcome ${outcome ?? 'none'}`);
        expect(reminder, String(outcome)).toMatchObject({ at: at.toISOString(), state, channels });
        // A reminder still to do — or being sent right now — has not been handled.
        expect(reminder?.handledAt, String(outcome)).toBe(state === 'scheduled' ? null : handled.toISOString());
      }
    });
  });

  describe('PATCH /opportunities/:id/events/:eventId', () => {
    it('changes what the body names and leaves the rest', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY, { description: 'Kept.' }));
      const response = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        name: 'Renamed',
        remindAt: '2031-06-10T07:00:00.000Z',
      });
      expect(response.statusCode, response.body).toBe(200);
      const changed = OpportunityEventResponseSchema.parse(response.json()).data;
      expect(changed).toMatchObject({
        id: event.id,
        name: 'Renamed',
        description: 'Kept.',
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        reminder: { at: '2031-06-10T07:00:00.000Z', state: 'scheduled' },
      });

      const cleared = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, { remindAt: null });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(cleared.json()).data.reminder).toBeNull();
    });

    it('stores the four time members as they are sent together — the editor’s zone replaces the one the Event was planned in', async () => {
      // 10:00 – 11:00 in Warsaw, with a reminder that is not part of the edit.
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY, { remindAt: '2031-06-10T07:00:00.000Z' }));
      // Edited from a browser in Tokyo: 15:00 – 16:00 there, an hour earlier than it was.
      const response = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        allDay: false,
        startsAt: '2031-06-10T06:00:00.000Z',
        endsAt: '2031-06-10T07:00:00.000Z',
        timeZone: 'Asia/Tokyo',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(response.json()).data).toMatchObject({
        allDay: false,
        startsAt: '2031-06-10T06:00:00.000Z',
        endsAt: '2031-06-10T07:00:00.000Z',
        timeZone: 'Asia/Tokyo',
        // A reminder the body does not name is left as it was.
        reminder: { at: '2031-06-10T07:00:00.000Z', state: 'scheduled' },
      });

      // The zone alone is a change too, and is stored.
      const zoneOnly = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        allDay: false,
        startsAt: '2031-06-10T06:00:00.000Z',
        endsAt: '2031-06-10T07:00:00.000Z',
        timeZone: 'Europe/Warsaw',
      });
      expect(zoneOnly.statusCode, zoneOnly.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(zoneOnly.json()).data.timeZone).toBe('Europe/Warsaw');

      // Made all-day from Tokyo: its date is Tokyo's, whatever zone it was planned in before.
      const allDay = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        allDay: true,
        startsAt: '2031-06-10T15:00:00.000Z',
        endsAt: '2031-06-11T15:00:00.000Z',
        timeZone: 'Asia/Tokyo',
      });
      expect(allDay.statusCode, allDay.body).toBe(200);
      expect(OpportunityEventResponseSchema.parse(allDay.json()).data).toMatchObject({
        allDay: true,
        allDayDate: '2031-06-11',
        timeZone: 'Asia/Tokyo',
      });
    });

    it('judges the one-day rule in the zone that is sent — an Event that is one day where it was planned may be two where it is edited', async () => {
      // 16:30 – 17:30 in Warsaw is 23:30 – 00:30 in Tokyo.
      const event = await createCrmEvent(
        h,
        opportunityId,
        timedEventBody(DAY, { startsAt: `${DAY}T14:30:00.000Z`, endsAt: `${DAY}T15:30:00.000Z` }),
      );
      const response = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        allDay: false,
        startsAt: `${DAY}T14:30:00.000Z`,
        endsAt: `${DAY}T15:30:00.000Z`,
        timeZone: 'Asia/Tokyo',
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(errorOf(response).details).toMatchObject({ rule: 'spans_days', field: 'endsAt' });
      // A rename of the same Event, naming no time member, is not judged again.
      const renamed = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, { name: 'Renamed' });
      expect(renamed.statusCode, renamed.body).toBe(200);
    });

    it('judges the Event as it would be after the change — 422 ends_before_start for an end before the stored start', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const response = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        endsAt: `${DAY}T07:00:00.000Z`,
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(errorOf(response).details).toMatchObject({ rule: 'ends_before_start', field: 'endsAt' });
    });

    it('refuses a body naming a member the schema does not have — 400', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const response = await call('PATCH', `/opportunities/${opportunityId}/events/${event.id}`, {
        opportunityId: otherOpportunityId,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('refuses a reader — 403', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const response = await call(
        'PATCH',
        `/opportunities/${opportunityId}/events/${event.id}`,
        { name: 'Theirs now' },
        viewer.cookies,
      );
      expect(response.statusCode, response.body).toBe(403);
    });

    it('answers 404 for a missing Opportunity, and 404 NOT_FOUND for an Event of another one', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const noParent = await call('PATCH', `/opportunities/${MISSING}/events/${event.id}`, { name: 'x' });
      expect(noParent.statusCode, noParent.body).toBe(404);
      expect(errorOf(noParent).code).toBe('CRM_OPPORTUNITY_NOT_FOUND');

      for (const eventId of [event.id, MISSING, 'not-a-uuid']) {
        const wrongParent = await call('PATCH', `/opportunities/${otherOpportunityId}/events/${eventId}`, { name: 'x' });
        expect(wrongParent.statusCode, `${eventId}: ${wrongParent.body}`).toBe(404);
        expect(errorOf(wrongParent).code, eventId).toBe('NOT_FOUND');
      }
    });
  });

  describe('DELETE /opportunities/:id/events/:eventId', () => {
    it('deletes the Event — 204, and it is no longer listed', async () => {
      const host = await createCrmOpportunity(h, { title: 'Deleting' });
      const event = await createCrmEvent(h, host.id, timedEventBody(DAY));
      const response = await call('DELETE', `/opportunities/${host.id}/events/${event.id}`);
      expect(response.statusCode, response.body).toBe(204);
      const listed = await call('GET', `/opportunities/${host.id}/events`);
      expect(OpportunityEventListResponseSchema.parse(listed.json()).data).toEqual([]);
    });

    it('refuses a reader — 403', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const response = await call('DELETE', `/opportunities/${opportunityId}/events/${event.id}`, undefined, viewer.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('answers 404 for a missing Opportunity, and 404 NOT_FOUND for an Event of another one', async () => {
      const event = await createCrmEvent(h, opportunityId, timedEventBody(DAY));
      const noParent = await call('DELETE', `/opportunities/${MISSING}/events/${event.id}`);
      expect(noParent.statusCode, noParent.body).toBe(404);
      expect(errorOf(noParent).code).toBe('CRM_OPPORTUNITY_NOT_FOUND');

      const wrongParent = await call('DELETE', `/opportunities/${otherOpportunityId}/events/${event.id}`);
      expect(wrongParent.statusCode, wrongParent.body).toBe(404);
      expect(errorOf(wrongParent).code).toBe('NOT_FOUND');
    });
  });

  describe('GET /calendar/events', () => {
    it('answers the Events overlapping the range, with their Opportunity and no description — also for a reader', async () => {
      const host = await createCrmOpportunity(h, { title: 'On the calendar', assignedAdminUserId: TEST_ADMIN_ID });
      const event = await createCrmEvent(
        h,
        host.id,
        timedEventBody('2031-09-10', { name: 'Site visit', description: 'Not for a calendar.', remindAt: '2031-09-10T07:00:00.000Z' }),
      );
      const response = await calendar({ from: '2031-09-01T00:00:00.000Z', to: '2031-10-01T00:00:00.000Z' }, viewer.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const body = CalendarEventsResponseSchema.parse(response.json());
      expect(body.meta).toEqual({ scope: 'all', scopes: ['all', 'mine'], truncated: false });
      expect(body.data).toEqual([
        {
          id: event.id,
          name: 'Site visit',
          allDay: false,
          startsAt: '2031-09-10T08:00:00.000Z',
          endsAt: '2031-09-10T09:00:00.000Z',
          allDayDate: null,
          hasReminder: true,
          opportunity: {
            id: host.id,
            number: host.number,
            title: 'On the calendar',
            assignee: { id: TEST_ADMIN_ID, name: expect.any(String) },
          },
        },
      ]);
      expect(response.body).not.toContain('Not for a calendar.');
    });

    it.each([
      ['a 46-day range', { from: '2031-01-01T00:00:00.000Z', to: '2031-02-16T00:00:00.000Z' }],
      ['an end not after the start', { from: '2031-01-02T00:00:00.000Z', to: '2031-01-02T00:00:00.000Z' }],
      ['no range', {}],
      ['a scope that is not one', { from: '2031-01-01T00:00:00.000Z', to: '2031-01-02T00:00:00.000Z', scope: 'theirs' }],
    ])('refuses %s — 400 VALIDATION_FAILED', async (_what, query) => {
      const response = await calendar(query as Record<string, string>);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
    });

    it('takes a range of exactly 45 days', async () => {
      const response = await calendar({ from: '2031-01-01T00:00:00.000Z', to: '2031-02-15T00:00:00.000Z' });
      expect(response.statusCode, response.body).toBe(200);
    });
  });

  describe('GET /opportunities/:id', () => {
    it('carries upcomingEventCount', async () => {
      const host = await createCrmOpportunity(h, { title: 'Counted' });
      const before = await call('GET', `/opportunities/${host.id}`);
      expect(OpportunityDetailResponseSchema.parse(before.json()).data.upcomingEventCount).toBe(0);
      await createCrmEvent(h, host.id, timedEventBody(DAY));
      const after = await call('GET', `/opportunities/${host.id}`);
      expect(after.statusCode, after.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(after.json()).data.upcomingEventCount).toBe(1);
    });
  });
});
