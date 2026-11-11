import { describe, expect, it } from 'vitest';
import * as cf from './custom-fields.js';

/**
 * `specs/175-buyer-input-custom-fields/contracts/custom-field-definitions.md`
 * and `contracts/input-surface-read.md` — the buyer-input vocabulary, the
 * admin-access level, the two definition attributes, the two new value codes
 * and the public read of the fields open on an input surface.
 */

const UUID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const NOW = '2026-11-06T10:00:00.000Z';

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    entityType: 'organization',
    key: 'acquisition_source',
    label: {},
    labelDefault: 'Acquisition source',
    valueType: 'text',
    required: false,
    audience: 'customer',
    sortOrder: 0,
    config: {},
    listFilter: false,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    options: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('customFieldInputSurfaceSchema', () => {
  it('names organization.register and nothing else', () => {
    expect(cf.customFieldInputSurfaceSchema.options).toEqual(['organization.register']);
    expect(cf.customFieldInputSurfaceSchema.safeParse('organization.checkout').success).toBe(false);
  });
});

describe('customFieldAdminAccessSchema', () => {
  it('is edit, read or hidden', () => {
    expect(cf.customFieldAdminAccessSchema.options).toEqual(['edit', 'read', 'hidden']);
    expect(cf.customFieldAdminAccessSchema.safeParse('write').success).toBe(false);
  });
});

describe('definition shapes', () => {
  it('create defaults customerInput to [] and adminAccess to edit', () => {
    const parsed = cf.createCustomFieldDefinitionSchema.parse({
      entityType: 'organization',
      key: 'phone',
      labelDefault: 'Phone',
      label: {},
      valueType: 'text',
      required: false,
      sortOrder: 0,
    });
    expect(parsed.customerInput).toEqual([]);
    expect(parsed.adminAccess).toBe('edit');
  });

  it('create accepts both attributes and refuses an unknown surface or level', () => {
    const base = {
      entityType: 'customer',
      key: 'phone',
      labelDefault: 'Phone',
      label: {},
      valueType: 'text',
      required: false,
      sortOrder: 0,
    };
    const parsed = cf.createCustomFieldDefinitionSchema.parse({
      ...base,
      customerInput: ['organization.register'],
      adminAccess: 'read',
    });
    expect(parsed.customerInput).toEqual(['organization.register']);
    expect(parsed.adminAccess).toBe('read');
    expect(cf.createCustomFieldDefinitionSchema.safeParse({ ...base, customerInput: ['checkout'] }).success).toBe(false);
    expect(cf.createCustomFieldDefinitionSchema.safeParse({ ...base, adminAccess: 'secret' }).success).toBe(false);
  });

  it('update leaves both attributes absent when they are not named', () => {
    const parsed = cf.updateCustomFieldDefinitionSchema.parse({ labelDefault: 'Phone' });
    expect('customerInput' in parsed).toBe(false);
    expect('adminAccess' in parsed).toBe(false);
  });

  it('update accepts either attribute alone', () => {
    const access = cf.updateCustomFieldDefinitionSchema.parse({ adminAccess: 'hidden' });
    expect(access.adminAccess).toBe('hidden');
    expect('customerInput' in access).toBe(false);
    const input = cf.updateCustomFieldDefinitionSchema.parse({ customerInput: [] });
    expect(input.customerInput).toEqual([]);
    expect('adminAccess' in input).toBe(false);
  });

  it('the definition record requires both attributes', () => {
    expect(cf.customFieldDefinitionSchema.safeParse(definition()).success).toBe(true);
    const { customerInput: _ci, ...noInput } = definition();
    const { adminAccess: _aa, ...noAccess } = definition();
    expect(cf.customFieldDefinitionSchema.safeParse(noInput).success).toBe(false);
    expect(cf.customFieldDefinitionSchema.safeParse(noAccess).success).toBe(false);
  });
});

describe('customFieldEntityTypeInfoSchema.customerInputSurfaces', () => {
  it('defaults to [] and accepts a declared surface', () => {
    const bare = cf.customFieldEntityTypeInfoSchema.parse({
      entityType: 'order',
      labelKey: 'customFields.entity.order',
      listFilter: true,
    });
    expect(bare.customerInputSurfaces).toEqual([]);
    const declared = cf.customFieldEntityTypeInfoSchema.parse({
      entityType: 'organization',
      labelKey: 'customFields.entity.organization',
      listFilter: false,
      customerInputSurfaces: ['organization.register'],
    });
    expect(declared.customerInputSurfaces).toEqual(['organization.register']);
  });
});

describe('customFieldValidationErrorSchema.code', () => {
  it('accepts not_open_for_input and too_many_keys', () => {
    for (const code of ['not_open_for_input', 'too_many_keys']) {
      expect(cf.customFieldValidationErrorSchema.safeParse({ field: 'x', code, message: 'm' }).success).toBe(true);
    }
  });
});

describe('inputSurfaceFieldsResponseSchema', () => {
  // The example of `contracts/input-surface-read.md`, verbatim.
  const example = {
    data: {
      surface: 'organization.register',
      entities: {
        organization: [
          {
            key: 'acquisition_source',
            valueType: 'select',
            required: true,
            label: 'Skąd o nas wiesz?',
            sortOrder: 10,
            options: [
              { value: 'trade_fair', label: 'Targi' },
              { value: 'web', label: 'Internet' },
            ],
          },
        ],
        customer: [
          { key: 'phone', valueType: 'text', required: false, label: 'Telefon', sortOrder: 20, options: [] },
        ],
      },
    },
  };

  it('parses the contract example', () => {
    expect(cf.inputSurfaceFieldsResponseSchema.parse(example)).toEqual(example);
  });

  it('parses an empty answer for an unknown surface', () => {
    expect(
      cf.inputSurfaceFieldsResponseSchema.safeParse({ data: { surface: 'nope', entities: {} } }).success,
    ).toBe(true);
  });

  it('refuses a page_builder field', () => {
    const withPageBuilder = {
      data: {
        surface: 'organization.register',
        entities: {
          customer: [
            { key: 'guide', valueType: 'page_builder', required: false, label: 'Guide', sortOrder: 0, options: [] },
          ],
        },
      },
    };
    expect(cf.inputSurfaceFieldsResponseSchema.safeParse(withPageBuilder).success).toBe(false);
  });
});
