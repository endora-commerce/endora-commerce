import { describe, expect, it } from 'vitest';
import type { RegistryLookupSnapshot } from './company-registry-port.js';
import { registrationValidationRow, type RegistrationSubmission } from './registration-snapshot.js';

/**
 * Feature 173 (T029; FR-019, FR-020) — a ticket and a submission become the
 * values of one `organization_tax_id_validations` row (research R-13,
 * data-model §1). Synthetic data.
 */

const RECORD = {
  legalName: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  address: { street: 'ul. Testowa 12/3', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
  regon: '123456785',
  vatPayerStatus: 'active' as const,
  activityStatus: 'active' as const,
};

function ticket(overrides: Partial<RegistryLookupSnapshot> = {}): RegistryLookupSnapshot {
  return {
    version: 1,
    lookupId: 'A'.repeat(43),
    fromCache: false,
    issuedAt: '2026-11-05T10:00:01.000Z',
    status: 'found',
    country: 'PL',
    taxId: '5260250995',
    plSources: 'gus_mf',
    record: RECORD,
    dataSource: 'gus_pl',
    vatStatusSource: 'mf_pl',
    attempts: [
      { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
      { provider: 'mf_pl', outcome: 'found', errorKind: null, durationMs: 30 },
    ],
    fetchedAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

const SUBMISSION: RegistrationSubmission = {
  name: 'Przykładowa sp. z o.o.',
  taxId: 'PL 526-025-09-95',
  registeredAddress: { street: 'ul. Inna 1', postalCode: '00-002', city: 'Warszawa', country: 'PL' },
};

describe('registrationValidationRow', () => {
  it('found + active ⇒ validated, the registry snapshot and the submission, no personal data', () => {
    const row = registrationValidationRow(ticket(), SUBMISSION);
    expect(row).toEqual({
      provider: 'gus_pl',
      outcome: 'validated',
      errorKind: null,
      taxIdValue: 'PL 526-025-09-95',
      legalNameReturned: RECORD.legalName,
      addressReturned: { line1: 'ul. Testowa 12/3', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
      origin: 'registration',
      registryDetails: {
        plSources: 'gus_mf',
        dataSource: 'gus_pl',
        vatStatusSource: 'mf_pl',
        regon: '123456785',
        vatPayerStatus: 'active',
        activityStatus: 'active',
        fetchedAt: '2026-11-05T10:00:00.000Z',
        fromCache: false,
        attempts: ticket().attempts,
      },
      submittedValues: {
        name: SUBMISSION.name,
        taxId: SUBMISSION.taxId,
        registeredAddress: SUBMISSION.registeredAddress,
      },
    });
    expect(Object.keys(row!.submittedValues)).toEqual(['name', 'taxId', 'registeredAddress']);
  });

  it.each(['exempt', 'not_registered'] as const)('found + %s ⇒ failed / not_active_vat_payer', (vat) => {
    expect(
      registrationValidationRow(ticket({ record: { ...RECORD, vatPayerStatus: vat } }), SUBMISSION),
    ).toMatchObject({ outcome: 'failed', errorKind: 'not_active_vat_payer' });
  });

  it('gus_mf with the White List leg failed ⇒ deferred / vat_status_unavailable', () => {
    expect(
      registrationValidationRow(
        ticket({
          record: { ...RECORD, vatPayerStatus: 'unknown' },
          vatStatusSource: null,
          attempts: [
            { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
            { provider: 'mf_pl', outcome: 'unavailable', errorKind: 'rate_limited', durationMs: 30 },
          ],
        }),
        SUBMISSION,
      ),
    ).toMatchObject({ provider: 'gus_pl', outcome: 'deferred', errorKind: 'vat_status_unavailable' });
  });

  it('gus mode (VAT status not checked by design) ⇒ unverified / vat_status_not_checked, distinct from the row above', () => {
    const row = registrationValidationRow(
      ticket({
        plSources: 'gus',
        record: { ...RECORD, vatPayerStatus: 'unknown' },
        vatStatusSource: null,
        attempts: [
          { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
          { provider: 'mf_pl', outcome: 'skipped', errorKind: 'excluded_by_setting', durationMs: null },
        ],
      }),
      SUBMISSION,
    );
    expect(row).toMatchObject({
      provider: 'gus_pl',
      outcome: 'unverified',
      errorKind: 'vat_status_not_checked',
      registryDetails: { plSources: 'gus' },
    });
  });

  it('found from the White List ⇒ provider mf_pl', () => {
    expect(
      registrationValidationRow(
        ticket({
          dataSource: 'mf_pl',
          attempts: [
            { provider: 'gus_pl', outcome: 'skipped', errorKind: 'not_configured', durationMs: null },
            { provider: 'mf_pl', outcome: 'found', errorKind: null, durationMs: 30 },
          ],
        }),
        SUBMISSION,
      ),
    ).toMatchObject({ provider: 'mf_pl', outcome: 'validated' });
  });

  it('not found ⇒ failed / not_found, no returned data, the first leg tried as provider', () => {
    expect(
      registrationValidationRow(
        ticket({
          status: 'not_found',
          record: null,
          dataSource: null,
          vatStatusSource: null,
          attempts: [
            { provider: 'gus_pl', outcome: 'not_found', errorKind: null, durationMs: 40 },
            { provider: 'mf_pl', outcome: 'not_found', errorKind: null, durationMs: 30 },
          ],
        }),
        SUBMISSION,
      ),
    ).toMatchObject({
      provider: 'gus_pl',
      outcome: 'failed',
      errorKind: 'not_found',
      legalNameReturned: null,
      addressReturned: null,
      registryDetails: { regon: null, vatPayerStatus: 'unknown', activityStatus: 'unknown' },
    });
  });

  it('unavailable ⇒ deferred with the first leg error kind; an excluded leg is never the provider', () => {
    expect(
      registrationValidationRow(
        ticket({
          plSources: 'mf',
          status: 'unavailable',
          record: null,
          dataSource: null,
          vatStatusSource: null,
          attempts: [
            { provider: 'gus_pl', outcome: 'skipped', errorKind: 'excluded_by_setting', durationMs: null },
            { provider: 'mf_pl', outcome: 'unavailable', errorKind: 'budget_exhausted', durationMs: null },
          ],
        }),
        SUBMISSION,
      ),
    ).toMatchObject({ provider: 'mf_pl', outcome: 'deferred', errorKind: 'budget_exhausted' });
  });

  it('VIES: provider vies, Greece kept in the form a picker submits', () => {
    const row = registrationValidationRow(
      ticket({
        country: 'EL',
        taxId: '123456789',
        plSources: null,
        dataSource: 'vies',
        vatStatusSource: 'vies',
        record: { ...RECORD, regon: null, address: { street: null, postalCode: null, city: null, country: 'EL' } },
        attempts: [{ provider: 'vies', outcome: 'found', errorKind: null, durationMs: 80 }],
      }),
      { ...SUBMISSION, taxId: 'EL123456789', registeredAddress: { ...SUBMISSION.registeredAddress, country: 'GR' } },
    );
    expect(row).toMatchObject({
      provider: 'vies',
      outcome: 'validated',
      addressReturned: { line1: null, postalCode: null, city: null, countryCode: 'GR' },
      registryDetails: { plSources: null },
    });
  });

  it('truncates a registry name longer than the column', () => {
    const row = registrationValidationRow(ticket({ record: { ...RECORD, legalName: 'X'.repeat(300) } }), SUBMISSION);
    expect(row?.legalNameReturned).toHaveLength(255);
  });

  it('a ticket for another tax ID or another country ⇒ null', () => {
    expect(registrationValidationRow(ticket(), { ...SUBMISSION, taxId: '1234563218' })).toBeNull();
    expect(
      registrationValidationRow(ticket(), {
        ...SUBMISSION,
        // A bare number takes the address's country; a PL prefix would override it (R-17).
        taxId: '5260250995',
        registeredAddress: { ...SUBMISSION.registeredAddress, country: 'DE' },
      }),
    ).toBeNull();
    expect(registrationValidationRow(ticket(), { ...SUBMISSION, taxId: 'garbage' })).toBeNull();
  });
});
