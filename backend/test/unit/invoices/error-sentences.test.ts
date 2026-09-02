import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * Feature 078, D-95.2 — the sentences, and the trap they must not step in.
 *
 * `hasUnfilledPlaceholder` (`http/error-envelope.ts`) is `/\{\w+\}/`, and the
 * envelope discards the **entire** translation when it matches. So a sentence
 * that quotes the platform's own `{seq}` token syntax — or one into which a
 * *pattern* has been interpolated, because a pattern contains `{seq}` — is
 * silently thrown away and the operator is shown untranslated English prose.
 *
 * That is why these sentences name the **channel** and never the pattern, and
 * why this test exists: it is the only thing standing between a future author
 * and a silently untranslated refusal.
 */

/**
 * Both bundle directories, **resolved** rather than spelled. `invoices` became a
 * workspace package in feature 080's T040b and `i18n/` sits at the same place
 * relative to the module's own directory in either layout; a literal
 * `src/modules/invoices/i18n` is an `ENOENT` the day it moves.
 */
const layout = await requireModuleLayout('[invoice-error-sentences]');
const bundlesOf = (id: string): string => {
  const directory = layout.moduleDirectoryOf(id);
  if (directory === null) throw new Error(`[invoice-error-sentences] no such module: ${id}`);
  return join(directory, 'i18n');
};
const INVOICES_BUNDLES = bundlesOf('invoices');
const CORE_BUNDLES = bundlesOf('_i18n');

const LANGUAGES = ['en', 'pl'] as const;

function bundle(dir: string, language: string): Record<string, string> {
  return JSON.parse(readFileSync(join(dir, `${language}.json`), 'utf8')) as Record<
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

/** Every scalar an `INVOICE_*` refusal puts in `details`, as the envelope sees it. */
const DETAILS: Record<string, string | number> = {
  code: 'other_channel',
  kind: 'invoice',
  channel: 'Wholesale PL',
  channelCode: 'wholesale-pl',
  number: 'FV 1/2026',
  example: 'FV 1/2026',
  otherPattern: 'FV {seq}/{YYYY}',
};

const KEYS = [
  'errors.INVOICE_NOT_READY',
  'errors.INVOICE_NUMBER_PATTERN_COLLIDES',
  'errors.INVOICE_NUMBER_PATTERN_COLLIDES.other_channel',
  'errors.INVOICE_NUMBER_PATTERN_COLLIDES.no_sequence_token',
  'errors.INVOICE_NUMBER_ALREADY_ISSUED',
  'errors.INVOICE_NUMBER_ALREADY_ISSUED.other_channel',
  'errors.INVOICE_NUMBER_ALREADY_ISSUED.same_channel',
] as const;

describe('the INVOICE_* sentences', () => {
  it('routes the whole family to the invoices bundle', () => {
    const routed = (code: string): string | undefined =>
      DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId;
    expect(routed(ERROR_CODES.INVOICE_NOT_READY)).toBe('invoices');
    expect(routed(ERROR_CODES.INVOICE_NUMBER_PATTERN_COLLIDES)).toBe('invoices');
    expect(routed(ERROR_CODES.INVOICE_NUMBER_ALREADY_ISSUED)).toBe('invoices');
  });

  for (const language of LANGUAGES) {
    it(`ships every key in ${language}`, () => {
      const sentences = bundle(INVOICES_BUNDLES, language);
      for (const key of KEYS) {
        expect(sentences[key], `${key} (${language})`).toBeTruthy();
      }
    });

    it(`renders every sentence with no placeholder left standing in ${language}`, () => {
      const sentences = bundle(INVOICES_BUNDLES, language);
      for (const key of KEYS) {
        const rendered = interpolate(sentences[key]!, DETAILS);
        expect(rendered, `${key} (${language})`).not.toContain('{');
      }
    });

    it(`no longer carries INVOICE_NOT_READY in the core bundle (${language})`, () => {
      expect(bundle(CORE_BUNDLES, language)['errors.INVOICE_NOT_READY']).toBeUndefined();
    });
  }
});
