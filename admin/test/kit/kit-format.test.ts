import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '../../../packages/admin-kit/src/lib/format';

/**
 * One way to write a date across the admin, in the admin UI language — never
 * the browser's own locale (UX audit #1567: one Opportunity sidebar showed
 * `17.11.2026`, `11/25/2026` and `Nov 22, 2026` side by side). A date is the
 * language's medium date; a moment is that date and the short time, without
 * seconds.
 */
describe('kit — formatDate / formatDateTime', () => {
  const medium = (language: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium' });
  const moment = (language: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  it('writes a calendar date as the medium date of the language, with no time-zone shift', () => {
    expect(formatDate('2026-11-25', 'en')).toBe('Nov 25, 2026');
    expect(formatDate('2026-11-25', 'pl')).toBe(medium('pl').format(new Date(2026, 10, 25)));
    expect(formatDate('2026-11-25', 'en')).not.toMatch(/\//);
  });

  it('writes the day of an instant the same way', () => {
    const iso = '2026-11-17T09:00:00.000Z';
    expect(formatDate(iso, 'en')).toBe(medium('en').format(new Date(iso)));
  });

  it('writes a moment as the medium date and the short time, without seconds', () => {
    const iso = '2026-11-17T09:00:27.000Z';
    for (const language of ['en', 'pl']) {
      expect(formatDateTime(iso, language)).toBe(moment(language).format(new Date(iso)));
      expect(formatDateTime(iso, language)).not.toMatch(/:27/);
    }
  });

  it('writes the dash for nothing and gives back what is not a date', () => {
    expect(formatDate(null, 'en')).toBe('—');
    expect(formatDate(undefined, 'en')).toBe('—');
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDateTime(null, 'en')).toBe('—');
    expect(formatDateTime('not a date', 'en')).toBe('not a date');
  });
});

describe('kit — the no-language form is deprecated, not removed (#1776)', () => {
  it('still answers with the browser locale for consumers outside this repository', () => {
    const iso = '2026-11-17T09:00:00.000Z';
    expect(formatDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(formatDate('2026-11-25')).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 10, 25)));
  });
});
