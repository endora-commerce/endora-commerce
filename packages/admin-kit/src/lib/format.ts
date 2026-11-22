/*
 * Dates across the admin are written one way, in the admin UI language
 * (`useAppLanguage().language`) — never the browser's own locale (UX audit
 * #1567: one sidebar showed `17.11.2026`, `11/25/2026` and `Nov 22, 2026`):
 * a date as the language's medium date (*Nov 25, 2026*, *25 lis 2026*), a
 * moment as that date and the short time, never seconds.
 */

const NO_VALUE = '—';
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(language: string | undefined, withTime: boolean): Intl.DateTimeFormat {
  const key = `${language ?? ''}|${withTime ? 'moment' : 'date'}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      language,
      withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
    );
    formats.set(key, format);
  }
  return format;
}

/** @deprecated Pass the admin UI language; the browser-locale fallback will be removed (#1776). */
export function formatDate(value: string | null | undefined): string;
/**
 * A date in the admin UI language: a `YYYY-MM-DD` calendar date without a
 * time-zone shift, or the day of an ISO instant. The dash for nothing; what is
 * not a date is given back as it came.
 *
 * Always pass `language` — the admin UI language (`useTranslationContext().language`
 * or `useAppLanguage().language`). Calling it without one is **deprecated**: it
 * falls back to the browser's locale, and the fallback will be removed in a
 * later release (#1776). Inside this repository a one-argument call fails
 * `admin/test/unit/no-browser-locale-dates.test.ts`.
 */
export function formatDate(value: string | null | undefined, language: string | undefined): string;
export function formatDate(value: string | null | undefined, language?: string): string {
  if (!value) return NO_VALUE;
  const calendar = CALENDAR_DATE.exec(value);
  const date = calendar
    ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat(language, false).format(date);
}

/** @deprecated Pass the admin UI language; the browser-locale fallback will be removed (#1776). */
export function formatDateTime(iso: string | null | undefined): string;
/**
 * A moment (an ISO instant) in the admin UI language: the medium date and the
 * short time, never seconds. The dash for nothing; what is not a date is given
 * back as it came.
 *
 * Always pass `language`. Calling it without one is **deprecated**: it falls
 * back to the browser's own `toLocaleString()`, which will be removed in a later
 * release (#1776). Inside this repository a one-argument call fails
 * `admin/test/unit/no-browser-locale-dates.test.ts`.
 */
export function formatDateTime(iso: string | null | undefined, language: string | undefined): string;
export function formatDateTime(iso: string | null | undefined, language?: string): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // NUMBER_LEDGER in no-browser-locale-dates.test.ts lists this one call: the
  // deprecated fallback, kept for consumers outside this repository.
  return language === undefined ? d.toLocaleString() : dateFormat(language, true).format(d);
}
