import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #86 — `API_KEY_NOT_BOUND` and `API_KEY_CHANNEL_MISMATCH` answer in the
 * caller's language.
 *
 * Both codes were declared by `api_keys` with no sentence in either bundle and
 * stood on `UNTRANSLATED_ERROR_CODES`, so a distributor integration sending
 * `Accept-Language: pl` was refused in English. Neither raise carries a value —
 * the English message is a fixed sentence and no raise passes `details` — so the
 * repair is a sentence per language with **no placeholder**: a `{name}` nothing
 * fills makes the envelope fall back to the thrower's English
 * (`hasUnfilledPlaceholder`, issue #161), which would put back exactly the
 * answer this change removes.
 *
 * The raise sites are read as text rather than imported: one of them is the
 * platform's sales-channel resolver and two are other modules' external routes,
 * and what is asserted of them is only that the English sentence is the one
 * they write.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const I18N_BUNDLES = join(REPO_ROOT, 'packages/modules/api_keys/i18n');

function bundle(language: string): Record<string, string> {
  return JSON.parse(readFileSync(join(I18N_BUNDLES, `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

const CASES = [
  {
    code: 'API_KEY_NOT_BOUND',
    message: 'This endpoint requires a distributor-bound API key.',
    polish: 'Ten endpoint wymaga klucza API powiązanego z dystrybutorem.',
    raisedIn: [
      'packages/modules/api_keys/src/backend/plugin.ts',
      'packages/modules/catalog/src/backend/routes.external.ts',
      'packages/modules/orders/src/backend/routes.external.ts',
    ],
  },
  {
    code: 'API_KEY_CHANNEL_MISMATCH',
    message: 'API key is bound to a different sales channel.',
    polish: 'Klucz API jest powiązany z innym kanałem sprzedaży.',
    raisedIn: ['packages/platform/src/kernel/sales-channels/sales-channel-resolver.middleware.ts'],
  },
] as const;

describe('the API key binding refusals have sentences (issue #86)', () => {
  for (const { code, message, polish, raisedIn } of CASES) {
    const key = `errors.${code}`;

    it(`routes ${code} to api_keys' bundle`, () => {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]).toEqual({ moduleId: 'api_keys', key });
    });

    it(`${code}: every raise writes the English sentence the bundle carries`, () => {
      for (const file of raisedIn) {
        const source = readFileSync(join(REPO_ROOT, file), 'utf8');
        expect(source, file).toContain(`ERROR_CODES.${code},`);
        expect(source, file).toContain(`'${message}'`);
      }
      expect(bundle('en')[key]).toBe(message);
    });

    it(`${code}: the Polish sentence is Polish, not the English one`, () => {
      const sentence = bundle('pl')[key];
      expect(sentence).toBe(polish);
      expect(sentence).not.toBe(message);
    });

    it(`${code}: neither sentence has a placeholder no raise could fill`, () => {
      expect(bundle('en')[key]).not.toMatch(/\{\w+\}/);
      expect(bundle('pl')[key]).not.toMatch(/\{\w+\}/);
    });
  }
});
