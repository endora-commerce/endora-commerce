import type { FieldRuleCode, FieldWriteForbiddenReason } from '@endora-commerce/contracts';

/**
 * The platform's field-rule sentences (`specs/193-admin-form-extensions/`
 * research R-17): the English the check writes into each `details[]` entry,
 * and the key under which `_lifecycle`'s `en` and `pl` bundles hold it. The
 * envelope translates the entry into the response language; this English is
 * what a reader gets when it cannot. `messages.test.ts` holds this table to
 * the `en` bundle, so the two cannot drift.
 */

/** The module whose bundle holds the sentences: the platform's own surfaces. */
export const FIELD_RULE_MESSAGES_MODULE = '_lifecycle';

export const FIELD_RULE_SENTENCES: Readonly<Record<FieldRuleCode, string>> = {
  required: 'This field is required.',
  too_short: 'Enter at least {limit} characters.',
  too_long: 'Enter at most {limit} characters.',
  below_min: 'Enter {limit} or more.',
  above_max: 'Enter {limit} or less.',
  not_an_option: 'Choose one of the allowed values.',
  pattern: 'The value does not have the required form.',
  format: 'The value is not in the required format.',
};

export const FIELD_WRITE_FORBIDDEN_SENTENCES: Readonly<Record<FieldWriteForbiddenReason, string>> = {
  'missing-permission': 'You do not have permission to change this field.',
  'api-key-scopes-unresolved': 'An API key cannot change this field.',
};

/** `fieldRules.<code>` — the rule codes are snake case, the key keeps them as they are on the wire. */
export const fieldRuleKey = (code: FieldRuleCode): string => `fieldRules.${code}`;

const REASON_KEYS: Readonly<Record<FieldWriteForbiddenReason, string>> = {
  'missing-permission': 'missingPermission',
  'api-key-scopes-unresolved': 'apiKeyScopesUnresolved',
};

/** `fieldRules.writeForbidden.<reason, camelCase>`: a bundle key carries no hyphen. */
export const writeForbiddenKey = (reason: FieldWriteForbiddenReason): string => `fieldRules.writeForbidden.${REASON_KEYS[reason]}`;

/** `{name}` placeholders filled from `params`, as `_i18n` interpolates. */
export function interpolate(sentence: string, params: Readonly<Record<string, string | number>> | undefined): string {
  if (params === undefined) return sentence;
  return sentence.replace(/\{([a-zA-Z]+)\}/gu, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));
}

/** The top-level messages of the three errors, in English (translated under `errors.<CODE>`). */
export const FIELD_RULE_ERROR_MESSAGES = {
  FIELD_RULE_VIOLATION: 'Some values break the rules of this form. Nothing was saved; correct the marked fields.',
  FIELD_WRITE_FORBIDDEN: 'You may not change some of these fields. Nothing was saved.',
  FIELD_SLOT_INPUT_INVALID: 'Some values added to this form by an extension are not valid. Nothing was saved.',
} as const;
