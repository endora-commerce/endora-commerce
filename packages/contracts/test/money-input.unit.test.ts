import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AMOUNT_PRECISION_EXCEEDED,
  ERROR_CODES,
  CreateOpportunityRequestSchema,
  hasAtMostTwoDecimals,
  isAmountPrecisionIssue,
  twoDecimalAmount,
  twoDecimalAmountString,
} from '../src/index.js';

/**
 * Owner ruling of 2026-10-24 (issue #417) — a money amount a person or an
 * integration types has at most two decimal places; more is refused, never
 * rounded. One refinement, one issue code, one error code.
 */
describe('hasAtMostTwoDecimals', () => {
  it('reads a number as the decimal it is written as', () => {
    for (const ok of [0, 1, 1.5, 1.05, 12345.67, '9.99', '10', '0.50']) expect(hasAtMostTwoDecimals(ok)).toBe(true);
    for (const bad of [1.005, 2.675, 0.001, '9.999']) expect(hasAtMostTwoDecimals(bad)).toBe(false);
    // Trailing zeros are not significant (review of PR #423).
    expect(hasAtMostTwoDecimals('1.000')).toBe(true);
  });
});

describe('twoDecimalAmount', () => {
  const schema = z.object({ cost: twoDecimalAmount(z.number().finite().nonnegative()) });

  it('accepts two places and refuses three with the precision issue', () => {
    expect(schema.safeParse({ cost: 1.05 }).success).toBe(true);
    const refused = schema.safeParse({ cost: 1.005 });
    expect(refused.success).toBe(false);
    const issue = refused.error!.issues[0]!;
    expect(issue.path).toEqual(['cost']);
    expect(issue.message).toBe(AMOUNT_PRECISION_EXCEEDED);
    expect((issue as { params?: { code?: string } }).params?.code).toBe(AMOUNT_PRECISION_EXCEEDED);
  });

  it('keeps the schema’s own checks and composes with optional and nullable', () => {
    const optional = z.object({ cost: twoDecimalAmount(z.number().nonnegative()).nullable().optional() });
    expect(optional.safeParse({}).success).toBe(true);
    expect(optional.safeParse({ cost: null }).success).toBe(true);
    expect(optional.safeParse({ cost: -1 }).success).toBe(false);
  });

  it('is the error code the envelope answers with', () => {
    expect(ERROR_CODES.AMOUNT_PRECISION_EXCEEDED).toBe(AMOUNT_PRECISION_EXCEEDED);
  });
});

describe('twoDecimalAmountString', () => {
  it('refuses a decimal string with more than two places', () => {
    const schema = twoDecimalAmountString(z.string());
    expect(schema.safeParse('123.45').success).toBe(true);
    expect(schema.safeParse('123.456').error?.issues[0]?.message).toBe(AMOUNT_PRECISION_EXCEEDED);
  });
});

describe('twoDecimalAmountString — the grammar (review of PR #423)', () => {
  const schema = twoDecimalAmountString(z.string());
  const issues = (value: string) => schema.safeParse(value).error?.issues ?? [];

  it('accepts trailing zeros: "123.4500" is 123.45', () => {
    for (const ok of ['123.4500', '123.45', '10', '0.50', '-12.30', '7.000']) expect(issues(ok), ok).toEqual([]);
  });

  it('refuses a significant third place with the precision issue', () => {
    expect(issues('123.456').map((i) => i.message)).toEqual([AMOUNT_PRECISION_EXCEEDED]);
    expect(issues('0.0050').map((i) => i.message)).toEqual([AMOUNT_PRECISION_EXCEEDED]);
  });

  it('refuses a malformed string with a format issue, never the precision issue', () => {
    for (const bad of ['', 'abc', '1e3', '+5.00', '1 234,56', '12.', '.5']) {
      const found = issues(bad);
      expect(found, bad).toHaveLength(1);
      expect(found[0]!.message, bad).toBe('Not a decimal amount');
      expect(isAmountPrecisionIssue(found[0]), bad).toBe(false);
    }
  });
});

describe('crm decimal amount — one issue per failure', () => {
  it('reports a malformed value as a format failure only', () => {
    const issues = CreateOpportunityRequestSchema.safeParse({
      title: 'Deal',
      organizationId: '00000000-0000-4000-8000-000000000101',
      manualValue: '12,345.678',
    }).error!.issues.filter((i) => i.path.join('.') === 'manualValue');
    expect(issues.map((i) => i.message)).toEqual(['Amount must be a non-negative decimal with at most two places']);
  });
});
