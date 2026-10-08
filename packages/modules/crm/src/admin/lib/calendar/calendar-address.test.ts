import { describe, expect, it } from 'vitest';
import { CALENDAR_VIEWS } from './date-math.js';
import { readCalendarAddress, writeCalendarAddress } from './calendar-address.js';

/**
 * The Calendar page's address (`specs/143-crm-sales-opportunities/`, User Story
 * 22 — task T362; FR-146): the view, the date and the *Mine / All* choice, read
 * and written.
 */

const TODAY = '2026-10-08';
const search = (query: string): URLSearchParams => new URLSearchParams(query);

describe('readCalendarAddress', () => {
  it('reads a bare address as this month, today, and no scope asked', () => {
    expect(readCalendarAddress(search(''), TODAY)).toEqual({ view: 'month', date: TODAY, scope: null });
  });

  it('reads the view, the date and the scope it is given', () => {
    expect(readCalendarAddress(search('view=week&date=2026-11-02&scope=mine'), TODAY)).toEqual({
      view: 'week',
      date: '2026-11-02',
      scope: 'mine',
    });
    for (const view of CALENDAR_VIEWS) {
      expect(readCalendarAddress(search(`view=${view}`), TODAY).view).toBe(view);
    }
    expect(readCalendarAddress(search('scope=all'), TODAY).scope).toBe('all');
  });

  it('falls back, member by member, for a value that is malformed', () => {
    expect(readCalendarAddress(search('view=year&date=2026-11-02'), TODAY)).toEqual({
      view: 'month',
      date: '2026-11-02',
      scope: null,
    });
    expect(readCalendarAddress(search('view=week&date=2026-02-30'), TODAY)).toEqual({
      view: 'week',
      date: TODAY,
      scope: null,
    });
    expect(readCalendarAddress(search('date=tomorrow&scope=team'), TODAY)).toEqual({
      view: 'month',
      date: TODAY,
      scope: null,
    });
    expect(readCalendarAddress(search('view=&date=&scope='), TODAY)).toEqual({ view: 'month', date: TODAY, scope: null });
  });
});

describe('writeCalendarAddress', () => {
  it('writes the defaults as nothing, so the bare address keeps meaning today', () => {
    expect(writeCalendarAddress(search('view=week&date=2026-11-02&scope=all'), { view: 'month', date: TODAY, scope: null }, TODAY).toString()).toBe('');
  });

  it('spells out what is not the default', () => {
    expect(writeCalendarAddress(search(''), { view: 'agenda', date: '2026-11-02', scope: 'mine' }, TODAY).toString()).toBe(
      'view=agenda&date=2026-11-02&scope=mine',
    );
    expect(writeCalendarAddress(search(''), { view: 'month', date: '2026-11-02', scope: null }, TODAY).toString()).toBe(
      'date=2026-11-02',
    );
  });

  it('keeps every parameter that is not its own, and does not change what it was given', () => {
    const given = search('utm=1&view=week');
    const next = writeCalendarAddress(given, { view: 'day', date: TODAY, scope: 'all' }, TODAY);
    expect(next.get('utm')).toBe('1');
    expect(next.get('view')).toBe('day');
    expect(next.get('scope')).toBe('all');
    expect(given.toString()).toBe('utm=1&view=week');
  });

  it('round-trips: what it writes reads back as what was asked', () => {
    for (const view of CALENDAR_VIEWS) {
      for (const date of [TODAY, '2026-03-29', '2028-02-29']) {
        for (const scope of [null, 'mine', 'all'] as const) {
          const address = { view, date, scope };
          expect(readCalendarAddress(writeCalendarAddress(search(''), address, TODAY), TODAY)).toEqual(address);
        }
      }
    }
  });
});
