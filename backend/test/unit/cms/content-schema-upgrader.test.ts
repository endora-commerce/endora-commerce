import { describe, expect, it } from 'vitest';
import {
  upgrade,
  CmsSchemaUpgradeFailedError,
} from '../../../src/modules/cms/services/content-schema-upgrader.js';

describe('content-schema-upgrader', () => {
  it('passes a current envelope through unchanged', () => {
    const env = { schema_version: 1, languages: { 'en-US': { content: [] } } };
    const out = upgrade(env);
    expect(out.schema_version).toBe(1);
    expect(out.languages['en-US']).toBeDefined();
  });

  it('upgrades v0 (no schema_version field) to v1', () => {
    const env = { languages: { 'en-US': { content: [] } } };
    const out = upgrade(env);
    expect(out.schema_version).toBe(1);
    expect(out.languages['en-US']).toBeDefined();
  });

  it('returns an empty v1 envelope when input is null / undefined / non-object', () => {
    expect(upgrade(null).schema_version).toBe(1);
    expect(upgrade(undefined).schema_version).toBe(1);
    expect(upgrade('string').schema_version).toBe(1);
  });

  it('throws when the envelope is from a future version', () => {
    const env = { schema_version: 99, languages: {} };
    expect(() => upgrade(env)).toThrow(CmsSchemaUpgradeFailedError);
  });
});
