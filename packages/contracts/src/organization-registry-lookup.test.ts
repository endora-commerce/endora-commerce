import { describe, expect, it } from 'vitest';
import {
  REGISTRY_LOOKUP_COUNTRIES,
  organizationTaxIdValidationRecordSchema,
  registrationOptionsResponseSchema,
  registryLookupIdSchema,
  registryLookupRequestSchema,
  registryLookupResponseSchema,
} from './organization-registry-lookup.js';
import {
  AdminOrganizationCreateBodySchema,
  registerOrganizationRequestSchema,
  type VatValidationProvider,
} from './organizations.js';

/**
 * Feature 173 — the company registry lookup at storefront registration
 * (`specs/173-registration-registry-lookup/contracts/public-api.md`,
 * `contracts/admin-surfaces.md` §6). FR-001, FR-005, FR-019.
 */

const LOOKUP_ID = 'A'.repeat(40) + '-_9';
const FETCHED_AT = '2026-11-05T10:00:00.000Z';

const company = {
  legalName: 'Przykładowa Spółka z o.o.',
  registeredAddress: { street: 'ul. Testowa 1/2', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
  regon: '123456785',
  vatStatus: 'active',
  activityStatus: 'active',
} as const;

function response(data: Record<string, unknown>) {
  return { data };
}

describe('registryLookupRequestSchema', () => {
  it('trims the tax ID and upper-cases the country', () => {
    expect(registryLookupRequestSchema.parse({ taxId: '  PL 526-025-09-95 ', country: 'pl' })).toEqual({
      taxId: 'PL 526-025-09-95',
      country: 'PL',
    });
  });

  it('refuses an empty tax ID, an over-long one and a country that is not two letters', () => {
    expect(registryLookupRequestSchema.safeParse({ taxId: '   ', country: 'PL' }).success).toBe(false);
    expect(registryLookupRequestSchema.safeParse({ taxId: '1'.repeat(33), country: 'PL' }).success).toBe(false);
    expect(registryLookupRequestSchema.safeParse({ taxId: '5260250995', country: 'POL' }).success).toBe(false);
  });
});

describe('registryLookupResponseSchema', () => {
  it('accepts a found answer', () => {
    expect(
      registryLookupResponseSchema.safeParse(
        response({
          status: 'found',
          lookupId: LOOKUP_ID,
          normalizedTaxId: '5260250995',
          country: 'PL',
          source: 'gus',
          company,
          fetchedAt: FETCHED_AT,
        }),
      ).success,
    ).toBe(true);
  });

  it.each(['not_found', 'unavailable'] as const)('accepts %s with a lookup id and no company', (status) => {
    expect(
      registryLookupResponseSchema.safeParse(
        response({
          status,
          lookupId: LOOKUP_ID,
          normalizedTaxId: '5260250995',
          country: 'PL',
          source: null,
          company: null,
          fetchedAt: FETCHED_AT,
        }),
      ).success,
    ).toBe(true);
  });

  it('accepts unavailable with no lookup id (the store refused)', () => {
    expect(
      registryLookupResponseSchema.safeParse(
        response({
          status: 'unavailable',
          lookupId: null,
          normalizedTaxId: '5260250995',
          country: 'PL',
          source: null,
          company: null,
          fetchedAt: null,
        }),
      ).success,
    ).toBe(true);
  });

  it.each(['invalid_tax_id', 'unsupported_country'] as const)('accepts %s with nothing set', (status) => {
    expect(
      registryLookupResponseSchema.safeParse(
        response({
          status,
          lookupId: null,
          normalizedTaxId: null,
          country: 'US',
          source: null,
          company: null,
          fetchedAt: null,
        }),
      ).success,
    ).toBe(true);
  });

  it('refuses an unknown status', () => {
    expect(
      registryLookupResponseSchema.safeParse(
        response({
          status: 'registered',
          lookupId: null,
          normalizedTaxId: null,
          country: 'PL',
          source: null,
          company: null,
          fetchedAt: null,
        }),
      ).success,
    ).toBe(false);
  });
});

describe('registryLookupIdSchema', () => {
  it('accepts exactly 43 base64url characters', () => {
    expect(registryLookupIdSchema.safeParse(LOOKUP_ID).success).toBe(true);
    expect(registryLookupIdSchema.safeParse(LOOKUP_ID.slice(1)).success).toBe(false);
    expect(registryLookupIdSchema.safeParse(`${LOOKUP_ID}A`).success).toBe(false);
    expect(registryLookupIdSchema.safeParse(`${LOOKUP_ID.slice(1)}=`).success).toBe(false);
    expect(registryLookupIdSchema.safeParse(`${LOOKUP_ID.slice(1)}+`).success).toBe(false);
  });
});

describe('registrationOptionsResponseSchema', () => {
  it('accepts the enabled and the disabled answer', () => {
    expect(
      registrationOptionsResponseSchema.safeParse({
        data: { registryLookup: { enabled: true, countries: ['PL', 'DE', 'GR'] } },
      }).success,
    ).toBe(true);
    expect(
      registrationOptionsResponseSchema.safeParse({ data: { registryLookup: { enabled: false, countries: [] } } })
        .success,
    ).toBe(true);
  });
});

describe('registerOrganizationRequestSchema', () => {
  const body = {
    organization: {
      name: 'Acme',
      taxId: '5260250995',
      registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    },
    firstUser: { email: 'a@example.com', password: 'a-long-password', firstName: 'A', lastName: 'B' },
    acceptedTermsVersion: '2025-01',
  };

  it('accepts a top-level registryLookupId and keeps it optional', () => {
    expect(registerOrganizationRequestSchema.parse({ ...body, registryLookupId: LOOKUP_ID }).registryLookupId).toBe(
      LOOKUP_ID,
    );
    expect(registerOrganizationRequestSchema.parse(body).registryLookupId).toBeUndefined();
    expect(registerOrganizationRequestSchema.safeParse({ ...body, registryLookupId: 'short' }).success).toBe(false);
  });

  it('keeps it out of the admin create body', () => {
    const parsed = AdminOrganizationCreateBodySchema.parse({
      ...body.organization,
      salesChannelIds: ['00000000-0000-4000-8000-00000000c0a1'],
      registryLookupId: LOOKUP_ID,
    }) as Record<string, unknown>;
    expect(parsed['registryLookupId']).toBeUndefined();
  });
});

describe('VatValidationProvider', () => {
  it('admits gus_pl', () => {
    const provider: VatValidationProvider = 'gus_pl';
    expect(organizationTaxIdValidationRecordSchema.shape.provider.safeParse(provider).success).toBe(true);
  });
});

describe('REGISTRY_LOOKUP_COUNTRIES', () => {
  it('serves Poland, Greece as EL and Northern Ireland, and never GR', () => {
    expect(REGISTRY_LOOKUP_COUNTRIES).toContain('PL');
    expect(REGISTRY_LOOKUP_COUNTRIES).toContain('EL');
    expect(REGISTRY_LOOKUP_COUNTRIES).toContain('XI');
    expect(REGISTRY_LOOKUP_COUNTRIES).not.toContain('GR');
    expect(new Set(REGISTRY_LOOKUP_COUNTRIES).size).toBe(REGISTRY_LOOKUP_COUNTRIES.length);
  });
});

describe('organizationTaxIdValidationRecordSchema', () => {
  const adminRow = {
    id: '00000000-0000-4000-8000-000000000001',
    provider: 'mf_pl',
    outcome: 'validated',
    taxIdValue: '5260250995',
    legalNameReturned: 'ACME',
    addressReturned: { line1: 'UL. PROSTA 1, 00-001 WARSZAWA', countryCode: 'PL' },
    errorKind: null,
    requestedByAdminUserId: null,
    createdAt: FETCHED_AT,
    origin: 'admin',
    registryDetails: null,
    submittedValues: null,
    divergence: null,
  };

  it('accepts an administrator row', () => {
    expect(organizationTaxIdValidationRecordSchema.safeParse(adminRow).success).toBe(true);
  });

  it('accepts a registration row with details, submitted values and divergence', () => {
    expect(
      organizationTaxIdValidationRecordSchema.safeParse({
        ...adminRow,
        provider: 'gus_pl',
        origin: 'registration',
        registryDetails: {
          plSources: 'gus_mf',
          dataSource: 'gus_pl',
          vatStatusSource: 'mf_pl',
          regon: '123456785',
          vatPayerStatus: 'active',
          activityStatus: 'active',
          fetchedAt: FETCHED_AT,
          fromCache: false,
          attempts: [
            { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
            { provider: 'mf_pl', outcome: 'skipped', errorKind: 'excluded_by_setting', durationMs: null },
          ],
        },
        submittedValues: {
          name: 'Acme',
          taxId: '5260250995',
          registeredAddress: { street: 'ul. Prosta 2', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
        },
        divergence: [{ field: 'street', registry: 'ul. Prosta 1', submitted: 'ul. Prosta 2' }],
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown origin', () => {
    expect(organizationTaxIdValidationRecordSchema.safeParse({ ...adminRow, origin: 'import' }).success).toBe(false);
  });
});
