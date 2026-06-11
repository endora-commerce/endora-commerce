import { describe, expect, it } from 'vitest';
import {
  defineModuleSettingsManifest,
  ModuleSettingsManifestSchema,
  SettingValueTypeSchema,
  valueSchemaForType,
} from '@b2b/contracts';

/**
 * T016 — Unit tests for the manifest Zod surface (no DB).
 * Anchors the cross-module registration contract documented in
 * `specs/004-settings-module/contracts/settings-004.contract.md` section A.
 */
describe('ModuleSettingsManifestSchema', () => {
  it('rejects a setting code that is not snake-case-with-dots', () => {
    const result = ModuleSettingsManifestSchema.safeParse({
      moduleCode: 'catalog',
      groups: [],
      settings: [
        {
          code: 'BadCode',
          name: 'Bad code',
          valueType: 'string',
          defaultValue: '',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a group code containing whitespace', () => {
    const result = ModuleSettingsManifestSchema.safeParse({
      moduleCode: 'catalog',
      groups: [{ code: 'sales channels', name: 'x' }],
      settings: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a minimal valid manifest', () => {
    const m = defineModuleSettingsManifest({
      moduleCode: 'catalog',
      groups: [],
      settings: [],
    });
    expect(m.moduleCode).toBe('catalog');
  });

  it('accepts dotted setting codes (module-prefixed convention)', () => {
    const m = defineModuleSettingsManifest({
      moduleCode: 'catalog',
      groups: [{ code: 'sales_channels', name: 'Sales Channels' }],
      settings: [
        {
          code: 'sales_channels.base_url',
          name: 'Base URL',
          groupCode: 'sales_channels',
          valueType: 'string',
          defaultValue: 'https://default.example',
        },
      ],
    });
    expect(m.settings[0]!.code).toBe('sales_channels.base_url');
  });

  it('accepts a string setting with enumOptions and a matching default', () => {
    const m = defineModuleSettingsManifest({
      moduleCode: 'settings',
      groups: [{ code: 'storefront', name: 'Storefront' }],
      settings: [
        {
          code: 'storefront.speculation_rules.eagerness',
          name: 'Eagerness',
          groupCode: 'storefront',
          valueType: 'string',
          defaultValue: 'moderate',
          enumOptions: ['conservative', 'moderate', 'eager'],
        },
      ],
    });
    expect(m.settings[0]!.enumOptions).toEqual([
      'conservative',
      'moderate',
      'eager',
    ]);
  });

  it('rejects enumOptions whose list excludes the defaultValue', () => {
    const result = ModuleSettingsManifestSchema.safeParse({
      moduleCode: 'settings',
      groups: [{ code: 'storefront', name: 'Storefront' }],
      settings: [
        {
          code: 'storefront.x',
          name: 'X',
          groupCode: 'storefront',
          valueType: 'string',
          defaultValue: 'nope',
          enumOptions: ['a', 'b'],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects enumOptions on a non-string valueType', () => {
    const result = ModuleSettingsManifestSchema.safeParse({
      moduleCode: 'settings',
      groups: [{ code: 'storefront', name: 'Storefront' }],
      settings: [
        {
          code: 'storefront.y',
          name: 'Y',
          groupCode: 'storefront',
          valueType: 'number',
          defaultValue: 1,
          enumOptions: ['a', 'b'],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('exposes the six expected value types', () => {
    // 'secret' added by feature 043 (write-only settings).
    expect(SettingValueTypeSchema.options).toEqual([
      'string',
      'number',
      'boolean',
      'json',
      'string_list',
      'secret',
    ]);
  });
});

describe('valueSchemaForType', () => {
  it('returns string schema for "string"', () => {
    expect(valueSchemaForType('string').safeParse('ok').success).toBe(true);
    expect(valueSchemaForType('string').safeParse(42).success).toBe(false);
  });

  it('returns array-of-string schema for "string_list"', () => {
    expect(valueSchemaForType('string_list').safeParse(['a', 'b']).success).toBe(
      true,
    );
    expect(valueSchemaForType('string_list').safeParse(['a', 1]).success).toBe(
      false,
    );
  });

  it('accepts arbitrary JSON for "json"', () => {
    expect(
      valueSchemaForType('json').safeParse({ nested: { value: true } }).success,
    ).toBe(true);
  });
});
