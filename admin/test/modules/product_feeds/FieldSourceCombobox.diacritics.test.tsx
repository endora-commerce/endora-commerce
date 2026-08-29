import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { FeedFieldSourceCatalogue } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { FieldSourceCombobox } from '@/modules/product_feeds/components/FieldSourceCombobox';

/**
 * Issue #239 — "Filled from" builds its own haystack and filters it itself
 * (`manualFilter`), so the `Combobox`'s repaired fold never ran for it. Every
 * label in that haystack is a translated bundle string, which on a Polish
 * installation means every label is Polish.
 *
 * The bundle below is the shipped `pl` copy, verbatim from
 * `backend/src/modules/product_feeds/i18n/pl.json` — including
 * `Główne zdjęcie` and `Wyliczane przez platformę`, both of which the old
 * fold left with their `ł` intact and therefore unreachable without one.
 */

const PL_BUNDLE = {
  product_feeds: {
    'fieldSource.group.product_property': 'Produkt',
    'fieldSource.group.computed': 'Wyliczane przez platformę',
    'fieldSource.imageLink': 'Główne zdjęcie',
    'fieldSource.categoryPath': 'Ścieżka kategorii',
    'fieldSource.sku': 'SKU',
    'fieldSource.hint.constant': 'Ten sam tekst dla każdego produktu.',
    'builder.inspector.source': 'Wypełniane z',
  },
};

const CATALOGUE: FeedFieldSourceCatalogue = {
  groups: [
    {
      kind: 'product_property',
      sources: [
        {
          sourceKind: 'image_link',
          sourceKey: null,
          labelKey: 'fieldSource.imageLink',
          label: null,
          description: null,
          valueType: null,
          requiresTaxonomy: false,
          unsupportedInFormats: [],
        },
        {
          sourceKind: 'sku',
          sourceKey: null,
          labelKey: 'fieldSource.sku',
          label: null,
          description: null,
          valueType: null,
          requiresTaxonomy: false,
          unsupportedInFormats: [],
        },
      ],
    },
    {
      kind: 'computed',
      sources: [
        {
          sourceKind: 'category_path',
          sourceKey: null,
          labelKey: 'fieldSource.categoryPath',
          label: null,
          description: null,
          valueType: null,
          requiresTaxonomy: false,
          unsupportedInFormats: [],
        },
      ],
    },
  ],
} as FeedFieldSourceCatalogue;

function renderPicker(): HTMLInputElement {
  renderWithI18n(
    <FieldSourceCombobox
      catalogue={CATALOGUE}
      value="sku"
      onChange={vi.fn()}
      outputFormat="xml"
      taxonomyProviderCode={null}
    />,
    PL_BUNDLE,
  );
  return screen.getByRole('combobox') as HTMLInputElement;
}

function visibleOptions(): string[] {
  return screen
    .queryAllByRole('option')
    .map((el) => (el.querySelector('.truncate')?.textContent ?? '').trim());
}

function type(input: HTMLInputElement, query: string): void {
  fireEvent.change(input, { target: { value: query } });
}

describe('FieldSourceCombobox — diacritic-insensitive source search (issue #239)', () => {
  it('finds a source label carrying a stroked ł, typed without it', () => {
    const input = renderPicker();
    type(input, 'glowne');
    expect(visibleOptions()).toEqual(['Główne zdjęcie']);
  });

  it('folds ordinary combining diacritics in a source label', () => {
    const input = renderPicker();
    type(input, 'sciezka');
    expect(visibleOptions()).toEqual(['Ścieżka kategorii']);
  });

  it('folds the group heading, which is part of the same haystack', () => {
    const input = renderPicker();
    type(input, 'platforme');
    expect(visibleOptions()).toEqual(['Ścieżka kategorii']);
  });

  it('ignores whitespace around the query', () => {
    const input = renderPicker();
    type(input, '  glowne  ');
    expect(visibleOptions()).toEqual(['Główne zdjęcie']);
  });
});
