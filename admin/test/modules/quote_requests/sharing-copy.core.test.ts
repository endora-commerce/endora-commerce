import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `specs/192-quote-request-draft-share/` (FR-020) — the create screen's
 * buttons live in the core bundle (`_i18n`), so they are pinned here, beside
 * the page tests, rather than in the module's own `sharing-copy.test.ts`:
 * a module package's test may not read another module's files.
 */
function bundle(locale: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${locale}.json`), 'utf8'),
  ) as Record<string, string>;
}

describe('the create screen buttons (FR-020)', () => {
  it('names the secondary Save without sharing and the warning link Open quote', () => {
    const en = bundle('en');
    const pl = bundle('pl');
    expect(en['rfqCreate.submit']).toBe('Save without sharing');
    expect(pl['rfqCreate.submit']).toBe('Zapisz bez udostępniania');
    expect(en['rfqCreate.warnings.open']).toBe('Open quote');
    expect(pl['rfqCreate.warnings.open']).toBe('Otwórz ofertę');
  });
});
