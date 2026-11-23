import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RETURN_GUEST_SUBMITTED_DEFAULT, RETURN_GUEST_VERIFICATION_DEFAULT } from './transactional-defaults.js';

/**
 * Issue #1809 — why each of this module's protected e-mails cannot be switched
 * off, in every shipped language. The transactional-e-mail list reads the
 * sentence from this module's bundle under `transactionalEmails.<code>.reason`
 * in the reader's language, and keeps the English below when there is none —
 * which is what the issue reported. So the English entry is held to the
 * declared sentence and the Polish one to being there.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

const PROTECTED: Record<string, { nonDeactivatable: { reason: string } }> = {
  return_guest_verification: RETURN_GUEST_VERIFICATION_DEFAULT,
  return_guest_submitted: RETURN_GUEST_SUBMITTED_DEFAULT,
};

describe.each(Object.entries(PROTECTED))('%s', (code, defaults) => {
  const key = `transactionalEmails.${code}.reason`;

  it('ships its reason in English, as declared, and in Polish', () => {
    expect(bundle('en')[key]).toBe(defaults.nonDeactivatable.reason);
    expect(bundle('pl')[key]).toEqual(expect.any(String));
    expect(bundle('pl')[key]).not.toBe(defaults.nonDeactivatable.reason);
  });
});
