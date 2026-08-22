import { describe, expect, it } from 'vitest';
import { SettingManifestEntrySchema, valueSchemaForType } from '@endora-commerce/contracts';

/**
 * Feature 058 US2 (T035) — the `credential_ref` Settings value type contract
 * (contracts/settings-credential-ref.md).
 */
describe('credential_ref value type [contract]', () => {
  it('valueSchemaForType("credential_ref") accepts a code string', () => {
    const schema = valueSchemaForType('credential_ref');
    expect(schema.safeParse('primary-llm').success).toBe(true);
    expect(schema.safeParse('').success).toBe(true); // '' ⇒ not configured
    expect(schema.safeParse(42).success).toBe(false);
  });

  it('requires configurationType iff valueType is credential_ref', () => {
    // credential_ref WITH configurationType → valid.
    expect(
      SettingManifestEntrySchema.safeParse({
        code: 'prompt_actions.llm_credentials',
        name: 'LLM credentials',
        valueType: 'credential_ref',
        configurationType: 'llm',
        defaultValue: '',
      }).success,
    ).toBe(true);

    // credential_ref WITHOUT configurationType → invalid.
    expect(
      SettingManifestEntrySchema.safeParse({
        code: 'prompt_actions.llm_credentials',
        name: 'LLM credentials',
        valueType: 'credential_ref',
        defaultValue: '',
      }).success,
    ).toBe(false);

    // Non-credential_ref WITH configurationType → invalid (forbidden).
    expect(
      SettingManifestEntrySchema.safeParse({
        code: 'prompt_actions.plain',
        name: 'Plain',
        valueType: 'string',
        configurationType: 'llm',
        defaultValue: '',
      }).success,
    ).toBe(false);

    // Non-credential_ref WITHOUT configurationType → valid.
    expect(
      SettingManifestEntrySchema.safeParse({
        code: 'prompt_actions.plain',
        name: 'Plain',
        valueType: 'string',
        defaultValue: '',
      }).success,
    ).toBe(true);
  });
});
