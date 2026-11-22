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

/**
 * A date in the admin UI language: a `YYYY-MM-DD` calendar date without a
 * time-zone shift, or the day of an ISO instant. The dash for nothing; what is
 * not a date is given back as it came.
 */
export function formatDate(value: string | null | undefined, language?: string): string {
  if (!value) return NO_VALUE;
  const calendar = CALENDAR_DATE.exec(value);
  const date = calendar
    ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat(language, false).format(date);
}

/**
 * A moment (an ISO instant). With `language` — the admin UI language — it is
 * the medium date and the short time; without it, the browser's own
 * `toLocaleString()`, kept for the callers not yet passing the language.
 */
export function formatDateTime(iso: string | null | undefined, language?: string): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return language === undefined ? d.toLocaleString() : dateFormat(language, true).format(d);
}
