import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import {
  MAX_TREE_DEPTH_SEGMENTS,
  cycleRefusal,
  hasChildrenRefusal,
  maxDepthRefusal,
} from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';

/**
 * D-129's remaining sweep, MR 7 — the sentences `organizations` gained when its
 * eight codes arrived, and the two of them whose every raise carries a token.
 *
 * Issue #168's three-way agreement, one module over from
 * `admin_roles/role-in-use-sentence.test.ts`: the token the raise writes, the
 * key in the bundle, and the placeholder name inside the sentence all have to
 * agree before an operator reads anything useful, and no check sees all three.
 * `check:error-translations` verifies that a **code** has a sentence — it cannot
 * see a sub-key nothing reaches, nor a `{maxDepth}` nothing fills, and the
 * envelope's own `hasUnfilledPlaceholder` fall-back then hides the second miss
 * behind the written English (issue #161).
 *
 * So the fixture enters at the top: real refusals from the real functions, and
 * the bundles read off disk because that is what ships.
 */
const I18N_BUNDLES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/modules/organizations/i18n',
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

/** `details.code` — the refusal token the envelope keys `errors.<CODE>.<token>` on. */
function tokenOf(details: unknown): unknown {
  return (details as Record<string, unknown> | undefined)?.['code'];
}

describe('the two always-tokened organizations codes', () => {
  /**
   * Every raise of both codes passes a `details.code`, measured by balancing
   * each `HttpError` call's own parentheses and reading `details` as the
   * positional fourth argument it is. So `localizeErrorEnvelope` — which
   * composes `` `${target.key}.${token}` `` whenever a token is present and
   * never re-asks for the base key — reaches only the sub-keys below, and the
   * base sentences both codes carried in `_i18n`'s bundle rendered for nobody
   * for as long as they existed.
   */
  const cases = [
    {
      code: 'ORGANIZATION_HAS_CHILDREN',
      name: 'a delete refused because sub-organizations exist',
      refusal: hasChildrenRefusal(),
      token: 'has_children',
      status: 409,
      contains: null,
    },
    {
      code: 'ORGANIZATION_TREE_INVALID',
      name: 'a re-parent that would close a cycle',
      refusal: cycleRefusal(),
      token: 'cycle',
      status: 422,
      contains: null,
    },
    {
      code: 'ORGANIZATION_TREE_INVALID',
      name: 'a re-parent past the depth bound',
      refusal: maxDepthRefusal(),
      token: 'max_depth_exceeded',
      status: 422,
      contains: String(MAX_TREE_DEPTH_SEGMENTS),
    },
  ] as const;

  for (const { code, name, refusal, token, status, contains } of cases) {
    it(`routes ${code} to this module's bundle (${token})`, () => {
      // D-129's remaining sweep, MR 7: the code left `_i18n`'s declaration for
      // this module's own, and its sentences came with it.
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]).toEqual({
        moduleId: 'organizations',
        key: `errors.${code}`,
      });
    });

    it(`refuses ${name} with the ${token} token`, () => {
      expect(refusal.statusCode).toBe(status);
      expect(tokenOf(refusal.details)).toBe(token);
    });

    for (const language of LANGUAGES) {
      it(`renders the ${token} sentence from the refusal's details (${language})`, () => {
        const key = `errors.${code}.${token}`;
        const sentence = bundle(language)[key];
        expect(sentence, `${key} missing from ${language}.json`).toBeTypeOf('string');

        const rendered = interpolate(sentence!, paramsOf(refusal.details));
        if (contains !== null) expect(rendered).toContain(contains);
        // Stated separately: an unfilled placeholder is the failure this test is
        // for, and a `toContain` alone would pass on a sentence that also shows
        // a raw `{something}`.
        expect(rendered).not.toMatch(/\{\w+\}/);
      });
    }
  }

  for (const code of ['ORGANIZATION_HAS_CHILDREN', 'ORGANIZATION_TREE_INVALID'] as const) {
    for (const language of LANGUAGES) {
      it(`keeps ${code}'s unreachable base sentence (${language})`, () => {
        // **This key renders for nobody, and it is load-bearing anyway** —
        // D-190. `findUntranslatedErrorCodes` reads
        // `read(target.moduleId, language)[target.key]` and no other key, so a
        // bundle carrying only the sub-keys above reports both of these codes
        // as untranslated and exits 1. MR 6 measured exactly that for
        // `ADMIN_ROLE_IN_USE` before the ruling. The repair, when it is taken,
        // is P1's — accept "every declared token answered" as translated — and
        // it is not this merge request's to make.
        const sentence = bundle(language)[`errors.${code}`];
        expect(sentence, `errors.${code} missing from ${language}.json`).toBeTypeOf('string');
        expect(sentence).not.toMatch(/\{\w+\}/);
      });
    }
  }

  it('is the whole token set both codes declare', () => {
    // The manifest and the raise sites are two derivations of one answer, and
    // this is where they meet: a token declared with no producer is a sentence
    // nothing can key, and a producer with no declaration is a sentence nobody
    // knew to write.
    const produced = new Map<string, string[]>();
    for (const { code, refusal } of cases) {
      produced.set(code, [...(produced.get(code) ?? []), String(tokenOf(refusal.details))]);
    }
    expect(produced.get('ORGANIZATION_HAS_CHILDREN')).toEqual(['has_children']);
    expect(produced.get('ORGANIZATION_TREE_INVALID')).toEqual(['cycle', 'max_depth_exceeded']);
  });
});

/**
 * The six untokened codes, and the one thing a sentence for them must not do.
 *
 * None of their raise sites passes any `details` at all — measured the same way
 * — so `paramsOf` is empty for every one of them and a `{placeholder}` in the
 * sentence would leave the envelope answering with the raise site's English
 * instead (`hasUnfilledPlaceholder`). Five replaced a placeholder here and
 * `ORG_OWNER_DEPLETION` had no sentence at all, which is what makes
 * `UNTRANSLATED_ERROR_CODES` shrink in this merge request.
 */
describe('the six untokened organizations codes', () => {
  const codes = [
    'CANNOT_REVOKE_LAST_ADMIN_INVITE',
    'EMAIL_ALREADY_IN_ORGANIZATION',
    'EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION',
    'ORGANIZATION_SUSPENDED',
    'ORGANIZATION_TAX_ID_EXISTS',
    'ORG_OWNER_DEPLETION',
  ] as const;

  for (const code of codes) {
    it(`routes ${code} to this module's bundle`, () => {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]).toEqual({
        moduleId: 'organizations',
        key: `errors.${code}`,
      });
    });

    for (const language of LANGUAGES) {
      it(`answers ${code} with a sentence that needs nothing filled (${language})`, () => {
        const sentence = bundle(language)[`errors.${code}`];
        expect(sentence, `errors.${code} missing from ${language}.json`).toBeTypeOf('string');
        expect(sentence).not.toMatch(/\{\w+\}/);
      });
    }
  }
});
