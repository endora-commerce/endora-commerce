import { ApiError, formatDate, formatMoney } from '@endora-commerce/admin-kit/lib';
import type { ProjectValue } from '@endora-commerce/contracts';

/** What a cell shows when there is nothing to show. */
export const NO_VALUE = '—';

/**
 * The sentence to show for a failed call.
 *
 * The backend already resolved `error.message` in the reader's language — the
 * guard's own sentence for `PROJECT_GUARD_REFUSED` included — so it is shown as
 * it arrived. `fallback` is for a failure that never produced an envelope.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/** A Project's value in the conventions of its currency, or the dash. */
export function valueLabel(value: ProjectValue | null): string {
  if (value === null) return NO_VALUE;
  const amount = Number(value.amount);
  return Number.isFinite(amount) ? formatMoney(amount, value.currency) : NO_VALUE;
}

/** A `YYYY-MM-DD` calendar date in the admin UI language, as the admin writes every date (#1567). */
export function calendarDateLabel(date: string | null | undefined, language: string): string {
  return formatDate(date, language);
}

/**
 * A typed amount as the decimal string the API takes, or `null` when it is not
 * one.
 *
 * Spaces as thousands separators and a comma as the decimal mark are what a
 * Polish keyboard produces, so both are accepted. More than two decimal places
 * is refused rather than rounded: the API refuses it too (issue #417), and a
 * silently changed amount is worse than a question.
 */
export function normaliseAmount(raw: string): string | null {
  const compact = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(compact)) return null;
  const [whole = '0', fraction = ''] = compact.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
}

/** Alert offsets typed as "7, 1" — whole days 1–365, each once — or `null` when they are not. */
export function parseAlertOffsets(raw: string): number[] | null {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const offsets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const days = Number(part);
    if (days < 1 || days > 365 || offsets.includes(days)) return null;
    offsets.push(days);
  }
  return offsets;
}

/** A planned duration typed in days, 0–3650, or `null` when it is not one. */
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days <= 3650 ? days : null;
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** A file size as a person reads it — `512 B`, `2.5 MB` — in the language on screen. */
export function fileSizeLabel(bytes: number, language: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: SIZE_UNITS[unit] as string,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}
