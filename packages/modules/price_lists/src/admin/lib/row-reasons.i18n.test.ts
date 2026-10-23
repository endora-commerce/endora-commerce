import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRICE_BOOK_ROW_ERROR_REASONS } from '@endora-commerce/contracts';

/**
 * Every rule the server names (`PRICE_BOOK_ROW_ERROR_REASONS`, feature 161,
 * Checkpoint 11 ruling 2) is translated by this module's admin, in both
 * shipped languages: as a grid cell's reason (`errors.reason.*`) and as a CSV
 * preview's refusal (`import.reason.*`, through the codec's code for it). A
 * reason added to the contracts without its sentences fails here.
 */

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../i18n/${language}.json`), 'utf8')) as Record<string, string>;

const camel = (reason: string): string => reason.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** The codec's code where it is not the camel-cased reason (`price-book-csv.ts`, `REASON_CODE`). */
const CSV_CODE: Record<string, string> = {
  product_unknown: 'unknownProduct',
  variant_unknown: 'unknownVariant',
  variant_other_product: 'variantOfOtherProduct',
  category_unknown: 'unknownCategory',
  rows_overlap: 'overlapsStored',
  book_row_limit: 'bookLimit',
};

describe('row refusal reasons — translated everywhere they show', () => {
  for (const language of ['en', 'pl'] as const) {
    it(`has every reason in ${language}, for the grid and for the CSV preview`, () => {
      const messages = bundle(language);
      for (const reason of PRICE_BOOK_ROW_ERROR_REASONS) {
        expect(messages[`errors.reason.${reason}`], `${language} errors.reason.${reason}`).toBeTruthy();
        const code = CSV_CODE[reason] ?? camel(reason);
        expect(messages[`import.reason.${code}`], `${language} import.reason.${code}`).toBeTruthy();
      }
      expect(messages['import.reason.overlapsLine']).toBeTruthy();
      expect(messages['import.reason.refusedGroup']).toBeTruthy();
    });
  }
});
