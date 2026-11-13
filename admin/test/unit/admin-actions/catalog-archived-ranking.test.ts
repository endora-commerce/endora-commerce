import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBundleKeywords } from '@endora-commerce/contracts';
import { manifest as catalogManifest } from '@endora-commerce/mod-catalog';
import {
  matchesSearchTerms,
  searchTerms,
} from '../../../../packages/admin-shell/src/lib/palette-match';

/**
 * Issue #501, item 1 — typing `archived` in ⌘K listed "Products" first and
 * "Archived products" second, so Enter opened the plain product list.
 *
 * The palette keeps the server's `(weight, label)` order and filters it
 * (`useAdminActions`), so the first row a word matches is the lowest-weight
 * action that carries it. `open-products` (weight 200) sits before
 * `open-archived-products` (weight 210); a word that names the archived list
 * must therefore not be one of `open-products`' keywords. This replays the
 * server's resolution — the manifest's English keywords plus the words the
 * action's `keywordsKey` resolves to in the language — over the real manifest
 * and bundles, in both shipped languages.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleDir = resolve(__dirname, '../../../../packages/modules/catalog/i18n');

type Language = 'en' | 'pl';

function bundle(language: Language): Record<string, string> {
  return JSON.parse(readFileSync(resolve(bundleDir, `${language}.json`), 'utf8')) as Record<string, string>;
}

interface Row {
  id: string;
  weight: number;
  label: string;
  haystacks: string[];
}

function paletteRows(language: Language): Row[] {
  const strings = bundle(language);
  const rows = (catalogManifest.actions ?? []).map((action) => {
    const label = strings[action.labelKey] ?? action.labelKey;
    const description = action.descriptionKey ? (strings[action.descriptionKey] ?? '') : '';
    const localized = action.keywordsKey ? parseBundleKeywords(strings[action.keywordsKey] ?? '') : [];
    const keywords = [...new Set([...(action.keywords ?? []), ...localized])];
    return { id: action.id, weight: action.weight ?? 100, label, haystacks: [label, description, ...keywords] };
  });
  return rows.sort((a, b) => (a.weight !== b.weight ? a.weight - b.weight : a.label.localeCompare(b.label, language)));
}

function firstMatch(language: Language, query: string): string | undefined {
  const terms = searchTerms(query);
  return paletteRows(language).find((row) => matchesSearchTerms(terms, row.haystacks))?.id;
}

describe('palette ranking — the word for the archived list opens the archived list (issue #501)', () => {
  it.each([
    ['en', 'archived'],
    ['en', 'Archived'],
    ['pl', 'archived'],
    ['pl', 'archiwum'],
    ['pl', 'zarchiwizowane'],
  ] as const)('%s: "%s" ranks "Archived products" first', (language, query) => {
    expect(firstMatch(language, query)).toBe('open-archived-products');
  });

  it.each([
    ['en', 'products'],
    ['pl', 'produkty'],
    ['en', 'archive'],
    ['pl', 'archiwizuj'],
  ] as const)('%s: "%s" still opens the product list, where Archive is run', (language, query) => {
    expect(firstMatch(language, query)).toBe('open-products');
  });
});
