import type { z } from 'zod';
import { decimalText } from './price-book-decimal.js';

/**
 * A typed money amount has at most two decimal places — owner ruling of
 * 2026-10-24, issue #417. Every money field a person or an integration enters
 * (a delivery cost, a payment surcharge, a quote's agreed or desired unit
 * price, a refund, a credit limit, a promotion's fixed amount) refuses more
 * with `400 AMOUNT_PRECISION_EXCEEDED`, and nothing rounds it: an amount the
 * platform stores is the amount that was typed. Price-book prices have their
 * own four-place grammar and do not use this.
 *
 * The refusal is a Zod issue tagged with the code, so a schema states it once
 * and the error envelope (`@endora-commerce/platform/http`) turns a request
 * whose only failures are this one into the error code.
 */
export const AMOUNT_PRECISION_EXCEEDED = 'AMOUNT_PRECISION_EXCEEDED' as const;

const DECIMAL = /^-?\d+(?:\.(\d+))?$/;

/** Whether a number (read as its shortest decimal) or a decimal string has at most two decimal places. */
export function hasAtMostTwoDecimals(value: number | string): boolean {
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  const match = DECIMAL.exec(decimalText(value));
  if (!match) return false;
  // Trailing zeros are not significant: `123.4500` is 123.45 (review of PR #423).
  return (match[1] ?? '').replace(/0+$/, '').length <= 2;
}

/** A fresh object each time: Zod normalises a refinement's params in place. */
function precisionIssue() {
  return { message: AMOUNT_PRECISION_EXCEEDED, params: { code: AMOUNT_PRECISION_EXCEEDED } };
}

/** A number schema refusing more than two decimal places with the precision issue. */
export function twoDecimalAmount<T extends z.ZodNumber>(schema: T): T {
  return schema.refine((value) => hasAtMostTwoDecimals(value), precisionIssue()) as T;
}

/** A plain decimal string: an optional minus, digits, and optionally a point and digits. */
const DECIMAL_STRING = /^-?\d+(?:\.\d+)?$/;

/**
 * A decimal-string schema: a string that is not a decimal is refused with a
 * **format** issue (`options.message`, `Not a decimal amount` by default) and
 * nothing else; a decimal with a significant digit beyond the second place is
 * refused with the precision issue. Trailing zeros are not significant
 * (`"123.4500"` is 123.45). `options.pattern` narrows the format (a
 * non-negative amount, a bounded number of digits).
 */
export function twoDecimalAmountString<T extends z.ZodString>(
  schema: T,
  options: { pattern?: RegExp; message?: string } = {},
): T {
  const pattern = options.pattern ?? DECIMAL_STRING;
  const message = options.message ?? 'Not a decimal amount';
  return schema.superRefine((value, ctx) => {
    if (!pattern.test(value) || !DECIMAL_STRING.test(value)) {
      ctx.addIssue({ code: 'custom', message });
      return;
    }
    if (!hasAtMostTwoDecimals(value)) ctx.addIssue({ code: 'custom', ...precisionIssue() });
  }) as T;
}

/** The precision issue, for a `superRefine` that decides per field (a promotion's value is money only for `amount_off`). */
export function addAmountPrecisionIssue(ctx: z.RefinementCtx, path: PropertyKey[]): void {
  ctx.addIssue({ code: 'custom', path, ...precisionIssue() });
}

/** Whether a Zod issue (or a Fastify-wrapped one, whose `params` carry the issue's) is the precision issue. */
export function isAmountPrecisionIssue(issue: unknown): boolean {
  if (!issue || typeof issue !== 'object') return false;
  const params = (issue as { params?: { code?: unknown; params?: { code?: unknown } } }).params;
  return params?.code === AMOUNT_PRECISION_EXCEEDED || params?.params?.code === AMOUNT_PRECISION_EXCEEDED;
}
