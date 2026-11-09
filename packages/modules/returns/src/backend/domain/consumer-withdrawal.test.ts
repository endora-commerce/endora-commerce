import { describe, expect, it } from 'vitest';
import {
  ALTERNATIVE_RESOLUTIONS,
  classifyConsumerWithdrawal,
  consentDateRefusal,
  consentRequiredFor,
  defaultResolution,
  refundMethodDiffers,
  resolutionNeedsConsent,
} from './consumer-withdrawal.js';
import { withdrawalPeriod } from './withdrawal-period.js';

/**
 * Issue #905, PR 2 (design §2 and D1): which case is a consumer withdrawal,
 * and what a consumer withdrawal may be settled as.
 */

const ZONE = 'Europe/Warsaw';
// Completed on Monday 2 November 2026: the statutory 14 days end on Monday
// 16 November at 23:59:59.999 Warsaw time, and the grace on Monday 23 November.
const COMPLETED = new Date('2026-11-02T10:00:00.000Z');
const PERIOD = withdrawalPeriod(COMPLETED, { timeZone: ZONE, freeReturnDays: 14 });
const IN_PERIOD = new Date('2026-11-10T10:00:00.000Z');
const IN_GRACE = new Date('2026-11-20T10:00:00.000Z');
const AFTER_GRACE = new Date('2026-11-24T10:00:00.000Z');

describe('classifyConsumerWithdrawal (design §2)', () => {
  it('is a return, by a personal organization, while the withdrawal function is available', () => {
    expect(
      classifyConsumerWithdrawal({ kind: 'return', organizationIsPersonal: true, period: PERIOD, submittedAt: IN_PERIOD }),
    ).toBe(true);
  });

  it('counts a statement made in the 7-day grace: the function is still available then', () => {
    expect(
      classifyConsumerWithdrawal({ kind: 'return', organizationIsPersonal: true, period: PERIOD, submittedAt: IN_GRACE }),
    ).toBe(true);
  });

  it('is a commercial return once the function has closed', () => {
    expect(
      classifyConsumerWithdrawal({ kind: 'return', organizationIsPersonal: true, period: PERIOD, submittedAt: AFTER_GRACE }),
    ).toBe(false);
  });

  it('counts an order whose period has not started (not completed) as available', () => {
    const notStarted = withdrawalPeriod(null, { timeZone: ZONE, freeReturnDays: 14 });
    expect(
      classifyConsumerWithdrawal({ kind: 'return', organizationIsPersonal: true, period: notStarted, submittedAt: AFTER_GRACE }),
    ).toBe(true);
  });

  it('is never a complaint', () => {
    expect(
      classifyConsumerWithdrawal({ kind: 'complaint', organizationIsPersonal: true, period: PERIOD, submittedAt: IN_PERIOD }),
    ).toBe(false);
  });

  it('is never a company organization', () => {
    expect(
      classifyConsumerWithdrawal({ kind: 'return', organizationIsPersonal: false, period: PERIOD, submittedAt: IN_PERIOD }),
    ).toBe(false);
  });
});

describe('the resolutions of a consumer withdrawal (design D1)', () => {
  const withdrawal = { consumerWithdrawal: true, alternativeConsentResolution: null } as const;

  it('defaults to a refund', () => {
    expect(defaultResolution()).toBe('refund');
  });

  it('needs consent for every resolution but a refund', () => {
    expect(ALTERNATIVE_RESOLUTIONS).toEqual(['credit', 'replacement', 'repair']);
    expect(consentRequiredFor(withdrawal)).toEqual(['credit', 'replacement', 'repair']);
    expect(resolutionNeedsConsent(withdrawal, 'refund')).toBe(false);
    for (const resolution of ALTERNATIVE_RESOLUTIONS) expect(resolutionNeedsConsent(withdrawal, resolution)).toBe(true);
  });

  it('lets through only the resolution the consent was recorded for', () => {
    const consented = { consumerWithdrawal: true, alternativeConsentResolution: 'credit' } as const;
    expect(consentRequiredFor(consented)).toEqual(['replacement', 'repair']);
    expect(resolutionNeedsConsent(consented, 'credit')).toBe(false);
    expect(resolutionNeedsConsent(consented, 'replacement')).toBe(true);
    expect(resolutionNeedsConsent(consented, 'repair')).toBe(true);
  });

  it('leaves a business return, a complaint and an unclassified case alone', () => {
    for (const consumerWithdrawal of [false, null]) {
      const state = { consumerWithdrawal, alternativeConsentResolution: null };
      expect(consentRequiredFor(state)).toEqual([]);
      for (const resolution of ALTERNATIVE_RESOLUTIONS) expect(resolutionNeedsConsent(state, resolution)).toBe(false);
    }
  });
});

describe('refundMethodDiffers (design D1, "same means of payment")', () => {
  const ORDER_METHOD = '00000000-0000-4000-8000-000000000905';
  const OTHER_METHOD = '00000000-0000-4000-8000-000000000906';

  it('flags a refund of a consumer withdrawal to another method than the order’s', () => {
    expect(refundMethodDiffers({ consumerWithdrawal: true }, OTHER_METHOD, ORDER_METHOD)).toBe(true);
    expect(refundMethodDiffers({ consumerWithdrawal: true }, ORDER_METHOD, ORDER_METHOD)).toBe(false);
  });

  it('answers null where the rule does not apply', () => {
    expect(refundMethodDiffers({ consumerWithdrawal: false }, OTHER_METHOD, ORDER_METHOD)).toBeNull();
    expect(refundMethodDiffers({ consumerWithdrawal: null }, OTHER_METHOD, ORDER_METHOD)).toBeNull();
    // An order whose method is not known cannot be compared.
    expect(refundMethodDiffers({ consumerWithdrawal: true }, OTHER_METHOD, null)).toBeNull();
  });
});

describe('consentDateRefusal (design D1)', () => {
  const SUBMITTED = new Date('2026-11-05T12:00:00.000Z');
  const NOW = new Date('2026-11-10T12:00:00.000Z');

  it('accepts a moment between the submission and now, both included', () => {
    expect(consentDateRefusal(new Date('2026-11-07T08:00:00.000Z'), SUBMITTED, NOW)).toBeNull();
    expect(consentDateRefusal(SUBMITTED, SUBMITTED, NOW)).toBeNull();
    expect(consentDateRefusal(NOW, SUBMITTED, NOW)).toBeNull();
  });

  it('refuses a moment in the future', () => {
    expect(consentDateRefusal(new Date('2026-11-10T12:00:01.000Z'), SUBMITTED, NOW)).toBe('consent_in_future');
  });

  it('refuses a moment before the case was submitted', () => {
    expect(consentDateRefusal(new Date('2026-11-05T11:59:59.000Z'), SUBMITTED, NOW)).toBe('consent_before_submission');
  });
});
