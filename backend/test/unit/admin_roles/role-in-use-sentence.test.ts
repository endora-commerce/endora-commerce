import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_TRANSLATION_KEYS } from '../../../src/modules/_i18n/services/error-translation.js';
import { roleInUseRefusal } from '../../../../packages/modules/admin_roles/src/backend/services/admin-role-service.js';

/**
 * Issue #168 — the refusal names its reason, and the sentence has something to
 * name it with.
 *
 * The guard answers with a token in `details.code` and a count beside it; the
 * envelope keys the sentence on the token and interpolates the count. Three
 * things have to agree for an operator to read anything useful, and no other
 * check sees all three: the token the guard writes, the key in the bundle, and
 * the placeholder name inside the sentence. `check:error-translations` verifies
 * only that the *code* has a sentence — it cannot see a `{deleted}` that nothing
 * fills, and the envelope's own fallback then hides the miss behind the written
 * English message (`hasUnfilledPlaceholder`, issue #161).
 *
 * So the fixture enters at the top: a real refusal from the real function, and
 * the bundles read off disk because that is what ships.
 */
const I18N_BUNDLES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/_i18n/i18n',
);

const LANGUAGES = ['en', 'pl'] as const;

function bundle(language: string): Record<string, string> {
  return JSON.parse(readFileSync(join(I18N_BUNDLES, `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

/** `_i18n`'s own substitution, so this test measures the same rendering. */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params[name] != null ? String(params[name]) : `{${name}}`,
  );
}

/** The scalar members of a refusal's `details`, as the envelope reads them. */
function paramsOf(details: unknown): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries((details ?? {}) as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  return params;
}

describe('the ADMIN_ROLE_IN_USE sentences', () => {
  const target = ERROR_TRANSLATION_KEYS.ADMIN_ROLE_IN_USE;

  it('is routed to a bundle this test can read', () => {
    expect(target).toEqual({ moduleId: 'core', key: 'errors.ADMIN_ROLE_IN_USE' });
  });

  it('answers nothing when the role has no assignees at all', () => {
    expect(roleInUseRefusal(0, 0)).toBeNull();
  });

  const cases = [
    { name: 'live assignees', refusal: roleInUseRefusal(3, 0)!, token: 'assigned', count: '3' },
    {
      name: 'soft-deleted assignees',
      refusal: roleInUseRefusal(0, 2)!,
      token: 'assigned_to_deleted',
      count: '2',
    },
  ] as const;

  for (const { name, refusal, token, count } of cases) {
    it(`refuses ${name} with the ${token} token and its count`, () => {
      expect(refusal.statusCode).toBe(409);
      expect((refusal.details as Record<string, unknown>)['code']).toBe(token);
    });

    for (const language of LANGUAGES) {
      it(`renders the ${token} sentence from the refusal's details (${language})`, () => {
        const key = `${target.key}.${token}`;
        const sentence = bundle(language)[key];
        expect(sentence, `${key} missing from ${language}.json`).toBeTypeOf('string');

        const rendered = interpolate(sentence!, paramsOf(refusal.details));
        expect(rendered).toContain(count);
        // Stated separately: an unfilled placeholder is the failure this test is
        // for, and `toContain(count)` alone would pass on a sentence that also
        // shows a raw `{something}`.
        expect(rendered).not.toMatch(/\{\w+\}/);
      });
    }
  }

  for (const language of LANGUAGES) {
    it(`keeps a token-less sentence for the family (${language})`, () => {
      // The envelope falls back to `errors.<CODE>` when an error carries no
      // token, and both sentences above are token-keyed. Without this the
      // family key could be deleted and nothing would notice until a future
      // caller threw the plain code.
      const sentence = bundle(language)[target.key];
      expect(sentence, `${target.key} missing from ${language}.json`).toBeTypeOf('string');
      expect(sentence).not.toMatch(/\{\w+\}/);
    });
  }
});
