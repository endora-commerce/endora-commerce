import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dateTimeLabel, dayHeadingLabel, timeLabel } from './format.js';

/**
 * How the calendar writes a time (`specs/143-crm-sales-opportunities/`, User
 * Story 22; FR-149). Owner ruling, 2026-10-08: the format follows the language
 * of the Admin UI the person is logged in with — 24-hour in Polish, 12-hour in
 * English — not the browser's own preference.
 */

const ORIGINAL_TZ = process.env['TZ'];
beforeEach(() => {
  process.env['TZ'] = 'Europe/Warsaw';
});
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

/** 13:05 and 00:30 in Warsaw (UTC+2). */
const AFTERNOON = new Date('2026-10-08T11:05:00.000Z');
const AFTER_MIDNIGHT = new Date('2026-10-07T22:30:00.000Z');

describe('the calendar’s time format', () => {
  it('is 24-hour in Polish', () => {
    expect(timeLabel(AFTERNOON, 'pl')).toBe('13:05');
    expect(timeLabel(AFTER_MIDNIGHT, 'pl')).toBe('00:30');
    expect(dateTimeLabel(AFTERNOON, 'pl')).toMatch(/13:05$/);
    expect(dateTimeLabel(AFTERNOON, 'pl')).not.toMatch(/AM|PM/i);
  });

  it('is 12-hour in English', () => {
    expect(timeLabel(AFTERNOON, 'en')).toBe('01:05 PM');
    expect(timeLabel(AFTER_MIDNIGHT, 'en')).toBe('12:30 AM');
    expect(dateTimeLabel(AFTERNOON, 'en')).toMatch(/01:05 PM$/);
  });

  it('names a day in the language asked', () => {
    expect(dayHeadingLabel('2026-10-08', 'en')).toBe('Thursday, October 8');
    expect(dayHeadingLabel('2026-10-08', 'pl')).toBe('czwartek, 8 października');
  });
});
