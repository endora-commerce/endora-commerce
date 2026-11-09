import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';
import { manifest } from '../../manifest.js';

/**
 * Issue #351, architect ruling R1 — `LINE_QUANTITY_EXCEEDED` is raised by the
 * error envelope from a Zod issue, whose `details` carry no value, so its
 * sentences name the bound literally instead of through a `{maximum}`
 * placeholder (which would make the envelope fall back to English). This pins
 * each sentence to `LINE_QUANTITY_MAX`, formatted for its language, so a change
 * of the constant reds the bundle.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'i18n');
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(join(root, `${language}.json`), 'utf8')) as Record<string, string>;

describe('errors.LINE_QUANTITY_EXCEEDED', () => {
  it('is a code this module translates', () => {
    expect((manifest.errorCodes ?? []).map((entry) => entry.code)).toContain('LINE_QUANTITY_EXCEEDED');
  });

  it.each([
    ['en', 'en-US'],
    ['pl', 'pl-PL'],
  ] as const)('names LINE_QUANTITY_MAX in %s, and no placeholder', (language, locale) => {
    const sentence = bundle(language)['errors.LINE_QUANTITY_EXCEEDED'];
    expect(sentence).toBeDefined();
    // `Intl` writes Polish thousands with a no-break space; the bundle uses a plain one.
    const number = new Intl.NumberFormat(locale).format(LINE_QUANTITY_MAX).replace(/\s/g, ' ');
    expect(sentence).toContain(number);
    expect(sentence).not.toMatch(/\{\w+\}/);
  });
});
