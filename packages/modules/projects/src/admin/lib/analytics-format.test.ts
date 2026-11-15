import { describe, expect, it } from 'vitest';
import { presetRange } from './analytics-format.js';

/**
 * The range presets in the reporting time zone (issue #475): "today" is the
 * day it is in the zone the server counts in, not on the operator's computer,
 * so a preset and the server's counting agree around midnight.
 */
describe('presetRange in the reporting time zone', () => {
  // 23:30 UTC on 31 March is 01:30 on 1 April in Warsaw (UTC+2 in summer).
  const now = new Date('2026-03-31T23:30:00.000Z');

  it('takes today from the zone, across a month boundary', () => {
    expect(presetRange('thisMonth', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(presetRange('lastMonth', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(presetRange('last90Days', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-01-02', to: '2026-04-01' });
    expect(presetRange('thisYear', { timeZone: 'Europe/Warsaw', now })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('answers the same instant differently in UTC', () => {
    expect(presetRange('thisMonth', { timeZone: 'UTC', now })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(presetRange('last90Days', { timeZone: 'UTC', now })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('west of Greenwich, across a year boundary', () => {
    // 03:00 UTC on 1 January is still 31 December in New York (UTC−5).
    const newYear = new Date('2026-01-01T03:00:00.000Z');
    expect(presetRange('thisMonth', { timeZone: 'America/New_York', now: newYear })).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('thisYear', { timeZone: 'America/New_York', now: newYear })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('takes the computer’s own calendar while the zone is not yet known', () => {
    const local = new Date(2026, 5, 15, 12);
    expect(presetRange('thisMonth', { now: local })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(presetRange('thisMonth', { timeZone: null, now: local })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });
});
