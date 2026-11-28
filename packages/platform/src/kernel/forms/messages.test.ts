import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_RULE_CODES, FIELD_WRITE_FORBIDDEN_REASONS } from '@endora-commerce/contracts';
import { manifest } from '../../lifecycle/manifest.js';
import {
  FIELD_RULE_ERROR_MESSAGES,
  FIELD_RULE_MESSAGES_MODULE,
  FIELD_RULE_SENTENCES,
  FIELD_WRITE_FORBIDDEN_SENTENCES,
  fieldRuleKey,
  interpolate,
  writeForbiddenKey,
} from './messages.js';

/**
 * `specs/193-admin-form-extensions/` T027 (FR-042, research R-17): the
 * field-rule sentences the check writes in English are `_lifecycle`'s `en`
 * bundle, word for word, and `pl` has each; the three error codes are
 * `_lifecycle`'s, translated under `errors.<CODE>` in both languages.
 */

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../lifecycle/i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

describe('field-rule sentences (193 T027)', () => {
  it('are _lifecycle’s', () => {
    expect(FIELD_RULE_MESSAGES_MODULE).toBe(manifest.id);
  });

  it('match the en bundle word for word, and pl has each in its own words', () => {
    const en = bundle('en');
    const pl = bundle('pl');
    const expected: [string, string][] = [
      ...FIELD_RULE_CODES.map((code) => [fieldRuleKey(code), FIELD_RULE_SENTENCES[code]] as [string, string]),
      ...FIELD_WRITE_FORBIDDEN_REASONS.map((reason) => [writeForbiddenKey(reason), FIELD_WRITE_FORBIDDEN_SENTENCES[reason]] as [string, string]),
    ];
    for (const [key, sentence] of expected) {
      expect(en[key], key).toBe(sentence);
      expect(typeof pl[key], key).toBe('string');
      expect(pl[key], key).not.toBe(sentence);
    }
  });

  it('declares and translates the three error codes', () => {
    const declared = (manifest.errorCodes ?? []).map((entry) => entry.code);
    for (const code of Object.keys(FIELD_RULE_ERROR_MESSAGES)) {
      expect(declared, code).toContain(code);
      expect(bundle('en')[`errors.${code}`], code).toBe(FIELD_RULE_ERROR_MESSAGES[code as keyof typeof FIELD_RULE_ERROR_MESSAGES]);
      expect(typeof bundle('pl')[`errors.${code}`], code).toBe('string');
    }
  });

  it('interpolates {limit} as _i18n does, and leaves an unfilled placeholder', () => {
    expect(interpolate('Enter at most {limit} characters.', { limit: 5 })).toBe('Enter at most 5 characters.');
    expect(interpolate('Enter at most {limit} characters.', {})).toBe('Enter at most {limit} characters.');
  });
});
