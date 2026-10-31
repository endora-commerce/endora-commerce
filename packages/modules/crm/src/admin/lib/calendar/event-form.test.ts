import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateOpportunityEventRequestSchema,
  OpportunityEventSchema,
  UpdateOpportunityEventRequestSchema,
  type OpportunityEvent,
} from '@endora-commerce/contracts';
import {
  createEventBody,
  defaultEventForm,
  defaultRemindAt,
  eventFormOf,
  fieldOfDetails,
  instantOfDateTimeValue,
  instantsOf,
  ruleOfDetails,
  shiftedTo,
  updateEventBody,
  validateEventForm,
  type EventFormValues,
} from './event-form.js';

/**
 * The Event dialog's arithmetic (`specs/143-crm-sales-opportunities/`, User
 * Story 21 — task T365's pure half; FR-130, FR-131, FR-137): what the form
 * opens with, what it refuses, and the bodies it sends — each parsed with the
 * contract's request schema, so a body the route would refuse is refused here.
 */

const ORIGINAL_TZ = process.env['TZ'];
beforeEach(() => {
  process.env['TZ'] = 'Europe/Warsaw';
});
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

/** Thursday 8 October 2026, 14:20 in Warsaw (UTC+2). */
const NOW = new Date('2026-10-08T12:20:00.000Z');
const ZONE = 'Europe/Warsaw';

function stored(overrides: Partial<OpportunityEvent> = {}): OpportunityEvent {
  return OpportunityEventSchema.parse({
    id: '00000000-0000-4000-8000-0000000000e1',
    opportunityId: '00000000-0000-4000-8000-0000000000b1',
    name: 'Call back about the offer',
    description: null,
    allDay: false,
    startsAt: '2026-10-09T08:00:00.000Z',
    endsAt: '2026-10-09T08:30:00.000Z',
    timeZone: ZONE,
    allDayDate: null,
    reminder: null,
    createdBy: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    ...overrides,
  });
}

function form(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    name: 'Call back',
    description: '',
    allDay: false,
    date: '2026-10-09',
    from: '10:00',
    to: '10:30',
    remind: false,
    remindAt: '',
    ...overrides,
  };
}

describe('what a new Event opens with', () => {
  it('is today, from the next whole hour, for an hour, with no reminder', () => {
    expect(defaultEventForm(NOW)).toEqual({
      name: '',
      description: '',
      allDay: false,
      date: '2026-10-08',
      from: '15:00',
      to: '16:00',
      remind: false,
      remindAt: '',
    });
  });

  it('is the local today, not the UTC one', () => {
    // 00:30 on 9 October in Warsaw is still 8 October in UTC.
    const values = defaultEventForm(new Date('2026-10-08T22:30:00.000Z'));
    expect([values.date, values.from, values.to]).toEqual(['2026-10-09', '01:00', '02:00']);
  });

  it('ends at midnight, not on the next day, when the last hour of the day is the next one', () => {
    const late = defaultEventForm(new Date('2026-10-08T20:40:00.000Z')); // 22:40
    expect([late.date, late.from, late.to]).toEqual(['2026-10-08', '23:00', '00:00']);
    expect(validateEventForm({ ...late, name: 'x' }, NOW)).toEqual({});
    const last = defaultEventForm(new Date('2026-10-08T21:40:00.000Z')); // 23:40
    expect([last.date, last.from]).toEqual(['2026-10-08', '23:00']);
  });
});

describe('To follows From', () => {
  it('keeps the length when From moves', () => {
    expect(shiftedTo('10:00', '10:30', '14:00')).toBe('14:30');
    expect(shiftedTo('10:00', '12:00', '08:15')).toBe('10:15');
  });

  it('stops at the end of the day', () => {
    expect(shiftedTo('10:00', '12:00', '22:00')).toBe('00:00');
    expect(shiftedTo('10:00', '12:00', '23:00')).toBe('23:59');
    expect(shiftedTo('22:00', '00:00', '20:00')).toBe('22:00');
  });

  it('leaves To alone when there is no length to keep', () => {
    expect(shiftedTo('10:00', '09:00', '14:00')).toBe('09:00');
    expect(shiftedTo('', '10:30', '14:00')).toBe('10:30');
    expect(shiftedTo('10:00', '10:30', '')).toBe('10:30');
  });
});

describe('the instants of a form', () => {
  it('are the date at From and at To, in the browser’s zone', () => {
    const instants = instantsOf(form());
    expect(instants?.startsAt.toISOString()).toBe('2026-10-09T08:00:00.000Z');
    expect(instants?.endsAt.toISOString()).toBe('2026-10-09T08:30:00.000Z');
  });

  it('are the local midnight that starts the date and the next one, for all day', () => {
    const instants = instantsOf(form({ allDay: true }));
    expect(instants?.startsAt.toISOString()).toBe('2026-10-08T22:00:00.000Z');
    expect(instants?.endsAt.toISOString()).toBe('2026-10-09T22:00:00.000Z');
  });

  it('make an all-day Event 23 and 25 hours long on the days a clock changes — inside the contract’s 25', () => {
    const spring = instantsOf(form({ allDay: true, date: '2026-03-29' }));
    const autumn = instantsOf(form({ allDay: true, date: '2026-10-25' }));
    expect((spring!.endsAt.getTime() - spring!.startsAt.getTime()) / 3_600_000).toBe(23);
    expect((autumn!.endsAt.getTime() - autumn!.startsAt.getTime()) / 3_600_000).toBe(25);
    expect(createEventBody(form({ allDay: true, date: '2026-10-25' }), ZONE)).not.toBeNull();
  });

  it('read To 00:00 after a later From as the midnight that ends the day', () => {
    const instants = instantsOf(form({ from: '22:00', to: '00:00' }));
    expect(instants?.endsAt.toISOString()).toBe('2026-10-09T22:00:00.000Z');
  });

  it('are nothing while the date or a time is not one', () => {
    expect(instantsOf(form({ date: '' }))).toBeNull();
    expect(instantsOf(form({ from: '' }))).toBeNull();
    expect(instantsOf(form({ to: '25:00' }))).toBeNull();
    expect(instantOfDateTimeValue('2026-10-09T10:00')?.toISOString()).toBe('2026-10-09T08:00:00.000Z');
    expect(instantOfDateTimeValue('2026-02-30T10:00')).toBeNull();
    expect(instantOfDateTimeValue('')).toBeNull();
  });
});

describe('the reminder time the form offers', () => {
  it('is the Event’s start', () => {
    expect(defaultRemindAt(form())).toBe('2026-10-09T10:00');
  });

  it('is 09:00 on the date for an all-day Event', () => {
    expect(defaultRemindAt(form({ allDay: true }))).toBe('2026-10-09T09:00');
  });

  it('is empty while the start is not a moment yet', () => {
    expect(defaultRemindAt(form({ date: '' }))).toBe('');
    expect(defaultRemindAt(form({ from: '' }))).toBe('');
  });
});

describe('what the form refuses before sending', () => {
  it('accepts a complete form', () => {
    expect(validateEventForm(form(), NOW)).toEqual({});
    expect(validateEventForm(form({ allDay: true, from: '', to: '' }), NOW)).toEqual({});
  });

  it('asks for a name, a date and both times — each under its own field', () => {
    expect(validateEventForm(form({ name: '   ', date: '', from: '', to: '' }), NOW)).toEqual({
      name: 'events.error.nameRequired',
      date: 'events.error.dateRequired',
      from: 'events.error.timeRequired',
      to: 'events.error.timeRequired',
    });
  });

  it('says under To that the end is not after the start', () => {
    expect(validateEventForm(form({ from: '10:00', to: '10:00' }), NOW)).toEqual({ to: 'events.error.ends_before_start' });
    expect(validateEventForm(form({ from: '10:00', to: '09:00' }), NOW)).toEqual({ to: 'events.error.ends_before_start' });
    // …and the contract's schema agrees about the same two instants.
    expect(
      CreateOpportunityEventRequestSchema.safeParse({
        name: 'x', allDay: false, timeZone: ZONE,
        startsAt: '2026-10-09T08:00:00.000Z', endsAt: '2026-10-09T08:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('asks for a reminder time, and refuses one that is not in the future', () => {
    expect(validateEventForm(form({ remind: true, remindAt: '' }), NOW)).toEqual({ remindAt: 'events.error.remindAtRequired' });
    expect(validateEventForm(form({ remind: true, remindAt: '2026-10-08T14:20' }), NOW)).toEqual({
      remindAt: 'events.error.reminder_in_past',
    });
    expect(validateEventForm(form({ remind: true, remindAt: '2026-10-08T14:21' }), NOW)).toEqual({});
  });

  it('does not judge an untouched reminder of an edited Event against the clock', () => {
    const sent = eventFormOf(
      stored({
        startsAt: '2026-10-01T08:00:00.000Z',
        endsAt: '2026-10-01T08:30:00.000Z',
        reminder: { at: '2026-10-01T08:00:00.000Z', state: 'sent', handledAt: '2026-10-01T08:00:20.000Z', channels: ['bell'] },
      }),
    );
    expect(validateEventForm({ ...sent, name: 'Corrected' }, NOW, sent)).toEqual({});
    // Moved by hand to another past time, it is judged.
    expect(validateEventForm({ ...sent, remindAt: '2026-10-02T10:00' }, NOW, sent)).toEqual({
      remindAt: 'events.error.reminder_in_past',
    });
  });
});

describe('the body of a create', () => {
  it('is instants in UTC, the zone they were chosen in, and no reminder', () => {
    expect(createEventBody(form({ name: '  Call back  ', description: '  ' }), ZONE)).toEqual({
      name: 'Call back',
      description: null,
      allDay: false,
      startsAt: '2026-10-09T08:00:00.000Z',
      endsAt: '2026-10-09T08:30:00.000Z',
      timeZone: ZONE,
      remindAt: null,
    });
  });

  it('carries the reminder as an instant, and local midnights for all day', () => {
    const body = createEventBody(form({ allDay: true, description: 'Bring the samples', remind: true, remindAt: '2026-10-09T09:00' }), ZONE);
    expect(body).toMatchObject({
      allDay: true,
      description: 'Bring the samples',
      startsAt: '2026-10-08T22:00:00.000Z',
      endsAt: '2026-10-09T22:00:00.000Z',
      remindAt: '2026-10-09T07:00:00.000Z',
    });
    expect(CreateOpportunityEventRequestSchema.safeParse(body).success).toBe(true);
  });

  it('is nothing for a form the contract would refuse', () => {
    expect(createEventBody(form({ to: '09:00' }), ZONE)).toBeNull();
    expect(createEventBody(form({ name: ' ' }), ZONE)).toBeNull();
    expect(createEventBody(form({ date: '' }), ZONE)).toBeNull();
  });
});

describe('the body of an edit', () => {
  const event = stored({ description: 'First call' });

  it('is empty when nothing changed', () => {
    expect(updateEventBody(event, eventFormOf(event), ZONE)).toEqual({});
  });

  it('names only the name when only the name changed', () => {
    expect(updateEventBody(event, { ...eventFormOf(event), name: 'Call back tomorrow' }, ZONE)).toEqual({
      name: 'Call back tomorrow',
    });
  });

  it('clears the description with null', () => {
    expect(updateEventBody(event, { ...eventFormOf(event), description: '' }, ZONE)).toEqual({ description: null });
  });

  it('sends the four members of the time together when any of them changed', () => {
    const body = updateEventBody(event, { ...eventFormOf(event), to: '11:00' }, ZONE);
    expect(body).toEqual({
      allDay: false,
      startsAt: '2026-10-09T08:00:00.000Z',
      endsAt: '2026-10-09T09:00:00.000Z',
      timeZone: ZONE,
    });
    expect(UpdateOpportunityEventRequestSchema.safeParse(body).success).toBe(true);
  });

  it('does not move an all-day Event made in another zone by re-sending instants it did not change', () => {
    // 12 October, all day, made in Auckland: its instants are not Warsaw's midnights.
    const far = stored({
      allDay: true,
      allDayDate: '2026-10-12',
      timeZone: 'Pacific/Auckland',
      startsAt: '2026-10-11T11:00:00.000Z',
      endsAt: '2026-10-12T11:00:00.000Z',
    });
    expect(eventFormOf(far).date).toBe('2026-10-12');
    expect(updateEventBody(far, { ...eventFormOf(far), name: 'Trade fair' }, ZONE)).toEqual({ name: 'Trade fair' });
  });

  it('adds a reminder, moves it, and removes it with null', () => {
    const plain = eventFormOf(event);
    expect(updateEventBody(event, { ...plain, remind: true, remindAt: '2026-10-09T09:45' }, ZONE)).toEqual({
      remindAt: '2026-10-09T07:45:00.000Z',
    });
    const reminded = stored({ reminder: { at: '2026-10-09T08:00:00.000Z', state: 'scheduled', handledAt: null, channels: [] } });
    const opened = eventFormOf(reminded);
    expect(opened).toMatchObject({ remind: true, remindAt: '2026-10-09T10:00' });
    expect(updateEventBody(reminded, opened, ZONE)).toEqual({});
    expect(updateEventBody(reminded, { ...opened, remindAt: '2026-10-09T09:00' }, ZONE)).toEqual({
      remindAt: '2026-10-09T07:00:00.000Z',
    });
    expect(updateEventBody(reminded, { ...opened, remind: false }, ZONE)).toEqual({ remindAt: null });
    expect(updateEventBody(event, { ...plain, remind: false }, ZONE)).toEqual({});
  });

  it('never names a member the strict schema does not know', () => {
    const body = updateEventBody(event, { ...eventFormOf(event), name: 'x', allDay: true, remind: true, remindAt: '2026-10-09T09:00' }, ZONE);
    expect(UpdateOpportunityEventRequestSchema.safeParse(body).success).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['allDay', 'endsAt', 'name', 'remindAt', 'startsAt', 'timeZone']);
  });
});

describe('a refusal of the server', () => {
  it('reads the rule when it is one the contract names', () => {
    expect(ruleOfDetails({ field: 'endsAt', rule: 'spans_days' })).toBe('spans_days');
    expect(ruleOfDetails({ field: 'endsAt', rule: 'made_up' })).toBeNull();
    expect(ruleOfDetails(undefined)).toBeNull();
    expect(ruleOfDetails([{ path: 'endsAt' }])).toBeNull();
  });

  it('puts a refused member under the field the form has for it', () => {
    expect(fieldOfDetails({ field: 'name' }, false)).toBe('name');
    expect(fieldOfDetails({ field: 'startsAt' }, false)).toBe('from');
    expect(fieldOfDetails({ field: 'endsAt' }, false)).toBe('to');
    expect(fieldOfDetails({ field: 'startsAt' }, true)).toBe('date');
    expect(fieldOfDetails({ field: 'endsAt' }, true)).toBe('date');
    expect(fieldOfDetails({ field: 'remindAt' }, false)).toBe('remindAt');
    expect(fieldOfDetails({ field: 'timeZone' }, false)).toBe('form');
    expect(fieldOfDetails(null, false)).toBe('form');
  });
});
