import { describe, expect, it } from 'vitest';
import * as cf from './custom-fields.js';

/**
 * `specs/162-custom-fields-value-carry/contracts/carry-api.md` §1 — the carry
 * attribute on definitions, the entity-type marker and the one compatibility
 * rule every caller applies (FR-001, FR-003, FR-011).
 */

const UUID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const NOW = '2026-10-20T10:00:00.000Z';

function party(
  valueType: cf.CustomFieldValueType,
  audience: cf.CustomFieldAudience = 'internal',
  options: string[] = [],
): cf.CustomFieldCarryParty {
  return { valueType, audience, options: options.map((value) => ({ value })) };
}

describe('§1.1 customFieldCarryToSchema', () => {
  it.each([[[]], [['order']], [['order', 'opportunity']]])('accepts %j', (list) => {
    expect(cf.customFieldCarryToSchema.safeParse(list).success).toBe(true);
  });

  it.each([
    ['a duplicate', ['order', 'order']],
    ['three entries', ['order', 'opportunity', 'quote_request']],
    ['an unknown entity type', ['invoice']],
  ])('refuses %s', (_label, list) => {
    expect(cf.customFieldCarryToSchema.safeParse(list).success).toBe(false);
  });

  it('caps the targets at two', () => {
    expect(cf.CUSTOM_FIELD_CARRY_MAX_TARGETS).toBe(2);
  });
});

describe('§1.1 carryTo on the definition schemas', () => {
  const create = {
    entityType: 'quote_request',
    key: 'order_source',
    label: {},
    labelDefault: 'Order source',
    valueType: 'text',
    required: false,
    sortOrder: 0,
  };

  it('a create without carryTo carries none', () => {
    expect(cf.createCustomFieldDefinitionSchema.parse(create).carryTo).toEqual([]);
  });

  it('a create keeps the carryTo it names', () => {
    expect(cf.createCustomFieldDefinitionSchema.parse({ ...create, carryTo: ['order'] }).carryTo).toEqual([
      'order',
    ]);
  });

  it('a patch without carryTo leaves it unchanged (no key)', () => {
    const patch = cf.updateCustomFieldDefinitionSchema.parse({ labelDefault: 'x' });
    expect(Object.hasOwn(patch, 'carryTo')).toBe(false);
  });

  it('a patch refuses a malformed carryTo', () => {
    expect(cf.updateCustomFieldDefinitionSchema.safeParse({ carryTo: ['order', 'order'] }).success).toBe(false);
  });

  it('the served definition requires carryTo', () => {
    const served = {
      ...create,
      id: UUID,
      audience: 'internal',
      config: {},
      listFilter: false,
      customerInput: [],
      adminAccess: 'edit',
      options: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(cf.customFieldDefinitionSchema.safeParse(served).success).toBe(false);
    expect(cf.customFieldDefinitionSchema.parse({ ...served, carryTo: ['order'] }).carryTo).toEqual(['order']);
  });

  it('the entity-type info defaults carryTargets to none', () => {
    const info = cf.customFieldEntityTypeInfoSchema.parse({
      entityType: 'category',
      labelKey: 'x',
      listFilter: false,
    });
    expect(info.carryTargets).toEqual([]);
  });
});

describe('§1.2 assessCustomFieldCarry', () => {
  it('a missing target is target_missing and nothing else', () => {
    expect(cf.assessCustomFieldCarry(party('select', 'internal', ['a']), null)).toEqual([
      { reason: 'target_missing' },
    ]);
  });

  it('two internal text fields are compatible', () => {
    expect(cf.assessCustomFieldCarry(party('text'), party('text'))).toEqual([]);
  });

  it.each([
    ['select', 'multiselect'],
    ['number', 'text'],
    ['date', 'text'],
  ] as const)('%s → %s is a value-type mismatch, with no widening and no options question', (source, target) => {
    expect(
      cf.assessCustomFieldCarry(party(source, 'internal', ['a']), party(target, 'internal', [])),
    ).toEqual([{ reason: 'value_type_mismatch', sourceValueType: source, targetValueType: target }]);
  });

  it('names the source options a select target lacks, in source order, labels ignored', () => {
    expect(
      cf.assessCustomFieldCarry(party('select', 'internal', ['a', 'b', 'c']), party('select', 'internal', ['c', 'a'])),
    ).toEqual([{ reason: 'options_missing', missingOptionValues: ['b'] }]);
  });

  it('extra target options are fine', () => {
    expect(
      cf.assessCustomFieldCarry(party('multiselect', 'internal', ['a']), party('multiselect', 'internal', ['a', 'z'])),
    ).toEqual([]);
  });

  it('internal → customer is an audience mismatch', () => {
    expect(cf.assessCustomFieldCarry(party('text', 'internal'), party('text', 'customer'))).toEqual([
      { reason: 'audience_mismatch' },
    ]);
  });

  it.each([
    ['customer', 'internal'],
    ['customer', 'customer'],
  ] as const)('%s → %s passes', (source, target) => {
    expect(cf.assessCustomFieldCarry(party('text', source), party('text', target))).toEqual([]);
  });

  it('missing options and the audience are both named, in that order', () => {
    expect(
      cf.assessCustomFieldCarry(party('select', 'internal', ['a', 'b']), party('select', 'customer', ['a'])),
    ).toEqual([{ reason: 'options_missing', missingOptionValues: ['b'] }, { reason: 'audience_mismatch' }]);
  });

  it('an option value equal to an Object prototype member is still judged', () => {
    expect(
      cf.assessCustomFieldCarry(party('select', 'internal', ['constructor']), party('select', 'internal', ['a'])),
    ).toEqual([{ reason: 'options_missing', missingOptionValues: ['constructor'] }]);
  });
});

describe('§1.3 customFieldCarrySkipSchema — the skipped field’s label (owner ruling 2026-10-21, V3)', () => {
  it('keeps a label snapshot: the default and the per-locale map', () => {
    const skip = {
      key: 'order_source',
      reason: 'target_missing',
      label: { labelDefault: 'Order source', labels: { pl: 'Źródło zamówienia' } },
    };
    expect(cf.customFieldCarrySkipSchema.parse(skip)).toEqual(skip);
  });

  it('parses a skip stored before the label existed, and leaves label absent', () => {
    const parsed = cf.customFieldCarrySkipSchema.parse({ key: 'order_source', reason: 'value_invalid' });
    expect(parsed).toEqual({ key: 'order_source', reason: 'value_invalid' });
    expect(Object.hasOwn(parsed, 'label')).toBe(false);
  });

  it('refuses a label that is not a default plus a map of strings', () => {
    for (const label of [{ labels: {} }, { labelDefault: 'A', labels: { pl: 1 } }, 'Order source']) {
      expect(cf.customFieldCarrySkipSchema.safeParse({ key: 'k', reason: 'target_missing', label }).success).toBe(
        false,
      );
    }
  });
});

describe('§1.3 customFieldCarrySkipLabelSchema — bounded strings (review fix 2026-10-21)', () => {
  const long = 'x'.repeat(201);
  const at = 'x'.repeat(200);

  it('accepts a default and per-locale labels of up to 200 characters', () => {
    expect(cf.customFieldCarrySkipLabelSchema.safeParse({ labelDefault: at, labels: { pl: at } }).success).toBe(true);
  });

  it('refuses a default or a per-locale label longer than 200 characters', () => {
    expect(cf.customFieldCarrySkipLabelSchema.safeParse({ labelDefault: long, labels: {} }).success).toBe(false);
    expect(cf.customFieldCarrySkipLabelSchema.safeParse({ labelDefault: 'A', labels: { pl: long } }).success).toBe(
      false,
    );
  });
});

describe('§1.3 customFieldCarrySkipRecord', () => {
  it('copies key, reason and the label snapshot, and drops anything else', () => {
    const labels = { pl: 'Źródło zamówienia' };
    const skip = { key: 'k', reason: 'target_missing', label: { labelDefault: 'Order source', labels }, extra: 1 } as const;
    const record = cf.customFieldCarrySkipRecord(skip);
    expect(record).toEqual({ key: 'k', reason: 'target_missing', label: { labelDefault: 'Order source', labels } });
    expect(record.label?.labels).not.toBe(labels);
  });

  it('adds no label key to a skip without one', () => {
    expect(Object.hasOwn(cf.customFieldCarrySkipRecord({ key: 'k', reason: 'value_invalid' }), 'label')).toBe(false);
  });
});
