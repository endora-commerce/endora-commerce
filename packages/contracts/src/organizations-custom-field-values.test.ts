import { describe, expect, it } from 'vitest';
import {
  AdminOrganizationCreateBodySchema,
  registerOrganizationRequestSchema,
} from './organizations.js';
import { adminDirectMemberToRoleRequestSchema } from './organization-roles.js';

/**
 * `specs/175-buyer-input-custom-fields/contracts/registration-and-admin-create.md`
 * §1 and §5 — the registration's two value groups, the admin Organization
 * create inheriting the Organization group, and the member direct-create.
 */

const registration = {
  organization: {
    name: 'Acme',
    taxId: '5260250274',
    registeredAddress: { street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
  },
  firstUser: {
    email: 'buyer@example.com',
    password: 'correct horse battery',
    firstName: 'Ada',
    lastName: 'Buyer',
  },
  acceptedTermsVersion: '2026-01',
};

describe('registerOrganizationRequestSchema — custom-field values', () => {
  it('still parses a body without values, and adds none', () => {
    const parsed = registerOrganizationRequestSchema.parse(registration);
    expect('customFieldValues' in parsed.organization).toBe(false);
    expect('customFieldValues' in parsed.firstUser).toBe(false);
  });

  it('accepts values in both groups', () => {
    const parsed = registerOrganizationRequestSchema.parse({
      ...registration,
      organization: { ...registration.organization, customFieldValues: { acquisition_source: 'web' } },
      firstUser: { ...registration.firstUser, customFieldValues: { phone: '+48 600 000 000' } },
    });
    expect(parsed.organization.customFieldValues).toEqual({ acquisition_source: 'web' });
    expect(parsed.firstUser.customFieldValues).toEqual({ phone: '+48 600 000 000' });
  });

  it('refuses a top-level value bag being anything but an object', () => {
    expect(
      registerOrganizationRequestSchema.safeParse({
        ...registration,
        firstUser: { ...registration.firstUser, customFieldValues: ['phone'] },
      }).success,
    ).toBe(false);
  });
});

describe('AdminOrganizationCreateBodySchema — custom-field values', () => {
  it('inherits customFieldValues from the registration Organization member', () => {
    const parsed = AdminOrganizationCreateBodySchema.parse({
      ...registration.organization,
      salesChannelIds: ['0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01'],
      customFieldValues: { tier: 'gold' },
    });
    expect(parsed.customFieldValues).toEqual({ tier: 'gold' });
  });
});

describe('adminDirectMemberToRoleRequestSchema — custom-field values', () => {
  const member = {
    email: 'member@example.com',
    firstName: 'Ola',
    lastName: 'Member',
    password: 'correct horse battery',
  };

  it('accepts customFieldValues', () => {
    expect(
      adminDirectMemberToRoleRequestSchema.parse({ ...member, customFieldValues: { phone: '1' } })
        .customFieldValues,
    ).toEqual({ phone: '1' });
  });

  it('still parses a body without values', () => {
    expect(adminDirectMemberToRoleRequestSchema.safeParse(member).success).toBe(true);
  });

  it('still refuses an unknown key', () => {
    expect(adminDirectMemberToRoleRequestSchema.safeParse({ ...member, role: 'admin' }).success).toBe(false);
  });
});
