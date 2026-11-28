import { describe, expect, it } from 'vitest';
import {
  AdminFormDeclarationSchema,
  FieldSetDeclarationSchema,
  PRESENTATION_OVERRIDES,
  SERVER_ENFORCED_OVERRIDES,
} from './admin-forms.js';
import { ORGANIZATION_FIELD_SET, ORGANIZATION_FORMS } from './organization-form.js';
import { AdminOrganizationCreateBodySchema, adminPatchOrganizationRequestSchema } from './organizations.js';
import { adminCreatePayerOrganizationBodySchema, adminCreateRequestOrganizationBodySchema } from './related-payers.js';
import { EntityExtensionsInputSchema } from './schema-extensions.js';

/**
 * `specs/193-admin-form-extensions/` WP-E1 (T042, T045; FR-001, FR-013, FR-080):
 * the organization field set and its two admin forms, and the `extensions`
 * member the admin create and update bodies gain.
 */

const SERVER_KINDS = new Set<string>(SERVER_ENFORCED_OVERRIDES);

describe('ORGANIZATION_FIELD_SET', () => {
  it('is a valid field set owned by organizations', () => {
    expect(FieldSetDeclarationSchema.safeParse(ORGANIZATION_FIELD_SET).success).toBe(true);
    expect(ORGANIZATION_FIELD_SET.id).toBe('organization');
    expect(ORGANIZATION_FIELD_SET.ownerModuleId).toBe('organizations');
  });

  it('accepts a server-enforced kind only on the fields every writer projects (I-5)', () => {
    // `name`, `taxId` and `registeredAddress` are also written by
    // `organization.convert_to_company`, whose hook data carries none of them,
    // so a rule on them could not bind that write. The three below are written
    // only by writers whose hook data carries them.
    const enforced = ORGANIZATION_FIELD_SET.fields
      .filter((field) => field.accepts.some((kind) => SERVER_KINDS.has(kind)))
      .map((field) => field.key)
      .sort();
    expect(enforced).toEqual(['fulfilmentStrategy', 'orderConfirmationEmails', 'vatStatus']);
  });

  it('never invites hidden on a field required on create', () => {
    for (const field of ORGANIZATION_FIELD_SET.fields) {
      if (field.required) expect(field.accepts, field.key).not.toContain('hidden');
    }
  });

  it('invites every presentation kind on the order-confirmation e-mails', () => {
    const emails = ORGANIZATION_FIELD_SET.fields.find((field) => field.key === 'orderConfirmationEmails');
    for (const kind of PRESENTATION_OVERRIDES) expect(emails?.accepts).toContain(kind);
  });
});

describe('ORGANIZATION_FORMS', () => {
  const keys = new Set<string>(ORGANIZATION_FIELD_SET.fields.map((field) => field.key));

  it.each([
    ['create', 'organization.create', 'create'],
    ['edit', 'organization.edit', 'edit'],
  ] as const)('declares %s as %s over the organization field set', (member, id, mode) => {
    const form = ORGANIZATION_FORMS[member];
    expect(AdminFormDeclarationSchema.safeParse(form).success).toBe(true);
    expect(form).toMatchObject({ id, fieldSet: 'organization', mode });
    for (const section of form.sections) for (const key of section.keys) expect(keys.has(key), key).toBe(true);
  });

  it('shows every field required on create on the create form', () => {
    const shown = new Set<string>(ORGANIZATION_FORMS.create.sections.flatMap((section) => [...section.keys]));
    for (const field of ORGANIZATION_FIELD_SET.fields) {
      if (field.required) expect(shown.has(field.key), field.key).toBe(true);
    }
  });
});

describe('EntityExtensionsInputSchema (FR-013)', () => {
  it('accepts up to eight module keys with any value', () => {
    const eight = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`acme_${index}`, { note: index }]));
    expect(EntityExtensionsInputSchema.safeParse(eight).success).toBe(true);
    expect(EntityExtensionsInputSchema.safeParse({}).success).toBe(true);
  });

  it('refuses a ninth key, and a key that is not a module id', () => {
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`acme_${index}`, {}]));
    expect(EntityExtensionsInputSchema.safeParse(nine).success).toBe(false);
    expect(EntityExtensionsInputSchema.safeParse({ 'Not-A-Module': {} }).success).toBe(false);
  });
});

describe('the admin organization bodies carry extensions (FR-013)', () => {
  const create = {
    name: 'Acme',
    taxId: 'PL5260001246',
    registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
    salesChannelIds: ['00000000-0000-4000-8000-00000000c001'],
  };

  it('keeps extensions on the create and the update body', () => {
    const extensions = { acme_erp: { erpCode: 'E-1' } };
    expect(AdminOrganizationCreateBodySchema.parse({ ...create, extensions }).extensions).toEqual(extensions);
    expect(adminPatchOrganizationRequestSchema.parse({ extensions }).extensions).toEqual(extensions);
  });

  it('is optional, so a body without it parses as before', () => {
    expect(AdminOrganizationCreateBodySchema.parse(create)).not.toHaveProperty('extensions');
    expect(adminPatchOrganizationRequestSchema.parse({ name: 'Acme' })).not.toHaveProperty('extensions');
  });

  it('refuses an invalid extensions object', () => {
    expect(AdminOrganizationCreateBodySchema.safeParse({ ...create, extensions: { 'Bad-Key': {} } }).success).toBe(false);
    expect(adminPatchOrganizationRequestSchema.safeParse({ extensions: [] }).success).toBe(false);
  });

  it('leaves the related-payer bodies, derived from the create body, without it', () => {
    expect(adminCreatePayerOrganizationBodySchema.safeParse({ organization: create }).success).toBe(true);
    expect(adminCreateRequestOrganizationBodySchema.safeParse({ organization: create }).success).toBe(true);
    const organization = { ...create, extensions: { acme_erp: {} } };
    expect(adminCreatePayerOrganizationBodySchema.safeParse({ organization }).success).toBe(false);
    expect(adminCreateRequestOrganizationBodySchema.safeParse({ organization }).success).toBe(false);
  });
});
