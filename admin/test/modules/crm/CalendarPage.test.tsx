process.env['TZ'] = 'Europe/Warsaw';

import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { useLocation, useNavigationType } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {
  CalendarEventsQuerySchema,
  type CalendarEventsResponse,
} from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { NOW, calendarEvent, calendarResponse, eventId, opportunityId } from './calendar-fixtures';
import { core, en, renderCrm } from './crm-fixtures';

/**
 * The CRM Calendar page (`specs/143-crm-sales-opportunities/`, User Story 22 —
 * task T364; FR-142 – FR-146, FR-148, FR-151; `contracts/admin-surfaces.md`
 * §1b): the address read and written, the range asked for each view, nothing
 * asked while moving inside a loaded range, *Mine / All* drawn from what the
 * server says the reader may ask for, and no write.
 *
 * **Every request the page makes is parsed with the contract's query schema**
 * by the stub below — a `from` / `to` the route would refuse is refused here —
 * and every answer is built by `calendar-fixtures.ts` through the contract's
 * response schema.
 */

const getSpy = vi.fn();
const writeSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => writeSpy('POST', ...args),
      put: (...args: unknown[]) => writeSpy('PUT', ...args),
      patch: (...args: unknown[]) => writeSpy('PATCH', ...args),
      delete: (...args: unknown[]) => writeSpy('DELETE', ...args),
    },
  };
});

const { CalendarPage } = await import('../../../../packages/modules/crm/src/admin/pages/CalendarPage');

const CALENDAR_PATH = '/api/v1/admin/crm/calendar/events';

interface Asked {
  from: string;
  to: string;
  scope: string | null;
}

/** Every Calendar read made so far, oldest first — each one a query the contract accepts. */
function requests(): Asked[] {
  return getSpy.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(`${CALENDAR_PATH}?`))
    .map((path) => {
      const query = new URLSearchParams(path.split('?')[1]);
      return { from: query.get('from') ?? '', to: query.get('to') ?? '', scope: query.get('scope') };
    });
}

let answer: (asked: Asked) => Promise<CalendarEventsResponse>;

const OCTOBER = [
  calendarEvent(1, 'Kick-off', '2026-10-05', '10:00', '11:00'),
  calendarEvent(2, 'Call back', '2026-10-08', '09:00', '09:30', { hasReminder: true }),
  calendarEvent(3, 'Site visit', '2026-10-08', '13:00', '14:30', {
    opportunity: { id: opportunityId(2), number: 'OPP-000002', title: 'Depot lighting', assignee: null },
  }),
];

beforeEach(() => {
  getSpy.mockReset();
  writeSpy.mockReset();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  answer = () => Promise.resolve(calendarResponse(OCTOBER));
  getSpy.mockImplementation((path: string) => {
    if (!path.startsWith(`${CALENDAR_PATH}?`)) return Promise.reject(new Error(`unexpected GET ${path}`));
    const raw = path.split('?')[1] ?? '';
    // An unencoded `+` of an offset would arrive as a space: the page writes `Z`.
    expect(raw).not.toMatch(/\+|%2B| /);
    const query = Object.fromEntries(new URLSearchParams(raw));
    const parsed = CalendarEventsQuerySchema.parse(query);
    return answer({ from: parsed.from, to: parsed.to, scope: parsed.scope ?? null });
  });
});
afterEach(() => {
  vi.useRealTimers();
});

function AddressProbe(): ReactElement {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <span data-testid="address">{`${location.pathname}${location.search}`}</span>
      <span data-testid="navigation">{type}</span>
    </>
  );
}

const address = (): string => screen.getByTestId('address').textContent ?? '';

async function renderPage(search = '', permissions?: readonly string[]): Promise<void> {
  renderCrm(
    <>
      <CalendarPage />
      <AddressProbe />
    </>,
    { path: `/crm/calendar${search}`, pattern: '/crm/calendar', ...(permissions ? { permissions } : {}) },
  );
  await screen.findByRole('heading', { level: 1, name: en('calendar.title') });
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}

const entryLinks = (): HTMLElement[] =>
  screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('event='));

describe('CalendarPage — what it asks the server', () => {
  it('opens on the current month and asks once, for the 42 days drawn and one more each side', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('October 2026');
    expect(screen.getByRole('table', { name: 'October 2026' })).toBeInTheDocument();
    // The grid is 28 September – 8 November; asked from 27 September 00:00 (+02:00)
    // to 10 November 00:00 (+01:00 — the clocks went back on 25 October).
    expect(requests()).toEqual([
      { from: '2026-09-26T22:00:00.000Z', to: '2026-11-09T23:00:00.000Z', scope: null },
    ]);
  });

  it.each([
    ['week', '2026-10-03T22:00:00.000Z', '2026-10-12T22:00:00.000Z'],
    ['day', '2026-10-06T22:00:00.000Z', '2026-10-09T22:00:00.000Z'],
    ['agenda', '2026-10-06T22:00:00.000Z', '2026-11-07T23:00:00.000Z'],
  ])('asks for the %s view’s own days, one wider each side', async (view, from, to) => {
    await renderPage(`?view=${view}`);
    expect(requests()).toEqual([{ from, to, scope: null }]);
  });

  it('asks nothing while moving inside the range it already holds', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.week') }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.week') }));
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.day') }));
    await userEvent.click(screen.getByRole('button', { name: en('calendar.previous.day') }));
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.month') }));
    expect(requests()).toHaveLength(1);
    // The entries are still the ones that were read.
    expect(entryLinks()).toHaveLength(3);
  });

  it('asks again once the view leaves that range', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.month') }));
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(requests()[1]).toEqual({
      from: '2026-10-24T22:00:00.000Z', // 25 October 00:00 +02:00 — the Sunday before the grid's Monday
      to: '2026-12-07T23:00:00.000Z',
      scope: null,
    });
  });

  it('asks again for a narrower range when the answer it holds was cut', async () => {
    answer = () => Promise.resolve(calendarResponse(OCTOBER, { truncated: true }));
    await renderPage();
    expect(screen.getByRole('status')).toHaveTextContent(en('calendar.truncated', { count: 500 }));
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.week') }));
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(requests()[1]?.from).toBe('2026-10-03T22:00:00.000Z');
  });

  it('shows the range that is asked for now, not a late answer to one that was left', async () => {
    const pending: Array<(response: CalendarEventsResponse) => void> = [];
    await renderPage();
    answer = () => new Promise((resolve) => pending.push(resolve));
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.month') }));
    await waitFor(() => expect(pending).toHaveLength(1));
    // Back before November answered: October is still held, so nothing is asked.
    await userEvent.click(screen.getByRole('button', { name: en('calendar.previous.month') }));
    await waitFor(() => expect(entryLinks()).toHaveLength(3));
    pending[0]?.(calendarResponse([calendarEvent(9, 'November only', '2026-11-12', '09:00', '10:00')]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('October 2026');
    expect(screen.queryByRole('link', { name: /November only/ })).toBeNull();
    expect(entryLinks()).toHaveLength(3);
  });

  it('says a read failed and reads again on Retry', async () => {
    answer = () => Promise.reject(new Error('network'));
    await renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en('calendar.error'));
    answer = () => Promise.resolve(calendarResponse(OCTOBER));
    await userEvent.click(within(alert).getByRole('button', { name: core('common.action.retry') }));
    await waitFor(() => expect(entryLinks()).toHaveLength(3));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(requests()).toHaveLength(2);
  });

  it('says so in words when the range holds nothing', async () => {
    answer = () => Promise.resolve(calendarResponse([]));
    await renderPage();
    expect(screen.getByRole('status')).toHaveTextContent(en('calendar.empty'));
  });
});

describe('CalendarPage — its address', () => {
  it('reads the view, the date and the scope from the address', async () => {
    await renderPage('?view=week&date=2026-11-02&scope=mine');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/November 2\s–\s8, 2026/);
    expect(screen.getByRole('radio', { name: en('calendar.view.week') })).toBeChecked();
    expect(requests()).toEqual([
      { from: '2026-10-31T23:00:00.000Z', to: '2026-11-09T23:00:00.000Z', scope: 'mine' },
    ]);
  });

  it('falls back to this month, today and the server’s default for an address it cannot read', async () => {
    await renderPage('?view=year&date=2026-02-30&scope=team');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('October 2026');
    expect(requests()).toEqual([
      { from: '2026-09-26T22:00:00.000Z', to: '2026-11-09T23:00:00.000Z', scope: null },
    ]);
  });

  it('writes the view and the date with replace, and the defaults as the bare address', async () => {
    await renderPage();
    expect(address()).toBe('/crm/calendar');
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.week') }));
    expect(address()).toBe('/crm/calendar?view=week');
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.week') }));
    expect(address()).toBe('/crm/calendar?view=week&date=2026-10-15');
    await userEvent.click(screen.getByRole('button', { name: en('calendar.today') }));
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.month') }));
    expect(address()).toBe('/crm/calendar');
  });

  it('opens the day of a “more” — written to the address, asked of nobody', async () => {
    answer = () =>
      Promise.resolve(
        calendarResponse([
          ...OCTOBER,
          calendarEvent(4, 'Offer review', '2026-10-08', '15:00', '16:00'),
          calendarEvent(5, 'Wrap-up', '2026-10-08', '17:00', '17:30'),
        ]),
      );
    await renderPage('?date=2026-10-20');
    await userEvent.click(screen.getByRole('button', { name: /1 more events on Thursday, October 8/ }));
    expect(address()).toBe('/crm/calendar?view=day');
    expect(entryLinks()).toHaveLength(4);
    expect(requests()).toHaveLength(1);
  });
});

describe('CalendarPage — Mine / All', () => {
  const scopeGroup = (): HTMLElement | null => screen.queryByRole('radiogroup', { name: en('calendar.scope.label') });

  it('offers both to a reader the server says may ask for both, with the applied one chosen', async () => {
    await renderPage();
    const group = scopeGroup() as HTMLElement;
    expect(within(group).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['mine', 'all']);
    // The address asked for nothing; the server applied `all`.
    expect(within(group).getByRole('radio', { name: en('calendar.scope.all') })).toBeChecked();
  });

  it('asks for Mine when it is chosen, and keeps the choice in the address', async () => {
    answer = (asked) =>
      Promise.resolve(
        calendarResponse(asked.scope === 'mine' ? OCTOBER.slice(0, 2) : OCTOBER, {
          scope: asked.scope === 'mine' ? 'mine' : 'all',
        }),
      );
    await renderPage();
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.scope.mine') }));
    await waitFor(() => expect(entryLinks()).toHaveLength(2));
    expect(address()).toBe('/crm/calendar?scope=mine');
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    expect(requests().map((asked) => asked.scope)).toEqual([null, 'mine']);
    expect(screen.getByRole('radio', { name: en('calendar.scope.mine') })).toBeChecked();
  });

  it('offers nothing at all to a reader confined to their own — whatever the address asks', async () => {
    answer = () => Promise.resolve(calendarResponse(OCTOBER.slice(0, 2), { scope: 'mine', scopes: ['mine'] }));
    await renderPage('?scope=all');
    // Asked as the address says; answered as `mine`, which is not an error.
    expect(requests()[0]?.scope).toBe('all');
    expect(scopeGroup()).toBeNull();
    expect(screen.queryByRole('radio', { name: en('calendar.scope.all') })).toBeNull();
    expect(entryLinks()).toHaveLength(2);
  });

  it('shows the scope the server applied, not the one the address asked for', async () => {
    answer = () => Promise.resolve(calendarResponse(OCTOBER, { scope: 'mine', scopes: ['all', 'mine'] }));
    await renderPage('?scope=all');
    expect(screen.getByRole('radio', { name: en('calendar.scope.mine') })).toBeChecked();
  });

  it('does not ask twice for one choice', async () => {
    await renderPage('?scope=all');
    expect(requests()).toHaveLength(1);
  });
});

describe('CalendarPage — its entries', () => {
  it('links each to its Opportunity’s Events tab with the Event marked', async () => {
    await renderPage();
    expect(entryLinks().map((link) => link.getAttribute('href'))).toEqual([
      `/crm/opportunities/${opportunityId(1)}?tab=events&event=${eventId(1)}`,
      `/crm/opportunities/${opportunityId(1)}?tab=events&event=${eventId(2)}`,
      `/crm/opportunities/${opportunityId(2)}?tab=events&event=${eventId(3)}`,
    ]);
  });

  it('names each by its name, its time, and its Opportunity’s number and title — and, under All, whose it is', async () => {
    await renderPage();
    expect(
      screen.getByRole('link', {
        name: `Call back, Thursday, October 8, 2026, 09:00 AM – 09:30 AM, OPP-000001 · Fleet renewal · Anna Nowak, ${en('calendar.entry.hasReminder')}`,
      }),
    ).toBeInTheDocument();
    // Nobody holds this one: nobody is named.
    expect(
      screen.getByRole('link', {
        name: 'Site visit, Thursday, October 8, 2026, 01:00 PM – 02:30 PM, OPP-000002 · Depot lighting',
      }),
    ).toBeInTheDocument();
  });

  it('does not name the assignee under Mine — every entry is the reader’s', async () => {
    answer = () => Promise.resolve(calendarResponse(OCTOBER.slice(0, 2), { scope: 'mine' }));
    await renderPage('?scope=mine');
    expect(
      screen.getByRole('link', {
        name: 'Kick-off, Monday, October 5, 2026, 10:00 AM – 11:00 AM, OPP-000001 · Fleet renewal',
      }),
    ).toBeInTheDocument();
  });

  it('holds no write, even for a holder of crm:write: an Event is added on its Opportunity', async () => {
    await renderPage('', ['crm:read', 'crm:write', 'crm:configure']);
    for (const view of ['week', 'day', 'agenda'] as const) {
      await userEvent.click(screen.getByRole('radio', { name: en(`calendar.view.${view}`) }));
      expect(screen.queryByRole('button', { name: /add|new|edit|delete|remove/i })).toBeNull();
      expect(screen.queryByRole('button', { name: en('events.add') })).toBeNull();
    }
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('has one first-level heading, and names the page', async () => {
    await renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(en('calendar.description'))).toBeInTheDocument();
  });
});

describe('CalendarPage — under 640 px', () => {
  beforeEach(() => setMobileViewport(true));

  it('is the agenda, and asks for the agenda’s thirty days whatever view the address names', async () => {
    await renderPage('?view=month');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: en('calendar.viewSwitch') })).toBeNull();
    expect(requests()).toEqual([
      { from: '2026-10-06T22:00:00.000Z', to: '2026-11-07T23:00:00.000Z', scope: null },
    ]);
    // Monday's Event is before the anchor: the agenda starts today.
    expect(entryLinks()).toHaveLength(2);
    // The address keeps the view it was given, for a wider screen.
    expect(address()).toBe('/crm/calendar?view=month');
  });
});
