import { describe, expect, it } from 'vitest';
import { OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS } from '@endora-commerce/contracts';
import {
  boardFieldFilterConditions,
  builtinBoardCardFields,
  customBoardCardField,
  namesCustomBoardField,
  resolveBoardCardFields,
  storedBoardCardFieldRefs,
} from './board-card-fields.js';

const definition = (key: string, valueType: 'text' | 'select', options: string[] = []) =>
  customBoardCardField({
    definition: {
      id: `id-${key}`,
      entityType: 'opportunity',
      key,
      label: { pl: 'Etykieta' },
      labelDefault: 'Label',
      valueType,
      required: false,
      sortOrder: 0,
      config: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    options: options.map((value, index) => ({
      id: `option-${value}`,
      definitionId: `id-${key}`,
      value,
      label: {},
      labelDefault: value,
      isDefault: false,
      // Reversed, so the test sees the sort and not the input order.
      sortOrder: options.length - index,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  });

describe('board card fields (User Story 19)', () => {
  it('offers the Quote Request count only while that module is present', () => {
    const refs = (present: boolean) => builtinBoardCardFields(present).map((field) => field.ref);
    expect(refs(true)).toContain('builtin:linkedQuoteRequests');
    expect(refs(false)).not.toContain('builtin:linkedQuoteRequests');
    expect(refs(false)).toContain('builtin:linkedOrders');
    // Every default field is one that is always offered.
    for (const ref of OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS) expect(refs(false)).toContain(ref);
  });

  it('renders a custom field with its options in their own order', () => {
    expect(definition('lead_source', 'select', ['b', 'a'])).toEqual({
      ref: 'custom:lead_source',
      source: 'custom',
      key: 'lead_source',
      kind: 'select',
      label: { pl: 'Etykieta' },
      labelDefault: 'Label',
      options: [
        { value: 'a', label: {}, labelDefault: 'a' },
        { value: 'b', label: {}, labelDefault: 'b' },
      ],
    });
  });

  it('reads a stored value forgivingly', () => {
    expect(storedBoardCardFieldRefs(undefined)).toEqual([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
    expect(storedBoardCardFieldRefs({ a: 1 })).toEqual([...OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS]);
    expect(storedBoardCardFieldRefs([])).toEqual([]);
    expect(storedBoardCardFieldRefs(['builtin:value', 3, null, 'builtin:value', 'custom:x'])).toEqual([
      'builtin:value',
      'custom:x',
    ]);
  });

  it('asks for definitions only when a custom field is named', () => {
    expect(namesCustomBoardField(['builtin:value'])).toBe(false);
    expect(namesCustomBoardField(['builtin:value', 'custom:x'])).toBe(true);
  });

  it('resolves the offered references in stored order, six at most, dropping the rest', () => {
    const offered = [...builtinBoardCardFields(false), definition('lead_source', 'text')];
    expect(
      resolveBoardCardFields(['custom:gone', 'custom:lead_source', 'builtin:nope', 'builtin:value'], offered).map(
        (field) => field.ref,
      ),
    ).toEqual(['custom:lead_source', 'builtin:value']);
    expect(resolveBoardCardFields(offered.map((field) => field.ref), offered)).toHaveLength(6);
  });

  it('states a filter only for a field the card shows, and only with an operator of its kind', () => {
    const card = [definition('competitor', 'text'), ...builtinBoardCardFields(false).filter((f) => f.key === 'value')];
    expect(boardFieldFilterConditions(card, undefined)).toEqual([]);
    expect(boardFieldFilterConditions(card, { 'custom:other': { contains: 'x' } })).toEqual([]);
    expect(boardFieldFilterConditions(card, { 'custom:competitor': { min: '1' } })).toEqual([]);
    expect(boardFieldFilterConditions(card, { 'custom:competitor': { contains: 'x' } })).toHaveLength(1);
    // A lowest and a highest amount are two conditions.
    expect(boardFieldFilterConditions(card, { 'builtin:value': { min: '1', max: '2' } })).toHaveLength(2);
  });
});
