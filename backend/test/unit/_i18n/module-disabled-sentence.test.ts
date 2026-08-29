import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';

/**
 * Issue #161 — the placeholder in the shipped sentence and the key the refusal
 * puts in `details` are one agreement, and nothing else checks it.
 *
 * `check:error-translations` verifies that a code *has* a sentence in both
 * languages; it cannot see whether the sentence's `{placeholders}` have anything
 * to fill them. A sentence that names `{moduleId}` while the error carries
 * `module` renders the placeholder verbatim — and since the envelope then falls
 * back to the written English message, the regression would be invisible in
 * `en` and merely untranslated in `pl`, which is precisely the silent shape
 * this repair exists to end.
 *
 * The bundles are read off disk rather than through the service because that is
 * what ships. That used to be load-bearing for a second reason — the harness
 * installed no bundles at all, so a test going through the database would have
 * passed on an empty table — and issue #158 removed it: `setupBackendServer`
 * reconciles every module's bundles now. The disk read stays, because this file
 * is asserting the agreement between the shipped sentence and the shipped
 * refusal, not what one composition happened to reconcile.
 */
const I18N_BUNDLES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/modules/_i18n/i18n',
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

describe('the MODULE_DISABLED sentence', () => {
  const target = ERROR_TRANSLATION_KEYS.MODULE_DISABLED;
  const details = new ModuleDisabledError('stripe').details as Record<string, string>;

  it('is routed to a bundle this test can read', () => {
    // `core` is the exposed name of `_i18n`'s own bundle. If the routing ever
    // moves, the assertions below would be reading a bundle nobody serves.
    expect(target).toEqual({ moduleId: 'core', key: 'errors.MODULE_DISABLED' });
  });

  for (const language of LANGUAGES) {
    it(`names the module when filled from the refusal's details (${language})`, () => {
      const sentence = bundle(language)[target.key];
      expect(sentence, `errors.MODULE_DISABLED missing from ${language}.json`).toBeTypeOf('string');

      const rendered = interpolate(sentence!, details);
      expect(rendered).toContain('stripe');
      // Stated separately: an unfilled placeholder is the failure this test is
      // for, and `toContain('stripe')` alone would pass on a sentence that also
      // shows a raw `{something}`.
      expect(rendered).not.toMatch(/\{\w+\}/);
    });
  }
});
