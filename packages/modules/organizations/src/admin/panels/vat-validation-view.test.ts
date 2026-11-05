import { describe, expect, it } from 'vitest';
import type { OrganizationTaxIdValidationRecord } from '@endora-commerce/contracts';
import {
  attemptNotes,
  newestRegistrationRow,
  registryComparisonRows,
  showRegistryDivergenceNotice,
  vatStatusKey,
} from './vat-validation-view.js';

/**
 * Feature 173 (T052; FR-022, FR-023) — what the VAT validation panel and the
 * moderation actions show about a registration-time lookup.
 */

const ADMIN_ROW: OrganizationTaxIdValidationRecord = {
  id: '00000000-0000-4000-8000-000000000002',
  provider: 'mf_pl',
  outcome: 'validated',
  taxIdValue: '5260250995',
  legalNameReturned: 'ACME',
  addressReturned: null,
  errorKind: null,
  requestedByAdminUserId: '00000000-0000-4000-8000-0000000000aa',
  createdAt: '2026-11-06T10:00:00.000Z',
  origin: 'admin',
  registryDetails: null,
  submittedValues: null,
  divergence: null,
};

const REGISTRATION_ROW: OrganizationTaxIdValidationRecord = {
  ...ADMIN_ROW,
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'gus_pl',
  legalNameReturned: 'PRZYKŁADOWA SPÓŁKA',
  addressReturned: { line1: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
  requestedByAdminUserId: null,
  createdAt: '2026-11-05T10:00:00.000Z',
  origin: 'registration',
  registryDetails: {
    plSources: 'gus_mf',
    dataSource: 'gus_pl',
    vatStatusSource: 'mf_pl',
    regon: '123456785',
    vatPayerStatus: 'active',
    activityStatus: 'active',
    fetchedAt: '2026-11-05T09:59:00.000Z',
    fromCache: false,
    attempts: [
      { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
      { provider: 'mf_pl', outcome: 'unavailable', errorKind: 'network_timeout', durationMs: 5000 },
    ],
  },
  submittedValues: {
    name: 'Przykładowa sp. z o.o.',
    taxId: '5260250995',
    registeredAddress: { street: 'ul. Inna 2', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
  },
  divergence: [{ field: 'street', registry: 'ul. Testowa 1', submitted: 'ul. Inna 2' }],
};

describe('newestRegistrationRow', () => {
  it('picks the newest registration row from a newest-first history', () => {
    expect(newestRegistrationRow([ADMIN_ROW, REGISTRATION_ROW, { ...REGISTRATION_ROW, id: 'older' }])).toBe(
      REGISTRATION_ROW,
    );
  });

  it('is null when no registration row exists', () => {
    expect(newestRegistrationRow([ADMIN_ROW])).toBeNull();
    expect(newestRegistrationRow([])).toBeNull();
  });
});

describe('registryComparisonRows', () => {
  it('pairs the registry and the submitted value of each field and marks the divergent ones', () => {
    expect(registryComparisonRows(REGISTRATION_ROW)).toEqual([
      { field: 'name', registry: 'PRZYKŁADOWA SPÓŁKA', submitted: 'Przykładowa sp. z o.o.', differs: false },
      { field: 'street', registry: 'ul. Testowa 1', submitted: 'ul. Inna 2', differs: true },
      { field: 'postalCode', registry: '00-001', submitted: '00-001', differs: false },
      { field: 'city', registry: 'Warszawa', submitted: 'Warszawa', differs: false },
      { field: 'country', registry: 'PL', submitted: 'PL', differs: false },
    ]);
  });

  it('is empty for a row without submitted values', () => {
    expect(registryComparisonRows(ADMIN_ROW)).toEqual([]);
  });
});

describe('showRegistryDivergenceNotice', () => {
  it('only for a pending Organization with at least one differing field', () => {
    expect(showRegistryDivergenceNotice('pending_verification', 1)).toBe(true);
    expect(showRegistryDivergenceNotice('pending_verification', 0)).toBe(false);
    expect(showRegistryDivergenceNotice('active', 3)).toBe(false);
    expect(showRegistryDivergenceNotice('pending_verification', undefined)).toBe(false);
  });
});

describe('vatStatusKey and attemptNotes', () => {
  it('words a gus-mode row as "not checked" and otherwise uses the registry status', () => {
    expect(vatStatusKey(REGISTRATION_ROW)).toBe('active');
    expect(vatStatusKey({ ...REGISTRATION_ROW, outcome: 'unverified', errorKind: 'vat_status_not_checked' })).toBe(
      'not_checked',
    );
    expect(vatStatusKey(ADMIN_ROW)).toBeNull();
  });

  it('lists the attempts that failed or were not made, with a known reason or "other"', () => {
    expect(attemptNotes(REGISTRATION_ROW)).toEqual([{ provider: 'mf_pl', reason: 'network_timeout' }]);
    expect(
      attemptNotes({
        ...REGISTRATION_ROW,
        registryDetails: {
          ...REGISTRATION_ROW.registryDetails!,
          attempts: [
            { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 1 },
            { provider: 'mf_pl', outcome: 'skipped', errorKind: 'excluded_by_setting', durationMs: null },
            { provider: 'vies', outcome: 'unavailable', errorKind: 'provider_503', durationMs: 1 },
          ],
        },
      }),
    ).toEqual([
      { provider: 'mf_pl', reason: 'excluded_by_setting' },
      { provider: 'vies', reason: 'other' },
    ]);
  });
});
