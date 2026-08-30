import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import {
  protectedRoleRefusal,
  roleInUseRefusal,
} from '../../../../packages/modules/admin_roles/src/backend/services/admin-role-service.js';

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
  '../../../../packages/modules/admin_roles/i18n',
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
  // Asserted, not assumed: the first `it` below compares this to the whole
  // expected target, so an undeclared code fails there rather than here.
  const target = DECLARED_ERROR_TRANSLATION_TARGETS['ADMIN_ROLE_IN_USE']!;

  it('is routed to a bundle this test can read', () => {
    // D-129's remaining sweep, MR 6: the code left `_i18n`'s declaration for
    // this module's own, and its four live keys came with it.
    expect(target).toEqual({ moduleId: 'admin_roles', key: 'errors.ADMIN_ROLE_IN_USE' });
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
      // **This key renders for nobody today, and the comment that used to stand
      // here said the opposite.** It read "the envelope falls back to
      // `errors.<CODE>` when an error carries no token" — true of the *shape*
      // and false as a fallback: `localizeErrorEnvelope` composes
      // `` `${target.key}.${token}` `` whenever `details.code` is present and
      // never re-asks for the base key, so with `roleInUseRefusal` the only
      // producer and both of its refusals tokened, nothing in the tree reaches
      // this sentence. The same wrong claim is written in
      // `packages/contracts/src/modules.ts` and in `check-error-translations.ts`'
      // `ERROR_KEY` note; both are for the defect register, not for this file.
      //
      // The assertion stays because the key does. `check:error-translations`'
      // P1 asks its question at `errors.<CODE>` and at no other key, so
      // deleting the base pair reports the best-translated code in the sweep as
      // untranslated and exits 1 — measured on this tree. A sentence that is
      // load-bearing for the instrument and unreachable for the operator is
      // worth an assertion saying so, and this is it.
      const sentence = bundle(language)[target.key];
      expect(sentence, `${target.key} missing from ${language}.json`).toBeTypeOf('string');
      expect(sentence).not.toMatch(/\{\w+\}/);
    });
  }
});

/**
 * D-129's remaining sweep, MR 6 — the two sentences this module wrote when the
 * codes arrived, and the one of them that interpolates.
 *
 * `ADMIN_ROLE_PROTECTED`'s raise names the role in its English message, so a
 * translated sentence with no placeholder would render cleanly and lose it —
 * !1181's finding, measured at 85 codes tree-wide. `check:error-translations`
 * cannot see that: it asks whether the code has a sentence, never whether the
 * sentence says as much as the message it replaces. This is the same three-way
 * agreement the block above asserts for the tokens, one code over.
 */
describe('the sentences admin_roles wrote when the codes arrived', () => {
  for (const language of LANGUAGES) {
    it(`names the refused role in the ADMIN_ROLE_PROTECTED sentence (${language})`, () => {
      const refusal = protectedRoleRefusal('blog_manager');
      expect(refusal.statusCode).toBe(409);
      // Never `details.code`, which is the refusal token: a role code there
      // would key `errors.ADMIN_ROLE_PROTECTED.blog_manager`, a sentence that
      // will never exist.
      expect((refusal.details as Record<string, unknown>)['code']).toBeUndefined();

      const key = 'errors.ADMIN_ROLE_PROTECTED';
      const sentence = bundle(language)[key];
      expect(sentence, `${key} missing from ${language}.json`).toBeTypeOf('string');

      const rendered = interpolate(sentence!, paramsOf(refusal.details));
      expect(rendered).toContain('blog_manager');
      expect(rendered).not.toMatch(/\{\w+\}/);
    });

    it(`carries no unfilled placeholder in the ADMIN_ROLE_CODE_TAKEN sentence (${language})`, () => {
      // The other rewritten placeholder. Its raise passes no `details` at all,
      // so a sentence naming one would be worse than the English it replaced:
      // `hasUnfilledPlaceholder` would send the operator back to the message.
      const key = 'errors.ADMIN_ROLE_CODE_TAKEN';
      const sentence = bundle(language)[key];
      expect(sentence, `${key} missing from ${language}.json`).toBeTypeOf('string');
      expect(sentence).not.toMatch(/\{\w+\}/);
    });
  }
});
