import { describe, expect, it } from 'vitest';
import {
  INITIAL_REGISTER_FORM_STATE,
  applyLookupOutcome,
  lookupIdFromFormData,
  refusedRegistration,
  valuesFromFormData,
  type RegisterFormState,
} from '../../lib/auth/register-form-state';
import type { LookupCompanyOutcome } from '../../lib/api/registry-lookup';

/**
 * Feature 173 (T031; FR-013, FR-016, FR-017) — the registration form's state
 * never holds the password, a found lookup fills the company fields, and a
 * refusal keeps what was typed and the lookup.
 */

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const TYPED = {
  organizationName: 'Typed Name',
  taxId: 'PL 526-025-09-95',
  country: 'pl',
  street: 'Typed street 1',
  postalCode: '11-111',
  city: 'Typed city',
  firstName: 'Anna',
  lastName: 'Nowak',
  email: 'anna@example.test',
};

const FOUND: LookupCompanyOutcome = {
  kind: 'answer',
  data: {
    status: 'found',
    lookupId: 'A'.repeat(43),
    normalizedTaxId: '5260250995',
    country: 'PL',
    source: 'gus',
    company: {
      legalName: 'PRZYKŁADOWA SPÓŁKA',
      registeredAddress: { street: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
      regon: '123456785',
      vatStatus: 'active',
      activityStatus: 'active',
    },
    fetchedAt: '2026-11-05T10:00:00.000Z',
  },
};

describe('valuesFromFormData', () => {
  it('reads every field and never the password', () => {
    const values = valuesFromFormData(form({ ...TYPED, password: 'a-very-secret-password', intent: 'lookup' }));
    expect(values).toEqual({ ...TYPED, country: 'PL' });
    expect(JSON.stringify(values)).not.toContain('a-very-secret-password');
    expect(Object.keys(values)).not.toContain('password');
  });

  it('defaults the country to PL and empties missing fields', () => {
    expect(valuesFromFormData(new FormData())).toEqual({
      organizationName: '',
      taxId: '',
      country: 'PL',
      street: '',
      postalCode: '',
      city: '',
      firstName: '',
      lastName: '',
      email: '',
    });
  });
});

describe('lookupIdFromFormData', () => {
  it('passes a well-formed reference and drops anything else', () => {
    expect(lookupIdFromFormData(form({ registryLookupId: 'A'.repeat(43) }))).toBe('A'.repeat(43));
    expect(lookupIdFromFormData(form({ registryLookupId: 'nope' }))).toBeUndefined();
    expect(lookupIdFromFormData(new FormData())).toBeUndefined();
  });
});

describe('applyLookupOutcome', () => {
  const typed: RegisterFormState = { ...INITIAL_REGISTER_FORM_STATE, values: { ...TYPED, country: 'PL' } };

  it('found ⇒ the company values and the answer’s country; the tax ID and the owner fields as typed', () => {
    const next = applyLookupOutcome(typed, FOUND);
    expect(next.values).toEqual({
      ...TYPED,
      organizationName: 'PRZYKŁADOWA SPÓŁKA',
      street: 'ul. Testowa 1',
      postalCode: '00-001',
      city: 'Warszawa',
      country: 'PL',
    });
    expect(next.lookup).toEqual({
      status: 'found',
      lookupId: 'A'.repeat(43),
      source: 'gus',
      vatStatus: 'active',
      activityStatus: 'active',
      noDetails: false,
    });
    expect(next.error).toBeNull();
  });

  it('found with no details (VIES "---") ⇒ the typed company values stay', () => {
    const next = applyLookupOutcome(typed, {
      kind: 'answer',
      data: {
        ...FOUND.data,
        source: 'vies',
        country: 'DE',
        company: {
          legalName: null,
          registeredAddress: { street: null, postalCode: null, city: null, country: 'DE' },
          regon: null,
          vatStatus: 'active',
          activityStatus: 'unknown',
        },
      },
    } as LookupCompanyOutcome);
    expect(next.values).toEqual({ ...TYPED, country: 'DE' });
    expect(next.lookup?.noDetails).toBe(true);
  });

  it.each([
    [{ kind: 'rate_limited' } as LookupCompanyOutcome, 'rate_limited'],
    [{ kind: 'unavailable' } as LookupCompanyOutcome, 'unavailable'],
    [
      { kind: 'answer', data: { ...FOUND.data, status: 'not_found', company: null, source: null } } as LookupCompanyOutcome,
      'not_found',
    ],
    [
      {
        kind: 'answer',
        data: { ...FOUND.data, status: 'invalid_tax_id', company: null, source: null, lookupId: null },
      } as LookupCompanyOutcome,
      'invalid_tax_id',
    ],
  ])('a refusal or a negative answer keeps every value (%#)', (outcome, status) => {
    const next = applyLookupOutcome(typed, outcome);
    expect(next.values).toEqual(typed.values);
    expect(next.lookup?.status).toBe(status);
  });
});

describe('refusedRegistration', () => {
  it('keeps the values and the lookup, never the password, and carries the message', () => {
    const previous = applyLookupOutcome({ ...INITIAL_REGISTER_FORM_STATE, values: { ...TYPED, country: 'PL' } }, FOUND);
    const data = form({ ...TYPED, password: 'a-very-secret-password', registryLookupId: 'A'.repeat(43) });
    const next = refusedRegistration(previous, data, { code: 'EMAIL_ALREADY_REGISTERED', message: 'Taken.' });
    expect(next.values).toEqual({ ...TYPED, country: 'PL' });
    expect(next.lookup).toEqual(previous.lookup);
    expect(next.error).toEqual({ code: 'EMAIL_ALREADY_REGISTERED', message: 'Taken.' });
    expect(JSON.stringify(next)).not.toContain('a-very-secret-password');
  });

  it('keeps the reference the form posted when the previous state has none (no JavaScript)', () => {
    const data = form({ ...TYPED, registryLookupId: 'B'.repeat(43) });
    const next = refusedRegistration(INITIAL_REGISTER_FORM_STATE, data, { code: 'X', message: 'No.' });
    expect(next.lookup?.lookupId).toBe('B'.repeat(43));
  });
});
