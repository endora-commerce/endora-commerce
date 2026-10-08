process.env['TZ'] = 'Europe/Warsaw';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CreateOpportunityEventRequestSchema,
  OpportunityEventListResponseSchema,
  OpportunityEventResponseSchema,
  UpdateOpportunityEventRequestSchema,
  opportunityEventReminderStateSchema,
  opportunityEventRuleSchema,
  type OpportunityEvent,
  type OpportunityEventReminder,
} from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { NOW, WARSAW, at, eventId, opportunityEvent } from './calendar-fixtures';
import {
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  WORKFLOW,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * The *Events* tab of the Opportunity screen and its dialog
 * (`specs/143-crm-sales-opportunities/`, User Story 21 — task T365; FR-130 –
 * FR-133, FR-137, FR-141; `contracts/admin-surfaces.md` §1b).
 *
 * The four Event routes are stubbed, and the stub holds both sides to the
 * contract: a body the page sends is parsed with the request schema before it
 * is "accepted", and every answer is parsed with the response schema before
 * the page sees it. The moment is fixed — Thursday 8 October 2026, 12:00 in
 * Warsaw — so "upcoming", "the next whole hour" and "in the future" are the
 * same on every run.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const EVENTS_PATH = `${DETAIL_PATH}/events`;
const READER = ['crm:read', 'orders:read'];

let current = detail();
let events: OpportunityEvent[] = [];

const reminder = (overrides: Partial<OpportunityEventReminder> = {}): OpportunityEventReminder => ({
  at: at('2026-10-09', '10:00'),
  state: 'scheduled',
  handledAt: null,
  channels: [],
  ...overrides,
});

/** Two behind, one under way, two ahead — given out of order, as nothing promises one. */
function planned(): OpportunityEvent[] {
  return [
    opportunityEvent(5, 'Contract signing', '2026-10-12', '10:00', '11:00'),
    opportunityEvent(1, 'First call', '2026-10-01', '09:00', '09:30'),
    opportunityEvent(3, 'Site visit', '2026-10-08', '11:30', '12:30', { description: 'Bring the samples.\nAsk about the depot.\nThird line.' }),
    opportunityEvent(2, 'Send the offer', '2026-10-06', '14:00', '15:00'),
    opportunityEvent(4, 'Trade fair', '2026-10-09', '00:00', '00:00', {
      allDay: true,
      allDayDate: '2026-10-09',
      endsAt: at('2026-10-10', '00:00'),
      reminder: reminder({ at: at('2026-10-09', '09:00') }),
    }),
  ];
}

const upcomingCount = (): number => events.filter((event) => Date.parse(event.endsAt) > NOW.getTime()).length;

const getCalls = (path: string): number => getSpy.mock.calls.filter(([asked]) => asked === path).length;

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  events = planned();
  current = detail({ upcomingEventCount: upcomingCount() });
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: { ...current, upcomingEventCount: upcomingCount() } });
    if (path === EVENTS_PATH) return Promise.resolve(OpportunityEventListResponseSchema.parse({ data: events }));
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
  });
  // A server that holds the page to the contract, and stores what it accepted.
  postSpy.mockImplementation((path: string, raw: unknown) => {
    expect(path).toBe(EVENTS_PATH);
    const body = CreateOpportunityEventRequestSchema.parse(raw);
    const created = OpportunityEventSchemaOf({
      id: eventId(90 + events.length),
      name: body.name,
      description: body.description ?? null,
      allDay: body.allDay,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      timeZone: body.timeZone,
      allDayDate: body.allDay ? new Date(Date.parse(body.startsAt) + 12 * 3_600_000).toISOString().slice(0, 10) : null,
      reminder: body.remindAt ? reminder({ at: body.remindAt }) : null,
    });
    events = [...events, created];
    return Promise.resolve(OpportunityEventResponseSchema.parse({ data: created }));
  });
  patchSpy.mockImplementation((path: string, raw: unknown) => {
    const body = UpdateOpportunityEventRequestSchema.parse(raw);
    const id = path.slice(EVENTS_PATH.length + 1);
    const before = events.find((event) => event.id === id);
    if (!before) return Promise.reject(new Error(`unexpected PATCH ${path}`));
    const { remindAt, ...rest } = body;
    // Only the members the body names: an absent one is not "set to undefined".
    const named = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
    const after = OpportunityEventSchemaOf({
      ...before,
      ...(named as Partial<OpportunityEvent>),
      ...(remindAt === undefined ? {} : { reminder: remindAt === null ? null : reminder({ at: remindAt }) }),
    });
    events = events.map((event) => (event.id === id ? after : event));
    return Promise.resolve(OpportunityEventResponseSchema.parse({ data: after }));
  });
  deleteSpy.mockImplementation((path: string) => {
    const id = path.slice(EVENTS_PATH.length + 1);
    events = events.filter((event) => event.id !== id);
    return Promise.resolve(undefined);
  });
});
afterEach(() => {
  vi.useRealTimers();
});

/** An Event as a route answers it, through the contract's schema. */
function OpportunityEventSchemaOf(partial: Partial<OpportunityEvent>): OpportunityEvent {
  return OpportunityEventResponseSchema.parse({
    data: { ...opportunityEvent(99, 'x', '2026-10-08', '10:00', '11:00'), ...partial },
  }).data;
}

async function renderTab(permissions?: readonly string[], search = ''): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}?tab=events${search}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  const panel = await screen.findByRole('tabpanel', { name: /^Events/ });
  await within(panel).findByRole('heading', { level: 2, name: en('events.title') });
  await waitFor(() => expect(within(panel).queryByText(en('events.loading'))).toBeNull());
  return panel;
}

/** The names of the Events listed under a group's heading, in order. */
function listed(panel: HTMLElement, group: 'upcoming' | 'past'): string[] {
  const section = within(panel).queryByRole('region', { name: en(`events.${group}`) });
  if (!section) return [];
  return within(section)
    .queryAllByRole('heading', { level: 4 })
    .map((heading) => heading.textContent ?? '');
}

const rowOf = (name: string): HTMLElement =>
  screen.getByRole('heading', { level: 4, name }).closest('li') as HTMLElement;

async function openAdd(panel: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(panel).getByRole('button', { name: en('events.add') }));
  return screen.findByRole('dialog', { name: en('events.dialog.addTitle') });
}

const field = (dialog: HTMLElement, key: string): HTMLInputElement =>
  within(dialog).getByLabelText(en(`events.field.${key}`)) as HTMLInputElement;

const set = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

const save = async (dialog: HTMLElement): Promise<void> => {
  await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
};

/** The sentence under a field: what its `aria-describedby` points at. */
function describedBy(input: HTMLElement): string {
  const id = input.getAttribute('aria-describedby');
  return id ? (document.getElementById(id)?.textContent ?? '') : '';
}

describe('Events tab — its place in the strip', () => {
  it('is third, after Links, and its label counts the Events that have not ended', async () => {
    await renderTab();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs[2]).toHaveTextContent(`${en('opportunity.tabs.events')} 3`);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: `${en('opportunity.tabs.events')} 3` })).toBe(tabs[2]);
  });

  it('carries no number when nothing is ahead', async () => {
    events = planned().slice(1, 2);
    await renderTab();
    expect(screen.getByRole('tab', { name: en('opportunity.tabs.events') })).toHaveTextContent(/^Events$/);
  });
});

describe('Events tab — the list', () => {
  it('lists what has not ended first and soonest first, then what is over, latest first', async () => {
    const panel = await renderTab();
    // "Site visit" started at 11:30 and ends at 12:30: at 12:00 it is not over.
    expect(listed(panel, 'upcoming')).toEqual(['Site visit', 'Trade fair', 'Contract signing']);
    expect(listed(panel, 'past')).toEqual(['Send the offer', 'First call']);
  });

  it('writes each Event’s day and time in the browser’s zone, and “all day” for a date', async () => {
    await renderTab();
    expect(within(rowOf('Site visit')).getByText('Thursday, October 8, 2026, 11:30 AM – 12:30 PM')).toBeInTheDocument();
    expect(within(rowOf('Trade fair')).getByText('Friday, October 9, 2026, all day')).toBeInTheDocument();
    expect(within(rowOf('Site visit')).getByText(/Bring the samples/)).toHaveClass('line-clamp-2');
  });

  it.each([
    ['scheduled', {}, 'Reminder scheduled for Oct 9, 2026, 10:00 AM'],
    ['paused', {}, 'Reminder for Oct 9, 2026, 10:00 AM is held while the opportunity is closed'],
    [
      'sent',
      { handledAt: at('2026-10-09', '10:01'), channels: ['bell', 'email'] as const },
      'Reminder sent Oct 9, 2026, 10:01 AM — notification bell and e-mail',
    ],
    ['missed', { handledAt: at('2026-10-11', '08:00') }, 'Reminder for Oct 9, 2026, 10:00 AM was missed — it was not sent'],
    ['no_recipient', { handledAt: at('2026-10-09', '10:00') }, 'Reminder for Oct 9, 2026, 10:00 AM: there was nobody to remind'],
    ['undeliverable', { handledAt: at('2026-10-09', '10:00') }, 'Reminder for Oct 9, 2026, 10:00 AM could not be delivered'],
    ['interrupted', { handledAt: null }, 'Reminder for Oct 9, 2026, 10:00 AM was interrupted and may not have been delivered'],
  ] as const)('says in words what became of a reminder that is %s', async (state, overrides, sentence) => {
    events = [
      opportunityEvent(1, 'Call back', '2026-10-09', '10:00', '10:30', {
        reminder: reminder({ state, ...overrides, channels: [...('channels' in overrides ? overrides.channels : [])] }),
      }),
    ];
    await renderTab();
    expect(within(rowOf('Call back')).getByText(sentence)).toBeInTheDocument();
    expect(en(`events.reminder.${state}`)).toBeTruthy();
  });

  it('has a sentence for every state the contract names', () => {
    for (const state of opportunityEventReminderStateSchema.options) {
      expect(en(`events.reminder.${state}`), state).not.toBe('');
    }
  });

  it('says nothing about a reminder for an Event that has none', async () => {
    await renderTab();
    expect(within(rowOf('Site visit')).queryByText(/Reminder/)).toBeNull();
  });

  it('shows the first ten past Events and the rest on request', async () => {
    events = Array.from({ length: 13 }, (_, index) =>
      opportunityEvent(index + 1, `Past ${String(index + 1).padStart(2, '0')}`, `2026-09-${String(index + 1).padStart(2, '0')}`, '09:00', '10:00'),
    );
    const panel = await renderTab();
    expect(listed(panel, 'past')).toHaveLength(10);
    expect(listed(panel, 'past')[0]).toBe('Past 13');
    expect(within(panel).getByText(en('events.upcomingEmpty'))).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: en('events.showAllPast', { count: 13 }) }));
    expect(listed(panel, 'past')).toHaveLength(13);
    expect(within(panel).queryByRole('button', { name: /Show all past/ })).toBeNull();
  });

  it('says there is nothing yet, with a pointer to the one action — and without it for a reader', async () => {
    events = [];
    const panel = await renderTab();
    expect(within(panel).getByText(en('events.empty'))).toBeInTheDocument();
    expect(within(panel).getByText(en('events.emptyHint'))).toBeInTheDocument();
    expect(within(panel).queryByRole('table')).toBeNull();
  });

  it('says a read failed and reads again on Retry', async () => {
    let fail = true;
    const base = getSpy.getMockImplementation() as (path: string) => Promise<unknown>;
    getSpy.mockImplementation((path: string) =>
      path === EVENTS_PATH && fail ? Promise.reject(new Error('network')) : base(path),
    );
    const panel = await renderTab();
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent(en('events.error.load'));
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: core('common.action.retry') }));
    await waitFor(() => expect(listed(panel, 'upcoming')).toHaveLength(3));
    expect(within(panel).queryByRole('alert')).toBeNull();
  });

  it('links to the Calendar', async () => {
    const panel = await renderTab();
    expect(within(panel).getByRole('link', { name: en('events.openCalendar') })).toHaveAttribute('href', '/crm/calendar');
  });
});

describe('Events tab — a reader', () => {
  it('sees the list and the calendar, and nothing that adds, changes or deletes', async () => {
    const panel = await renderTab(READER);
    expect(listed(panel, 'upcoming')).toHaveLength(3);
    expect(within(panel).getByRole('table', { name: 'October 2026' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: en('events.add') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Delete / })).toBeNull();
  });

  it('is told nothing was planned, not how to plan it', async () => {
    events = [];
    const panel = await renderTab(READER);
    expect(within(panel).getByText(en('events.emptyReadOnly'))).toBeInTheDocument();
    expect(within(panel).queryByText(en('events.emptyHint'))).toBeNull();
  });
});

describe('Events tab — a closed Opportunity', () => {
  it('keeps its Events and their editing, and says quietly what closing changed', async () => {
    current = detail({ status: { code: 'won', name: 'Won', color: '#10b981', kind: 'won' }, closedKind: 'won', closedAt: '2026-10-07T10:00:00.000Z', allowedTransitions: [] });
    const panel = await renderTab();
    expect(within(panel).getByRole('note')).toHaveTextContent(en('events.closedNote'));
    expect(listed(panel, 'upcoming')).toHaveLength(3);
    expect(within(panel).getByRole('button', { name: en('events.add') })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: en('events.editNamed', { name: 'Site visit' }) })).toBeEnabled();
  });

  it('says nothing of the kind on an open one', async () => {
    const panel = await renderTab();
    expect(within(panel).queryByRole('note')).toBeNull();
  });
});

describe('Events tab — the Event an address points at', () => {
  it('marks that Event’s row and no other', async () => {
    const panel = await renderTab(undefined, `&event=${eventId(5)}`);
    const marked = panel.querySelectorAll('li[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(rowOf('Contract signing'));
  });

  it('brings a marked Event out from behind “Show all”', async () => {
    events = Array.from({ length: 13 }, (_, index) =>
      opportunityEvent(index + 1, `Past ${String(index + 1).padStart(2, '0')}`, `2026-09-${String(index + 1).padStart(2, '0')}`, '09:00', '10:00'),
    );
    const panel = await renderTab(undefined, `&event=${eventId(1)}`);
    await waitFor(() => expect(listed(panel, 'past')).toHaveLength(13));
    expect(rowOf('Past 01')).toHaveAttribute('aria-current', 'true');
  });

  it('turns the tab’s calendar to that Event’s month', async () => {
    events = [...planned(), opportunityEvent(7, 'Renewal talk', '2026-12-03', '10:00', '11:00')];
    const panel = await renderTab(undefined, `&event=${eventId(7)}`);
    expect(await within(panel).findByRole('table', { name: 'December 2026' })).toBeInTheDocument();
  });

  it('ignores an id that is not one of this Opportunity’s Events', async () => {
    const panel = await renderTab(undefined, '&event=00000000-0000-4000-8000-00000000ffff');
    expect(panel.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
    expect(listed(panel, 'upcoming')).toHaveLength(3);
  });
});

describe('Events tab — its calendar', () => {
  it('draws this Opportunity’s Events on a month, with Month and Week to choose from and each entry a link back here', async () => {
    const panel = await renderTab();
    const table = within(panel).getByRole('table', { name: 'October 2026' });
    expect(within(panel).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['month', 'week']);
    const link = within(table).getByRole('link', { name: /^Contract signing,/ });
    expect(link).toHaveAttribute('href', `/crm/opportunities/${OPPORTUNITY_ID}?tab=events&event=${eventId(5)}`);
    // On the tab an entry is not named by its Opportunity: the reader is on it.
    expect(link).toHaveAccessibleName('Contract signing, Monday, October 12, 2026, 10:00 AM – 11:00 AM');
    // The page has one h1 and the tab one h2; the calendar's range is under it.
    expect(within(panel).getByRole('heading', { level: 3, name: 'October 2026' })).toBeInTheDocument();
  });

  it('marks the row of an entry that is pressed', async () => {
    const panel = await renderTab();
    await userEvent.click(within(within(panel).getByRole('table')).getByRole('link', { name: /^Contract signing,/ }));
    await waitFor(() => expect(rowOf('Contract signing')).toHaveAttribute('aria-current', 'true'));
  });

  it('is not drawn under 640 px — the list above is the agenda', async () => {
    setMobileViewport(true);
    const panel = await renderTab();
    expect(listed(panel, 'upcoming')).toHaveLength(3);
    expect(within(panel).queryByRole('table')).toBeNull();
    expect(within(panel).queryByRole('toolbar')).toBeNull();
  });
});

describe('Event dialog — adding', () => {
  beforeEach(() => {
    events = [];
  });

  it('opens with the focus on the name, today, the next whole hour and an hour after, and no reminder', async () => {
    const dialog = await openAdd(await renderTab());
    expect(field(dialog, 'name')).toHaveFocus();
    expect(field(dialog, 'name')).toHaveAttribute('maxlength', '200');
    expect(field(dialog, 'description')).toHaveAttribute('maxlength', '5000');
    expect(field(dialog, 'date')).toHaveValue('2026-10-08');
    expect(field(dialog, 'from')).toHaveValue('13:00');
    expect(field(dialog, 'to')).toHaveValue('14:00');
    expect(field(dialog, 'allDay')).not.toBeChecked();
    expect(field(dialog, 'remind')).not.toBeChecked();
    expect(within(dialog).queryByLabelText(en('events.field.remindAt'))).toBeNull();
  });

  // Owner ruling, 2026-10-08: plain today. The first build offered the day
  // after the Opportunity's latest Event, and a date that skips ahead on its
  // own is a date nobody checks.
  it('offers today whatever the Opportunity already has planned', async () => {
    events = planned();
    const dialog = await openAdd(await renderTab());
    expect(field(dialog, 'date')).toHaveValue('2026-10-08');
    expect(field(dialog, 'from')).toHaveValue('13:00');
    expect(field(dialog, 'to')).toHaveValue('14:00');
  });

  it('sends instants and the browser’s zone, then reads the list and the Opportunity again and says what was saved', async () => {
    const panel = await renderTab();
    const dialog = await openAdd(panel);
    await userEvent.type(field(dialog, 'name'), 'Call back about the offer');
    set(field(dialog, 'date'), '2026-10-09');
    set(field(dialog, 'from'), '10:00');
    set(field(dialog, 'to'), '10:30');
    await userEvent.type(field(dialog, 'description'), 'Ask about the depot.');
    await save(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]).toEqual([
      EVENTS_PATH,
      {
        name: 'Call back about the offer',
        description: 'Ask about the depot.',
        allDay: false,
        startsAt: '2026-10-09T08:00:00.000Z',
        endsAt: '2026-10-09T08:30:00.000Z',
        timeZone: WARSAW,
        remindAt: null,
      },
    ]);
    await waitFor(() => expect(listed(panel, 'upcoming')).toEqual(['Call back about the offer']));
    expect(getCalls(EVENTS_PATH)).toBe(2);
    expect(getCalls(DETAIL_PATH)).toBe(2);
    // The Opportunity was read again: the tab's label counts the new Event.
    expect(await screen.findByRole('tab', { name: `${en('opportunity.tabs.events')} 1` })).toBeInTheDocument();
    expect(within(panel).getByText(en('events.saved.created', { name: 'Call back about the offer' }))).toHaveAttribute('role', 'status');
  });

  it('takes the two times out of the form for All day, and sends the local midnights of the date', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Trade fair');
    await userEvent.click(field(dialog, 'allDay'));
    expect(within(dialog).queryByLabelText(en('events.field.from'))).toBeNull();
    expect(within(dialog).queryByLabelText(en('events.field.to'))).toBeNull();
    set(field(dialog, 'date'), '2026-10-12');
    await save(dialog);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({
      allDay: true,
      startsAt: '2026-10-11T22:00:00.000Z',
      endsAt: '2026-10-12T22:00:00.000Z',
      timeZone: WARSAW,
    });
  });

  it('moves To by as much as From was moved', async () => {
    const dialog = await openAdd(await renderTab());
    set(field(dialog, 'to'), '14:45');
    set(field(dialog, 'from'), '09:30');
    expect(field(dialog, 'to')).toHaveValue('11:15');
    // To alone moves nothing else.
    set(field(dialog, 'to'), '12:00');
    expect(field(dialog, 'from')).toHaveValue('09:30');
  });

  it('shows the reminder time with Remind me — set to the start, following it until it is edited, and not after', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.click(field(dialog, 'remind'));
    const remindAt = field(dialog, 'remindAt');
    expect(remindAt).toHaveAttribute('type', 'datetime-local');
    expect(remindAt).toHaveValue('2026-10-08T13:00');
    // It follows the start…
    set(field(dialog, 'from'), '15:30');
    expect(remindAt).toHaveValue('2026-10-08T15:30');
    set(field(dialog, 'date'), '2026-10-09');
    expect(remindAt).toHaveValue('2026-10-09T15:30');
    // …until it is set by hand.
    set(remindAt, '2026-10-09T08:00');
    set(field(dialog, 'from'), '16:00');
    set(field(dialog, 'date'), '2026-10-12');
    expect(remindAt).toHaveValue('2026-10-09T08:00');

    await userEvent.type(field(dialog, 'name'), 'Call back');
    await save(dialog);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({
      startsAt: '2026-10-12T14:00:00.000Z',
      remindAt: '2026-10-09T06:00:00.000Z',
    });
  });

  it('offers 09:00 on the date for an all-day Event', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.click(field(dialog, 'remind'));
    await userEvent.click(field(dialog, 'allDay'));
    expect(field(dialog, 'remindAt')).toHaveValue('2026-10-08T09:00');
    set(field(dialog, 'date'), '2026-10-20');
    expect(field(dialog, 'remindAt')).toHaveValue('2026-10-20T09:00');
  });

  it('says under To that the end is not after the start, and sends nothing', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Call back');
    set(field(dialog, 'to'), '12:00');
    await save(dialog);
    const to = field(dialog, 'to');
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(to)).toBe(en('events.error.ends_before_start'));
    expect(field(dialog, 'from')).toHaveAttribute('aria-invalid', 'false');
    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says under Remind at that the time is not in the future, and sends nothing', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Call back');
    await userEvent.click(field(dialog, 'remind'));
    set(field(dialog, 'remindAt'), '2026-10-08T11:59');
    await save(dialog);
    expect(field(dialog, 'remindAt')).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(field(dialog, 'remindAt'))).toBe(en('events.error.reminder_in_past'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('asks for a name under the name, and does not complain before Save', async () => {
    const dialog = await openAdd(await renderTab());
    expect(field(dialog, 'name')).toHaveAttribute('aria-invalid', 'false');
    await save(dialog);
    expect(describedBy(field(dialog, 'name'))).toBe(en('events.error.nameRequired'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['endsAt', 'spans_days', 'to'],
    ['startsAt', 'ends_before_start', 'from'],
    ['remindAt', 'reminder_in_past', 'remindAt'],
  ] as const)('puts the server’s refusal of %s (%s) under the field it is about, in the bundle’s words', async (member, rule, key) => {
    postSpy.mockImplementation(() =>
      Promise.reject(
        new ApiError(422, {
          error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: { field: member, rule } },
        }),
      ),
    );
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Call back');
    await userEvent.click(field(dialog, 'remind'));
    await save(dialog);
    await waitFor(() => expect(field(dialog, key)).toHaveAttribute('aria-invalid', 'true'));
    expect(describedBy(field(dialog, key))).toBe(en(`events.error.${rule}`));
    // Still open, still editable, and the button is itself again.
    expect(within(dialog).getByRole('button', { name: core('common.action.save') })).toBeEnabled();
  });

  it('puts a refused whole day under the date', async () => {
    postSpy.mockImplementation(() =>
      Promise.reject(
        new ApiError(422, {
          error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: { field: 'endsAt', rule: 'not_whole_day' } },
        }),
      ),
    );
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Trade fair');
    await userEvent.click(field(dialog, 'allDay'));
    await save(dialog);
    await waitFor(() => expect(describedBy(field(dialog, 'date'))).toBe(en('events.error.not_whole_day')));
  });

  it('has words for every rule the contract names', () => {
    for (const rule of opportunityEventRuleSchema.options) {
      expect(en(`events.error.${rule}`), rule).not.toBe('');
    }
  });

  it('shows the server’s own sentence for a refusal that names no rule', async () => {
    postSpy.mockImplementation(() =>
      Promise.reject(new ApiError(404, { error: { code: 'CRM_OPPORTUNITY_NOT_FOUND', message: 'The opportunity was not found.' } })),
    );
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Call back');
    await save(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The opportunity was not found.');
  });

  it('closes on Cancel without sending anything', async () => {
    const dialog = await openAdd(await renderTab());
    await userEvent.type(field(dialog, 'name'), 'Call back');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('Event dialog — editing and deleting', () => {
  const openEdit = async (panel: HTMLElement, name: string): Promise<HTMLElement> => {
    await userEvent.click(within(panel).getByRole('button', { name: en('events.editNamed', { name }) }));
    return screen.findByRole('dialog', { name: en('events.dialog.editTitle') });
  };

  it('opens with the Event as it is, in the browser’s zone', async () => {
    const dialog = await openEdit(await renderTab(), 'Site visit');
    expect(field(dialog, 'name')).toHaveValue('Site visit');
    expect(field(dialog, 'date')).toHaveValue('2026-10-08');
    expect(field(dialog, 'from')).toHaveValue('11:30');
    expect(field(dialog, 'to')).toHaveValue('12:30');
    expect(field(dialog, 'description')).toHaveValue('Bring the samples.\nAsk about the depot.\nThird line.');
  });

  it('sends only what changed, then reads the list and the Opportunity again', async () => {
    const panel = await renderTab();
    const dialog = await openEdit(panel, 'Contract signing');
    await userEvent.clear(field(dialog, 'name'));
    await userEvent.type(field(dialog, 'name'), 'Contract signing at the depot');
    await save(dialog);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]).toEqual([
      `${EVENTS_PATH}/${eventId(5)}`,
      { name: 'Contract signing at the depot' },
    ]);
    await waitFor(() => expect(listed(panel, 'upcoming')).toContain('Contract signing at the depot'));
    expect(getCalls(EVENTS_PATH)).toBe(2);
    expect(getCalls(DETAIL_PATH)).toBe(2);
    expect(
      within(panel).getByText(en('events.saved.updated', { name: 'Contract signing at the depot' })),
    ).toHaveAttribute('role', 'status');
  });

  it('sends nothing at all when nothing changed', async () => {
    const dialog = await openEdit(await renderTab(), 'Contract signing');
    await save(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('removes a reminder with null, and opens one that is at the start still following it', async () => {
    const panel = await renderTab();
    const dialog = await openEdit(panel, 'Trade fair');
    expect(field(dialog, 'remind')).toBeChecked();
    expect(field(dialog, 'remindAt')).toHaveValue('2026-10-09T09:00');
    // Stored at 09:00 on its date — the offered time — so it still follows the date.
    set(field(dialog, 'date'), '2026-10-10');
    expect(field(dialog, 'remindAt')).toHaveValue('2026-10-10T09:00');
    await userEvent.click(field(dialog, 'remind'));
    expect(within(dialog).queryByLabelText(en('events.field.remindAt'))).toBeNull();
    await save(dialog);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      allDay: true,
      startsAt: '2026-10-09T22:00:00.000Z',
      endsAt: '2026-10-10T22:00:00.000Z',
      timeZone: WARSAW,
      remindAt: null,
    });
  });

  it('leaves a reminder that was set by hand where it is when the Event moves', async () => {
    events = [
      opportunityEvent(1, 'Call back', '2026-10-09', '10:00', '10:30', { reminder: reminder({ at: at('2026-10-09', '08:15') }) }),
    ];
    const dialog = await openEdit(await renderTab(), 'Call back');
    set(field(dialog, 'from'), '14:00');
    expect(field(dialog, 'remindAt')).toHaveValue('2026-10-09T08:15');
    await save(dialog);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).not.toHaveProperty('remindAt');
  });

  it('lets the name of an Event whose reminder was already sent be corrected', async () => {
    events = [
      opportunityEvent(1, 'Frist call', '2026-10-01', '09:00', '09:30', {
        reminder: reminder({ at: at('2026-10-01', '09:00'), state: 'sent', handledAt: at('2026-10-01', '09:00'), channels: ['bell'] }),
      }),
    ];
    const panel = await renderTab();
    const dialog = await openEdit(panel, 'Frist call');
    await userEvent.clear(field(dialog, 'name'));
    await userEvent.type(field(dialog, 'name'), 'First call');
    await save(dialog);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ name: 'First call' });
  });

  it('asks before deleting, naming the Event, then deletes and reads both again', async () => {
    const panel = await renderTab();
    await userEvent.click(within(panel).getByRole('button', { name: en('events.removeNamed', { name: 'Site visit' }) }));
    const dialog = await screen.findByRole('dialog', { name: en('events.remove.title') });
    expect(dialog).toHaveTextContent(
      en('events.remove.body', { name: 'Site visit', when: 'Thursday, October 8, 2026, 11:30 AM – 12:30 PM' }),
    );
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('events.remove.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${EVENTS_PATH}/${eventId(3)}`));
    await waitFor(() => expect(listed(panel, 'upcoming')).toEqual(['Trade fair', 'Contract signing']));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getCalls(EVENTS_PATH)).toBe(2);
    expect(getCalls(DETAIL_PATH)).toBe(2);
    expect(within(panel).getByText(en('events.saved.deleted', { name: 'Site visit' }))).toHaveAttribute('role', 'status');
    expect(await screen.findByRole('tab', { name: `${en('opportunity.tabs.events')} 2` })).toBeInTheDocument();
  });

  it('does not put an older list back when a slow read answers after a later one', async () => {
    const panel = await renderTab();
    // The read after the delete is slow, and answers what the list was when it was asked.
    let release: (() => void) | undefined;
    const base = getSpy.getMockImplementation() as (path: string) => Promise<unknown>;
    let slow = true;
    getSpy.mockImplementation((path: string) => {
      if (path !== EVENTS_PATH || !slow) return base(path);
      slow = false;
      const stale = OpportunityEventListResponseSchema.parse({ data: events });
      return new Promise((resolve) => {
        release = (): void => resolve(stale);
      });
    });
    await userEvent.click(within(panel).getByRole('button', { name: en('events.removeNamed', { name: 'Site visit' }) }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: en('events.remove.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // A second write while that read is still out: its own read answers first.
    const dialog = await openAdd(panel);
    await userEvent.type(field(dialog, 'name'), 'Follow-up call');
    set(field(dialog, 'date'), '2026-10-13');
    await save(dialog);
    await waitFor(() => expect(listed(panel, 'upcoming')).toContain('Follow-up call'));

    expect(release).toBeDefined();
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listed(panel, 'upcoming')).toContain('Follow-up call');
    expect(listed(panel, 'upcoming')).not.toContain('Site visit');
  });

  it('deletes nothing on Cancel, and says so when the delete fails', async () => {
    const panel = await renderTab();
    await userEvent.click(within(panel).getByRole('button', { name: en('events.removeNamed', { name: 'Site visit' }) }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));
    expect(deleteSpy).not.toHaveBeenCalled();

    deleteSpy.mockImplementation(() => Promise.reject(new Error('network')));
    await userEvent.click(within(panel).getByRole('button', { name: en('events.removeNamed', { name: 'Site visit' }) }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: en('events.remove.confirm') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en('events.remove.error'));
    expect(listed(panel, 'upcoming')).toContain('Site visit');
  });
});
