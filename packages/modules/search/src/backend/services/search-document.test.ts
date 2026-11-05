import { describe, expect, it } from 'vitest';
import type { OverrideRow } from '@endora-commerce/contracts';
import {
  attributesToSearchOnFor,
  documentAttributes,
  documentTexts,
  indexLanguagesOf,
  sortableAttributesFor,
} from './search-document.js';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/contracts/search-index.md` §1–§3, FR-033)
 * — a channel index document carries, for **every language the channel offers**, the product's
 * texts effective at (channel, language) along C×L → C → Global; a query in language L searches
 * `texts.<L>.*` only, so a Polish shopper never matches the English name.
 */

const CHANNEL = 'c-vip';
const row = (attributeKey: string, languageCode: string | null, value: unknown): OverrideRow => ({
  attributeKey,
  channelId: CHANNEL,
  languageCode,
  value: { v: value },
});

const PRODUCT = {
  name: 'Drill X',
  description: 'A drill.',
  attributeValues: { material: 'Steel', voltage: 18, finish: 'matte_01', tags: ['a'] } as Record<string, unknown>,
};

describe('indexLanguagesOf', () => {
  it('is the channel languages with its default language, once each', () => {
    expect(indexLanguagesOf({ languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' })).toEqual(['pl-PL', 'en-US']);
    expect(indexLanguagesOf({ languages: [], defaultLanguage: 'pl-PL' })).toEqual(['pl-PL']);
    expect(indexLanguagesOf({ languages: ['en-US'], defaultLanguage: 'pl-PL' })).toEqual(['pl-PL', 'en-US']);
  });
});

describe('documentTexts', () => {
  const textAttributes = [{ key: 'material', scopeLevels: ['G', 'C', 'CL'] as const }];
  const options = new Map([
    ['pl-PL', new Map([['finish', new Map([['matte_01', 'Matowy']])]])],
    ['en-US', new Map([['finish', new Map([['matte_01', 'Matte']])]])],
  ]);

  it('resolves name, description and text attributes per language, C×L → C → Global', () => {
    const texts = documentTexts(PRODUCT, {
      channelId: CHANNEL,
      languages: ['pl-PL', 'en-US'],
      overrides: [row('name', 'pl-PL', 'Wiertarka X Pro'), row('name', null, 'Drill X Pro'), row('material', 'pl-PL', 'Stal')],
      textAttributes,
      optionLabels: options,
    });
    expect(texts['pl-PL']).toEqual({
      name: 'Wiertarka X Pro',
      description: 'A drill.',
      attributes: { material: 'Stal' },
      options: ['Matowy'],
    });
    expect(texts['en-US']).toEqual({
      name: 'Drill X Pro',
      description: 'A drill.',
      attributes: { material: 'Steel' },
      options: ['Matte'],
    });
  });

  it("writes '' for an empty override (it stops the fallback)", () => {
    const texts = documentTexts(PRODUCT, {
      channelId: CHANNEL,
      languages: ['pl-PL'],
      overrides: [row('description', 'pl-PL', null)],
      textAttributes,
      optionLabels: new Map(),
    });
    expect(texts['pl-PL']!.description).toBe('');
  });

  it('ignores another channel’s rows', () => {
    const texts = documentTexts(PRODUCT, {
      channelId: CHANNEL,
      languages: ['pl-PL'],
      overrides: [{ ...row('name', 'pl-PL', 'Inny'), channelId: 'c-retail' }],
      textAttributes,
      optionLabels: new Map(),
    });
    expect(texts['pl-PL']!.name).toBe('Drill X');
  });
});

describe('documentAttributes', () => {
  it('keeps non-text values and drops the text values of searchable, non-filterable text attributes', () => {
    expect(documentAttributes(PRODUCT.attributeValues, new Set(['material']))).toEqual({
      voltage: 18,
      finish: 'matte_01',
      tags: ['a'],
    });
  });
});

describe('attributesToSearchOnFor', () => {
  it("searches the shopper's language only, plus the SKU and the searchable non-text attributes", () => {
    expect(attributesToSearchOnFor('pl-PL', ['voltage'])).toEqual([
      'texts.pl-PL.name',
      'texts.pl-PL.description',
      'texts.pl-PL.attributes',
      'texts.pl-PL.options',
      'sku',
      'attributes.voltage',
    ]);
  });
});

describe('sortableAttributesFor', () => {
  it('sorts by creation and by the name in each index language', () => {
    expect(sortableAttributesFor(['pl-PL', 'en-US'])).toEqual(['createdAt', 'texts.pl-PL.name', 'texts.en-US.name']);
  });
});

describe('queryLanguageOf (R21)', () => {
  it('answers a language the channel offers', async () => {
    const { queryLanguageOf } = await import('./search-query.service.js');
    const channel = { id: 'c', code: 'c', defaultCurrency: 'PLN', defaultLanguage: 'pl-PL', languages: ['pl-PL', 'en-US'] };
    expect(queryLanguageOf(channel, 'en-US')).toBe('en-US');
    expect(queryLanguageOf(channel, 'de-DE')).toBe('pl-PL');
  });

  it('refuses a language that is not a tag before it reaches a field path', async () => {
    const { queryLanguageOf } = await import('./search-query.service.js');
    for (const defaultLanguage of ['pl-PL.name:asc', 'x"y', 'pl PL']) {
      const channel = { id: 'c', code: 'c', defaultCurrency: 'PLN', defaultLanguage, languages: [] };
      expect(() => queryLanguageOf(channel, undefined), defaultLanguage).toThrow();
    }
  });
});
