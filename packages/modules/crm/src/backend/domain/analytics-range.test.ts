import { describe, expect, it } from 'vitest';
import { analyticsRange } from './analytics-range.js';

/**
 * The range of CRM analytics (issue #474): two calendar days, both included,
 * counted in the reporting time zone — midnight to the midnight after the last
 * day, both in that zone.
 */
describe('analyticsRange', () => {
  const iso = (range: { start: Date; end: Date }) => [range.start.toISOString(), range.end.toISOString()];

  it('in UTC runs from the first day at midnight to the midnight after the last — the range CRM counted before', () => {
    expect(iso(analyticsRange({ from: '2026-03-01', to: '2026-04-30' }, 'UTC'))).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-05-01T00:00:00.000Z',
    ]);
    expect(analyticsRange({ from: '2028-02-28', to: '2028-02-29' }, 'UTC').end.toISOString()).toBe(
      '2028-03-01T00:00:00.000Z',
    );
  });

  it('starts and ends at midnight in the zone, not in UTC', () => {
    // Warsaw is UTC+1 in January: its 1 January begins at 23:00 UTC on 31 December.
    expect(iso(analyticsRange({ from: '2026-01-01', to: '2026-01-31' }, 'Europe/Warsaw'))).toEqual([
      '2025-12-31T23:00:00.000Z',
      '2026-01-31T23:00:00.000Z',
    ]);
    // New York is UTC−5 in January.
    expect(iso(analyticsRange({ from: '2026-01-01', to: '2026-01-01' }, 'America/New_York'))).toEqual([
      '2026-01-01T05:00:00.000Z',
      '2026-01-02T05:00:00.000Z',
    ]);
  });

  it('takes a month across a change of offset at its own midnights', () => {
    expect(iso(analyticsRange({ from: '2026-10-01', to: '2026-10-31' }, 'Europe/Warsaw'))).toEqual([
      '2026-09-30T22:00:00.000Z',
      '2026-10-31T23:00:00.000Z',
    ]);
    const spring = analyticsRange({ from: '2026-03-29', to: '2026-03-29' }, 'Europe/Warsaw');
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000);
  });

  it('refuses a range that ends before it starts, or a day that is not one', () => {
    expect(() => analyticsRange({ from: '2026-02-01', to: '2026-01-31' }, 'UTC')).toThrow(RangeError);
    expect(() => analyticsRange({ from: 'yesterday', to: '2026-01-31' }, 'UTC')).toThrow(RangeError);
  });
});
