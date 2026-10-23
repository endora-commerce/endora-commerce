import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRICE_BOOK_CELL_CODES, priceSourceSchema } from '@endora-commerce/contracts';
import { cellLabel, cellLabelKey, sourceLabel, sourceLabelKey } from './cell-labels.js';

/**
 * The twelve buyer cells and the four price sources, in words (feature 161,
 * T041; R8). The explanation screen, the precedence view and the cell detail
 * name a cell to an operator who has never read the decision record, so a cell
 * code is never what reaches the screen.
 *
 * The bundles are this module's **shipped** ones, read off disk: a passthrough
 * bundle would render the key as its own value and every assertion here would
 * pass over a missing translation.
 */

type Bundle = Record<string, string>;

function bundle(language: 'en' | 'pl'): Bundle {
  const url = new URL(`../../../i18n/${language}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Bundle;
}

const BUNDLES = { en: bundle('en'), pl: bundle('pl') } as const;

/** `t` over one shipped bundle, failing loudly on a key it does not hold. */
function translator(language: 'en' | 'pl'): (key: string) => string {
  return (key) => {
    const text = BUNDLES[language][key];
    if (text === undefined) throw new Error(`${language}: no "${key}" in the price_lists bundle`);
    return text;
  };
}

const SOURCES = priceSourceSchema.options;

describe('cell labels', () => {
  it('maps every cell code and every source to a key of its own', () => {
    const cellKeys = PRICE_BOOK_CELL_CODES.map(cellLabelKey);
    expect(new Set(cellKeys).size).toBe(12);
    const sourceKeys = SOURCES.map(sourceLabelKey);
    expect(new Set(sourceKeys).size).toBe(4);
    expect(SOURCES).toEqual(['base', 'catalogue', 'buyer', 'sale']);
  });

  for (const language of ['en', 'pl'] as const) {
    it(`names every cell and source in words in ${language}`, () => {
      const t = translator(language);
      const cells = PRICE_BOOK_CELL_CODES.map((code) => cellLabel(t, code));
      const sources = SOURCES.map((source) => sourceLabel(t, source));
      for (const [index, text] of cells.entries()) {
        const code = PRICE_BOOK_CELL_CODES[index]!;
        expect(text.trim().length, code).toBeGreaterThan(0);
        // A label is words, never the code or a key.
        expect(text, code).not.toContain(code);
        expect(text, code).not.toMatch(/^[a-z_.]+$/);
      }
      expect(new Set(cells).size, 'twelve distinct cell labels').toBe(12);
      expect(new Set(sources).size, 'four distinct source labels').toBe(4);
    });
  }

  it('reads the cells as an operator would say them', () => {
    const en = translator('en');
    const pl = translator('pl');
    expect(cellLabel(en, 'org.product')).toBe('Organization book, product line');
    expect(cellLabel(en, 'group.category_attribute')).toBe('Customer group book, category and attribute value line');
    expect(cellLabel(en, 'org.all')).toBe('Organization book, all-products line');
    expect(cellLabel(pl, 'org.product')).toBe('Cennik organizacji, linia produktu');
    expect(cellLabel(pl, 'group.attribute')).toBe('Cennik grupy klientów, linia wartości atrybutu');
    expect(sourceLabel(en, 'catalogue')).toBe('Catalogue price');
    expect(sourceLabel(pl, 'base')).toBe('Cena bazowa');
    expect(sourceLabel(pl, 'sale')).toBe('Cena promocyjna');
  });
});
