import { describe, expect, it } from 'vitest';
import * as cf from './custom-fields.js';

/**
 * `specs/157-custom-fields-list-filters/contracts/list-filter-api.md` §1 — the
 * custom-field filter shapes, their caps, the query parameter, the `listFilter`
 * attribute, the list-filter field DTO and the unavailable-filter guard.
 */

const UUID = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const NOW = '2026-10-19T10:00:00.000Z';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

function values(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

describe('§1.2 customFieldFilterSchema', () => {
  it('accepts each operator alone', () => {
    for (const filter of [
      { contains: 'abc' },
      { in: ['a'] },
      { is: true },
      { min: '1' },
      { max: '2' },
      { from: '2026-01-01' },
      { to: '2026-12-31' },
    ]) {
      accepts(cf.customFieldFilterSchema, filter);
    }
  });

  it('rejects an unknown operator', () => {
    rejects(cf.customFieldFilterSchema, { like: 'x' });
  });

  it('trims `contains` and bounds it 1-200', () => {
    expect(cf.customFieldFilterSchema.parse({ contains: '  abc  ' }).contains).toBe('abc');
    rejects(cf.customFieldFilterSchema, { contains: '   ' });
    accepts(cf.customFieldFilterSchema, { contains: 'x'.repeat(200) });
    rejects(cf.customFieldFilterSchema, { contains: 'x'.repeat(201) });
  });

  it('bounds `in` to 1-50 entries of 1-200 characters', () => {
    rejects(cf.customFieldFilterSchema, { in: [] });
    accepts(cf.customFieldFilterSchema, { in: values('v', 50) });
    rejects(cf.customFieldFilterSchema, { in: values('v', 51) });
    rejects(cf.customFieldFilterSchema, { in: [''] });
    accepts(cf.customFieldFilterSchema, { in: ['x'.repeat(200)] });
    rejects(cf.customFieldFilterSchema, { in: ['x'.repeat(201)] });
  });

  it('reads `min` / `max` as decimal strings', () => {
    rejects(cf.customFieldFilterSchema, { min: 'ten' });
    rejects(cf.customFieldFilterSchema, { max: 'ten' });
    accepts(cf.customFieldFilterSchema, { min: '-12.5' });
    accepts(cf.customFieldFilterSchema, { max: '-12.5' });
  });

  it('reads `from` / `to` as calendar dates', () => {
    rejects(cf.customFieldFilterSchema, { from: '2026-02-30' });
    rejects(cf.customFieldFilterSchema, { to: '2026-02-30' });
  });
});

describe('§1.2 customFieldFiltersSchema', () => {
  it('refuses a key the definition key grammar refuses', () => {
    rejects(cf.customFieldFiltersSchema, { 'Bad-Key': { is: true } });
    rejects(cf.customFieldFiltersSchema, { 'custom:x': { is: true } });
    // An object literal would set the prototype; JSON.parse makes an own key.
    rejects(cf.customFieldFiltersSchema, JSON.parse('{"__proto__":{"is":true}}'));
  });

  it('accepts `constructor` as an ordinary key (refusing it is the port\'s job)', () => {
    accepts(cf.customFieldFiltersSchema, JSON.parse('{"constructor":{"is":true}}'));
  });

  it('accepts 10 keys and rejects 11', () => {
    expect(cf.CUSTOM_FIELD_FILTERS_MAX_KEYS).toBe(10);
    const ten = Object.fromEntries(values('k', 10).map((k) => [k, { is: true }]));
    const eleven = Object.fromEntries(values('k', 11).map((k) => [k, { is: true }]));
    accepts(cf.customFieldFiltersSchema, ten);
    rejects(cf.customFieldFiltersSchema, eleven);
  });

  it('accepts 100 `in` values summed over keys and rejects 101', () => {
    expect(cf.CUSTOM_FIELD_FILTERS_MAX_IN_VALUES).toBe(100);
    accepts(cf.customFieldFiltersSchema, { a: { in: values('a', 50) }, b: { in: values('b', 50) } });
    rejects(cf.customFieldFiltersSchema, {
      a: { in: values('a', 50) },
      b: { in: values('b', 50) },
      c: { in: ['c'] },
    });
  });
});

describe('§1.2 customFieldFiltersQueryParamSchema', () => {
  const schema = cf.customFieldFiltersQueryParamSchema;

  it('maps an absent or empty parameter to undefined', () => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('')).toBeUndefined();
  });

  it('parses the JSON record', () => {
    expect(schema.parse('{"src":{"in":["a","b"]}}')).toEqual({ src: { in: ['a', 'b'] } });
  });

  it('refuses an array (a repeated parameter)', () => {
    rejects(schema, ['{"src":{"is":true}}', '{"src":{"is":false}}']);
  });

  it('refuses a parameter that is not JSON', () => {
    const result = schema.safeParse('{x');
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('customFieldFilters is not JSON');
  });

  it('locates a bad bound relative to the parameter', () => {
    const result = schema.safeParse(JSON.stringify({ src: { from: '2026-02-30' } }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['src', 'from']]);
  });

  it('refuses a raw string over 8000 characters', () => {
    const raw = JSON.stringify({ src: { contains: 'x'.repeat(8000) } });
    expect(raw.length).toBeGreaterThan(8000);
    rejects(schema, raw);
  });

  it('is idempotent: an already-parsed value parses to itself', () => {
    const raw = JSON.stringify({ src: { in: ['a'] }, amount: { min: '-12.5', max: '3' } });
    const once = schema.parse(raw);
    expect(schema.parse(once)).toEqual(once);
    expect(schema.parse(schema.parse(undefined))).toBeUndefined();
  });

  it('validates an already-parsed object and refuses an invalid one', () => {
    expect(schema.parse({ src: { contains: ' a ' } })).toEqual({ src: { contains: 'a' } });
    rejects(schema, { src: { like: 'x' } });
    rejects(schema, { 'Bad-Key': { is: true } });
  });
});

describe('§1.1 the listFilter attribute', () => {
  const definition = {
    id: UUID,
    entityType: 'order',
    key: 'source',
    label: { en: 'Source' },
    labelDefault: 'Source',
    valueType: 'select',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    carryTo: [],
    options: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('a definition requires listFilter as a boolean', () => {
    rejects(cf.customFieldDefinitionSchema, definition);
    rejects(cf.customFieldDefinitionSchema, { ...definition, listFilter: 'yes' });
    expect(cf.customFieldDefinitionSchema.parse({ ...definition, listFilter: true }).listFilter).toBe(true);
  });

  it('a create without listFilter leaves it undefined', () => {
    const parsed = cf.createCustomFieldDefinitionSchema.parse({
      entityType: 'order',
      key: 'source',
      label: {},
      labelDefault: 'Source',
      valueType: 'text',
      required: false,
      sortOrder: 0,
    });
    expect(parsed.listFilter).toBeUndefined();
    expect(
      cf.createCustomFieldDefinitionSchema.parse({
        entityType: 'order',
        key: 'source',
        label: {},
        labelDefault: 'Source',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        listFilter: true,
      }).listFilter,
    ).toBe(true);
  });

  it('a patch naming only a label carries neither listFilter nor config', () => {
    const parsed = cf.updateCustomFieldDefinitionSchema.parse({ labelDefault: 'x' });
    expect('listFilter' in parsed).toBe(false);
    expect('config' in parsed).toBe(false);
    expect(cf.updateCustomFieldDefinitionSchema.parse({ listFilter: false }).listFilter).toBe(false);
  });

  it('an entity type entry requires listFilter', () => {
    rejects(cf.customFieldEntityTypeInfoSchema, { entityType: 'order', labelKey: 'x' });
    accepts(cf.customFieldEntityTypeInfoSchema, { entityType: 'order', labelKey: 'x', listFilter: true });
  });

  it('the definition error codes include list_filter_unsupported', () => {
    expect(cf.CUSTOM_FIELD_DEFINITION_ERROR_CODES).toContain('list_filter_unsupported');
  });
});

describe('§1.3 customFieldListFilterFieldSchema', () => {
  const field = {
    key: 'source',
    valueType: 'select',
    label: { en: 'Source', pl: 'Źródło' },
    labelDefault: 'Source',
    options: [{ value: 'web', label: { en: 'Web' }, labelDefault: 'Web' }],
  };

  it('accepts the offered field', () => {
    accepts(cf.customFieldListFilterFieldSchema, field);
    accepts(cf.customFieldListFilterFieldsResponseSchema, { data: [field] });
  });

  it('carries no audience, required, config or listFilter (strict)', () => {
    for (const extra of [
      { audience: 'internal' },
      { required: true },
      { config: {} },
      { listFilter: true },
      { id: UUID },
      { sortOrder: 0 },
    ]) {
      rejects(cf.customFieldListFilterFieldSchema, { ...field, ...extra });
    }
    const shape = cf.customFieldListFilterFieldSchema.shape as Record<string, unknown>;
    for (const member of ['audience', 'required', 'config', 'listFilter']) {
      expect(Object.hasOwn(shape, member)).toBe(false);
    }
  });
});

describe('§1.4 isCustomFieldFilterUnavailableFailure', () => {
  it('narrows an Error named CustomFieldFilterUnavailableError with a keys array', () => {
    const failure = Object.assign(new Error('unavailable'), {
      name: 'CustomFieldFilterUnavailableError',
      keys: ['source'],
    });
    expect(cf.isCustomFieldFilterUnavailableFailure(failure)).toBe(true);
  });

  it('rejects a plain Error, null and a bare keys object', () => {
    expect(cf.isCustomFieldFilterUnavailableFailure(new Error('x'))).toBe(false);
    expect(cf.isCustomFieldFilterUnavailableFailure(null)).toBe(false);
    expect(cf.isCustomFieldFilterUnavailableFailure({ keys: [] })).toBe(false);
  });
});

describe('§1.4 operators per value type', () => {
  const types: Record<string, cf.CustomFieldValueType> = { flag: 'boolean', note: 'text', due: 'date' };
  const typeOf = (key: string) => types[key];

  it('accepts the operators of each type', () => {
    expect(() =>
      cf.assertCustomFieldFilterOperators(
        { flag: { is: true }, note: { contains: 'x' }, due: { from: '2026-01-01', to: '2026-02-01' } },
        typeOf,
      ),
    ).not.toThrow();
  });

  it('refuses every operator that does not apply, located at the key and the operator', () => {
    let caught: unknown;
    try {
      cf.assertCustomFieldFilterOperators({ flag: { contains: 'x' }, note: { min: '1' }, unknown: { is: true } }, typeOf);
    } catch (error) {
      caught = error;
    }
    expect((caught as { name?: string }).name).toBe('ZodError');
    expect((caught as { issues: Array<{ path: unknown[] }> }).issues.map((issue) => issue.path)).toEqual([
      ['flag', 'contains'],
      ['note', 'min'],
    ]);
  });
});

describe('feature 172 — the page_builder value type takes no filter', () => {
  it('has an operator row, and the row is empty', () => {
    expect(Object.keys(cf.CUSTOM_FIELD_FILTER_OPERATORS).sort()).toEqual(
      [...cf.customFieldValueTypeSchema.options].sort(),
    );
    expect(cf.CUSTOM_FIELD_FILTER_OPERATORS.page_builder).toEqual([]);
  });

  it('refuses every operator on a page_builder field', () => {
    let caught: unknown;
    try {
      cf.assertCustomFieldFilterOperators(
        { guide: { contains: 'x', is: true } },
        (key) => (key === 'guide' ? 'page_builder' : undefined),
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as { issues: Array<{ path: unknown[] }> }).issues.map((issue) => issue.path)).toEqual([
      ['guide', 'contains'],
      ['guide', 'is'],
    ]);
  });
});

describe('§1.4 customFieldFilterUnavailable', () => {
  it('builds a failure the guard narrows, naming the keys', () => {
    const failure = cf.customFieldFilterUnavailable(['a', 'b']);
    expect(cf.isCustomFieldFilterUnavailableFailure(failure)).toBe(true);
    expect(failure.keys).toEqual(['a', 'b']);
  });
});

describe('§1.4 ranges', () => {
  it('refuses a minimum above the maximum and a start after the end, at the key', () => {
    let caught: unknown;
    try {
      cf.assertCustomFieldFilterRanges({
        amount: { min: '10', max: '9.5' },
        due: { from: '2026-03-01', to: '2026-02-01' },
        ok: { min: '-1', max: '1' },
        same: { from: '2026-01-01', to: '2026-01-01' },
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as { name?: string }).name).toBe('ZodError');
    expect((caught as { issues: Array<{ path: unknown[] }> }).issues.map((issue) => issue.path)).toEqual([
      ['amount', 'min'],
      ['due', 'from'],
    ]);
  });

  it('accepts open and ordered ranges', () => {
    expect(() => cf.assertCustomFieldFilterRanges({ a: { min: '1' }, b: { to: '2026-01-01' } })).not.toThrow();
  });
});

describe('updateCustomFieldOptionSchema', () => {
  it('carries only what a patch names — no defaults that would reset the rest', () => {
    expect(cf.updateCustomFieldOptionSchema.parse({ labelDefault: 'x' })).toEqual({ labelDefault: 'x' });
    expect(cf.updateCustomFieldOptionSchema.parse({ sortOrder: 2 })).toEqual({ sortOrder: 2 });
  });

  it('never takes the stored value', () => {
    expect(cf.updateCustomFieldOptionSchema.parse({ value: 'renamed', isDefault: true })).toEqual({ isDefault: true });
  });
});
