import { describe, expect, it } from 'vitest';

import {
  apiTypeToDb,
  dbTypeToApi,
  InvalidAttributeMappingError,
  type ApiAttributeShape,
  type DbAttributeShape,
} from '../../../src/modules/catalog/services/attribute-type-mapping.js';

/**
 * T011 — pure unit tests over the API↔DB attribute-type mapping table from
 * `specs/002-catalog-module/data-model.md` §1.2 and `research.md` R-7.
 *
 * Per Constitution Principle III: written FIRST. Helper is a stub that
 * throws "not implemented"; impl lands in T022.
 */

describe('apiTypeToDb (T011)', () => {
  it('input → string', () => {
    expect(apiTypeToDb({ type: 'input' })).toEqual<DbAttributeShape>({
      valueType: 'string',
      displayAsSlider: false,
    });
  });

  it('number → number, displayAsSlider=false', () => {
    expect(apiTypeToDb({ type: 'number' })).toEqual<DbAttributeShape>({
      valueType: 'number',
      displayAsSlider: false,
    });
  });

  it('price → price, displayAsSlider=false', () => {
    expect(apiTypeToDb({ type: 'price' })).toEqual<DbAttributeShape>({
      valueType: 'price',
      displayAsSlider: false,
    });
  });

  it('slider with numericKind=number → number, displayAsSlider=true', () => {
    expect(
      apiTypeToDb({ type: 'slider', numericKind: 'number' }),
    ).toEqual<DbAttributeShape>({
      valueType: 'number',
      displayAsSlider: true,
    });
  });

  it('slider with numericKind=price → price, displayAsSlider=true', () => {
    expect(
      apiTypeToDb({ type: 'slider', numericKind: 'price' }),
    ).toEqual<DbAttributeShape>({
      valueType: 'price',
      displayAsSlider: true,
    });
  });

  it('select with one enum value → enum, enumValues kept', () => {
    expect(
      apiTypeToDb({ type: 'select', enumValues: ['a'] }),
    ).toEqual<DbAttributeShape>({
      valueType: 'enum',
      enumValues: ['a'],
      displayAsSlider: false,
    });
  });

  it('multiselect with several enum values → multiselect, enumValues kept', () => {
    expect(
      apiTypeToDb({ type: 'multiselect', enumValues: ['a', 'b', 'c'] }),
    ).toEqual<DbAttributeShape>({
      valueType: 'multiselect',
      enumValues: ['a', 'b', 'c'],
      displayAsSlider: false,
    });
  });

  it('slider without numericKind → INVALID_DISPLAY_AS_SLIDER', () => {
    let caught: unknown;
    try {
      apiTypeToDb({ type: 'slider' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAttributeMappingError);
    expect((caught as InvalidAttributeMappingError).code).toBe(
      'INVALID_DISPLAY_AS_SLIDER',
    );
  });

  it('select without enumValues → ENUM_VALUES_REQUIRED', () => {
    let caught: unknown;
    try {
      apiTypeToDb({ type: 'select' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAttributeMappingError);
    expect((caught as InvalidAttributeMappingError).code).toBe(
      'ENUM_VALUES_REQUIRED',
    );
  });

  it('multiselect without enumValues → ENUM_VALUES_REQUIRED', () => {
    let caught: unknown;
    try {
      apiTypeToDb({ type: 'multiselect' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAttributeMappingError);
    expect((caught as InvalidAttributeMappingError).code).toBe(
      'ENUM_VALUES_REQUIRED',
    );
  });
});

describe('dbTypeToApi (T011)', () => {
  it('string → input', () => {
    expect(
      dbTypeToApi({ valueType: 'string', displayAsSlider: false }),
    ).toEqual<ApiAttributeShape>({ type: 'input' });
  });

  it('number with displayAsSlider=false → number', () => {
    expect(
      dbTypeToApi({ valueType: 'number', displayAsSlider: false }),
    ).toEqual<ApiAttributeShape>({ type: 'number' });
  });

  it('number with displayAsSlider=true → slider, numericKind=number', () => {
    expect(
      dbTypeToApi({ valueType: 'number', displayAsSlider: true }),
    ).toEqual<ApiAttributeShape>({ type: 'slider', numericKind: 'number' });
  });

  it('price with displayAsSlider=true → slider, numericKind=price', () => {
    expect(
      dbTypeToApi({ valueType: 'price', displayAsSlider: true }),
    ).toEqual<ApiAttributeShape>({ type: 'slider', numericKind: 'price' });
  });

  it('enum with one value → select', () => {
    expect(
      dbTypeToApi({
        valueType: 'enum',
        enumValues: ['only'],
        displayAsSlider: false,
      }),
    ).toEqual<ApiAttributeShape>({ type: 'select', enumValues: ['only'] });
  });

  it('enum with many values → multiselect (legacy enum surfaces as multiselect)', () => {
    expect(
      dbTypeToApi({
        valueType: 'enum',
        enumValues: ['a', 'b'],
        displayAsSlider: false,
      }),
    ).toEqual<ApiAttributeShape>({
      type: 'multiselect',
      enumValues: ['a', 'b'],
    });
  });

  it('multiselect (new DB type) → multiselect', () => {
    expect(
      dbTypeToApi({
        valueType: 'multiselect',
        enumValues: ['x', 'y'],
        displayAsSlider: false,
      }),
    ).toEqual<ApiAttributeShape>({
      type: 'multiselect',
      enumValues: ['x', 'y'],
    });
  });

  it('rejects displayAsSlider=true on a non-numeric type with INVALID_DISPLAY_AS_SLIDER', () => {
    let caught: unknown;
    try {
      dbTypeToApi({ valueType: 'string', displayAsSlider: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InvalidAttributeMappingError);
    expect((caught as InvalidAttributeMappingError).code).toBe(
      'INVALID_DISPLAY_AS_SLIDER',
    );
  });
});
