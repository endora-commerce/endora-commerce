import { describe, expect, it } from 'vitest';
import {
  validateOptionList,
  isValidOptionValue,
} from '../../../../packages/modules/catalog/src/backend/services/attribute-option-validator.js';

describe('validateOptionList (catalog/attribute-option-validator)', () => {
  const baseOption = (over: { value: string; isDefault?: boolean }) => ({
    value: over.value,
    label: {},
    labelDefault: over.value,
    isDefault: over.isDefault ?? false,
    sortOrder: 0,
  });

  it('accepts an empty list', () => {
    const result = validateOptionList([], 'select');
    expect(result.ok).toBe(true);
  });

  it('accepts a list of unique values with at most one default for select', () => {
    const result = validateOptionList(
      [
        baseOption({ value: 'red', isDefault: true }),
        baseOption({ value: 'blue' }),
        baseOption({ value: 'green' }),
      ],
      'select',
    );
    expect(result.ok).toBe(true);
  });

  it('refuses duplicate values', () => {
    const result = validateOptionList(
      [baseOption({ value: 'red' }), baseOption({ value: 'red' })],
      'select',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: 'duplicate_value', value: 'red' });
  });

  it('refuses multiple defaults on a select attribute', () => {
    const result = validateOptionList(
      [
        baseOption({ value: 'red', isDefault: true }),
        baseOption({ value: 'blue', isDefault: true }),
      ],
      'select',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ code: 'default_option_ambiguous' });
  });

  it('refuses multiple defaults on an enum attribute', () => {
    const result = validateOptionList(
      [
        baseOption({ value: 'a', isDefault: true }),
        baseOption({ value: 'b', isDefault: true }),
      ],
      'enum',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('default_option_ambiguous');
  });

  it('allows multiple defaults on a multiselect attribute', () => {
    const result = validateOptionList(
      [
        baseOption({ value: 'a', isDefault: true }),
        baseOption({ value: 'b', isDefault: true }),
      ],
      'multiselect',
    );
    expect(result.ok).toBe(true);
  });

  it('refuses option values that fail the regex', () => {
    const result = validateOptionList([baseOption({ value: 'Invalid Value!' })], 'select');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('invalid_option_value');
  });

  it('refuses options for non-select-style value types', () => {
    const result = validateOptionList([baseOption({ value: 'red' })], 'string');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('attribute_type_unsupported');
  });
});

describe('isValidOptionValue', () => {
  it('accepts lowercase letters, digits, underscores, hyphens', () => {
    expect(isValidOptionValue('red')).toBe(true);
    expect(isValidOptionValue('size_xl')).toBe(true);
    expect(isValidOptionValue('part-001')).toBe(true);
    expect(isValidOptionValue('1')).toBe(true);
  });

  it('refuses uppercase or whitespace', () => {
    expect(isValidOptionValue('Red')).toBe(false);
    expect(isValidOptionValue('size xl')).toBe(false);
  });
});
