process.env['TZ'] = 'Europe/Warsaw';

import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import type {
  CalendarEntry,
  CalendarView,
} from '../../../../packages/modules/crm/src/admin/lib/calendar/date-math';
import { NOW, TODAY, allDayEntry, entry } from './calendar-fixtures';
import { OPPORTUNITY_ID, core, en, renderCrm } from './crm-fixtures';

/**
 * The one calendar component (`specs/143-crm-sales-opportunities/`, User Story
 * 22 — task T363; FR-146 – FR-150; `contracts/admin-surfaces.md` §1b): the
 * month as a table, the week and the day as sections, the agenda as a list;
 * every entry a link named in full; Tab order equal to time order; the toolbar;
 * the four states in words; and the agenda alone under 640 px.
 *
 * jsdom lays nothing out, so what is held here is structure, names, order and
 * the numbers the geometry writes into `style` — not what it looks like.
 */

const { EventCalendar } = await import(
  '../../../../packages/modules/crm/src/admin/components/calendar/EventCalendar'
);

const ALL_VIEWS: readonly CalendarView[] = ['month', 'week', 'day', 'agenda'];

const retry = vi.fn();

interface HarnessProps {
  events: readonly CalendarEntry[];
  view?: CalendarView;
  date?: string;
  views?: readonly CalendarView[];
  state?: 'loading' | 'ready' | 'error';
  truncated?: boolean;
}

/** A parent that owns the view and the date, as the page and the tab do, and shows what it was told. */
function Harness(props: HarnessProps): ReactElement {
  const [view, setView] = useState<CalendarView>(props.view ?? 'month');
  const [date, setDate] = useState(props.date ?? TODAY);
  return (
    <>
      <EventCalendar
        events={props.events}
        view={view}
        date={date}
        views={props.views ?? ALL_VIEWS}
        onNavigate={(nextView, nextDate): void => {
          setView(nextView);
          setDate(nextDate);
        }}
        state={props.state ?? 'ready'}
        onRetry={retry}
        truncated={props.truncated ?? false}
      />
      <span data-testid="asked">{`${view} ${date}`}</span>
    </>
  );
}

const asked = (): string => screen.getByTestId('asked').textContent ?? '';
const show = (props: HarnessProps): void => {
  renderCrm(<Harness {...props} />);
};

/** The names of the entry links inside an element, in the order of the document — which is the Tab order. */
function linkNames(root: HTMLElement): string[] {
  return within(root)
    .queryAllByRole('link')
    .map((link) => link.getAttribute('aria-label') ?? '');
}

beforeEach(() => {
  retry.mockReset();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A week with something of everything: an all-day Event, an overlap, a reminder, a short one. */
function week(): CalendarEntry[] {
  return [
    entry('Site visit', '2026-10-08', '13:00', '14:30'),
    entry('Call back', '2026-10-08', '09:00', '09:15', { hasReminder: true }),
    allDayEntry('Trade fair', '2026-10-08'),
    entry('Offer review', '2026-10-08', '13:30', '14:00'),
    entry('Kick-off', '2026-10-05', '10:00', '11:00'),
    entry('Follow-up', '2026-10-09', '09:30', '10:00', { context: null }),
    entry('Next month', '2026-11-03', '09:00', '10:00'),
  ];
}

describe('EventCalendar — the month', () => {
  it('is a table with seven column headers named in full, Monday first', () => {
    show({ events: week() });
    const table = screen.getByRole('table', { name: 'October 2026' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(headers.map((header) => header.querySelector('abbr')?.title)).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    // Six weeks of seven days, whatever the month.
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(table).getAllByRole('cell')).toHaveLength(42);
  });

  it('marks today in words as well as by its disc, and no other day', () => {
    show({ events: [] });
    const current = screen.getByRole('table').querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('datetime', TODAY);
    const cell = current[0]?.closest('td') as HTMLElement;
    expect(within(cell).getByText(en('calendar.today'))).toBeInTheDocument();
    expect(screen.getAllByText(en('calendar.today'), { selector: 'td *' })).toHaveLength(1);
  });

  it('makes no cell a focus stop: only entries and “more” are', () => {
    show({ events: week() });
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('td[tabindex], tr[tabindex], time[tabindex]')).toHaveLength(0);
    expect(within(table).queryByRole('gridcell')).toBeNull();
  });

  it('shows three entries of a day — all-day first, then by time — and counts the rest', () => {
    show({ events: week() });
    const cell = screen.getByRole('table').querySelector(`time[datetime="${TODAY}"]`)?.closest('td') as HTMLElement;
    expect(within(cell).getAllByRole('listitem')).toHaveLength(3);
    expect(within(cell).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Trade fair',
      expect.stringContaining('Call back'),
      expect.stringContaining('Site visit'),
    ]);
    const more = within(cell).getByRole('button', {
      name: en('calendar.moreLabel', { count: 1, date: 'Thursday, October 8' }),
    });
    expect(more).toHaveTextContent(en('calendar.more', { count: 1 }));
  });

  it('opens that day when “more” is pressed — the day view where there is one, its week otherwise', async () => {
    show({ events: week() });
    await userEvent.click(screen.getByRole('button', { name: /1 more events/ }));
    expect(asked()).toBe(`day ${TODAY}`);
    expect(linkNames(screen.getByRole('region', { name: /Thursday, October 8 — events: 4/ }))).toHaveLength(4);
  });

  it('opens that day’s week where the day view is not offered', async () => {
    show({ events: week(), views: ['month', 'week'] });
    await userEvent.click(screen.getByRole('button', { name: /1 more events/ }));
    expect(asked()).toBe(`week ${TODAY}`);
  });

  it('draws an all-day entry on its date and a day of another month in its own cell', () => {
    show({ events: week() });
    const cellOf = (day: string): HTMLElement =>
      screen.getByRole('table').querySelector(`time[datetime="${day}"]`)?.closest('td') as HTMLElement;
    expect(within(cellOf('2026-11-03')).getByRole('link')).toHaveTextContent('Next month');
    expect(within(cellOf('2026-10-05')).getByRole('link')).toHaveTextContent('Kick-off');
    expect(within(cellOf('2026-10-06')).queryByRole('link')).toBeNull();
  });
});

describe('EventCalendar — the week', () => {
  it('is seven sections, each under a heading that names the day and counts its Events', () => {
    show({ events: week(), view: 'week' });
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.querySelector('.sr-only')?.textContent)).toEqual([
      'Monday, October 5 — events: 1',
      'Tuesday, October 6 — no events',
      'Wednesday, October 7 — no events',
      `${en('calendar.today')}, Thursday, October 8 — events: 4`,
      'Friday, October 9 — events: 1',
      'Saturday, October 10 — no events',
      'Sunday, October 11 — no events',
    ]);
    expect(screen.getAllByRole('region', { name: /October \d+ — / })).toHaveLength(7);
    // Sections, not a grid.
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists a day as one ordered list: the all-day entry first, then in order of time', () => {
    show({ events: week(), view: 'week' });
    const today = screen.getByRole('region', { name: /Thursday, October 8/ });
    const list = within(today).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(linkNames(list).map((name) => name.split(',')[0])).toEqual([
      'Trade fair',
      'Call back',
      'Site visit',
      'Offer review',
    ]);
  });

  it('places a timed entry by its start and its length, and overlapping ones side by side', () => {
    show({ events: week(), view: 'week' });
    const today = screen.getByRole('region', { name: /Thursday, October 8/ });
    const item = (name: string): HTMLElement =>
      within(today).getByRole('link', { name: new RegExp(`^${name},`) }).closest('li') as HTMLElement;
    const allDayBand = 28 + 8; // one line of all-day entries and its padding
    expect(item('Site visit').style.top).toBe(`${allDayBand + 13 * 48}px`);
    expect(item('Site visit').style.height).toBe('72px');
    expect(item('Site visit').style.width).toBe('50%');
    expect(item('Site visit').style.left).toBe('0%');
    expect(item('Offer review').style.left).toBe('50%');
    // A quarter of an hour is drawn at the minimum height, alone in its column.
    expect(item('Call back').style.height).toBe('24px');
    expect(item('Call back').style.width).toBe('100%');
  });

  it('draws the current-time line on today only, hidden from assistive technology', () => {
    show({ events: week(), view: 'week' });
    const lines = document.querySelectorAll('[data-calendar-now]');
    expect(lines).toHaveLength(1);
    const line = lines[0] as HTMLElement;
    expect(line.closest('section')).toBe(screen.getByRole('region', { name: /Thursday, October 8/ }));
    expect(line.closest('[aria-hidden="true"]')).not.toBeNull();
    // 12:00: twelve hours down the grid, less half its own thickness.
    expect(line.style.top).toBe(`${12 * 48 - 1}px`);
  });

  it('draws no current-time line in a week that does not hold today', () => {
    show({ events: week(), view: 'week', date: '2026-10-15' });
    expect(document.querySelectorAll('[data-calendar-now]')).toHaveLength(0);
  });

  it('hides the hour scale from assistive technology — every entry says its own time', () => {
    show({ events: week(), view: 'week' });
    const scale = screen.getByText('07:00 AM');
    expect(scale.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('cuts an entry that runs past local midnight at the end of its day, and says so', () => {
    show({
      events: [entry('Night shift handover', '2026-10-08', '23:30', '23:59', { endsAt: '2026-10-08T22:30:00.000Z' })],
      view: 'week',
    });
    const link = screen.getByRole('link', { name: /Night shift handover/ });
    expect(link).toHaveAccessibleName(expect.stringContaining(en('calendar.continues')));
    const item = link.closest('li') as HTMLElement;
    expect(item.closest('section')).toBe(screen.getByRole('region', { name: /Thursday, October 8/ }));
    expect(Number.parseFloat(item.style.top) + Number.parseFloat(item.style.height)).toBe(36 + 24 * 48);
    // Drawn once, on the day it starts — not again on the day it runs into.
    expect(screen.getAllByRole('link', { name: /Night shift handover/ })).toHaveLength(1);
  });
});

describe('EventCalendar — the day', () => {
  it('is the week’s grid with one column', () => {
    show({ events: week(), view: 'day' });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Thursday, October 8, 2026');
    const day = screen.getByRole('heading', { level: 3 }).closest('section') as HTMLElement;
    expect(linkNames(day).map((name) => name.split(',')[0])).toEqual([
      'Trade fair',
      'Call back',
      'Site visit',
      'Offer review',
    ]);
    expect(document.querySelectorAll('[data-calendar-now]')).toHaveLength(1);
  });
});

describe('EventCalendar — the agenda', () => {
  it('lists only the days that have Events, thirty days from its date, each under a heading', () => {
    show({ events: [...week(), entry('Too far', '2026-11-20', '09:00', '10:00')], view: 'agenda' });
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.querySelector('time')?.textContent)).toEqual([
      'Thursday, October 8',
      'Friday, October 9',
      'Tuesday, November 3',
    ]);
    // Monday the 5th is before the anchor; 20 November is past the thirty days.
    expect(screen.queryByRole('link', { name: /Kick-off/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Too far/ })).toBeNull();
    expect(within(headings[0] as HTMLElement).getByText(en('calendar.today'))).toBeInTheDocument();
    expect(within(headings[0] as HTMLElement).getByText(en('calendar.day.count', { count: 4 }))).toBeInTheDocument();
  });
});

describe('EventCalendar — an entry', () => {
  it('is a link to its Opportunity’s Events tab, named in full: name, day and time, Opportunity', () => {
    const events = week();
    const [visit] = events;
    show({ events, view: 'week' });
    const link = screen.getByRole('link', {
      name: 'Site visit, Thursday, October 8, 2026, 01:00 PM – 02:30 PM, OPP-000001 · Fleet renewal',
    });
    expect(link).toHaveAttribute('href', `/crm/opportunities/${OPPORTUNITY_ID}?tab=events&event=${visit?.id}`);
    // A pointer gets the same words: what is drawn may be cut, what is said is not.
    expect(link).toHaveAttribute('title', link.getAttribute('aria-label'));
  });

  it('says “all day” for an all-day entry, and leaves the Opportunity out where none is given', () => {
    show({ events: week(), view: 'week' });
    expect(
      screen.getByRole('link', { name: 'Trade fair, Thursday, October 8, 2026, all day, OPP-000001 · Fleet renewal' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Follow-up, Friday, October 9, 2026, 09:30 AM – 10:00 AM' }),
    ).toBeInTheDocument();
  });

  it('says a reminder in words — the bell is not the only sign', () => {
    show({ events: week(), view: 'agenda' });
    const link = screen.getByRole('link', { name: /^Call back,/ });
    expect(link).toHaveAccessibleName(expect.stringMatching(new RegExp(`${en('calendar.entry.hasReminder')}$`)));
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: /^Site visit,/ })).not.toHaveAccessibleName(
      expect.stringContaining(en('calendar.entry.hasReminder')),
    );
  });

  it.each(['month', 'week', 'day', 'agenda'] as const)(
    'is reached by Tab in the order of time in the %s view',
    async (view) => {
      const events = week();
      show({ events, view });
      const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.includes('event='));
      // No link takes itself out of the order or jumps the queue.
      expect(links.every((link) => !link.hasAttribute('tabindex'))).toBe(true);
      const starts = links.map((link) => {
        const found = events.find((item) => link.getAttribute('href')?.endsWith(item.id)) as CalendarEntry;
        // All-day entries lead their day.
        return `${found.allDayDate ?? found.startsAt.slice(0, 10)} ${found.allDay ? '' : found.startsAt}`;
      });
      expect(starts.length).toBeGreaterThan(0);
      expect(starts).toEqual([...starts].sort());

      // …and the keyboard agrees: from the skip link, Tab lands on the first entry.
      const skip = screen.getByRole('link', { name: en('calendar.skip') });
      skip.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(links[0]);
    },
  );

  it('offers a way past all of them', async () => {
    show({ events: week(), view: 'week' });
    await userEvent.click(screen.getByRole('link', { name: en('calendar.skip') }));
    expect(document.activeElement).toHaveTextContent(en('calendar.end'));
  });
});

describe('EventCalendar — the toolbar', () => {
  it('names Previous and Next by what they move', async () => {
    show({ events: [] });
    const toolbar = screen.getByRole('toolbar', { name: en('calendar.toolbar') });
    for (const view of ALL_VIEWS) {
      await userEvent.click(within(toolbar).getByRole('radio', { name: en(`calendar.view.${view}`) }));
      expect(within(toolbar).getByRole('button', { name: en(`calendar.previous.${view}`) })).toBeInTheDocument();
      expect(within(toolbar).getByRole('button', { name: en(`calendar.next.${view}`) })).toBeInTheDocument();
    }
  });

  it('moves a month, a week and a day, and comes back with Today', async () => {
    show({ events: [] });
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.month') }));
    expect(asked()).toBe('month 2026-11-08');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('November 2026');
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.week') }));
    expect(asked()).toBe('week 2026-11-08');
    await userEvent.click(screen.getByRole('button', { name: en('calendar.previous.week') }));
    expect(asked()).toBe('week 2026-11-01');
    await userEvent.click(screen.getByRole('radio', { name: en('calendar.view.day') }));
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.day') }));
    expect(asked()).toBe('day 2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: en('calendar.today') }));
    expect(asked()).toBe(`day ${TODAY}`);
  });

  it('announces the range it moved to: the title is the region’s heading, in a polite live region', () => {
    show({ events: [], view: 'week' });
    const title = screen.getByRole('heading', { level: 2 });
    expect(title).toHaveTextContent(/October 5\s–\s11, 2026/);
    expect(title).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('region', { name: /October 5\s–\s11, 2026/ })).toContainElement(title);
  });

  it('goes to a chosen date through a labelled native date field', async () => {
    show({ events: [], view: 'week' });
    const field = screen.getByLabelText(en('calendar.goToDate'));
    expect(field).toHaveAttribute('type', 'date');
    expect(field).toHaveValue(TODAY);
    fireEvent.change(field, { target: { value: '2026-12-24' } });
    await waitFor(() => expect(asked()).toBe('week 2026-12-24'));
    expect(field).toHaveValue('2026-12-24');
  });

  it('waits for a date being typed to stop changing, and goes once — not through every date on the way', async () => {
    show({ events: [], view: 'week' });
    const field = screen.getByLabelText(en('calendar.goToDate'));
    // What a native field reports while "2027" is typed into its year.
    for (const value of ['0002-10-08', '0020-10-08', '0202-10-08', '2027-10-08']) {
      fireEvent.change(field, { target: { value } });
      expect(asked()).toBe(`week ${TODAY}`);
    }
    await waitFor(() => expect(asked()).toBe('week 2027-10-08'));
  });

  it('does not go anywhere for an emptied field, and shows where it is again once left', async () => {
    show({ events: [], view: 'week' });
    const field = screen.getByLabelText(en('calendar.goToDate'));
    fireEvent.change(field, { target: { value: '' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(asked()).toBe(`week ${TODAY}`);
    fireEvent.blur(field);
    expect(field).toHaveValue(TODAY);
  });

  it('follows the calendar when it is moved by other means', async () => {
    show({ events: [], view: 'week' });
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.week') }));
    expect(screen.getByLabelText(en('calendar.goToDate'))).toHaveValue('2026-10-15');
  });

  it('offers the views as one radio group, the shown one checked', async () => {
    show({ events: [], view: 'week' });
    const group = screen.getByRole('radiogroup', { name: en('calendar.viewSwitch') });
    expect(within(group).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual([
      'month', 'week', 'day', 'agenda',
    ]);
    expect(within(group).getByRole('radio', { name: en('calendar.view.week') })).toBeChecked();
    await userEvent.click(within(group).getByRole('radio', { name: en('calendar.view.agenda') }));
    expect(asked()).toBe(`agenda ${TODAY}`);
  });

  it('offers only the views it was given, and no switch for one', () => {
    show({ events: [], views: ['month', 'week'] });
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('names the browser’s time zone', () => {
    show({ events: [] });
    expect(screen.getByText(/Europe\/Warsaw/)).toHaveTextContent(
      en('calendar.timeZone', { zone: 'Europe/Warsaw (GMT+2)' }),
    );
  });
});

describe('EventCalendar — its states, in words', () => {
  it('says it is loading, marks the view busy and draws no entry', () => {
    show({ events: week(), state: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent(en('calendar.loading'));
    expect(screen.getByRole('table').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Site visit/ })).toBeNull();
    // The frame is the month's own: no layout shift when the answer arrives.
    expect(screen.getAllByRole('cell')).toHaveLength(42);
  });

  it('says a range is empty, and offers the way to today when it is not today', async () => {
    show({ events: week(), view: 'week', date: '2026-12-10' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(en('calendar.empty'));
    await userEvent.click(within(status).getByRole('button', { name: en('calendar.backToToday') }));
    expect(asked()).toBe(`week ${TODAY}`);
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });

  it('says an empty range holding today is empty, without offering the way to where it already is', () => {
    show({ events: [], view: 'week' });
    expect(screen.getByRole('status')).toHaveTextContent(en('calendar.empty'));
    expect(screen.queryByRole('button', { name: en('calendar.backToToday') })).toBeNull();
    // Still the frame, with its seven days — never an empty grid with no words.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
  });

  it('says a read failed and offers to try again, with the toolbar still working', async () => {
    show({ events: [], state: 'error' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(en('calendar.error'));
    await userEvent.click(within(alert).getByRole('button', { name: core('common.action.retry') }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.month') }));
    expect(asked()).toBe('month 2026-11-08');
  });

  it('says the answer was cut, in a status line above the view', () => {
    show({ events: week(), truncated: true });
    expect(screen.getByRole('status')).toHaveTextContent(en('calendar.truncated', { count: 500 }));
    expect(screen.getByRole('link', { name: /^Kick-off,/ })).toBeInTheDocument();
  });

  it('keeps its live region mounted while it has nothing to say', () => {
    show({ events: week() });
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });
});

describe('EventCalendar — under 640 px', () => {
  beforeEach(() => setMobileViewport(true));

  it.each(['month', 'week', 'day'] as const)('is the agenda whatever view was asked (%s), with no switch', (view) => {
    show({ events: week(), view });
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelectorAll('[data-calendar-now]')).toHaveLength(0);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.querySelector('time')?.textContent)).toEqual([
      'Thursday, October 8',
      'Friday, October 9',
      'Tuesday, November 3',
    ]);
  });

  it('moves thirty days at a time and keeps the view that was asked, for a wider screen', async () => {
    show({ events: week(), view: 'week' });
    await userEvent.click(screen.getByRole('button', { name: en('calendar.next.agenda') }));
    expect(asked()).toBe('week 2026-11-07');
  });
});
