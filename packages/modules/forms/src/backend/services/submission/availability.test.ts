import { describe, expect, it } from 'vitest';
import type { FormRestrictions } from '@endora-commerce/contracts';
import { submissionAvailability, type AvailabilityInput } from './availability.js';

/**
 * `specs/170-forms-module/` T047 — whether a submission may be taken (research R-12 step 3,
 * FR-043): the form's live status, its served version's window and maximum, and the signed-in
 * rule against the request's actor. A refusal names the token of `409 FORM_NOT_ACCEPTING`.
 */

const NOW = new Date('2026-11-02T12:00:00.000Z');
const OPEN: FormRestrictions = { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false };

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    status: 'published',
    hasPublishedVersion: true,
    restrictions: OPEN,
    acceptedEntryCount: 0,
    signedIn: false,
    now: NOW,
    ...overrides,
  };
}

describe('submissionAvailability', () => {
  it('takes a submission of a published form with no restriction', () => {
    expect(submissionAvailability(input())).toEqual({ accepting: true });
  });

  it('answers unavailable for a form that does not exist, a draft and a form never published', () => {
    expect(submissionAvailability(null)).toEqual({ accepting: false, reason: 'unavailable' });
    expect(submissionAvailability(input({ status: 'draft' }))).toEqual({ accepting: false, reason: 'unavailable' });
    expect(submissionAvailability(input({ hasPublishedVersion: false }))).toEqual({ accepting: false, reason: 'unavailable' });
  });

  it('answers closed for a closed form and after the window', () => {
    expect(submissionAvailability(input({ status: 'closed' }))).toEqual({ accepting: false, reason: 'closed' });
    const ended = { ...OPEN, availableUntil: '2026-11-02T11:59:59.000Z' };
    expect(submissionAvailability(input({ restrictions: ended }))).toEqual({ accepting: false, reason: 'closed' });
  });

  it('answers not_yet_open before the window', () => {
    const later = { ...OPEN, availableFrom: '2026-11-03T00:00:00.000Z' };
    expect(submissionAvailability(input({ restrictions: later }))).toEqual({ accepting: false, reason: 'not_yet_open' });
  });

  it('answers full at the maximum of accepted entries, and accepts below it', () => {
    const capped = { ...OPEN, maxEntries: 3 };
    expect(submissionAvailability(input({ restrictions: capped, acceptedEntryCount: 3 }))).toEqual({
      accepting: false,
      reason: 'full',
    });
    expect(submissionAvailability(input({ restrictions: capped, acceptedEntryCount: 2 }))).toEqual({ accepting: true });
  });

  it('answers sign_in_required to an anonymous submitter of a signed-in-only form, and accepts a customer', () => {
    const members = { ...OPEN, signedInOnly: true };
    expect(submissionAvailability(input({ restrictions: members }))).toEqual({
      accepting: false,
      reason: 'sign_in_required',
    });
    expect(submissionAvailability(input({ restrictions: members, signedIn: true }))).toEqual({ accepting: true });
  });

  it('says closed before sign-in: a closed form is closed for everybody', () => {
    const members = { ...OPEN, signedInOnly: true };
    expect(submissionAvailability(input({ status: 'closed', restrictions: members }))).toEqual({
      accepting: false,
      reason: 'closed',
    });
  });
});
