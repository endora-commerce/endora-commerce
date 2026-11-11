import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AdminOrganizationCreateBodySchema,
  adminOrganizationConvertToCompanyBodySchema,
  adminTaxIdScopeResponseSchema,
  adminTaxIdScopeSetBodySchema,
  normalizeTaxId,
  organizationCompanyTaxId,
  organizationSchema,
  registerOrganizationRequestSchema,
  taxIdScopeSchema,
  type OrganizationRecord,
  type TaxIdResolution,
  type TaxIdScope,
} from './organizations.js';

/**
 * `specs/177-tax-id-scope/` — the published shapes of WP-1 (T008).
 *
 * A personal (B2C) organization has no tax ID from this release on, so every
 * published organization shape types it `string | null` (FR-004), and the
 * shapes the scope screen and the conversion use exist before the routes do.
 */

const organization = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Jane Doe',
  status: 'active',
  vatStatus: 'vat_exempt',
  isPersonal: true,
  registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  createdAt: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z',
};

describe('organizationSchema — a nullable tax ID (FR-004)', () => {
  it('accepts a personal organization with taxId null', () => {
    expect(organizationSchema.parse({ ...organization, taxId: null }).taxId).toBeNull();
  });

  it('still accepts a company tax ID', () => {
    expect(
      organizationSchema.parse({ ...organization, isPersonal: false, taxId: '5260250274' }).taxId,
    ).toBe('5260250274');
  });

  it('types OrganizationRecord.taxId as string | null and publishes convertedToCompanyAt', () => {
    expectTypeOf<OrganizationRecord['taxId']>().toEqualTypeOf<string | null>();
    expectTypeOf<OrganizationRecord['convertedToCompanyAt']>().toEqualTypeOf<Date | null>();
  });
});

describe('organizationCompanyTaxId — the one display rule', () => {
  it('answers null for a personal organization', () => {
    expect(organizationCompanyTaxId({ isPersonal: true, taxId: null })).toBeNull();
    expect(organizationCompanyTaxId({ isPersonal: true, taxId: '5260250274' })).toBeNull();
  });

  it('answers null for a null or blank tax ID', () => {
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: null })).toBeNull();
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: '  ' })).toBeNull();
  });

  it('answers the trimmed value otherwise', () => {
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: ' 5260250274 ' })).toBe('5260250274');
  });
});

describe('normalizeTaxId — the admin and registration boundaries’ rule', () => {
  it('strips whitespace and dashes and upper-cases', () => {
    expect(normalizeTaxId(' pl 526-025-02-74 ')).toBe('PL5260250274');
  });

  it('answers an empty string for input with nothing left', () => {
    expect(normalizeTaxId(' - ')).toBe('');
  });
});

describe('taxIdScopeSchema', () => {
  it('offers exactly global and per-tree-root (FR-010)', () => {
    expect(taxIdScopeSchema.options).toEqual(['global', 'per-tree-root']);
    expectTypeOf<TaxIdScope>().toEqualTypeOf<'global' | 'per-tree-root'>();
  });

  it('refuses any other scope', () => {
    expect(taxIdScopeSchema.safeParse('none').success).toBe(false);
    expect(adminTaxIdScopeSetBodySchema.safeParse({ scope: 'per-tree-root' }).success).toBe(true);
    expect(adminTaxIdScopeSetBodySchema.safeParse({ scope: 'tree' }).success).toBe(false);
    expect(adminTaxIdScopeSetBodySchema.safeParse({}).success).toBe(false);
  });

  it('parses the GET response shape', () => {
    const parsed = adminTaxIdScopeResponseSchema.parse({
      data: {
        scope: 'global',
        updatedAt: '2026-11-10T12:00:00.000Z',
        updatedByAdminUserId: null,
        sharedTaxIdCount: 0,
        enforcement: 'consistent',
      },
    });
    expect(parsed.data.scope).toBe('global');
    expect(
      adminTaxIdScopeResponseSchema.safeParse({
        data: { ...parsed.data, enforcement: 'unknown' },
      }).success,
    ).toBe(false);
  });
});

describe('TaxIdResolution', () => {
  it('is none | one | ambiguous', () => {
    expectTypeOf<TaxIdResolution['kind']>().toEqualTypeOf<'none' | 'one' | 'ambiguous'>();
  });
});

describe('adminOrganizationConvertToCompanyBodySchema', () => {
  const body = {
    name: ' Doe Consulting ',
    taxId: 'pl 526-025-02-74',
    registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
  };

  it('normalises the tax ID and trims the name; defaults VAT status and validation', () => {
    const parsed = adminOrganizationConvertToCompanyBodySchema.parse(body);
    expect(parsed.taxId).toBe('PL5260250274');
    expect(parsed.name).toBe('Doe Consulting');
    expect(parsed.vatStatus).toBe('vat_payer');
    expect(parsed.validateTaxId).toBe(false);
  });

  it('refuses a tax ID shorter than 8 characters once normalised', () => {
    expect(
      adminOrganizationConvertToCompanyBodySchema.safeParse({ ...body, taxId: '12-34-56' }).success,
    ).toBe(false);
  });

  it('refuses a blank name and a three-letter country', () => {
    expect(adminOrganizationConvertToCompanyBodySchema.safeParse({ ...body, name: '  ' }).success).toBe(
      false,
    );
    expect(
      adminOrganizationConvertToCompanyBodySchema.safeParse({
        ...body,
        registeredAddress: { ...body.registeredAddress, country: 'POL' },
      }).success,
    ).toBe(false);
  });
});

describe('AdminOrganizationCreateBodySchema.parentId (FR-018)', () => {
  const create = {
    name: 'Branch',
    taxId: '5260250274',
    registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    salesChannelIds: ['00000000-0000-4000-8000-000000000002'],
  };

  it('is optional', () => {
    expect(AdminOrganizationCreateBodySchema.parse(create).parentId).toBeUndefined();
  });

  it('accepts a uuid and refuses anything else', () => {
    const parentId = '00000000-0000-4000-8000-000000000003';
    expect(AdminOrganizationCreateBodySchema.parse({ ...create, parentId }).parentId).toBe(parentId);
    expect(AdminOrganizationCreateBodySchema.safeParse({ ...create, parentId: 'head-office' }).success).toBe(
      false,
    );
  });
});

// Review finding 5 — a tax ID is held to its stored length after normalisation,
// wherever it enters.
describe('registration and admin create validate the normalised tax ID', () => {
  const organization = {
    name: 'Acme',
    registeredAddress: { street: 's', city: 'c', postalCode: '00-001', country: 'PL' },
  };
  it.each([
    ['--------', false],
    ['  - -  - -', false],
    ['1'.repeat(33), false],
    ['pl 526-025-09-95', true],
  ])('%j accepted: %s', (taxId, ok) => {
    const register = registerOrganizationRequestSchema.shape.organization.safeParse({ ...organization, taxId });
    expect(register.success).toBe(ok);
    const create = AdminOrganizationCreateBodySchema.safeParse({
      ...organization,
      taxId,
      salesChannelIds: ['00000000-0000-4000-8000-000000000001'],
    });
    expect(create.success).toBe(ok);
    if (ok) expect(register.success && register.data.taxId).toBe('PL5260250995');
  });
});
