import { describe, expect, it } from 'vitest';
import {
  PRODUCT_FIELD_SCOPE_SETS,
  attributeFieldSpec,
  attributeScopeSet,
  fieldScopeSpec,
  levelOf,
  resolveScoped,
  sameLanguage,
  scopeFromRequest,
  type ScopeLevel,
  type ScopeRef,
  type ScopedRow,
} from './product-scope-model.js';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/`, research R1, data-model §0 and
 * §9) — the one scope vocabulary and the one resolver (FR-010…FR-015, FR-109).
 */

const C1 = '00000000-0000-4000-8000-000000000001';
const C2 = '00000000-0000-4000-8000-000000000002';

const G: ScopeRef = { level: 'global' };
const atC = (channelId = C1): ScopeRef => ({ level: 'channel', channelId });
const atCL = (languageCode = 'pl-PL', channelId = C1): ScopeRef => ({
  level: 'channel_language',
  channelId,
  languageCode,
});

const value = <T>(channelId: string, languageCode: string | null, v: T): ScopedRow<T> => ({
  channelId,
  languageCode,
  value: { kind: 'value', value: v },
});
const empty = (channelId: string, languageCode: string | null): ScopedRow<never> => ({
  channelId,
  languageCode,
  value: { kind: 'empty' },
});

const ALL: readonly ScopeLevel[] = ['G', 'C', 'CL'];
const GC: readonly ScopeLevel[] = ['G', 'C'];

describe('resolveScoped — the C×L → C → G chain', () => {
  it('Global: the Global value is `set`; none is `absent`', () => {
    expect(resolveScoped({ global: 'Wiertarka', rows: [], scope: G, levels: ALL })).toEqual({
      value: 'Wiertarka',
      source: 'set',
    });
    expect(resolveScoped({ global: null, rows: [], scope: G, levels: ALL })).toEqual({
      value: null,
      source: 'absent',
    });
  });

  it('Global ignores every scoped row', () => {
    const rows = [value(C1, null, 'C'), value(C1, 'pl-PL', 'CL')];
    expect(resolveScoped({ global: 'G', rows, scope: G, levels: ALL })).toEqual({ value: 'G', source: 'set' });
  });

  it('C×L: an own row is `set`', () => {
    const rows = [value(C1, 'pl-PL', 'CL'), value(C1, null, 'C')];
    expect(resolveScoped({ global: 'G', rows, scope: atCL(), levels: ALL })).toEqual({
      value: 'CL',
      source: 'set',
    });
  });

  it('C×L: falls back to the channel row (`inherited_channel`), then Global (`inherited_global`)', () => {
    expect(
      resolveScoped({ global: 'G', rows: [value(C1, null, 'C')], scope: atCL(), levels: ALL }),
    ).toEqual({ value: 'C', source: 'inherited_channel' });
    expect(resolveScoped({ global: 'G', rows: [], scope: atCL(), levels: ALL })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
    expect(resolveScoped({ global: null, rows: [], scope: atCL(), levels: ALL })).toEqual({
      value: null,
      source: 'absent',
    });
  });

  it('C: an own row is `set`; without one Global is `inherited_global`', () => {
    expect(resolveScoped({ global: 'G', rows: [value(C1, null, 'C')], scope: atC(), levels: ALL })).toEqual({
      value: 'C',
      source: 'set',
    });
    expect(resolveScoped({ global: 'G', rows: [], scope: atC(), levels: ALL })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
  });

  it('C ignores C×L rows of the same channel', () => {
    expect(
      resolveScoped({ global: 'G', rows: [value(C1, 'pl-PL', 'CL')], scope: atC(), levels: ALL }),
    ).toEqual({ value: 'G', source: 'inherited_global' });
  });

  it('presence wins whatever the value: an empty string or a false is still the override', () => {
    expect(resolveScoped({ global: 'G', rows: [value(C1, 'pl-PL', '')], scope: atCL(), levels: ALL })).toEqual({
      value: '',
      source: 'set',
    });
    expect(
      resolveScoped({ global: true, rows: [value(C1, null, false)], scope: atCL(), levels: ALL }),
    ).toEqual({ value: false, source: 'inherited_channel' });
  });

  it('an empty row stops the fallback (FR-013): own → `set_empty`, from the channel → value null', () => {
    expect(resolveScoped({ global: 'G', rows: [empty(C1, 'pl-PL')], scope: atCL(), levels: ALL })).toEqual({
      value: null,
      source: 'set_empty',
    });
    expect(
      resolveScoped({ global: 'G', rows: [empty(C1, null), value(C1, 'de-DE', 'DE')], scope: atCL(), levels: ALL }),
    ).toEqual({ value: null, source: 'inherited_channel' });
    expect(resolveScoped({ global: 'G', rows: [empty(C1, null)], scope: atC(), levels: ALL })).toEqual({
      value: null,
      source: 'set_empty',
    });
  });

  it('an own value at C×L wins over an empty channel row', () => {
    expect(
      resolveScoped({ global: 'G', rows: [empty(C1, null), value(C1, 'pl-PL', 'PL')], scope: atCL(), levels: ALL }),
    ).toEqual({ value: 'PL', source: 'set' });
  });

  it('`levels` restriction: a {G,C} field ignores C×L rows at a C×L scope', () => {
    const rows = [value(C1, 'pl-PL', 'CL'), value(C1, null, 'C')];
    expect(resolveScoped({ global: 'G', rows, scope: atCL(), levels: GC })).toEqual({
      value: 'C',
      source: 'inherited_channel',
    });
    expect(resolveScoped({ global: 'G', rows: [value(C1, 'pl-PL', 'CL')], scope: atCL(), levels: GC })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
  });

  it('`levels` restriction: a {G} field ignores every row', () => {
    const rows = [value(C1, 'pl-PL', 'CL'), value(C1, null, 'C')];
    expect(resolveScoped({ global: 'G', rows, scope: atCL(), levels: ['G'] })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
  });

  it('rows of another channel or another language never match', () => {
    const rows = [value(C2, null, 'other channel'), value(C1, 'de-DE', 'other language')];
    expect(resolveScoped({ global: 'G', rows, scope: atCL(), levels: ALL })).toEqual({
      value: 'G',
      source: 'inherited_global',
    });
  });

  it('languages match case-insensitively', () => {
    expect(
      resolveScoped({ global: 'G', rows: [value(C1, 'PL-pl', 'PL')], scope: atCL('pl-PL'), levels: ALL }),
    ).toEqual({ value: 'PL', source: 'set' });
  });
});

describe('sameLanguage', () => {
  it('compares tags case-insensitively and null only to null', () => {
    expect(sameLanguage('de-DE', 'de-de')).toBe(true);
    expect(sameLanguage('de', 'de-DE')).toBe(false);
    expect(sameLanguage(null, null)).toBe(true);
    expect(sameLanguage(null, 'pl')).toBe(false);
  });
});

describe('levelOf / scopeFromRequest', () => {
  it('names the level of a scope', () => {
    expect(levelOf(G)).toBe('G');
    expect(levelOf(atC())).toBe('C');
    expect(levelOf(atCL())).toBe('CL');
  });

  it('builds a scope from a request: neither → G, channel → C, both → C×L', () => {
    expect(scopeFromRequest({})).toEqual({ ok: true, scope: G });
    expect(scopeFromRequest({ channelId: C1 })).toEqual({ ok: true, scope: atC() });
    expect(scopeFromRequest({ channelId: C1, languageCode: 'pl-PL' })).toEqual({ ok: true, scope: atCL() });
  });

  it('refuses a Language-only scope (FR-010)', () => {
    expect(scopeFromRequest({ languageCode: 'pl-PL' })).toEqual({ ok: false, reason: 'language_without_channel' });
  });
});

describe('PRODUCT_FIELD_SCOPE_SETS equals data-model.md §9', () => {
  const expected: Record<string, { levels: ScopeLevel[]; required: boolean; emptyable: boolean }> = {
    name: { levels: ['G', 'C', 'CL'], required: true, emptyable: false },
    description: { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    status: { levels: ['G', 'C', 'CL'], required: false, emptyable: false },
    window: { levels: ['G', 'C'], required: false, emptyable: true },
    audience: { levels: ['G', 'C'], required: false, emptyable: false },
    minOrderQuantity: { levels: ['G', 'C'], required: false, emptyable: true },
    returnable: { levels: ['G', 'C'], required: false, emptyable: false },
    urlKey: { levels: ['G', 'C', 'CL'], required: true, emptyable: false },
    'seo:title': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'seo:description': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'seo:ogTitle': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'seo:ogDescription': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'seo:ogImageUrl': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'gallery:altText': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'gallery:hidden': { levels: ['G', 'C', 'CL'], required: false, emptyable: false },
    galleryRole: { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'attachment:name': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'attachment:description': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
    'attachment:hidden': { levels: ['G', 'C', 'CL'], required: false, emptyable: false },
    'packagingUnit:name': { levels: ['G', 'C', 'CL'], required: false, emptyable: true },
  };

  it('holds exactly the rows of §9 (attributes derived separately)', () => {
    const actual = Object.fromEntries(
      Object.entries(PRODUCT_FIELD_SCOPE_SETS).map(([k, v]) => [
        k,
        { levels: [...v.levels], required: v.required, emptyable: v.emptyable },
      ]),
    );
    expect(actual).toEqual(expected);
  });

  it('resolves a concrete field path to its family row', () => {
    expect(fieldScopeSpec('name')?.levels).toEqual(['G', 'C', 'CL']);
    expect(fieldScopeSpec(`gallery:${C1}:altText`)).toBe(PRODUCT_FIELD_SCOPE_SETS['gallery:altText']);
    expect(fieldScopeSpec(`gallery:${C1}:hidden`)).toBe(PRODUCT_FIELD_SCOPE_SETS['gallery:hidden']);
    expect(fieldScopeSpec('galleryRole:base_image')).toBe(PRODUCT_FIELD_SCOPE_SETS.galleryRole);
    expect(fieldScopeSpec(`attachment:${C1}:description`)).toBe(PRODUCT_FIELD_SCOPE_SETS['attachment:description']);
    expect(fieldScopeSpec(`packagingUnit:${C1}:name`)).toBe(PRODUCT_FIELD_SCOPE_SETS['packagingUnit:name']);
    expect(fieldScopeSpec('seo:ogImageUrl')).toBe(PRODUCT_FIELD_SCOPE_SETS['seo:ogImageUrl']);
  });

  it('answers null for an attribute path, an unknown field or a bad sub-field', () => {
    expect(fieldScopeSpec('attribute:colour')).toBeNull();
    expect(fieldScopeSpec('sku')).toBeNull();
    expect(fieldScopeSpec(`gallery:${C1}:caption`)).toBeNull();
    expect(fieldScopeSpec('galleryRole:hero')).toBeNull();
    expect(fieldScopeSpec('seo:keywords')).toBeNull();
  });
});

describe('attributeScopeSet / attributeFieldSpec per value type (FR-012, R15)', () => {
  it('not scopable → {G}, whatever the type', () => {
    for (const valueType of ['string', 'number', 'boolean', 'enum', 'date', 'multiselect', 'price', 'select'] as const) {
      expect(attributeScopeSet({ scopable: false, valueType })).toEqual(['G']);
    }
  });

  it('scopable text (`string`) → {G,C,CL}', () => {
    expect(attributeScopeSet({ scopable: true, valueType: 'string' })).toEqual(['G', 'C', 'CL']);
  });

  it('scopable non-text → {G,C}', () => {
    for (const valueType of ['number', 'boolean', 'enum', 'date', 'multiselect', 'price', 'select'] as const) {
      expect(attributeScopeSet({ scopable: true, valueType })).toEqual(['G', 'C']);
    }
  });

  it('single selects and booleans never take an empty override; required refuses empty', () => {
    expect(attributeFieldSpec({ scopable: true, valueType: 'select', isRequired: false }).emptyable).toBe(false);
    expect(attributeFieldSpec({ scopable: true, valueType: 'enum', isRequired: false }).emptyable).toBe(false);
    expect(attributeFieldSpec({ scopable: true, valueType: 'boolean', isRequired: false }).emptyable).toBe(false);
    expect(attributeFieldSpec({ scopable: true, valueType: 'multiselect', isRequired: false }).emptyable).toBe(true);
    expect(attributeFieldSpec({ scopable: true, valueType: 'number', isRequired: false }).emptyable).toBe(true);
    expect(attributeFieldSpec({ scopable: true, valueType: 'date', isRequired: false }).emptyable).toBe(true);
    expect(attributeFieldSpec({ scopable: true, valueType: 'string', isRequired: true })).toEqual({
      levels: ['G', 'C', 'CL'],
      required: true,
      emptyable: false,
    });
  });
});
