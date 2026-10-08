import { ApiError, formatMoney } from '@endora-commerce/admin-kit/lib';
import type { OpportunityWorkflowStatus, PropagationOutcome } from '@endora-commerce/contracts';
import type { OrderStatusOption } from '../api.js';

/** What a cell shows when there is nothing to show. */
export const NO_VALUE = '—';

/**
 * The sentence to show for a failed call.
 *
 * The backend already resolved `error.message` in the reader's language — a
 * per-rule sentence for `CRM_WORKFLOW_INVALID`, the guard's own for
 * `CRM_TRANSITION_VETOED` — so it is shown as it arrived. `fallback` is for a
 * failure that never produced an envelope (the network).
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/**
 * A workflow status's name in the admin's language.
 *
 * `GET /workflow` answers the whole per-language map, unlike a status on an
 * Opportunity, whose `name` the backend has already resolved.
 */
export function workflowStatusLabel(
  status: Pick<OpportunityWorkflowStatus, 'code' | 'name' | 'defaultName'>,
  language: string,
): string {
  return status.name[language] || status.defaultName || status.code;
}

/**
 * An Order status's name in the admin's language, falling back to its code.
 *
 * Order status names are keyed as `orders` keys them; the lookup tries the
 * admin language, then any regional variant of it (`en` → `en-US`), then the
 * status's default name.
 */
export function orderStatusLabel(
  code: string,
  statuses: readonly OrderStatusOption[],
  language: string,
): string {
  const status = statuses.find((candidate) => candidate.code === code);
  if (!status) return code;
  const regional = Object.keys(status.name).find((key) => key.startsWith(`${language}-`));
  return (
    status.name[language] ||
    (regional ? status.name[regional] : undefined) ||
    status.defaultName ||
    Object.values(status.name)[0] ||
    code
  );
}

/** A decimal-string amount in the conventions of its currency, or the dash. */
export function moneyLabel(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return NO_VALUE;
  const value = Number(amount);
  return Number.isFinite(value) ? formatMoney(value, currency) : NO_VALUE;
}

/** A `YYYY-MM-DD` calendar date in the reader's locale, without a time zone shift. */
export function calendarDateLabel(date: string | null | undefined): string {
  if (!date) return NO_VALUE;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return new Date(year, month - 1, day).toLocaleDateString();
}

/**
 * A typed amount as the decimal string the API takes, or `null` when it is not
 * an amount.
 *
 * Liberal in what it accepts: spaces as thousands separators and a comma as
 * the decimal mark are what a Polish keyboard produces, and refusing them
 * would make the operator retype a number that was never ambiguous.
 */
export function normaliseAmount(raw: string): string | null {
  const compact = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(compact)) return null;
  return Number(compact).toFixed(2);
}

const REFUSED_OUTCOMES: ReadonlySet<PropagationOutcome['outcome']> = new Set([
  'not_found',
  'unknown_status',
  'not_permitted',
  'vetoed',
  'failed',
]);

/** Whether a linked Order did **not** follow the Opportunity's move. */
export function isRefusedOutcome(outcome: Pick<PropagationOutcome, 'outcome'>): boolean {
  return REFUSED_OUTCOMES.has(outcome.outcome);
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * A file size as a person reads it — `512 B`, `2.5 MB` — in the language on
 * screen. Binary steps (1024), one decimal above a kilobyte.
 */
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
